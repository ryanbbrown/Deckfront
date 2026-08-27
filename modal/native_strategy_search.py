"""Detached, restart-safe Modal launcher for ordered native-strategy shards."""

from __future__ import annotations

import concurrent.futures
import fcntl
import hashlib
import json
import math
import os
import pathlib
import queue
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
STRATEGY_SEARCH_MAX_JOB_ATTEMPTS = 3
CAMPAIGN_RUST_GOLDFISH_BIN = "/workspace/rust/target/release/hexdeck-goldfish"
CAMPAIGN_STAGE_ONE_CHUNK_SIZE = 250_000
LEDGER_PATH = pathlib.Path.home() / ".hexdeck-modal-cost-ledger.json"

LOCAL_PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNTIME_WORKSPACE_ROOT = pathlib.Path(os.environ.get("HEXDECK_STRATEGY_WORKSPACE", "/workspace"))
PROJECT_ROOT = LOCAL_PROJECT_ROOT if modal.is_local() else RUNTIME_WORKSPACE_ROOT
_SOURCE_IMAGE_FILES = json.loads((PROJECT_ROOT / "strategy-search-image-files.json").read_text())
if not isinstance(_SOURCE_IMAGE_FILES, list) or not _SOURCE_IMAGE_FILES \
        or len(set(_SOURCE_IMAGE_FILES)) != len(_SOURCE_IMAGE_FILES):
    raise RuntimeError("strategy-search image allowlist is invalid")
for _relative in _SOURCE_IMAGE_FILES:
    if not isinstance(_relative, str) or not (PROJECT_ROOT / _relative).is_file():
        raise RuntimeError(f"strategy-search image allowlist file is missing: {_relative}")

app = modal.App("hexdeck-native-strategy-search")
volume = modal.Volume.from_name("hexdeck-native-strategy-results", create_if_missing=True)
image = modal.Image.from_registry("rust:1.98.0-slim-bookworm", add_python="3.12") \
    .apt_install("ca-certificates", "curl", "build-essential", "time") \
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs && node --version",
    )
_NODE_DEPENDENCY_FILES = {"package.json", "package-lock.json"}
_RUST_IMAGE_FILES = {relative for relative in _SOURCE_IMAGE_FILES
    if relative.startswith("rust/") and relative != "rust/rust-toolchain.toml"}
_APPLICATION_IMAGE_FILES = set(_SOURCE_IMAGE_FILES) - _NODE_DEPENDENCY_FILES - _RUST_IMAGE_FILES
if _NODE_DEPENDENCY_FILES | _RUST_IMAGE_FILES | _APPLICATION_IMAGE_FILES != set(_SOURCE_IMAGE_FILES):
    raise RuntimeError("strategy-search image layers differ from the source allowlist")


def _ignore_image_paths_except(allowed: set[str]):
    parents = {"."}
    for relative in allowed:
        parent = pathlib.PurePosixPath(relative).parent
        while parent.as_posix() != ".":
            parents.add(parent.as_posix())
            parent = parent.parent
    def ignore(path: pathlib.Path) -> bool:
        try:
            relative = path.relative_to(PROJECT_ROOT).as_posix()
        except ValueError:
            relative = path.as_posix()
        return relative not in allowed and relative not in parents
    return ignore


if modal.is_local():
    image = image.add_local_dir(PROJECT_ROOT, remote_path="/workspace", copy=True,
        ignore=_ignore_image_paths_except(_NODE_DEPENDENCY_FILES))
    image = image.run_commands("cd /workspace && npm ci")
    image = image.add_local_dir(PROJECT_ROOT, remote_path="/workspace", copy=True,
        ignore=_ignore_image_paths_except(_RUST_IMAGE_FILES))
    image = image.run_commands("cd /workspace/rust && cargo build --release")
    image = image.add_local_dir(PROJECT_ROOT, remote_path="/workspace", copy=True,
        ignore=_ignore_image_paths_except(_APPLICATION_IMAGE_FILES))


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
        executable = "/workspace/rust/target/release/hexdeck-goldfish"
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
        "HEXDECK_GOLDFISH_BIN": "/workspace/rust/target/release/hexdeck-goldfish",
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
        executable = "/workspace/rust/target/release/hexdeck-goldfish"
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


def _strategy_search_path(relative: str) -> pathlib.Path:
    if not isinstance(relative, str) or not relative or relative.startswith("/") or "\\" in relative \
            or any(part in {"", ".", ".."} for part in relative.split("/")):
        raise ValueError("strategy-search Volume path is invalid")
    root = pathlib.Path("/results").resolve()
    destination = (root / relative).resolve()
    if root not in destination.parents:
        raise ValueError("strategy-search Volume path escapes /results")
    return destination


def _strategy_search_sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _strategy_search_validate_compact(publication: dict[str, Any], temporary: pathlib.Path) -> None:
    expected_stage = "stage-one" if publication["stage"] == "goldfish-one" else "stage-two"
    expected_range = publication.get("range")
    if not expected_range:
        raise RuntimeError("compact publication has no semantic range")
    with temporary.open("rb") as stream:
        header_bytes = stream.read(512)
        if len(header_bytes) != 512 or header_bytes[:4] != b"HGS1":
            raise RuntimeError("compact publication header is invalid")
        length = struct.unpack(">I", header_bytes[4:8])[0]
        if length < 2 or length > 504 or any(header_bytes[8 + length:]):
            raise RuntimeError("compact publication header padding differs")
        header = json.loads(header_bytes[8:8 + length])
        required = {"schemaVersion", "magic", "stage", "evidenceId", "semanticStart", "semanticEnd",
                    "recordCount", "recordBytes", "payloadSha256"}
        if set(header) != required or header["schemaVersion"] != 1 or header["magic"] != "HGS1" \
                or header["stage"] != expected_stage or header["evidenceId"] != publication["evidenceId"] \
                or header["semanticStart"] != expected_range["start"] \
                or header["semanticEnd"] != expected_range["end"] \
                or header["recordCount"] != expected_range["end"] - expected_range["start"] \
                or header["recordBytes"] != 96 \
                or not re.fullmatch(r"[0-9a-f]{64}", header["payloadSha256"]):
            raise RuntimeError("compact publication semantic header differs")
        if temporary.stat().st_size != 512 + 96 * header["recordCount"]:
            raise RuntimeError("compact publication byte length differs")
        positions = bytearray(header["recordCount"])
        digest = hashlib.sha256()
        previous_key = None
        for _index in range(header["recordCount"]):
            record = stream.read(96)
            if len(record) != 96:
                raise RuntimeError("compact publication record is invalid")
            digest.update(record)
            position = struct.unpack(">I", record[:4])[0]
            offset = position - header["semanticStart"]
            if offset < 0 or offset >= len(positions) or positions[offset]:
                raise RuntimeError("compact publication positions overlap or escape the range")
            positions[offset] = 1
            metrics = struct.unpack(">15I", record[4:64])
            if any(metrics[start] < 1 or metrics[start + 1] > metrics[start] for start in (0, 5, 10)):
                raise RuntimeError("compact publication profile metrics are invalid")
            display_units = struct.unpack(">16H", record[64:96])
            try:
                padding = display_units.index(0)
            except ValueError:
                padding = len(display_units)
            if padding == 0 or any(display_units[padding:]):
                raise RuntimeError("compact publication display ID padding differs")
            key = (-min(metrics[1], metrics[6], metrics[11]),
                   -(metrics[1] + metrics[6] + metrics[11]),
                   max(metrics[2], metrics[7], metrics[12]),
                   metrics[2] + metrics[7] + metrics[12],
                   -min(metrics[3], metrics[8], metrics[13]),
                   -(metrics[3] + metrics[8] + metrics[13]),
                   -(metrics[4] + metrics[9] + metrics[14]), display_units[:padding])
            if previous_key is not None and previous_key > key:
                raise RuntimeError("compact publication records are not in semantic order")
            previous_key = key
        if any(value != 1 for value in positions) or digest.hexdigest() != header["payloadSha256"]:
            raise RuntimeError("compact publication coverage or checksum differs")


def _strategy_search_validate_publication(publication: dict[str, Any], temporary: pathlib.Path) -> None:
    stage = publication["stage"]
    if stage in {"goldfish-one", "goldfish-two"}:
        _strategy_search_validate_compact(publication, temporary)
        return
    subprocess.run(["npx", "tsx", "scripts/strategy_search_validate_artifact.ts", "--stage", stage,
        "--file", str(temporary), "--evidence-id", publication["evidenceId"],
        "--kingdom", publication["kingdomId"], "--evidence-root",
        str(_strategy_search_path(f"evidence/{publication['evidenceId']}"))], cwd="/workspace",
        text=True, capture_output=True, timeout=600, check=True)


