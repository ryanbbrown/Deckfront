"""Thin launcher for one Rust PSRO process."""

from __future__ import annotations

from collections import deque
import json
import os
import pathlib
import subprocess
import threading
from typing import Any


def _stderr_tail(stream: Any, lines: deque[str]) -> None:
    for line in stream:
        lines.append(line.rstrip())


def _close_process(process: subprocess.Popen[str]) -> None:
    for stream in (process.stdin, process.stdout, process.stderr):
        if stream is not None:
            stream.close()


def _run_verify(command: list[str]) -> dict[str, Any]:
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode:
        diagnostic = result.stderr[-64 * 1024:] or result.stdout[-64 * 1024:]
        raise RuntimeError(f"Rust PSRO verification failed: {diagnostic}")
    try:
        return json.loads(result.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise RuntimeError("Rust PSRO verification returned invalid JSON") from error


def run_psro_step(
    binary: str,
    kingdom: str,
    top_file: str,
    reservoir: str,
    matrix_dir: str,
    out_dir: str,
    threads: int,
    report: str | None = None,
    *,
    volume: Any | None = None,
    deep_verify: bool = False,
) -> dict[str, Any]:
    """Run one kingdom without making a scientific decision in Python."""
    command = [binary, "psro", "--kingdom", kingdom, "--top-file", top_file,
        "--reservoir", reservoir, "--matrix-dir", matrix_dir, "--out", out_dir,
        "--threads", str(threads)]
    if report is not None:
        command += ["--report", report]
    environment = os.environ.copy()
    if volume is not None:
        environment["HEXDECK_PSRO_HANDSHAKE"] = "1"
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, bufsize=1, env=environment)
    assert process.stdout is not None and process.stderr is not None and process.stdin is not None
    errors: deque[str] = deque(maxlen=2_000)
    drain = threading.Thread(target=_stderr_tail, args=(process.stderr, errors), daemon=True)
    drain.start()
    output: list[str] = []
    for raw in process.stdout:
        line = raw.rstrip()
        output.append(line)
        if not line.startswith("checkpoint "):
            continue
        parts = line.split()
        if len(parts) != 3 or not parts[1].isdigit() or not parts[2].isdigit() or volume is None:
            process.kill()
            process.wait()
            _close_process(process)
            raise RuntimeError("Rust PSRO returned an invalid checkpoint handshake")
        try:
            volume.commit()
        except Exception as error:
            process.kill()
            process.wait()
            _close_process(process)
            raise RuntimeError("PSRO Volume commit failed") from error
        process.stdin.write(f"committed {parts[1]}\n")
        process.stdin.flush()
    return_code = process.wait()
    drain.join(timeout=5)
    _close_process(process)
    if return_code:
        diagnostic = "\n".join(errors)[-64 * 1024:] or "\n".join(output)[-64 * 1024:]
        raise RuntimeError(f"Rust PSRO failed: {diagnostic}")

    verification = None
    if deep_verify:
        verification = _run_verify([binary, "psro-verify", "--kingdom", kingdom,
            "--top-file", top_file, "--reservoir", reservoir, "--matrix-dir", matrix_dir,
            "--out", out_dir])
    root = pathlib.Path(out_dir)
    files = {path.relative_to(root).as_posix(): {"path": str(path), "bytes": path.stat().st_size}
        for path in sorted(root.rglob("*")) if path.is_file()}
    parsed_report = json.loads(pathlib.Path(report).read_text()) if report is not None else None
    return {"out": str(root), "files": files, "report": parsed_report,
        "verification": verification}
