"""Detached, restart-safe Modal launcher for ordered native-strategy shards."""

from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
import pathlib
import socket
import subprocess
import tempfile
import time
from typing import Any

import modal

CPU_RATE_PER_CORE_HOUR = 0.0473
MEMORY_RATE_PER_GIB_HOUR = 0.008
GROSS_BUDGET_USD = 25.0
MAX_PHYSICAL_CORES = 192
MAX_FULL_RUNS = 3
FULL_CANDIDATE_COUNT = 12_972_960
MAX_RETRIES = 2
SCORER_VERSION = "native-goldfish-v1"
RESULT_SCHEMA_VERSION = 1
LEDGER_PATH = pathlib.Path.home() / ".hexdeck-modal-cost-ledger.json"

app = modal.App("hexdeck-native-strategy-search")
volume = modal.Volume.from_name("hexdeck-native-strategy-results", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ca-certificates", "curl", "build-essential")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs && node --version",
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal",
        "/root/.cargo/bin/rustup toolchain install 1.98.0 --profile minimal --component clippy,rustfmt --target x86_64-unknown-linux-gnu",
    )
    .env({"PATH": "/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"})
    .add_local_dir(".", remote_path="/workspace", copy=True)
    .run_commands(
        "cd /workspace && npm ci",
        "cd /workspace/rust && cargo +1.98.0 build --release --target x86_64-unknown-linux-gnu",
    )
)


def projected_cost_usd(
    shard_count: int, cpu: int, memory_gib: float, timeout_seconds: int, retries: int = MAX_RETRIES
) -> float:
    attempts = retries + 1
    hourly = cpu * CPU_RATE_PER_CORE_HOUR + memory_gib * MEMORY_RATE_PER_GIB_HOUR
    return shard_count * attempts * timeout_seconds / 3600 * hourly


def _atomic_json(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as held:
        json.dump(value, held, indent=2, sort_keys=True)
        held.write("\n")
        held.flush()
        os.fsync(held.fileno())
        temporary = pathlib.Path(held.name)
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


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
        if reserved + projected > GROSS_BUDGET_USD:
            raise RuntimeError(
                f"cumulative reservation ${reserved + projected:.4f} exceeds ${GROSS_BUDGET_USD:.2f}"
            )
        if full_run and full_runs >= MAX_FULL_RUNS:
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


def valid_result(value: Any, spec: dict[str, Any]) -> bool:
    try:
        return (
            value["schemaVersion"] == RESULT_SCHEMA_VERSION
            and value["status"] == "success"
            and value["runId"] == spec["run_id"]
            and value["shardId"] == spec["shard_id"]
            and value["startPosition"] == spec["start_position"]
            and value["endPosition"] == spec["end_position"]
            and value["completeCount"] == spec["end_position"] - spec["start_position"]
            and value["ruleFingerprint"] == spec["rule_fingerprint"]
            and value["scorerVersion"] == SCORER_VERSION
            and value["buildVersion"] == spec["build_version"]
            and isinstance(value["candidateDigest"], str)
            and len(value["candidateDigest"]) >= 9
            and isinstance(value["scoreDigest"], str)
            and len(value["scoreDigest"]) >= 9
        )
    except (KeyError, TypeError):
        return False


def _result_path(spec: dict[str, Any]) -> pathlib.Path:
    return pathlib.Path("/results") / spec["run_id"] / f"shard-{spec['shard_id']:06d}.json"


@app.function(image=image, cpu=4, memory=4096, timeout=3600, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def score_shard(spec: dict[str, Any]) -> dict[str, Any]:
    path = _result_path(spec)
    if path.exists():
        try:
            held = json.loads(path.read_text())
            if valid_result(held, spec):
                return held
        except (OSError, json.JSONDecodeError):
            pass
    started = time.monotonic()
    count = spec["end_position"] - spec["start_position"]
    command = [
        "npm", "run", "goldfish:ordered-benchmark", "--", "--limit", str(count),
        "--start-position", str(spec["start_position"]), "--workers", str(spec["threads"]),
        "--chunk-size", str(spec["chunk_size"]), "--shuffles", str(spec["shuffles"]),
        "--scorer", spec["scorer"],
    ]
    try:
        completed = subprocess.run(
            command, cwd="/workspace", text=True, capture_output=True,
            timeout=spec["timeout_seconds"], check=True,
        )
        marker = completed.stdout.find("{")
        benchmark = json.loads(completed.stdout[marker:])
        result = {
            "schemaVersion": RESULT_SCHEMA_VERSION,
            "status": "success",
            "runId": spec["run_id"],
            "shardId": spec["shard_id"],
            "startPosition": spec["start_position"],
            "endPosition": spec["end_position"],
            "completeCount": benchmark["scoredCount"],
            "candidateDigest": benchmark["candidateChecksum"],
            "scoreDigest": benchmark["scoreKeyDigest"],
            "ruleFingerprint": spec["rule_fingerprint"],
            "scorerVersion": SCORER_VERSION,
            "buildVersion": spec["build_version"],
            "shuffleSeeds": benchmark["scoring"]["shuffleSeeds"],
            "movementProfiles": benchmark["scoring"]["profiles"],
            "requestedCpu": spec["cpu"],
            "threads": spec["threads"],
            "maxContainers": spec["max_containers"],
            "containerIdentity": os.environ.get("MODAL_TASK_ID", socket.gethostname()),
            "elapsedMs": round((time.monotonic() - started) * 1000, 3),
            "benchmark": benchmark,
        }
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
            "shardId": spec["shard_id"],
            "errorType": type(error).__name__,
            "error": str(error),
            "elapsedMs": round((time.monotonic() - started) * 1000, 3),
        }


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
        timeout=config["timeout_seconds"] + 120, max_containers=config["max_containers"], retries=0,
    )
    for attempt in range(MAX_RETRIES + 1):
        if not pending:
            break
        replies = list(shard_function.map(pending, order_outputs=False, return_exceptions=True))
        failed_ids = set()
        by_id = {spec["shard_id"]: spec for spec in pending}
        for reply in replies:
            if isinstance(reply, BaseException) or not isinstance(reply, dict):
                failed_ids.update(by_id)
                continue
            shard_id = reply.get("shardId")
            spec = by_id.get(shard_id)
            if spec and valid_result(reply, spec):
                completed[shard_id] = reply
            elif isinstance(shard_id, int):
                failed_ids.add(shard_id)
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


