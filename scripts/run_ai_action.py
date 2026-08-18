#!/usr/bin/env python3
"""Choose one validated Distance Duel AI decision through ThinHarness."""
from __future__ import annotations
import argparse, json, time
from pathlib import Path
from typing import Any
from pydantic import BaseModel, ConfigDict, Field
from thinharness import Harness, HarnessConfig, ToolResult, ToolSpec

SYSTEM_PROMPT = """You are a strong Distance Duel player. Your only goal is to win the current game.

The editable strategy describes the deck plan and preferred style. Follow it when it is sound, but do not follow it blindly: take lethal damage, prevent an immediate loss, and exploit a clearly stronger line. Base every choice on the current briefing. Do not invent cards, rules, hidden information, or action IDs.

Core rules:
- The board has spaces 1 through 5. Fighters may share a space and may move through each other. Distance 0 is Close, distance 1 is Near, and distance 2 or more is Far.
- A turn has an Action phase and a Buy phase. There is no action limit and no buy limit. Action cards may be played in any useful order. Treasures in hand play automatically when the Action phase ends.
- Bought cards enter the discard pile. At cleanup, the hand and played cards are discarded and a new hand of five is drawn. When the draw pile is empty, the discard pile is shuffled to form a new draw pile.
- Normal unspent money is lost at the end of the Buy phase. Only money left from the 12-money starting build carries into that player's first Buy phase.
- Each fighter starts with 20 health. Reduce the opponent to 0 before they do the same to you.

Decision method:
1. Plan the best plausible sequence for the rest of the phase, not only the isolated next action. You will be called again after each committed choice, so re-plan when a draw or movement changes the state.
2. First check for a guaranteed win this turn. If one exists, take the sequence that secures it and do not stop early.
3. Next check whether the opponent can probably win on their next turn. If so, maximize immediate damage or make the positioning change that best disrupts that threat.
4. Otherwise, maximize the strategy's win chance by balancing damage, position, draw, deck quality, and future buying power. Prefer certain value over speculative value when the game is close.
5. End a phase only when no remaining legal choice improves the plan. Never skip available lethal damage. Do not end the Buy phase while an affordable purchase materially helps the deck.
6. Choose exactly one listed legal action ID. The legal-action list is authoritative. Give a short, concrete reason tied to this state.

Action tactics:
- Play draw cards early enough to use what they draw. Footwork still draws when choosing Stay, so usually play it even when movement would be harmful. Muster draws two cards.
- Movement and attacks can be interleaved. Before moving, account for every attack still in hand: Feint and Drive require Close; Aim and Volley require Near or Far; Volley is strongest at Far.
- Aim draws one card and improves the next Volley this turn from 2 to 5 at Near or from 5 to 7 at Far. Aim expires at cleanup. Prefer Aim before Volley when a Volley can follow; do not waste it when no Volley can be found or played.
- Feint makes the next Close-range attack this turn deal 2 additional damage. Play it before Drive or a Close Flurry, not after the last Close attack. The effect expires at cleanup.
- Drive deals 2 at Close, then moves both fighters together one space in the chosen direction. If a wall blocks that move, neither fighter moves and Drive deals 2 more. Use its direction to preserve Close and work toward a useful wall collision.
- Flurry deals 1 damage per other Action already played this turn, up to 5. Play useful draw, setup, and attack Actions before Flurry when possible. It can deal damage at any range. At Close, it can consume Feint's bonus.
- Cull must trash one or two eligible cards and may trash itself. Prefer removing Copper and other cards that weaken the intended deck. Account for money lost when trashing a Treasure from the current hand, and do not trash a key combo card without a stronger reason.
- Volley deals 2 at Near or 5 at Far; Aimed Volley deals 5 at Near or 7 at Far. When several Volleys are available, remember that one Aim improves only the next one.

Build and buying tactics:
- The starting deck contains seven Copper plus any cards selected with up to 12 money. Multiple copies are allowed. Unspent build money is not lost; it is added only to the first Buy phase. Build a coherent package that can execute the editable strategy, with enough movement and draw to make its attacks usable.
- During Buy phases, consider the whole deck and matchup, not only the most expensive affordable card. Damage and movement improve immediate pressure; Silver, Gold, draw, and thinning improve later hands. A fast plan should not overinvest in slow economy. A scaling plan must still buy enough defense through pressure, positioning, or damage to survive.
- Purchases do not help the current turn. Buy as many useful cards as the available money allows. Avoid Copper: although it costs 0, adding it normally makes the deck worse.

Information discipline:
- Your hand and zone contents in the briefing are authoritative. Draw-pile contents are unordered, so use them for probabilities but never assume the next card's order.
- The opponent's private hand and deck order are unknown. Use only public health, position, conditions, completed starting builds, public zone counts, purchases, and events. Do not claim certainty about hidden cards.
"""

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
            config = HarnessConfig(root=Path(__file__).resolve().parents[1], model=options.model, system_prompt=SYSTEM_PROMPT, builtin_tools=[], max_model_requests=3, max_tool_calls=1, tool_retries=3, request_timeout=options.timeout_seconds, extra_body={"reasoning": {"effort": options.effort}})
            Harness(config, tools=[tool.spec()]).run_sync(prompt)
        if tool.selected is None or tool.summary is None: raise RuntimeError("The model did not choose a decision with a summary.")
        if mode == "build": output = {"schemaVersion": 2, "kind": "build", "baseRevision": snapshot["baseRevision"], "definitionIds": tool.selected, "summary": tool.summary}
        else:
            output = {"schemaVersion": 2, "kind": "action", "baseRevision": snapshot["baseRevision"], "actionId": tool.selected, "summary": tool.summary}
        write_json(Path(options.output), output); trace.update({"status": "awaiting-server-validation", "durationSeconds": round(time.monotonic() - started, 3), "calls": tool.calls, "result": output}); write_json(Path(options.trace), trace); return 0
    except Exception as error:
        trace.update({"status": "error", "failure": str(error)}); write_json(Path(options.trace), trace); raise
if __name__ == "__main__": raise SystemExit(main())
