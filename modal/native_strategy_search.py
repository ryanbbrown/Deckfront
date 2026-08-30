"""Restart-safe Modal launcher for strategy-search and competitive scoring."""

from __future__ import annotations

import builtins
import concurrent.futures
import fcntl
import hashlib
import json
import math
import os
import pathlib
import queue
import re
import resource
import shutil
import socket
import struct
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import traceback
import uuid
from typing import Any

import modal

CPU_RATE_PER_CORE_HOUR = 0.0473
MEMORY_RATE_PER_GIB_HOUR = 0.008
GROSS_BUDGET_USD = 25.0
MAX_PHYSICAL_CORES = 192
MAX_FULL_RUNS = 3
MAX_RETRIES = 2
COMPETITIVE_SCORER_VERSION = "native-competitive-v1"
COMPETITIVE_RUN_CAP_USD = 2.0
COMPETITIVE_TARGET_BLOCKS = 65_536
COMPETITIVE_ARTIFACT_MAGIC = b"HPS1"
CAMPAIGN_CHECKPOINT_EVENT = "strategy-search-checkpoint"
CAMPAIGN_STAGE_STOP_EVENT = "strategy-search-stage-stop"
CAMPAIGN_STAGES = {"goldfish", "matrix", "psro"}
STRATEGY_SEARCH_MAX_JOB_ATTEMPTS = 3
GOLDFISH_MODAL_ROUTE = "goldfish-only-v1"
GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND = 0.0000131
GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND = 0.00000222
GOLDFISH_MODAL_HARD_COST_CAP_USD = 100.0
GOLDFISH_MODAL_MAX_WORKER_CORES = 64
GOLDFISH_MODAL_MIN_WALL_SECONDS = 300
GOLDFISH_MODAL_MAX_WALL_SECONDS = 21600
GOLDFISH_MODAL_SCORE_MEMORY_MIB = 4096
GOLDFISH_MODAL_REDUCE_MEMORY_MIB = 8192
GOLDFISH_MODAL_SCORE_TIMEOUT_SECONDS = 180
GOLDFISH_MODAL_REDUCE_ONE_TIMEOUT_SECONDS = 600
GOLDFISH_MODAL_REDUCE_TWO_TIMEOUT_SECONDS = 300
GOLDFISH_MODAL_ATTEMPTS = 3
PSRO_MODAL_CPU_RATE_PER_CORE_SECOND = 0.0000131
PSRO_MODAL_MEMORY_RATE_PER_GIB_SECOND = 0.00000222
PSRO_MODAL_COMMIT_INTERVAL_SECONDS = 600
GOLDFISH_MODAL_REDUCER_CORES = 4
CAMPAIGN_RUST_GOLDFISH_BIN = os.environ.get(
    "HEXDECK_GOLDFISH_BIN", "/workspace/rust/target/release/hexdeck-goldfish")
LEDGER_PATH = pathlib.Path.home() / ".hexdeck-modal-cost-ledger.json"

LOCAL_PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNTIME_WORKSPACE_ROOT = pathlib.Path(os.environ.get("HEXDECK_STRATEGY_WORKSPACE", "/workspace"))
PROJECT_ROOT = LOCAL_PROJECT_ROOT if modal.is_local() else RUNTIME_WORKSPACE_ROOT
MODAL_SOURCE_ROOT = PROJECT_ROOT / "modal"
if str(MODAL_SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(MODAL_SOURCE_ROOT))
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


def _called_process_details(error: subprocess.CalledProcessError) -> str:
    captured = []
    for name in ("stdout", "stderr"):
        value = getattr(error, name, None)
        if isinstance(value, bytes):
            value = value.decode(errors="replace")
        if isinstance(value, str) and value.strip():
            captured.append((name, value.strip()))
    if len(captured) == 1:
        details = captured[0][1]
    elif captured:
        details = "\n".join(f"[{name}]\n{value}" for name, value in captured)
    else:
        details = repr(error).strip() or str(error).strip() or "CalledProcessError with no diagnostic"
    if len(details) > 64 * 1024:
        details = f"[subprocess output tail; {len(details)} characters total]\n{details[-64 * 1024:]}"
    return details


def _run_checked(command: list[str], label: str, **kwargs: Any) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(command, check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"{label} failed: {_called_process_details(error)}") from error


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


def _strategy_search_subprocess_command(entry: str, kingdom_id: str, arguments: list[str]) -> list[str]:
    return ["npx", "tsx", "scripts/strategy_search_subprocess.ts", "--entry", entry,
        "--kingdom", kingdom_id, "--", *arguments]


def _strategy_search_validate_psro_score_receipt(publication: dict[str, Any], artifact: pathlib.Path) -> bool:
    transition_path = publication.get("transitionPath")
    score_task = publication.get("scoreTask")
    if not transition_path or not isinstance(score_task, dict):
        raise RuntimeError("PSRO score receipt has no sealed look context")
    with tempfile.TemporaryDirectory() as directory:
        root = pathlib.Path(directory)
        task, output = root / "task.json", root / "validation.json"
        _atomic_json(task, score_task)
        _run_checked(_strategy_search_subprocess_command("psro-score-receipt-validator",
            publication["kingdomId"], ["--out", str(output), "--transition",
                str(_strategy_search_path(transition_path)), "--task", str(task), "--chunk", str(artifact)]),
            "strategy-search PSRO score receipt validation", cwd="/workspace",
            text=True, capture_output=True, timeout=120)
        result = _strategy_search_load(output)
    if not isinstance(result, dict) or set(result) != {"valid"} or not isinstance(result["valid"], bool):
        raise RuntimeError("PSRO score receipt validator returned malformed output")
    return result["valid"]


def _strategy_search_validate_publication(publication: dict[str, Any], temporary: pathlib.Path) -> None:
    stage = publication["stage"]
    goldfish_kinds = {"goldfish-one": "stage-one", "goldfish-two": "stage-two",
        "goldfish-one-reduce": "top", "goldfish-two-reduce": "reservoir"}
    if stage in goldfish_kinds:
        command = [CAMPAIGN_RUST_GOLDFISH_BIN, "verify", "--kingdom", publication["kingdomId"],
            "--kind", goldfish_kinds[stage], "--file", str(temporary)]
        if stage in {"goldfish-one", "goldfish-two"}:
            expected = publication.get("range")
            if not expected:
                raise RuntimeError("Goldfish publication has no semantic range")
            command += ["--start", str(expected["start"]), "--end", str(expected["end"])]
        if stage in {"goldfish-two", "goldfish-two-reduce"}:
            command += ["--top", str(_strategy_search_path(publication["topPath"]))]
        _run_checked(command, f"strategy-search {stage} artifact validation",
            text=True, capture_output=True, timeout=600)
        return
    if stage == "psro-score":
        if not _strategy_search_validate_psro_score_receipt(publication, temporary):
            raise RuntimeError("strategy-search PSRO score chunk does not match its sealed look")
        return
    if stage in {"matrix-reduce", "psro-reduce"}:
        _run_checked(_strategy_search_subprocess_command("validator", publication["kingdomId"], [
            "--stage", stage, "--file", str(temporary), "--evidence-id", publication["evidenceId"],
            "--kingdom", publication["kingdomId"], "--evidence-root",
            str(_strategy_search_path(f"evidence/{publication['evidenceId']}"))]),
            f"strategy-search {stage} artifact validation", cwd="/workspace",
            text=True, capture_output=True, timeout=600)
        return
    value = json.loads(temporary.read_text())
    transition_valid = stage == "psro-decision" and isinstance(value, dict) \
        and value.get("kind") in {"score", "admission-row", "complete"} \
        and isinstance(value.get("checkpoint"), dict) and value["checkpoint"].get("schemaVersion") == 1
    if not isinstance(value, dict) or not value.get("schemaVersion") and not transition_valid:
        raise RuntimeError(f"strategy-search {stage} runtime artifact is malformed")


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
    result = _run_checked([CAMPAIGN_RUST_GOLDFISH_BIN, "kingdom", "--kingdom", "deep-beam-tuning-007"],
        "strategy-search Goldfish worker readiness", cwd=RUNTIME_WORKSPACE_ROOT,
        text=True, capture_output=True, timeout=60)
    try:
        value = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError) as error:
        raise RuntimeError("strategy-search Goldfish readiness returned invalid JSON") from error
    if value.get("kingdomId") != "deep-beam-tuning-007" or value.get("candidateCount") != 12_972_960:
        raise RuntimeError("strategy-search Goldfish readiness returned the wrong kingdom")


def _strategy_search_remote_goldfish_canary(source_identity: dict[str, Any]) -> None:
    relative = f"preflight/{source_identity['digest']}/goldfish-canary.hgs"
    config = {"taskId": "deployment-goldfish-canary", "evidenceId": source_identity["scientificDigest"],
        "kingdomId": "deep-beam-tuning-007", "temporaryPath": relative,
        "sourceImage": source_identity, "cpu": 1, "timeoutSeconds": 90,
        "stage": "goldfish-one", "mode": "score-one", "range": {"start": 0, "end": 1},
        "enqueuedEpochMs": int(time.time() * 1000)}
    call = strategy_search_goldfish_job.with_options(
        cpu=1, memory=4096, timeout=120, retries=0).spawn(config)
    try:
        polled = _strategy_search_poll_function_call(call)
        if polled["state"] == "failed":
            raise RuntimeError(f"Goldfish canary {call.object_id} failed during first poll: "
                f"{polled['diagnostic']['error']}") from polled["exception"]
        result = polled.get("result") if polled["state"] == "complete" else call.get(timeout=120)
        if result.get("sha256") != result.get("validatedSha256") \
                or not re.fullmatch(r"[0-9a-f]{64}", result.get("sha256", "")):
            raise RuntimeError(f"Goldfish canary {call.object_id} returned invalid validation evidence")
    except Exception as error:
        diagnostic = _strategy_search_exception_diagnostic(error)
        raise RuntimeError(f"Goldfish canary {call.object_id} failed: {diagnostic['error']}; "
            f"repr={diagnostic['errorRepr']}") from error
    finally:
        volume.reload()
        output = pathlib.Path("/results") / relative
        for held in [output, output.with_suffix(output.suffix + ".phases.json"),
                output.with_suffix(output.suffix + ".rust-report.json")]:
            held.unlink(missing_ok=True)
        volume.commit()


def _strategy_search_compute_readiness_impl(source_identity: dict[str, Any], remote_canary: bool) -> dict[str, Any]:
    verify_strategy_search_source(source_identity)
    _strategy_search_verify_goldfish_startup()
    if remote_canary:
        _strategy_search_remote_goldfish_canary(source_identity)
    return {"ready": True, "sourceDigest": source_identity["digest"],
        "readyMs": int(time.time() * 1000)}


