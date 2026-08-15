#!/usr/bin/env python3
"""Choose one enumerated Hexdeck action through ThinHarness."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from thinharness import Harness, HarnessConfig, ToolResult, ToolSpec


class ChooseActionArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action_id: str = Field(min_length=1, description="One exact ID from legalActions")


class ActionTool:
    def __init__(self, legal_ids: set[str]):
        self.legal_ids = legal_ids
        self.selected: str | None = None
        self.calls: list[dict[str, Any]] = []

    def choose(self, submitted: ChooseActionArgs) -> ToolResult:
        self.calls.append({"tool": "choose_action", "actionId": submitted.action_id})
        if self.selected is not None:
            return ToolResult(False, "Exactly one action is allowed.", {"error_type": "MultipleActions", "retry": False})
        if submitted.action_id not in self.legal_ids:
            return ToolResult(False, "Use one exact current action ID.", {"error_type": "UnknownAction", "retry": True})
        self.selected = submitted.action_id
        return ToolResult(True, "Action accepted. End your response now.")

    def spec(self) -> ToolSpec:
        return ToolSpec(
            "choose_action",
            "Choose exactly one listed atomic action. Do not invent coordinates, targets, cards, or combinations.",
            ChooseActionArgs,
            self.choose,
            max_retries=3,
            sequential=True,
        )


def prompt(strategy: str, briefing: dict[str, Any]) -> str:
    priorities = [
        "Take an immediate match win.",
        "Take an immediate point unless another listed action wins more points.",
        "Protect a piece facing an immediate ring-out.",
        "Improve pushing position when no point is available.",
        "Use control and movement cards to prevent the opponent's next threat.",
        "Pass only when further actions have less value than preserving cards or buying.",
    ]
    return "\n\n".join([
        "Choose exactly one action ID by calling choose_action once.",
        "Priority rules:\n" + "\n".join(f"- {item}" for item in priorities),
        "Editable strategy:\n" + strategy,
        "Private briefing:\n" + json.dumps(briefing, separators=(",", ":"), ensure_ascii=False),
    ])


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--strategy", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--trace", required=True)
    parser.add_argument("--model", default="openai:gpt-5.6-luna")
    parser.add_argument("--effort", default="low")
    parser.add_argument("--timeout-seconds", type=int, default=240)
    parser.add_argument("--fake-model", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    snapshot = json.loads(Path(args.snapshot).read_text(encoding="utf-8"))
    strategy = Path(args.strategy).read_text(encoding="utf-8")
    briefing = snapshot["briefing"]
    legal_ids = {action["id"] for action in briefing["legalActions"]}
    tool = ActionTool(legal_ids)
    request_prompt = prompt(strategy, briefing)
    started = time.monotonic()
    trace: dict[str, Any] = {
        "schemaVersion": 2,
        "round": snapshot["round"],
        "actionStep": snapshot["actionStep"],
        "revision": snapshot["baseRevision"],
        "model": "fake" if args.fake_model else args.model,
        "effort": args.effort,
        "prompt": request_prompt,
        "tools": ["choose_action"],
    }
    try:
        if args.fake_model:
            selected = snapshot["recommendedActionId"]
            result_text = tool.choose(ChooseActionArgs(action_id=selected)).content
            harness_calls: list[dict[str, Any]] = []
        else:
            config = HarnessConfig(
                root=Path(__file__).resolve().parents[1],
                model=args.model,
                system_prompt="You choose exactly one listed Hexdeck action. Call choose_action exactly once.",
                builtin_tools=[],
                max_model_requests=3,
                max_tool_calls=1,
                tool_retries=3,
                request_timeout=args.timeout_seconds,
                extra_body={"reasoning": {"effort": args.effort}},
            )
            result = Harness(config, tools=[tool.spec()]).run_sync(request_prompt)
            result_text = result.text
            harness_calls = result.tool_call_records
        if tool.selected is None:
            raise RuntimeError("The model did not choose an action.")
        output = {
            "schemaVersion": 2,
            "baseRevision": snapshot["baseRevision"],
            "actionId": tool.selected,
            "summary": next(action["summary"] for action in briefing["legalActions"] if action["id"] == tool.selected),
        }
        write_json(Path(args.output), output)
        trace.update({
            "status": "complete",
            "durationSeconds": round(time.monotonic() - started, 3),
            "calls": tool.calls,
            "harnessCalls": harness_calls,
            "result": output,
            "finalText": result_text,
        })
        write_json(Path(args.trace), trace)
        return 0
    except Exception as error:
        trace.update({
            "status": "error",
            "durationSeconds": round(time.monotonic() - started, 3),
            "calls": tool.calls,
            "failure": str(error),
        })
        write_json(Path(args.trace), trace)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