def _strategy_search_source_digest(files: list[dict[str, Any]]) -> str:
    if [entry.get("path") for entry in files] != sorted(_SOURCE_IMAGE_FILES):
        raise ValueError("strategy-search source files differ from the image allowlist")
    lines = []
    for entry in files:
        source = RUNTIME_WORKSPACE_ROOT / entry["path"]
        content = source.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if entry.get("bytes") != len(content) or entry.get("sha256") != digest:
            raise RuntimeError(f"strategy-search source differs in image: {entry['path']}")
        lines.append(f"{entry['path']}\0{len(content)}\0{digest}\n")
    return hashlib.sha256("".join(lines).encode()).hexdigest()


_VERIFIED_STRATEGY_SEARCH_DIGESTS: set[str] = set()


def verify_strategy_search_source(identity: dict[str, Any]) -> None:
    if set(identity) != {"digest", "scientificDigest", "scientificPaths", "files"} \
            or not re.fullmatch(r"[0-9a-f]{64}", identity["digest"]) \
            or not re.fullmatch(r"[0-9a-f]{64}", identity["scientificDigest"]):
        raise ValueError("strategy-search source identity is malformed")
    if identity["digest"] in _VERIFIED_STRATEGY_SEARCH_DIGESTS:
        return
    if _strategy_search_source_digest(identity["files"]) != identity["digest"]:
        raise RuntimeError("strategy-search source digest differs inside the Modal image")
    scientific_paths = sorted(json.loads((RUNTIME_WORKSPACE_ROOT /
        "strategy-search-scientific-files.json").read_text()))
    if identity["scientificPaths"] != scientific_paths:
        raise RuntimeError("strategy-search scientific allowlist differs inside the Modal image")
    entries = {entry["path"]: entry for entry in identity["files"]}
    if any(relative not in entries for relative in scientific_paths):
        raise RuntimeError("strategy-search scientific file is absent from deployment identity")
    scientific_lines = "".join(f"{relative}\0{entries[relative]['bytes']}\0{entries[relative]['sha256']}\n"
        for relative in scientific_paths)
    if hashlib.sha256(scientific_lines.encode()).hexdigest() != identity["scientificDigest"]:
        raise RuntimeError("strategy-search scientific digest differs inside the Modal image")
    _VERIFIED_STRATEGY_SEARCH_DIGESTS.add(identity["digest"])


def _strategy_search_verify_goldfish_startup() -> None:
    _run_checked(["npx", "tsx", "scripts/strategy_search_goldfish.ts", "readiness",
        "--evidence-id", "0" * 64, "--kingdom", "deep-beam-tuning-007"],
        "strategy-search Goldfish worker readiness", cwd=RUNTIME_WORKSPACE_ROOT,
        text=True, capture_output=True, timeout=60)


@app.function(image=image, cpu=1, memory=2048, timeout=90, max_containers=1)
def strategy_search_compute_ready(source_identity: dict[str, Any]) -> dict[str, Any]:
    verify_strategy_search_source(source_identity)
    _strategy_search_verify_goldfish_startup()
    return {"ready": True, "sourceDigest": source_identity["digest"],
        "readyMs": int(time.time() * 1000)}


def _strategy_search_execution_file(execution_id: str) -> pathlib.Path:
    if not re.fullmatch(r"[0-9a-f]{64}", execution_id):
        raise ValueError("campaign execution ID is invalid")
    return _strategy_search_path(f"executions/{execution_id}/state.json")


def _strategy_search_evidence_state(evidence_id: str) -> pathlib.Path:
    if not re.fullmatch(r"[0-9a-f]{64}", evidence_id):
        raise ValueError("kingdom evidence ID is invalid")
    return _strategy_search_path(f"evidence/{evidence_id}/control/publication.json")


def _strategy_search_load(path: pathlib.Path, default: Any = None) -> Any:
    return json.loads(path.read_text()) if path.exists() else default


