"""Detached, restart-safe Modal launcher for ordered native-strategy shards."""

from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
import pathlib
import re
import shutil
import socket
import struct
import subprocess
import tarfile
import tempfile
import threading
import time
import uuid
from typing import Any

import modal
from modal.exception import TimeoutError as ModalTimeoutError

CPU_RATE_PER_CORE_HOUR = 0.0473
MEMORY_RATE_PER_GIB_HOUR = 0.008
GROSS_BUDGET_USD = 25.0
MAX_PHYSICAL_CORES = 192
MAX_FULL_RUNS = 3
FULL_CANDIDATE_COUNT = 12_972_960
MAX_RETRIES = 2
DEFAULT_ORDERED_PRODUCT_KINGDOM = "deep-beam-tuning-009"
ORDERED_PRODUCT_SEEDS = [4_100_000, 4_100_001, 4_100_002, 4_100_003]
ORDERED_PRODUCT_AUTHORIZATIONS = {
    "deep-beam-tuning-001": "k001-ordered-product-calibration-v2",
    "deep-beam-tuning-007": "k007-ordered-product-calibration-v2",
    "deep-beam-tuning-008": "k008-ordered-product-calibration-v2",
    DEFAULT_ORDERED_PRODUCT_KINGDOM: "k009-ordered-product-correction-v1",
}
ORDERED_PRODUCT_AUTHORIZATION_CONTRACTS = {
    authorization: {"kingdom": kingdom, "shuffle_seeds": ORDERED_PRODUCT_SEEDS}
    for kingdom, authorization in ORDERED_PRODUCT_AUTHORIZATIONS.items()
}
ORDERED_PRODUCT_AUTHORIZATION_CONTRACTS.update({
    "k007-ordered-product-seed-replication-1-v1": {
        "kingdom": "deep-beam-tuning-007", "shuffle_seeds": [5_100_000, 5_100_001, 5_100_002, 5_100_003]},
    "k007-ordered-product-seed-replication-2-v1": {
        "kingdom": "deep-beam-tuning-007", "shuffle_seeds": [6_100_000, 6_100_001, 6_100_002, 6_100_003]},
    "k007-ordered-product-seed-replication-3-v1": {
        "kingdom": "deep-beam-tuning-007", "shuffle_seeds": [7_100_000, 7_100_001, 7_100_002, 7_100_003]},
})
ORDERED_PRODUCT_AUTHORIZATION = ORDERED_PRODUCT_AUTHORIZATIONS[DEFAULT_ORDERED_PRODUCT_KINGDOM]
ORDERED_PRODUCT_RETAINED_COUNT = 500_000
ORDERED_PRODUCT_RESERVOIR_COUNT = 20_000
SCORER_VERSION = "native-goldfish-v1"
COMPETITIVE_SCORER_VERSION = "native-competitive-v1"
COMPETITIVE_RUN_CAP_USD = 2.0
COMPETITIVE_TARGET_BLOCKS = 65_536
COMPETITIVE_ARTIFACT_MAGIC = b"HPS1"
RESULT_SCHEMA_VERSION = 1
CAMPAIGN_CHECKPOINT_EVENT = "strategy-search-checkpoint"
CAMPAIGN_STAGE_STOP_EVENT = "strategy-search-stage-stop"
CAMPAIGN_STAGES = {"goldfish", "matrix", "psro"}
CAMPAIGN_RUST_GOLDFISH_BIN = "/workspace/rust/target/x86_64-unknown-linux-gnu/release/hexdeck-goldfish"
CAMPAIGN_STAGE_ONE_CHUNK_SIZE = 250_000
LEDGER_PATH = pathlib.Path.home() / ".hexdeck-modal-cost-ledger.json"

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
_SOURCE_EXCLUDED_COMPONENTS = {".git", "node_modules", ".experiments", ".reviews", ".data",
    "dist", "dist-sim", "dist-benchmark", "target"}
try:
    _SOURCE_TRACKED_PATHS = {path for path in subprocess.run(
        ["git", "ls-files", "-z"], cwd=PROJECT_ROOT, check=True, capture_output=True
    ).stdout.decode().split("\0") if path and not any(
        component.lower() in _SOURCE_EXCLUDED_COMPONENTS for component in path.split("/"))
        and pathlib.PurePosixPath(path).name.lower() != ".env"
        and not pathlib.PurePosixPath(path).name.lower().startswith(".env.")
        and "credential" not in pathlib.PurePosixPath(path).name.lower()
        and not pathlib.PurePosixPath(path).name.lower().endswith((".pem", ".key"))}
except (OSError, subprocess.SubprocessError):
    _SOURCE_TRACKED_PATHS = set()


def _ignore_untracked_source(path: pathlib.Path) -> bool:
    if not _SOURCE_TRACKED_PATHS:
        return False
    try:
        relative = path.resolve().relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return True
    if relative in {"", "."}:
        return False
    return relative not in _SOURCE_TRACKED_PATHS \
        and not any(held.startswith(f"{relative}/") for held in _SOURCE_TRACKED_PATHS)


app = modal.App("hexdeck-native-strategy-search")
volume = modal.Volume.from_name("hexdeck-native-strategy-results", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ca-certificates", "curl", "build-essential", "time")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs && node --version",
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal",
        "/root/.cargo/bin/rustup toolchain install 1.98.0 --profile minimal --component clippy,rustfmt --target x86_64-unknown-linux-gnu",
    )
    .env({"PATH": "/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"})
    .add_local_dir(PROJECT_ROOT, remote_path="/workspace", copy=True, ignore=_ignore_untracked_source)
    .run_commands(
        "cd /workspace && npm ci",
        "cd /workspace/rust && cargo +1.98.0 build --release --target x86_64-unknown-linux-gnu",
    )
)


def projected_cost_usd(
    shard_count: int, cpu: int, memory_gib: float, timeout_seconds: int,
    max_containers: int = 1, retries: int = MAX_RETRIES
) -> float:
    attempts = retries + 1
    shard_timeout = timeout_seconds + 30
    shard_hourly = cpu * CPU_RATE_PER_CORE_HOUR + memory_gib * MEMORY_RATE_PER_GIB_HOUR
    shard_cost = shard_count * attempts * shard_timeout / 3600 * shard_hourly
    controller_seconds = attempts * math.ceil(shard_count / max_containers) * shard_timeout + 300
    controller_cost = controller_seconds / 3600 * (CPU_RATE_PER_CORE_HOUR + MEMORY_RATE_PER_GIB_HOUR)
    return shard_cost + controller_cost


def projected_product_cost_usd(
    cpu: int, memory_gib: float, timeout_seconds: int, retries: int = MAX_RETRIES
) -> float:
    hourly = cpu * CPU_RATE_PER_CORE_HOUR + memory_gib * MEMORY_RATE_PER_GIB_HOUR
    return (retries + 1) * (timeout_seconds + 30) / 3600 * hourly


def projected_ordered_product_cost_usd(
    stage_one_shards: int, stage_two_shards: int, cpu: int, memory_gib: float,
    timeout_seconds: int, max_containers: int, retries: int = MAX_RETRIES
) -> float:
    attempts = retries + 1
    shard_count = stage_one_shards + stage_two_shards
    hourly = cpu * CPU_RATE_PER_CORE_HOUR + memory_gib * MEMORY_RATE_PER_GIB_HOUR
    shard_cost = shard_count * attempts * (timeout_seconds + 30) / 3600 * hourly
    waves = math.ceil(stage_one_shards / max_containers) + math.ceil(stage_two_shards / max_containers)
    controller_seconds = attempts * waves * (timeout_seconds + 30) + 3900
    return shard_cost + controller_seconds / 3600 * (CPU_RATE_PER_CORE_HOUR + 16 * MEMORY_RATE_PER_GIB_HOUR)


def _run_checked(command: list[str], label: str, **kwargs: Any) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(command, check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or "").strip() or str(error)
        if len(details) > 64 * 1024:
            details = f"[stderr tail; {len(details)} characters total]\n{details[-64 * 1024:]}"
        raise RuntimeError(f"{label} failed: {details}") from error