@app.local_entrypoint()
def launch(
    build_version: str,
    rule_fingerprint: str,
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
    scorer: str = "lean",
) -> None:
    if min(count, shard_size, cpu, memory_gib, threads, max_containers, timeout_seconds) < 1:
        raise ValueError("counts and resource limits must be positive")
    if scorer not in {"original", "lean", "rust"}:
        raise ValueError("scorer must be original, lean, or rust")
    if threads > cpu:
        raise ValueError("Rust/worker threads cannot exceed the integer CPU request")
    if cpu * max_containers > MAX_PHYSICAL_CORES:
        raise ValueError(f"aggregate allocation exceeds {MAX_PHYSICAL_CORES} physical cores")
    end_position = start_position + count
    if start_position < 0 or end_position > FULL_CANDIDATE_COUNT:
        raise ValueError("candidate range is outside the ordered space")
    shard_count = math.ceil(count / shard_size)
    projected = projected_cost_usd(shard_count, cpu, memory_gib, timeout_seconds)
    if projected > max_cost_usd:
        raise ValueError(f"worst-case cost ${projected:.4f} exceeds run cap ${max_cost_usd:.4f}")
    full_run = start_position == 0 and count == FULL_CANDIDATE_COUNT
    if full_run and max_cost_usd > 5:
        raise ValueError("a full-space run cap cannot exceed $5")
    config = {
        "build_version": build_version,
        "rule_fingerprint": rule_fingerprint,
        "start_position": start_position,
        "end_position": end_position,
        "shard_size": shard_size,
        "cpu": cpu,
        "memory_gib": memory_gib,
        "threads": threads,
        "max_containers": max_containers,
        "timeout_seconds": timeout_seconds,
        "chunk_size": chunk_size,
        "shuffles": shuffles,
        "scorer": scorer,
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
        "resultLocation": f"hexdeck-native-strategy-results:/{run_id}/merge.json",
    }, indent=2))
    call = controller.spawn(config)
    print(f"detached controller call: {call.object_id}")
