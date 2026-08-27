"""Detached, restart-safe Modal launcher for ordered native-strategy shards."""

from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
import pathlib
import re
import socket
import struct
import subprocess
import tempfile
import time
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
LEDGER_PATH = pathlib.Path.home() / ".hexdeck-modal-cost-ledger.json"

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
    .add_local_dir(".", remote_path="/workspace", copy=True,
        ignore=[".git/**", "node_modules/**", ".experiments/**", ".reviews/**",
                "rust/target/**", "dist/**", "dist-sim/**", "dist-benchmark/**"])
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
                       timeout=120, check=True)
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
              threads: int, cpu: int, timeout_seconds: int) -> None:
    with request_path.open() as request:
        completed = subprocess.run([CAMPAIGN_RUST_GOLDFISH_BIN, "--threads", str(threads),
            "--cpu-request", str(cpu)],
            stdin=request, text=True, capture_output=True, timeout=timeout_seconds, check=True)
    response_path.write_text(completed.stdout)


@app.function(image=image, cpu=4, memory=4096, timeout=7200, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def ordered_product_stage_one(spec: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    if "source_image" in spec:
        verify_campaign_source_image(spec["source_image"])
    output = _ordered_product_checkpoint_path(spec, "stage-one", spec["shard_id"])
    if _valid_ordered_product_checkpoint(output, spec, "stage-one"):
        held = json.loads(output.read_text())
        return {"status": "success", "stage": "stage-one", "shardId": spec["shard_id"],
                "contentDigest": held["contentDigest"], "reused": True}
    for corrupt in [output, pathlib.Path(f"{output}.records.jsonl")]:
        if corrupt.exists():
            _preserve_corrupt_file(corrupt, output.parent.parent / "control")
    started = time.monotonic()
    with tempfile.TemporaryDirectory() as directory:
        request = pathlib.Path(directory) / "request.jsonl"
        response = pathlib.Path(directory) / "response.json"
        metadata = pathlib.Path(directory) / "metadata.json"
        generation_timeout, scoring_timeout = ordered_subprocess_timeouts(spec["timeout_seconds"])
        subprocess.run(["npx", "tsx", "scripts/native_ordered_shard_input.ts",
            "--schema-version", str(spec.get("schema_version", 1)),
            "--kingdom", spec["kingdom"],
            "--start-position", str(spec["start_position"]), "--end-position", str(spec["end_position"]),
            "--threads", str(spec["threads"]), "--cpu", str(spec["cpu"]),
            "--seeds", str(spec["shuffle_seeds"][0]), "--mode", "full",
            "--request", str(request), "--metadata", str(metadata)],
            cwd="/workspace", text=True, capture_output=True, timeout=generation_timeout, check=True)
        _run_rust(request, response, spec["threads"], spec["cpu"], scoring_timeout)
        command = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "stage-one-checkpoint",
            "--request", str(request), "--response", str(response), "--metadata", str(metadata),
            "--out", str(output), "--shard-id", str(spec["shard_id"]),
            "--start-position", str(spec["start_position"]), "--end-position", str(spec["end_position"])]
        command += _ordered_product_cli(spec)[3:]
        subprocess.run(command, cwd="/workspace", text=True, capture_output=True, timeout=300, check=True)
    if not _valid_ordered_product_checkpoint(output, spec, "stage-one"):
        raise RuntimeError("new stage-one checkpoint failed validation")
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
    with tempfile.TemporaryDirectory() as directory:
        request = pathlib.Path(directory) / "request.jsonl"
        response = pathlib.Path(directory) / "response.json"
        metadata = pathlib.Path(directory) / "metadata.json"
        generation_timeout, scoring_timeout = ordered_subprocess_timeouts(spec["timeout_seconds"])
        input_command = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "stage-two-input",
            "--cohort", str(cohort), "--start-position", str(spec["start_position"]),
            "--end-position", str(spec["end_position"]), "--threads", str(spec["threads"]),
            "--request", str(request), "--metadata", str(metadata)] + _ordered_product_cli(spec)[3:]
        subprocess.run(input_command, cwd="/workspace", text=True, capture_output=True,
                       timeout=generation_timeout, check=True)
        _run_rust(request, response, spec["threads"], spec["cpu"], scoring_timeout)
        command = ["npx", "tsx", "scripts/ordered_goldfish_product.ts", "stage-two-checkpoint",
            "--cohort", str(cohort), "--response", str(response), "--metadata", str(metadata),
            "--out", str(output), "--shard-id", str(spec["shard_id"]),
            "--start-position", str(spec["start_position"]), "--end-position", str(spec["end_position"])]
        command += _ordered_product_cli(spec)[3:]
        subprocess.run(command, cwd="/workspace", text=True, capture_output=True, timeout=300, check=True)
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


