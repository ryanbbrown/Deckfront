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
def prepare_execution(bundle: dict[str, Any]) -> dict[str, Any]:
    required = {"schemaVersion", "campaignExecutionId", "executionRoot", "request", "sourceImage",
        "partitions", "jobs", "tasks", "controller"}
    if set(bundle) != required or bundle["schemaVersion"] != 2:
        raise ValueError("strategy-search launch bundle is malformed")
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
        return {"prepared": False, "campaignExecutionId": execution_id, "status": state["status"]}
    state = {"schemaVersion": 2, "campaignExecutionId": execution_id,
        "orderedEvidenceIds": ordered_evidence_ids, "partitions": bundle["partitions"],
        "jobs": bundle["jobs"], "tasks": bundle["tasks"],
        "maxActiveCpus": bundle["request"]["maxActiveCpus"], "revision": 0,
        "controllerFence": 0, "controller": None, "status": "ready", "report": None,
        "startedMs": int(time.time() * 1000), "utilizationIntervals": [],
        "admissionFailures": 0, "publisherCommitMs": 0.0,
        "admissionLimitCpus": bundle["request"]["maxActiveCpus"]}
    _atomic_json(state_file, state)
    volume.commit()
    return {"prepared": True, "campaignExecutionId": execution_id, "status": "ready"}


@app.function(image=control_image, cpu=0.25, memory=512, timeout=30, volumes={"/results": volume})
def read_status(campaign_execution_id: str) -> dict[str, Any]:
    volume.reload()
    state_file = _execution_file(campaign_execution_id)
    state = json.loads(state_file.read_text()) if state_file.exists() else None
    if state is None:
        return {"exists": False, "campaignExecutionId": campaign_execution_id, "status": "missing"}
    status = "running" if state["status"] == "ready" else state["status"]
    return {"exists": True, "campaignExecutionId": campaign_execution_id, "status": status,
        "report": state.get("report")}


@app.local_entrypoint()
def status_entry(campaign_execution_id: str) -> None:
    print(json.dumps(read_status.remote(campaign_execution_id)))


@app.local_entrypoint()
def prepare_entry(launch_config: str) -> None:
    bundle = json.loads(pathlib.Path(launch_config).read_text())
    print(json.dumps(prepare_execution.remote(bundle)))
