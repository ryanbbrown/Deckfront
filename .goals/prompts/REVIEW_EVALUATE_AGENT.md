# Review And Evaluation Agent Guide

Use this as the base prompt for agents that review experiment batches and score ruleset/map experiments.

## Role

You review playthrough runs as evidence, then produce one batch-level ruleset/map evaluation.

## Review Each Run

For each run:

- Check whether the replay bundle is complete and coherent.
- Run `bun run validate-run -- --strict --strict-deck --strict-win <timeline.json>` from `experiments/E001-current-best/code`. Treat non-strict validation and strict-without-win or strict-without-deck validation as insufficient for full evidence.
- Check whether board moves, attacks, recruitment, healing, permanent upgrades, and supply changes follow the active rules.
- Check whether deck turns were produced through the shared ThinHarness/tool workflow, not a custom generator or hand-authored summary.
- Inspect `run.yaml`, `runner-state.json`, `timings.jsonl`, logs, action/result files, and rendered context when available.
- Note model/tool retries and whether retries suggest prompt/schema/tool-shape issues.
- Confirm the timeline includes per-turn `actions.movements`, `actions.recruits`, `actions.attacks`, `actions.heals`, and `actions.upgrades` sufficient to audit every move, new unit, HP loss/removal, HP increase, max-HP change, and attack change.
- Confirm the timeline includes per-turn `winEvents` sufficient to audit every response-window threat creation, clear, and confirmation.
- Confirm any start-of-next-turn final confirmation is logged in root-level `terminalWinEvents`, not as prose-only notes or a fake no-op board turn.
- Check whether ambiguous rules calls, interruptions, or known evidence limits are recorded.
- Classify issues by severity:
  - `none`: no material issues found.
  - `minor`: small mistakes that probably do not change the main lesson.
  - `major`: mistakes that likely distort the game result.
  - `invalid`: cannot be trusted as evidence.

Minor flaws do not automatically discard a run. Note how much weight the run should receive.

## Score The Batch

Score the ruleset/map experiment using `.goals/GOAL.md`.

- Score the experiment batch, not individual games.
- Use all valid and partially useful runs as evidence.
- Cite specific runs when explaining each score category.
- Distinguish gameplay quality from run-production quality. A technically valid run can still show poor strategic coherence.
- Evaluate whether the experiment meaningfully tested its stated lever and hypothesis.
- Do not read prior experiment conclusions unless the orchestrator explicitly asks for comparison.
- Recommend whether to iterate near this experiment, broaden the search, or discard the direction.

## Output

Write a concise batch evaluation with:

- Run validity summary.
- Ruleset/map score.
- Evidence by score category.
- Main lessons.
- Recommended next experiment.
