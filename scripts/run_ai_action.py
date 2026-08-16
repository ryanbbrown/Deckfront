#!/usr/bin/env python3
"""Choose one validated Distance Duel AI decision through ThinHarness."""
from __future__ import annotations
import argparse, json, time
from pathlib import Path
from typing import Any
from pydantic import BaseModel, ConfigDict, Field
from thinharness import Harness, HarnessConfig, ToolResult, ToolSpec

class ActionArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action_id: str = Field(min_length=1)
    summary: str = Field(min_length=1, max_length=500, description="Short reason for this choice")
class BuildArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    definition_ids: list[str]
    summary: str = Field(min_length=1, max_length=500, description="Short reason for this build")
class DecisionTool:
    def __init__(self, mode: str, briefing: dict[str, Any]):
        self.mode, self.briefing, self.selected, self.summary = mode, briefing, None, None
        self.calls: list[dict[str, Any]] = []
    def choose_action(self, value: ActionArgs) -> ToolResult:
        legal = {a["id"] for a in self.briefing["legalActions"]}; self.calls.append({"tool": "choose_action", "actionId": value.action_id, "summary": value.summary})
        if value.action_id not in legal: return ToolResult(False, "Use one listed action ID.", {"error_type": "UnknownAction", "retry": True})
        self.selected, self.summary = value.action_id, value.summary; return ToolResult(True, "Action accepted. End your response now.")
    def choose_build(self, value: BuildArgs) -> ToolResult:
        costs = {c["id"]: c["cost"] for c in self.briefing["market"]}; self.calls.append({"tool": "choose_build", "count": len(value.definition_ids), "summary": value.summary})
        if any(card not in costs for card in value.definition_ids): return ToolResult(False, "Use only listed card IDs.", {"error_type": "UnknownCard", "retry": True})
        if sum(costs[card] for card in value.definition_ids) > 12: return ToolResult(False, "Build cost exceeds 12.", {"error_type": "OverBudget", "retry": True})
        self.selected, self.summary = value.definition_ids, value.summary; return ToolResult(True, "Build accepted. End your response now.")
    def spec(self) -> ToolSpec:
        if self.mode == "build": return ToolSpec("choose_build", "Choose the full starting build within 12 money.", BuildArgs, self.choose_build, max_retries=3, sequential=True)
        return ToolSpec("choose_action", "Choose exactly one listed action.", ActionArgs, self.choose_action, max_retries=3, sequential=True)

def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True); temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8"); temporary.replace(path)
def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    for name in ["snapshot", "strategy", "output", "trace"]: parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--model", default="openai:gpt-5.6-luna"); parser.add_argument("--effort", default="low"); parser.add_argument("--timeout-seconds", type=int, default=240); parser.add_argument("--fake-model", action="store_true")
    return parser.parse_args()
def main() -> int:
    options = args(); snapshot = json.loads(Path(options.snapshot).read_text()); strategy = Path(options.strategy).read_text(); mode = snapshot["mode"]
    tool = DecisionTool(mode, snapshot["briefing"]); started = time.monotonic()
    trace: dict[str, Any] = {"schemaVersion": 2, "revision": snapshot["baseRevision"], "turn": snapshot["turn"], "phase": snapshot["phase"], "model": "fake" if options.fake_model else options.model, "effort": options.effort, "strategy": strategy, "legalActions": snapshot["briefing"].get("legalActions", []), "status": "running"}
    try:
        if options.fake_model:
            if mode == "build": tool.choose_build(BuildArgs(definition_ids=snapshot["recommended"], summary=snapshot["recommendedSummary"]))
            else: tool.choose_action(ActionArgs(action_id=snapshot["recommended"], summary=snapshot["recommendedSummary"]))
        else:
            prompt = "Choose one starting build with choose_build and give a short strategic reason." if mode == "build" else "Choose exactly one current action with choose_action and give a short strategic reason."
            prompt += "\nEditable strategy:\n" + strategy + "\nBriefing:\n" + json.dumps(snapshot["briefing"], separators=(",", ":"))
            config = HarnessConfig(root=Path(__file__).resolve().parents[1], model=options.model, system_prompt="Play Distance Duel using exactly one provided tool call.", builtin_tools=[], max_model_requests=3, max_tool_calls=1, tool_retries=3, request_timeout=options.timeout_seconds, extra_body={"reasoning": {"effort": options.effort}})
            Harness(config, tools=[tool.spec()]).run_sync(prompt)
        if tool.selected is None or tool.summary is None: raise RuntimeError("The model did not choose a decision with a summary.")
        if mode == "build": output = {"schemaVersion": 2, "kind": "build", "baseRevision": snapshot["baseRevision"], "definitionIds": tool.selected, "summary": tool.summary}
        else:
            output = {"schemaVersion": 2, "kind": "action", "baseRevision": snapshot["baseRevision"], "actionId": tool.selected, "summary": tool.summary}
        write_json(Path(options.output), output); trace.update({"status": "awaiting-server-validation", "durationSeconds": round(time.monotonic() - started, 3), "calls": tool.calls, "result": output}); write_json(Path(options.trace), trace); return 0
    except Exception as error:
        trace.update({"status": "error", "failure": str(error)}); write_json(Path(options.trace), trace); raise
if __name__ == "__main__": raise SystemExit(main())
