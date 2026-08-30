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
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import modal

from volume_download import fetch_files

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


def _status_attempt(attempt: dict[str, Any]) -> dict[str, Any]:
    held = dict(attempt)
    remote_out = held["remoteOutPath"].rstrip("/")
    lease = None
    progress = None
    job_report = None
    if held.get("status") == "complete":
        job_report = held.get("result")
        if job_report is None:
            job_report = _remote_json(f"{remote_out}/job-report.json")
        return {"attempt": held, "row": {"kingdomId": held["kingdomId"],
            "launchId": held["launchId"], "callId": held.get("callId"), "state": "complete",
            "lease": None, "progress": None, "jobReport": job_report}}

    if held.get("callId") is None:
        lease = _remote_json(f"{remote_out}/lease.json")
        if lease and lease.get("launchId") == held["launchId"]:
            held["callId"] = lease["callId"]
            held["status"] = "pending"
            held["adoptedFromLease"] = True
    if held.get("callId") is None:
        call_state = "abandoned" if held.get("status") == "abandoned" else "unknown"
        held["status"] = call_state
    else:
        progress = _remote_json(f"{remote_out}/progress.json")
        polled = _poll(modal.FunctionCall.from_id(held["callId"]))
        call_state = polled["state"]
        if call_state == "complete":
            held["status"] = "complete"
            held["result"] = polled["result"]
            job_report = _remote_json(f"{remote_out}/job-report.json")
        elif call_state == "failed":
            held["status"] = "failed"
            held["error"] = polled["error"]
        else:
            held["status"] = "pending"
    return {"attempt": held, "row": {"kingdomId": held["kingdomId"],
        "launchId": held["launchId"], "callId": held.get("callId"), "state": call_state,
        "lease": lease, "progress": progress, "jobReport": job_report}}


def status(state_file: str) -> dict[str, Any]:
    state = _load(state_file)
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(_status_attempt, state["attempts"]))
    for attempt, result in zip(state["attempts"], results):
        attempt.clear()
        attempt.update(result["attempt"])
    _atomic_json(state_file, state)
    return {"attempts": [result["row"] for result in results]}


@app.local_entrypoint()
def status_entry(state_file: str, result_file: str) -> None:
    result = status(state_file)
    _atomic_json(result_file, result)
    print(json.dumps(result), flush=True)


def _is_file(entry: Any) -> bool:
    held = getattr(entry, "type", None)
    return held == 1 or getattr(held, "name", None) == "FILE"


def download(config: dict[str, Any]) -> dict[str, Any]:
    started = time.monotonic()
    prepared = []
    items = []
    try:
        for kingdom in config["kingdoms"]:
            remote_root = kingdom["remoteOutPath"].rstrip("/")
            entries = sorted(volume.listdir(remote_root, recursive=True), key=lambda entry: entry.path)
            selected = [entry for entry in entries if _is_file(entry)
                and pathlib.PurePosixPath(entry.path).name not in {"lease.json", "progress.json", "job-report.json"}]
            destination = pathlib.Path(kingdom["destination"])
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = pathlib.Path(tempfile.mkdtemp(prefix=f".{destination.name}-", dir=destination.parent))
            prepared.append({"kingdom": kingdom, "destination": destination, "temporary": temporary,
                "firstItem": len(items), "fileCount": len(selected)})
            for entry in selected:
                relative = pathlib.PurePosixPath(entry.path).relative_to(remote_root)
                items.append({"remote": entry.path, "local": temporary / relative,
                    "expectedSize": entry.size, "relative": relative.as_posix(),
                    "kingdomId": kingdom["kingdomId"]})
        metrics = fetch_files(volume, items, concurrency=16)
        artifacts = [{"kingdomId": item["kingdomId"], "path": item["remote"],
            "relative": item["relative"], "bytes": metric["bytes"], "wallMs": metric["wallMs"]}
            for item, metric in zip(items, metrics)]
        kingdoms = []
        for entry in prepared:
            first = entry["firstItem"]
            held = artifacts[first:first + entry["fileCount"]]
            kingdoms.append({"kingdomId": entry["kingdom"]["kingdomId"], "files": len(held),
                "bytes": sum(artifact["bytes"] for artifact in held),
                "wallMs": max((artifact["wallMs"] for artifact in held), default=0)})
        for entry in prepared:
            if entry["destination"].exists():
                shutil.rmtree(entry["destination"])
            os.replace(entry["temporary"], entry["destination"])
        return {"artifacts": artifacts, "kingdoms": kingdoms,
            "bytes": sum(entry["bytes"] for entry in artifacts),
            "wallMs": (time.monotonic() - started) * 1000, "concurrency": 16}
    except Exception:
        for entry in prepared:
            shutil.rmtree(entry["temporary"], ignore_errors=True)
        raise


@app.local_entrypoint()
def download_entry(config_file: str, result_file: str) -> None:
    result = download(_load(config_file))
    _atomic_json(result_file, result)
    print(json.dumps(result), flush=True)
