"""Thin launcher for one Rust PSRO process."""

from __future__ import annotations

from collections import deque
import json
import os
import pathlib
import subprocess
import threading
import time
from typing import Any, Callable


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
    commit_interval_seconds: float = 0,
    on_checkpoint: Callable[[int, int, int, float], None] | None = None,
    monotonic: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Run one kingdom without making a scientific decision in Python."""
    if commit_interval_seconds < 0:
        raise ValueError("PSRO Volume commit interval cannot be negative")
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
    commit_count = 0
    commit_ms = 0.0
    last_commit_at = monotonic()
    pending_checkpoint: tuple[int, int] | None = None

    def commit_checkpoint(ordinal: int, crc: int) -> None:
        nonlocal commit_count, commit_ms, last_commit_at
        if on_checkpoint is not None:
            on_checkpoint(ordinal, crc, commit_count, commit_ms)
        started = monotonic()
        try:
            volume.commit()
        except Exception as error:
            process.kill()
            process.wait()
            _close_process(process)
            raise RuntimeError("PSRO Volume commit failed") from error
        finished = monotonic()
        commit_count += 1
        commit_ms += (finished - started) * 1000
        last_commit_at = finished

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
        ordinal, crc = int(parts[1]), int(parts[2])
        pending_checkpoint = (ordinal, crc)
        if monotonic() - last_commit_at >= commit_interval_seconds:
            commit_checkpoint(ordinal, crc)
            pending_checkpoint = None
        process.stdin.write(f"committed {parts[1]}\n")
        process.stdin.flush()
    return_code = process.wait()
    drain.join(timeout=5)
    _close_process(process)
    if return_code:
        diagnostic = "\n".join(errors)[-64 * 1024:] or "\n".join(output)[-64 * 1024:]
        raise RuntimeError(f"Rust PSRO failed: {diagnostic}")
    if volume is not None and pending_checkpoint is not None:
        commit_checkpoint(*pending_checkpoint)

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
        "verification": verification, "commitCount": commit_count,
        "volumeCommitMs": commit_ms}
