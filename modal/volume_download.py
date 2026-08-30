"""Bounded parallel downloads from a Modal Volume."""

from __future__ import annotations

import pathlib
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Iterable

_RETRY_DELAYS_SECONDS = (1, 2, 4)
_LIST_RETRY_DELAYS_SECONDS = (2, 4, 8, 16, 32)


def list_files(volume: Any, remote_root: str,
        sleep: Callable[[float], None] = time.sleep) -> list[Any]:
    """List one Volume tree, retrying only listing rate limits."""
    attempts = 0
    while True:
        attempts += 1
        try:
            return list(volume.listdir(remote_root, recursive=True))
        except Exception as error:
            if type(error).__name__ != "ResourceExhaustedError" \
                    or attempts > len(_LIST_RETRY_DELAYS_SECONDS):
                raise
            sleep(_LIST_RETRY_DELAYS_SECONDS[attempts - 1])


def fetch_file(volume: Any, remote: str, local: str | pathlib.Path, expected_size: int | None,
        sleep: Callable[[float], None] = time.sleep) -> dict[str, int | float]:
    """Download one file and verify its byte count."""
    destination = pathlib.Path(local)
    destination.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    attempts = 0
    while True:
        attempts += 1
        try:
            byte_count = 0
            with destination.open("wb") as stream:
                for chunk in volume.read_file(remote):
                    stream.write(chunk)
                    byte_count += len(chunk)
            if expected_size is not None and byte_count != expected_size:
                raise RuntimeError(
                    f"Volume file size differs for {remote}: expected {expected_size}, received {byte_count}")
            return {"bytes": byte_count, "wallMs": (time.monotonic() - started) * 1000,
                "attempts": attempts}
        except FileNotFoundError:
            destination.unlink(missing_ok=True)
            raise
        except Exception:
            destination.unlink(missing_ok=True)
            if attempts > len(_RETRY_DELAYS_SECONDS):
                raise
            sleep(_RETRY_DELAYS_SECONDS[attempts - 1])


def fetch_files(volume: Any, items: Iterable[dict[str, Any]], concurrency: int = 16) -> list[dict[str, int | float]]:
    """Download files in parallel and return metrics in input order."""
    entries = list(items)
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(fetch_file, volume, item["remote"], item["local"],
            item["expectedSize"]) for item in entries]
        return [future.result() for future in futures]