def _atomic_json(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as held:
        json.dump(value, held, indent=2, sort_keys=True)
        held.write("\n")
        held.flush()
        os.fsync(held.fileno())
        temporary = pathlib.Path(held.name)
    os.replace(temporary, path)
    try:
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except OSError:
        pass


def reserve_cost(run_id: str, projected: float, full_run: bool, config: dict[str, Any]) -> dict[str, Any]:
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    lock_path = LEDGER_PATH.with_suffix(".lock")
    with lock_path.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ledger = {"schemaVersion": 1, "grossBudgetUsd": GROSS_BUDGET_USD, "runs": {}}
        if LEDGER_PATH.exists():
            ledger = json.loads(LEDGER_PATH.read_text())
        existing = ledger["runs"].get(run_id)
        if existing:
            if existing["config"] != config:
                raise RuntimeError(f"run {run_id} exists with different configuration")
            return existing
        reserved = sum(float(run["reservedUsd"]) for run in ledger["runs"].values())
        full_runs = sum(bool(run["fullRun"]) for run in ledger["runs"].values())
        authorization = config.get("authorization")
        authorization_contract = ORDERED_PRODUCT_AUTHORIZATION_CONTRACTS.get(authorization)
        authorized_campaign = config.get("kind") == "ordered-product" \
            and authorization_contract is not None \
            and config.get("kingdom") == authorization_contract["kingdom"] \
            and config.get("shuffle_seeds") == authorization_contract["shuffle_seeds"]
        if authorization and not authorized_campaign:
            raise RuntimeError("authorization does not match its ordered product kingdom and seed set")
        authorized_runs = [run for run in ledger["runs"].values()
                           if run.get("config", {}).get("authorization") == authorization] \
            if authorization else []
        continuation_id = config.get("continuation_run_id")
        if authorized_runs:
            if len(authorized_runs) != 1 or not continuation_id \
                    or authorized_runs[0].get("runId") != continuation_id:
                raise RuntimeError(f"authorization {authorization} was already used")
            prior = authorized_runs[0]
            prior_actual = float(config.get("prior_actual_usd", -1))
            prior_config = prior.get("config", {})
            prior_kingdom = prior_config.get("kingdom", DEFAULT_ORDERED_PRODUCT_KINGDOM)
            if prior_config.get("kind") != "ordered-product" \
                    or prior_kingdom != config.get("kingdom") \
                    or prior_config.get("shuffle_seeds") != config.get("shuffle_seeds") \
                    or prior_actual < 0 or prior_actual > float(prior["reservedUsd"]):
                raise RuntimeError("ordered product continuation does not match the failed campaign")
            prior["reservedUsd"] = round(prior_actual, 8)
            prior["actualUsd"] = round(prior_actual, 8)
            prior["status"] = "superseded"
            reserved = sum(float(run["reservedUsd"]) for run in ledger["runs"].values())
        if reserved + projected > GROSS_BUDGET_USD:
            raise RuntimeError(
                f"cumulative reservation ${reserved + projected:.4f} exceeds ${GROSS_BUDGET_USD:.2f}"
            )
        if full_run and full_runs >= MAX_FULL_RUNS and not authorized_campaign:
            raise RuntimeError(f"full-space run limit {MAX_FULL_RUNS} is exhausted")
        entry = {
            "runId": run_id,
            "createdAt": int(time.time()),
            "reservedUsd": round(projected, 8),
            "actualUsd": 0.0,
            "fullRun": full_run,
            "status": "reserved",
            "config": config,
        }
        ledger["runs"][run_id] = entry
        _atomic_json(LEDGER_PATH, ledger)
        return entry


def claim_controller(run_id: str, controller_timeout: int) -> bool:
    lock_path = LEDGER_PATH.with_suffix(".lock")
    with lock_path.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ledger = json.loads(LEDGER_PATH.read_text())
        entry = ledger["runs"][run_id]
        now = int(time.time())
        if entry["status"] in {"launching", "launched", "complete"}:
            stale = entry["status"] == "launching" and now - entry.get("launchingAt", now) > controller_timeout
            if not stale:
                return False
        entry["status"] = "launching"
        entry["launchingAt"] = now
        _atomic_json(LEDGER_PATH, ledger)
        return True


def update_run_status(run_id: str, status: str) -> None:
    lock_path = LEDGER_PATH.with_suffix(".lock")
    with lock_path.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ledger = json.loads(LEDGER_PATH.read_text())
        ledger["runs"][run_id]["status"] = status
        _atomic_json(LEDGER_PATH, ledger)


def record_controller_call(run_id: str, call_id: str) -> None:
    lock_path = LEDGER_PATH.with_suffix(".lock")
    with lock_path.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ledger = json.loads(LEDGER_PATH.read_text())
        ledger["runs"][run_id].update({"status": "launched", "controllerCallId": call_id})
        _atomic_json(LEDGER_PATH, ledger)


def _result_hash(value: dict[str, Any]) -> str:
    held = {key: value[key] for key in ["runId", "kingdomId", "shardId", "startPosition", "endPosition",
        "completeCount", "candidateDigest", "scoreDigest", "ruleFingerprint", "scorerVersion",
        "buildVersion", "shuffleSeeds", "movementProfiles", "requestedCpu", "threads"]}
    return hashlib.sha256(json.dumps(held, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def valid_result(value: Any, spec: dict[str, Any]) -> bool:
    try:
        return (
            value["schemaVersion"] == RESULT_SCHEMA_VERSION
            and value["status"] == "success"
            and value["runId"] == spec["run_id"]
            and value["kingdomId"] == spec["kingdom"]
            and value["shardId"] == spec["shard_id"]
            and value["startPosition"] == spec["start_position"]
            and value["endPosition"] == spec["end_position"]
            and value["completeCount"] == spec["end_position"] - spec["start_position"]
            and value["ruleFingerprint"] == spec["rule_fingerprint"]
            and value["scorerVersion"] == SCORER_VERSION
            and value["buildVersion"] == spec["build_version"]
            and value["shuffleSeeds"] == spec["shuffle_seeds"]
            and value["movementProfiles"] == ["stationary", "chaser", "kiter"]
            and value["requestedCpu"] == spec["cpu"]
            and value["threads"] == spec["threads"]
            and isinstance(value["candidateDigest"], str)
            and re.fullmatch(r"[0-9a-f]{9,}", value["candidateDigest"]) is not None
            and isinstance(value["scoreDigest"], str)
            and re.fullmatch(r"[0-9a-f]{9,}", value["scoreDigest"]) is not None
            and value["resultHash"] == _result_hash(value)
        )
    except (KeyError, TypeError):
        return False


def _result_path(spec: dict[str, Any]) -> pathlib.Path:
    return pathlib.Path("/results") / spec["run_id"] / f"shard-{spec['shard_id']:06d}.json"


def _stable_hash(lines: list[str]) -> str:
    text = "\n".join(lines)
    value = 0x811C9DC5
    units = text.encode("utf-16-le")
    for index in range(0, len(units), 2):
        value ^= units[index] | (units[index + 1] << 8)
        value = (value * 0x01000193) & 0xFFFFFFFF
    return f"{value:08x}{len(units) // 2:x}"


def ordered_subprocess_timeouts(timeout_seconds: int) -> tuple[int, int]:
    generation = max(1, timeout_seconds // 3)
    scoring = max(1, timeout_seconds - generation)
    return generation, scoring


def _native_shard(spec: dict[str, Any]) -> tuple[list[dict[str, Any]], str, str, dict[str, Any]]:
    generation_timeout, scoring_timeout = ordered_subprocess_timeouts(spec["timeout_seconds"])
    with tempfile.TemporaryDirectory() as directory:
        request_path = pathlib.Path(directory) / "request.jsonl"
        metadata_path = pathlib.Path(directory) / "metadata.json"
        subprocess.run(["npx", "tsx", "scripts/native_ordered_shard_input.ts",
            "--kingdom", spec["kingdom"],
            "--start-position", str(spec["start_position"]), "--end-position", str(spec["end_position"]),
            "--threads", str(spec["threads"]), "--cpu", str(spec["cpu"]),
            "--seeds", ",".join(str(seed) for seed in spec["shuffle_seeds"]),
            "--request", str(request_path),
            "--metadata", str(metadata_path)], cwd="/workspace", text=True, capture_output=True,
            timeout=generation_timeout, check=True)
        metadata = json.loads(metadata_path.read_text())
        if metadata["kingdomId"] != spec["kingdom"] \
                or metadata["shuffleSeeds"] != spec["shuffle_seeds"] \
                or metadata["ruleFingerprint"] != spec["rule_fingerprint"]:
            raise RuntimeError("TypeScript kingdom or rule fingerprint does not match the shard specification")
        executable = "/workspace/rust/target/x86_64-unknown-linux-gnu/release/hexdeck-goldfish"
        with request_path.open() as request:
            completed = subprocess.run([executable, "--threads", str(spec["threads"]),
                "--cpu-request", str(spec["cpu"])], stdin=request, text=True, capture_output=True,
                timeout=scoring_timeout, check=True)
    response = json.loads(completed.stdout)
    if not response.get("ok"):
        raise RuntimeError(str(response.get("error")))
    scores = response["result"]["scores"]
    ranking = ["\t".join(str(score[key]) for key in ["worstCompletions", "totalCompletions",
        "worstPenalizedTurnsTo50", "totalPenalizedTurnsTo50", "worstDamageArea",
        "totalDamageArea", "totalMoneySpent"]) + "\t" + score["strategyId"] + "\t"
        + score["collisionTieKey"] for score in scores]
    return scores, metadata["candidateDigest"], _stable_hash(ranking), metadata


@app.function(image=image, cpu=4, memory=4096, timeout=3600, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def score_shard(spec: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    path = _result_path(spec)
    if path.exists():
        try:
            held = json.loads(path.read_text())
            if valid_result(held, spec):
                return held
        except (OSError, json.JSONDecodeError):
            pass
    started = time.monotonic()
    try:
        scores, candidate_digest, score_digest, metadata = _native_shard(spec)
        result = {
            "schemaVersion": RESULT_SCHEMA_VERSION,
            "status": "success",
            "runId": spec["run_id"],
            "kingdomId": spec["kingdom"],
            "shardId": spec["shard_id"],
            "startPosition": spec["start_position"],
            "endPosition": spec["end_position"],
            "completeCount": len(scores),
            "candidateDigest": candidate_digest,
            "scoreDigest": score_digest,
            "ruleFingerprint": metadata["ruleFingerprint"],
            "scorerVersion": SCORER_VERSION,
            "buildVersion": spec["build_version"],
            "shuffleSeeds": spec["shuffle_seeds"],
            "movementProfiles": ["stationary", "chaser", "kiter"],
            "requestedCpu": spec["cpu"],
            "threads": spec["threads"],
            "maxContainers": spec["max_containers"],
            "containerIdentity": os.environ.get("MODAL_TASK_ID", socket.gethostname()),
            "elapsedMs": round((time.monotonic() - started) * 1000, 3),
            "scoringPath": "standalone-rust-process",
        }
        result["resultHash"] = _result_hash(result)
        if not valid_result(result, spec):
            raise RuntimeError("shard result failed its schema and provenance check")
        _atomic_json(path, result)
        volume.commit()
        return result
    except Exception as error:
        return {
            "schemaVersion": RESULT_SCHEMA_VERSION,
            "status": "failure",
            "runId": spec["run_id"],
            "kingdomId": spec["kingdom"],
            "shardId": spec["shard_id"],
            "errorType": type(error).__name__,
            "error": str(error),
            "elapsedMs": round((time.monotonic() - started) * 1000, 3),
        }


@app.function(image=image, cpu=10, memory=8192, timeout=7200, retries=0, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def product_search(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    root = pathlib.Path("/results") / config["run_id"]
    output = root / "pool.json"
    summary_path = root / "product-summary.json"
    command = ["/usr/bin/time", "-v", "npm", "run", "staged-goldfish:native-pool", "--",
        "--count", str(config["count"]), "--chunk-size", str(config["chunk_size"]),
        "--shard-size", str(config["shard_size"]), "--threads", str(config["threads"]),
        "--pool-seed", str(config["pool_seed"]), "--out", str(output)]
    environment = {**os.environ,
        "HEXDECK_GOLDFISH_BIN": "/workspace/rust/target/x86_64-unknown-linux-gnu/release/hexdeck-goldfish",
        "HEXDECK_BUILD_VERSION": config["build_version"]}
    started = time.monotonic()
    completed = subprocess.run(command, cwd="/workspace", env=environment, text=True,
        capture_output=True, timeout=config["timeout_seconds"], check=True)
    volume.commit()
    lines = [line for line in completed.stdout.splitlines() if line.startswith("{")]
    if not lines:
        raise RuntimeError(f"product command returned no summary: {completed.stdout[-2000:]}")
    command_summary = json.loads(lines[-1])
    rss = re.search(r"Maximum resident set size \(kbytes\):\s*(\d+)", completed.stderr)
    summary = {"schemaVersion": 1, "status": "success", "runId": config["run_id"],
        "kingdomId": config["kingdom"], "buildVersion": config["build_version"],
        "ruleFingerprint": config["rule_fingerprint"],
        "scorerVersion": SCORER_VERSION, "generatedCount": config["count"],
        "prefilterCount": command_summary["prefilterCount"],
        "leaderCount": command_summary["leaderCount"], "tailCount": command_summary["tailCount"],
        "generatedHash": command_summary["generatedHash"],
        "canonicalProvenanceDigest": command_summary["canonicalProvenanceDigest"],
        "prefilterDigest": command_summary["prefilterDigest"],
        "leaderDigest": command_summary["leaderDigest"], "tailDigest": command_summary["tailDigest"],
        "elapsedMs": round((time.monotonic() - started) * 1000, 3),
        "peakRssKib": int(rss.group(1)) if rss else None,
        "requestedCpu": config["cpu"], "threads": config["threads"],
        "containerIdentity": os.environ.get("MODAL_TASK_ID", socket.gethostname()),
        "artifact": f"hexdeck-native-strategy-results:/{config['run_id']}/pool.json"}
    _atomic_json(summary_path, summary)
    volume.commit()
    return summary


def _ordered_product_checkpoint_path(config: dict[str, Any], stage: str, shard_id: int) -> pathlib.Path:
    root = _campaign_ordered_run_root(config["campaign_root"], config["run_id"]) \
        if "campaign_root" in config else pathlib.Path("/results") / config["run_id"]
    return root / stage / f"shard-{shard_id:06d}.json"


def _ordered_product_cli(config: dict[str, Any]) -> list[str]:
    return ["npx", "tsx", "scripts/ordered_goldfish_product.ts",
        "--schema-version", str(config.get("schema_version", 1)),
        "--kingdom", config["kingdom"], "--run-id", config["run_id"],
        "--build-version", config["build_version"],
        "--rule-fingerprint", config["rule_fingerprint"], "--scorer-version", SCORER_VERSION,
        "--retained-count", str(config["retained_count"]),
        "--reservoir-count", str(config["reservoir_count"]),
        "--seeds", ",".join(str(seed) for seed in config["shuffle_seeds"])]


def _valid_ordered_product_checkpoint(path: pathlib.Path, spec: dict[str, Any], stage: str) -> bool:
    if not path.exists():
        return False
    base = _ordered_product_cli(spec)
    command = base[:3] + ["validate-checkpoint"] + base[3:] + ["--checkpoint", str(path),
        "--stage", stage, "--shard-id", str(spec["shard_id"]),
        "--start-position", str(spec["start_position"]),
        "--end-position", str(spec["end_position"])]
    try:
        subprocess.run(command, cwd="/workspace", text=True, capture_output=True,
                       timeout=spec["timeout_seconds"], check=True)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def _preserve_corrupt_file(path: pathlib.Path, control_root: pathlib.Path) -> pathlib.Path:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    destination = control_root / "corrupt" / f"{path.name}.{digest}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        os.replace(path, destination)
    else:
        path.unlink()
    return destination


def _run_rust(request_path: pathlib.Path, response_path: pathlib.Path,
              threads: int, cpu: int, timeout_seconds: int, stream_scores: bool = False) -> None:
    command = [CAMPAIGN_RUST_GOLDFISH_BIN, "--threads", str(threads), "--cpu-request", str(cpu)]
    if stream_scores:
        command.append("--stream-score-batch")
    with request_path.open() as request, response_path.open("w") as response:
        try:
            subprocess.run(command, stdin=request, stdout=response, stderr=subprocess.PIPE,
                text=True, timeout=timeout_seconds, check=True)
        except subprocess.CalledProcessError as error:
            details = (error.stderr or "").strip()
            if len(details) > 64 * 1024:
                details = f"[stderr tail; {len(details)} characters total]\n{details[-64 * 1024:]}"
            raise RuntimeError(f"native Goldfish scorer failed: {details or error}") from error


def _campaign_stage_one_ranges(start: int, end: int,
                               chunk_size: int = CAMPAIGN_STAGE_ONE_CHUNK_SIZE) -> list[tuple[int, int]]:
    if not all(isinstance(value, int) for value in [start, end, chunk_size]) \
            or start < 0 or end <= start or chunk_size < 1:
        raise ValueError("campaign stage-one chunk bounds are invalid")
    return [(position, min(position + chunk_size, end)) for position in range(start, end, chunk_size)]


def _remaining_stage_seconds(deadline: float) -> int:
    remaining = math.floor(deadline - time.monotonic())
    if remaining < 1:
        raise TimeoutError("campaign Goldfish stage-one authorized timeout elapsed")
    return remaining


def _valid_stage_one_chunk_metadata(path: pathlib.Path, checkpoint: pathlib.Path,
                                    spec: dict[str, Any], prior_digest: str | None) -> str | None:
    try:
        value = json.loads(path.read_text())
        held = json.loads(checkpoint.read_text())
    except (OSError, ValueError):
        return None
    keys = {"schemaVersion", "kingdomId", "startPosition", "endPosition", "completeCount",
        "priorCandidateDigest", "candidateDigest", "ruleFingerprint", "shuffleSeeds", "cpu", "threads",
        "firstCanonical", "lastCanonical"}
    if not isinstance(value, dict) or not isinstance(held, dict) or set(value) != keys \
            or value.get("schemaVersion") != spec.get("schema_version", 1) \
            or value.get("kingdomId") != spec["kingdom"] or value.get("startPosition") != spec["start_position"] \
            or value.get("endPosition") != spec["end_position"] \
            or value.get("completeCount") != spec["end_position"] - spec["start_position"] \
            or value.get("priorCandidateDigest") != prior_digest \
            or not isinstance(value.get("candidateDigest"), str) \
            or not re.fullmatch(r"[0-9a-f]{9,16}", value["candidateDigest"]) \
            or value.get("ruleFingerprint") != spec["rule_fingerprint"] \
            or value.get("shuffleSeeds") != [spec["shuffle_seeds"][0]] \
            or held.get("shard", {}).get("candidateDigest") != value.get("candidateDigest"):
        return None
    return value["candidateDigest"]


@app.function(image=image, cpu=4, memory=4096, timeout=7200, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def ordered_product_stage_one(spec: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    if "source_image" in spec:
        verify_campaign_source_image(spec["source_image"])
    output = _ordered_product_checkpoint_path(spec, "stage-one", spec["shard_id"])
    if _valid_ordered_product_checkpoint(output, spec, "stage-one"):
        work = pathlib.Path(f"{output}.work")
        if work.exists():
            shutil.rmtree(work)
            volume.commit()
        held = json.loads(output.read_text())
        return {"status": "success", "stage": "stage-one", "shardId": spec["shard_id"],
                "contentDigest": held["contentDigest"], "reused": True}
    for corrupt in [output, pathlib.Path(f"{output}.records.jsonl")]:
        if corrupt.exists():
            _preserve_corrupt_file(corrupt, output.parent.parent / "control")
    started = time.monotonic()
    deadline = started + spec["timeout_seconds"]
    work = pathlib.Path(f"{output}.work")
    work.mkdir(parents=True, exist_ok=True)
    memory_mib = spec.get("memory_mib", spec.get("memory_gib", 4) * 1024)
    node_environment = {**os.environ, "NODE_OPTIONS":
        f"--max-old-space-size={max(256, math.floor(memory_mib * 0.75))}"}
    aggregates = []
    for slot in range(2):
        checkpoint = work / f"aggregate-{slot}.json"
        metadata = work / f"aggregate-{slot}.metadata.json"
        try:
            held_metadata = json.loads(metadata.read_text())
            aggregate_end = held_metadata["endPosition"]
        except (OSError, ValueError, KeyError, TypeError):
            aggregate_end = None
        aggregate_spec = {**spec, "shard_id": 0, "start_position": spec["start_position"],
            "end_position": aggregate_end, "timeout_seconds": _remaining_stage_seconds(deadline)}
        digest = _valid_stage_one_chunk_metadata(metadata, checkpoint, aggregate_spec, None) \
            if isinstance(aggregate_end, int) and spec["start_position"] < aggregate_end < spec["end_position"] \
            and _valid_ordered_product_checkpoint(checkpoint, aggregate_spec, "stage-one") else None
        if digest is not None:
            aggregates.append((aggregate_end, checkpoint, metadata, digest))
        elif checkpoint.exists() or metadata.exists() or pathlib.Path(f"{checkpoint}.records.jsonl").exists():
            for corrupt in [checkpoint, pathlib.Path(f"{checkpoint}.records.jsonl"), metadata]:
                if corrupt.exists():
                    _preserve_corrupt_file(corrupt, output.parent.parent / "control")
    current = max(aggregates, default=None, key=lambda entry: entry[0])
    current_end = current[0] if current else spec["start_position"]
    for start, end in _campaign_stage_one_ranges(current_end, spec["end_position"]):
        with tempfile.TemporaryDirectory() as directory:
            temporary = pathlib.Path(directory)
            request, response = temporary / "request.jsonl", temporary / "response.json"
            chunk_metadata, chunk_checkpoint = temporary / "metadata.json", temporary / "checkpoint.json"
            prior_digest = current[3] if current else None
            input_command = ["npx", "tsx", "scripts/native_ordered_shard_input.ts",
                "--schema-version", str(spec.get("schema_version", 1)), "--kingdom", spec["kingdom"],
                "--start-position", str(start), "--end-position", str(end),
                "--threads", str(spec["threads"]), "--cpu", str(spec["cpu"]),
                "--seeds", str(spec["shuffle_seeds"][0]), "--mode", "full",
                "--request", str(request), "--metadata", str(chunk_metadata)]
            if prior_digest is not None:
                input_command += ["--candidate-digest", prior_digest]
            _run_checked(input_command, "campaign bounded stage-one input", cwd="/workspace",
                env=node_environment, text=True, capture_output=True,
                timeout=_remaining_stage_seconds(deadline))
            _run_rust(request, response, spec["threads"], spec["cpu"],
                _remaining_stage_seconds(deadline))
            checkpoint_command = ["npx", "tsx", "scripts/ordered_goldfish_product.ts",
                "stage-one-checkpoint", "--request", str(request), "--response", str(response),
                "--metadata", str(chunk_metadata), "--out", str(chunk_checkpoint),
                "--shard-id", "1" if current else "0", "--start-position", str(start),
                "--end-position", str(end)] + _ordered_product_cli(spec)[3:]
            _run_checked(checkpoint_command, "campaign bounded stage-one checkpoint", cwd="/workspace",
                env=node_environment, text=True, capture_output=True,
                timeout=_remaining_stage_seconds(deadline))
            manifest = temporary / "manifest.json"
            entries = ([{"checkpoint": str(current[1]), "metadata": str(current[2])}]
                if current else []) + [{"checkpoint": str(chunk_checkpoint), "metadata": str(chunk_metadata)}]
            _atomic_json(manifest, entries)
            final = end == spec["end_position"]
            next_slot = 0 if current is None or current[1].name == "aggregate-1.json" else 1
            merged = output if final else work / f"aggregate-{next_slot}.json"
            merged_metadata = temporary / "merged.metadata.json" if final \
                else work / f"aggregate-{next_slot}.metadata.json"
            merge_command = ["npx", "tsx", "scripts/ordered_goldfish_product.ts",
                "stage-one-merge-shard", "--manifest", str(manifest), "--out", str(merged),
                "--metadata-out", str(merged_metadata), "--shard-id", str(spec["shard_id"] if final else 0),
                "--start-position", str(spec["start_position"]), "--end-position", str(end)]
            merge_command += _ordered_product_cli(spec)[3:]
            _run_checked(merge_command, "campaign bounded stage-one merge", cwd="/workspace",
                env=node_environment, text=True, capture_output=True,
                timeout=_remaining_stage_seconds(deadline))
            merged_spec = {**spec, "shard_id": spec["shard_id"] if final else 0,
                "start_position": spec["start_position"], "end_position": end,
                "timeout_seconds": _remaining_stage_seconds(deadline)}
            if not _valid_ordered_product_checkpoint(merged, merged_spec, "stage-one"):
                raise RuntimeError("new bounded stage-one aggregate failed validation")
            digest = _valid_stage_one_chunk_metadata(merged_metadata, merged, merged_spec, None)
            if digest is None:
                raise RuntimeError("new bounded stage-one aggregate metadata failed validation")
            volume.commit()
            current = (end, merged, merged_metadata, digest)
    if not _valid_ordered_product_checkpoint(output, spec, "stage-one"):
        raise RuntimeError("new stage-one checkpoint failed validation")
    shutil.rmtree(work)
    volume.commit()
    held = json.loads(output.read_text())
    return {"status": "success", "stage": "stage-one", "shardId": spec["shard_id"],
            "contentDigest": held["contentDigest"], "reused": False,
            "elapsedMs": round((time.monotonic() - started) * 1000, 3),
            "containerIdentity": os.environ.get("MODAL_TASK_ID", socket.gethostname())}


@app.function(image=image, cpu=4, memory=4096, timeout=7200, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def ordered_product_stage_two(spec: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    if "source_image" in spec:
        verify_campaign_source_image(spec["source_image"])
    output = _ordered_product_checkpoint_path(spec, "stage-two", spec["shard_id"])
    if _valid_ordered_product_checkpoint(output, spec, "stage-two"):
        held = json.loads(output.read_text())
        return {"status": "success", "stage": "stage-two", "shardId": spec["shard_id"],
                "contentDigest": held["contentDigest"], "reused": True}
    for corrupt in [output, pathlib.Path(f"{output}.records.jsonl")]:
        if corrupt.exists():
            _preserve_corrupt_file(corrupt, output.parent.parent / "control")
    root = _campaign_ordered_run_root(spec["campaign_root"], spec["run_id"]) \
        if "campaign_root" in spec else pathlib.Path("/results") / spec["run_id"]
    cohort = root / "stage-one-cohort.json"
    started = time.monotonic()
    deadline = started + spec["timeout_seconds"]
    memory_mib = spec.get("memory_mib", spec.get("memory_gib", 4) * 1024)
    node_environment = {**os.environ, "NODE_OPTIONS":
        f"--max-old-space-size={max(256, math.floor(memory_mib * 0.75))}"}
    with tempfile.TemporaryDirectory() as directory:
        request = pathlib.Path(directory) / "request.jsonl"
        response = pathlib.Path(directory) / "response.ndjson"
        metadata = pathlib.Path(directory) / "metadata.json"
        input_command = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "stage-two-input",
            "--cohort", str(cohort), "--start-position", str(spec["start_position"]),
            "--end-position", str(spec["end_position"]), "--threads", str(spec["threads"]),
            "--request", str(request), "--metadata", str(metadata)] + _ordered_product_cli(spec)[3:]
        _run_checked(input_command, "campaign bounded stage-two input", cwd="/workspace",
            env=node_environment, text=True, capture_output=True,
            timeout=_remaining_stage_seconds(deadline))
        _run_rust(request, response, spec["threads"], spec["cpu"],
            _remaining_stage_seconds(deadline), stream_scores=True)
        command = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "stage-two-checkpoint",
            "--cohort", str(cohort), "--response", str(response), "--metadata", str(metadata),
            "--out", str(output), "--shard-id", str(spec["shard_id"]),
            "--start-position", str(spec["start_position"]), "--end-position", str(spec["end_position"])]
        command += _ordered_product_cli(spec)[3:]
        _run_checked(command, "campaign bounded stage-two checkpoint", cwd="/workspace",
            env=node_environment, text=True, capture_output=True,
            timeout=_remaining_stage_seconds(deadline))
    if not _valid_ordered_product_checkpoint(output, spec, "stage-two"):
        raise RuntimeError("new stage-two checkpoint failed validation")
    volume.commit()
    held = json.loads(output.read_text())
    return {"status": "success", "stage": "stage-two", "shardId": spec["shard_id"],
            "contentDigest": held["contentDigest"], "reused": False,
            "elapsedMs": round((time.monotonic() - started) * 1000, 3),
            "containerIdentity": os.environ.get("MODAL_TASK_ID", socket.gethostname())}


def _run_product_stage(function: Any, specs: list[dict[str, Any]], config: dict[str, Any]) -> list[dict[str, Any]]:
    completed: dict[int, dict[str, Any]] = {}
    remote = function.with_options(cpu=config["cpu"], memory=config["memory_gib"] * 1024,
        timeout=config["timeout_seconds"] + 30, max_containers=config["max_containers"], retries=0)
    for attempt in range(MAX_RETRIES + 1):
        pending = [spec for spec in specs if spec["shard_id"] not in completed]
        if not pending:
            break
        replies = list(remote.map(pending, order_outputs=False, return_exceptions=True))
        for reply in replies:
            if isinstance(reply, dict) and reply.get("status") == "success":
                completed[reply["shardId"]] = reply
        if len(completed) < len(specs) and attempt < MAX_RETRIES:
            time.sleep(min(30, 2 ** attempt))
    if len(completed) != len(specs):
        raise RuntimeError(f"{len(specs) - len(completed)} ordered product shards failed")
    return [completed[index] for index in range(len(specs))]


@app.function(image=image, cpu=1, memory=16384, timeout=86400, volumes={"/results": volume})
def ordered_product_controller(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    root = pathlib.Path("/results") / config["run_id"]
    started = time.monotonic()
    stage_one_specs = [{**config, "shard_id": shard_id, "start_position": start,
        "end_position": min(start + config["shard_size"], FULL_CANDIDATE_COUNT)}
        for shard_id, start in enumerate(range(0, FULL_CANDIDATE_COUNT, config["shard_size"]))]
    stage_one_results = _run_product_stage(ordered_product_stage_one, stage_one_specs, config)
    volume.reload()
    stage_one_manifest = root / "stage-one-manifest.json"
    _atomic_json(stage_one_manifest, [str(_ordered_product_checkpoint_path(config, "stage-one", spec["shard_id"]))
                                      for spec in stage_one_specs])
    cohort = root / "stage-one-cohort.json"
    merge = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "merge-stage-one",
        "--manifest", str(stage_one_manifest), "--out", str(cohort)] + _ordered_product_cli(config)[3:]
    node_environment = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=12288"}
    _run_checked(merge, "stage-one merge", cwd="/workspace", env=node_environment,
                 text=True, capture_output=True, timeout=1800)
    volume.commit()
    stage_two_specs = [{**config, "shard_id": shard_id, "start_position": start,
        "end_position": min(start + config["shard_size"], config["retained_count"])}
        for shard_id, start in enumerate(range(0, config["retained_count"], config["shard_size"]))]
    stage_two_results = _run_product_stage(ordered_product_stage_two, stage_two_specs, config)
    volume.reload()
    stage_two_manifest = root / "stage-two-manifest.json"
    _atomic_json(stage_two_manifest, [str(_ordered_product_checkpoint_path(config, "stage-two", spec["shard_id"]))
                                      for spec in stage_two_specs])
    artifact = root / "ranked.json"
    finalize = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "finalize",
        "--cohort", str(cohort), "--manifest", str(stage_two_manifest), "--out", str(artifact)] \
        + _ordered_product_cli(config)[3:]
    _run_checked(finalize, "ordered-product finalize", cwd="/workspace", env=node_environment,
                 text=True, capture_output=True, timeout=1800)
    summary = {"schemaVersion": 1, "status": "success", "runId": config["run_id"],
        "kingdomId": config["kingdom"], "buildVersion": config["build_version"],
        "ruleFingerprint": config["rule_fingerprint"],
        "scorerVersion": SCORER_VERSION, "retainedCount": config["retained_count"],
        "reservoirCount": config["reservoir_count"], "shuffleSeeds": config["shuffle_seeds"],
        "stageOneShards": stage_one_results,
        "stageTwoShards": stage_two_results, "elapsedMs": round((time.monotonic() - started) * 1000, 3),
        "containerIdentity": os.environ.get("MODAL_TASK_ID", socket.gethostname()),
        "artifact": f"hexdeck-native-strategy-results:/{config['run_id']}/ranked.json"}
    _atomic_json(root / "run-summary.json", summary)
    volume.commit()
    return summary


@app.function(image=image, cpu=1, memory=1024, timeout=86400, volumes={"/results": volume})
def controller(config: dict[str, Any]) -> dict[str, Any]:
    specs = []
    for shard_id, start in enumerate(range(config["start_position"], config["end_position"], config["shard_size"])):
        specs.append({
            **config,
            "shard_id": shard_id,
            "start_position": start,
            "end_position": min(start + config["shard_size"], config["end_position"]),
        })
    completed: dict[int, dict[str, Any]] = {}
    pending = specs
    shard_function = score_shard.with_options(
        cpu=config["cpu"], memory=config["memory_gib"] * 1024,
        timeout=config["timeout_seconds"] + 30, max_containers=config["max_containers"], retries=0,
    )
    for attempt in range(MAX_RETRIES + 1):
        if not pending:
            break
        replies = list(shard_function.map(pending, order_outputs=False, return_exceptions=True))
        by_id = {spec["shard_id"]: spec for spec in pending}
        for reply in replies:
            if isinstance(reply, BaseException) or not isinstance(reply, dict):
                continue
            shard_id = reply.get("shardId")
            spec = by_id.get(shard_id)
            if spec and valid_result(reply, spec):
                completed[shard_id] = reply
        pending = [spec for spec in specs if spec["shard_id"] not in completed]
        if pending and attempt < MAX_RETRIES:
            time.sleep(min(30, 2 ** attempt))
    if pending:
        raise RuntimeError(f"{len(pending)} shards failed after {MAX_RETRIES + 1} attempts")
    ordered = [completed[index] for index in range(len(specs))]
    if any(left["endPosition"] != right["startPosition"] for left, right in zip(ordered, ordered[1:])):
        raise RuntimeError("merged shard ranges are not contiguous")
    merge = {
        "schemaVersion": 1,
        "status": "success",
        "runId": config["run_id"],
        "kingdomId": config["kingdom"],
        "buildVersion": config["build_version"],
        "ruleFingerprint": config["rule_fingerprint"],
        "scorerVersion": SCORER_VERSION,
        "completeCount": sum(item["completeCount"] for item in ordered),
        "candidateDigests": [item["candidateDigest"] for item in ordered],
        "scoreDigests": [item["scoreDigest"] for item in ordered],
        "shards": [{"shardId": item["shardId"], "startPosition": item["startPosition"],
                    "endPosition": item["endPosition"], "containerIdentity": item["containerIdentity"]}
                   for item in ordered],
    }
    merge_path = pathlib.Path("/results") / config["run_id"] / "merge.json"
    _atomic_json(merge_path, merge)
    volume.commit()
    return merge


def adaptive_competitive_shards(
    candidate_count: int, schedule_count: int, max_containers: int,
    target_blocks: int = COMPETITIVE_TARGET_BLOCKS
) -> list[dict[str, int]]:
    if min(candidate_count, schedule_count, max_containers, target_blocks) < 1:
        raise ValueError("competitive shard dimensions must be positive")
    desired = min(max_containers, math.ceil(candidate_count * schedule_count / target_blocks))
    if candidate_count >= desired:
        candidate_span = math.ceil(candidate_count / desired)
        schedule_span = schedule_count
    else:
        candidate_span = 1
        schedule_waves = max(1, math.ceil(desired / candidate_count))
        schedule_span = math.ceil(schedule_count / schedule_waves)
    shards = []
    for candidate_start in range(0, candidate_count, candidate_span):
        for schedule_start in range(0, schedule_count, schedule_span):
            shards.append({
                "shard_id": len(shards),
                "candidate_start": candidate_start,
                "candidate_end": min(candidate_count, candidate_start + candidate_span),
                "schedule_start": schedule_start,
                "schedule_end": min(schedule_count, schedule_start + schedule_span),
            })
    return shards


def _competitive_input_hash(value: dict[str, Any]) -> str:
    held = {key: value[key] for key in value if key != "inputHash"}
    return hashlib.sha256(json.dumps(held, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_competitive_input(value: Any) -> dict[str, Any]:
    try:
        payload = value["loadRequest"]["payload"]
        schedule = value["schedule"]
        valid = (
            value["schemaVersion"] == 1
            and value["loadRequest"]["type"] == "load_competitive"
            and payload["protocolVersion"] == 1
            and payload["scorerVersion"] == COMPETITIVE_SCORER_VERSION
            and payload["startingDraftEnabled"] is False
            and isinstance(payload["strategies"], list)
            and value["candidateCount"] > 0
            and value["candidateCount"] <= len(payload["strategies"])
            and isinstance(schedule, list) and len(schedule) > 0
            and all(isinstance(block["seed"], int) and block["seed"] >= 0
                    and isinstance(block["opponentIndex"], int)
                    and 0 <= block["opponentIndex"] < len(payload["strategies"])
                    for block in schedule)
            and re.fullmatch(r"[A-Za-z0-9._-]+", value["lookId"]) is not None
            and value["inputHash"] == _competitive_input_hash(value)
        )
        if not valid:
            raise ValueError("competitive input failed its schema or digest check")
        return value
    except (KeyError, TypeError, ValueError) as error:
        if isinstance(error, ValueError):
            raise
        raise ValueError("competitive input failed its schema or digest check") from error


def projected_competitive_cost_usd(
    candidate_count: int, schedule_count: int, cpu: int, memory_gib: int,
    timeout_seconds: int, max_containers: int, target_blocks: int = COMPETITIVE_TARGET_BLOCKS
) -> float:
    shards = adaptive_competitive_shards(
        candidate_count, schedule_count, max_containers, target_blocks)
    return projected_cost_usd(len(shards), cpu, memory_gib, timeout_seconds, max_containers)


def validate_competitive_launch(
    *, candidate_count: int, schedule_count: int, cpu: int, memory_gib: int,
    threads: int, max_containers: int, timeout_seconds: int, max_cost_usd: float,
    target_blocks: int = COMPETITIVE_TARGET_BLOCKS
) -> dict[str, Any]:
    if min(candidate_count, schedule_count, cpu, memory_gib, threads,
           max_containers, timeout_seconds, target_blocks) < 1:
        raise ValueError("competitive counts and resource limits must be positive")
    if threads > cpu:
        raise ValueError("Rust threads cannot exceed the CPU request")
    if max_containers > 48 or 1 + cpu * max_containers > MAX_PHYSICAL_CORES:
        raise ValueError("competitive fleet exceeds the 48-container or physical-core limit")
    if max_cost_usd > COMPETITIVE_RUN_CAP_USD:
        raise ValueError(f"competitive run cap cannot exceed ${COMPETITIVE_RUN_CAP_USD:.0f}")
    projected = projected_competitive_cost_usd(candidate_count, schedule_count, cpu,
        memory_gib, timeout_seconds, max_containers, target_blocks)
    if projected > max_cost_usd:
        raise ValueError(f"worst-case cost ${projected:.4f} exceeds run cap ${max_cost_usd:.4f}")
    shards = adaptive_competitive_shards(candidate_count, schedule_count,
        max_containers, target_blocks)
    waves = math.ceil(len(shards) / max_containers)
    return {"projected": projected, "shards": shards,
            "controller_timeout": (MAX_RETRIES + 1) * waves * (timeout_seconds + 30) + 300,
            "aggregate_cpu": 1 + cpu * max_containers}


def _competitive_artifact_path(spec: dict[str, Any]) -> pathlib.Path:
    return pathlib.Path("/results") / spec["run_id"] / "looks" / spec["look_id"] \
        / f"shard-{spec['shard_id']:06d}.hps"


def _competitive_artifact_digest(header: dict[str, Any], payload: bytes) -> str:
    held = {key: header[key] for key in header if key != "digest"}
    encoded = json.dumps(held, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded + payload).hexdigest()


def _write_competitive_artifact(
    path: pathlib.Path, header: dict[str, Any], score_bytes: bytes, played: bytes
) -> None:
    if len(score_bytes) != len(played):
        raise ValueError("competitive score and played byte lengths differ")
    payload = score_bytes + played
    value = {**header, "scoreCount": len(score_bytes)}
    value["digest"] = _competitive_artifact_digest(value, payload)
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("wb", dir=path.parent, delete=False) as held:
        held.write(COMPETITIVE_ARTIFACT_MAGIC)
        held.write(struct.pack(">I", len(encoded)))
        held.write(encoded)
        held.write(payload)
        held.flush()
        os.fsync(held.fileno())
        temporary = pathlib.Path(held.name)
    os.replace(temporary, path)


def _read_competitive_artifact(path: pathlib.Path) -> tuple[dict[str, Any], bytes, bytes]:
    raw = path.read_bytes()
    if len(raw) < 8 or raw[:4] != COMPETITIVE_ARTIFACT_MAGIC:
        raise ValueError("competitive artifact magic is invalid")
    header_length = struct.unpack(">I", raw[4:8])[0]
    header = json.loads(raw[8:8 + header_length])
    payload = raw[8 + header_length:]
    score_count = header["scoreCount"]
    if len(payload) != score_count * 2:
        raise ValueError("competitive artifact byte length is invalid")
    if header["digest"] != _competitive_artifact_digest(header, payload):
        raise ValueError("competitive artifact digest is invalid")
    return header, payload[:score_count], payload[score_count:]


def valid_competitive_artifact(path: pathlib.Path, spec: dict[str, Any]) -> bool:
    try:
        header, scores, played = _read_competitive_artifact(path)
        expected = (spec["candidate_end"] - spec["candidate_start"]) \
            * (spec["schedule_end"] - spec["schedule_start"])
        return (
            header["schemaVersion"] == 1
            and header["runId"] == spec["run_id"]
            and header["lookId"] == spec["look_id"]
            and header["inputHash"] == spec["input_hash"]
            and header["shardId"] == spec["shard_id"]
            and header["candidateStart"] == spec["candidate_start"]
            and header["candidateEnd"] == spec["candidate_end"]
            and header["scheduleStart"] == spec["schedule_start"]
            and header["scheduleEnd"] == spec["schedule_end"]
            and header["scoreCount"] == expected
            and all(score <= 4 for score in scores)
            and all(value == 2 for value in played)
        )
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return False


def assemble_competitive_artifacts(
    artifacts: list[tuple[pathlib.Path, dict[str, Any]]], output: pathlib.Path,
    candidate_count: int, schedule_count: int, header: dict[str, Any]
) -> str:
    total = candidate_count * schedule_count
    scores = bytearray(total)
    played = bytearray(total)
    seen = bytearray(total)
    for path, spec in artifacts:
        if not valid_competitive_artifact(path, spec):
            raise ValueError(f"invalid competitive shard artifact {path}")
        _, shard_scores, shard_played = _read_competitive_artifact(path)
        source = 0
        for candidate in range(spec["candidate_start"], spec["candidate_end"]):
            for schedule in range(spec["schedule_start"], spec["schedule_end"]):
                target = candidate * schedule_count + schedule
                if seen[target]:
                    raise ValueError("competitive shard artifacts overlap")
                scores[target] = shard_scores[source]
                played[target] = shard_played[source]
                seen[target] = 1
                source += 1
    if not all(seen):
        raise ValueError("competitive shard artifacts do not cover the complete look")
    _write_competitive_artifact(output, header, bytes(scores), bytes(played))
    complete_header, _, _ = _read_competitive_artifact(output)
    return complete_header["digest"]


_competitive_process: subprocess.Popen[str] | None = None
_competitive_process_key = ""


def _competitive_request(request: dict[str, Any], process_key: str,
                         threads: int, cpu: int) -> dict[str, Any]:
    global _competitive_process, _competitive_process_key
    if _competitive_process is None or _competitive_process.poll() is not None \
            or _competitive_process_key != process_key:
        if _competitive_process is not None and _competitive_process.poll() is None:
            _competitive_process.terminate()
            _competitive_process.wait(timeout=10)
        executable = "/workspace/rust/target/x86_64-unknown-linux-gnu/release/hexdeck-goldfish"
        _competitive_process = subprocess.Popen(
            [executable, "--threads", str(threads), "--cpu-request", str(cpu)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1)
        _competitive_process_key = process_key
    assert _competitive_process.stdin is not None and _competitive_process.stdout is not None
    _competitive_process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
    _competitive_process.stdin.flush()
    response_line = _competitive_process.stdout.readline()
    if not response_line:
        stderr = _competitive_process.stderr.read() if _competitive_process.stderr else ""
        raise RuntimeError(f"competitive Rust process returned no response: {stderr[-2000:]}")
    response = json.loads(response_line)
    if not response.get("ok"):
        raise RuntimeError(str(response.get("error")))
    return response["result"]


@app.function(image=image, cpu=1, memory=1024, timeout=300, volumes={"/results": volume})
def stage_competitive_input(run_id: str, content: str, expected_hash: str) -> dict[str, Any]:
    value = validate_competitive_input(json.loads(content))
    if value["inputHash"] != expected_hash:
        raise ValueError("staged competitive input hash differs from launch hash")
    path = pathlib.Path("/results") / run_id / "competitive-input.json"
    _atomic_json(path, value)
    volume.commit()
    return {"inputHash": value["inputHash"], "candidateCount": value["candidateCount"],
            "scheduleCount": len(value["schedule"])}


@app.function(image=image, cpu=4, memory=4096, timeout=3600, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def competitive_score_shard(spec: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    output = _competitive_artifact_path(spec)
    if valid_competitive_artifact(output, spec):
        header, _, _ = _read_competitive_artifact(output)
        return {"status": "success", "shardId": spec["shard_id"],
                "digest": header["digest"], "reused": True}
    input_path = pathlib.Path("/results") / spec["run_id"] / "competitive-input.json"
    value = validate_competitive_input(json.loads(input_path.read_text()))
    if value["inputHash"] != spec["input_hash"] or value["lookId"] != spec["look_id"]:
        raise RuntimeError("competitive shard input does not match its specification")
    process_key = hashlib.sha256(json.dumps(value["loadRequest"], sort_keys=True).encode()).hexdigest()
    _competitive_request(value["loadRequest"], process_key, spec["threads"], spec["cpu"])
    blocks = []
    for candidate_index in range(spec["candidate_start"], spec["candidate_end"]):
        for schedule_index in range(spec["schedule_start"], spec["schedule_end"]):
            held = value["schedule"][schedule_index]
            blocks.append({"candidateIndex": candidate_index,
                           "opponentIndex": held["opponentIndex"], "seed": held["seed"]})
    started = time.monotonic()
    result = _competitive_request({"type": "score_competitive", "payload": {
        "loadId": value["loadRequest"]["payload"]["loadId"], "blocks": blocks}},
        process_key, spec["threads"], spec["cpu"])
    if result["aborts"]:
        raise RuntimeError("competitive shard returned an abort")
    scores = bytes(result["scoreBytes"])
    played = bytes(result["played"])
    header = {"schemaVersion": 1, "runId": spec["run_id"], "lookId": spec["look_id"],
        "inputHash": spec["input_hash"], "shardId": spec["shard_id"],
        "candidateStart": spec["candidate_start"], "candidateEnd": spec["candidate_end"],
        "scheduleStart": spec["schedule_start"], "scheduleEnd": spec["schedule_end"],
        "scorerVersion": COMPETITIVE_SCORER_VERSION, "requestedCpu": spec["cpu"],
        "threads": spec["threads"], "elapsedMs": round((time.monotonic() - started) * 1000, 3)}
    _write_competitive_artifact(output, header, scores, played)
    if not valid_competitive_artifact(output, spec):
        raise RuntimeError("competitive shard artifact failed validation")
    volume.commit()
    held, _, _ = _read_competitive_artifact(output)
    return {"status": "success", "shardId": spec["shard_id"],
            "digest": held["digest"], "reused": False,
            "containerIdentity": os.environ.get("MODAL_TASK_ID", socket.gethostname())}


@app.function(image=image, cpu=1, memory=1024, timeout=86400, volumes={"/results": volume})
def competitive_controller(config: dict[str, Any]) -> dict[str, Any]:
    specs = [{**config, **shard} for shard in adaptive_competitive_shards(
        config["candidate_count"], config["schedule_count"], config["max_containers"],
        config["target_blocks"])]
    completed: dict[int, dict[str, Any]] = {}
    remote = competitive_score_shard.with_options(cpu=config["cpu"],
        memory=config["memory_gib"] * 1024, timeout=config["timeout_seconds"] + 30,
        max_containers=config["max_containers"], retries=0)
    for attempt in range(MAX_RETRIES + 1):
        pending = [spec for spec in specs if spec["shard_id"] not in completed]
        if not pending:
            break
        for reply in remote.map(pending, order_outputs=False, return_exceptions=True):
            if isinstance(reply, dict) and reply.get("status") == "success":
                completed[reply["shardId"]] = reply
        if len(completed) < len(specs) and attempt < MAX_RETRIES:
            time.sleep(min(30, 2 ** attempt))
    if len(completed) != len(specs):
        raise RuntimeError(f"{len(specs) - len(completed)} competitive shards failed")
    ordered = [completed[index] for index in range(len(specs))]
    volume.reload()
    root = pathlib.Path("/results") / config["run_id"] / "looks" / config["look_id"]
    complete_path = root / "complete.hps"
    complete_digest = assemble_competitive_artifacts(
        [(_competitive_artifact_path(spec), spec) for spec in specs], complete_path,
        config["candidate_count"], config["schedule_count"],
        {"schemaVersion": 1, "runId": config["run_id"], "lookId": config["look_id"],
         "inputHash": config["input_hash"], "candidateCount": config["candidate_count"],
         "scheduleCount": config["schedule_count"], "buildVersion": config["build_version"],
         "ruleFingerprint": config["rule_fingerprint"], "requestedCpu": config["cpu"],
         "threads": config["threads"], "scorerVersion": COMPETITIVE_SCORER_VERSION})
    manifest = {"schemaVersion": 1, "status": "success", "runId": config["run_id"],
        "lookId": config["look_id"], "inputHash": config["input_hash"],
        "candidateCount": config["candidate_count"], "scheduleCount": config["schedule_count"],
        "completeDigest": complete_digest,
        "completeArtifact": f"hexdeck-native-strategy-results:/{config['run_id']}/looks/{config['look_id']}/complete.hps",
        "shards": [{**spec, "digest": ordered[index]["digest"]}
                   for index, spec in enumerate(specs)]}
    path = root / "manifest.json"
    _atomic_json(path, manifest)
    volume.commit()
    return manifest


def _campaign_root(relative: str) -> pathlib.Path:
    if not isinstance(relative, str) or not relative or relative.startswith("/") or "\\" in relative \
            or any(part in {"", ".", ".."} for part in relative.split("/")):
        raise ValueError("campaign root must be a normalized relative Volume path")
    results = pathlib.Path("/results").resolve()
    root = (results / relative).resolve()
    if root == results or results not in root.parents:
        raise ValueError("campaign root escapes the Modal Volume")
    return root


def _campaign_ordered_run_root(campaign_root: str, run_id: str) -> pathlib.Path:
    root = _campaign_root(campaign_root)
    if not isinstance(run_id, str) or not run_id or run_id.startswith("/") or "\\" in run_id \
            or any(part in {"", ".", ".."} for part in run_id.split("/")):
        raise ValueError("campaign ordered run ID must be a normalized relative Volume path")
    destination = (pathlib.Path("/results") / run_id).resolve()
    if destination != root and root not in destination.parents:
        raise ValueError("campaign ordered run ID escapes its deterministic campaign root")
    return destination


def _campaign_path(campaign_root: str, relative: str) -> pathlib.Path:
    root = _campaign_root(campaign_root)
    if not isinstance(relative, str) or not relative or relative.startswith("/") or "\\" in relative \
            or any(part in {"", ".", ".."} for part in relative.split("/")):
        raise ValueError("campaign artifact path must be normalized and relative")
    destination = (root / relative).resolve()
    if root not in destination.parents:
        raise ValueError("campaign artifact path escapes its deterministic root")
    return destination


def _reject_campaign_symlinks(root: pathlib.Path) -> None:
    if not root.exists():
        return
    for directory, names, files in os.walk(root, followlinks=False):
        for name in [*names, *files]:
            held = pathlib.Path(directory) / name
            if held.is_symlink():
                raise ValueError(f"campaign path contains a symlink: {held}")


def _campaign_source_digest(files: list[dict[str, Any]],
                            workspace: pathlib.Path = pathlib.Path("/workspace")) -> str:
    lines = []
    seen = set()
    for entry in sorted(files, key=lambda item: item["path"]):
        relative = entry["path"]
        if relative in seen or relative.startswith("/") or "\\" in relative \
                or any(part in {"", ".", ".."} for part in relative.split("/")):
            raise ValueError("campaign source-image path is invalid or duplicated")
        seen.add(relative)
        source = workspace / relative
        content = source.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if len(content) != entry["bytes"] or digest != entry["sha256"]:
            raise RuntimeError(f"campaign source-image file differs: {relative}")
        lines.append(f"{relative}\0{len(content)}\0{digest}\n")
    return hashlib.sha256("".join(lines).encode()).hexdigest()


def verify_campaign_source_image(identity: dict[str, Any]) -> None:
    if set(identity) != {"gitVersion", "digest", "files"} \
            or not re.fullmatch(r"[0-9a-f]{64}", identity["digest"]):
        raise ValueError("campaign source-image identity is malformed")
    if _campaign_source_digest(identity["files"]) != identity["digest"]:
        raise RuntimeError("campaign source-image digest differs inside the Modal image")


def _campaign_node(command: list[str], request: dict[str, Any], timeout: int = 120,
                   cwd: str | pathlib.Path = "/workspace") -> Any:
    completed = _run_checked(command, "campaign evidence operation", cwd=cwd,
        input=json.dumps(request), text=True, capture_output=True, timeout=timeout)
    return json.loads(completed.stdout)


def _campaign_state_file(campaign_root: str) -> pathlib.Path:
    return _campaign_path(campaign_root, "state.json")


@app.function(image=image, cpu=1, memory=1024, timeout=300, max_containers=1,
              volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def campaign_state_mutator(request: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    if set(request) != {"campaign_root", "operation", "payload"}:
        raise ValueError("campaign state mutation request has unexpected fields")
    operation, held = request["operation"], request["payload"]
    if not isinstance(held, dict):
        raise ValueError("campaign mutation payload is invalid")
    state_file = _campaign_state_file(request["campaign_root"])
    scheduler_file = _campaign_scheduler_file(request["campaign_root"])
    if not state_file.exists():
        raise RuntimeError("campaign state does not exist")
    state = json.loads(state_file.read_text())
    scheduler = json.loads(scheduler_file.read_text()) if scheduler_file.exists() else None
    if operation == "claim":
        state = _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_state.ts", "claim"],
            {**held, "state": state})
        if scheduler is not None and scheduler["controllerFence"] < state["fencingToken"]:
            scheduler = _campaign_scheduler_operation("refence", scheduler,
                controllerFence=state["fencingToken"])
        elif scheduler is not None and scheduler["controllerFence"] > state["fencingToken"]:
            raise RuntimeError("campaign scheduler fence is ahead of validated state")
        if scheduler is not None:
            scheduler = _campaign_scheduler_operation("validate", scheduler)
            if held.get("taskResources") is not None:
                scheduler = _campaign_scheduler_operation("runtime", scheduler,
                    resources=held["taskResources"])
    elif operation == "assert-fence":
        state = _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_state.ts",
            "assert-fence"], {**held, "state": state})
        if scheduler is not None and scheduler["controllerFence"] != held["fencingToken"]:
            raise RuntimeError("campaign scheduler is stale or fenced out")
        return {"state": state, "scheduler": scheduler}
    else:
        if scheduler is None:
            raise RuntimeError("campaign scheduler checkpoint does not exist")
        if held.get("fencingToken") != state["fencingToken"] \
                or held.get("fencingToken") != scheduler["controllerFence"] \
                or held.get("expectedSchedulerRevision") != scheduler["revision"]:
            raise RuntimeError("campaign scheduler mutation is stale or fenced out")
        state_operation = None
        scheduler_updates = held.get("updates", [])
        if operation == "launch-intent":
            state_operation = "launch-intent"
        elif operation == "bind-call":
            state_operation = "bind-call"
        elif operation == "scheduler-update":
            state_operation = "stage-outcome" if held.get("stageOutcome") \
                else "transition" if held.get("stageRetry") else None
        elif operation == "repair-completed":
            state_operation = "repair-completed"
        elif operation == "recover-launch":
            state_operation = "recover-launch"
        else:
            raise ValueError(f"unknown serialized campaign mutation {operation}")
        if operation == "repair-completed":
            scheduler = _campaign_scheduler_operation("repair", scheduler, repair=held["repair"])
        elif operation == "recover-launch":
            before = next((task for task in scheduler["tasks"]
                           if task["taskId"] == held.get("recovery", {}).get("taskId")), None)
            scheduler = _campaign_scheduler_operation("recover", scheduler, recovery=held["recovery"])
            if before is None or held.get("stageKey") != f"{before['kingdomId']}:{before['stage']}":
                raise RuntimeError("campaign launch recovery stage identity differs")
            if any(task["status"] in {"active", "launching"}
                   and task["kingdomId"] == before["kingdomId"] and task["stage"] == before["stage"]
                   for task in scheduler["tasks"]):
                state_operation = None
        else:
            scheduler = _campaign_scheduler_operation("apply", scheduler, updates=scheduler_updates)
        if state_operation:
            state_payload = held if state_operation not in {"stage-outcome", "transition", "repair-completed"} \
                else {**held, **(held.get("stageOutcome") or held.get("stageRetry") or held.get("repair"))}
            state = _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_state.ts",
                state_operation], {**state_payload, "state": state})
    _atomic_json(state_file, state)
    if scheduler is not None:
        _atomic_json(scheduler_file, scheduler)
    volume.commit()
    return {"state": state, "scheduler": scheduler}


def _campaign_stage_command(stage: str, config: dict[str, Any], shutdown_at_ms: int) -> list[str]:
    root = _campaign_root(config["campaign_root"])
    if stage == "matrix":
        return ["npx", "tsx", "scripts/strategy_search_campaign_matrix.ts",
            "--campaign-root", str(root),
            "--manifest", str(_campaign_path(config["campaign_root"], config["manifest_path"])),
            "--out", str(_campaign_path(config["campaign_root"], config["output_path"])),
            "--control", str(_campaign_path(config["campaign_root"], config["control_path"])),

            "--workers", str(config["threads"]), "--jobs-per-batch", str(config["worker_batch_size"]),
            "--shutdown-at-ms", str(shutdown_at_ms)]
    if stage == "psro":
        return ["npx", "tsx", "scripts/strategy_search_campaign_psro.ts",
            "--campaign-root", str(root),
            "--config", str(_campaign_path(config["campaign_root"], config["stage_config_path"])),
            "--shutdown-at-ms", str(shutdown_at_ms)]
    raise ValueError(f"unsupported whole campaign stage {stage}")


def _drain_bounded_text(stream: Any, maximum_chars: int = 64 * 1024) -> tuple[list[str], threading.Thread]:
    tail = [""]
    def drain() -> None:
        while True:
            chunk = stream.read(4096)
            if not chunk:
                break
            tail[0] = (tail[0] + chunk)[-maximum_chars:]
    thread = threading.Thread(target=drain, daemon=True)
    thread.start()
    return tail, thread


def _run_campaign_stage(stage: str, config: dict[str, Any]) -> dict[str, Any]:
    if stage not in {"matrix", "psro"} or config.get("stage") != stage \
            or not isinstance(config.get("controller_fence"), int) or config["controller_fence"] < 1:
        raise ValueError("campaign whole-stage configuration is malformed")
    verify_campaign_source_image(config["source_image"])
    for key in (["manifest_path", "output_path", "control_path"] if stage == "matrix"
                else ["stage_config_path"]):
        held_path = _campaign_path(config["campaign_root"], config[key])
        _reject_campaign_symlinks(held_path if held_path.is_dir() else held_path.parent)
    timeout_seconds = int(config["timeout_seconds"])
    shutdown_margin_seconds = int(config["shutdown_margin_seconds"])
    if timeout_seconds < 2 or shutdown_margin_seconds < 1 or shutdown_margin_seconds >= timeout_seconds:
        raise ValueError("campaign stage shutdown margin is invalid")
    shutdown_at_ms = int((time.time() + timeout_seconds - shutdown_margin_seconds) * 1000)
    command = ["/usr/bin/time", "-v", *_campaign_stage_command(stage, config, shutdown_at_ms)]
    memory_mib = config.get("memory_mib")
    if not isinstance(memory_mib, int) or memory_mib < 512:
        raise ValueError("campaign whole-stage memory authorization is invalid")
    heap_mib = max(256, min(memory_mib - 256, math.floor(memory_mib * 0.75)))
    environment = {**os.environ, "NODE_OPTIONS": f"--max-old-space-size={heap_mib}"}
    if stage == "psro":
        environment["HEXDECK_GOLDFISH_BIN"] = CAMPAIGN_RUST_GOLDFISH_BIN
    started = time.monotonic()
    process = subprocess.Popen(command, cwd="/workspace", text=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, bufsize=1, env=environment)
    checkpoint_count = 0
    terminal = None
    event_error = None
    assert process.stdout is not None and process.stderr is not None
    stderr_tail, stderr_thread = _drain_bounded_text(process.stderr)
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == CAMPAIGN_CHECKPOINT_EVENT:
            if event.get("stage") != stage or not re.fullmatch(r"[0-9a-f]{64}", event.get("eventHash", "")):
                event_error = "campaign stage emitted a stale or malformed checkpoint event"
                process.terminate()
                break
            volume.commit()
            checkpoint_count += 1
        elif event.get("type") == CAMPAIGN_STAGE_STOP_EVENT:
            if event.get("stage") != stage or event.get("status") not in {
                    "complete", "incomplete", "terminal-incomplete"} \
                    or not re.fullmatch(r"[0-9a-f]{64}", event.get("markerHash", "")):
                event_error = "campaign stage emitted a malformed stop event"
                process.terminate()
                break
            terminal = event
    return_code = process.wait()
    stderr_thread.join(timeout=10)
    if stderr_thread.is_alive():
        raise RuntimeError(f"campaign {stage} stderr drain did not stop")
    stderr = stderr_tail[0]
    if event_error is not None:
        raise RuntimeError(f"{event_error}: {stderr[-2000:]}")
    if terminal is None:
        raise RuntimeError(f"campaign {stage} process stopped without a control marker: {stderr[-2000:]}")
    if terminal["status"] == "complete" and return_code != 0:
        raise RuntimeError(f"campaign {stage} claimed completion after process failure: {stderr[-2000:]}")
    marker_file = _campaign_path(config["campaign_root"],
        f"{config['control_path']}/{terminal['status']}.json")
    if not marker_file.exists():
        raise RuntimeError(f"campaign {stage} stop marker is missing")
    marker = json.loads(marker_file.read_text())
    if marker.get("markerHash") != terminal["markerHash"] or marker.get("status") != terminal["status"]:
        raise RuntimeError(f"campaign {stage} stop marker differs from its process event")
    rss = re.search(r"Maximum resident set size \(kbytes\):\s*(\d+)", stderr)
    attempt_id = config.get("launch_intent_id")
    if not isinstance(attempt_id, str) or not re.fullmatch(r"[0-9a-f]{64}", attempt_id):
        attempt_id = hashlib.sha256(f"{stage}:{config['controller_fence']}".encode()).hexdigest()
    execution_relative = f"{config['control_path']}/execution-{attempt_id}.json"
    execution = {"schemaVersion": 1, "stage": stage, "stageId": config["stage_id"],
        "launchIntentId": attempt_id, "controllerFence": config["controller_fence"],
        "authorizedMemoryMiB": memory_mib, "nodeHeapMiB": heap_mib,
        "peakRssKib": int(rss.group(1)) if rss else None,
        "wallMs": round((time.monotonic() - started) * 1000, 3), "returnCode": return_code,
        "checkpointCommits": checkpoint_count, "stderrTailSha256": hashlib.sha256(stderr.encode()).hexdigest()}
    execution_file = _campaign_path(config["campaign_root"], execution_relative)
    _atomic_json(execution_file, execution)
    artifact_hashes = dict(marker.get("artifactHashes", {}))
    stage_root = pathlib.PurePosixPath(config["control_path"]).parent.as_posix()
    artifact_relative = pathlib.PurePosixPath(execution_relative).relative_to(stage_root).as_posix()
    artifact_hashes[artifact_relative] = _sha256_path(execution_file)
    volume.commit()
    return {"status": terminal["status"], "stage": stage, "stageId": config["stage_id"],
        "controllerFence": config["controller_fence"], "markerHash": terminal["markerHash"],
        "reason": marker.get("reason"), "artifactPaths": sorted(artifact_hashes),
        "artifactHashes": artifact_hashes, "checkpointCommits": checkpoint_count,
        "peakRssKib": execution["peakRssKib"], "nodeHeapMiB": heap_mib,
        "containerIdentity": os.environ.get("MODAL_TASK_ID", socket.gethostname())}


@app.function(image=image, cpu=4, memory=8192, timeout=86400, retries=0, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def campaign_matrix_stage(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    return _run_campaign_stage("matrix", config)


@app.function(image=image, cpu=4, memory=8192, timeout=86400, retries=0, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def campaign_psro_stage(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    return _run_campaign_stage("psro", config)


def _campaign_scheduler_file(campaign_root: str) -> pathlib.Path:
    return _campaign_path(campaign_root, "scheduler.json")


def _campaign_scheduler_operation(operation: str, checkpoint: dict[str, Any], **values: Any) -> Any:
    return _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_scheduler.ts", operation],
        {"checkpoint": checkpoint, **values})


def _campaign_marker(stage: str, stage_id: str, status: str,
                     artifact_hashes: dict[str, str], reason: str | None = None) -> dict[str, Any]:
    request = {"stage": stage, "stageId": stage_id, "status": status,
        "artifactHashes": artifact_hashes}
    if reason is not None:
        request["reason"] = reason
    return _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_stages.ts"], request)


def _sha256_path(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _campaign_goldfish_complete_hashes(ranked: pathlib.Path, reservoir: pathlib.Path,
                                        manifest: dict[str, Any]) -> dict[str, str]:
    ranked_digest = _sha256_path(ranked)
    reservoir_digest = _sha256_path(reservoir)
    ranked_sidecar = ranked.with_suffix(".json.sha256")
    reservoir_sidecar = reservoir.with_suffix(".json.sha256")
    if ranked_sidecar.read_text() != f"{ranked_digest}  {ranked.name}\n" \
            or reservoir_sidecar.read_text() != f"{reservoir_digest}  {reservoir.name}\n":
        raise RuntimeError("campaign Goldfish SHA-256 sidecar differs")
    hashes = {"output/ranked.json": ranked_digest,
        "output/ranked.json.sha256": _sha256_path(ranked_sidecar),
        "output/reservoir.json": reservoir_digest,
        "output/reservoir.json.sha256": _sha256_path(reservoir_sidecar)}
    for part in manifest["parts"]:
        part_path = ranked.parent / part["file"]
        if not part_path.exists() or part_path.is_symlink():
            raise RuntimeError(f"campaign ranked part is missing or a symlink: {part['file']}")
        digest = _sha256_path(part_path)
        if digest != part["sha256"]:
            raise RuntimeError(f"campaign ranked part hash differs: {part['file']}")
        hashes[f"output/{part['file']}"] = digest
    return hashes


@app.function(image=image, cpu=1, memory=16384, timeout=7200, retries=0, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def campaign_goldfish_finalize(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    verify_campaign_source_image(config["source_image"])
    root = _campaign_root(config["campaign_root"])
    stage_root = _campaign_path(config["campaign_root"], config["stage_path"])
    stage_root.mkdir(parents=True, exist_ok=True)
    _reject_campaign_symlinks(stage_root)
    mode = config["ordered_stage"]
    node_environment = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=12288"}
    if mode == "merge-stage-one":
        manifest = stage_root / "stage-one-manifest.json"
        _atomic_json(manifest, [str(_campaign_path(config["campaign_root"], held))
                                for held in config["checkpoint_paths"]])
        cohort = stage_root / "stage-one-cohort.json"
        command = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "merge-stage-one",
            "--manifest", str(manifest), "--out", str(cohort)] + _ordered_product_cli(config)[3:]
        _run_checked(command, "campaign Goldfish stage-one merge", cwd="/workspace",
            env=node_environment, text=True, capture_output=True, timeout=config["timeout_seconds"])
        validate = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "validate-cohort",
            "--cohort", str(cohort)] + _ordered_product_cli(config)[3:]
        _run_checked(validate, "campaign Goldfish cohort validation", cwd="/workspace",
            env=node_environment, text=True, capture_output=True, timeout=config["timeout_seconds"])
        volume.commit()
        return {"status": "success", "stage": "goldfish", "operation": mode,
            "controllerFence": config["controller_fence"], "cohort": str(cohort)}
    if mode != "finalize":
        raise ValueError(f"unknown campaign Goldfish finalization operation {mode}")
    manifest = stage_root / "stage-two-manifest.json"
    _atomic_json(manifest, [str(_campaign_path(config["campaign_root"], held))
                            for held in config["checkpoint_paths"]])
    cohort = stage_root / "stage-one-cohort.json"
    ranked = stage_root / "output" / "ranked.json"
    reservoir = stage_root / "output" / "reservoir.json"
    finalize = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "finalize",
        "--cohort", str(cohort), "--manifest", str(manifest), "--out", str(ranked)] \
        + _ordered_product_cli(config)[3:]
    _run_checked(finalize, "campaign Goldfish finalize", cwd="/workspace", env=node_environment,
        text=True, capture_output=True, timeout=config["timeout_seconds"])
    build = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "build-reservoir",
        "--artifact", str(ranked), "--out", str(reservoir)] + _ordered_product_cli(config)[3:]
    _run_checked(build, "campaign Goldfish reservoir build", cwd="/workspace", env=node_environment,
        text=True, capture_output=True, timeout=config["timeout_seconds"])
    validate = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "validate-reservoir",
        "--artifact", str(ranked), "--reservoir", str(reservoir)] + _ordered_product_cli(config)[3:]
    _run_checked(validate, "campaign Goldfish deep validation", cwd="/workspace", env=node_environment,
        text=True, capture_output=True, timeout=config["timeout_seconds"])
    ranked_manifest = json.loads(ranked.read_text())
    goldfish_hashes = _campaign_goldfish_complete_hashes(ranked, reservoir, ranked_manifest)
    ranked_digest = goldfish_hashes["output/ranked.json"]
    reservoir_digest = goldfish_hashes["output/reservoir.json"]
    marker = _campaign_marker("goldfish", config["stage_id"], "complete", goldfish_hashes)
    control = stage_root / "control" / "complete.json"
    _atomic_json(control, marker)
    matrix_manifest = _campaign_path(config["campaign_root"], config["matrix_manifest_path"])
    prepare_matrix = ["npx", "tsx", "scripts/strategy_search_campaign_matrix_manifest.ts",
        "--kingdom", config["kingdom"], "--ranked", str(ranked), "--reservoir", str(reservoir),
        "--stage-id", config["matrix_stage_id"], "--seed-namespace", config["matrix_seed_namespace"],
        "--out", str(matrix_manifest)]
    _run_checked(prepare_matrix, "campaign Matrix manifest preparation", cwd="/workspace",
        env=node_environment, text=True, capture_output=True, timeout=config["timeout_seconds"])
    volume.commit()
    return {"status": "success", "stage": "goldfish", "operation": mode,
        "controllerFence": config["controller_fence"], "markerHash": marker["markerHash"],
        "reason": None, "artifactPaths": sorted(goldfish_hashes), "artifactHashes": goldfish_hashes,
        "rankedSha256": ranked_digest, "reservoirSha256": reservoir_digest}


def _campaign_function(task: dict[str, Any]) -> Any:
    if task["stage"] == "matrix":
        return campaign_matrix_stage
    if task["stage"] == "psro":
        return campaign_psro_stage
    if task["stage"] == "goldfish" and task["config"]["ordered_stage"] == "stage-one":
        return ordered_product_stage_one
    if task["stage"] == "goldfish" and task["config"]["ordered_stage"] == "stage-two":
        return ordered_product_stage_two
    if task["stage"] == "goldfish" and task["config"]["ordered_stage"] in {"merge-stage-one", "finalize"}:
        return campaign_goldfish_finalize
    raise ValueError(f"campaign scheduler task {task['taskId']} has no trusted entrypoint")


def _validate_campaign_task_configs(checkpoint: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
        raise ValueError("campaign task configurations are invalid")
    configs = {entry.get("task_id"): entry for entry in entries}
    if None in configs or len(configs) != len(entries) or set(configs) != {
            task["taskId"] for task in checkpoint["tasks"]}:
        raise ValueError("campaign task configuration IDs do not match the scheduler")
    for task in checkpoint["tasks"]:
        entry = configs[task["taskId"]]
        saved_call = task.get("status") in {"active", "launching"}
        if entry.get("stage") != task["stage"] or entry.get("kingdom_id") != task["kingdomId"] \
                or not saved_call and entry.get("cpu") != task["cpus"] or task["containers"] != 1 \
                or not isinstance(entry.get("memory_mib"), int) or entry["memory_mib"] < 1 \
                or not isinstance(entry.get("timeout_seconds"), int) or entry["timeout_seconds"] < 1 \
                or not isinstance(entry.get("stage_terminal"), bool) \
                or not isinstance(entry.get("config"), dict) or not isinstance(entry.get("validation"), dict):
            raise ValueError(f"campaign task configuration differs for {task['taskId']}")
        expected_terminal = task["stage"] in {"matrix", "psro"} \
            or entry["config"].get("ordered_stage") == "finalize"
        if task["stage"] == "goldfish":
            _campaign_ordered_run_root(entry["config"].get("campaign_root", ""),
                entry["config"].get("run_id"))
        if entry["stage_terminal"] != expected_terminal:
            raise ValueError(f"campaign terminal task declaration differs for {task['taskId']}")
        for values in [entry["config"], entry["validation"]]:
            for key, value in values.items():
                if key == "campaign_root" or "path" not in key.lower():
                    continue
                paths = value if isinstance(value, list) else [value]
                if not paths or any(not isinstance(held, str) for held in paths):
                    raise ValueError(f"campaign task path field {key} is invalid")
                for relative in paths:
                    _campaign_path(entry["config"].get("campaign_root", ""), relative)
    return configs


def _deep_validate_campaign_result(campaign_root: str, entry: dict[str, Any],
                                   result: dict[str, Any]) -> dict[str, Any]:
    validation = entry["validation"]
    kind = validation.get("kind")
    if kind == "ordered-checkpoint":
        spec = {**entry["config"], **validation["spec"]}
        checkpoint = _campaign_path(campaign_root, validation["checkpoint_path"])
        stage = validation["ordered_stage"]
        if not _valid_ordered_product_checkpoint(checkpoint, spec, stage):
            raise RuntimeError(f"campaign {stage} checkpoint failed deep validation")
        held = json.loads(checkpoint.read_text())
        digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
        relative = validation["checkpoint_path"]
        return {"status": "complete", "artifactPaths": [relative],
            "artifactHashes": {relative: digest}, "contentDigest": held["contentDigest"]}
    if kind == "goldfish-cohort":
        cohort = _campaign_path(campaign_root, validation["cohort_path"])
        command = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "validate-cohort",
            "--cohort", str(cohort)] + _ordered_product_cli(entry["config"])[3:]
        _run_checked(command, "campaign Goldfish cohort revalidation", cwd="/workspace",
            text=True, capture_output=True, timeout=entry["timeout_seconds"])
        relative = validation["cohort_path"]
        return {"status": "complete", "artifactPaths": [relative],
            "artifactHashes": {relative: hashlib.sha256(cohort.read_bytes()).hexdigest()}}
    expected_status = result.get("status")
    if kind != "stage" or expected_status not in {"complete", "incomplete", "terminal-incomplete"}:
        raise RuntimeError("campaign call returned no deeply valid stage outcome")
    request = {"campaignRoot": str(_campaign_root(campaign_root)), "stage": entry["stage"],
        "stageId": entry["config"]["stage_id"], "stageRoot": validation["stage_root"],
        "expectedStatus": expected_status}
    validated = _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_validate_stage.ts"], request,
        timeout=max(120, entry["timeout_seconds"]))
    stage_root = _campaign_path(campaign_root, validation["stage_root"])
    marker = json.loads((stage_root / "control" / f"{expected_status}.json").read_text())
    marker_entries = sorted(marker.get("artifactHashes", {}).items())
    marker_set_hash = hashlib.sha256(json.dumps(marker_entries,
        separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    if validated.get("status") != expected_status or validated.get("markerHash") != marker.get("markerHash") \
            or validated.get("artifactCount") != len(marker_entries) \
            or validated.get("artifactSetHash") != marker_set_hash:
        raise RuntimeError("campaign compact stage validation result differs from its marker")
    artifact_hashes = result.get("artifactHashes", {})
    if not isinstance(artifact_hashes, dict) or any(
            artifact_hashes.get(path) != digest for path, digest in marker_entries):
        raise RuntimeError("campaign call result omits validated marker evidence")
    for relative, digest in artifact_hashes.items():
        file = _campaign_path(campaign_root, f"{validation['stage_root']}/{relative}")
        if not file.exists() or file.is_symlink() or _sha256_path(file) != digest:
            raise RuntimeError(f"campaign call artifact differs: {relative}")
    return {"status": expected_status, "reason": marker.get("reason"),
        "artifactPaths": sorted(artifact_hashes), "artifactHashes": artifact_hashes}


def _campaign_call_observations(checkpoint: dict[str, Any], campaign_root: str,
                                task_configs: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    observations = []
    for task in checkpoint["tasks"]:
        if task["status"] != "active":
            continue
        try:
            call = modal.FunctionCall.from_id(task["callId"])
        except Exception as error:
            observations.append({"callId": task["callId"], "state": "failed",
                "reason": f"{type(error).__name__}: {error}"})
            continue
        try:
            result = call.get(timeout=0)
        except (ModalTimeoutError, TimeoutError):
            observations.append({"callId": task["callId"], "state": "running"})
            continue
        except Exception as error:
            observations.append({"callId": task["callId"], "state": "failed",
                "reason": f"{type(error).__name__}: {error}"})
            continue
        try:
            volume.reload()
            normalized = dict(result) if isinstance(result, dict) else {}
            if task_configs[task["taskId"]]["stage"] == "goldfish" \
                    and normalized.get("status") == "success":
                normalized["status"] = "complete"
            validated = _deep_validate_campaign_result(campaign_root,
                task_configs[task["taskId"]], normalized)
            observations.append({"callId": task["callId"], "state": "succeeded",
                "artifactStatus": validated["status"], "reason": validated.get("reason"),
                "artifactPaths": validated.get("artifactPaths", []),
                "artifactHashes": validated.get("artifactHashes", {})})
        except Exception as error:
            observations.append({"callId": task["callId"], "state": "failed",
                "reason": f"deep validation failed: {type(error).__name__}: {error}"})
    return observations


def _durably_spawn_campaign_task(*, campaign_root: str, owner_id: str, fence: int,
                                  state: dict[str, Any], checkpoint: dict[str, Any],
                                  action: dict[str, Any], entry: dict[str, Any],
                                  source_image: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], Any]:
    launch_intent_id = hashlib.sha256(
        f"{checkpoint['checkpointHash']}:{action['taskId']}:{fence}".encode()).hexdigest()
    intent_payload = {"expectedSchedulerRevision": checkpoint["revision"], "fencingToken": fence,
        "expectedRevision": state["revision"], "ownerId": owner_id,
        "stageKey": entry["config"]["stage_key"], "launchIntentId": launch_intent_id,
        "nowMs": int(time.time() * 1000), "resources": {"containers": 1, "cpus": entry["cpu"]},
        "updates": [{"kind": "intent", "taskId": action["taskId"],
            "launchIntentId": launch_intent_id, "controllerFence": fence}]}
    changed = campaign_state_mutator.remote({"campaign_root": campaign_root,
        "operation": "launch-intent", "payload": intent_payload})
    state, checkpoint = changed["state"], changed["scheduler"]
    stage_config = {**entry["config"], "controller_fence": fence, "source_image": source_image,
        "memory_mib": entry["memory_mib"], "launch_intent_id": launch_intent_id}
    function = _campaign_function({**action, "config": entry["config"]})
    call = function.with_options(cpu=entry["cpu"], memory=entry["memory_mib"],
        timeout=entry["timeout_seconds"], retries=0).spawn(stage_config)
    bind_payload = {"expectedSchedulerRevision": checkpoint["revision"], "fencingToken": fence,
        "expectedRevision": state["revision"], "ownerId": owner_id,
        "stageKey": entry["config"]["stage_key"], "launchIntentId": launch_intent_id,
        "callId": call.object_id, "nowMs": int(time.time() * 1000),
        "updates": [{"kind": "bind", "taskId": action["taskId"],
            "launchIntentId": launch_intent_id, "callId": call.object_id, "controllerFence": fence}]}
    changed = campaign_state_mutator.remote({"campaign_root": campaign_root,
        "operation": "bind-call", "payload": bind_payload})
    return changed["state"], changed["scheduler"], call


def _reconcile_campaign_completed(*, campaign_root: str, owner_id: str, fence: int,
                                  state: dict[str, Any], checkpoint: dict[str, Any],
                                  task_configs: dict[str, dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any], bool]:
    if any(task["status"] in {"active", "launching"} for task in checkpoint["tasks"]):
        return state, checkpoint, False
    for task in checkpoint["tasks"]:
        if task["status"] != "complete":
            continue
        entry = task_configs[task["taskId"]]
        try:
            volume.reload()
            _deep_validate_campaign_result(campaign_root, entry, {"status": "complete",
                "artifactPaths": task["artifactPaths"], "artifactHashes": task["artifactHashes"]})
        except Exception as error:
            reason = f"completed evidence repair: {type(error).__name__}: {error}"
            repair = {"taskId": task["taskId"], "stageKey": entry["config"]["stage_key"],
                "reason": reason, "artifactPaths": task["artifactPaths"],
                "artifactHashes": task["artifactHashes"]}
            changed = campaign_state_mutator.remote({"campaign_root": campaign_root,
                "operation": "repair-completed", "payload": {
                    "expectedSchedulerRevision": checkpoint["revision"], "fencingToken": fence,
                    "expectedRevision": state["revision"], "ownerId": owner_id, "repair": repair}})
            return changed["state"], changed["scheduler"], True
    return state, checkpoint, False


def _terminal_campaign_outcome(checkpoint: dict[str, Any]) -> dict[str, Any] | None:
    tasks = checkpoint["tasks"]
    if not tasks or any(task["status"] not in {"complete", "terminal-incomplete"} for task in tasks):
        return None
    terminal = next((task for task in tasks if task["status"] == "terminal-incomplete"), None)
    if terminal is None:
        return None
    return {"status": "incomplete", "reason": terminal["reason"],
        "artifactPaths": terminal["artifactPaths"], "artifactHashes": terminal["artifactHashes"],
        "taskId": terminal["taskId"]}


@app.function(image=image, cpu=1, memory=2048, timeout=86400, retries=0, volumes={"/results": volume})
def campaign_controller(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    initial_claim = {**config["claim"], "nowMs": int(time.time() * 1000)}
    claimed = campaign_state_mutator.remote({"campaign_root": config["campaign_root"], "operation": "claim",
        "payload": initial_claim})
    state, checkpoint = claimed["state"], claimed["scheduler"]
    fence = state["fencingToken"]
    if checkpoint is None or checkpoint["evidenceHash"] != config["evidence_hash"]:
        raise RuntimeError("campaign scheduler checkpoint is missing or has stale evidence")
    if config["lease_renew_interval_seconds"] <= 0 \
            or config["lease_renew_interval_seconds"] * 2000 > config["claim"]["leaseMs"]:
        raise ValueError("campaign lease renewal interval must not exceed half the lease")
    task_configs = _validate_campaign_task_configs(checkpoint, config["tasks"])
    for task in checkpoint["tasks"]:
        entry = task_configs[task["taskId"]]
        stage_key = entry["config"].get("stage_key")
        if stage_key != f"{task['kingdomId']}:{task['stage']}" \
                or state["stages"].get(stage_key, {}).get("id") != entry["config"].get("stage_id") \
                or entry["config"].get("campaign_root") != config["campaign_root"]:
            raise ValueError(f"campaign task stage identity differs for {task['taskId']}")
    deadline = time.monotonic() + config["controller_timeout_seconds"] - config["shutdown_margin_seconds"]
    renewed_at = time.monotonic()
    initial_reconciled = False
    while True:
        volume.reload()
        if time.monotonic() - renewed_at >= config["lease_renew_interval_seconds"]:
            claimed = campaign_state_mutator.remote({"campaign_root": config["campaign_root"],
                "operation": "claim", "payload": {"expectedRevision": state["revision"],
                    "ownerId": config["claim"]["ownerId"], "nowMs": int(time.time() * 1000),
                    "leaseMs": config["claim"]["leaseMs"],
                    "requestedCeilings": config["claim"]["requestedCeilings"],
                    "runtimeHash": config["claim"]["runtimeHash"],
                    "taskResources": config["claim"]["taskResources"]}})
            state, checkpoint = claimed["state"], claimed["scheduler"]
            if state["fencingToken"] != fence:
                raise RuntimeError("campaign controller lost its fencing token during lease renewal")
            renewed_at = time.monotonic()
        if not initial_reconciled and not any(task["status"] in {"active", "launching"}
                                             for task in checkpoint["tasks"]):
            state, checkpoint, repaired = _reconcile_campaign_completed(
                campaign_root=config["campaign_root"], owner_id=config["claim"]["ownerId"],
                fence=fence, state=state, checkpoint=checkpoint, task_configs=task_configs)
            if repaired:
                continue
            initial_reconciled = True
        now_ms = int(time.time() * 1000)
        for task in [entry for entry in checkpoint["tasks"] if entry["status"] == "incomplete"
                     and entry.get("retryNotBeforeMs", 0) <= now_ms]:
            task_config = task_configs[task["taskId"]]
            payload = {"expectedSchedulerRevision": checkpoint["revision"], "fencingToken": fence,
                "expectedRevision": state["revision"], "ownerId": config["claim"]["ownerId"],
                "updates": [{"kind": "ready", "taskId": task["taskId"], "nowMs": now_ms}]}
            stage_key = task_config["config"]["stage_key"]
            if state["stages"][stage_key]["status"] == "incomplete":
                payload["stageRetry"] = {"stageKey": stage_key, "status": "ready", "details": {}}
            changed = campaign_state_mutator.remote({"campaign_root": config["campaign_root"],
                "operation": "scheduler-update", "payload": payload})
            state, checkpoint = changed["state"], changed["scheduler"]
        observations = _campaign_call_observations(checkpoint, config["campaign_root"], task_configs)
        stop_launching = time.monotonic() >= deadline
        actions = _campaign_scheduler_operation("plan", checkpoint, observations=observations,
            limits=config["limits"], stopLaunching=stop_launching)
        ambiguous = next((action for action in actions if action["kind"] == "ambiguous-launch"), None)
        if ambiguous:
            return {"status": "incomplete", "reason": ambiguous["reason"],
                "taskId": ambiguous["taskId"], "launchIntentId": ambiguous["launchIntentId"],
                "evidenceHash": config["evidence_hash"], "controllerFence": fence,
                "schedulerHash": checkpoint["checkpointHash"]}
        for action in [entry for entry in actions if entry["kind"] in {
                "complete", "incomplete", "terminal-incomplete"}]:
            entry = task_configs[action["taskId"]]
            update = {"kind": "completed" if action["kind"] == "complete" else action["kind"],
                "taskId": action["taskId"], "callId": action["callId"],
                "artifactPaths": action["artifactPaths"], "artifactHashes": action["artifactHashes"]}
            if action["kind"] != "complete":
                update["reason"] = action["reason"]
            if action["kind"] == "incomplete":
                task = next(task for task in checkpoint["tasks"] if task["taskId"] == action["taskId"])
                base = config["retry_backoff_seconds"]
                maximum = config["retry_backoff_max_seconds"]
                if not all(isinstance(value, int) and value > 0 for value in [base, maximum]) or maximum < base:
                    raise ValueError("campaign retry backoff is invalid")
                exponent = min(max(0, task["attemptCount"] - 1), math.ceil(math.log2(maximum / base)))
                delay_seconds = min(maximum, base * (2 ** exponent))
                update["retryNotBeforeMs"] = int(time.time() * 1000) + delay_seconds * 1000
            payload = {"expectedSchedulerRevision": checkpoint["revision"], "fencingToken": fence,
                "expectedRevision": state["revision"], "ownerId": config["claim"]["ownerId"],
                "updates": [update]}
            if entry.get("stage_terminal"):
                payload["stageOutcome"] = {"stageKey": entry["config"]["stage_key"],
                    "status": action["kind"], "reason": action.get("reason"),
                    "artifactPaths": action["artifactPaths"], "artifactHashes": action["artifactHashes"]}
            changed = campaign_state_mutator.remote({"campaign_root": config["campaign_root"],
                "operation": "scheduler-update", "payload": payload})
            state, checkpoint = changed["state"], changed["scheduler"]
        launch_actions = [entry for entry in actions if entry["kind"] == "launch"]
        if not isinstance(config.get("dispatch_batch_size"), int) or config["dispatch_batch_size"] < 1:
            raise ValueError("campaign dispatch batch size is invalid")
        for action in launch_actions[:config["dispatch_batch_size"]]:
            held = task_configs[action["taskId"]]
            if action["containers"] != 1 or action["cpus"] != held["cpu"]:
                raise RuntimeError("campaign task resources differ from the fenced scheduler checkpoint")
            state, checkpoint, _call = _durably_spawn_campaign_task(campaign_root=config["campaign_root"],
                owner_id=config["claim"]["ownerId"], fence=fence, state=state, checkpoint=checkpoint,
                action=action, entry=held, source_image=config["source_image"])
        statuses = {task["status"] for task in checkpoint["tasks"]}
        psro_states = [stage["status"] for key, stage in state["stages"].items() if key.endswith(":psro")]
        if statuses == {"complete"} and psro_states and all(status == "complete" for status in psro_states):
            state, checkpoint, repaired = _reconcile_campaign_completed(
                campaign_root=config["campaign_root"], owner_id=config["claim"]["ownerId"],
                fence=fence, state=state, checkpoint=checkpoint, task_configs=task_configs)
            if repaired:
                initial_reconciled = True
                continue
            return {"status": "complete", "evidenceHash": config["evidence_hash"],
                "stateRevision": state["revision"], "controllerFence": fence,
                "schedulerHash": checkpoint["checkpointHash"]}
        terminal_outcome = _terminal_campaign_outcome(checkpoint)
        if terminal_outcome:
            return {**terminal_outcome, "evidenceHash": config["evidence_hash"],
                "controllerFence": fence, "schedulerHash": checkpoint["checkpointHash"]}
        if stop_launching:
            reason = "controller timeout margin stopped new launches"
            for stage_key, stage in list(state["stages"].items()):
                matching = [task for task in checkpoint["tasks"]
                    if task_configs[task["taskId"]]["config"]["stage_key"] == stage_key]
                if stage["status"] == "active" and matching \
                        and not any(task["status"] in {"active", "launching"} for task in matching):
                    changed = campaign_state_mutator.remote({"campaign_root": config["campaign_root"],
                        "operation": "scheduler-update", "payload": {
                            "expectedSchedulerRevision": checkpoint["revision"], "fencingToken": fence,
                            "expectedRevision": state["revision"], "ownerId": config["claim"]["ownerId"],
                            "updates": [], "stageOutcome": {"stageKey": stage_key,
                                "status": "incomplete", "reason": reason,
                                "artifactPaths": [], "artifactHashes": {}}}})
                    state, checkpoint = changed["state"], changed["scheduler"]
            return {"status": "incomplete", "reason": reason,
                "evidenceHash": config["evidence_hash"], "controllerFence": fence,
                "schedulerHash": checkpoint["checkpointHash"]}
        if not actions or all(action["kind"] == "reattach" for action in actions):
            time.sleep(min(5, config["poll_interval_seconds"]))


def _bounded_json(path: pathlib.Path, maximum_bytes: int = 8 * 1024 * 1024) -> Any:
    if not path.exists():
        return None
    if path.is_symlink() or path.stat().st_size > maximum_bytes:
        raise RuntimeError(f"campaign bounded read rejected {path}")
    return json.loads(path.read_text())


@app.function(image=image, cpu=1, memory=1024, timeout=300, max_containers=1,
              volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def campaign_initialize(request: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    if set(request) != {"campaign_root", "evidence_hash", "state", "scheduler", "tasks", "files"}:
        raise ValueError("campaign initialization has unexpected fields")
    root = _campaign_root(request["campaign_root"])
    _reject_campaign_symlinks(root)
    state = request["state"]
    scheduler = request["scheduler"]
    if state.get("evidenceHash") != request["evidence_hash"] \
            or scheduler.get("evidenceHash") != request["evidence_hash"]:
        raise ValueError("campaign initialization evidence differs")
    _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_state.ts", "validate"],
        {"state": state})
    _campaign_scheduler_operation("validate", scheduler)
    state_file, scheduler_file = _campaign_state_file(request["campaign_root"]), \
        _campaign_scheduler_file(request["campaign_root"])
    if state_file.exists() or scheduler_file.exists():
        if not state_file.exists() or not scheduler_file.exists():
            raise RuntimeError("campaign initialization is partial")
        saved_state, saved_scheduler = json.loads(state_file.read_text()), json.loads(scheduler_file.read_text())
        _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_state.ts", "validate"],
            {"state": saved_state})
        _campaign_scheduler_operation("validate", saved_scheduler)
        if saved_state["evidenceHash"] != request["evidence_hash"] \
                or saved_scheduler["evidenceHash"] != request["evidence_hash"]:
            raise RuntimeError("saved campaign evidence differs")
    else:
        root.mkdir(parents=True, exist_ok=True)
        _atomic_json(state_file, state)
        _atomic_json(scheduler_file, scheduler)
    task_file = _campaign_path(request["campaign_root"], "task-configs.json")
    expected_tasks = request["tasks"]
    _atomic_json(task_file, expected_tasks)
    if not isinstance(request["files"], dict):
        raise ValueError("campaign initialization files are invalid")
    for relative, value in request["files"].items():
        destination = _campaign_path(request["campaign_root"], relative)
        _atomic_json(destination, value)
    volume.commit()
    return {"status": "initialized", "campaignRoot": request["campaign_root"],
        "evidenceHash": request["evidence_hash"]}


@app.function(image=image, cpu=0.25, memory=512, timeout=30, max_containers=1,
              volumes={"/results": volume})
def campaign_read_status(request: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    if set(request) != {"campaign_root", "evidence_hash"}:
        raise ValueError("campaign status request has unexpected fields")
    state = _bounded_json(_campaign_state_file(request["campaign_root"]))
    scheduler = _bounded_json(_campaign_scheduler_file(request["campaign_root"]))
    if state is not None:
        state = _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_state.ts", "validate"],
            {"state": state}, timeout=20)
    if scheduler is not None:
        scheduler = _campaign_scheduler_operation("validate", scheduler)
    if state is not None and state["evidenceHash"] != request["evidence_hash"] \
            or scheduler is not None and scheduler["evidenceHash"] != request["evidence_hash"]:
        raise RuntimeError("campaign status evidence differs")
    root = _campaign_root(request["campaign_root"])
    download = _bounded_json(root / "download" / "summary.json", 16 * 1024)
    if download is not None and (set(download) != {"schemaVersion", "indexHash", "indexBytes",
            "entryCount", "archiveManifestHash", "archiveCount"}
            or download["schemaVersion"] != 1
            or not re.fullmatch(r"[0-9a-f]{64}", download.get("indexHash", ""))
            or not re.fullmatch(r"[0-9a-f]{64}", download.get("archiveManifestHash", ""))
            or not all(isinstance(download.get(key), int) and download[key] >= 0
                       for key in ["indexBytes", "entryCount", "archiveCount"])):
        raise RuntimeError("campaign download summary is malformed")
    controller_call = _bounded_json(root / "controller-call.json", 4096)
    if controller_call is not None and (set(controller_call) != {
            "schemaVersion", "evidenceHash", "callId", "ownerId"}
            or controller_call["schemaVersion"] != 1
            or controller_call["evidenceHash"] != request["evidence_hash"]
            or controller_call["callId"] is not None and not isinstance(controller_call["callId"], str)
            or not isinstance(controller_call["ownerId"], str) or not controller_call["ownerId"]):
        raise RuntimeError("campaign controller-call evidence is malformed")
    return {"state": state, "scheduler": scheduler, "download": download,
        "controllerCall": controller_call}


def _campaign_file_entries(campaign_root: str, state: dict[str, Any]) -> tuple[list[dict[str, Any]],
        dict[tuple[str, str], list[str]]]:
    root = _campaign_root(campaign_root)
    entries, groups = [], {}
    for directory, names, files in os.walk(root, followlinks=False):
        names[:] = sorted(name for name in names if pathlib.Path(directory, name) != root / "download")
        for name in [*names, *files]:
            if pathlib.Path(directory, name).is_symlink():
                raise RuntimeError(f"campaign download source contains a symlink: {name}")
        for name in sorted(files):
            file = pathlib.Path(directory, name)
            relative = file.relative_to(root).as_posix()
            if relative.startswith("download/"):
                continue
            components = relative.split("/")
            stage_id, completeness = state["evidenceHash"], "complete" \
                if all(value["status"] == "complete" for key, value in state["stages"].items()
                       if key.endswith(":psro")) else "incomplete"
            if len(components) >= 3 and components[0] == "kingdoms" \
                    and components[2] in {"goldfish", "matrix", "psro"}:
                stage = state["stages"].get(f"{components[1]}:{components[2]}")
                if stage is None:
                    raise RuntimeError(f"campaign download file has no stage: {relative}")
                stage_id = stage["id"]
                completeness = stage["status"] if stage["status"] in {
                    "complete", "terminal-incomplete"} else "incomplete"
            entries.append({"path": relative, "bytes": file.stat().st_size,
                "sha256": _sha256_path(file), "stageId": stage_id,
                "completeness": completeness})
            groups.setdefault((stage_id, completeness), []).append(relative)
    return entries, groups


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _campaign_archive_member_hash(entries: list[dict[str, Any]]) -> str:
    ordered = sorted(entries, key=lambda entry: entry["path"])
    return hashlib.sha256(_canonical_json(ordered).encode()).hexdigest()


def _prune_campaign_archives(download: pathlib.Path, current_archives: set[str]) -> None:
    archives_root = download / "archives"
    if not archives_root.exists():
        return
    for existing in archives_root.iterdir():
        relative = existing.relative_to(download).as_posix()
        if existing.is_symlink():
            raise RuntimeError("campaign archive output contains a symlink")
        if existing.is_file() and relative not in current_archives:
            existing.unlink()


@app.function(image=image, cpu=1, memory=2048, timeout=86400, max_containers=1,
              volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def campaign_package_download(request: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    if set(request) != {"campaign_root", "evidence_hash", "reconciled_scheduler_hash",
            "controller_fence"}:
        raise ValueError("campaign packaging request has unexpected fields")
    root = _campaign_root(request["campaign_root"])
    state = _bounded_json(_campaign_state_file(request["campaign_root"]))
    scheduler = _bounded_json(_campaign_scheduler_file(request["campaign_root"]))
    if state is None or scheduler is None or state["evidenceHash"] != request["evidence_hash"] \
            or scheduler.get("checkpointHash") != request["reconciled_scheduler_hash"] \
            or state.get("fencingToken") != request["controller_fence"] \
            or scheduler.get("controllerFence") != request["controller_fence"]:
        raise RuntimeError("campaign packaging state is missing, unreconciled, or stale")
    _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_state.ts", "validate"],
        {"state": state})
    _campaign_scheduler_operation("validate", scheduler)
    if any(task["status"] in {"active", "launching"} for task in scheduler["tasks"]):
        raise RuntimeError("campaign packaging waits for all active calls to stop")
    entries, groups = _campaign_file_entries(request["campaign_root"], state)
    content_index = _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_content_index.ts"],
        entries, timeout=600)
    download = root / "download"
    archives_root = download / "archives"
    archives_root.mkdir(parents=True, exist_ok=True)
    archive_entries = []
    indexed = {entry["path"]: entry for entry in content_index["entries"]}
    for (stage_id, completeness), members in sorted(groups.items()):
        archive_name = f"archives/{stage_id}-{completeness}.tar"
        archive = root / "download" / archive_name
        temporary = pathlib.Path(f"{archive}.tmp-{os.getpid()}")
        with tarfile.open(temporary, "w", format=tarfile.USTAR_FORMAT) as held:
            for relative in sorted(members):
                source = root / relative
                info = tarfile.TarInfo(relative)
                info.size = source.stat().st_size
                info.mode = 0o600
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                info.mtime = 0
                with source.open("rb") as stream:
                    held.addfile(info, stream)
        os.replace(temporary, archive)
        member_entries = [indexed[member] for member in sorted(members)]
        for member in member_entries:
            if member["stageId"] != stage_id or member["completeness"] != completeness:
                raise RuntimeError("campaign archive grouping differs from the content index")
        archive_entries.append({"path": archive_name, "bytes": archive.stat().st_size,
            "sha256": _sha256_path(archive), "stageId": stage_id,
            "completeness": completeness, "memberCount": len(member_entries),
            "memberHash": _campaign_archive_member_hash(member_entries)})
    base = {"schemaVersion": 2, "indexHash": content_index["indexHash"],
        "archives": sorted(archive_entries, key=lambda entry: entry["path"]), "manifestHash": ""}
    archives = {**base, "manifestHash": hashlib.sha256(_canonical_json(base).encode()).hexdigest()}
    _atomic_json(download / "content-index.json", content_index)
    _atomic_json(download / "archives.json", archives)
    current_archives = {entry["path"] for entry in archive_entries}
    _prune_campaign_archives(download, current_archives)
    summary = {"schemaVersion": 1, "indexHash": content_index["indexHash"],
        "indexBytes": (download / "content-index.json").stat().st_size,
        "entryCount": len(content_index["entries"]), "archiveManifestHash": archives["manifestHash"],
        "archiveCount": len(archive_entries)}
    _atomic_json(download / "summary.json", summary)
    volume.commit()
    return summary


@app.function(image=image, cpu=0.25, memory=512, timeout=60, max_containers=1,
              volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def campaign_controller_call_mutator(request: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    if set(request) != {"campaign_root", "evidence_hash", "operation", "call_id", "owner_id"}:
        raise ValueError("campaign controller-call request has unexpected fields")
    file = _campaign_path(request["campaign_root"], "controller-call.json")
    current = _bounded_json(file, 4096)
    if current is not None and (set(current) != {"schemaVersion", "evidenceHash", "callId", "ownerId"}
            or current.get("schemaVersion") != 1 or current.get("evidenceHash") != request["evidence_hash"]
            or current.get("callId") is not None and not isinstance(current.get("callId"), str)
            or not isinstance(current.get("ownerId"), str) or not current.get("ownerId")):
        raise RuntimeError("saved campaign controller call has stale or malformed evidence")
    if request["operation"] == "reserve":
        if current is None:
            current = {"schemaVersion": 1, "evidenceHash": request["evidence_hash"],
                "callId": None, "ownerId": request["owner_id"]}
            _atomic_json(file, current)
            volume.commit()
    elif request["operation"] == "bind":
        if current is None or current.get("ownerId") != request["owner_id"] \
                or current.get("callId") is not None or not request["call_id"]:
            raise RuntimeError("campaign controller launch binding is stale or ambiguous")
        current["callId"] = request["call_id"]
        _atomic_json(file, current)
        volume.commit()
    elif request["operation"] == "clear":
        if current is not None and current.get("ownerId") == request["owner_id"] \
                and (current.get("callId") == request["call_id"]
                     or current.get("callId") is None and not request["call_id"]):
            file.unlink()
            volume.commit()
            current = None
    else:
        raise ValueError("unknown campaign controller-call operation")
    return {"controllerCall": current}


def _local_campaign_file_matches(root: pathlib.Path, entry: dict[str, Any]) -> bool:
    relative = entry["path"]
    if not isinstance(relative, str) or relative.startswith("/") or "\\" in relative \
            or any(part in {"", ".", ".."} for part in relative.split("/")):
        raise ValueError("campaign local content path is invalid")
    destination = (root.resolve() / relative).resolve()
    if root.resolve() not in destination.parents:
        raise ValueError("campaign local content path escapes its root")
    cursor = root.resolve()
    for component in relative.split("/"):
        cursor /= component
        if cursor.exists() and cursor.is_symlink():
            return False
    return destination.is_file() and destination.stat().st_size == entry["bytes"] \
        and _sha256_path(destination) == entry["sha256"]


def _download_campaign_file(remote: str, local: pathlib.Path) -> None:
    local.parent.mkdir(parents=True, exist_ok=True)
    temporary = local.with_name(f"{local.name}.tmp-{os.getpid()}")
    with temporary.open("wb") as output:
        for chunk in volume.read_file(remote):
            output.write(chunk)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, local)


@app.local_entrypoint()
def campaign_status_entry(campaign_root: str, evidence_hash: str) -> None:
    print(json.dumps(campaign_read_status.remote({"campaign_root": campaign_root,
        "evidence_hash": evidence_hash})))


def _recover_campaign_launch(campaign_root: str, evidence_hash: str, target: str,
                             assertion: str) -> dict[str, Any]:
    if assertion != "no-live-modal-call-exists":
        raise ValueError("campaign launch recovery needs the exact no-live-call assertion")
    status = campaign_read_status.remote({"campaign_root": campaign_root, "evidence_hash": evidence_hash})
    if target == "controller":
        saved = status.get("controllerCall")
        if not saved or saved.get("callId") is not None:
            raise RuntimeError("campaign controller has no ambiguous unbound launch intent")
        recovered = campaign_controller_call_mutator.remote({"campaign_root": campaign_root,
            "evidence_hash": evidence_hash, "operation": "clear", "call_id": "",
            "owner_id": saved["ownerId"]})
        return {"status": "recovered", "target": target,
            "controllerCall": recovered["controllerCall"]}
    state, scheduler = status.get("state"), status.get("scheduler")
    task = next((held for held in (scheduler or {}).get("tasks", []) if held["taskId"] == target), None)
    if state is None or task is None or task["status"] != "launching" or task.get("callId") is not None:
        raise RuntimeError("campaign task has no ambiguous unbound launch intent")
    owner_id = f"recovery-{uuid.uuid4().hex}"
    claimed = campaign_state_mutator.remote({"campaign_root": campaign_root, "operation": "claim",
        "payload": {"expectedRevision": state["revision"], "ownerId": owner_id,
            "nowMs": int(time.time() * 1000), "leaseMs": 60_000}})
    state, scheduler = claimed["state"], claimed["scheduler"]
    changed = campaign_state_mutator.remote({"campaign_root": campaign_root,
        "operation": "recover-launch", "payload": {
            "expectedSchedulerRevision": scheduler["revision"], "fencingToken": state["fencingToken"],
            "expectedRevision": state["revision"], "ownerId": owner_id,
            "stageKey": f"{task['kingdomId']}:{task['stage']}",
            "recovery": {"taskId": target, "nowMs": int(time.time() * 1000)}}})
    recovered_task = next(held for held in changed["scheduler"]["tasks"] if held["taskId"] == target)
    return {"status": "recovered", "target": target,
        "controllerFence": changed["state"]["fencingToken"], "taskStatus": recovered_task["status"]}


@app.local_entrypoint()
def campaign_recover_entry(campaign_root: str, evidence_hash: str, target: str,
                           assertion: str) -> None:
    print(json.dumps(_recover_campaign_launch(campaign_root, evidence_hash, target, assertion)))


@app.local_entrypoint()
def campaign_run_entry(launch_config: str, download_dir: str, existing_root: str = "") -> None:
    bundle = json.loads(pathlib.Path(launch_config).read_text())
    if set(bundle) != {"schemaVersion", "campaignRoot", "evidenceHash", "runtimeHash", "sourceRepair",
            "state", "scheduler", "tasks", "files", "controller"} or bundle["schemaVersion"] != 1:
        raise ValueError("campaign launch bundle is malformed")
    repair = bundle["sourceRepair"]
    if repair is not None:
        validated_repair = _campaign_node(
            ["npx", "tsx", "scripts/strategy_search_campaign_source_repair.ts"],
            {"repair": repair, "evidenceHash": bundle["evidenceHash"],
             "executionSourceImage": bundle["controller"]["source_image"]}, cwd=PROJECT_ROOT)
        repair_path = f"control/source-repairs/{validated_repair['lineageHash']}.json"
        if bundle["files"].get(repair_path) != validated_repair:
            raise ValueError("campaign source repair lineage file differs")
    request = {"campaign_root": bundle["campaignRoot"], "evidence_hash": bundle["evidenceHash"],
        "state": bundle["state"], "scheduler": bundle["scheduler"], "tasks": bundle["tasks"],
        "files": bundle["files"]}
    campaign_initialize.remote(request)
    status = campaign_read_status.remote({"campaign_root": bundle["campaignRoot"],
        "evidence_hash": bundle["evidenceHash"]})
    saved = status.get("controllerCall")
    owner_id = saved.get("ownerId") if saved else None
    if saved and not saved.get("callId"):
        raise RuntimeError("campaign controller has a durable unbound launch intent; automatic relaunch is unsafe")
    owner_id = owner_id or f"operator-{uuid.uuid4().hex}"
    call = modal.FunctionCall.from_id(saved["callId"]) if saved else None
    if call is not None:
        try:
            call.get(timeout=0)
        except ModalTimeoutError:
            pass
        except Exception:
            campaign_controller_call_mutator.remote({"campaign_root": bundle["campaignRoot"],
                "evidence_hash": bundle["evidenceHash"], "operation": "clear",
                "call_id": call.object_id, "owner_id": owner_id})
            call = None
        else:
            refreshed = campaign_read_status.remote({"campaign_root": bundle["campaignRoot"],
                "evidence_hash": bundle["evidenceHash"]})
            statuses = {task["status"] for task in refreshed["scheduler"]["tasks"]}
            if statuses - {"complete", "terminal-incomplete", "incomplete"}:
                campaign_controller_call_mutator.remote({"campaign_root": bundle["campaignRoot"],
                    "evidence_hash": bundle["evidenceHash"], "operation": "clear",
                    "call_id": call.object_id, "owner_id": owner_id})
                call = None
    if call is None:
        latest = campaign_read_status.remote({"campaign_root": bundle["campaignRoot"],
            "evidence_hash": bundle["evidenceHash"]})
        controller = {**bundle["controller"], "claim": {**bundle["controller"]["claim"],
            "expectedRevision": latest["state"]["revision"], "ownerId": owner_id}}
        reserved = campaign_controller_call_mutator.remote({"campaign_root": bundle["campaignRoot"],
            "evidence_hash": bundle["evidenceHash"], "operation": "reserve", "call_id": "",
            "owner_id": owner_id})["controllerCall"]
        if reserved["ownerId"] != owner_id:
            if not reserved.get("callId"):
                raise RuntimeError("another campaign controller has an unbound launch intent")
            call = modal.FunctionCall.from_id(reserved["callId"])
            owner_id = reserved["ownerId"]
        else:
            call = campaign_controller.spawn(controller)
            campaign_controller_call_mutator.remote({"campaign_root": bundle["campaignRoot"],
                "evidence_hash": bundle["evidenceHash"], "operation": "bind", "call_id": call.object_id,
                "owner_id": owner_id})
    try:
        outcome = call.get(timeout=bundle["controller"]["controller_timeout_seconds"] + 120)
    except Exception:
        campaign_controller_call_mutator.remote({"campaign_root": bundle["campaignRoot"],
            "evidence_hash": bundle["evidenceHash"], "operation": "clear", "call_id": call.object_id,
            "owner_id": owner_id})
        raise
    packaged = campaign_package_download.remote({"campaign_root": bundle["campaignRoot"],
        "evidence_hash": bundle["evidenceHash"],
        "reconciled_scheduler_hash": outcome["schedulerHash"],
        "controller_fence": outcome["controllerFence"]})
    destination = pathlib.Path(download_dir)
    _download_campaign_file(f"{bundle['campaignRoot']}/download/content-index.json",
        destination / "content-index.json")
    _download_campaign_file(f"{bundle['campaignRoot']}/download/archives.json",
        destination / "archives.json")
    content_index = json.loads((destination / "content-index.json").read_text())
    archives = json.loads((destination / "archives.json").read_text())
    if content_index.get("indexHash") != packaged["indexHash"] \
            or archives.get("manifestHash") != packaged["archiveManifestHash"]:
        raise RuntimeError("downloaded campaign control hashes differ from packaging result")
    existing = pathlib.Path(existing_root) if existing_root else None
    for archive in archives["archives"]:
        members = [entry for entry in content_index["entries"]
                   if entry["stageId"] == archive["stageId"]
                   and entry["completeness"] == archive["completeness"]]
        members.sort(key=lambda entry: entry["path"])
        member_hash = _campaign_archive_member_hash(members)
        if len(members) != archive["memberCount"] or member_hash != archive["memberHash"]:
            raise RuntimeError("campaign archive compact membership differs from downloaded index")
        if existing is not None and all(_local_campaign_file_matches(existing, member)
                                        for member in members):
            continue
        _download_campaign_file(f"{bundle['campaignRoot']}/download/{archive['path']}",
            destination / archive["path"])
    print(json.dumps({"outcome": outcome, "downloadDir": str(destination),
        "indexHash": packaged["indexHash"],
        "archiveManifestHash": packaged["archiveManifestHash"]}))


def validate_launch_limits(
    *, count: int, start_position: int, shard_size: int, cpu: int, memory_gib: int,
    threads: int, max_containers: int, timeout_seconds: int, max_cost_usd: float,
    chunk_size: int, shuffles: int, scorer: str, product: bool,
    kingdom: str = DEFAULT_ORDERED_PRODUCT_KINGDOM,
    ordered_product: bool = False, retained_count: int = ORDERED_PRODUCT_RETAINED_COUNT,
    reservoir_count: int = ORDERED_PRODUCT_RESERVOIR_COUNT,
    authorization: str = "", prior_actual_usd: float = 0.0,
    continuation_run_id: str = "", shuffle_seeds: list[int] | None = None
) -> dict[str, Any]:
    if min(count, shard_size, cpu, memory_gib, threads, max_containers,
           timeout_seconds, chunk_size, shuffles) < 1:
        raise ValueError("counts and resource limits must be positive")
    if shuffle_seeds is None:
        shuffle_seeds = [4_100_000 + index for index in range(shuffles)]
    if not shuffle_seeds or any(not isinstance(seed, int) or seed < 0 for seed in shuffle_seeds) \
            or len(set(shuffle_seeds)) != len(shuffle_seeds):
        raise ValueError("shuffle seeds must be distinct nonnegative integers")
    if scorer != "rust":
        raise ValueError("Modal production supports only the standalone Rust scorer")
    if threads > cpu:
        raise ValueError("Rust/worker threads cannot exceed the integer CPU request")
    if product and ordered_product:
        raise ValueError("choose only one product mode")
    if not ordered_product and (authorization or continuation_run_id or prior_actual_usd):
        raise ValueError("ordered product authorization is not valid for this mode")
    if kingdom not in ORDERED_PRODUCT_AUTHORIZATIONS:
        raise ValueError(f"unsupported ordered product kingdom {kingdom}")
    if product and kingdom != DEFAULT_ORDERED_PRODUCT_KINGDOM:
        raise ValueError("the seeded-random product supports only deep-beam-tuning-009")
    aggregate_cpu = cpu if product else 1 + cpu * max_containers
    if aggregate_cpu > MAX_PHYSICAL_CORES:
        raise ValueError(f"aggregate allocation exceeds {MAX_PHYSICAL_CORES} physical cores")
    end_position = start_position + count
    if ordered_product:
        if start_position != 0 or count != FULL_CANDIDATE_COUNT:
            raise ValueError("ordered product must score the complete ordered candidate space")
        authorization_contract = ORDERED_PRODUCT_AUTHORIZATION_CONTRACTS.get(authorization)
        if authorization_contract is None or authorization_contract["kingdom"] != kingdom \
                or authorization_contract["shuffle_seeds"] != shuffle_seeds:
            raise ValueError("ordered product authorization does not match the exact kingdom and seed set")
        if prior_actual_usd < 0 or (continuation_run_id and prior_actual_usd <= 0):
            raise ValueError("ordered product continuation actual cost is invalid")
        if retained_count < 1 or reservoir_count < 1 or reservoir_count > retained_count \
                or retained_count > count:
            raise ValueError("ordered product retained and reservoir counts are invalid")
        stage_one_shards = math.ceil(count / shard_size)
        stage_two_shards = math.ceil(retained_count / shard_size)
        projected = projected_ordered_product_cost_usd(stage_one_shards, stage_two_shards,
            cpu, memory_gib, timeout_seconds, max_containers)
        full_run = True
        if projected + prior_actual_usd > 5:
            raise ValueError("ordered product continuation gross worst-case cost exceeds $5")
        waves = math.ceil(stage_one_shards / max_containers) + math.ceil(stage_two_shards / max_containers)
        controller_timeout = (MAX_RETRIES + 1) * waves * (timeout_seconds + 30) + 3900
    elif product:
        if start_position != 0 or count > 500_000 or count < 20_000:
            raise ValueError("product count must be from 20,000 through 500,000 with start position zero")
        if max_containers != 1:
            raise ValueError("the ordered product coordinator requires --max-containers 1")
        projected = projected_product_cost_usd(cpu, memory_gib, timeout_seconds)
        full_run = count == 500_000
        controller_timeout = (MAX_RETRIES + 1) * (timeout_seconds + 30) + 300
    else:
        if start_position < 0 or end_position > FULL_CANDIDATE_COUNT:
            raise ValueError("candidate range is outside the ordered space")
        shard_count = math.ceil(count / shard_size)
        projected = projected_cost_usd(shard_count, cpu, memory_gib, timeout_seconds, max_containers)
        full_run = start_position == 0 and count == FULL_CANDIDATE_COUNT
        controller_timeout = (MAX_RETRIES + 1) * math.ceil(shard_count / max_containers) \
            * (timeout_seconds + 30) + 300
    if projected > max_cost_usd:
        raise ValueError(f"worst-case cost ${projected:.4f} exceeds run cap ${max_cost_usd:.4f}")
    if full_run and max_cost_usd > 5:
        raise ValueError("a full production run cap cannot exceed $5")
    return {"end_position": end_position, "projected": projected, "full_run": full_run,
            "controller_timeout": controller_timeout, "aggregate_cpu": aggregate_cpu,
            "shuffle_seeds": shuffle_seeds}


@app.local_entrypoint()
def launch(
    build_version: str,
    rule_fingerprint: str,
    kingdom: str = DEFAULT_ORDERED_PRODUCT_KINGDOM,
    count: int = 5_000,
    start_position: int = 0,
    shard_size: int = 2_500,
    cpu: int = 4,
    memory_gib: int = 4,
    threads: int = 4,
    max_containers: int = 2,
    timeout_seconds: int = 600,
    max_cost_usd: float = 5.0,
    chunk_size: int = 250,
    shuffles: int = 1,
    scorer: str = "rust",
    product: bool = False,
    pool_seed: int = 5,
    ordered_product: bool = False,
    retained_count: int = ORDERED_PRODUCT_RETAINED_COUNT,
    reservoir_count: int = ORDERED_PRODUCT_RESERVOIR_COUNT,
    authorization: str = "",
    continuation_run_id: str = "",
    prior_actual_usd: float = 0.0,
    shuffle_seeds: str = "",
) -> None:
    try:
        parsed_shuffle_seeds = [int(seed) for seed in shuffle_seeds.split(",")] \
            if shuffle_seeds else ORDERED_PRODUCT_SEEDS if ordered_product else None
    except ValueError as error:
        raise ValueError("--shuffle-seeds must be comma-separated integers") from error
    limits = validate_launch_limits(count=count, start_position=start_position,
        shard_size=shard_size, cpu=cpu, memory_gib=memory_gib, threads=threads,
        max_containers=max_containers, timeout_seconds=timeout_seconds,
        max_cost_usd=max_cost_usd, chunk_size=chunk_size, shuffles=shuffles,
        scorer=scorer, product=product, kingdom=kingdom, ordered_product=ordered_product,
        retained_count=retained_count, reservoir_count=reservoir_count,
        authorization=authorization, continuation_run_id=continuation_run_id,
        prior_actual_usd=prior_actual_usd, shuffle_seeds=parsed_shuffle_seeds)
    end_position = limits["end_position"]
    projected = limits["projected"]
    full_run = limits["full_run"]
    controller_timeout = limits["controller_timeout"]
    config = {
        "kind": "ordered-product" if ordered_product else "product" if product else "ordered",
        "kingdom": kingdom,
        "build_version": build_version,
        "rule_fingerprint": rule_fingerprint,
        "count": count,
        "pool_seed": pool_seed,
        "retained_count": retained_count,
        "reservoir_count": reservoir_count,
        "authorization": authorization,
        "continuation_run_id": continuation_run_id,
        "prior_actual_usd": prior_actual_usd,
        "start_position": start_position,
        "end_position": end_position,
        "shard_size": shard_size,
        "cpu": cpu,
        "memory_gib": memory_gib,
        "threads": threads,
        "max_containers": max_containers,
        "timeout_seconds": timeout_seconds,
        "chunk_size": chunk_size,
        "shuffles": len(limits["shuffle_seeds"]),
        "shuffle_seeds": limits["shuffle_seeds"],
        "scorer": scorer,
        "controller_timeout": controller_timeout,
    }
    identity = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:20]
    run_id = f"native-{build_version[:12]}-{identity}"
    config["run_id"] = run_id
    entry = reserve_cost(run_id, projected, full_run, config)
    print(json.dumps({
        "runId": run_id,
        "profile": "ryanburnettebrown",
        "worstCaseCostUsd": projected,
        "reservation": entry,
        "resultLocation": f"hexdeck-native-strategy-results:/{run_id}/{'ranked.json' if ordered_product else 'pool.json' if product else 'merge.json'}",
    }, indent=2))
    if entry.get("status") == "launched" and entry.get("controllerCallId"):
        try:
            modal.FunctionCall.from_id(entry["controllerCallId"]).get(timeout=0)
        except ModalTimeoutError:
            print(f"controller still owns run {run_id}; no duplicate was launched")
            return
        except Exception:
            update_run_status(run_id, "reserved")
        else:
            update_run_status(run_id, "complete")
            print(f"run {run_id} is already complete")
            return
    if not claim_controller(run_id, config["controller_timeout"]):
        print(f"controller already owns run {run_id}; no duplicate was launched")
        return
    if ordered_product:
        call = ordered_product_controller.with_options(timeout=config["controller_timeout"], retries=0).spawn(config)
    elif product:
        call = product_search.with_options(cpu=cpu, memory=memory_gib * 1024,
            timeout=timeout_seconds + 30, retries=MAX_RETRIES).spawn(config)
    else:
        call = controller.with_options(timeout=config["controller_timeout"], retries=0).spawn(config)
    record_controller_call(run_id, call.object_id)
    mode = "ordered-product" if ordered_product else "product" if product else "ordered"
    print(f"detached {mode} call: {call.object_id}")


def _competitive_launch_data(
    content: str, build_version: str, cpu: int, memory_gib: int, threads: int,
    max_containers: int, timeout_seconds: int, max_cost_usd: float, target_blocks: int
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], str]:
    value = validate_competitive_input(json.loads(content))
    payload = value["loadRequest"]["payload"]
    if payload["threads"] != threads or payload["cpuRequest"] != cpu:
        raise ValueError("competitive input CPU and thread values differ from launch resources")
    limits = validate_competitive_launch(candidate_count=value["candidateCount"],
        schedule_count=len(value["schedule"]), cpu=cpu, memory_gib=memory_gib,
        threads=threads, max_containers=max_containers, timeout_seconds=timeout_seconds,
        max_cost_usd=max_cost_usd, target_blocks=target_blocks)
    config = {"kind": "competitive-psro", "build_version": build_version,
        "rule_fingerprint": payload["ruleFingerprint"], "input_hash": value["inputHash"],
        "look_id": value["lookId"], "candidate_count": value["candidateCount"],
        "schedule_count": len(value["schedule"]), "cpu": cpu, "memory_gib": memory_gib,
        "threads": threads, "max_containers": max_containers,
        "timeout_seconds": timeout_seconds, "target_blocks": target_blocks,
        "controller_timeout": limits["controller_timeout"]}
    identity = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:20]
    run_id = f"competitive-{build_version[:12]}-{identity}"
    config["run_id"] = run_id
    return value, limits, config, run_id


def _stage_competitive_input(content: str, value: dict[str, Any], run_id: str) -> None:
    staged = stage_competitive_input.remote(run_id, content, value["inputHash"])
    if staged["candidateCount"] != value["candidateCount"] \
            or staged["scheduleCount"] != len(value["schedule"]):
        raise RuntimeError("staged competitive input returned the wrong dimensions")


def _competitive_controller_call(config: dict[str, Any], entry: dict[str, Any]) -> Any:
    call_id = entry.get("controllerCallId")
    if call_id and entry.get("status") in {"launched", "complete"}:
        return modal.FunctionCall.from_id(call_id)
    if not claim_controller(config["run_id"], config["controller_timeout"]):
        raise RuntimeError("competitive controller is launching without a recorded call; retry this command")
    call = competitive_controller.with_options(
        timeout=config["controller_timeout"], retries=0).spawn(config)
    record_controller_call(config["run_id"], call.object_id)
    return call


def _download_competitive_artifact(remote_path: str, output_file: pathlib.Path) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("wb", dir=output_file.parent, delete=False) as held:
        for chunk in volume.read_file(remote_path):
            held.write(chunk)
        held.flush()
        os.fsync(held.fileno())
        temporary = pathlib.Path(held.name)
    os.replace(temporary, output_file)


@app.local_entrypoint()
def launch_competitive(
    input_file: str,
    build_version: str,
    cpu: int = 4,
    memory_gib: int = 4,
    threads: int = 4,
    max_containers: int = 16,
    timeout_seconds: int = 180,
    max_cost_usd: float = COMPETITIVE_RUN_CAP_USD,
    target_blocks: int = COMPETITIVE_TARGET_BLOCKS,
) -> None:
    content = pathlib.Path(input_file).read_text()
    value, limits, config, run_id = _competitive_launch_data(content, build_version, cpu,
        memory_gib, threads, max_containers, timeout_seconds, max_cost_usd, target_blocks)
    entry = reserve_cost(run_id, limits["projected"], False, config)
    print(json.dumps({"runId": run_id, "worstCaseCostUsd": limits["projected"],
        "reservation": entry,
        "resultLocation": f"hexdeck-native-strategy-results:/{run_id}/looks/{value['lookId']}/manifest.json"},
        indent=2))
    _stage_competitive_input(content, value, run_id)
    call = _competitive_controller_call(config, entry)
    print(f"detached competitive PSRO call: {call.object_id}")


@app.local_entrypoint()
def run_competitive(
    input_file: str,
    output_file: str,
    build_version: str,
    cpu: int = 4,
    memory_gib: int = 4,
    threads: int = 4,
    max_containers: int = 16,
    timeout_seconds: int = 180,
    max_cost_usd: float = COMPETITIVE_RUN_CAP_USD,
    target_blocks: int = COMPETITIVE_TARGET_BLOCKS,
) -> None:
    content = pathlib.Path(input_file).read_text()
    value, limits, config, run_id = _competitive_launch_data(content, build_version, cpu,
        memory_gib, threads, max_containers, timeout_seconds, max_cost_usd, target_blocks)
    entry = reserve_cost(run_id, limits["projected"], False, config)
    print(json.dumps({"runId": run_id, "worstCaseCostUsd": limits["projected"],
        "reservation": entry}, indent=2))
    _stage_competitive_input(content, value, run_id)
    call = _competitive_controller_call(config, entry)
    try:
        manifest = call.get(timeout=config["controller_timeout"] + 60)
    except ModalTimeoutError as error:
        raise RuntimeError(f"competitive controller {call.object_id} is still running; rerun to resume") from error
    except Exception:
        update_run_status(run_id, "reserved")
        raise
    if manifest.get("status") != "success" or manifest.get("runId") != run_id \
            or manifest.get("lookId") != value["lookId"] \
            or manifest.get("inputHash") != value["inputHash"] \
            or manifest.get("candidateCount") != value["candidateCount"] \
            or manifest.get("scheduleCount") != len(value["schedule"]):
        update_run_status(run_id, "reserved")
        raise RuntimeError("competitive controller returned an invalid manifest")
    remote_path = f"{run_id}/looks/{value['lookId']}/complete.hps"
    local_path = pathlib.Path(output_file)
    _download_competitive_artifact(remote_path, local_path)
    header, _, _ = _read_competitive_artifact(local_path)
    if header["digest"] != manifest["completeDigest"] or header["inputHash"] != value["inputHash"]:
        local_path.unlink(missing_ok=True)
        update_run_status(run_id, "reserved")
        raise RuntimeError("downloaded competitive artifact failed manifest validation")
    update_run_status(run_id, "complete")
    print(json.dumps({"runId": run_id, "completeDigest": header["digest"],
        "outputFile": str(local_path)}, indent=2))
