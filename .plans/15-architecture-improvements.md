# Architecture improvements

## Status

Reviewed proposal. Do not implement it without user approval.

This document replaces the recommendations in the temporary architecture HTML report. It incorporates the Codex, Claude, and GLM review-panel findings from round `v1`.

## Goal

Reduce real interface leakage and dependency friction without disturbing measured simulator performance or removing useful test seams.

## Recommended order

1. Break the CLI and experiment dependency cycle.
2. Project browser actions at the server seam.
3. Consider the two narrow shared-rule improvements.
4. Leave match telemetry and simulator cache ownership unchanged.

Each numbered change is separate. Verify and review one change before starting the next.

## 1. Break the CLI and experiment dependency cycle

### Decision

Do this first. All reviewers agreed that the cycle is real and the narrow fix is low risk.

`src/sim/cli.ts` imports `runExperiment` from `src/sim/experiment.ts`. The experiment module imports `ExperimentOptions`, `TURN_LIMIT_PER_PLAYER`, and `ACTION_CAP_PER_TURN` from the CLI module. This creates a runtime cycle because the imported limits are values, not only types.

### Required change

- Move `ExperimentOptions`, `TURN_LIMIT_PER_PLAYER`, and `ACTION_CAP_PER_TURN` to an experiment-owned configuration module or into `experiment.ts`.
- Keep argument parsing, CLI defaults, maxima, output, and the executable entry block in `cli.ts`.
- Keep dependency direction one-way: CLI adapter to experiment module.
- Keep the `PairingRunner` seam. `InlinePairingRunner` and `WorkerPairingRunner` are two real adapters.
- Preserve controlled experiment tests. Do not remove the `evolve` or `roundRobin` test seams unless a smaller seam preserves every current orchestration test.

### Completion criteria

- `experiment.ts` does not import `cli.ts`.
- CLI behavior and defaults do not change.
- Tests still cover early `run.json` output, recorded failures, deadline truncation, entrant selection, calibration refusal, and runner shutdown.
- The compiled worker bundle still behaves like the inline runner.

## 2. Project browser actions at the server seam

### Decision

Plan this next. All reviewers agreed with the diagnosis. This has the highest architectural value and a medium-to-high change cost.

`GameView` sends both `LegalAction[]` and `ActionAvailability[]` over HTTP. Each legal action includes the full `GameCommand` replay protocol. The browser joins the two collections by card instance ID and switches on command types, although requests send only an action ID.

### Required change

- Keep `GameCommand` inside the game, replay, and persistence implementation.
- Make the server-side game-view projection own browser action presentation.
- Send renderable card choices, phase choices, buy choices, disabled reasons, selection data, and action IDs.
- Remove browser logic that joins legal actions to availability or interprets replay command variants.
- Keep action execution requests ID-based.
- Decide and record whether the changed `GameView` requires a schema increment before implementation. There is no compatibility requirement, but the schema value must describe the current format accurately.

### Required coverage

Preserve coverage for:

- disabled card reason text;
- movement choices and labels;
- Cull target eligibility and one-or-two-card selection;
- Action and Buy phase completion;
- market purchases by definition ID;
- stale action rejection;
- replay and undo; and
- browser-server E2E flows and manifest entries.

### Completion criteria

- `src/client/` does not import or inspect `GameCommand` or `LegalAction.command`.
- The browser receives one coherent action presentation.
- Engine commands remain available to persistence and replay.
- HTTP, server, client, and E2E checks pass.

## 3. Narrow shared improvements

These are independent candidates. Keep them small.

### 3.1 Share scoring arithmetic, not competition policy

Evolution and tournament repeat some score-total and `ScoredStrategy` construction logic. Their policies differ: evolution records only the candidate side, while tournament records both sides and mirrored pair records.

If the repeated arithmetic continues to cause friction:

- move `compareScored` out of `evolution.ts` so tournament does not import an evolution implementation detail;
- share only tally-to-`ScoredStrategy` conversion and other identical arithmetic;
- keep candidate-only and both-sides policy in their current modules; and
- do not add a configuration switch that hides which side is recorded.

This is `Worth exploring`, not a required refactor. The shared implementation must stay deeper than its interface.

### 3.2 Replace direct effect reads with semantic game queries

The simulator directly reads `EFFECTS` for tactical classification and range gates. This leaks game implementation across the seam.

Start only with the low-risk slice:

- use the existing game-owned tactical classification instead of reading `EFFECTS[...].tactical` in simulator modules; and
- add a game-owned semantic query for range legality only if it removes repeated gate interpretation without widening the interface.

Keep these constraints:

- simulator caches stay in `src/sim/`;
- game code does not import simulator code;
- `kingdomEpoch()` remains until a proven replacement preserves cache invalidation;
- the indexed memo key and `applyLegalAction` fast path remain; and
- measure search performance before and after any hot-path change, as required by `.plans/11-search-performance.md`.

## Deferred recommendations

### Match telemetry collapse

Do not merge `telemetry.ts` into `match.ts` now.

The module has one production caller, but it owns cohesive event attribution, dead-draw classification, purchase totals, victory timing, and final-health behavior. Its focused synthetic tests cover cases that are difficult to create through `runMatch`. The panel did not agree that deletion would improve depth.

Revisit only when a concrete change shows that timing bugs span both modules or that the telemetry interface blocks needed work.

### Kingdom and simulator cache consolidation

Do not move simulator caches into the game module.

The epoch protocol is explicit, and the caches contain simulator-specific build probes, mutation facts, and memo indexes. Moving them would weaken dependency direction and risk the measured search path. Semantic game queries can reduce rule leakage without changing cache ownership.

## Verification

For each approved change, run the smallest focused tests first. Before completion, run:

```sh
npm run build:sim
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

For any change to search, mutation, match telemetry, card lookup, or action application, also run the documented search benchmark and compare it with the current baseline.

## Review evidence

The local review-panel reports are:

- `.reviews/custom/architecture-suggestions/architecture-suggestions-codex-v1.md`
- `.reviews/custom/architecture-suggestions/architecture-suggestions-claude-v1.md`
- `.reviews/custom/architecture-suggestions/architecture-suggestions-glm-5p2-v1.md`
- `.reviews/custom/architecture-suggestions/architecture-suggestions-manifest-v1.md`
