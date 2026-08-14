#!/usr/bin/env python3
"""Run one Hexdeck opponent turn through ThinHarness and constrained preview tools."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from thinharness import Harness, HarnessConfig, ToolResult, ToolSpec

ROOT = Path(__file__).resolve().parents[1]
PREVIEW_CLI = ROOT / "src" / "ai" / "previewCli.ts"
TSX = ROOT / "node_modules" / ".bin" / "tsx"


class TakeActionArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action_id: str = Field(min_length=1, description="An exact id from the current legalActions list")


class EmptyArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BuyCardArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    card_id: str = Field(min_length=1, description="An exact id from the current affordableCards list")


class TurnTools:
    def __init__(self, session_path: Path, tool_retries: int):
        self.session_path = session_path
        self.tool_retries = tool_retries
        self.latest: dict[str, Any] | None = None
        self.committed: dict[str, Any] | None = None
        self.calls: list[dict[str, Any]] = []

    def specs(self) -> list[ToolSpec]:
        return [
            ToolSpec(
                "take_action",
                "Apply one exact current legal board action. Use fresh action ids after every call.",
                TakeActionArgs,
                self.take_action,
                max_retries=self.tool_retries,
                sequential=True,
            ),
            ToolSpec(
                "undo_action",
                "Undo the most recent preview command. This does not change the saved match.",
                EmptyArgs,
                self.undo_action,
                max_retries=self.tool_retries,
                sequential=True,
            ),
            ToolSpec(
                "restart_turn",
                "Restore the complete AI turn preview to its starting state.",
                EmptyArgs,
                self.restart_turn,
                max_retries=self.tool_retries,
                sequential=True,
            ),
            ToolSpec(
                "enter_buy_phase",
                "Close board actions and auto-play treasures. Rejected after a missed point or a board-action pass.",
                EmptyArgs,
                self.enter_buy_phase,
                max_retries=self.tool_retries,
                sequential=True,
            ),
            ToolSpec(
                "buy_card",
                "Buy one exact affordable card id. The card enters discard.",
                BuyCardArgs,
                self.buy_card,
                max_retries=self.tool_retries,
                sequential=True,
            ),
            ToolSpec(
                "skip_buy",
                "Explicitly decline the purchase after entering the buy phase.",
                EmptyArgs,
                self.skip_buy,
                max_retries=self.tool_retries,
                sequential=True,
            ),
            ToolSpec(
                "commit_turn",
                "Validate and finish the complete turn. Call only after buying or skipping the purchase.",
                EmptyArgs,
                self.commit_turn,
                max_retries=self.tool_retries,
                sequential=True,
            ),
        ]

    def take_action(self, submitted: TakeActionArgs) -> ToolResult:
        return self.call("take_action", "take-action", ["--action-id", submitted.action_id])

    def take_best_points(self) -> ToolResult:
        return self.call("take_best_points", "take-best-points")

    def undo_action(self, _submitted: EmptyArgs) -> ToolResult:
        return self.call("undo_action", "undo")

    def restart_turn(self, _submitted: EmptyArgs) -> ToolResult:
        return self.call("restart_turn", "restart")

    def enter_buy_phase(self, _submitted: EmptyArgs) -> ToolResult:
        return self.call("enter_buy_phase", "enter-buy")

    def buy_card(self, submitted: BuyCardArgs) -> ToolResult:
        return self.call("buy_card", "buy", ["--card-id", submitted.card_id])

    def skip_buy(self, _submitted: EmptyArgs) -> ToolResult:
        return self.call("skip_buy", "skip-buy")

    def commit_turn(self, _submitted: EmptyArgs) -> ToolResult:
        result = self.call("commit_turn", "commit")
        if self.latest and self.latest.get("ok") and self.latest.get("committed"):
            self.committed = self.latest
        return result

    def call(self, tool_name: str, operation: str, extra: list[str] | None = None) -> ToolResult:
        response = run_preview(operation, self.session_path, extra or [])
        self.latest = response
        self.calls.append({"tool": tool_name, "operation": operation, "response": response})
        if not response.get("ok"):
            message = f"{response.get('error', 'Preview rejected the tool call.')}\nCurrent state: {compact(response.get('briefing', {}))}"
            return ToolResult(False, message, {"error_type": "InvalidTurnAction", "retry": True})
        return ToolResult(True, compact({
            "status": "committed" if response.get("committed") else "valid",
            "briefing": response.get("briefing", {}),
        }))


def run_preview(operation: str, session_path: Path, extra: list[str] | None = None) -> dict[str, Any]:
    command = [str(TSX), str(PREVIEW_CLI), operation, "--session", str(session_path), *(extra or [])]
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"Preview CLI failed: {(completed.stderr or completed.stdout).strip()}")
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Preview CLI returned invalid JSON: {completed.stdout[-2000:]}") from error


def system_prompt() -> str:
    return "\n".join([
        "Play Hexdeck to win. The first player to push five opposing pieces off the board wins.",
        "A push must move an opposing piece toward the edge. Never move your own piece as a push target.",
        "Take a match-winning action immediately. Score every maximumPointsAvailable point before buying.",
        "A zero-point turn is not permission to pass the board phase.",
        "Use both baseline moves in almost every turn when they are legal.",
        "Skip a baseline move only when it blocks a stronger action or exposes that piece to an immediate ring-out.",
        "First inspect every legal displacement action. Push an enemy outward when that improves edge pressure.",
        "Move your pieces toward useful contact when no immediate push exists.",
        "Keep an attacker behind an enemy so a later push continues toward the edge.",
        "Move an exposed friendly piece away from the edge unless a scoring attack is stronger.",
        "Use action cards to create pressure, extend a push line, escape danger, or protect a useful position.",
        "Before buying, check both friendly pieces, all remaining baseline moves, and every playable action card.",
        "The game engine supplies every legal action. Never invent an action or change an action id.",
        "After each tool call, use only the fresh briefing and legal action ids it returns.",
        "The strategy text guides choices among sound board lines and guides purchases.",
        "Interleave baseline moves and action cards in any legal order.",
        "Enter the buy phase only after completing the strongest available board line.",
        "Then buy or skip and commit the turn.",
        "If a tool rejects the line, use its state feedback. Restart the turn when necessary.",
        "Do not finish with text until commit_turn succeeds.",
    ])


def user_prompt(strategy: str, briefing: dict[str, Any]) -> str:
    return "\n\n".join([
        "Complete exactly one AI turn through the provided tools.",
        "Strategy instructions:\n" + strategy,
        "Initial public and private-to-you briefing:\n" + compact(briefing),
    ])


def run_fake_model(tools: TurnTools, briefing: dict[str, Any]) -> str:
    maximum_points = int(briefing.get("maximumPointsAvailable", 0))
    legal_actions = briefing.get("legalActions", [])
    if maximum_points:
        require_success(tools.take_best_points())
    elif legal_actions:
        require_success(tools.take_action(TakeActionArgs(action_id=legal_actions[0]["id"])))
    require_success(tools.enter_buy_phase(EmptyArgs()))
    current = tools.latest or {}
    affordable = current.get("briefing", {}).get("affordableCards", [])
    if affordable:
        choice = max(affordable, key=lambda card: (int(card.get("cost", 0)), str(card.get("id", ""))))
        require_success(tools.buy_card(BuyCardArgs(card_id=choice["id"])))
    else:
        require_success(tools.skip_buy(EmptyArgs()))
    require_success(tools.commit_turn(EmptyArgs()))
    return "Fake model committed one valid turn."


def require_success(result: ToolResult) -> None:
    if not result.ok:
        raise RuntimeError(result.content)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def compact(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def summarize_turn(committed: dict[str, Any]) -> str:
    commands = committed.get("commands", [])
    briefing = committed.get("briefing", {})
    parts: list[str] = []
    points = int(briefing.get("pointsScoredThisPreview", 0))
    if points:
        suffix = "point" if points == 1 else "points"
        parts.append(f"AI scored {points} {suffix}.")
    moves = sum(command.get("type") == "baselineMove" for command in commands)
    if moves:
        suffix = "move" if moves == 1 else "moves"
        parts.append(f"AI made {moves} baseline {suffix}.")
    cards = [str(command.get("type"))[4:] for command in commands if str(command.get("type", "")).startswith("play")]
    if cards:
        parts.append(f"AI played {', '.join(cards)}.")
    purchase = next((command.get("definitionId") for command in commands if command.get("type") == "buyCard"), None)
    parts.append(f"AI bought {purchase}." if purchase else "AI bought nothing.")
    return " ".join(parts)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one Hexdeck AI turn through ThinHarness.")
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--strategy", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--trace", required=True)
    parser.add_argument("--model", default="openai:gpt-5.6-terra")
    parser.add_argument("--effort", default="medium")
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--tool-retries", type=int, default=5)
    parser.add_argument("--max-model-requests", type=int, default=20)
    parser.add_argument("--max-tool-calls", type=int, default=30)
    parser.add_argument("--fake-model", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    snapshot_path = Path(args.snapshot).resolve()
    session_path = Path(args.session).resolve()
    strategy = Path(args.strategy).read_text(encoding="utf-8")
    init = subprocess.run(
        [str(TSX), str(PREVIEW_CLI), "init", "--snapshot", str(snapshot_path), "--session", str(session_path)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if init.returncode != 0:
        raise RuntimeError(f"Cannot initialize preview: {(init.stderr or init.stdout).strip()}")
    initial = json.loads(init.stdout)
    briefing = initial["briefing"]
    tools = TurnTools(session_path, args.tool_retries)
    prompt = user_prompt(strategy, briefing)
    started = time.monotonic()
    trace: dict[str, Any] = {
        "schemaVersion": 1,
        "model": "fake" if args.fake_model else args.model,
        "effort": args.effort,
        "systemPrompt": system_prompt(),
        "userPrompt": prompt,
        "initialBriefing": briefing,
        "startedAt": time.time(),
    }
    try:
        if args.fake_model:
            final_text = run_fake_model(tools, briefing)
            harness_calls: list[dict[str, Any]] = []
            usage: dict[str, Any] = {}
        else:
            config = HarnessConfig(
                root=ROOT,
                model=args.model,
                system_prompt=system_prompt(),
                builtin_tools=[],
                max_model_requests=args.max_model_requests,
                max_tool_calls=args.max_tool_calls,
                tool_retries=args.tool_retries,
                request_timeout=args.timeout_seconds,
                extra_body={"reasoning": {"effort": args.effort}} if args.model.startswith("openai:") else {},
            )
            result = Harness(config, tools=tools.specs()).run_sync(prompt)
            final_text = result.text
            harness_calls = result.tool_call_records
            usage = vars(result.usage)
        if tools.committed is None:
            raise RuntimeError("The model ended without commit_turn succeeding.")
        output = {
            "schemaVersion": 1,
            "baseRevision": tools.committed["baseRevision"],
            "commands": tools.committed["commands"],
            "summary": summarize_turn(tools.committed),
        }
        write_json(Path(args.output), output)
        trace.update({
            "status": "complete",
            "durationSeconds": round(time.monotonic() - started, 3),
            "toolCalls": tools.calls,
            "harnessToolCalls": harness_calls,
            "usage": usage,
            "finalText": final_text,
            "output": output,
        })
        write_json(Path(args.trace), trace)
        return 0
    except Exception as error:
        trace.update({
            "status": "error",
            "durationSeconds": round(time.monotonic() - started, 3),
            "toolCalls": tools.calls,
            "error": str(error),
        })
        write_json(Path(args.trace), trace)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