@app.function(image=image, cpu=1, memory=2048, timeout=180, max_containers=1,
              volumes={"/results": volume})
def strategy_search_compute_ready(source_identity: dict[str, Any]) -> dict[str, Any]:
    return _strategy_search_compute_readiness_impl(source_identity, True)


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
        requested_route = request.get("route", "full-strategy-search")
        if saved.get("route", "full-strategy-search") != requested_route \
                or saved.get("costGuard") != request.get("costGuard"):
            raise RuntimeError("saved execution route or cost guard differs")
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
        completion = state.get("completion") if state else None
        if not completion:
            return {"complete": False}
        receipts = completion.get("receipts", {})
        if set(receipts) != {"goldfish-one-reduce", "goldfish-two-reduce", "matrix-reduce", "psro-reduce"}:
            return {"complete": False}
        for stage, receipt in receipts.items():
            artifact = _strategy_search_path(receipt["artifactPath"])
            if not artifact.exists() or _strategy_search_sha256(artifact) != receipt["sha256"]:
                raise RuntimeError(f"complete evidence receipt differs for {stage}")
        return {"complete": True, "receipts": receipts}
    if operation == "goldfish-evidence-complete":
        evidence_id = request["evidenceId"]
        state = _strategy_search_load(_strategy_search_evidence_state(evidence_id))
        completion = state.get("goldfishCompletion") if state else None
        if not completion:
            return {"complete": False}
        receipts = completion.get("receipts", {})
        if set(receipts) != {"goldfish-one-reduce", "goldfish-two-reduce"}:
            return {"complete": False}
        for stage, receipt in receipts.items():
            artifact = _strategy_search_path(receipt["artifactPath"])
            if not artifact.exists() or _strategy_search_sha256(artifact) != receipt["sha256"]:
                raise RuntimeError(f"complete Goldfish receipt differs for {stage}")
        return {"complete": True, "receipts": receipts}
    if operation in {"evidence-finalize", "goldfish-evidence-finalize"}:
        evidence_id = request["evidenceId"]
        state_file = _strategy_search_evidence_state(evidence_id)
        state = _strategy_search_load(state_file)
        receipts = {}
        for stage, task_id in request["taskIds"].items():
            receipt = state.get("receipts", {}).get(task_id) if state else None
            if not receipt:
                raise RuntimeError(f"cannot finalize evidence without {stage} receipt")
            artifact = _strategy_search_path(receipt["artifactPath"])
            if not artifact.exists() or _strategy_search_sha256(artifact) != receipt["sha256"]:
                raise RuntimeError(f"cannot finalize evidence with invalid {stage} artifact")
            receipts[stage] = receipt
        completion_key = "goldfishCompletion" if operation == "goldfish-evidence-finalize" else "completion"
        state[completion_key] = {"completedMs": request.get("nowMs", int(time.time() * 1000)),
            "receipts": receipts}
        _atomic_json(state_file, state)
        volume.commit()
        return state[completion_key]
    if operation == "execution-fail":
        state_file = _strategy_search_execution_file(request["campaignExecutionId"])
        state = _strategy_search_load(state_file)
        if state is None:
            raise RuntimeError("strategy-search execution is missing during failure persistence")
        failed_ms = request.get("nowMs", int(time.time() * 1000))
        attempts = [attempt for job in state.get("jobs", []) for attempt in job.get("attempts", [])]
        cost_rates = (GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND * 3600,
            GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND * 3600) \
            if state.get("route") == GOLDFISH_MODAL_ROUTE else \
            (CPU_RATE_PER_CORE_HOUR, MEMORY_RATE_PER_GIB_HOUR)
        costs = [_strategy_search_attempt_cost(attempt, failed_ms, *cost_rates) for attempt in attempts
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
                if item.get("stage") == "psro-score" \
                        and not _strategy_search_validate_psro_score_receipt(item, destination):
                    preserved_relative = f"evidence/{evidence_id}/invalidated/psro-score/{task_id}/" \
                        f"{receipt['sha256']}.json"
                    preserved = _strategy_search_path(preserved_relative)
                    if preserved.exists() and _strategy_search_sha256(preserved) != receipt["sha256"]:
                        raise RuntimeError("preserved PSRO score receipt conflicts")
                    if not preserved.exists():
                        preserved.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(destination, preserved)
                        volume.commit()
                    destination.unlink()
                    invalid = {**receipt, "preservedArtifactPath": preserved_relative,
                        "invalidatedMs": now, "reason": "sealed-look-mismatch"}
                    state.setdefault("invalidReceipts", {}).setdefault(task_id, []).append(invalid)
                    del state["receipts"][task_id]
                    state["leases"].pop(task_id, None)
                    state["intents"].pop(task_id, None)
                    receipt = None
                if receipt:
                    results[task_id] = {"complete": True, "receipt": receipt}
                    continue
            lease = state["leases"].get(task_id)
            if lease and lease["leaseUntilMs"] > now and lease["ownerId"] != request["ownerId"]:
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
        if lease and lease["leaseUntilMs"] > now and lease["ownerId"] != request["ownerId"]:
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


def _strategy_search_goldfish_phases(report: dict[str, Any]) -> dict[str, Any]:
    keys = ["generationMs", "scoringMs", "intermediateSerializationAndReadMs",
        "temporaryVolumeWriteCommitMs", "publisherWaitMs", "publicationCommitMs",
        "reductionComputeMs", "finalTop500000WriteMs", "finalTop20000WriteMs",
        "orchestrationQueueMs"]
    phases = {key: 0 for key in keys}
    command = report["command"]
    if command in {"score-one", "score-two"}:
        phases["scoringMs"] = report["scoringMs"]
        phases["intermediateSerializationAndReadMs"] = report["readMs"] + report["writeMs"]
    elif command == "reduce-one":
        phases["intermediateSerializationAndReadMs"] = report["readMs"]
        phases["reductionComputeMs"] = report["reduceMs"]
        phases["finalTop500000WriteMs"] = report["writeMs"]
    elif command == "reduce-two":
        phases["intermediateSerializationAndReadMs"] = report["readMs"]
        phases["reductionComputeMs"] = report["reduceMs"]
        phases["finalTop20000WriteMs"] = report["writeMs"]
    else:
        raise RuntimeError(f"unknown Rust Goldfish report command {command}")
    assigned = sum(phases.values())
    if assigned > report["elapsedMs"]:
        raise RuntimeError("Rust Goldfish report phases exceed elapsed time")
    phases["orchestrationQueueMs"] = report["elapsedMs"] - assigned
    return {**phases, "elapsedMs": report["elapsedMs"]}


@app.function(image=image, cpu=4, memory=4096, timeout=900, retries=0, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def strategy_search_goldfish_job(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    config["workerStartedEpochMs"] = int(time.time() * 1000)
    output = _strategy_search_path(config["temporaryPath"])
    rust_report_path = output.with_suffix(output.suffix + ".rust-report.json")
    phases_path = output.with_suffix(output.suffix + ".phases.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [CAMPAIGN_RUST_GOLDFISH_BIN, config["mode"], "--kingdom", config["kingdomId"],
        "--out", str(output), "--report", str(rust_report_path)]
    if config.get("range"):
        command += ["--start", str(config["range"]["start"]), "--end", str(config["range"]["end"]),
            "--threads", str(config["cpu"])]
    if config.get("manifest"):
        manifest = output.with_suffix(".manifest.json")
        _atomic_json(manifest, [_strategy_search_path(held).as_posix() for held in config["manifest"]])
        command += ["--inputs", str(manifest)]
    if config.get("topPath"):
        command += ["--top", str(_strategy_search_path(config["topPath"]))]
    result = _strategy_search_run_subprocess(command, config)
    phase_report = _strategy_search_goldfish_phases(_strategy_search_load(rust_report_path))
    _atomic_json(phases_path, phase_report)
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


def _strategy_search_psro_input_paths(config: dict[str, Any]) -> list[str]:
    matrix_dir = config["matrixDir"].rstrip("/")
    return [config["topPath"], config["reservoirPath"],
        *[f"{matrix_dir}/{name}" for name in
            ["pairs.hgm", "purchases.hgm", "matrix.hgm", "self-play-v1.hst"]]]


def _strategy_search_psro_job_impl(config: dict[str, Any]) -> dict[str, Any]:
    from psro_step import run_psro_step

    worker_started_ms = int(time.time() * 1000)
    worker_started = time.monotonic()
    verify_strategy_search_source(config["sourceImage"])
    if config["threads"] != config["cpu"]:
        raise ValueError("PSRO threads must equal the Modal CPU request")
    input_paths = _strategy_search_psro_input_paths(config)
    if set(config["inputSha256"]) != set(input_paths):
        raise ValueError("PSRO input hash set differs from the six required inputs")
    volume.reload()
    for relative in input_paths:
        actual = _strategy_search_sha256(_strategy_search_path(relative))
        if actual != config["inputSha256"][relative]:
            raise RuntimeError(f"PSRO Volume input hash differs: {relative}")

    out = _strategy_search_path(config["outPath"])
    out.mkdir(parents=True, exist_ok=True)
    call_id = modal.current_function_call_id()
    lease_file = out / "lease.json"
    existing_lease = _strategy_search_load(lease_file)
    if existing_lease and existing_lease.get("callId") != call_id:
        existing_call = modal.FunctionCall.from_id(existing_lease["callId"])
        if _strategy_search_poll_function_call(existing_call)["state"] == "pending":
            raise RuntimeError("duplicate PSRO launch")
    lease = {"protocol": "modal-psro-lease-v1", "launchId": config["launchId"],
        "callId": call_id, "workerStartedEpochMs": worker_started_ms}
    _atomic_json(lease_file, lease)
    volume.commit()

    progress_file = out / "progress.json"
    def checkpoint_progress(ordinal: int, crc: int, commit_count: int, commit_ms: float) -> None:
        _atomic_json(progress_file, {"protocol": "modal-psro-progress-v1",
            "launchId": config["launchId"], "callId": call_id,
            "checkpointOrdinal": ordinal, "checkpointCrc": crc,
            "commitCount": commit_count, "volumeCommitMs": commit_ms,
            "updatedEpochMs": int(time.time() * 1000)})

    rust_report_file = out / "run-report.json"
    result = run_psro_step(
        CAMPAIGN_RUST_GOLDFISH_BIN,
        config["kingdomId"],
        str(_strategy_search_path(config["topPath"])),
        str(_strategy_search_path(config["reservoirPath"])),
        str(_strategy_search_path(config["matrixDir"])),
        str(out),
        config["threads"],
        str(rust_report_file),
        volume=volume,
        commit_interval_seconds=PSRO_MODAL_COMMIT_INTERVAL_SECONDS,
        on_checkpoint=checkpoint_progress,
        deep_verify=False,
    )
    rust_report = result["report"]
    worker_finished_ms = int(time.time() * 1000)
    job_wall_ms = (time.monotonic() - worker_started) * 1000
    transitions = rust_report["transitions"]
    transition_ms = sum(float(entry["elapsedMs"]) for entry in transitions)
    rust_elapsed_ms = float(rust_report["elapsedMs"])
    memory_mib = config["memoryMiB"]
    measured_cost = job_wall_ms / 1000 * (config["cpu"] * PSRO_MODAL_CPU_RATE_PER_CORE_SECOND
        + memory_mib / 1024 * PSRO_MODAL_MEMORY_RATE_PER_GIB_SECOND)
    report = {"protocol": "modal-psro-job-report-v1", "kingdomId": config["kingdomId"],
        "evidenceId": config["evidenceId"], "launchId": config["launchId"], "callId": call_id,
        "workerStartedEpochMs": worker_started_ms, "workerFinishedEpochMs": worker_finished_ms,
        "jobWallMs": job_wall_ms, "rustElapsedMs": rust_elapsed_ms,
        "totalGames": rust_report["totalGames"], "gamesPerSecond": rust_report["gamesPerSecond"],
        "transitionCount": len(transitions), "transitionElapsedMs": transition_ms,
        "nonTransitionShare": max(0.0, rust_elapsed_ms - transition_ms) / rust_elapsed_ms
            if rust_elapsed_ms > 0 else 0.0,
        "commitCount": result["commitCount"], "volumeCommitMs": result["volumeCommitMs"],
        "commitShare": result["volumeCommitMs"] / job_wall_ms if job_wall_ms > 0 else 0.0,
        "maxResidentSetSizeMiB": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024,
        "requestedCores": config["cpu"], "requestedMemoryMiB": memory_mib,
        "measuredCostUsd": measured_cost, "runReport": rust_report}
    _atomic_json(out / "job-report.json", report)
    volume.commit()
    return report


@app.function(image=image, cpu=16, memory=16384, timeout=86400, retries=0,
              scaledown_window=300, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def strategy_search_psro_job(config: dict[str, Any]) -> dict[str, Any]:
    return _strategy_search_psro_job_impl(config)


@app.function(image=image, cpu=4, memory=8192, timeout=900, retries=0,
              scaledown_window=300, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def strategy_search_downstream_job(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    worker_started_ms = int(time.time() * 1000)
    stage_started = time.monotonic()
    output = _strategy_search_path(config["temporaryPath"])
    output.parent.mkdir(parents=True, exist_ok=True)
    work = output.parent / "input"
    work.mkdir(parents=True, exist_ok=True)
    stage = config["stage"]
    if stage == "matrix-manifest":
        command = _strategy_search_subprocess_command("matrix-manifest", config["kingdomId"], [
            "--evidence-id", config["evidenceId"], "--kingdom", config["kingdomId"],
            "--reservoir", str(_strategy_search_path(config["reservoirPath"])),
            "--reservoir-sha256", config["reservoirSha256"],
            "--seed-namespace", "strategy-search-matrix-v2", "--out", str(output)])
    elif stage == "matrix-score":
        command = _strategy_search_subprocess_command("matrix-score", config["kingdomId"], [
            "--manifest", str(_strategy_search_path(config["manifestPath"])),
            "--task-index", str(config["taskIndex"]), "--task-count", str(config["taskCount"]),
            "--workers", str(config["cpu"]), "--out", str(output)])
    elif stage == "matrix-reduce":
        chunks = work / "chunks.json"
        _atomic_json(chunks, [str(_strategy_search_path(held)) for held in config["chunkPaths"]])
        command = _strategy_search_subprocess_command("matrix-reduce", config["kingdomId"], [
            "--manifest", str(_strategy_search_path(config["manifestPath"])),
            "--chunks", str(chunks), "--task-count", str(config["taskCount"]), "--out", str(output)])
    else:
        entry = "parallel-psro"
        arguments = ["--mode", config["operation"], "--out", str(output)]
        if config["operation"] != "finalize":
            arguments += ["--target-tasks", str(config["targetTasks"])]
        transition = None
        if config.get("transitionPath"):
            transition_path = _strategy_search_path(config["transitionPath"])
            transition = _strategy_search_load(transition_path)
            arguments += ["--transition", str(transition_path)]
        if stage == "psro-decision" and config["operation"] == "init":
            arguments += ["--evidence-id", config["evidenceId"], "--kingdom", config["kingdomId"],
                "--reservoir", str(_strategy_search_path(config["reservoirPath"])),
                "--matrix", str(_strategy_search_path(config["matrixPath"]))]
        elif config["operation"] in {"score", "reduce-score"}:
            if config["operation"] == "score":
                task = work / "task.json"
                _atomic_json(task, config["scoreTask"])
                arguments += ["--task", str(task), "--workers", str(config["cpu"])]
            else:
                chunks = work / "chunks.json"
                _atomic_json(chunks, [str(_strategy_search_path(held)) for held in config["chunkPaths"]])
                arguments += ["--chunks", str(chunks)]
        elif config["operation"] in {"admission-score", "admission-reduce"}:
            if config["operation"] == "admission-score":
                arguments += ["--task-index", str(config["taskIndex"]), "--workers", str(config["cpu"])]
            else:
                chunks = work / "chunks.json"
                _atomic_json(chunks, [str(_strategy_search_path(held)) for held in config["chunkPaths"]])
                arguments += ["--chunks", str(chunks)]
        elif config["operation"] == "finalize":
            transition_file = work / "transition.json"
            _atomic_json(transition_file, transition)
            arguments = ["--mode", "finalize", "--out", str(output), "--transition", str(transition_file),
                "--matrix", str(_strategy_search_path(config["matrixPath"]))]
        command = _strategy_search_subprocess_command(entry, config["kingdomId"], arguments)
    result = _strategy_search_run_subprocess(command, config)
    validated_sha256 = _strategy_search_sha256(output)
    _strategy_search_validate_publication(config, output)
    commit_started = time.monotonic()
    volume.commit()
    commit_ms = (time.monotonic() - commit_started) * 1000
    result["modalWorkerElapsedMs"] = (time.monotonic() - stage_started) * 1000
    result["elapsedMs"] = result["modalWorkerElapsedMs"] \
        + max(0, worker_started_ms - config["enqueuedEpochMs"])
    result["workerFinishedEpochMs"] = int(time.time() * 1000)
    return {**result, "sha256": validated_sha256, "validatedSha256": validated_sha256,
        "workerStartedEpochMs": worker_started_ms, "workerFinishedEpochMs": result["workerFinishedEpochMs"],
        "temporaryVolumeWriteCommitMs": commit_ms, "temporaryPath": config["temporaryPath"]}


def _strategy_search_attempt_cost(attempt: dict[str, Any], until_ms: int,
                                  cpu_rate_per_core_hour: float = CPU_RATE_PER_CORE_HOUR,
                                  memory_rate_per_gib_hour: float = MEMORY_RATE_PER_GIB_HOUR) -> dict[str, Any]:
    elapsed_ms = attempt.get("modalWorkerElapsedMs")
    measured = isinstance(elapsed_ms, (int, float)) and elapsed_ms >= 0
    if not measured:
        elapsed_ms = max(0, attempt.get("finishedMs", until_ms) - attempt["submittedMs"])
    cost = elapsed_ms / 3_600_000 * (attempt["cpu"] * cpu_rate_per_core_hour
        + attempt["memoryMiB"] / 1024 * memory_rate_per_gib_hour)
    return {"elapsedMs": elapsed_ms, "costUsd": cost,
        "basis": "worker-measured" if measured else "submitted-upper-bound"}


def _strategy_search_score_look_utilization(state: dict[str, Any], until_ms: int) -> list[dict[str, Any]]:
    tasks = {task["taskId"]: task for task in state.get("tasks", [])}
    groups: dict[tuple[str, str, str, str], list[dict[str, Any]]] = {}
    for job in state.get("jobs", []):
        if job.get("stage") not in {"matrix-score", "psro-score"}:
            continue
        metadata = tasks.get(job["taskId"], {}).get("metadata", {})
        look_id = metadata.get("lookDescriptorHash", "matrix")
        key = (job["evidenceId"], job["kingdomId"], job["stage"], look_id)
        groups.setdefault(key, []).append(job)
    def peak(jobs: list[dict[str, Any]], start_key: str, end_key: str) -> int:
        deltas: dict[int, int] = {}
        for job in jobs:
            for attempt in job.get("attempts", []):
                start = attempt.get(start_key)
                if not isinstance(start, int):
                    continue
                end = attempt.get(end_key, until_ms)
                if not isinstance(end, int) or end < start:
                    continue
                deltas[start] = deltas.get(start, 0) + attempt["cpu"]
                deltas[end] = deltas.get(end, 0) - attempt["cpu"]
        running = maximum = 0
        for held in sorted(deltas):
            running += deltas[held]
            maximum = max(maximum, running)
        return maximum
    def distribution(values: list[float]) -> dict[str, float] | None:
        if not values:
            return None
        held = sorted(values)
        percentile = lambda fraction: held[round((len(held) - 1) * fraction)]
        return {"min": held[0], "p50": percentile(0.5), "p95": percentile(0.95), "max": held[-1]}
    result = []
    for (evidence_id, kingdom_id, stage, look_id), jobs in sorted(groups.items()):
        attempts = [attempt for job in jobs for attempt in job.get("attempts", [])]
        worker_durations = [attempt["workerFinishedMs"] - attempt["workerStartedMs"] for attempt in attempts
            if isinstance(attempt.get("workerStartedMs"), int)
            and isinstance(attempt.get("workerFinishedMs"), int)]
        queue_delays = [attempt["workerStartedMs"] - attempt["submittedMs"] for attempt in attempts
            if isinstance(attempt.get("submittedMs"), int) and isinstance(attempt.get("workerStartedMs"), int)]
        task_ids = {job["taskId"] for job in jobs}
        reduce_stage = "matrix-reduce" if stage == "matrix-score" else "psro-decision"
        reducer = next((job for job in state.get("jobs", []) if job.get("stage") == reduce_stage
            and set(job.get("dependencyTaskIds", [])) == task_ids), None)
        reducer_attempts = reducer.get("attempts", []) if reducer else []
        reducer_finished = max((attempt.get("finishedMs", 0) for attempt in reducer_attempts), default=0)
        worker_finished = max((attempt.get("workerFinishedMs", 0) for attempt in attempts), default=0)
        first_submitted = min((attempt.get("submittedMs", until_ms) for attempt in attempts), default=until_ms)
        last_finished = max(reducer_finished,
            max((attempt.get("finishedMs", 0) for attempt in attempts), default=0))
        reduction_worker_ms = sum(attempt.get("modalWorkerElapsedMs",
            max(0, attempt.get("workerFinishedMs", 0) - attempt.get("workerStartedMs", 0)))
            for attempt in reducer_attempts)
        result.append({"evidenceId": evidence_id, "kingdomId": kingdom_id, "stage": stage,
            "lookId": look_id, "taskCount": len(jobs),
            "requestedCpus": sum(tasks.get(job["taskId"], {}).get("cpu", job.get("cpus", 4)) for job in jobs),
            "peakSubmittedCpus": peak(jobs, "submittedMs", "finishedMs"),
            "peakRunningCpus": peak(jobs, "workerStartedMs", "workerFinishedMs"),
            "admissionFailureCount": sum(attempt.get("status") == "admission-failed" for attempt in attempts),
            "workerDurationMs": distribution(worker_durations), "queueDelayMs": distribution(queue_delays),
            "coordinationAndReductionMs": max(0, reducer_finished - worker_finished) if reducer_finished else None,
            "reductionWorkerMs": reduction_worker_ms if reducer_attempts else None,
            "totalWallMs": max(0, last_finished - first_submitted) if last_finished else None})
    return result


def _strategy_search_exception_diagnostic(error: BaseException) -> dict[str, str]:
    error_type = f"{type(error).__module__}.{type(error).__qualname__}"
    message = str(error).strip() or "<empty message>"
    if isinstance(error, subprocess.CalledProcessError):
        details = _called_process_details(error)
        if details not in message:
            message = f"{message}; captured output: {details}"
    display = f"{error_type}: {message}"
    if len(display) > 2000:
        display = f"{error_type}: [message tail] {message[-1800:]}"
    representation = repr(error).strip() or f"<{error_type} with empty repr>"
    formatted_traceback = "".join(traceback.format_exception(
        type(error), error, error.__traceback__)).strip() or f"{error_type}: <no traceback>"
    return {"error": display, "errorType": error_type, "errorRepr": representation[-2000:],
        "errorTraceback": formatted_traceback[-8000:]}


def _strategy_search_contextual_diagnostic(context: str, diagnostic: dict[str, str]) -> dict[str, str]:
    return {**diagnostic, "error": f"{context}: {diagnostic['error']}"[-2000:]}


def _strategy_search_poll_function_call(call: Any) -> dict[str, Any]:
    try:
        return {"state": "complete", "result": call.get(timeout=0)}
    except builtins.TimeoutError:
        # Modal 1.5.x uses the built-in TimeoutError, not modal.exception.TimeoutError, for pending calls.
        return {"state": "pending"}
    except Exception as error:
        return {"state": "failed", "exception": error,
            "diagnostic": _strategy_search_exception_diagnostic(error)}


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
    priority = {"psro-decision": 0, "matrix-reduce": 0, "admission-row-reduce": 0,
        "psro-reduce": 0, "matrix-manifest": 1, "matrix-score": 1, "psro-score": 1,
        "admission-row-score": 1, "goldfish-one-reduce": 2, "goldfish-two-reduce": 2,
        "goldfish-two": 3, "goldfish-one": 4}
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
        "cpu": task["cpu"], "memoryMiB": task["memoryMiB"],
        "timeoutSeconds": task["timeoutSeconds"], "stage": job["stage"]}
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
    elif job["stage"] == "matrix-manifest":
        reservoir_job = next(held for held in state["jobs"]
            if held["evidenceId"] == job["evidenceId"] and held["stage"] == "goldfish-two-reduce")
        config.update({"reservoirPath": f"evidence/{job['evidenceId']}/goldfish/reservoir.hgf",
            "reservoirSha256": reservoir_job["receipt"]["sha256"]})
    elif job["stage"] == "matrix-score":
        manifest_job = next(held for held in state["jobs"]
            if held["evidenceId"] == job["evidenceId"] and held["stage"] == "matrix-manifest")
        config.update({"manifestPath": manifest_job["receipt"]["artifactPath"],
            "taskIndex": task.get("metadata", {}).get("taskIndex", job["range"]["start"]),
            "taskCount": task.get("metadata", {})["taskCount"]})
    elif job["stage"] == "matrix-reduce":
        dependencies = [next(held for held in state["jobs"] if held["taskId"] == dependency)
                        for dependency in job["dependencyTaskIds"]]
        manifest_job = next(held for held in state["jobs"]
            if held["evidenceId"] == job["evidenceId"] and held["stage"] == "matrix-manifest")
        config.update({"manifestPath": manifest_job["receipt"]["artifactPath"],
            "chunkPaths": [held["receipt"]["artifactPath"] for held in dependencies],
            "taskCount": len(dependencies)})
    else:
        metadata = task.get("metadata", {})
        config.update(metadata)
        config["targetTasks"] = max(1, min(50, state["maxActiveCpus"] // 4))
        if job["stage"] == "psro-decision" and metadata.get("operation") == "init":
            config.update({"reservoirPath": f"evidence/{job['evidenceId']}/goldfish/reservoir.hgf",
                "matrixPath": f"evidence/{job['evidenceId']}/matrix/evidence.json"})
        if metadata.get("operation") in {"reduce-score", "admission-reduce"}:
            dependencies = [next(held for held in state["jobs"] if held["taskId"] == dependency)
                            for dependency in job["dependencyTaskIds"]]
            config["chunkPaths"] = [held["receipt"]["artifactPath"] for held in dependencies]
        if metadata.get("operation") == "finalize":
            config["matrixPath"] = f"evidence/{job['evidenceId']}/matrix/evidence.json"
    job.update({"status": "launching", "launchId": launch_id, "taskFence": prepared["fence"],
        "temporaryPath": temporary, "cpu": task["cpu"], "leaseUntilMs": prepared["leaseUntilMs"]})
    return config


def _strategy_search_goldfish_task_id(evidence_id: str, stage: str,
                                      range_value: dict[str, int] | None) -> str:
    normalized_range = None if range_value is None else {
        "start": range_value["start"], "end": range_value["end"]}
    value = {"evidenceId": evidence_id, "stage": stage, "range": normalized_range}
    return hashlib.sha256(json.dumps(value, separators=(",", ":")).encode()).hexdigest()


def _strategy_search_goldfish_modal_compute_cost(cpu: float, memory_mib: int,
                                                  seconds: int) -> float:
    return seconds * (cpu * GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND
        + memory_mib / 1024 * GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND)


def _strategy_search_goldfish_worst_case_cost(request: dict[str, Any],
                                               task_counts: dict[str, int]) -> float:
    score_tasks = task_counts["scoreOne"] + task_counts["scoreTwo"]
    score = score_tasks * GOLDFISH_MODAL_ATTEMPTS * _strategy_search_goldfish_modal_compute_cost(
        request["workerCores"], GOLDFISH_MODAL_SCORE_MEMORY_MIB,
        GOLDFISH_MODAL_SCORE_TIMEOUT_SECONDS + 30)
    reduce_one = task_counts["reduceOne"] * GOLDFISH_MODAL_ATTEMPTS \
        * _strategy_search_goldfish_modal_compute_cost(GOLDFISH_MODAL_REDUCER_CORES,
            GOLDFISH_MODAL_REDUCE_MEMORY_MIB, GOLDFISH_MODAL_REDUCE_ONE_TIMEOUT_SECONDS + 30)
    reduce_two = task_counts["reduceTwo"] * GOLDFISH_MODAL_ATTEMPTS \
        * _strategy_search_goldfish_modal_compute_cost(GOLDFISH_MODAL_REDUCER_CORES,
            GOLDFISH_MODAL_REDUCE_MEMORY_MIB, GOLDFISH_MODAL_REDUCE_TWO_TIMEOUT_SECONDS + 30)
    controller = _strategy_search_goldfish_modal_compute_cost(
        1, 2048, request["maxWallSeconds"] + 60)
    publisher = _strategy_search_goldfish_modal_compute_cost(
        1, 8192, request["maxWallSeconds"])
    readiness = _strategy_search_goldfish_modal_compute_cost(1, 2048, 180)
    canary = _strategy_search_goldfish_modal_compute_cost(1, 4096, 120)
    control = _strategy_search_goldfish_modal_compute_cost(
        0.25, 512, request["maxWallSeconds"] + 90)
    return round(score + reduce_one + reduce_two + controller + publisher
        + readiness + canary + control, 6)


def _strategy_search_validate_goldfish_only_bundle(bundle: dict[str, Any]) -> dict[str, Any] | None:
    controller = bundle.get("controller", {})
    if controller.get("route") != GOLDFISH_MODAL_ROUTE:
        return None
    request = bundle.get("request")
    if not isinstance(request, dict) or set(request) != {
            "kingdomIds", "workerCores", "maxActiveCpus", "maxWallSeconds", "maxCostUsd"}:
        raise ValueError("Goldfish-only request is malformed")
    kingdom_ids = request["kingdomIds"]
    worker_cores = request["workerCores"]
    max_active_cpus = request["maxActiveCpus"]
    max_wall_seconds = request["maxWallSeconds"]
    max_cost_usd = request["maxCostUsd"]
    valid_numbers = all(isinstance(value, int) and not isinstance(value, bool) for value in
        [worker_cores, max_active_cpus, max_wall_seconds])
    if not isinstance(kingdom_ids, list) or not kingdom_ids \
            or not all(isinstance(value, str) and value for value in kingdom_ids) \
            or len(set(kingdom_ids)) != len(kingdom_ids) or not valid_numbers \
            or not 1 <= worker_cores <= GOLDFISH_MODAL_MAX_WORKER_CORES \
            or max_active_cpus < max(GOLDFISH_MODAL_REDUCER_CORES, worker_cores) \
            or not GOLDFISH_MODAL_MIN_WALL_SECONDS <= max_wall_seconds <= GOLDFISH_MODAL_MAX_WALL_SECONDS \
            or not isinstance(max_cost_usd, (int, float)) or isinstance(max_cost_usd, bool) \
            or not 0 < max_cost_usd <= GOLDFISH_MODAL_HARD_COST_CAP_USD:
        raise ValueError("Goldfish-only request exceeds a hard resource, time, or cost limit")
    if controller.get("maxActiveCpus") != max_active_cpus \
            or controller.get("maxWallSeconds") != max_wall_seconds \
            or controller.get("timeoutSeconds") != max_wall_seconds \
            or controller.get("goldfishWorkerCores") != worker_cores \
            or controller.get("goldfishScoreMemoryMiB") != GOLDFISH_MODAL_SCORE_MEMORY_MIB \
            or controller.get("goldfishScoreTimeoutSeconds") != GOLDFISH_MODAL_SCORE_TIMEOUT_SECONDS \
            or controller.get("goldfishReducerCores") != GOLDFISH_MODAL_REDUCER_CORES \
            or controller.get("goldfishReduceMemoryMiB") != GOLDFISH_MODAL_REDUCE_MEMORY_MIB \
            or controller.get("goldfishReduceOneTimeoutSeconds") != GOLDFISH_MODAL_REDUCE_ONE_TIMEOUT_SECONDS \
            or controller.get("goldfishReduceTwoTimeoutSeconds") != GOLDFISH_MODAL_REDUCE_TWO_TIMEOUT_SECONDS \
            or not re.fullmatch(r"[0-9a-f]{64}", controller.get("executionPlanHash", "")):
        raise ValueError("Goldfish-only controller resources differ from the authorized shape")
    allowed_stages = {"goldfish-one", "goldfish-one-reduce", "goldfish-two", "goldfish-two-reduce"}
    if any(held.get("stage") not in allowed_stages for held in bundle.get("jobs", [])) \
            or any(held.get("stage") not in allowed_stages for held in bundle.get("tasks", [])):
        raise ValueError("Goldfish-only bundle contains Matrix or PSRO work")
    partitions = bundle.get("partitions")
    if not isinstance(partitions, dict) or len(partitions) != len(kingdom_ids) * 2:
        raise ValueError("Goldfish-only partitions do not match the kingdoms")
    counts = {"scoreOne": 0, "reduceOne": len(kingdom_ids),
        "scoreTwo": 0, "reduceTwo": len(kingdom_ids)}
    evidence_stages: dict[str, set[str]] = {}
    for key, partition in partitions.items():
        stage = partition.get("stage") if isinstance(partition, dict) else None
        evidence_id = partition.get("evidenceId") if isinstance(partition, dict) else None
        total = partition.get("total") if isinstance(partition, dict) else None
        ranges = partition.get("jobs") if isinstance(partition, dict) else None
        expected_total = 12_972_960 if stage == "goldfish-one" else 500_000 \
            if stage == "goldfish-two" else None
        if key != f"{evidence_id}:{stage}" or not re.fullmatch(r"[0-9a-f]{64}", evidence_id or "") \
                or expected_total is None or total != expected_total or not isinstance(ranges, list) \
                or not ranges:
            raise ValueError("Goldfish-only partition identity or total is invalid")
        cursor = 0
        for held in ranges:
            if not isinstance(held, dict) or set(held) != {"start", "end"} \
                    or held["start"] != cursor or not isinstance(held["end"], int) \
                    or held["end"] <= cursor or held["end"] > total:
                raise ValueError("Goldfish-only partition coverage is invalid")
            cursor = held["end"]
        if cursor != total:
            raise ValueError("Goldfish-only partition coverage is incomplete")
        evidence_stages.setdefault(evidence_id, set()).add(stage)
        counts["scoreOne" if stage == "goldfish-one" else "scoreTwo"] += len(ranges)
    if len(evidence_stages) != len(kingdom_ids) \
            or any(stages != {"goldfish-one", "goldfish-two"} for stages in evidence_stages.values()):
        raise ValueError("Goldfish-only evidence partitions are incomplete")
    counts["total"] = sum(counts.values())
    guard = controller.get("costGuard")
    expected_guard_fields = {"cpuUsdPerCoreSecond", "memoryUsdPerGibSecond", "attemptCount",
        "hardMaximumCostUsd", "requestedMaximumCostUsd", "worstCaseModalComputeUsd", "taskCounts"}
    if not isinstance(guard, dict) or set(guard) != expected_guard_fields \
            or guard["cpuUsdPerCoreSecond"] != GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND \
            or guard["memoryUsdPerGibSecond"] != GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND \
            or guard["attemptCount"] != GOLDFISH_MODAL_ATTEMPTS \
            or guard["hardMaximumCostUsd"] != GOLDFISH_MODAL_HARD_COST_CAP_USD \
            or guard["requestedMaximumCostUsd"] != max_cost_usd \
            or guard["taskCounts"] != counts:
        raise ValueError("Goldfish-only cost guard inputs differ from the runtime calculation")
    worst_case = _strategy_search_goldfish_worst_case_cost(request, counts)
    if guard["worstCaseModalComputeUsd"] != worst_case \
            or worst_case > max_cost_usd or worst_case > GOLDFISH_MODAL_HARD_COST_CAP_USD:
        raise ValueError("Goldfish-only worst-case cost exceeds the authorized hard guard")
    return {"taskCounts": counts, "worstCaseModalComputeUsd": worst_case}


def _strategy_search_materialize_goldfish(state: dict[str, Any], bundle: dict[str, Any]) -> bool:
    worker_cpus = bundle["controller"].get("goldfishWorkerCores", 4)
    score_memory_mib = bundle["controller"].get("goldfishScoreMemoryMiB", 4096)
    score_timeout_seconds = bundle["controller"].get("goldfishScoreTimeoutSeconds", 180)
    reducer_cpus = bundle["controller"].get("goldfishReducerCores", 4)
    reduce_memory_mib = bundle["controller"].get("goldfishReduceMemoryMiB", 8192)
    window = max(1, state["maxActiveCpus"] // worker_cpus) * bundle["controller"].get("readyWindowWaves", 2)
    unlaunched = sum(job["stage"] in {"goldfish-one", "goldfish-two", "matrix-score",
            "psro-score", "admission-row-score"}
        and job["status"] in {"blocked", "ready"} for job in state["jobs"])
    changed = False
    kingdom_by_evidence = {}
    for job in state["jobs"]:
        kingdom_by_evidence[job["evidenceId"]] = job["kingdomId"]
    partition_entries = []
    reused = set(state.get("reusedEvidenceIds", []))
    for key, partition in sorted(state["partitions"].items()):
        evidence_id, stage = key.split(":", 1)
        if evidence_id in reused:
            continue
        if stage == "goldfish-two":
            reduce_one_id = _strategy_search_goldfish_task_id(evidence_id, "goldfish-one-reduce", None)
            if not any(job["taskId"] == reduce_one_id and job["status"] == "complete" for job in state["jobs"]):
                continue
        existing = {(job["range"]["start"], job["range"]["end"]) for job in state["jobs"]
            if job["evidenceId"] == evidence_id and job["stage"] == stage and job.get("range")}
        missing = [held for held in partition["jobs"] if (held["start"], held["end"]) not in existing]
        partition_entries.append([evidence_id, stage, missing, 0])
    while unlaunched < window and any(entry[3] < len(entry[2]) for entry in partition_entries):
        for entry in partition_entries:
            if unlaunched >= window or entry[3] >= len(entry[2]):
                continue
            evidence_id, stage, ranges, cursor = entry
            held = ranges[cursor]
            entry[3] += 1
            kingdom_id = kingdom_by_evidence[evidence_id]
            task_id = _strategy_search_goldfish_task_id(evidence_id, stage, held)
            dependency = [] if stage == "goldfish-one" else [
                _strategy_search_goldfish_task_id(evidence_id, "goldfish-one-reduce", None)]
            state["jobs"].append({"taskId": task_id, "evidenceId": evidence_id,
                "kingdomId": kingdom_id, "stage": stage, "range": held, "cpus": worker_cpus,
                "status": "blocked" if dependency else "ready", "dependencyTaskIds": dependency,
                "launchIntentId": None, "callId": None, "leaseUntilMs": None, "attemptCount": 0})
            state["tasks"].append({"taskId": task_id, "kingdomId": kingdom_id,
                "evidenceId": evidence_id, "stage": stage, "range": held, "cpu": worker_cpus,
                "memoryMiB": score_memory_mib, "timeoutSeconds": score_timeout_seconds,
                "dependencyTaskIds": dependency,
                "artifactPath": f"evidence/{evidence_id}/tasks/{stage}/{held['start']}-{held['end']}.hgs"})
            unlaunched += 1
            changed = True
    for key, partition in sorted(state["partitions"].items()):
        evidence_id, stage = key.split(":", 1)
        if evidence_id in reused:
            continue
        score_ids = [_strategy_search_goldfish_task_id(evidence_id, stage, held) for held in partition["jobs"]]
        if not all(any(job["taskId"] == task_id for job in state["jobs"]) for task_id in score_ids):
            continue
        reduce_stage = "goldfish-one-reduce" if stage == "goldfish-one" else "goldfish-two-reduce"
        reduce_id = _strategy_search_goldfish_task_id(evidence_id, reduce_stage, None)
        if any(job["taskId"] == reduce_id for job in state["jobs"]):
            continue
        kingdom_id = kingdom_by_evidence[evidence_id]
        state["jobs"].append({"taskId": reduce_id, "evidenceId": evidence_id,
            "kingdomId": kingdom_id, "stage": reduce_stage, "range": None, "cpus": reducer_cpus,
            "status": "blocked", "dependencyTaskIds": score_ids, "launchIntentId": None,
            "callId": None, "leaseUntilMs": None, "attemptCount": 0})
        reduce_timeout = bundle["controller"].get("goldfishReduceOneTimeoutSeconds", 300) \
            if stage == "goldfish-one" else bundle["controller"].get("goldfishReduceTwoTimeoutSeconds", 180)
        state["tasks"].append({"taskId": reduce_id, "kingdomId": kingdom_id,
            "evidenceId": evidence_id, "stage": reduce_stage, "range": None, "cpu": reducer_cpus,
            "memoryMiB": reduce_memory_mib, "timeoutSeconds": reduce_timeout,
            "dependencyTaskIds": score_ids, "artifactPath": f"evidence/{evidence_id}/goldfish/"
                + ("top-500000.hgf" if stage == "goldfish-one" else "reservoir.hgf")})
        changed = True
    return changed


def _strategy_search_dynamic_id(evidence_id: str, stage: str, semantic: Any) -> str:
    return hashlib.sha256(json.dumps({"evidenceId": evidence_id, "stage": stage, "semantic": semantic},
        sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _strategy_search_append_dynamic(state: dict[str, Any], *, evidence_id: str, kingdom_id: str,
                                    stage: str, cpus: int, memory_mib: int, timeout_seconds: int,
                                    dependencies: list[str], artifact_path: str,
                                    semantic: Any, metadata: dict[str, Any],
                                    range_value: dict[str, int] | None = None) -> str:
    task_id = _strategy_search_dynamic_id(evidence_id, stage, semantic)
    existing = next((held for held in state["jobs"] if held["taskId"] == task_id), None)
    if existing:
        return task_id
    status = "blocked" if dependencies else "ready"
    state["jobs"].append({"taskId": task_id, "evidenceId": evidence_id, "kingdomId": kingdom_id,
        "stage": stage, "range": range_value, "cpus": cpus, "status": status,
        "dependencyTaskIds": dependencies, "launchIntentId": None, "callId": None,
        "leaseUntilMs": None, "attemptCount": 0})
    state["tasks"].append({"taskId": task_id, "kingdomId": kingdom_id, "evidenceId": evidence_id,
        "stage": stage, "range": range_value, "cpu": cpus, "memoryMiB": memory_mib,
        "timeoutSeconds": timeout_seconds, "dependencyTaskIds": dependencies,
        "artifactPath": artifact_path, "metadata": metadata})
    return task_id


def _strategy_search_materialize_adaptive(state: dict[str, Any], bundle: dict[str, Any]) -> bool:
    partitions = state.get("dynamicScorePartitions", {})
    if not partitions:
        return False
    window = max(1, state["maxActiveCpus"] // 4) * bundle["controller"].get("readyWindowWaves", 2)
    unlaunched = sum(job["stage"] in {"goldfish-one", "goldfish-two", "matrix-score",
            "psro-score", "admission-row-score"}
        and job["status"] in {"blocked", "ready"} for job in state["jobs"])
    changed = False
    entries = [partitions[key] for key in sorted(partitions)]
    while unlaunched < window:
        added = False
        for partition in entries:
            if unlaunched >= window:
                break
            for task in partition["tasks"]:
                if partition["kind"] == "score":
                    start, end = task["candidateStart"], task["candidateEnd"]
                    schedule_start, schedule_end = task["scheduleStart"], task["scheduleEnd"]
                    semantic = {"look": partition["descriptorHash"],
                        "candidateStart": start, "candidateEnd": end,
                        "scheduleStart": schedule_start, "scheduleEnd": schedule_end}
                    stage, operation = "psro-score", "score"
                    artifact = f"{partition['root']}/{partition['descriptorHash']}/" \
                        f"score-{start}-{end}-blocks-{schedule_start}-{schedule_end}.json"
                    metadata = {"operation": operation, "transitionPath": partition["transitionPath"],
                        "scoreTask": task, "scoreBlocks": schedule_end - schedule_start,
                        "lookDescriptorHash": partition["descriptorHash"]}
                    timeout = max(60, math.ceil(task["expectedTaskMs"] * 2 / 1000 + 30))
                else:
                    start, end = task["opponentStart"], task["opponentEnd"]
                    semantic = {"row": partition["descriptorHash"],
                        "opponentStart": start, "opponentEnd": end}
                    stage, operation, timeout = "admission-row-score", "admission-score", 120
                    artifact = f"{partition['root']}/{partition['descriptorHash']}/row-{start}-{end}.json"
                    metadata = {"operation": operation, "transitionPath": partition["transitionPath"],
                        "taskIndex": task["taskIndex"]}
                task_id = _strategy_search_dynamic_id(partition["evidenceId"], stage, semantic)
                if any(job["taskId"] == task_id for job in state["jobs"]):
                    continue
                _strategy_search_append_dynamic(state, evidence_id=partition["evidenceId"],
                    kingdom_id=partition["kingdomId"], stage=stage, cpus=4, memory_mib=8192,
                    timeout_seconds=timeout, dependencies=[partition["parentTaskId"]],
                    artifact_path=artifact, semantic=semantic, metadata=metadata,
                    range_value={"start": start, "end": end})
                unlaunched += 1
                changed = True
                added = True
                break
        if not added:
            break
    for partition in entries:
        if partition["reducerCreated"]:
            continue
        score_ids = []
        for task in partition["tasks"]:
            if partition["kind"] == "score":
                semantic = {"look": partition["descriptorHash"],
                    "candidateStart": task["candidateStart"], "candidateEnd": task["candidateEnd"],
                    "scheduleStart": task["scheduleStart"], "scheduleEnd": task["scheduleEnd"]}
                stage = "psro-score"
            else:
                semantic = {"row": partition["descriptorHash"],
                    "opponentStart": task["opponentStart"], "opponentEnd": task["opponentEnd"]}
                stage = "admission-row-score"
            score_ids.append(_strategy_search_dynamic_id(partition["evidenceId"], stage, semantic))
        if not all(any(job["taskId"] == task_id for job in state["jobs"]) for task_id in score_ids):
            continue
        if partition["kind"] == "score":
            semantic = {"reduceLook": partition["descriptorHash"]}
            operation = "reduce-score"
        else:
            semantic = {"reduceRow": partition["descriptorHash"]}
            operation = "admission-reduce"
        _strategy_search_append_dynamic(state, evidence_id=partition["evidenceId"],
            kingdom_id=partition["kingdomId"], stage="psro-decision", cpus=1, memory_mib=4096,
            timeout_seconds=120, dependencies=score_ids,
            artifact_path=f"{partition['root']}/{partition['descriptorHash']}/transition.json",
            semantic=semantic, metadata={"operation": operation,
                "transitionPath": partition["transitionPath"]})
        partition["reducerCreated"] = True
        changed = True
    return changed


def _strategy_search_expand_transition(state: dict[str, Any], job: dict[str, Any]) -> bool:
    if job["stage"] != "psro-decision" or job.get("expanded") or job.get("status") != "complete":
        return False
    transition_path = job["receipt"]["artifactPath"]
    volume.reload()
    transition = _strategy_search_load(_strategy_search_path(transition_path))
    if not isinstance(transition, dict) or transition.get("kind") not in {
            "score", "admission-row", "complete"}:
        raise RuntimeError("PSRO decision returned an invalid transition")
    evidence_id, kingdom_id = job["evidenceId"], job["kingdomId"]
    root = f"evidence/{evidence_id}/psro/runtime"
    if transition["kind"] == "score":
        descriptor_hash = transition["look"]["descriptorHash"]
        state.setdefault("dynamicScorePartitions", {})[descriptor_hash] = {
            "kind": "score", "evidenceId": evidence_id, "kingdomId": kingdom_id,
            "parentTaskId": job["taskId"], "transitionPath": transition_path,
            "root": root, "descriptorHash": descriptor_hash,
            "scoreBlocks": transition["look"]["scheduleEnd"] - transition["look"]["scheduleStart"],
            "tasks": transition["tasks"], "reducerCreated": False}
    elif transition["kind"] == "admission-row":
        row_hash = transition["row"]["descriptorHash"]
        state.setdefault("dynamicScorePartitions", {})[row_hash] = {
            "kind": "admission-row", "evidenceId": evidence_id, "kingdomId": kingdom_id,
            "parentTaskId": job["taskId"], "transitionPath": transition_path,
            "root": root, "descriptorHash": row_hash,
            "tasks": transition["row"]["tasks"], "reducerCreated": False}
    else:
        _strategy_search_append_dynamic(state, evidence_id=evidence_id, kingdom_id=kingdom_id,
            stage="psro-reduce", cpus=1, memory_mib=8192, timeout_seconds=180,
            dependencies=[job["taskId"]], artifact_path=f"evidence/{evidence_id}/psro/evidence.json",
            semantic={"final": transition["checkpoint"]["evidenceHash"]}, metadata={"operation": "finalize",
                "transitionPath": transition_path})
    job["expanded"] = True
    return True


def _strategy_search_controller_impl(bundle: dict[str, Any]) -> dict[str, Any]:
    goldfish_plan = _strategy_search_validate_goldfish_only_bundle(bundle)
    goldfish_only = goldfish_plan is not None
    verify_strategy_search_source(bundle["sourceImage"])
    initialized = strategy_search_publisher.remote({"operation": "execution-init",
        "campaignExecutionId": bundle["campaignExecutionId"],
        "orderedEvidenceIds": list(dict.fromkeys(task["evidenceId"] for task in bundle["tasks"])),
        "partitions": bundle["partitions"], "jobs": bundle["jobs"], "tasks": bundle["tasks"],
        "maxActiveCpus": bundle["request"]["maxActiveCpus"],
        "sourceDigest": bundle["sourceImage"]["digest"],
        "route": GOLDFISH_MODAL_ROUTE if goldfish_only else "full-strategy-search",
        "costGuard": bundle["controller"].get("costGuard")})
    if initialized["status"] == "complete":
        return initialized["report"]
    owner_id = uuid.uuid4().hex
    state = strategy_search_publisher.remote({"operation": "controller-claim",
        "campaignExecutionId": bundle["campaignExecutionId"], "ownerId": owner_id,
        "nowMs": int(time.time() * 1000), "leaseMs": 120000})
    state["status"] = "running"
    reused_evidence_ids = set(state.get("reusedEvidenceIds", []))
    for evidence_id in {job["evidenceId"] for job in state["jobs"]}:
        complete_evidence = strategy_search_publisher.remote({
            "operation": "goldfish-evidence-complete" if goldfish_only else "evidence-complete",
            "evidenceId": evidence_id})
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
    def fail_active_wave(failure: dict[str, str], root_task_id: str) -> None:
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
                **failure})
            job.update({"status": "failed", "finishedMs": failed_ms,
                "lastError": failure["error"], "lastErrorType": failure["errorType"]})
            job.pop("activeConfig", None)
        active.clear()
        state.update({"status": "failed", "failedMs": failed_ms, "failure": failure["error"],
            "failureDiagnostic": failure, "admissionFailures": admission_failures,
            "publisherCommitMs": publisher_commit_ms, "admissionLimitCpus": admission_limit_cpus})
        strategy_search_publisher.remote({"operation": "execution-save",
            "campaignExecutionId": bundle["campaignExecutionId"], "fence": state["controllerFence"],
            "ownerId": owner_id, "nowMs": failed_ms, "leaseMs": 120000, "state": state})
        raise RuntimeError(failure["error"])
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
        if goldfish_only and now_ms - state["startedMs"] > bundle["controller"]["maxWallSeconds"] * 1000:
            timeout_error = TimeoutError("Goldfish-only scientific wall timeout expired")
            fail_active_wave(_strategy_search_exception_diagnostic(timeout_error), "goldfish-only-timeout")
        recovered_transitions = [] if goldfish_only else [_strategy_search_expand_transition(state, job)
            for job in list(state["jobs"]) if job["stage"] == "psro-decision"
            and job.get("status") == "complete" and not job.get("expanded")]
        materialized = any(recovered_transitions)
        if not goldfish_only:
            materialized = _strategy_search_materialize_adaptive(state, bundle) or materialized
        materialized = _strategy_search_materialize_goldfish(state, bundle) or materialized
        if materialized:
            state = strategy_search_publisher.remote({"operation": "execution-save",
                "campaignExecutionId": bundle["campaignExecutionId"], "fence": state["controllerFence"],
                "ownerId": owner_id, "nowMs": now_ms, "leaseMs": 120000, "state": state})
            last_saved_ms = now_ms
        transition_before = [(job["taskId"], job["status"], job.get("callId"), job.get("attemptCount", 0),
            len(job.get("attempts", []))) for job in state["jobs"]]
        if now_ms > interval_started:
            intervals.append({"startMs": interval_started, "endMs": now_ms,
                "allocatedCpus": interval_allocated, "unusedCpus": state["maxActiveCpus"] - interval_allocated,
                "reason": None if interval_allocated == state["maxActiveCpus"] else interval_reason})
        interval_started = now_ms
        interval_admission_rejected = False
        finished = []
        def poll_active(item: tuple[str, tuple[Any, dict[str, Any]]]) -> tuple[str, dict[str, Any], dict[str, Any]]:
            task_id, (call, config) = item
            return task_id, config, _strategy_search_poll_function_call(call)
        active_items = list(active.items())
        if active_items:
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(32, len(active_items))) as pool:
                poll_results = list(pool.map(poll_active, active_items))
        else:
            poll_results = []
        terminal_poll = next(((task_id, polled) for task_id, _config, polled in poll_results
            if polled["state"] == "failed" and _strategy_search_is_terminal_worker_error(polled["exception"])), None)
        if terminal_poll:
            fail_active_wave(_strategy_search_contextual_diagnostic(
                "non-retryable worker startup failure", terminal_poll[1]["diagnostic"]), terminal_poll[0])
        for task_id, config, polled in poll_results:
            if polled["state"] == "pending":
                continue
            if polled["state"] == "failed":
                error, diagnostic = polled["exception"], polled["diagnostic"]
                job = next(held for held in state["jobs"] if held["taskId"] == task_id)
                if _strategy_search_is_admission_error(error):
                    admission_failures += 1
                    interval_admission_rejected = True
                    remaining_cpus = sum(held_config["cpu"] for held_id, (_call, held_config)
                        in active.items() if held_id != task_id)
                    admission_limit_cpus = max(4, remaining_cpus + config["cpu"])
                attempt = job.setdefault("attempts", [])[-1]
                attempt.update({"finishedMs": now_ms, "status": "failed", **diagnostic})
                job["status"] = "retry-backoff"
                job["attemptCount"] = job.get("attemptCount", 0) + 1
                job["retryNotBeforeMs"] = now_ms + min(30000, 1000 * 2 ** min(job["attemptCount"], 5))
                job["lastError"] = diagnostic["error"]
                job["lastErrorType"] = diagnostic["errorType"]
                if _strategy_search_retryable_failure_count(job) >= STRATEGY_SEARCH_MAX_JOB_ATTEMPTS:
                    fail_active_wave(_strategy_search_contextual_diagnostic(
                        f"worker retry limit exhausted for {task_id}", diagnostic), task_id)
                del active[task_id]
                continue
            finished.append((task_id, config, polled["result"]))
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
            expansion_results = [_strategy_search_expand_transition(state,
                next(held for held in state["jobs"] if held["taskId"] == task_id))
                for task_id, _config, _result in finished]
            expanded = any(expansion_results)
            for task_id, _config, _result in finished:
                completed_job = next(held for held in state["jobs"] if held["taskId"] == task_id)
                final_stage = "goldfish-two-reduce" if goldfish_only else "psro-reduce"
                if completed_job["stage"] != final_stage:
                    continue
                evidence_id = completed_job["evidenceId"]
                final_stages = ["goldfish-one-reduce", "goldfish-two-reduce"] if goldfish_only else \
                    ["goldfish-one-reduce", "goldfish-two-reduce", "matrix-reduce", "psro-reduce"]
                finals = {stage: next(held["taskId"] for held in state["jobs"]
                    if held["evidenceId"] == evidence_id and held["stage"] == stage)
                    for stage in final_stages}
                strategy_search_publisher.remote({
                    "operation": "goldfish-evidence-finalize" if goldfish_only else "evidence-finalize",
                    "evidenceId": evidence_id, "taskIds": finals, "nowMs": int(time.time() * 1000)})
            if expanded:
                _strategy_search_materialize_adaptive(state, bundle)
                state = strategy_search_publisher.remote({"operation": "execution-save",
                    "campaignExecutionId": bundle["campaignExecutionId"], "fence": state["controllerFence"],
                    "ownerId": owner_id, "nowMs": int(time.time() * 1000), "leaseMs": 120000,
                    "state": state})
                last_saved_ms = int(time.time() * 1000)
        orphan_reserved_cpus = sum(job.get("cpu", 0) for job in state["jobs"]
            if job.get("lastError") == "controller-refenced-task"
            and job.get("leaseUntilMs", 0) > int(time.time() * 1000))
        allocated = orphan_reserved_cpus + sum(config["cpu"] for _, config in active.values())
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
        reducer_memory = sum(config.get("memoryMiB", 0) for _task_id, (_call, config) in active.items()
            if config["stage"].endswith("reduce"))
        reducer_admission_blocked = False
        for job in ready_jobs:
            task = next(held for held in state["tasks"] if held["taskId"] == job["taskId"])
            if job["stage"].endswith("reduce") and reducer_memory + task["memoryMiB"] \
                    > bundle["controller"].get("maxReducerMemoryMiB", 8192):
                reducer_admission_blocked = True
                continue
            if planned_allocated + task["cpu"] <= min(state["maxActiveCpus"], admission_limit_cpus):
                selected.append((job, task))
                planned_allocated += task["cpu"]
                if job["stage"].endswith("reduce"):
                    reducer_memory += task["memoryMiB"]
        if selected:
            preparation_items = []
            for job, task in selected:
                launch_id = uuid.uuid4().hex + uuid.uuid4().hex
                temporary = f"executions/{bundle['campaignExecutionId']}/temporary/{launch_id}/{job['taskId']}"
                temporary += ".hgs" if job["stage"] in {"goldfish-one", "goldfish-two"} \
                    else ".hgf" if job["stage"] in {"goldfish-one-reduce", "goldfish-two-reduce"} else ".json"
                item = {"taskId": job["taskId"], "evidenceId": job["evidenceId"],
                    "launchId": launch_id, "temporaryPath": temporary, "artifactPath": task["artifactPath"],
                    "stage": job["stage"], "kingdomId": job["kingdomId"]}
                if job["stage"] == "psro-score":
                    metadata = task.get("metadata", {})
                    item.update({"transitionPath": metadata.get("transitionPath"),
                        "scoreTask": metadata.get("scoreTask")})
                preparation_items.append(item)
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
                    if _strategy_search_expand_transition(state, job):
                        _strategy_search_materialize_adaptive(state, bundle)
                    continue
                if preparation.get("busy"):
                    job.update({"status": "retry-backoff", "retryNotBeforeMs": min(
                        preparation["leaseUntilMs"], int(time.time() * 1000) + 5000)})
                    continue
                config = _strategy_search_task_config(bundle, state, job, owner_id, preparation)
                function = strategy_search_goldfish_job if job["stage"] in {
                    "goldfish-one", "goldfish-two", "goldfish-one-reduce", "goldfish-two-reduce"} \
                    else strategy_search_downstream_job
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
            fatal_launch: tuple[str, dict[str, str]] | None = None
            for (job, task, config, _function), (call, error) in zip(pending_launches, launch_results, strict=True):
                submitted_ms = config["enqueuedEpochMs"]
                attempt = {"attempt": len(job.setdefault("attempts", [])) + 1, "submittedMs": submitted_ms,
                    "cpu": task["cpu"], "memoryMiB": task["memoryMiB"], "stage": job["stage"]}
                job["attempts"].append(attempt)
                if error is not None:
                    failed_ms = int(time.time() * 1000)
                    diagnostic = _strategy_search_exception_diagnostic(error)
                    admission_error = _strategy_search_is_admission_error(error)
                    if admission_error:
                        admission_failures += 1
                        interval_admission_rejected = True
                        admission_limit_cpus = max(4, allocated + task["cpu"])
                    attempt.update({"finishedMs": failed_ms,
                        "status": "admission-failed" if admission_error else "launch-failed", **diagnostic})
                    job["attemptCount"] = job.get("attemptCount", 0) + 1
                    job["status"] = "ready" if admission_error else "retry-backoff"
                    if not admission_error:
                        job["retryNotBeforeMs"] = failed_ms \
                            + min(30000, 1000 * 2 ** min(job["attemptCount"], 5))
                    job["lastError"] = diagnostic["error"]
                    job["lastErrorType"] = diagnostic["errorType"]
                    if not admission_error and (_strategy_search_is_terminal_worker_error(error)
                            or _strategy_search_retryable_failure_count(job) >= STRATEGY_SEARCH_MAX_JOB_ATTEMPTS):
                        job["status"] = "failed"
                        fatal_launch = (job["taskId"], _strategy_search_contextual_diagnostic(
                            f"non-retryable launch failure for {job['taskId']}", diagnostic))
                    continue
                job["status"] = "active"
                job["startedMs"] = submitted_ms
                job.setdefault("firstStartedMs", job["startedMs"])
                job["cpu"] = task["cpu"]
                job["memoryMiB"] = task["memoryMiB"]
                job["callId"] = call.object_id
                attempt.update({"status": "submitted", "callId": call.object_id,
                    "functionCallUrl": f"https://modal.com/id/{call.object_id}"})
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
        elif reducer_admission_blocked:
            interval_reason = "reducer-admission-limit"
        elif any(job["status"] == "ready" and job["stage"] in {"matrix-manifest", "matrix-score",
                "matrix-reduce", "psro-decision", "psro-score", "admission-row-score",
                "admission-row-reduce", "psro-reduce"} for job in state["jobs"]):
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
            if goldfish_only and _strategy_search_materialize_goldfish(state, bundle):
                state = strategy_search_publisher.remote({"operation": "execution-save",
                    "campaignExecutionId": bundle["campaignExecutionId"], "fence": state["controllerFence"],
                    "ownerId": owner_id, "nowMs": int(time.time() * 1000), "leaseMs": 120000,
                    "state": state})
                continue
            if not goldfish_only and _strategy_search_materialize_adaptive(state, bundle):
                state = strategy_search_publisher.remote({"operation": "execution-save",
                    "campaignExecutionId": bundle["campaignExecutionId"], "fence": state["controllerFence"],
                    "ownerId": owner_id, "nowMs": int(time.time() * 1000), "leaseMs": 120000,
                    "state": state})
                continue
            final_stage = "goldfish-two-reduce" if goldfish_only else "psro-reduce"
            final_evidence = {job["evidenceId"] for job in state["jobs"] if job["stage"] == final_stage}
            final_evidence.update(state.get("reusedEvidenceIds", []))
            expected_evidence = {job["evidenceId"] for job in state["jobs"]}
            if final_evidence != expected_evidence:
                expected_name = "reservoir" if goldfish_only else "final PSRO evidence"
                raise RuntimeError(f"strategy-search reached an empty queue before {expected_name}")
            if goldfish_only:
                for evidence_id in final_evidence - set(state.get("reusedEvidenceIds", [])):
                    finals = {stage: next(job["taskId"] for job in state["jobs"]
                        if job["evidenceId"] == evidence_id and job["stage"] == stage)
                        for stage in ["goldfish-one-reduce", "goldfish-two-reduce"]}
                    strategy_search_publisher.remote({"operation": "goldfish-evidence-finalize",
                        "evidenceId": evidence_id, "taskIds": finals,
                        "nowMs": int(time.time() * 1000)})
            break
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
    cost_rates = (GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND * 3600,
        GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND * 3600) if goldfish_only else \
        (CPU_RATE_PER_CORE_HOUR, MEMORY_RATE_PER_GIB_HOUR)
    for attempt in attempts:
        if attempt.get("status") == "admission-failed":
            attempt.update({"costUsd": 0.0, "costBasis": "not-admitted"})
            continue
        cost = _strategy_search_attempt_cost(attempt, finished_ms, *cost_rates)
        attempt.update({"costUsd": cost["costUsd"], "costBasis": cost["basis"]})
        attempt_costs.append(cost)
    measured_attempt_cost = sum(entry["costUsd"] for entry in attempt_costs
        if entry["basis"] == "worker-measured")
    unmeasured_failure_cost = sum(entry["costUsd"] for entry in attempt_costs
        if entry["basis"] == "submitted-upper-bound")
    controller_cost = critical_elapsed_ms / 3_600_000 \
        * (cost_rates[0] + 2 * cost_rates[1])
    publisher_cost = publisher_commit_ms / 3_600_000 \
        * (cost_rates[0] + 8 * cost_rates[1])
    compute_cost = measured_attempt_cost + unmeasured_failure_cost + controller_cost + publisher_cost
    stage_wall = {}
    report_stages = ["goldfish-one", "goldfish-one-reduce", "goldfish-two", "goldfish-two-reduce"] \
        if goldfish_only else ["goldfish-one", "goldfish-one-reduce", "goldfish-two", "goldfish-two-reduce",
            "matrix-manifest", "matrix-score", "matrix-reduce", "psro-decision", "psro-score",
            "admission-row-score", "admission-row-reduce", "psro-reduce"]
    for stage in report_stages:
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
    volume.reload()
    artifact_paths = sorted({job["receipt"]["artifactPath"] for job in state["jobs"] if job.get("receipt")})
    artifacts = [_strategy_search_path(relative) for relative in artifact_paths]
    bytes_written = sum(held.stat().st_size for held in artifacts)
    bytes_read = sum(_strategy_search_path(dependency["receipt"]["artifactPath"]).stat().st_size
        for job in state["jobs"] if not job.get("reused")
        and job["stage"] in {"goldfish-one-reduce", "goldfish-two", "goldfish-two-reduce",
            "matrix-manifest", "matrix-score", "matrix-reduce", "psro-decision", "psro-score",
            "admission-row-score", "admission-row-reduce", "psro-reduce"}
        for dependency in [next(held for held in state["jobs"] if held["taskId"] == task_id)
                           for task_id in job["dependencyTaskIds"]] if dependency.get("receipt"))
    bytes_read += sum(_strategy_search_path(f"evidence/{job['evidenceId']}/goldfish/reservoir.hgf").stat().st_size
        for job in state["jobs"] if not job.get("reused") and job["stage"] == "psro-decision"
        and job.get("expanded") is not True)
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
    phase_accounting_valid = True
    for phase_report in phase_reports:
        phase_sum = sum(phase_report.get(key, -1) for key in phase_keys)
        if phase_report.get("elapsedMs", 0) < 0 or any(phase_report.get(key, -1) < 0 for key in phase_keys) \
                or phase_report["elapsedMs"] and abs(phase_sum - phase_report["elapsedMs"]) \
                    / phase_report["elapsedMs"] > 0.01:
            phase_accounting_valid = False
    intermediate_io_ratio = io_ms / scientific_ms if scientific_ms else 0
    jobs_by_id = {job["taskId"]: job for job in state["jobs"]}
    barrier_latencies = []
    for job in state["jobs"]:
        dependencies = [jobs_by_id[task_id] for task_id in job["dependencyTaskIds"]
            if task_id in jobs_by_id and jobs_by_id[task_id].get("finishedMs")]
        if job.get("firstStartedMs") and dependencies:
            released_ms = max(dependency["finishedMs"] for dependency in dependencies)
            barrier_latencies.append({"evidenceId": job["evidenceId"], "stage": job["stage"],
                "releasedMs": released_ms, "startedMs": job["firstStartedMs"],
                "latencyMs": max(0, job["firstStartedMs"] - released_ms)})
    evidence_ids = list(dict.fromkeys(task["evidenceId"] for task in bundle["tasks"]))
    per_kingdom_completion = {}
    for evidence_id in evidence_ids:
        held = [job for job in state["jobs"] if job["evidenceId"] == evidence_id]
        starts = [job["firstStartedMs"] for job in held if job.get("firstStartedMs")]
        final_stage = "goldfish-two-reduce" if goldfish_only else "psro-reduce"
        final = next((job for job in held if job["stage"] == final_stage), None)
        per_kingdom_completion[evidence_id] = {
            "kingdomId": held[0]["kingdomId"] if held else None,
            "wallMs": max(0, final.get("finishedMs", finished_ms) - min(starts)) if final and starts else 0,
            "completedMs": final.get("finishedMs") if final else None}
    score_attempts = []
    for job in state["jobs"]:
        if job["stage"] not in {"matrix-score", "psro-score"}:
            continue
        for attempt in job.get("attempts", []):
            if isinstance(attempt.get("workerStartedMs"), int) and isinstance(attempt.get("workerFinishedMs"), int):
                score_attempts.append({"stage": job["stage"], "kingdomId": job["kingdomId"],
                    "startMs": attempt["workerStartedMs"], "endMs": attempt["workerFinishedMs"],
                    "cpus": attempt["cpu"]})
    cross_kingdom_score_overlap = any(left["stage"] == right["stage"]
        and left["kingdomId"] != right["kingdomId"]
        and left["startMs"] < right["endMs"] and right["startMs"] < left["endMs"]
        for index, left in enumerate(score_attempts) for right in score_attempts[index + 1:])
    psro_candidate_blocks = sum((job["range"]["end"] - job["range"]["start"])
        * next(task for task in state["tasks"] if task["taskId"] == job["taskId"])
            .get("metadata", {}).get("scoreBlocks", 0)
        for job in state["jobs"] if job["stage"] == "psro-score")
    stage_throughput = {
        "goldfishCandidatesPerSecond": scored_candidates / (scoring_ms / 1000) if scoring_ms else 0,
        "matrixGamesPerSecond": 318750 * len(evidence_ids) / (stage_wall.get("matrix-score", 0) / 1000)
            if stage_wall.get("matrix-score", 0) else 0,
        "psroCandidateBlocksPerSecond": psro_candidate_blocks / (stage_wall.get("psro-score", 0) / 1000)
            if stage_wall.get("psro-score", 0) else 0}
    retry_cost = sum(attempt.get("costUsd", 0) for attempt in attempts
        if attempt.get("status") not in {"complete", "submitted"})
    report = {"schemaVersion": 3, "campaignExecutionId": bundle["campaignExecutionId"],
        "route": GOLDFISH_MODAL_ROUTE if goldfish_only else "full-strategy-search",
        "status": "complete", "criticalPathWallMs": critical_elapsed_ms,
        "scientificStageWallMs": stage_wall if goldfish_only else None,
        "authorizedCostGuard": bundle["controller"].get("costGuard") if goldfish_only else None,
        "stageWallMs": stage_wall, "stageThroughput": stage_throughput,
        "perKingdomCompletion": per_kingdom_completion, "stageBarrierLatency": barrier_latencies,
        "crossKingdomScoreOverlap": cross_kingdom_score_overlap,
        "maxActiveCpus": state["maxActiveCpus"], "workerCpuLimit": state["maxActiveCpus"],
        "controllerCores": 1, "publisherCores": 1,
        "peakActiveCpus": max((entry["allocatedCpus"] for entry in running_intervals), default=0),
        "averageActiveCpus": allocated_cpu_ms / wall_ms if wall_ms else 0,
        "cpuUtilization": allocated_cpu_ms / (wall_ms * state["maxActiveCpus"]) if wall_ms else 0,
        "peakSubmittedCpus": max((entry["allocatedCpus"] for entry in intervals), default=0),
        "averageSubmittedCpus": submitted_cpu_ms / submitted_wall_ms if submitted_wall_ms else 0,
        "unusedCpuSecondsByReason": unused_by_reason,
        "candidateThroughputPerSecond": scored_candidates / (scoring_ms / 1000) if scoring_ms else 0,
        "bytesRead": bytes_read, "bytesWritten": bytes_written,
        "goldfishPhaseAccountingValid": phase_accounting_valid,
        "intermediateIoRatio": intermediate_io_ratio,
        "goldfishIntermediateIoTargetMet": intermediate_io_ratio < 0.05,
        "finalWriteMs": sum(held.get("finalTop500000WriteMs", 0) + held.get("finalTop20000WriteMs", 0)
                            for held in phase_reports),
        "admissionFailures": admission_failures, "retryCostUsd": retry_cost,
        "matrixScoreWorkerCount": sum(job["stage"] == "matrix-score" for job in state["jobs"]),
        "psroScoreWorkerCount": sum(job["stage"] == "psro-score" for job in state["jobs"]),
        "scoreLookUtilization": _strategy_search_score_look_utilization(state, finished_ms),
        "taskCount": len(state["jobs"]), "retries": sum(job.get("attemptCount", 0) for job in state["jobs"]),
        "actualModalCostUsd": compute_cost,
        "modalCostAccounting": {"measuredAttemptUsd": measured_attempt_cost,
            "unmeasuredFailureUpperBoundUsd": unmeasured_failure_cost,
            "controllerUsd": controller_cost, "publisherUsd": publisher_cost,
            "cpuUsdPerCoreSecond": cost_rates[0] / 3600,
            "memoryUsdPerGibSecond": cost_rates[1] / 3600,
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


@app.function(image=image, cpu=1, memory=2048, timeout=86400, retries=0, volumes={"/results": volume})
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
    except builtins.TimeoutError as error:
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