def _campaign_node(command: list[str], request: dict[str, Any], timeout: int = 120) -> Any:
    completed = _run_checked(command, "campaign evidence operation", cwd="/workspace",
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
        else:
            raise ValueError(f"unknown serialized campaign mutation {operation}")
        scheduler = _campaign_scheduler_operation("apply", scheduler, updates=scheduler_updates)
        if state_operation:
            state_payload = held if state_operation not in {"stage-outcome", "transition"} \
                else {**held, **(held.get("stageOutcome") or held.get("stageRetry"))}
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
    command = _campaign_stage_command(stage, config, shutdown_at_ms)
    environment = None if stage != "psro" else {
        **os.environ, "HEXDECK_GOLDFISH_BIN": CAMPAIGN_RUST_GOLDFISH_BIN}
    process = subprocess.Popen(command, cwd="/workspace", text=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, bufsize=1, env=environment)
    checkpoint_count = 0
    terminal = None
    assert process.stdout is not None
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
                process.terminate()
                raise RuntimeError("campaign stage emitted a stale or malformed checkpoint event")
            volume.commit()
            checkpoint_count += 1
        elif event.get("type") == CAMPAIGN_STAGE_STOP_EVENT:
            if event.get("stage") != stage or event.get("status") not in {
                    "complete", "incomplete", "terminal-incomplete"} \
                    or not re.fullmatch(r"[0-9a-f]{64}", event.get("markerHash", "")):
                process.terminate()
                raise RuntimeError("campaign stage emitted a malformed stop event")
            terminal = event
    return_code = process.wait()
    stderr = process.stderr.read() if process.stderr else ""
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
    volume.commit()
    return {"status": terminal["status"], "stage": stage, "stageId": config["stage_id"],
        "controllerFence": config["controller_fence"], "markerHash": terminal["markerHash"],
        "reason": marker.get("reason"), "artifactPaths": sorted(marker.get("artifactHashes", {})),
        "artifactHashes": marker.get("artifactHashes", {}), "checkpointCommits": checkpoint_count,
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
    ranked_digest = ranked.with_suffix(".json.sha256").read_text().split()[0]
    reservoir_digest = reservoir.with_suffix(".json.sha256").read_text().split()[0]
    goldfish_hashes = {"output/ranked.json": ranked_digest, "output/reservoir.json": reservoir_digest}
    ranked_manifest = json.loads(ranked.read_text())
    for part in ranked_manifest["parts"]:
        part_path = ranked.parent / part["file"]
        if not part_path.exists():
            raise RuntimeError(f"campaign ranked part is missing: {part['file']}")
        goldfish_hashes[f"output/{part['file']}"] = hashlib.sha256(part_path.read_bytes()).hexdigest()
    marker = _campaign_marker("goldfish", config["stage_id"], "complete", goldfish_hashes)
    control = stage_root / "control" / "complete.json"
    _atomic_json(control, marker)
    matrix_manifest = _campaign_path(config["campaign_root"], config["matrix_manifest_path"])
    prepare_matrix = ["npx", "tsx", "scripts/strategy_search_campaign_matrix_manifest.ts",
        "--kingdom", config["kingdom"], "--ranked", str(ranked), "--reservoir", str(reservoir),
        "--stage-id", config["matrix_stage_id"], "--out", str(matrix_manifest)]
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
        if entry.get("stage") != task["stage"] or entry.get("kingdom_id") != task["kingdomId"] \
                or entry.get("cpu") != task["cpus"] or task["containers"] != 1 \
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
    return _campaign_node(["npx", "tsx", "scripts/strategy_search_campaign_validate_stage.ts"], request,
        timeout=max(120, entry["timeout_seconds"]))


def _campaign_call_observations(checkpoint: dict[str, Any], campaign_root: str,
                                task_configs: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    observations = []
    for task in checkpoint["tasks"]:
        if task["status"] != "active":
            continue
        try:
            result = modal.FunctionCall.from_id(task["callId"]).get(timeout=0)
        except ModalTimeoutError:
            observations.append({"callId": task["callId"], "state": "running"})
        except Exception as error:
            observations.append({"callId": task["callId"], "state": "failed",
                "reason": f"{type(error).__name__}: {error}"})
        else:
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
    stage_config = {**entry["config"], "controller_fence": fence, "source_image": source_image}
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
    while True:
        volume.reload()
        if time.monotonic() - renewed_at >= config["lease_renew_interval_seconds"]:
            claimed = campaign_state_mutator.remote({"campaign_root": config["campaign_root"],
                "operation": "claim", "payload": {"expectedRevision": state["revision"],
                    "ownerId": config["claim"]["ownerId"], "nowMs": int(time.time() * 1000),
                    "leaseMs": config["claim"]["leaseMs"]}})
            state, checkpoint = claimed["state"], claimed["scheduler"]
            if state["fencingToken"] != fence:
                raise RuntimeError("campaign controller lost its fencing token during lease renewal")
            renewed_at = time.monotonic()
        for task in [entry for entry in checkpoint["tasks"] if entry["status"] == "incomplete"]:
            task_config = task_configs[task["taskId"]]
            payload = {"expectedSchedulerRevision": checkpoint["revision"], "fencingToken": fence,
                "expectedRevision": state["revision"], "ownerId": config["claim"]["ownerId"],
                "updates": [{"kind": "ready", "taskId": task["taskId"]}]}
            if task_config.get("stage_terminal") and state["stages"][task_config["config"]["stage_key"]]["status"] \
                    == "incomplete":
                payload["stageRetry"] = {"stageKey": task_config["config"]["stage_key"],
                    "status": "ready", "details": {}}
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
        for action in [entry for entry in actions if entry["kind"] == "launch"]:
            held = task_configs[action["taskId"]]
            if action["containers"] != 1 or action["cpus"] != held["cpu"]:
                raise RuntimeError("campaign task resources differ from the fenced scheduler checkpoint")
            state, checkpoint, _call = _durably_spawn_campaign_task(campaign_root=config["campaign_root"],
                owner_id=config["claim"]["ownerId"], fence=fence, state=state, checkpoint=checkpoint,
                action=action, entry=held, source_image=config["source_image"])
        statuses = {task["status"] for task in checkpoint["tasks"]}
        psro_states = [stage["status"] for key, stage in state["stages"].items() if key.endswith(":psro")]
        if statuses == {"complete"} and psro_states and all(status == "complete" for status in psro_states):
            return {"status": "complete", "evidenceHash": config["evidence_hash"],
                "stateRevision": state["revision"], "controllerFence": fence,
                "schedulerHash": checkpoint["checkpointHash"]}
        terminal_outcome = _terminal_campaign_outcome(checkpoint)
        if terminal_outcome:
            return {**terminal_outcome, "evidenceHash": config["evidence_hash"],
                "controllerFence": fence, "schedulerHash": checkpoint["checkpointHash"]}
        if stop_launching:
            return {"status": "incomplete", "reason": "controller timeout margin stopped new launches",
                "evidenceHash": config["evidence_hash"], "controllerFence": fence,
                "schedulerHash": checkpoint["checkpointHash"]}
        if not actions or all(action["kind"] == "reattach" for action in actions):
            time.sleep(min(5, config["poll_interval_seconds"]))


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
