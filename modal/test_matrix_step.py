import json
import pathlib
import stat
import tempfile
import textwrap
import unittest

from matrix_step import run_matrix_step


class MatrixStepTest(unittest.TestCase):
    def fake_binary(self, directory: pathlib.Path, failure: bool = False) -> pathlib.Path:
        binary = directory / "fake-matrix"
        body = f"""\
#!/usr/bin/env python3
import json
import pathlib
import sys

args = sys.argv[1:]
pathlib.Path({str(directory / 'args.json')!r}).write_text(json.dumps(args))
if {failure!r}:
    print('bounded matrix failure', file=sys.stderr)
    raise SystemExit(7)
out = pathlib.Path(args[args.index('--out') + 1])
out.mkdir(parents=True, exist_ok=True)
for name in ['pairs', 'purchases', 'matrix']:
    (out / f'{{name}}.hgm').write_bytes(name.encode())
if '--report' in args:
    pathlib.Path(args[args.index('--report') + 1]).write_text(json.dumps({{'command': 'matrix'}}))
"""
        binary.write_text(textwrap.dedent(body))
        binary.chmod(binary.stat().st_mode | stat.S_IXUSR)
        return binary

    def test_runs_command_and_collects_files_and_report(self):
        with tempfile.TemporaryDirectory() as held:
            directory = pathlib.Path(held)
            binary = self.fake_binary(directory)
            report = directory / "report.json"
            result = run_matrix_step(
                binary, directory / "kingdom.json", directory / "reservoir.hgf",
                directory / "out", 10, report
            )
            args = json.loads((directory / "args.json").read_text())
            self.assertEqual(args, [
                "matrix", "--kingdom-file", str(directory / "kingdom.json"),
                "--reservoir", str(directory / "reservoir.hgf"),
                "--out", str(directory / "out"), "--threads", "10",
                "--report", str(report)
            ])
            self.assertEqual(result["pairs"]["bytes"], b"pairs")
            self.assertEqual(result["purchases"]["bytes"], b"purchases")
            self.assertEqual(result["matrix"]["bytes"], b"matrix")
            self.assertEqual(result["report"], {"command": "matrix"})
            self.assertEqual(result["matrix"]["path"], directory / "out/matrix.hgm")

    def test_raises_with_stderr_tail(self):
        with tempfile.TemporaryDirectory() as held:
            directory = pathlib.Path(held)
            binary = self.fake_binary(directory, failure=True)
            with self.assertRaisesRegex(RuntimeError, "bounded matrix failure"):
                run_matrix_step(
                    binary, directory / "kingdom.json", directory / "reservoir.hgf",
                    directory / "out", 4
                )

    def test_omits_report_option(self):
        with tempfile.TemporaryDirectory() as held:
            directory = pathlib.Path(held)
            binary = self.fake_binary(directory)
            result = run_matrix_step(
                binary, directory / "kingdom.json", directory / "reservoir.hgf",
                directory / "out", 1
            )
            args = json.loads((directory / "args.json").read_text())
            self.assertNotIn("--report", args)
            self.assertIsNone(result["report"])


if __name__ == "__main__":
    unittest.main()
