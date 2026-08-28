"""Run the Rust matrix step and collect its result files."""

from __future__ import annotations

import json
import pathlib
import subprocess
from typing import Any

_STDERR_TAIL = 4_000


def run_matrix_step(
    binary: str | pathlib.Path,
    kingdom_id: str,
    reservoir: str | pathlib.Path,
    out_dir: str | pathlib.Path,
    threads: int,
    report: str | pathlib.Path | None = None,
) -> dict[str, Any]:
    output = pathlib.Path(out_dir)
    command = [
        str(binary),
        "matrix",
        "--kingdom",
        kingdom_id,
        "--reservoir",
        str(reservoir),
        "--out",
        str(output),
        "--threads",
        str(threads),
    ]
    if report is not None:
        command.extend(["--report", str(report)])
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        stderr = completed.stderr[-_STDERR_TAIL:]
        raise RuntimeError(f"matrix command failed with exit {completed.returncode}: {stderr}")
    result: dict[str, Any] = {}
    for name in ["pairs", "purchases", "matrix"]:
        path = output / f"{name}.hgm"
        result[name] = {"path": path, "bytes": path.read_bytes()}
    result["report"] = json.loads(pathlib.Path(report).read_text()) if report is not None else None
    return result
