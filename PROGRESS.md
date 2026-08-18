# Balance search progress

## Status

Group 1 planned. Detailed plans for steps 1 and 2 are written and are in plan-mode review. No implementation has begun.

## Authoritative inputs

- [GOAL.md](GOAL.md)
- [.plans/09-card-list.md](.plans/09-card-list.md)
- [.plans/10-automated-balance-search.md](.plans/10-automated-balance-search.md)

## Workflow

`GOAL.md` sets the workflow: the `implement` skill for delegated changes, and the `review-panel` skill for every review. Panel rounds are grouped, because one plan round and one implementation round for each of the nine steps does not fit the budget.

Planned groups:

| Group | Steps | Plan files |
| --- | --- | --- |
| 1 | 1, 2 | `.plans/10-1-card-batch.md`, `.plans/10-2-kingdom-config.md` |
| 2 | 3, 4 | Match runner, telemetry, strategies, baselines, action search |
| 3 | 5, 6 | Five kingdoms, calibration checks, evolution, tournaments |
| 4 | 7, 8 | Results, report, profiling |

## Current phase

Group 1, steps 1 and 2.

### Brief

Interface and state changes, files, checks, and completion criteria are in the two plan files above. Summary:

- Step 1 adds fifteen cards, corrects Footwork's cost, Volley's damage, and Flurry's Tactical Action count, and replaces the engine's per-mechanic `switch` with an effect table in `src/game/effects.ts`.
- Step 2 makes the kingdom, starting health, and numeric card overrides explicit inputs, and removes the hard-coded 20 health from `src/game/state.ts` and `src/game/invariants.ts`.

Completion criterion: the checks listed in both plan files pass, and `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` pass.

Retry count: 0.

## Provisional decisions

Recorded under the `GOAL.md` ambiguity rule. Each keeps the phase moving and is the conservative reading.

1. **Cull is an always-available card, not a kingdom pile.** The design document says kingdom 1 has eight market piles and lists eight cards without Cull, and separately says Cull is available in every kingdom. Treating Cull like the treasures keeps both statements true. Effect: each kingdom offers its own piles, plus Cull, plus three treasures.
2. **`schemaVersion` stays 8.** The new `mana`, `positionChanged`, and `pendingChoice` fields are additive, and no new card enters the browser market. The server's non-strict schema drops them when reloading a saved browser game, which is harmless while no browser card uses them. Bumping the version would require server changes, which the goal puts out of scope.
3. **The kingdom lives in a module registry, keyed by `GameState.kingdomId`.** Holding a resolved card library in `GameState` would make every clone in the action search copy it. The alternative, threading a kingdom argument through every engine function, would change client and server call sites, which the scope forbids.

## Completed

- Product card decisions recorded.
- Five curated kingdoms and their expectations recorded.
- Search design, run limits, and unattended guardrails recorded.
- Superseded documents moved to [.plans/archive/](.plans/archive/): the previous product goal, the card balance workshop, and `KEY_DECISIONS.md`.
- Current code inspected. Client and server coupling to the game module is thin: the client is generic over `LegalAction` and special-cases only Footwork, Drive, and Cull; the server mirrors `GameCommand` in `src/server/schemas.ts` and pins `schemaVersion` 8. Adding new commands and cards therefore needs no client or server change.
- Detailed plans written for steps 1 and 2.

## Evidence

No implementation evidence yet.

## Review rounds

| Round | Mode | Target | Output | Result |
| --- | --- | --- | --- | --- |
| — | — | — | — | Plan-mode round for group 1 not yet started |

## Blockers

None.

## Next action

Run the plan-mode review panel over both group 1 plans, apply the accepted findings, then record the pre-implementation SHA and launch one writer subagent for step 1.
