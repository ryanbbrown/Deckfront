import json
import pathlib
import stat
import tempfile
import unittest

from psro_step import run_psro_step


class Volume:
    def __init__(self):
        self.commits = 0

    def commit(self):
        self.commits += 1


class PsroStepTests(unittest.TestCase):
    def executable(self, root: pathlib.Path, fail: bool = False) -> pathlib.Path:
        path = root / "fake.py"
        path.write_text("""#!/usr/bin/env python3
import json, pathlib, sys
args=sys.argv[1:]
if args[0] == 'psro-verify':
 print(json.dumps({'valid': True, 'command': 'psro-verify'})); raise SystemExit(0)
if %s:
 print('bounded failure', file=sys.stderr); raise SystemExit(4)
out=pathlib.Path(args[args.index('--out')+1]); out.mkdir(parents=True, exist_ok=True)
(out/'decisions.hpd').write_bytes(b'evidence')
if '--report' in args:
 pathlib.Path(args[args.index('--report')+1]).write_text(json.dumps({'games': 12}))
if __import__('os').environ.get('HEXDECK_PSRO_HANDSHAKE'):
 print('checkpoint 1 22', flush=True)
 if input().strip() != 'committed 1': raise SystemExit(5)
print(json.dumps({'complete': True}))
""" % ("True" if fail else "False"))
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
        return path

    def test_runs_handshake_verify_and_collects_files(self):
        with tempfile.TemporaryDirectory() as held:
            root = pathlib.Path(held)
            binary = self.executable(root)
            report = root / "report.json"
            volume = Volume()
            result = run_psro_step(str(binary), "kingdom", "top", "reservoir", "matrix",
                str(root / "out"), 16, str(report), volume=volume)
            self.assertEqual(volume.commits, 1)
            self.assertEqual(result["report"], {"games": 12})
            self.assertEqual(result["files"]["decisions.hpd"]["bytes"], 8)
            self.assertTrue(result["verification"]["valid"])

    def test_returns_bounded_failure(self):
        with tempfile.TemporaryDirectory() as held:
            root = pathlib.Path(held)
            binary = self.executable(root, fail=True)
            with self.assertRaisesRegex(RuntimeError, "bounded failure"):
                run_psro_step(str(binary), "kingdom", "top", "reservoir", "matrix",
                    str(root / "out"), 4)

    def test_report_is_optional(self):
        with tempfile.TemporaryDirectory() as held:
            root = pathlib.Path(held)
            result = run_psro_step(str(self.executable(root)), "kingdom", "top", "reservoir",
                "matrix", str(root / "out"), 4)
            self.assertIsNone(result["report"])

    def test_acknowledged_checkpoint_resumes_without_replaying_the_look(self):
        with tempfile.TemporaryDirectory() as held:
            root = pathlib.Path(held)
            binary = root / "recover.py"
            binary.write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
root=pathlib.Path(__file__).parent
args=sys.argv[1:]
if args[0] == 'psro-verify':
 print(json.dumps({'valid': True})); raise SystemExit(0)
out=pathlib.Path(args[args.index('--out')+1]); out.mkdir(parents=True, exist_ok=True)
acked=root/'acked'
count=root/'first-look-count'
if not acked.exists():
 count.write_text(str(int(count.read_text()) + 1 if count.exists() else 1))
 print('checkpoint 1 101', flush=True)
 if input().strip() != 'committed 1': raise SystemExit(5)
 acked.write_text('persisted')
 raise SystemExit(9)
print('checkpoint 2 202', flush=True)
if input().strip() != 'committed 2': raise SystemExit(6)
(out/'decisions.hpd').write_bytes(b'evidence')
print(json.dumps({'complete': True}))
""")
            binary.chmod(binary.stat().st_mode | stat.S_IXUSR)
            volume = Volume()
            with self.assertRaisesRegex(RuntimeError, "Rust PSRO failed"):
                run_psro_step(str(binary), "kingdom", "top", "reservoir", "matrix",
                    str(root / "out"), 16, volume=volume)
            result = run_psro_step(str(binary), "kingdom", "top", "reservoir", "matrix",
                str(root / "out"), 16, volume=volume)
            self.assertEqual((root / "first-look-count").read_text(), "1")
            self.assertEqual(volume.commits, 2)
            self.assertTrue(result["verification"]["valid"])


if __name__ == "__main__":
    unittest.main()
