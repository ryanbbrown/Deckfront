"""Bounded control entrypoints for scalable strategy search."""

from __future__ import annotations

import json
import os
import pathlib
import re
import time
from typing import Any

import modal

app = modal.App("hexdeck-strategy-search-status")
volume = modal.Volume.from_name("hexdeck-native-strategy-results")
control_image = modal.Image.debian_slim(python_version="3.12")


def _execution_file(campaign_execution_id: str) -> pathlib.Path:
    if not re.fullmatch(r"[0-9a-f]{64}", campaign_execution_id):
        raise ValueError("campaign execution ID is invalid")
    return pathlib.Path("/results/executions") / campaign_execution_id / "state.json"


def _preflight_file(campaign_execution_id: str) -> pathlib.Path:
    return _execution_file(campaign_execution_id).with_name("compute-preflight.json")


def _atomic_json(file: pathlib.Path, value: Any) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(f".{file.name}.{os.getpid()}.tmp")
    with temporary.open("w") as stream:
        json.dump(value, stream, separators=(",", ":"))
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, file)


@app.function(image=control_image, cpu=0.25, memory=512, timeout=30, max_containers=1,
              volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def begin_compute_preflight(campaign_execution_id: str, source_digest: str,
                            compute_app_name: str) -> dict[str, Any]:
    if not re.fullmatch(r"[0-9a-f]{64}", source_digest) \
            or compute_app_name != f"hexdeck-strategy-{source_digest[:24]}":
        raise ValueError("strategy-search compute app name differs from source identity")
    preflight = {"schemaVersion": 1, "campaignExecutionId": campaign_execution_id,
        "phase": "image-preparing", "sourceDigest": source_digest,
        "computeAppName": compute_app_name, "operatorStartedMs": int(time.time() * 1000)}
    volume.reload()
    _atomic_json(_preflight_file(campaign_execution_id), preflight)
    volume.commit()
    return preflight


@app.function(image=control_image, cpu=0.25, memory=512, timeout=30, max_containers=1,
              volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def fail_compute_preflight(campaign_execution_id: str, source_digest: str,
                           compute_app_name: str, failure: str) -> dict[str, Any]:
    volume.reload()
    preflight_file = _preflight_file(campaign_execution_id)
    if not preflight_file.exists():
        raise RuntimeError("strategy-search compute preflight state is missing")
    preflight = json.loads(preflight_file.read_text())
    if preflight.get("sourceDigest") != source_digest \
            or preflight.get("computeAppName") != compute_app_name:
        raise RuntimeError("strategy-search compute preflight identity differs")
    if not failure.strip():
        raise ValueError("strategy-search compute preflight failure is empty")
    preflight.update({"phase": "startup-failed", "failedMs": int(time.time() * 1000),
        "failure": failure[-4000:]})
    _atomic_json(preflight_file, preflight)
    volume.commit()
    return preflight


@app.function(image=control_image, cpu=0.25, memory=512, timeout=30, max_containers=1,
              volumes={"/results": volume})
@modal.concurrent(max_inputs=1)
def prepare_execution(bundle: dict[str, Any], compute_preflight: dict[str, Any]) -> dict[str, Any]:
    required = {"schemaVersion", "campaignExecutionId", "executionRoot", "request", "sourceImage",
        "partitions", "jobs", "tasks", "controller"}
    if set(bundle) != required or bundle["schemaVersion"] != 2:
        raise ValueError("strategy-search launch bundle is malformed")
    preflight_fields = {"ready", "sourceDigest", "readyMs", "computeAppName", "preflightElapsedMs"}
    source_digest = bundle["sourceImage"]["digest"]
    expected_app = f"hexdeck-strategy-{source_digest[:24]}"
    if set(compute_preflight) != preflight_fields or compute_preflight["ready"] is not True \
            or compute_preflight["sourceDigest"] != source_digest \
            or compute_preflight["computeAppName"] != expected_app:
        raise ValueError("strategy-search compute preflight is invalid")
    execution_id = bundle["campaignExecutionId"]
    state_file = _execution_file(execution_id)
    ordered_evidence_ids = [task["evidenceId"] for task in bundle["tasks"] if task["stage"] == "psro"]
    if not ordered_evidence_ids or len(set(ordered_evidence_ids)) != len(ordered_evidence_ids):
        raise ValueError("strategy-search launch bundle evidence order is invalid")
    volume.reload()
    if state_file.exists():
        state = json.loads(state_file.read_text())
        if state.get("orderedEvidenceIds") != ordered_evidence_ids:
            raise RuntimeError("saved execution scientific identity differs")
        if state.get("computePreflight", {}).get("sourceDigest") != source_digest:
            raise RuntimeError("saved execution compute identity differs")
        return {"prepared": False, "campaignExecutionId": execution_id, "status": state["status"],
            "startedMs": state["startedMs"]}
    started_ms = int(time.time() * 1000)
    state = {"schemaVersion": 2, "campaignExecutionId": execution_id,
        "orderedEvidenceIds": ordered_evidence_ids, "partitions": bundle["partitions"],
        "jobs": bundle["jobs"], "tasks": bundle["tasks"],
        "maxActiveCpus": bundle["request"]["maxActiveCpus"], "revision": 0,
        "controllerFence": 0, "controller": None, "status": "ready", "report": None,
        "startedMs": started_ms, "usefulWorkStartedMs": None,
        "computePreflight": compute_preflight, "utilizationIntervals": [],
        "admissionFailures": 0, "publisherCommitMs": 0.0,
        "admissionLimitCpus": bundle["request"]["maxActiveCpus"]}
    _atomic_json(state_file, state)
    volume.commit()
    return {"prepared": True, "campaignExecutionId": execution_id, "status": "ready",
        "startedMs": started_ms}


@app.function(image=control_image, cpu=0.25, memory=512, timeout=30, volumes={"/results": volume})
def read_status(campaign_execution_id: str) -> dict[str, Any]:
    volume.reload()
    state_file = _execution_file(campaign_execution_id)
    state = json.loads(state_file.read_text()) if state_file.exists() else None
    if state is None:
        preflight_file = _preflight_file(campaign_execution_id)
        if preflight_file.exists():
            preflight = json.loads(preflight_file.read_text())
            failed = preflight["phase"] == "startup-failed"
            return {"exists": False, "campaignExecutionId": campaign_execution_id,
                "status": "failed" if failed else "preparing", "phase": preflight["phase"],
                "report": None, "operatorStartedMs": preflight["operatorStartedMs"],
                "failedMs": preflight.get("failedMs"), "failure": preflight.get("failure"),
                "computeAppName": preflight["computeAppName"], "activeTaskCount": 0,
                "completedTaskCount": 0, "activeCpus": 0, "activeStages": [], "stageCounts": {}}
        return {"exists": False, "campaignExecutionId": campaign_execution_id,
            "status": "missing", "phase": "missing"}
    jobs = state.get("jobs", [])
    active = [job for job in jobs if job.get("status") == "active"]
    complete = [job for job in jobs if job.get("status") == "complete"]
    stage_counts = {}
    for job in jobs:
        stage = stage_counts.setdefault(job["stage"], {"active": 0, "complete": 0, "total": 0})
        stage["total"] += 1
        if job.get("status") in {"active", "complete"}:
            stage[job["status"]] += 1
    if state["status"] in {"complete", "failed"}:
        status, phase = state["status"], state["status"]
    elif state.get("usefulWorkStartedMs") is not None:
        status, phase = "running", "controller-running"
    else:
        status, phase = "starting", "controller-starting"
    return {"exists": True, "campaignExecutionId": campaign_execution_id, "status": status,
        "phase": phase, "report": state.get("report"), "startedMs": state.get("startedMs"),
        "usefulWorkStartedMs": state.get("usefulWorkStartedMs"),
        "controllerFence": state.get("controllerFence", 0),
        "activeTaskCount": len(active), "completedTaskCount": len(complete),
        "activeCpus": sum(job.get("cpu", job.get("cpus", 0)) for job in active),
        "activeStages": sorted({job["stage"] for job in active}), "stageCounts": stage_counts}


@app.local_entrypoint()
def status_entry(campaign_execution_id: str) -> None:
    print(json.dumps(read_status.remote(campaign_execution_id)))


@app.local_entrypoint()
def begin_preflight_entry(campaign_execution_id: str, source_digest: str,
                          compute_app_name: str) -> None:
    print(json.dumps(begin_compute_preflight.remote(
        campaign_execution_id, source_digest, compute_app_name)))


@app.local_entrypoint()
def fail_preflight_entry(campaign_execution_id: str, source_digest: str,
                         compute_app_name: str, failure_file: str) -> None:
    failure = json.loads(pathlib.Path(failure_file).read_text())
    if set(failure) != {"error"} or not isinstance(failure["error"], str):
        raise ValueError("strategy-search compute failure file is malformed")
    print(json.dumps(fail_compute_preflight.remote(
        campaign_execution_id, source_digest, compute_app_name, failure["error"])))


@app.local_entrypoint()
def prepare_entry(launch_config: str, compute_preflight: str) -> None:
    bundle = json.loads(pathlib.Path(launch_config).read_text())
    preflight = json.loads(pathlib.Path(compute_preflight).read_text())
    print(json.dumps(prepare_execution.remote(bundle, preflight)))
