"""Local Modal adapter for the PSRO batch route."""

from __future__ import annotations

import builtins
import hashlib
import json
import os
import pathlib
import shutil
import tempfile
import time
from typing import Any

import modal

RESULT_VOLUME = "hexdeck-native-strategy-results"
PSRO_FUNCTION = "strategy_search_psro_job"

app = modal.App("hexdeck-strategy-search-psro-runtime")
volume = modal.Volume.from_name(RESULT_VOLUME)


def _load(file: str | pathlib.Path) -> dict[str, Any]:
    return json.loads(pathlib.Path(file).read_text())


def _atomic_json(file: str | pathlib.Path, value: Any) -> None:
    path = pathlib.Path(file)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w") as stream:
        json.dump(value, stream, separators=(",", ":"), sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def _sha256_file(file: str | pathlib.Path) -> str:
    digest = hashlib.sha256()
    with pathlib.Path(file).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _remote_bytes(remote: str) -> bytes | None:
    try:
        return b"".join(volume.read_file(remote))
    except FileNotFoundError:
        return None


def _remote_exists(remote: str) -> bool:
    try:
        next(iter(volume.read_file(remote)), None)
        return True
    except FileNotFoundError:
        return False


def _remote_json(remote: str) -> dict[str, Any] | None:
    content = _remote_bytes(remote)
    return json.loads(content) if content is not None else None


def _upload(local: str, remote: str, *, force: bool = False) -> int:
    with volume.batch_upload(force=force) as batch:
        batch.put_file(local, remote)
    return pathlib.Path(local).stat().st_size


def _poll(call: Any) -> dict[str, Any]:
    try:
        return {"state": "complete", "result": call.get(timeout=0)}
    except builtins.TimeoutError:
        return {"state": "pending"}
    except Exception as error:
        return {"state": "failed", "error": f"{type(error).__name__}: {error}"}


def preflight(compute_app_name: str, source_image: dict[str, Any]) -> dict[str, Any]:
    started = time.monotonic()
    readiness = modal.Function.from_name(compute_app_name, "strategy_search_compute_ready")
    result = readiness.remote(source_image)
    if result.get("ready") is not True or result.get("sourceDigest") != source_image["digest"]:
        raise RuntimeError("deployed PSRO compute readiness differs from source identity")
    psro_readiness = modal.Function.from_name(compute_app_name, "strategy_search_psro_ready")
    psro_result = psro_readiness.remote(source_image)
    if psro_result.get("ready") is not True or psro_result.get("sourceDigest") != source_image["digest"]:
        raise RuntimeError("deployed PSRO runtime readiness differs from source identity")
    return {**result, "psroReady": psro_result, "computeAppName": compute_app_name,
        "preflightElapsedMs": (time.monotonic() - started) * 1000}


@app.local_entrypoint()
def preflight_entry(config_file: str, result_file: str) -> None:
    config = _load(config_file)
    result = preflight(config["computeAppName"], config["sourceImage"])
    _atomic_json(result_file, result)
    print(json.dumps(result), flush=True)


def launch(config: dict[str, Any], state_file: str) -> dict[str, Any]:
    state = _load(state_file)
    attempts = {attempt["launchId"]: attempt for attempt in state["attempts"]}
    for kingdom in config["kingdoms"]:
        if kingdom["launchId"] not in attempts or attempts[kingdom["launchId"]].get("callId") is not None:
            raise RuntimeError("PSRO launch state does not contain one unspawned launch record")
    for kingdom in config["kingdoms"]:
        for remote in kingdom["goldfishPaths"]:
            if not _remote_exists(remote):
                raise RuntimeError(f"PSRO Goldfish input is missing from the Volume: {remote}")
    uploads: list[dict[str, Any]] = []
    for kingdom in config["kingdoms"]:
        for held in kingdom["matrixUploads"]:
            remote = _remote_bytes(held["remotePath"])
            if remote is not None:
                if hashlib.sha256(remote).hexdigest() != held["sha256"]:
                    raise RuntimeError(f"PSRO Matrix input differs on the Volume: {held['remotePath']}")
                uploads.append({"path": held["remotePath"], "bytes": len(remote), "status": "matching"})
            else:
                size = _upload(held["localPath"], held["remotePath"])
                uploads.append({"path": held["remotePath"], "bytes": size, "status": "uploaded"})
    _upload(config["launchIntentFile"], config["launchIntentRemote"], force=True)

    function = modal.Function.from_name(config["computeAppName"], PSRO_FUNCTION).with_options(
        cpu=config["workerCores"], memory=8192, timeout=config["timeoutSeconds"],
        max_containers=config["slots"], retries=0, scaledown_window=10)
    spawned = []
    for kingdom in config["kingdoms"]:
        call = function.spawn(kingdom["jobConfig"])
        attempt = attempts[kingdom["launchId"]]
        attempt["callId"] = call.object_id
        attempt["status"] = "pending"
        attempt["spawnEpochMs"] = int(time.time() * 1000)
        _atomic_json(state_file, state)
        spawned.append({"kingdomId": kingdom["kingdomId"], "launchId": kingdom["launchId"],
            "callId": call.object_id})
    return {"spawned": spawned, "uploads": uploads,
        "uploadBytes": sum(entry["bytes"] for entry in uploads if entry["status"] == "uploaded")}


@app.local_entrypoint()
def launch_entry(config_file: str, state_file: str, result_file: str) -> None:
    result = launch(_load(config_file), state_file)
    _atomic_json(result_file, result)
    print(json.dumps(result), flush=True)


def status(state_file: str) -> dict[str, Any]:
    state = _load(state_file)
    rows = []
    for attempt in state["attempts"]:
        remote_out = attempt["remoteOutPath"].rstrip("/")
        lease = _remote_json(f"{remote_out}/lease.json")
        progress = _remote_json(f"{remote_out}/progress.json")
        job_report = _remote_json(f"{remote_out}/job-report.json")
        if attempt.get("callId") is None and lease and lease.get("launchId") == attempt["launchId"]:
            attempt["callId"] = lease["callId"]
            attempt["status"] = "pending"
            attempt["adoptedFromLease"] = True
        if attempt.get("callId") is None:
            call_state = "abandoned" if attempt.get("status") == "abandoned" else "unknown"
            attempt["status"] = call_state
        else:
            polled = _poll(modal.FunctionCall.from_id(attempt["callId"]))
            call_state = polled["state"]
            if call_state == "complete":
                attempt["status"] = "complete"
                attempt["result"] = polled["result"]
            elif call_state == "failed":
                attempt["status"] = "failed"
                attempt["error"] = polled["error"]
            else:
                attempt["status"] = "pending"
        rows.append({"kingdomId": attempt["kingdomId"], "launchId": attempt["launchId"],
            "callId": attempt.get("callId"), "state": call_state, "lease": lease,
            "progress": progress, "jobReport": job_report})
    _atomic_json(state_file, state)
    return {"attempts": rows}


@app.local_entrypoint()
def status_entry(state_file: str, result_file: str) -> None:
    result = status(state_file)
    _atomic_json(result_file, result)
    print(json.dumps(result), flush=True)


def _is_file(entry: Any) -> bool:
    held = getattr(entry, "type", None)
    return held == 1 or getattr(held, "name", None) == "FILE"


def download(config: dict[str, Any]) -> dict[str, Any]:
    artifacts = []
    for kingdom in config["kingdoms"]:
        remote_root = kingdom["remoteOutPath"].rstrip("/")
        entries = sorted(volume.listdir(remote_root, recursive=True), key=lambda entry: entry.path)
        selected = [entry for entry in entries if _is_file(entry)
            and pathlib.PurePosixPath(entry.path).name not in {"lease.json", "progress.json", "job-report.json"}]
        destination = pathlib.Path(kingdom["destination"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = pathlib.Path(tempfile.mkdtemp(prefix=f".{destination.name}-", dir=destination.parent))
        try:
            for entry in selected:
                relative = pathlib.PurePosixPath(entry.path).relative_to(remote_root)
                local = temporary / relative
                local.parent.mkdir(parents=True, exist_ok=True)
                byte_count = 0
                with local.open("wb") as stream:
                    for chunk in volume.read_file(entry.path):
                        stream.write(chunk)
                        byte_count += len(chunk)
                artifacts.append({"kingdomId": kingdom["kingdomId"], "path": entry.path,
                    "relative": relative.as_posix(), "bytes": byte_count})
            if destination.exists():
                shutil.rmtree(destination)
            os.replace(temporary, destination)
        except Exception:
            shutil.rmtree(temporary, ignore_errors=True)
            raise
    return {"artifacts": artifacts, "bytes": sum(entry["bytes"] for entry in artifacts)}


@app.local_entrypoint()
def download_entry(config_file: str, result_file: str) -> None:
    result = download(_load(config_file))
    _atomic_json(result_file, result)
    print(json.dumps(result), flush=True)
