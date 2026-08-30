"""Restart-safe Modal launcher for Goldfish and PSRO jobs."""

from __future__ import annotations

import builtins
import concurrent.futures
import hashlib
import json
import math
import os
import pathlib
import queue
import re
import resource
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
from typing import Any

import modal

CAMPAIGN_CHECKPOINT_EVENT = "strategy-search-checkpoint"
CAMPAIGN_STAGE_STOP_EVENT = "strategy-search-stage-stop"
CAMPAIGN_STAGES = {"goldfish", "matrix", "psro"}
STRATEGY_SEARCH_MAX_JOB_ATTEMPTS = 3
GOLDFISH_MODAL_ROUTE = "goldfish-only-v2"
GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND = 0.0000131
GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND = 0.00000222
GOLDFISH_MODAL_HARD_COST_CAP_USD = 100.0
GOLDFISH_MODAL_MIN_WORKER_CORES = 16
GOLDFISH_MODAL_MAX_WORKER_CORES = 64
GOLDFISH_MODAL_MIN_WALL_SECONDS = 300
GOLDFISH_MODAL_MAX_WALL_SECONDS = 21600
GOLDFISH_MODAL_KINGDOM_MEMORY_MIB = 8192
GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS = 300
GOLDFISH_MODAL_SCRATCH_ROOT = pathlib.Path("/tmp/hexdeck-goldfish")
GOLDFISH_MODAL_MIN_SCRATCH_FREE_BYTES = 2 * 1024 * 1024 * 1024
GOLDFISH_MODAL_ATTEMPTS = 3
PSRO_MODAL_CPU_RATE_PER_CORE_SECOND = 0.0000131
PSRO_MODAL_MEMORY_RATE_PER_GIB_SECOND = 0.00000222
PSRO_MODAL_COMMIT_INTERVAL_SECONDS = 600
CAMPAIGN_RUST_GOLDFISH_BIN = os.environ.get(
    "HEXDECK_GOLDFISH_BIN", "/workspace/rust/target/release/hexdeck-goldfish")

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
    .apt_install("ca-certificates", "build-essential", "time")
_RUST_IMAGE_FILES = {relative for relative in _SOURCE_IMAGE_FILES
    if relative.startswith("rust/") and relative != "rust/rust-toolchain.toml"}
_APPLICATION_IMAGE_FILES = set(_SOURCE_IMAGE_FILES) - _RUST_IMAGE_FILES
if _RUST_IMAGE_FILES | _APPLICATION_IMAGE_FILES != set(_SOURCE_IMAGE_FILES):
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
        ignore=_ignore_image_paths_except(_RUST_IMAGE_FILES))
    image = image.run_commands("cd /workspace/rust && cargo build --release")
    image = image.add_local_dir(PROJECT_ROOT, remote_path="/workspace", copy=True,
        ignore=_ignore_image_paths_except(_APPLICATION_IMAGE_FILES))


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


def _strategy_search_validate_publication(publication: dict[str, Any], temporary: pathlib.Path) -> None:
    stage = publication["stage"]
    goldfish_kinds = {"goldfish-one": "stage-one", "goldfish-two": "stage-two",
        "goldfish-one-reduce": "top", "goldfish-two-reduce": "reservoir"}
    if stage not in goldfish_kinds:
        raise RuntimeError(f"strategy-search stage is not supported: {stage}")
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
    result = _run_checked([CAMPAIGN_RUST_GOLDFISH_BIN, "kingdom", "--kingdom", "balance-tuning-001"],
        "strategy-search Goldfish worker readiness", cwd=RUNTIME_WORKSPACE_ROOT,
        text=True, capture_output=True, timeout=60)
    try:
        value = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError) as error:
        raise RuntimeError("strategy-search Goldfish readiness returned invalid JSON") from error
    if value.get("kingdomId") != "balance-tuning-001" or value.get("candidateCount") != 12_972_960:
        raise RuntimeError("strategy-search Goldfish readiness returned the wrong kingdom")


