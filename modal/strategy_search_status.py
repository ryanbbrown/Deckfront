"""Bounded read-only status entrypoint for scalable strategy search."""

from __future__ import annotations

import json
import pathlib
import re
from typing import Any

import modal

app = modal.App("hexdeck-strategy-search-status")
volume = modal.Volume.from_name("hexdeck-native-strategy-results")
control_image = modal.Image.debian_slim(python_version="3.12")


def _execution_file(campaign_execution_id: str) -> pathlib.Path:
    if not re.fullmatch(r"[0-9a-f]{64}", campaign_execution_id):
        raise ValueError("campaign execution ID is invalid")
    return pathlib.Path("/results/executions") / campaign_execution_id / "state.json"


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
