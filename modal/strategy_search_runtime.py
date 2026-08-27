"""Invoke one verified deployed strategy-search compute app."""

from __future__ import annotations

import json
import os
import pathlib
import re
import time
from typing import Any

import modal

COMPUTE_APP_PREFIX = "hexdeck-strategy-"
RESULT_VOLUME = "hexdeck-native-strategy-results"

app = modal.App("hexdeck-strategy-search-runtime")
volume = modal.Volume.from_name(RESULT_VOLUME)
control_image = modal.Image.debian_slim(python_version="3.12")


def _execution_file(campaign_execution_id: str) -> pathlib.Path:
    if not re.fullmatch(r"[0-9a-f]{64}", campaign_execution_id):
        raise ValueError("campaign execution ID is invalid")
    return pathlib.Path("/results/executions") / campaign_execution_id / "state.json"


def _compute_app_name(source_digest: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", source_digest):
        raise ValueError("strategy-search source digest is invalid")
    return f"{COMPUTE_APP_PREFIX}{source_digest[:24]}"


def _load_bundle(launch_config: str) -> dict[str, Any]:
    bundle = json.loads(pathlib.Path(launch_config).read_text())
    required = {"schemaVersion", "campaignExecutionId", "executionRoot", "request", "sourceImage",
        "partitions", "jobs", "tasks", "controller"}
    if set(bundle) != required or bundle["schemaVersion"] != 2:
        raise ValueError("strategy-search launch bundle is malformed")
    return bundle


def _atomic_json(file: pathlib.Path, value: Any) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(f".{file.name}.{os.getpid()}.tmp")
    with temporary.open("w") as stream:
        json.dump(value, stream, separators=(",", ":"))
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, file)


def _download_final_artifacts(destination: pathlib.Path, evidence_ids: list[str]) -> dict[str, Any]:
    started = time.monotonic()
    artifacts = []
    for evidence_id in evidence_ids:
        for relative in ["goldfish/top-500000.hgf", "goldfish/reservoir.hgf",
                         "matrix/evidence.json", "psro/evidence.json"]:
            remote = f"evidence/{evidence_id}/{relative}"
            local = destination / remote
            local.parent.mkdir(parents=True, exist_ok=True)
            artifact_started = time.monotonic()
            byte_count = 0
            with local.open("wb") as stream:
                for chunk in volume.read_file(remote):
                    stream.write(chunk)
                    byte_count += len(chunk)
            artifacts.append({"evidenceId": evidence_id, "path": remote, "bytes": byte_count,
                "wallMs": round((time.monotonic() - artifact_started) * 1000, 3)})
    return {"bytes": sum(artifact["bytes"] for artifact in artifacts),
        "wallMs": round((time.monotonic() - started) * 1000, 3), "artifacts": artifacts}


def _startup_progress(state: dict[str, Any] | None) -> dict[str, Any]:
    if state is None:
        return {"exists": False, "usefulWorkStarted": False, "activeTaskCount": 0,
            "completedTaskCount": 0, "activeCpus": 0}
    jobs = state.get("jobs", [])
    active = [job for job in jobs if job.get("status") == "active"]
    complete = [job for job in jobs if job.get("status") == "complete"]
    useful_started_ms = state.get("usefulWorkStartedMs")
    return {"exists": True, "status": state.get("status"),
        "controllerFence": state.get("controllerFence", 0),
        "usefulWorkStarted": isinstance(useful_started_ms, int),
        "usefulWorkStartedMs": useful_started_ms,
        "submittedTaskCount": len(active), "completedTaskCount": len(complete),
        "submittedCpus": sum(job.get("cpu", job.get("cpus", 0)) for job in active),
        "activeStages": sorted({job["stage"] for job in active})}


@app.function(image=control_image, cpu=0.25, memory=512, timeout=30, volumes={"/results": volume})
def read_startup(campaign_execution_id: str) -> dict[str, Any]:
    volume.reload()
    state_file = _execution_file(campaign_execution_id)
    state = json.loads(state_file.read_text()) if state_file.exists() else None
    return _startup_progress(state)


@app.local_entrypoint()
def compute_preflight_entry(launch_config: str, compute_app_name: str, result_file: str) -> None:
    bundle = _load_bundle(launch_config)
    expected_app = _compute_app_name(bundle["sourceImage"]["digest"])
    if compute_app_name != expected_app:
        raise ValueError("deployed strategy-search compute app name differs from source identity")
    started = time.monotonic()
    readiness = modal.Function.from_name(compute_app_name, "strategy_search_compute_ready")
    result = readiness.remote(bundle["sourceImage"])
    if result.get("ready") is not True or result.get("sourceDigest") != bundle["sourceImage"]["digest"]:
        raise RuntimeError("deployed strategy-search compute readiness differs from source identity")
    result = {**result, "computeAppName": compute_app_name,
        "preflightElapsedMs": round((time.monotonic() - started) * 1000, 3)}
    _atomic_json(pathlib.Path(result_file), result)
    print(json.dumps(result), flush=True)


@app.local_entrypoint()
def run_deployed_entry(launch_config: str, compute_app_name: str, download_dir: str,
                       startup_timeout_seconds: int = 120) -> None:
    bundle = _load_bundle(launch_config)
    expected_app = _compute_app_name(bundle["sourceImage"]["digest"])
    if compute_app_name != expected_app:
        raise ValueError("deployed strategy-search compute app name differs from source identity")
    if startup_timeout_seconds < 1 or startup_timeout_seconds > 300:
        raise ValueError("strategy-search startup timeout is invalid")
    controller = modal.Function.from_name(compute_app_name, "strategy_search_controller")
    call = controller.spawn(bundle)
    print(json.dumps({"type": "strategy-search-controller-submitted",
        "campaignExecutionId": bundle["campaignExecutionId"], "computeAppName": compute_app_name,
        "functionCallId": call.object_id}), flush=True)
    deadline = time.monotonic() + startup_timeout_seconds
    progress: dict[str, Any] = {}
    while time.monotonic() < deadline:
        progress = read_startup.remote(bundle["campaignExecutionId"])
        if progress.get("status") == "failed":
            call.cancel(terminate_containers=True)
            raise RuntimeError("strategy-search controller failed before useful work started")
        if progress.get("usefulWorkStarted") and (progress.get("submittedTaskCount", 0) > 0
                or progress.get("completedTaskCount", 0) > 0):
            print(json.dumps({"type": "strategy-search-useful-work-started",
                "campaignExecutionId": bundle["campaignExecutionId"], **progress}), flush=True)
            break
        time.sleep(1)
    else:
        call.cancel(terminate_containers=True)
        print(json.dumps({"type": "strategy-search-startup-timeout",
            "campaignExecutionId": bundle["campaignExecutionId"], **progress}), flush=True)
        raise TimeoutError("deployed strategy-search controller did not start useful work in time")
    report = call.get(timeout=bundle["controller"]["timeoutSeconds"] + 60)
    destination = pathlib.Path(download_dir)
    destination.mkdir(parents=True, exist_ok=True)
    evidence_ids = [task["evidenceId"] for task in bundle["tasks"] if task["stage"] == "psro"]
    downloads = _download_final_artifacts(destination, evidence_ids)
    report = {**report, "clientOperations": {"downloads": downloads}}
    _atomic_json(destination / "report.json", report)
    print(json.dumps(report), flush=True)
