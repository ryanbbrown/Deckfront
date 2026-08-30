"""Thin launcher for one Rust PSRO process."""

from __future__ import annotations

from collections import deque
import json
import os
import pathlib
import shutil
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


_CONTROL_FILES = {"lease.json", "progress.json", "job-report.json"}


def _rust_owned(path: pathlib.Path, root: pathlib.Path) -> bool:
    return path.relative_to(root).parts[0] not in _CONTROL_FILES


def _copy_rust_owned(source: pathlib.Path, target: pathlib.Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    if not source.exists():
        return
    for path in source.rglob("*"):
        if path.is_file() and _rust_owned(path, source):
            destination = target / path.relative_to(source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)


def _publish_local(local: pathlib.Path, remote: pathlib.Path) -> None:
    _copy_rust_owned(local, remote)
    if remote.exists():
        for path in remote.rglob("*.tmp"):
            if path.is_file() and _rust_owned(path, remote):
                path.unlink()


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
    evidence_id: str | None = None,
    local_root: str | pathlib.Path = "/tmp/hexdeck-psro",
) -> dict[str, Any]:
    """Run one kingdom without making a scientific decision in Python."""
    if commit_interval_seconds < 0:
        raise ValueError("PSRO Volume commit interval cannot be negative")
    remote_root = pathlib.Path(out_dir)
    rust_root = remote_root
    rust_report = pathlib.Path(report) if report is not None else None
    if volume is not None:
        local = pathlib.Path(local_root) / (evidence_id or remote_root.name)
        shutil.rmtree(local, ignore_errors=True)
        local.mkdir(parents=True)
        if (remote_root / "checkpoint.hpc").is_file():
            _copy_rust_owned(remote_root, local)
        rust_root = local
        if report is not None:
            rust_report = local / pathlib.Path(report).name
    command = [binary, "psro", "--kingdom", kingdom, "--top-file", top_file,
        "--reservoir", reservoir, "--matrix-dir", matrix_dir, "--out", str(rust_root),
        "--threads", str(threads)]
    if rust_report is not None:
        command += ["--report", str(rust_report)]
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
    latest_checkpoint: tuple[int, int] | None = None

    def commit_checkpoint(ordinal: int, crc: int) -> None:
        nonlocal commit_count, commit_ms, last_commit_at
        if on_checkpoint is not None:
            on_checkpoint(ordinal, crc, commit_count, commit_ms)
        started = monotonic()
        try:
            _publish_local(rust_root, remote_root)
            volume.commit()
        except Exception as error:
            raise RuntimeError("PSRO Volume commit failed") from error
        finished = monotonic()
        commit_count += 1
        commit_ms += (finished - started) * 1000
        last_commit_at = finished

    loop_error: Exception | None = None
    try:
        for raw in process.stdout:
            line = raw.rstrip()
            output.append(line)
            if not line.startswith("checkpoint "):
                continue
            parts = line.split()
            if len(parts) != 3 or not parts[1].isdigit() or not parts[2].isdigit() or volume is None:
                raise RuntimeError("Rust PSRO returned an invalid checkpoint handshake")
            ordinal, crc = int(parts[1]), int(parts[2])
            latest_checkpoint = (ordinal, crc)
            if monotonic() - last_commit_at >= commit_interval_seconds:
                commit_checkpoint(ordinal, crc)
            process.stdin.write(f"committed {parts[1]}\n")
            process.stdin.flush()
    except Exception as error:
        loop_error = error
        if process.poll() is None:
            process.kill()
    return_code = process.wait()
    drain.join(timeout=5)
    _close_process(process)

    final_errors: list[Exception] = []
    if volume is not None:
        if latest_checkpoint is not None and on_checkpoint is not None:
            try:
                on_checkpoint(*latest_checkpoint, commit_count, commit_ms)
            except Exception as error:
                final_errors.append(error)
        started = monotonic()
        try:
            _publish_local(rust_root, remote_root)
            volume.commit()
        except Exception as error:
            final_errors.append(error)
        else:
            finished = monotonic()
            commit_count += 1
            commit_ms += (finished - started) * 1000
            last_commit_at = finished

    diagnostic = "\n".join(errors)[-64 * 1024:] or "\n".join(output)[-64 * 1024:]
    if return_code:
        message = f"Rust PSRO failed: {diagnostic}"
        if loop_error is not None:
            message += f"; launcher failed: {loop_error}"
        if final_errors:
            message += f"; final publish or commit failed: {final_errors[-1]}"
        raise RuntimeError(message) from (final_errors[-1] if final_errors else loop_error)
    if loop_error is not None:
        message = str(loop_error)
        if final_errors:
            message += f"; final publish or commit failed: {final_errors[-1]}"
        raise RuntimeError(message) from loop_error
    if final_errors:
        raise RuntimeError(f"PSRO final publish or commit failed: {final_errors[-1]}") from final_errors[-1]

    verification = None
    if deep_verify:
        verification = _run_verify([binary, "psro-verify", "--kingdom", kingdom,
            "--top-file", top_file, "--reservoir", reservoir, "--matrix-dir", matrix_dir,
            "--out", str(rust_root)])
    root = rust_root
    files = {path.relative_to(root).as_posix(): {
        "path": str(remote_root / path.relative_to(root)), "bytes": path.stat().st_size}
        for path in sorted(root.rglob("*")) if path.is_file()}
    parsed_report = json.loads(rust_report.read_text()) if rust_report is not None else None
    return {"out": str(remote_root), "files": files, "report": parsed_report,
        "verification": verification, "commitCount": commit_count,
        "volumeCommitMs": commit_ms}
