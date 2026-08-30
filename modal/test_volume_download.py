import pathlib
import tempfile
import threading
import time
import unittest

from volume_download import fetch_file, fetch_files, list_files


class Volume:
    def __init__(self, files=None, failures=None, delay=0):
        self.files = dict(files or {})
        self.failures = dict(failures or {})
        self.delay = delay
        self.attempts = {}
        self.active = 0
        self.maximum_active = 0
        self.lock = threading.Lock()

    def read_file(self, remote):
        with self.lock:
            self.attempts[remote] = self.attempts.get(remote, 0) + 1
            attempt = self.attempts[remote]
            self.active += 1
            self.maximum_active = max(self.maximum_active, self.active)
        try:
            failure = self.failures.get((remote, attempt))
            if failure:
                raise failure
            if remote not in self.files:
                raise FileNotFoundError(remote)
            if self.delay:
                time.sleep(self.delay)
            yield self.files[remote]
        finally:
            with self.lock:
                self.active -= 1


class ResourceExhaustedError(Exception):
    pass


class ListingVolume:
    def __init__(self, results):
        self.results = list(results)
        self.calls = 0

    def listdir(self, remote_root, recursive=False):
        self.calls += 1
        self.remote_root = remote_root
        self.recursive = recursive
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class VolumeDownloadTests(unittest.TestCase):
    def test_list_files_retries_rate_limits_then_succeeds(self):
        entries = [object(), object()]
        volume = ListingVolume([ResourceExhaustedError("one"),
            ResourceExhaustedError("two"), entries])
        sleeps = []
        self.assertEqual(list_files(volume, "psro-executions/run", sleeps.append), entries)
        self.assertEqual(sleeps, [2, 4])
        self.assertEqual(volume.calls, 3)
        self.assertEqual(volume.remote_root, "psro-executions/run")
        self.assertTrue(volume.recursive)

    def test_list_files_raises_after_six_rate_limited_attempts(self):
        volume = ListingVolume([ResourceExhaustedError(str(index)) for index in range(6)])
        sleeps = []
        with self.assertRaisesRegex(ResourceExhaustedError, "5"):
            list_files(volume, "psro-executions/run", sleeps.append)
        self.assertEqual(volume.calls, 6)
        self.assertEqual(sleeps, [2, 4, 8, 16, 32])

    def test_list_files_does_not_retry_other_errors(self):
        volume = ListingVolume([OSError("not a rate limit")])
        sleeps = []
        with self.assertRaisesRegex(OSError, "not a rate limit"):
            list_files(volume, "psro-executions/run", sleeps.append)
        self.assertEqual(volume.calls, 1)
        self.assertEqual(sleeps, [])

    def test_fetch_files_uses_bounded_parallelism_and_keeps_input_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            files = {f"remote/{index:02d}": bytes([index]) for index in range(40)}
            volume = Volume(files, delay=0.01)
            items = [{"remote": remote, "local": root / str(index), "expectedSize": 1}
                for index, remote in enumerate(files)]
            results = fetch_files(volume, items)
            self.assertLessEqual(volume.maximum_active, 16)
            self.assertGreaterEqual(volume.maximum_active, 2)
            self.assertEqual([result["bytes"] for result in results], [1] * 40)
            self.assertEqual([pathlib.Path(item["local"]).read_bytes() for item in items], list(files.values()))

    def test_fetch_files_drains_the_pool_before_propagating_the_first_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            files = {f"remote/{index:02d}": bytes([index]) for index in range(20)}
            volume = Volume(files, delay=0.01)
            del volume.files["remote/00"]
            items = [{"remote": f"remote/{index:02d}", "local": root / str(index),
                "expectedSize": 1} for index in range(20)]
            with self.assertRaisesRegex(FileNotFoundError, "remote/00"):
                fetch_files(volume, items)
            self.assertEqual(volume.active, 0)
            self.assertEqual(volume.attempts, {f"remote/{index:02d}": 1 for index in range(20)})
            self.assertTrue(all((root / str(index)).read_bytes() == bytes([index])
                for index in range(1, 20)))

    def test_fetch_file_retries_a_transient_error(self):
        with tempfile.TemporaryDirectory() as directory:
            volume = Volume({"remote": b"complete"}, {("remote", 1): OSError("transient")})
            sleeps = []
            result = fetch_file(volume, "remote", pathlib.Path(directory) / "file", 8, sleeps.append)
            self.assertEqual(result["attempts"], 2)
            self.assertEqual(sleeps, [1])

    def test_fetch_file_raises_after_three_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            failures = {("remote", attempt): OSError("permanent") for attempt in range(1, 5)}
            volume = Volume({"remote": b"unused"}, failures)
            sleeps = []
            with self.assertRaisesRegex(OSError, "permanent"):
                fetch_file(volume, "remote", pathlib.Path(directory) / "file", 6, sleeps.append)
            self.assertEqual(volume.attempts["remote"], 4)
            self.assertEqual(sleeps, [1, 2, 4])

    def test_fetch_file_does_not_retry_a_missing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            volume = Volume()
            sleeps = []
            with self.assertRaises(FileNotFoundError):
                fetch_file(volume, "missing", pathlib.Path(directory) / "file", 1, sleeps.append)
            self.assertEqual(volume.attempts["missing"], 1)
            self.assertEqual(sleeps, [])

    def test_fetch_file_skips_size_validation_when_no_size_is_available(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = pathlib.Path(directory) / "file"
            result = fetch_file(Volume({"remote": b"content"}), "remote", destination, None)
            self.assertEqual(result["bytes"], 7)
            self.assertEqual(destination.read_bytes(), b"content")

    def test_fetch_file_rejects_a_size_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            volume = Volume({"remote": b"short"})
            with self.assertRaisesRegex(RuntimeError, "expected 6, received 5"):
                fetch_file(volume, "remote", pathlib.Path(directory) / "file", 6, lambda _seconds: None)
            self.assertEqual(volume.attempts["remote"], 4)


if __name__ == "__main__":
    unittest.main()
