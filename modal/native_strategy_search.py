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
SCORER_VERSION = "native-goldfish-v1"
RESULT_SCHEMA_VERSION = 1
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
    held = {key: value[key] for key in ["runId", "shardId", "startPosition", "endPosition",
        "completeCount", "candidateDigest", "scoreDigest", "ruleFingerprint", "scorerVersion",
        "buildVersion", "shuffleSeeds", "movementProfiles", "requestedCpu", "threads"]}
    return hashlib.sha256(json.dumps(held, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


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
            and value["shuffleSeeds"] == [4_100_000 + index for index in range(spec["shuffles"])]
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
            "--start-position", str(spec["start_position"]), "--end-position", str(spec["end_position"]),
            "--threads", str(spec["threads"]), "--cpu", str(spec["cpu"]),
            "--shuffles", str(spec["shuffles"]), "--request", str(request_path),
            "--metadata", str(metadata_path)], cwd="/workspace", text=True, capture_output=True,
            timeout=generation_timeout, check=True)
        metadata = json.loads(metadata_path.read_text())
        if metadata["ruleFingerprint"] != spec["rule_fingerprint"]:
            raise RuntimeError("TypeScript rule fingerprint does not match the shard specification")
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
            "shardId": spec["shard_id"],
            "startPosition": spec["start_position"],
            "endPosition": spec["end_position"],
            "completeCount": len(scores),
            "candidateDigest": candidate_digest,
            "scoreDigest": score_digest,
            "ruleFingerprint": metadata["ruleFingerprint"],
            "scorerVersion": SCORER_VERSION,
            "buildVersion": spec["build_version"],
            "shuffleSeeds": [4_100_000 + index for index in range(spec["shuffles"])],
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
        "buildVersion": config["build_version"], "ruleFingerprint": config["rule_fingerprint"],
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


def validate_launch_limits(
    *, count: int, start_position: int, shard_size: int, cpu: int, memory_gib: int,
    threads: int, max_containers: int, timeout_seconds: int, max_cost_usd: float,
    chunk_size: int, shuffles: int, scorer: str, product: bool
) -> dict[str, Any]:
    if min(count, shard_size, cpu, memory_gib, threads, max_containers,
           timeout_seconds, chunk_size, shuffles) < 1:
        raise ValueError("counts and resource limits must be positive")
    if scorer != "rust":
        raise ValueError("Modal production supports only the standalone Rust scorer")
    if threads > cpu:
        raise ValueError("Rust/worker threads cannot exceed the integer CPU request")
    aggregate_cpu = cpu if product else 1 + cpu * max_containers
    if aggregate_cpu > MAX_PHYSICAL_CORES:
        raise ValueError(f"aggregate allocation exceeds {MAX_PHYSICAL_CORES} physical cores")
    end_position = start_position + count
    if product:
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
            "controller_timeout": controller_timeout, "aggregate_cpu": aggregate_cpu}


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
    scorer: str = "rust",
    product: bool = False,
    pool_seed: int = 5,
) -> None:
    limits = validate_launch_limits(count=count, start_position=start_position,
        shard_size=shard_size, cpu=cpu, memory_gib=memory_gib, threads=threads,
        max_containers=max_containers, timeout_seconds=timeout_seconds,
        max_cost_usd=max_cost_usd, chunk_size=chunk_size, shuffles=shuffles,
        scorer=scorer, product=product)
    end_position = limits["end_position"]
    projected = limits["projected"]
    full_run = limits["full_run"]
    controller_timeout = limits["controller_timeout"]
    config = {
        "kind": "product" if product else "ordered",
        "build_version": build_version,
        "rule_fingerprint": rule_fingerprint,
        "count": count,
        "pool_seed": pool_seed,
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
        "resultLocation": f"hexdeck-native-strategy-results:/{run_id}/{'pool.json' if product else 'merge.json'}",
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
    if product:
        call = product_search.with_options(cpu=cpu, memory=memory_gib * 1024,
            timeout=timeout_seconds + 30, retries=MAX_RETRIES).spawn(config)
    else:
        call = controller.with_options(timeout=config["controller_timeout"], retries=0).spawn(config)
    record_controller_call(run_id, call.object_id)
    print(f"detached {'product' if product else 'ordered'} call: {call.object_id}")