@app.function(image=image, cpu=1, memory=8192, timeout=900, max_containers=1,
              volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def strategy_search_publisher(request: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    operation = request.get("operation")
    if operation == "execution-init":
        execution_id = request["campaignExecutionId"]
        state_file = _strategy_search_execution_file(execution_id)
        saved = _strategy_search_load(state_file)
        if saved is None:
            raise RuntimeError("strategy-search execution has no verified compute preflight")
        if saved["orderedEvidenceIds"] != request["orderedEvidenceIds"]:
            raise RuntimeError("saved execution scientific identity differs")
        if saved.get("computePreflight", {}).get("sourceDigest") != request["sourceDigest"]:
            raise RuntimeError("saved execution compute identity differs")
        saved["maxActiveCpus"] = request["maxActiveCpus"]
        saved["admissionLimitCpus"] = min(request["maxActiveCpus"],
            max(4, saved.get("admissionLimitCpus", request["maxActiveCpus"])))
        saved["revision"] += 1
        _atomic_json(state_file, saved)
        volume.commit()
        return saved
    if operation == "controller-claim":
        state_file = _strategy_search_execution_file(request["campaignExecutionId"])
        state = _strategy_search_load(state_file)
        now = request["nowMs"]
        if state is None:
            raise RuntimeError("strategy-search execution is not initialized")
        controller = state.get("controller")
        if controller and controller["leaseUntilMs"] > now and controller["ownerId"] != request["ownerId"]:
            raise RuntimeError("strategy-search controller lease is active")
        if not controller or controller["ownerId"] != request["ownerId"]:
            state["controllerFence"] += 1
        state["controller"] = {"ownerId": request["ownerId"], "leaseUntilMs": now + request["leaseMs"],
            "fence": state["controllerFence"]}
        state["revision"] += 1
        _atomic_json(state_file, state)
        volume.commit()
        return state
    if operation == "execution-save":
        state_file = _strategy_search_execution_file(request["campaignExecutionId"])
        saved = _strategy_search_load(state_file)
        state = request["state"]
        controller = saved.get("controller") if saved else None
        if saved is None or saved["controllerFence"] != request["fence"] \
                or state["controllerFence"] != request["fence"] or not controller \
                or controller["ownerId"] != request["ownerId"]:
            raise RuntimeError("strategy-search execution save is fenced out")
        state["maxActiveCpus"] = saved["maxActiveCpus"]
        state["controller"]["leaseUntilMs"] = request["nowMs"] + request["leaseMs"]
        if state.get("usefulWorkStartedMs") is None and state.get("status") == "running" \
                and any(job.get("status") in {"active", "complete"} for job in state["jobs"]):
            state["usefulWorkStartedMs"] = request["nowMs"]
        state["revision"] = saved["revision"] + 1
        _atomic_json(state_file, state)
        volume.commit()
        return state
    if operation == "status":
        return _strategy_search_load(_strategy_search_execution_file(request["campaignExecutionId"]))
    if operation == "evidence-complete":
        evidence_id = request["evidenceId"]
        state = _strategy_search_load(_strategy_search_evidence_state(evidence_id))
        task_ids = request.get("taskIds", {})
        if state is None or set(task_ids) != {"goldfish-one-reduce", "goldfish-two-reduce", "matrix", "psro"}:
            return {"complete": False}
        receipts = {}
        for stage, task_id in task_ids.items():
            receipt = state.get("receipts", {}).get(task_id)
            if not receipt:
                return {"complete": False}
            artifact = _strategy_search_path(receipt["artifactPath"])
            if not artifact.exists() or _strategy_search_sha256(artifact) != receipt["sha256"]:
                raise RuntimeError(f"complete evidence receipt differs for {stage}")
            receipts[stage] = receipt
        return {"complete": True, "receipts": receipts}
    if operation == "execution-fail":
        state_file = _strategy_search_execution_file(request["campaignExecutionId"])
        state = _strategy_search_load(state_file)
        if state is None:
            raise RuntimeError("strategy-search execution is missing during failure persistence")
        failed_ms = request.get("nowMs", int(time.time() * 1000))
        attempts = [attempt for job in state.get("jobs", []) for attempt in job.get("attempts", [])]
        costs = [_strategy_search_attempt_cost(attempt, failed_ms) for attempt in attempts
            if attempt.get("status") != "admission-failed"]
        state.update({"status": "failed", "failedMs": failed_ms,
            "failure": str(request.get("failure", "unknown controller failure"))[-4000:],
            "failureAttemptCosts": costs,
            "failureAttemptCostUsdUpperBound": sum(entry["costUsd"] for entry in costs)})
        state["revision"] += 1
        _atomic_json(state_file, state)
        volume.commit()
        return state
    if operation == "prepare-launch-batch":
        items = request.get("items")
        if not isinstance(items, list) or not items:
            raise ValueError("launch preparation batch is empty")
        now = request.get("nowMs", int(time.time() * 1000))
        execution = _strategy_search_load(_strategy_search_execution_file(request["campaignExecutionId"]))
        controller = execution.get("controller") if execution else None
        if not controller or controller["ownerId"] != request["controllerOwnerId"] \
                or controller["fence"] != request["controllerFence"] or controller["leaseUntilMs"] <= now:
            raise RuntimeError("launch preparation is fenced from its controller")
        states, results = {}, {}
        for item in items:
            evidence_id, task_id = item["evidenceId"], item["taskId"]
            state_file = _strategy_search_evidence_state(evidence_id)
            state = states.setdefault(evidence_id, _strategy_search_load(state_file,
                {"schemaVersion": 1, "evidenceId": evidence_id, "leases": {}, "intents": {}, "receipts": {}}))
            receipt = state["receipts"].get(task_id)
            if receipt:
                destination = _strategy_search_path(receipt["artifactPath"])
                if not destination.exists() or _strategy_search_sha256(destination) != receipt["sha256"]:
                    raise RuntimeError("publication receipt has no matching artifact")
                results[task_id] = {"complete": True, "receipt": receipt}
                continue
            lease = state["leases"].get(task_id)
            lease_execution = _strategy_search_load(_strategy_search_execution_file(
                lease["campaignExecutionId"])) if lease and lease.get("campaignExecutionId") else None
            lease_controller = lease_execution.get("controller") if lease_execution else None
            lease_is_current = lease_controller and lease_controller["fence"] == lease.get("controllerFence") \
                and lease_controller["ownerId"] == lease.get("controllerOwnerId")
            if lease and lease["leaseUntilMs"] > now and lease["ownerId"] != request["ownerId"] and lease_is_current:
                results[task_id] = {"busy": True, "leaseUntilMs": lease["leaseUntilMs"]}
                continue
            fence = (lease["fence"] if lease else 0) + 1
            state["leases"][task_id] = {"ownerId": request["ownerId"], "fence": fence,
                "heartbeatMs": now, "leaseUntilMs": now + request["leaseMs"],
                "campaignExecutionId": request["campaignExecutionId"],
                "controllerOwnerId": request["controllerOwnerId"], "controllerFence": request["controllerFence"]}
            state["intents"][task_id] = {"launchId": item["launchId"], "ownerId": request["ownerId"],
                "fence": fence, "artifactPath": item["artifactPath"], "temporaryPath": item["temporaryPath"],
                "campaignExecutionId": request["campaignExecutionId"], "controllerFence": request["controllerFence"]}
            results[task_id] = {"complete": False, "fence": fence,
                "leaseUntilMs": now + request["leaseMs"], "launchId": item["launchId"],
                "temporaryPath": item["temporaryPath"]}
        for evidence_id, state in states.items():
            _atomic_json(_strategy_search_evidence_state(evidence_id), state)
        if execution.get("usefulWorkStartedMs") is None:
            execution["usefulWorkStartedMs"] = now
            execution["revision"] += 1
            _atomic_json(_strategy_search_execution_file(request["campaignExecutionId"]), execution)
        volume.commit()
        return results
    if operation == "publish-batch":
        publication_started = time.monotonic()
        publication_started_epoch_ms = int(time.time() * 1000)
        publications = request.get("publications")
        if not isinstance(publications, list) or not publications:
            raise ValueError("publication batch is empty")
        validated = []
        states = {}
        now = request.get("nowMs", int(time.time() * 1000))
        for publication in publications:
            evidence_id = publication["evidenceId"]
            state_file = _strategy_search_evidence_state(evidence_id)
            state = states.setdefault(evidence_id, _strategy_search_load(state_file))
            task_id = publication["taskId"]
            lease, intent = state["leases"].get(task_id), state["intents"].get(task_id)
            execution = _strategy_search_load(_strategy_search_execution_file(publication["campaignExecutionId"]))
            controller = execution.get("controller") if execution else None
            if not lease or not intent or lease["fence"] != publication["fence"] \
                    or intent["fence"] != publication["fence"] or lease["leaseUntilMs"] <= now \
                    or intent["launchId"] != publication["launchId"] or not controller \
                    or controller["ownerId"] != publication["controllerOwnerId"] \
                    or controller["fence"] != publication["controllerFence"] or controller["leaseUntilMs"] <= now \
                    or lease["campaignExecutionId"] != publication["campaignExecutionId"] \
                    or lease["controllerFence"] != publication["controllerFence"]:
                raise RuntimeError("publication batch contains a stale orphan")
            temporary = _strategy_search_path(intent["temporaryPath"])
            destination = _strategy_search_path(intent["artifactPath"])
            digest = _strategy_search_sha256(temporary)
            if digest != publication["sha256"]:
                raise RuntimeError("publication batch temporary hash differs")
            receipt = state["receipts"].get(task_id)
            if receipt and (receipt["sha256"] != digest or not destination.exists()
                            or _strategy_search_sha256(destination) != digest):
                raise RuntimeError("publication batch receipt conflicts")
            if destination.exists() and _strategy_search_sha256(destination) != digest:
                raise RuntimeError("publication batch deterministic bytes conflict")
            if publication.get("validatedSha256") != digest:
                raise RuntimeError("publication batch lacks matching out-of-lock validation")
            validated.append((publication, state_file, state, intent, temporary, destination, digest, receipt))
        for _publication, _state_file, _state, _intent, temporary, destination, _digest, receipt in validated:
            if receipt:
                temporary.unlink()
            elif destination.exists():
                temporary.unlink()
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.replace(temporary, destination)
        volume.commit()
        receipts = {}
        for publication, _state_file, state, intent, _temporary, _destination, digest, receipt in validated:
            if not receipt:
                receipt = {"taskId": publication["taskId"], "evidenceId": publication["evidenceId"],
                    "artifactPath": intent["artifactPath"], "sha256": digest, "fence": publication["fence"]}
                state["receipts"][publication["taskId"]] = receipt
            receipts[publication["taskId"]] = receipt
        for evidence_id, state in states.items():
            _atomic_json(_strategy_search_evidence_state(evidence_id), state)
        volume.commit()
        return {"receipts": receipts, "publicationStartedEpochMs": publication_started_epoch_ms,
            "publicationCommitMs": round((time.monotonic() - publication_started) * 1000, 3)}

    evidence_id = request["evidenceId"]
    state_file = _strategy_search_evidence_state(evidence_id)
    state = _strategy_search_load(state_file, {"schemaVersion": 1, "evidenceId": evidence_id,
        "leases": {}, "intents": {}, "receipts": {}})
    now = request.get("nowMs", int(time.time() * 1000))
    task_id = request.get("taskId")
    if operation in {"claim", "heartbeat", "intent"}:
        execution = _strategy_search_load(_strategy_search_execution_file(request["campaignExecutionId"]))
        controller = execution.get("controller") if execution else None
        if not controller or controller["ownerId"] != request["controllerOwnerId"] \
                or controller["fence"] != request["controllerFence"] or controller["leaseUntilMs"] <= now:
            raise RuntimeError("scientific task operation is fenced from its controller")
    if operation == "claim":
        receipt = state["receipts"].get(task_id)
        if receipt:
            destination = _strategy_search_path(receipt["artifactPath"])
            if not destination.exists() or _strategy_search_sha256(destination) != receipt["sha256"]:
                raise RuntimeError("publication receipt has no matching artifact")
            return {"complete": True, "receipt": receipt}
        lease = state["leases"].get(task_id)
        lease_execution = _strategy_search_load(_strategy_search_execution_file(
            lease["campaignExecutionId"])) if lease and lease.get("campaignExecutionId") else None
        lease_controller = lease_execution.get("controller") if lease_execution else None
        lease_is_current = lease_controller and lease_controller["fence"] == lease.get("controllerFence") \
            and lease_controller["ownerId"] == lease.get("controllerOwnerId")
        if lease and lease["leaseUntilMs"] > now and lease["ownerId"] != request["ownerId"] and lease_is_current:
            return {"busy": True, "leaseUntilMs": lease["leaseUntilMs"]}
        fence = (lease["fence"] if lease else 0) + 1
        state["leases"][task_id] = {"ownerId": request["ownerId"], "fence": fence,
            "heartbeatMs": now, "leaseUntilMs": now + request["leaseMs"],
            "campaignExecutionId": request["campaignExecutionId"],
            "controllerOwnerId": request["controllerOwnerId"], "controllerFence": request["controllerFence"]}
        _atomic_json(state_file, state)
        volume.commit()
        return state["leases"][task_id]
    if operation == "heartbeat":
        lease = state["leases"].get(task_id)
        if not lease or lease["ownerId"] != request["ownerId"] or lease["fence"] != request["fence"] \
                or lease["leaseUntilMs"] <= now or lease["campaignExecutionId"] != request["campaignExecutionId"] \
                or lease["controllerFence"] != request["controllerFence"]:
            raise RuntimeError("scientific task heartbeat is stale or expired")
        lease["heartbeatMs"] = now
        lease["leaseUntilMs"] = now + request["leaseMs"]
        _atomic_json(state_file, state)
        volume.commit()
        return lease
    if operation == "intent":
        lease = state["leases"].get(task_id)
        if not lease or lease["fence"] != request["fence"] or lease["ownerId"] != request["ownerId"] \
                or lease["campaignExecutionId"] != request["campaignExecutionId"] \
                or lease["controllerFence"] != request["controllerFence"]:
            raise RuntimeError("scientific launch intent is unleased")
        intended = request["artifactPath"]
        receipt = state["receipts"].get(task_id)
        destination = _strategy_search_path(intended)
        if receipt:
            if not destination.exists() or _strategy_search_sha256(destination) != receipt["sha256"]:
                raise RuntimeError("publication receipt has no matching artifact")
            return {"complete": True, "receipt": receipt}
        state["intents"][task_id] = {"launchId": request["launchId"], "ownerId": request["ownerId"],
            "fence": request["fence"], "artifactPath": intended, "temporaryPath": request["temporaryPath"],
            "campaignExecutionId": request["campaignExecutionId"], "controllerFence": request["controllerFence"]}
        _atomic_json(state_file, state)
        volume.commit()
        return {"complete": False}
    raise ValueError(f"unknown strategy-search publisher operation {operation}")


def _strategy_search_run_subprocess(command: list[str], config: dict[str, Any]) -> dict[str, Any]:
    verify_strategy_search_source(config["sourceImage"])
    started = time.monotonic()
    process = subprocess.Popen(command, cwd="/workspace", text=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, env={**os.environ, "HEXDECK_GOLDFISH_BIN": CAMPAIGN_RUST_GOLDFISH_BIN})
    output: queue.Queue[tuple[str, str | None]] = queue.Queue()
    def read_stream(label: str, stream: Any) -> None:
        for line in stream:
            output.put((label, line))
        output.put((label, None))
    readers = [threading.Thread(target=read_stream, args=("stdout", process.stdout), daemon=True),
        threading.Thread(target=read_stream, args=("stderr", process.stderr), daemon=True)]
    for reader in readers:
        reader.start()
    stdout_tail, stderr_tail, closed, checkpoint_count = "", "", set(), 0
    try:
        while process.poll() is None or len(closed) < 2:
            if time.monotonic() - started > config["timeoutSeconds"]:
                process.kill()
                raise RuntimeError("strategy-search task exceeded its bounded timeout")
            try:
                label, line = output.get(timeout=0.25)
            except queue.Empty:
                continue
            if line is None:
                closed.add(label)
                continue
            if label == "stderr":
                stderr_tail = (stderr_tail + line)[-65536:]
            else:
                stdout_tail = (stdout_tail + line)[-4000:]
                if config.get("checkpointCommits"):
                    try:
                        event = json.loads(line)
                        if event.get("type") == CAMPAIGN_CHECKPOINT_EVENT:
                            checkpoint_count += 1
                            if checkpoint_count % int(config["checkpointCommits"]) == 0:
                                volume.commit()
                    except (json.JSONDecodeError, AttributeError):
                        pass
        if process.wait() != 0:
            raise RuntimeError(f"strategy-search subprocess failed: {stderr_tail}")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        for reader in readers:
            reader.join(timeout=5)
    return {"elapsedMs": round((time.monotonic() - started) * 1000, 3),
        "workerFinishedEpochMs": int(time.time() * 1000), "checkpointCount": checkpoint_count}


@app.function(image=image, cpu=4, memory=4096, timeout=900, retries=0, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def strategy_search_goldfish_job(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    config["workerStartedEpochMs"] = int(time.time() * 1000)
    output = _strategy_search_path(config["temporaryPath"])
    phases = output.with_suffix(output.suffix + ".phases.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    command = ["npx", "tsx", "scripts/strategy_search_goldfish.ts", config["mode"],
        "--evidence-id", config["evidenceId"], "--kingdom", config["kingdomId"],
        "--out", str(output), "--phases", str(phases)]
    if config.get("range"):
        command += ["--start", str(config["range"]["start"]), "--end", str(config["range"]["end"]),
            "--cpu", str(config["cpu"]), "--threads", str(config["cpu"])]
    if config.get("manifest"):
        manifest = output.with_suffix(".manifest.json")
        _atomic_json(manifest, [_strategy_search_path(held).as_posix() for held in config["manifest"]])
        command += ["--manifest", str(manifest)]
    if config.get("topPath"):
        command += ["--top", str(_strategy_search_path(config["topPath"]))]
    result = _strategy_search_run_subprocess(command, config)
    phase_report = _strategy_search_load(phases)
    validated_sha256 = _strategy_search_sha256(output)
    _strategy_search_validate_publication(config, output)
    commit_started = time.monotonic()
    volume.commit()
    commit_ms = (time.monotonic() - commit_started) * 1000
    queue_ms = max(0, config["workerStartedEpochMs"] - config["enqueuedEpochMs"])
    phase_report["temporaryVolumeWriteCommitMs"] += commit_ms
    phase_report["orchestrationQueueMs"] += queue_ms
    phase_report["elapsedMs"] += commit_ms + queue_ms
    return {**result, "modalWorkerElapsedMs": result["elapsedMs"] + commit_ms,
        "sha256": validated_sha256, "validatedSha256": validated_sha256, "phases": phase_report,
        "workerStartedEpochMs": config["workerStartedEpochMs"],
        "workerFinishedEpochMs": int(time.time() * 1000), "temporaryPath": config["temporaryPath"]}


@app.function(image=image, cpu=4, memory=8192, timeout=900, retries=0, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def strategy_search_downstream_job(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    worker_started_ms = int(time.time() * 1000)
    stage_started = time.monotonic()
    output = _strategy_search_path(config["temporaryPath"])
    output.parent.mkdir(parents=True, exist_ok=True)
    work = _strategy_search_path(config["workRoot"])
    work.mkdir(parents=True, exist_ok=True)
    if config["stage"] == "matrix":
        manifest = work / "manifest.json"
        reservoir = _strategy_search_path(config["reservoirPath"])
        prepare = ["npx", "tsx", "scripts/strategy_search_campaign_matrix_manifest.ts",
            "--evidence-id", config["evidenceId"], "--kingdom", config["kingdomId"],
            "--reservoir", str(reservoir), "--reservoir-sha256", config["reservoirSha256"],
            "--seed-namespace", "strategy-search-matrix-v2", "--out", str(manifest)]
        _strategy_search_run_subprocess(prepare, config)
        evidence = work / "output"
        control = work / "control"
        command = ["npx", "tsx", "scripts/strategy_search_campaign_matrix.ts",
            "--manifest", str(manifest), "--out", str(evidence), "--control", str(control),
            "--workers", str(config["cpu"]), "--jobs-per-batch", str(max(1, config["cpu"])),
            "--runtime-chunk-size", "25", "--shutdown-at-ms",
            str(int((time.time() + config["timeoutSeconds"] - 20) * 1000))]
        result = _strategy_search_run_subprocess(command, config)
        shutil.copyfile(evidence / "evidence.json", output)
    else:
        stage_config = work / "psro-config.json"
        _atomic_json(stage_config, config["psroConfig"])
        command = ["npx", "tsx", "scripts/strategy_search_campaign_psro.ts", "--config", str(stage_config),
            "--shutdown-at-ms", str(int((time.time() + config["timeoutSeconds"] - 20) * 1000))]
        result = _strategy_search_run_subprocess(command, config)
        shutil.copyfile(pathlib.Path(config["psroConfig"]["outputRoot"]) / "evidence.json", output)
    validated_sha256 = _strategy_search_sha256(output)
    _strategy_search_validate_publication(config, output)
    commit_started = time.monotonic()
    volume.commit()
    result["modalWorkerElapsedMs"] = (time.monotonic() - stage_started) * 1000
    result["elapsedMs"] = result["modalWorkerElapsedMs"] \
        + max(0, worker_started_ms - config["enqueuedEpochMs"])
    result["workerFinishedEpochMs"] = int(time.time() * 1000)
    return {**result, "sha256": validated_sha256, "validatedSha256": validated_sha256,
        "workerStartedEpochMs": worker_started_ms, "temporaryPath": config["temporaryPath"]}


def _strategy_search_attempt_cost(attempt: dict[str, Any], until_ms: int) -> dict[str, Any]:
    elapsed_ms = attempt.get("modalWorkerElapsedMs")
    measured = isinstance(elapsed_ms, (int, float)) and elapsed_ms >= 0
    if not measured:
        elapsed_ms = max(0, attempt.get("finishedMs", until_ms) - attempt["submittedMs"])
    cost = elapsed_ms / 3_600_000 * (attempt["cpu"] * CPU_RATE_PER_CORE_HOUR
        + attempt["memoryMiB"] / 1024 * MEMORY_RATE_PER_GIB_HOUR)
    return {"elapsedMs": elapsed_ms, "costUsd": cost,
        "basis": "worker-measured" if measured else "submitted-upper-bound"}


def _strategy_search_is_admission_error(error: BaseException) -> bool:
    message = str(error).lower()
    return "admission" in message or "quota" in message \
        or "cpu limit" in message or "workspace limit" in message


def _strategy_search_is_terminal_worker_error(error: BaseException) -> bool:
    message = str(error).lower()
    return any(marker in message for marker in ["err_module_not_found", "module_not_found",
        "cannot find module", "cannot find package", "syntaxerror", "unknown file extension",
        "strategy-search source differs inside", "image allowlist file is missing"])


def _strategy_search_retryable_failure_count(job: dict[str, Any]) -> int:
    return sum(attempt.get("status") in {"failed", "launch-failed", "terminal-failed"}
        for attempt in job.get("attempts", []))


def _strategy_search_recover_admission(limit_cpus: int, max_cpus: int,
                                        job_cpus: int) -> int:
    if min(limit_cpus, max_cpus, job_cpus) < 1 or limit_cpus > max_cpus:
        raise ValueError("strategy-search admission recovery input is invalid")
    grown = max(limit_cpus + job_cpus, math.ceil(limit_cpus * 1.5 / job_cpus) * job_cpus)
    return min(max_cpus, grown)


def _strategy_search_ready_jobs(state: dict[str, Any]) -> list[dict[str, Any]]:
    complete = {job["taskId"] for job in state["jobs"] if job["status"] == "complete"}
    ready = []
    now = int(time.time() * 1000)
    priority = {"psro": 0, "matrix": 1, "goldfish-one-reduce": 2,
        "goldfish-two-reduce": 2, "goldfish-two": 3, "goldfish-one": 4}
    for job in state["jobs"]:
        if job["status"] == "retry-backoff" and job.get("retryNotBeforeMs", 0) <= now:
            job["status"] = "ready"
        if job["status"] in {"blocked", "ready"} and all(held in complete for held in job["dependencyTaskIds"]):
            job["status"] = "ready"
            ready.append(job)
    groups = {}
    for job in ready:
        groups.setdefault((priority[job["stage"]], job["kingdomId"]), []).append(job)
    for jobs in groups.values():
        jobs.sort(key=lambda held: held["taskId"])
    ordered = []
    for stage_priority in sorted({key[0] for key in groups}):
        kingdom_ids = sorted(key[1] for key in groups if key[0] == stage_priority)
        index = 0
        while any(index < len(groups[(stage_priority, kingdom_id)]) for kingdom_id in kingdom_ids):
            for kingdom_id in kingdom_ids:
                jobs = groups[(stage_priority, kingdom_id)]
                if index < len(jobs):
                    ordered.append(jobs[index])
            index += 1
    return ordered


def _strategy_search_task_config(bundle: dict[str, Any], state: dict[str, Any], job: dict[str, Any],
                                 owner_id: str, prepared: dict[str, Any]) -> dict[str, Any]:
    task = next(held for held in state["tasks"] if held["taskId"] == job["taskId"])
    controller_fields = {"campaignExecutionId": bundle["campaignExecutionId"],
        "controllerOwnerId": owner_id, "controllerFence": state["controllerFence"]}
    launch_id, temporary = prepared["launchId"], prepared["temporaryPath"]
    config = {"taskId": job["taskId"], "evidenceId": job["evidenceId"], "kingdomId": job["kingdomId"],
        "ownerId": owner_id, "taskFence": prepared["fence"], "leaseMs": 600000, **controller_fields,
        "launchId": launch_id, "temporaryPath": temporary, "sourceImage": bundle["sourceImage"],
        "cpu": task["cpu"], "timeoutSeconds": task["timeoutSeconds"], "stage": job["stage"]}
    if job["stage"] == "goldfish-one":
        config.update({"mode": "score-one", "range": job["range"]})
    elif job["stage"] == "goldfish-two":
        config.update({"mode": "score-two", "range": job["range"],
            "topPath": f"evidence/{job['evidenceId']}/goldfish/top-500000.hgf"})
    elif job["stage"] in {"goldfish-one-reduce", "goldfish-two-reduce"}:
        dependencies = [next(held for held in state["jobs"] if held["taskId"] == dependency)
                        for dependency in job["dependencyTaskIds"]]
        config.update({"mode": "reduce-one" if job["stage"] == "goldfish-one-reduce" else "reduce-two",
            "manifest": [held["receipt"]["artifactPath"] for held in dependencies]})
        if job["stage"] == "goldfish-two-reduce":
            config["topPath"] = f"evidence/{job['evidenceId']}/goldfish/top-500000.hgf"
    elif job["stage"] == "matrix":
        reservoir_job = next(held for held in state["jobs"]
            if held["evidenceId"] == job["evidenceId"] and held["stage"] == "goldfish-two-reduce")
        config.update({"reservoirPath": f"evidence/{job['evidenceId']}/goldfish/reservoir.hgf",
            "reservoirSha256": reservoir_job["receipt"]["sha256"], "checkpointCommits": 25,
            "workRoot": f"executions/{bundle['campaignExecutionId']}/runtime/{job['evidenceId']}/matrix"})
    else:
        relative_root = f"executions/{bundle['campaignExecutionId']}/runtime/{job['evidenceId']}/psro"
        root = f"/results/{relative_root}"
        config["checkpointCommits"] = 20
        config["workRoot"] = relative_root
        matrix_job = next(held for held in state["jobs"]
            if held["evidenceId"] == job["evidenceId"] and held["stage"] == "matrix")
        reservoir_job = next(held for held in state["jobs"]
            if held["evidenceId"] == job["evidenceId"] and held["stage"] == "goldfish-two-reduce")
        config["psroConfig"] = {"evidenceId": job["evidenceId"], "kingdomId": job["kingdomId"],
            "runId": "main", "reservoirPath": f"/results/evidence/{job['evidenceId']}/goldfish/reservoir.hgf",
            "reservoirSha256": reservoir_job["receipt"]["sha256"],
            "matrixEvidencePath": f"/results/evidence/{job['evidenceId']}/matrix/evidence.json",
            "matrixSha256": matrix_job["receipt"]["sha256"],
            "outputRoot": f"{root}/output", "controlRoot": f"{root}/control", "workers": task["cpu"],
            "protocolInput": {"experimentName": f"strategy-search-{job['evidenceId']}",
                "protocolVersion": "threshold-racing-psro-v2", "checkpointNamespace": job["evidenceId"],
                "screenDepths": [8, 16, 32, 64, 128, 256, 512],
                "confirmationLooks": [400, 800, 1600, 3200, 6400],
                "matrixSeedNamespace": "strategy-search-matrix-v2",
                "screenSeedNamespace": "strategy-search-psro-screen-v2",
                "confirmationSeedNamespace": "strategy-search-psro-confirmation-v2",
                "queueRetestSeedNamespace": "strategy-search-psro-queue-retest-v2"}}
    job.update({"status": "launching", "launchId": launch_id, "taskFence": prepared["fence"],
        "temporaryPath": temporary, "cpu": task["cpu"], "leaseUntilMs": prepared["leaseUntilMs"]})
    return config


def _strategy_search_controller_impl(bundle: dict[str, Any]) -> dict[str, Any]:
    verify_strategy_search_source(bundle["sourceImage"])
    initialized = strategy_search_publisher.remote({"operation": "execution-init",
        "campaignExecutionId": bundle["campaignExecutionId"],
        "orderedEvidenceIds": [task["evidenceId"] for task in bundle["tasks"] if task["stage"] == "psro"],
        "partitions": bundle["partitions"], "jobs": bundle["jobs"], "tasks": bundle["tasks"],
        "maxActiveCpus": bundle["request"]["maxActiveCpus"],
        "sourceDigest": bundle["sourceImage"]["digest"]})
    if initialized["status"] == "complete":
        return initialized["report"]
    owner_id = uuid.uuid4().hex
    state = strategy_search_publisher.remote({"operation": "controller-claim",
        "campaignExecutionId": bundle["campaignExecutionId"], "ownerId": owner_id,
        "nowMs": int(time.time() * 1000), "leaseMs": 120000})
    state["status"] = "running"
    reused_evidence_ids = set(state.get("reusedEvidenceIds", []))
    for evidence_id in {job["evidenceId"] for job in state["jobs"]}:
        final_tasks = {task["stage"]: task["taskId"] for task in state["tasks"]
            if task["evidenceId"] == evidence_id
            and task["stage"] in {"goldfish-one-reduce", "goldfish-two-reduce", "matrix", "psro"}}
        complete_evidence = strategy_search_publisher.remote({"operation": "evidence-complete",
            "evidenceId": evidence_id, "taskIds": final_tasks})
        if complete_evidence.get("complete"):
            reused_evidence_ids.add(evidence_id)
            for job in state["jobs"]:
                if job["evidenceId"] != evidence_id:
                    continue
                job.update({"status": "complete", "reused": True})
                if job["stage"] in complete_evidence["receipts"]:
                    job["receipt"] = complete_evidence["receipts"][job["stage"]]
    state["reusedEvidenceIds"] = sorted(reused_evidence_ids)
    for job in state["jobs"]:
        if not job.get("reused") and job["status"] in {"launching", "active"}:
            job.update({"status": "retry-backoff", "retryNotBeforeMs": int(time.time() * 1000) + 35000,
                "callId": None, "lastError": "controller-refenced-task"})
            job.pop("activeConfig", None)
    active: dict[str, tuple[Any, dict[str, Any]]] = {}
    def fail_active_wave(failure: str, root_task_id: str) -> None:
        failed_ms = int(time.time() * 1000)
        active_items = list(active.items())
        def cancel_active(item: tuple[str, tuple[Any, dict[str, Any]]]) -> None:
            try:
                item[1][0].cancel(terminate_containers=True)
            except Exception:
                pass
        if active_items:
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(32, len(active_items))) as pool:
                list(pool.map(cancel_active, active_items))
        for task_id, (_call, _config) in active_items:
            job = next(held for held in state["jobs"] if held["taskId"] == task_id)
            attempt = job.setdefault("attempts", [])[-1]
            attempt.update({"finishedMs": failed_ms,
                "status": "terminal-failed" if task_id == root_task_id else "cancelled-terminal-sibling",
                "error": failure[-2000:]})
            job.update({"status": "failed", "finishedMs": failed_ms,
                "lastError": failure[-2000:]})
            job.pop("activeConfig", None)
        active.clear()
        state.update({"status": "failed", "failedMs": failed_ms, "failure": failure[-4000:],
            "admissionFailures": admission_failures, "publisherCommitMs": publisher_commit_ms,
            "admissionLimitCpus": admission_limit_cpus})
        strategy_search_publisher.remote({"operation": "execution-save",
            "campaignExecutionId": bundle["campaignExecutionId"], "fence": state["controllerFence"],
            "ownerId": owner_id, "nowMs": failed_ms, "leaseMs": 120000, "state": state})
        raise RuntimeError(failure)
    intervals = state.get("utilizationIntervals", [])
    interval_started = int(time.time() * 1000)
    interval_allocated = 0
    interval_reason = "insufficient-ready-work"
    admission_failures = state.get("admissionFailures", 0)
    publisher_commit_ms = state.get("publisherCommitMs", 0.0)
    admission_limit_cpus = min(state.get("admissionLimitCpus", state["maxActiveCpus"]), state["maxActiveCpus"])
    clean_admission_ticks = 0
    last_saved_ms = int(time.time() * 1000)
    while True:
        now_ms = int(time.time() * 1000)
        transition_before = [(job["taskId"], job["status"], job.get("callId"), job.get("attemptCount", 0),
            len(job.get("attempts", []))) for job in state["jobs"]]
        if now_ms > interval_started:
            intervals.append({"startMs": interval_started, "endMs": now_ms,
                "allocatedCpus": interval_allocated, "unusedCpus": state["maxActiveCpus"] - interval_allocated,
                "reason": None if interval_allocated == state["maxActiveCpus"] else interval_reason})
        interval_started = now_ms
        interval_admission_rejected = False
        finished = []
        def poll_active(item: tuple[str, tuple[Any, dict[str, Any]]]) -> tuple[str, dict[str, Any], Any, Exception | None]:
            task_id, (call, config) = item
            try:
                return task_id, config, call.get(timeout=0), None
            except ModalTimeoutError:
                return task_id, config, None, None
            except Exception as error:
                return task_id, config, None, error
        active_items = list(active.items())
        if active_items:
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(32, len(active_items))) as pool:
                poll_results = list(pool.map(poll_active, active_items))
        else:
            poll_results = []
        terminal_poll = next(((task_id, error) for task_id, _config, _result, error in poll_results
            if error is not None and _strategy_search_is_terminal_worker_error(error)), None)
        if terminal_poll:
            fail_active_wave(f"non-retryable worker startup failure: {terminal_poll[1]}", terminal_poll[0])
        for task_id, config, result, error in poll_results:
            if error is None and result is None:
                continue
            if error is not None:
                job = next(held for held in state["jobs"] if held["taskId"] == task_id)
                if _strategy_search_is_admission_error(error):
                    admission_failures += 1
                    interval_admission_rejected = True
                    remaining_cpus = sum(held_config["cpu"] for held_id, (_call, held_config)
                        in active.items() if held_id != task_id)
                    admission_limit_cpus = max(4, remaining_cpus + config["cpu"])
                attempt = job.setdefault("attempts", [])[-1]
                attempt.update({"finishedMs": now_ms, "status": "failed", "error": str(error)[-2000:]})
                job["status"] = "retry-backoff"
                job["attemptCount"] = job.get("attemptCount", 0) + 1
                job["retryNotBeforeMs"] = now_ms + min(30000, 1000 * 2 ** min(job["attemptCount"], 5))
                job["lastError"] = str(error)[-2000:]
                if _strategy_search_retryable_failure_count(job) >= STRATEGY_SEARCH_MAX_JOB_ATTEMPTS:
                    fail_active_wave(f"worker retry limit exhausted for {task_id}: {error}", task_id)
                del active[task_id]
                continue
            finished.append((task_id, config, result))
        if finished:
            publication = strategy_search_publisher.remote({"operation": "publish-batch",
                "nowMs": int(time.time() * 1000), "publications": [{"evidenceId": config["evidenceId"],
                    "taskId": task_id, "fence": config["taskFence"], "launchId": config["launchId"],
                    "sha256": result["sha256"], "validatedSha256": result["validatedSha256"],
                    "stage": config["stage"], "range": config.get("range"),
                    "kingdomId": config["kingdomId"],
                    "campaignExecutionId": bundle["campaignExecutionId"], "controllerOwnerId": owner_id,
                    "controllerFence": state["controllerFence"]} for task_id, config, result in finished]})
            publisher_commit_ms += publication["publicationCommitMs"]
            publication_share_ms = publication["publicationCommitMs"] / len(finished)
            for task_id, _config, result in finished:
                if result.get("phases"):
                    waiting_ms = max(0, publication["publicationStartedEpochMs"]
                        - result["workerFinishedEpochMs"])
                    result["phases"]["publisherWaitMs"] += waiting_ms
                    result["phases"]["publicationCommitMs"] += publication_share_ms
                    result["phases"]["elapsedMs"] += waiting_ms + publication_share_ms
                    result["elapsedMs"] = result["phases"]["elapsedMs"]
                job = next(held for held in state["jobs"] if held["taskId"] == task_id)
                job.setdefault("attempts", [])[-1].update({"status": "complete",
                    "workerStartedMs": result.get("workerStartedEpochMs"),
                    "workerFinishedMs": result.get("workerFinishedEpochMs"),
                    "finishedMs": int(time.time() * 1000), "modalWorkerElapsedMs": result.get("modalWorkerElapsedMs", 0)})
                job.update({"status": "complete", "receipt": publication["receipts"][task_id], "result": result,
                    "finishedMs": int(time.time() * 1000)})
                job.pop("activeConfig", None)
                del active[task_id]
        allocated = sum(config["cpu"] for _, config in active.values())
        ready_jobs = _strategy_search_ready_jobs(state)
        first_goldfish = next((job for job in ready_jobs if job["stage"] in {"goldfish-one", "goldfish-two"}), None)
        if first_goldfish and not any(config["stage"] in {"goldfish-one", "goldfish-two"}
                for _, config in active.values()) and ready_jobs and ready_jobs[0] is not first_goldfish:
            first_task = next(held for held in state["tasks"] if held["taskId"] == ready_jobs[0]["taskId"])
            goldfish_task = next(held for held in state["tasks"] if held["taskId"] == first_goldfish["taskId"])
            if allocated + first_task["cpu"] + goldfish_task["cpu"] <= state["maxActiveCpus"]:
                first_job = ready_jobs[0]
                ready_jobs = [first_job, first_goldfish] \
                    + [job for job in ready_jobs if job is not first_job and job is not first_goldfish]
        selected, planned_allocated = [], allocated
        for job in ready_jobs:
            task = next(held for held in state["tasks"] if held["taskId"] == job["taskId"])
            if planned_allocated + task["cpu"] <= min(state["maxActiveCpus"], admission_limit_cpus):
                selected.append((job, task))
                planned_allocated += task["cpu"]
        if selected:
            preparation_items = []
            for job, task in selected:
                launch_id = uuid.uuid4().hex + uuid.uuid4().hex
                temporary = f"executions/{bundle['campaignExecutionId']}/temporary/{launch_id}/{job['taskId']}"
                temporary += ".hgs" if job["stage"] in {"goldfish-one", "goldfish-two"} \
                    else ".hgf" if job["stage"] in {"goldfish-one-reduce", "goldfish-two-reduce"} else ".json"
                preparation_items.append({"taskId": job["taskId"], "evidenceId": job["evidenceId"],
                    "launchId": launch_id, "temporaryPath": temporary, "artifactPath": task["artifactPath"]})
            prepared = strategy_search_publisher.remote({"operation": "prepare-launch-batch",
                "campaignExecutionId": bundle["campaignExecutionId"], "controllerOwnerId": owner_id,
                "controllerFence": state["controllerFence"], "ownerId": owner_id,
                "nowMs": int(time.time() * 1000), "leaseMs": 600000, "items": preparation_items})
            pending_launches = []
            for job, task in selected:
                preparation = prepared[job["taskId"]]
                if preparation.get("complete"):
                    job.update({"status": "complete", "receipt": preparation["receipt"],
                        "finishedMs": int(time.time() * 1000)})
                    continue
                if preparation.get("busy"):
                    job.update({"status": "retry-backoff", "retryNotBeforeMs": min(
                        preparation["leaseUntilMs"], int(time.time() * 1000) + 5000)})
                    continue
                config = _strategy_search_task_config(bundle, state, job, owner_id, preparation)
                function = strategy_search_downstream_job if job["stage"] in {"matrix", "psro"} \
                    else strategy_search_goldfish_job
                config["enqueuedEpochMs"] = int(time.time() * 1000)
                pending_launches.append((job, task, config, function))
            def spawn_task(item: tuple[dict[str, Any], dict[str, Any], dict[str, Any], Any]) -> tuple[Any, Any]:
                _job, task, config, function = item
                try:
                    return function.with_options(cpu=task["cpu"], memory=task["memoryMiB"],
                        timeout=task["timeoutSeconds"] + 30, retries=0).spawn(config), None
                except Exception as error:
                    return None, error
            if pending_launches:
                with concurrent.futures.ThreadPoolExecutor(max_workers=min(32, len(pending_launches))) as pool:
                    launch_results = list(pool.map(spawn_task, pending_launches))
            else:
                launch_results = []
            fatal_launch: tuple[str, str] | None = None
            for (job, task, config, _function), (call, error) in zip(pending_launches, launch_results, strict=True):
                submitted_ms = config["enqueuedEpochMs"]
                attempt = {"attempt": len(job.setdefault("attempts", [])) + 1, "submittedMs": submitted_ms,
                    "cpu": task["cpu"], "memoryMiB": task["memoryMiB"], "stage": job["stage"]}
                job["attempts"].append(attempt)
                if error is not None:
                    failed_ms = int(time.time() * 1000)
                    admission_error = _strategy_search_is_admission_error(error)
                    if admission_error:
                        admission_failures += 1
                        interval_admission_rejected = True
                        admission_limit_cpus = max(4, allocated + task["cpu"])
                    attempt.update({"finishedMs": failed_ms,
                        "status": "admission-failed" if admission_error else "launch-failed",
                        "error": str(error)[-2000:]})
                    job["attemptCount"] = job.get("attemptCount", 0) + 1
                    job["status"] = "ready" if admission_error else "retry-backoff"
                    if not admission_error:
                        job["retryNotBeforeMs"] = failed_ms \
                            + min(30000, 1000 * 2 ** min(job["attemptCount"], 5))
                    job["lastError"] = str(error)[-2000:]
                    if not admission_error and (_strategy_search_is_terminal_worker_error(error)
                            or _strategy_search_retryable_failure_count(job) >= STRATEGY_SEARCH_MAX_JOB_ATTEMPTS):
                        job["status"] = "failed"
                        fatal_launch = (job["taskId"], f"non-retryable launch failure for {job['taskId']}: {error}")
                    continue
                job["status"] = "active"
                job["startedMs"] = submitted_ms
                job.setdefault("firstStartedMs", job["startedMs"])
                job["cpu"] = task["cpu"]
                job["memoryMiB"] = task["memoryMiB"]
                job["callId"] = call.object_id
                attempt.update({"status": "submitted", "callId": call.object_id})
                active[job["taskId"]] = (call, config)
                allocated += task["cpu"]
            if fatal_launch:
                fail_active_wave(fatal_launch[1], fatal_launch[0])
        if interval_admission_rejected:
            clean_admission_ticks = 0
        elif admission_limit_cpus < state["maxActiveCpus"]:
            clean_admission_ticks += 1
            if clean_admission_ticks >= 2:
                probe_shape = min((task["cpu"] for task in state["tasks"]), default=4)
                admission_limit_cpus = _strategy_search_recover_admission(
                    admission_limit_cpus, state["maxActiveCpus"], probe_shape)
                clean_admission_ticks = 0
        interval_allocated = allocated
        if interval_admission_rejected or admission_limit_cpus < state["maxActiveCpus"]:
            interval_reason = "modal-workspace-rejection"
        elif any(job["status"] == "retry-backoff" for job in state["jobs"]):
            interval_reason = "failure-or-retry-backoff"
        elif any(job["status"] == "ready" and job["stage"] in {"matrix", "psro"} for job in state["jobs"]):
            interval_reason = "reserved-ready-downstream"
        elif any(job["status"] == "ready" and job.get("cpu", 4) > state["maxActiveCpus"] - allocated
                 for job in state["jobs"]):
            interval_reason = "minimum-useful-job-size"
        elif len(active) <= 1 and any(job["status"] != "complete" for job in state["jobs"]):
            interval_reason = "final-tail"
        else:
            interval_reason = "insufficient-ready-work"
        transition_after = [(job["taskId"], job["status"], job.get("callId"), job.get("attemptCount", 0),
            len(job.get("attempts", []))) for job in state["jobs"]]
        save_now = transition_after != transition_before or now_ms - last_saved_ms >= 30000
        if save_now:
            state["utilizationIntervals"] = intervals
            state["admissionFailures"] = admission_failures
            state["publisherCommitMs"] = publisher_commit_ms
            state["admissionLimitCpus"] = admission_limit_cpus
            state = strategy_search_publisher.remote({"operation": "execution-save",
                "campaignExecutionId": bundle["campaignExecutionId"], "fence": state["controllerFence"],
                "ownerId": owner_id, "nowMs": int(time.time() * 1000), "leaseMs": 120000, "state": state})
            last_saved_ms = now_ms
        if all(job["status"] == "complete" for job in state["jobs"]):
            break
        if int(time.time() * 1000) - state["startedMs"] >= bundle["controller"]["timeoutSeconds"] * 1000:
            raise TimeoutError("strategy-search controller exceeded its derived budget")
        time.sleep(bundle["controller"]["pollIntervalSeconds"])
    finished_ms = int(time.time() * 1000)
    if finished_ms > interval_started:
        intervals.append({"startMs": interval_started, "endMs": finished_ms,
            "allocatedCpus": interval_allocated, "unusedCpus": state["maxActiveCpus"] - interval_allocated,
            "reason": None if interval_allocated == state["maxActiveCpus"] else interval_reason})
    critical_elapsed_ms = finished_ms - state["startedMs"]
    phase_reports = [job.get("result", {}).get("phases") for job in state["jobs"]
                     if job.get("result", {}).get("phases")]
    attempts = [attempt for job in state["jobs"] for attempt in job.get("attempts", [])]
    attempt_costs = []
    for attempt in attempts:
        if attempt.get("status") == "admission-failed":
            attempt.update({"costUsd": 0.0, "costBasis": "not-admitted"})
            continue
        cost = _strategy_search_attempt_cost(attempt, finished_ms)
        attempt.update({"costUsd": cost["costUsd"], "costBasis": cost["basis"]})
        attempt_costs.append(cost)
    measured_attempt_cost = sum(entry["costUsd"] for entry in attempt_costs
        if entry["basis"] == "worker-measured")
    unmeasured_failure_cost = sum(entry["costUsd"] for entry in attempt_costs
        if entry["basis"] == "submitted-upper-bound")
    controller_cost = critical_elapsed_ms / 3_600_000 \
        * (CPU_RATE_PER_CORE_HOUR + 2 * MEMORY_RATE_PER_GIB_HOUR)
    publisher_cost = publisher_commit_ms / 3_600_000 \
        * (CPU_RATE_PER_CORE_HOUR + 8 * MEMORY_RATE_PER_GIB_HOUR)
    compute_cost = measured_attempt_cost + unmeasured_failure_cost + controller_cost + publisher_cost
    stage_wall = {}
    for stage in ["goldfish-one", "goldfish-one-reduce", "goldfish-two", "goldfish-two-reduce", "matrix", "psro"]:
        held = [job for job in state["jobs"] if job["stage"] == stage and job.get("firstStartedMs")]
        stage_wall[stage] = max((job.get("finishedMs", job["firstStartedMs"]) for job in held), default=0) \
            - min((job["firstStartedMs"] for job in held), default=0) if held else 0
    submitted_cpu_ms = sum((entry["endMs"] - entry["startMs"]) * entry["allocatedCpus"] for entry in intervals)
    submitted_wall_ms = sum(entry["endMs"] - entry["startMs"] for entry in intervals)
    running_events = []
    for attempt in attempts:
        start, end = attempt.get("workerStartedMs"), attempt.get("workerFinishedMs")
        if isinstance(start, int) and isinstance(end, int) and end >= start:
            running_events.extend([(start, attempt["cpu"]), (end, -attempt["cpu"])])
    event_times = sorted({state["startedMs"], finished_ms, *[event[0] for event in running_events]})
    running_intervals, running_cpus = [], 0
    events_by_time = {}
    for event_ms, delta in running_events:
        events_by_time[event_ms] = events_by_time.get(event_ms, 0) + delta
    for index, start in enumerate(event_times[:-1]):
        running_cpus += events_by_time.get(start, 0)
        end = event_times[index + 1]
        if end <= start:
            continue
        submitted = next((entry for entry in intervals if entry["startMs"] <= start < entry["endMs"]), None)
        if running_cpus == state["maxActiveCpus"]:
            reason = None
        elif submitted and submitted["allocatedCpus"] > running_cpus:
            reason = "modal-queue-delay"
        else:
            reason = submitted.get("reason") if submitted else "insufficient-ready-work"
        running_intervals.append({"startMs": start, "endMs": end, "allocatedCpus": running_cpus,
            "unusedCpus": state["maxActiveCpus"] - running_cpus, "reason": reason})
    allocated_cpu_ms = sum((entry["endMs"] - entry["startMs"]) * entry["allocatedCpus"]
        for entry in running_intervals)
    wall_ms = sum(entry["endMs"] - entry["startMs"] for entry in running_intervals)
    unused_by_reason = {}
    for entry in running_intervals:
        if entry["reason"]:
            unused_by_reason[entry["reason"]] = unused_by_reason.get(entry["reason"], 0) \
                + (entry["endMs"] - entry["startMs"]) * entry["unusedCpus"] / 1000
    artifact_paths = sorted({job["receipt"]["artifactPath"] for job in state["jobs"] if job.get("receipt")})
    artifacts = [_strategy_search_path(relative) for relative in artifact_paths]
    bytes_written = sum(held.stat().st_size for held in artifacts)
    bytes_read = sum(_strategy_search_path(dependency["receipt"]["artifactPath"]).stat().st_size
        for job in state["jobs"] if not job.get("reused")
        and job["stage"] in {"goldfish-one-reduce", "goldfish-two", "goldfish-two-reduce", "matrix", "psro"}
        for dependency in [next(held for held in state["jobs"] if held["taskId"] == task_id)
                           for task_id in job["dependencyTaskIds"]] if dependency.get("receipt"))
    bytes_read += sum(_strategy_search_path(f"evidence/{job['evidenceId']}/goldfish/reservoir.hgf").stat().st_size
        for job in state["jobs"] if not job.get("reused") and job["stage"] == "psro")
    io_ms = sum(held.get("intermediateSerializationAndReadMs", 0)
        + held.get("temporaryVolumeWriteCommitMs", 0) + held.get("publicationCommitMs", 0)
        for held in phase_reports)
    scientific_ms = sum(held.get("generationMs", 0) + held.get("scoringMs", 0)
        + held.get("intermediateSerializationAndReadMs", 0) + held.get("temporaryVolumeWriteCommitMs", 0)
        + held.get("publicationCommitMs", 0) + held.get("reductionComputeMs", 0) for held in phase_reports)
    scored_candidates = sum(job["range"]["end"] - job["range"]["start"] for job in state["jobs"]
        if job["stage"] in {"goldfish-one", "goldfish-two"})
    scoring_ms = sum(held.get("scoringMs", 0) for held in phase_reports)
    phase_keys = ["generationMs", "scoringMs", "intermediateSerializationAndReadMs",
        "temporaryVolumeWriteCommitMs", "publisherWaitMs", "publicationCommitMs", "reductionComputeMs",
        "finalTop500000WriteMs", "finalTop20000WriteMs", "orchestrationQueueMs"]
    for phase_report in phase_reports:
        phase_sum = sum(phase_report.get(key, -1) for key in phase_keys)
        if phase_report.get("elapsedMs", 0) < 0 or any(phase_report.get(key, -1) < 0 for key in phase_keys) \
                or phase_report["elapsedMs"] and abs(phase_sum - phase_report["elapsedMs"]) \
                    / phase_report["elapsedMs"] > 0.01:
            raise RuntimeError("Goldfish phase accounting invariant failed")
    if scientific_ms and io_ms / scientific_ms >= 0.05:
        raise RuntimeError("Goldfish intermediate I/O ratio is at least five percent")
    report = {"schemaVersion": 2, "campaignExecutionId": bundle["campaignExecutionId"],
        "status": "complete", "criticalPathWallMs": critical_elapsed_ms,
        "stageWallMs": stage_wall, "maxActiveCpus": state["maxActiveCpus"],
        "peakActiveCpus": max((entry["allocatedCpus"] for entry in running_intervals), default=0),
        "averageActiveCpus": allocated_cpu_ms / wall_ms if wall_ms else 0,
        "cpuUtilization": allocated_cpu_ms / (wall_ms * state["maxActiveCpus"]) if wall_ms else 0,
        "peakSubmittedCpus": max((entry["allocatedCpus"] for entry in intervals), default=0),
        "averageSubmittedCpus": submitted_cpu_ms / submitted_wall_ms if submitted_wall_ms else 0,
        "unusedCpuSecondsByReason": unused_by_reason,
        "candidateThroughputPerSecond": scored_candidates / (scoring_ms / 1000) if scoring_ms else 0,
        "bytesRead": bytes_read, "bytesWritten": bytes_written,
        "intermediateIoRatio": io_ms / scientific_ms if scientific_ms else 0,
        "finalWriteMs": sum(held.get("finalTop500000WriteMs", 0) + held.get("finalTop20000WriteMs", 0)
                            for held in phase_reports),
        "admissionFailures": admission_failures,
        "taskCount": len(state["jobs"]), "retries": sum(job.get("attemptCount", 0) for job in state["jobs"]),
        "actualModalCostUsd": compute_cost,
        "modalCostAccounting": {"measuredAttemptUsd": measured_attempt_cost,
            "unmeasuredFailureUpperBoundUsd": unmeasured_failure_cost,
            "controllerUsd": controller_cost, "publisherUsd": publisher_cost,
            "totalUsd": compute_cost},
        "attempts": attempts, "utilizationIntervals": running_intervals,
        "submittedUtilizationIntervals": intervals,
        "goldfishPhases": phase_reports}
    state["status"] = "complete"
    state["report"] = report
    state["utilizationIntervals"] = running_intervals
    state["submittedUtilizationIntervals"] = intervals
    state["admissionFailures"] = admission_failures
    state["publisherCommitMs"] = publisher_commit_ms
    state["admissionLimitCpus"] = admission_limit_cpus
    strategy_search_publisher.remote({"operation": "execution-save", "campaignExecutionId": bundle["campaignExecutionId"],
        "fence": state["controllerFence"], "ownerId": owner_id, "nowMs": int(time.time() * 1000),
        "leaseMs": 120000, "state": state})
    return report


@app.function(image=image, cpu=1, memory=2048, timeout=1800, retries=0, volumes={"/results": volume})
def strategy_search_controller(bundle: dict[str, Any]) -> dict[str, Any]:
    try:
        return _strategy_search_controller_impl(bundle)
    except Exception as error:
        try:
            strategy_search_publisher.remote({"operation": "execution-fail",
                "campaignExecutionId": bundle["campaignExecutionId"],
                "nowMs": int(time.time() * 1000), "failure": str(error)})
        except Exception:
            pass
        raise


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