def _strategy_search_remote_goldfish_canary(source_identity: dict[str, Any]) -> None:
    relative = f"preflight/{source_identity['digest']}/goldfish-canary.hgs"
    config = {"taskId": "deployment-goldfish-canary", "evidenceId": source_identity["scientificDigest"],
        "kingdomId": "balance-tuning-001", "temporaryPath": relative,
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


def _strategy_search_psro_readiness_impl(source_identity: dict[str, Any]) -> dict[str, Any]:
    verify_strategy_search_source(source_identity)
    import psro_step

    if not callable(getattr(psro_step, "run_psro_step", None)):
        raise RuntimeError("PSRO wrapper is unavailable in the Modal image")
    binary = pathlib.Path(CAMPAIGN_RUST_GOLDFISH_BIN)
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise RuntimeError(f"PSRO Rust binary is missing or not executable: {binary}")
    result = subprocess.run([str(binary), "psro"], text=True, capture_output=True,
        check=False, timeout=30)
    if result.returncode == 0 or not any(marker in result.stderr for marker in ["--threads", "psro"]):
        raise RuntimeError("PSRO Rust binary did not return the expected usage error")
    return {"ready": True, "sourceDigest": source_identity["digest"]}


@app.function(image=image, cpu=1, memory=2048, timeout=120, max_containers=1, retries=0)
def strategy_search_psro_ready(source_identity: dict[str, Any]) -> dict[str, Any]:
    return _strategy_search_psro_readiness_impl(source_identity)


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
        if request.get("route") != GOLDFISH_MODAL_ROUTE \
                or saved.get("route") != GOLDFISH_MODAL_ROUTE \
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
    if operation == "goldfish-evidence-finalize":
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
        state["goldfishCompletion"] = {"completedMs": request.get("nowMs", int(time.time() * 1000)),
            "receipts": receipts}
        _atomic_json(state_file, state)
        volume.commit()
        return state["goldfishCompletion"]
    if operation == "execution-fail":
        state_file = _strategy_search_execution_file(request["campaignExecutionId"])
        state = _strategy_search_load(state_file)
        if state is None:
            raise RuntimeError("strategy-search execution is missing during failure persistence")
        failed_ms = request.get("nowMs", int(time.time() * 1000))
        attempts = [attempt for job in state.get("jobs", []) for attempt in job.get("attempts", [])]
        cost_rates = (GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND * 3600,
            GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND * 3600)
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


def _strategy_search_goldfish_single_command(config: dict[str, Any]) -> dict[str, Any]:
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


def _strategy_search_goldfish_kingdom_stage(config: dict[str, Any]) -> dict[str, Any]:
    volume.reload()
    worker_started_epoch_ms = int(time.time() * 1000)
    worker_started = time.monotonic()
    scratch = GOLDFISH_MODAL_SCRATCH_ROOT / config["launchId"]
    scratch_created = False
    try:
        scratch.mkdir(parents=True)
        scratch_created = True
        scratch_free_bytes = shutil.disk_usage(scratch).free
        if scratch_free_bytes < GOLDFISH_MODAL_MIN_SCRATCH_FREE_BYTES:
            raise RuntimeError("Goldfish kingdom task needs at least 2 GiB of free scratch space")
        kingdom_one = config["mode"] == "kingdom-one"
        score_mode = "score-one" if kingdom_one else "score-two"
        reduce_mode = "reduce-one" if kingdom_one else "reduce-two"
        score_end = 12_972_960 if kingdom_one else 500_000
        final_name = "top-500000.hgf" if kingdom_one else "reservoir.hgf"
        stage_file = scratch / "stage.hgs"
        score_report_file = scratch / "score.json"
        reduce_report_file = scratch / "reduce.json"
        final_file = scratch / final_name
        inputs_file = scratch / "inputs.json"
        _atomic_json(inputs_file, [stage_file.as_posix()])
        top_arguments = [] if kingdom_one else ["--top", str(_strategy_search_path(config["topPath"]))]

        def remaining_config() -> dict[str, Any]:
            elapsed_seconds = time.monotonic() - worker_started
            return {**config, "timeoutSeconds": max(1, config["timeoutSeconds"] - elapsed_seconds)}

        score_command = [CAMPAIGN_RUST_GOLDFISH_BIN, score_mode, "--kingdom", config["kingdomId"],
            "--start", "0", "--end", str(score_end), "--threads", str(config["cpu"]),
            "--out", str(stage_file), "--report", str(score_report_file), *top_arguments]
        _strategy_search_run_subprocess(score_command, remaining_config())
        score_report = _strategy_search_load(score_report_file)
        reduce_command = [CAMPAIGN_RUST_GOLDFISH_BIN, reduce_mode, "--kingdom", config["kingdomId"],
            "--inputs", str(inputs_file), "--out", str(final_file), "--report", str(reduce_report_file),
            *top_arguments]
        _strategy_search_run_subprocess(reduce_command, remaining_config())
        reduce_report = _strategy_search_load(reduce_report_file)
        rust_named_ms = score_report["scoringMs"] + score_report["readMs"] \
            + score_report["writeMs"] + reduce_report["readMs"] \
            + reduce_report["reduceMs"] + reduce_report["writeMs"]
        wall_so_far_ms = (time.monotonic() - worker_started) * 1000
        if rust_named_ms > wall_so_far_ms:
            raise RuntimeError("Goldfish kingdom Rust phases exceed elapsed wall time")

        output = _strategy_search_path(config["temporaryPath"])
        output.parent.mkdir(parents=True, exist_ok=True)
        copy_started = time.monotonic()
        shutil.copyfile(final_file, output)
        copy_ms = (time.monotonic() - copy_started) * 1000
        validated_sha256 = _strategy_search_sha256(output)
        _strategy_search_validate_publication(config, output)
        commit_started = time.monotonic()
        volume.commit()
        commit_ms = (time.monotonic() - commit_started) * 1000
        modal_worker_elapsed_ms = (time.monotonic() - worker_started) * 1000
        queue_ms = max(0, worker_started_epoch_ms - config["enqueuedEpochMs"])
        elapsed_ms = modal_worker_elapsed_ms + queue_ms
        phases = {key: 0 for key in ["generationMs", "scoringMs",
            "intermediateSerializationAndReadMs", "temporaryVolumeWriteCommitMs", "publisherWaitMs",
            "publicationCommitMs", "reductionComputeMs", "finalTop500000WriteMs",
            "finalTop20000WriteMs", "orchestrationQueueMs"]}
        phases["scoringMs"] = score_report["scoringMs"]
        phases["intermediateSerializationAndReadMs"] = score_report["readMs"] \
            + score_report["writeMs"] + reduce_report["readMs"]
        phases["reductionComputeMs"] = reduce_report["reduceMs"]
        phases["finalTop500000WriteMs" if kingdom_one else "finalTop20000WriteMs"] = \
            reduce_report["writeMs"]
        phases["temporaryVolumeWriteCommitMs"] = copy_ms + commit_ms
        orchestration_ms = elapsed_ms - sum(phases.values())
        phases["orchestrationQueueMs"] = orchestration_ms
        phases["elapsedMs"] = elapsed_ms
        return {"elapsedMs": elapsed_ms, "workerFinishedEpochMs": int(time.time() * 1000),
            "checkpointCount": 0, "modalWorkerElapsedMs": modal_worker_elapsed_ms,
            "sha256": validated_sha256, "validatedSha256": validated_sha256, "phases": phases,
            "workerStartedEpochMs": worker_started_epoch_ms, "temporaryPath": config["temporaryPath"],
            "rustReports": {"score": score_report, "reduce": reduce_report},
            "scratchFreeBytes": scratch_free_bytes}
    finally:
        if scratch_created:
            shutil.rmtree(scratch, ignore_errors=True)


@app.function(image=image, cpu=4, memory=4096, timeout=900, retries=0, volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def strategy_search_goldfish_job(config: dict[str, Any]) -> dict[str, Any]:
    if config.get("mode") in {"kingdom-one", "kingdom-two"}:
        return _strategy_search_goldfish_kingdom_stage(config)
    return _strategy_search_goldfish_single_command(config)


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
        evidence_id=config["evidenceId"],
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


def _strategy_search_attempt_cost(attempt: dict[str, Any], until_ms: int,
                                  cpu_rate_per_core_hour: float = GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND * 3600,
                                  memory_rate_per_gib_hour: float = GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND * 3600) -> dict[str, Any]:
    elapsed_ms = attempt.get("modalWorkerElapsedMs")
    measured = isinstance(elapsed_ms, (int, float)) and elapsed_ms >= 0
    if not measured:
        elapsed_ms = max(0, attempt.get("finishedMs", until_ms) - attempt["submittedMs"])
    cost = elapsed_ms / 3_600_000 * (attempt["cpu"] * cpu_rate_per_core_hour
        + attempt["memoryMiB"] / 1024 * memory_rate_per_gib_hour)
    return {"elapsedMs": elapsed_ms, "costUsd": cost,
        "basis": "worker-measured" if measured else "submitted-upper-bound"}


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
    priority = {"goldfish-one-reduce": 0, "goldfish-two-reduce": 1}
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
        "ownerId": owner_id, "taskFence": prepared["fence"],
        "leaseMs": prepared.get("leaseMs", (task["timeoutSeconds"] + 600) * 1000),
        **controller_fields, "launchId": launch_id, "temporaryPath": temporary,
        "sourceImage": bundle["sourceImage"], "cpu": task["cpu"], "memoryMiB": task["memoryMiB"],
        "timeoutSeconds": task["timeoutSeconds"], "stage": job["stage"]}
    if bundle["controller"].get("route") != GOLDFISH_MODAL_ROUTE \
            or job["stage"] not in {"goldfish-one-reduce", "goldfish-two-reduce"}:
        raise RuntimeError("Goldfish-only controller received an unsupported task")
    config["mode"] = "kingdom-one" if job["stage"] == "goldfish-one-reduce" else "kingdom-two"
    if job["stage"] == "goldfish-two-reduce":
        config["topPath"] = f"evidence/{job['evidenceId']}/goldfish/top-500000.hgf"
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


def _strategy_search_goldfish_kingdom_one_timeout(worker_cores: int) -> int:
    return 300 + (13000 + worker_cores - 1) // worker_cores


def _strategy_search_goldfish_worst_case_cost(request: dict[str, Any],
                                               task_counts: dict[str, int]) -> float:
    timeout_one = _strategy_search_goldfish_kingdom_one_timeout(request["workerCores"])
    scientific = task_counts["kingdomOne"] * GOLDFISH_MODAL_ATTEMPTS * (
        _strategy_search_goldfish_modal_compute_cost(request["workerCores"],
            GOLDFISH_MODAL_KINGDOM_MEMORY_MIB, timeout_one + 30)
        + _strategy_search_goldfish_modal_compute_cost(request["workerCores"],
            GOLDFISH_MODAL_KINGDOM_MEMORY_MIB, GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS + 30))
    controller = _strategy_search_goldfish_modal_compute_cost(
        1, 2048, request["maxWallSeconds"] + 60)
    publisher = _strategy_search_goldfish_modal_compute_cost(
        1, 8192, request["maxWallSeconds"])
    readiness = _strategy_search_goldfish_modal_compute_cost(1, 2048, 180)
    canary = _strategy_search_goldfish_modal_compute_cost(1, 4096, 120)
    control = _strategy_search_goldfish_modal_compute_cost(
        0.25, 512, request["maxWallSeconds"] + 90)
    return round(scientific + controller + publisher + readiness + canary + control, 6)


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
            or not GOLDFISH_MODAL_MIN_WORKER_CORES <= worker_cores <= GOLDFISH_MODAL_MAX_WORKER_CORES \
            or max_active_cpus < worker_cores \
            or not GOLDFISH_MODAL_MIN_WALL_SECONDS <= max_wall_seconds <= GOLDFISH_MODAL_MAX_WALL_SECONDS \
            or not isinstance(max_cost_usd, (int, float)) or isinstance(max_cost_usd, bool) \
            or not 0 < max_cost_usd <= GOLDFISH_MODAL_HARD_COST_CAP_USD:
        raise ValueError("Goldfish-only request exceeds a hard resource, time, or cost limit")
    timeout_one = _strategy_search_goldfish_kingdom_one_timeout(worker_cores)
    expected_controller_fields = {"route", "maxActiveCpus", "timeoutSeconds", "maxWallSeconds",
        "pollIntervalSeconds", "volumeName", "readyWindowWaves", "maxReducerMemoryMiB",
        "goldfishWorkerCores", "goldfishKingdomMemoryMiB", "goldfishKingdomOneTimeoutSeconds",
        "goldfishKingdomTwoTimeoutSeconds", "executionPlanHash", "costGuard"}
    if set(controller) != expected_controller_fields \
            or controller.get("maxActiveCpus") != max_active_cpus \
            or controller.get("maxWallSeconds") != max_wall_seconds \
            or controller.get("timeoutSeconds") != max_wall_seconds \
            or controller.get("pollIntervalSeconds") != 1 \
            or controller.get("volumeName") != "hexdeck-native-strategy-results" \
            or controller.get("readyWindowWaves") != 2 \
            or controller.get("maxReducerMemoryMiB") != (max_active_cpus // worker_cores) \
                * GOLDFISH_MODAL_KINGDOM_MEMORY_MIB \
            or controller.get("goldfishWorkerCores") != worker_cores \
            or controller.get("goldfishKingdomMemoryMiB") != GOLDFISH_MODAL_KINGDOM_MEMORY_MIB \
            or controller.get("goldfishKingdomOneTimeoutSeconds") != timeout_one \
            or controller.get("goldfishKingdomTwoTimeoutSeconds") \
                != GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS \
            or not re.fullmatch(r"[0-9a-f]{64}", controller.get("executionPlanHash", "")):
        raise ValueError("Goldfish-only controller resources differ from the authorized shape")
    if bundle.get("partitions") != {}:
        raise ValueError("Goldfish-only partitions must be empty")
    jobs, tasks = bundle.get("jobs"), bundle.get("tasks")
    if not isinstance(jobs, list) or not isinstance(tasks, list) \
            or len(jobs) != len(kingdom_ids) * 2 or len(tasks) != len(kingdom_ids) * 2:
        raise ValueError("Goldfish-only bundle must contain two jobs and tasks per kingdom")
    ordered_evidence_ids = []
    for index, kingdom_id in enumerate(kingdom_ids):
        one_job, two_job = jobs[index * 2:index * 2 + 2]
        one_task, two_task = tasks[index * 2:index * 2 + 2]
        evidence_id = one_job.get("evidenceId") if isinstance(one_job, dict) else None
        one_id = _strategy_search_goldfish_task_id(evidence_id or "", "goldfish-one-reduce", None)
        two_id = _strategy_search_goldfish_task_id(evidence_id or "", "goldfish-two-reduce", None)
        expected_jobs = [
            {"job": one_job, "taskId": one_id, "stage": "goldfish-one-reduce",
                "status": "ready", "dependencies": []},
            {"job": two_job, "taskId": two_id, "stage": "goldfish-two-reduce",
                "status": "blocked", "dependencies": [one_id]}]
        if not re.fullmatch(r"[0-9a-f]{64}", evidence_id or "")                 or any(not isinstance(entry["job"], dict)
                    or entry["job"].get("taskId") != entry["taskId"]
                    or entry["job"].get("kingdomId") != kingdom_id
                    or entry["job"].get("evidenceId") != evidence_id
                    or entry["job"].get("stage") != entry["stage"]
                    or entry["job"].get("range") is not None
                    or entry["job"].get("cpus") != worker_cores
                    or entry["job"].get("status") != entry["status"]
                    or entry["job"].get("dependencyTaskIds") != entry["dependencies"]
                    for entry in expected_jobs):
            raise ValueError("Goldfish-only jobs differ from the kingdom task chain")
        expected_tasks = [
            {"task": one_task, "taskId": one_id, "stage": "goldfish-one-reduce",
                "timeout": timeout_one, "dependencies": [],
                "artifact": f"evidence/{evidence_id}/goldfish/top-500000.hgf"},
            {"task": two_task, "taskId": two_id, "stage": "goldfish-two-reduce",
                "timeout": GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS, "dependencies": [one_id],
                "artifact": f"evidence/{evidence_id}/goldfish/reservoir.hgf"}]
        if any(not isinstance(entry["task"], dict)
                or entry["task"].get("taskId") != entry["taskId"]
                or entry["task"].get("kingdomId") != kingdom_id
                or entry["task"].get("evidenceId") != evidence_id
                or entry["task"].get("stage") != entry["stage"]
                or entry["task"].get("range") is not None
                or entry["task"].get("cpu") != worker_cores
                or entry["task"].get("memoryMiB") != GOLDFISH_MODAL_KINGDOM_MEMORY_MIB
                or entry["task"].get("timeoutSeconds") != entry["timeout"]
                or entry["task"].get("dependencyTaskIds") != entry["dependencies"]
                or entry["task"].get("artifactPath") != entry["artifact"]
                for entry in expected_tasks):
            raise ValueError("Goldfish-only tasks differ from the authorized kingdom shape")
        ordered_evidence_ids.append(evidence_id)
    if len(set(ordered_evidence_ids)) != len(kingdom_ids):
        raise ValueError("Goldfish-only kingdom-to-evidence mapping is not one-to-one")
    counts = {"kingdomOne": len(kingdom_ids), "kingdomTwo": len(kingdom_ids),
        "total": len(kingdom_ids) * 2}
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
    return {"taskCounts": counts, "worstCaseModalComputeUsd": worst_case,
        "orderedEvidenceIds": ordered_evidence_ids}


def _strategy_search_controller_impl(bundle: dict[str, Any]) -> dict[str, Any]:
    goldfish_plan = _strategy_search_validate_goldfish_only_bundle(bundle)
    if goldfish_plan is None:
        raise ValueError("Only the Goldfish v2 route is supported")
    verify_strategy_search_source(bundle["sourceImage"])
    initialized = strategy_search_publisher.remote({"operation": "execution-init",
        "campaignExecutionId": bundle["campaignExecutionId"],
        "orderedEvidenceIds": list(dict.fromkeys(task["evidenceId"] for task in bundle["tasks"])),
        "partitions": bundle["partitions"], "jobs": bundle["jobs"], "tasks": bundle["tasks"],
        "maxActiveCpus": bundle["request"]["maxActiveCpus"],
        "sourceDigest": bundle["sourceImage"]["digest"],
        "route": GOLDFISH_MODAL_ROUTE,
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
            "operation": "goldfish-evidence-complete", "evidenceId": evidence_id})
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
        if now_ms - state["startedMs"] > bundle["controller"]["maxWallSeconds"] * 1000:
            timeout_error = TimeoutError("Goldfish-only scientific wall timeout expired")
            fail_active_wave(_strategy_search_exception_diagnostic(timeout_error), "goldfish-only-timeout")
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
            for task_id, _config, _result in finished:
                completed_job = next(held for held in state["jobs"] if held["taskId"] == task_id)
                if completed_job["stage"] != "goldfish-two-reduce":
                    continue
                evidence_id = completed_job["evidenceId"]
                final_stages = ["goldfish-one-reduce", "goldfish-two-reduce"]
                finals = {stage: next(held["taskId"] for held in state["jobs"]
                    if held["evidenceId"] == evidence_id and held["stage"] == stage)
                    for stage in final_stages}
                strategy_search_publisher.remote({
                    "operation": "goldfish-evidence-finalize",
                    "evidenceId": evidence_id, "taskIds": finals, "nowMs": int(time.time() * 1000)})
        orphan_reserved_cpus = sum(job.get("cpu", 0) for job in state["jobs"]
            if job.get("lastError") == "controller-refenced-task"
            and job.get("leaseUntilMs", 0) > int(time.time() * 1000))
        allocated = orphan_reserved_cpus + sum(config["cpu"] for _, config in active.values())
        ready_jobs = _strategy_search_ready_jobs(state)
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
                temporary += ".hgf"
                item = {"taskId": job["taskId"], "evidenceId": job["evidenceId"],
                    "launchId": launch_id, "temporaryPath": temporary, "artifactPath": task["artifactPath"],
                    "stage": job["stage"], "kingdomId": job["kingdomId"]}
                preparation_items.append(item)
            lease_ms = (max(task["timeoutSeconds"] for _job, task in selected) + 600) * 1000
            prepared = strategy_search_publisher.remote({"operation": "prepare-launch-batch",
                "campaignExecutionId": bundle["campaignExecutionId"], "controllerOwnerId": owner_id,
                "controllerFence": state["controllerFence"], "ownerId": owner_id,
                "nowMs": int(time.time() * 1000), "leaseMs": lease_ms, "items": preparation_items})
            for preparation in prepared.values():
                preparation["leaseMs"] = lease_ms
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
                function = strategy_search_goldfish_job
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
            final_evidence = {job["evidenceId"] for job in state["jobs"]
                if job["stage"] == "goldfish-two-reduce"}
            final_evidence.update(state.get("reusedEvidenceIds", []))
            expected_evidence = {job["evidenceId"] for job in state["jobs"]}
            if final_evidence != expected_evidence:
                raise RuntimeError("strategy-search reached an empty queue before the reservoir")
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
        GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND * 3600)
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
    report_stages = ["goldfish-one-reduce", "goldfish-two-reduce"]
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
        and job["stage"] == "goldfish-two-reduce"
        for dependency in [next(held for held in state["jobs"] if held["taskId"] == task_id)
                           for task_id in job["dependencyTaskIds"]] if dependency.get("receipt"))
    io_ms = sum(held.get("intermediateSerializationAndReadMs", 0)
        + held.get("temporaryVolumeWriteCommitMs", 0) + held.get("publicationCommitMs", 0)
        for held in phase_reports)
    scientific_ms = sum(held.get("generationMs", 0) + held.get("scoringMs", 0)
        + held.get("intermediateSerializationAndReadMs", 0) + held.get("temporaryVolumeWriteCommitMs", 0)
        + held.get("publicationCommitMs", 0) + held.get("reductionComputeMs", 0) for held in phase_reports)
    scored_candidates = sum(job.get("result", {}).get("rustReports", {}).get("score", {}).get("rowCount", 0)
        for job in state["jobs"] if job["stage"] in {"goldfish-one-reduce", "goldfish-two-reduce"}
        and job.get("result", {}).get("rustReports"))
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
        final = next((job for job in held if job["stage"] == "goldfish-two-reduce"), None)
        per_kingdom_completion[evidence_id] = {
            "kingdomId": held[0]["kingdomId"] if held else None,
            "wallMs": max(0, final.get("finishedMs", finished_ms) - min(starts)) if final and starts else 0,
            "completedMs": final.get("finishedMs") if final else None}
    stage_throughput = {
        "goldfishCandidatesPerSecond": scored_candidates / (scoring_ms / 1000) if scoring_ms else 0}
    retry_cost = sum(attempt.get("costUsd", 0) for attempt in attempts
        if attempt.get("status") not in {"complete", "submitted"})
    report = {"schemaVersion": 3, "campaignExecutionId": bundle["campaignExecutionId"],
        "route": GOLDFISH_MODAL_ROUTE,
        "status": "complete", "criticalPathWallMs": critical_elapsed_ms,
        "scientificStageWallMs": stage_wall,
        "authorizedCostGuard": bundle["controller"].get("costGuard"),
        "stageWallMs": stage_wall, "stageThroughput": stage_throughput,
        "perKingdomCompletion": per_kingdom_completion, "stageBarrierLatency": barrier_latencies,
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
