#!/usr/bin/env python3
"""Create isolated Deckfront experiment sandboxes."""

from __future__ import annotations

import argparse
import shutil
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPERIMENTS_DIR = ROOT / "experiments"
BASE_CODE_DIR = ROOT / "experiment-base" / "code"

IGNORE_NAMES = {
    ".DS_Store",
    ".games",
    "__pycache__",
    "node_modules",
}


def main() -> int:
    args = parse_args()
    if args.command == "create":
        create_experiment(args)
        return 0
    raise ValueError(f"Unknown command: {args.command}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage Deckfront experiment sandboxes.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="Create a new experiment sandbox.")
    create.add_argument("--id", required=True, help="Experiment id, e.g. E001-current-best.")
    source = create.add_mutually_exclusive_group(required=True)
    source.add_argument("--from-base", action="store_true", help="Copy from experiment-base/code.")
    source.add_argument("--from-experiment", help="Copy from experiments/<id>/code.")
    create.add_argument("--hypothesis", required=True)
    create.add_argument("--description", default="")
    create.add_argument("--force", action="store_true", help="Replace an existing experiment directory.")
    return parser.parse_args()


def create_experiment(args: argparse.Namespace) -> None:
    destination = EXPERIMENTS_DIR / args.id
    code_destination = destination / "code"
    if destination.exists():
        if not args.force:
            raise SystemExit(f"Experiment already exists: {relative(destination)}")
        shutil.rmtree(destination)

    source_type = "base" if args.from_base else "experiment"
    source_id = "experiment-base" if args.from_base else args.from_experiment
    source_code = BASE_CODE_DIR if args.from_base else EXPERIMENTS_DIR / args.from_experiment / "code"
    if not source_code.exists():
        raise SystemExit(f"Source code directory does not exist: {relative(source_code)}")

    destination.mkdir(parents=True)
    copy_tree(source_code, code_destination)
    (destination / "runs").mkdir()
    (destination / "evaluation.md").write_text("# Evaluation\n\nPending.\n")

    manifest = experiment_manifest(
        experiment_id=args.id,
        source_type=source_type,
        source_id=source_id,
        source_code=source_code,
        hypothesis=args.hypothesis,
        description=args.description,
    )
    (destination / "experiment.yaml").write_text(manifest)
    print(f"Created {relative(destination)} from {relative(source_code)}")


def copy_tree(source: Path, destination: Path) -> None:
    shutil.copytree(source, destination, ignore=ignore)


def ignore(_directory: str, names: list[str]) -> set[str]:
    return {name for name in names if name in IGNORE_NAMES or name.endswith(".pyc")}


def experiment_manifest(
    *,
    experiment_id: str,
    source_type: str,
    source_id: str | None,
    source_code: Path,
    hypothesis: str,
    description: str,
) -> str:
    return "\n".join(
        [
            f"id: {quote(experiment_id)}",
            f"createdAt: {quote(datetime.now(UTC).isoformat())}",
            "source:",
            f"  type: {quote(source_type)}",
            f"  id: {quote(source_id or '')}",
            f"  path: {quote(relative(source_code.parent if source_type == 'experiment' else ROOT / 'experiment-base'))}",
            f"hypothesis: {quote(hypothesis)}",
            f"description: {quote(description)}",
            "codePath: code",
            "runsPath: runs",
            "",
        ]
    )


def quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def relative(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    raise SystemExit(main())
