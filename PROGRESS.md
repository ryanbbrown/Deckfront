# Balance search progress

## Status

Group 1 (steps 1 and 2) is implemented, reviewed, fixed, and green. Group 2 (steps 3 and 4) is plan-reviewed, revised, and delegated to a writer. Group 3 plan reviews are running.

## Authoritative inputs

- [GOAL.md](GOAL.md)
- [.plans/09-card-list.md](.plans/09-card-list.md)
- [.plans/10-automated-balance-search.md](.plans/10-automated-balance-search.md)

## Workflow

`GOAL.md` sets the workflow: the `implement` skill for delegated changes, and the `review-panel` skill for every review. Panel rounds are grouped, because one plan round and one implementation round for each of the nine steps does not fit the budget.

| Group | Steps | Plan files | Status |
| --- | --- | --- | --- |
| 1 | 1, 2 | [10-1-card-batch.md](.plans/10-1-card-batch.md), [10-2-kingdom-config.md](.plans/10-2-kingdom-config.md) | **Done.** Implemented, reviewed, fixed, green. |
| 2 | 3, 4 | [10-3-match-runner.md](.plans/10-3-match-runner.md), [10-4-strategies-and-action-search.md](.plans/10-4-strategies-and-action-search.md) | Plan reviewed and revised. Writer running. |
| 3 | 5, 6 | [10-5-kingdoms.md](.plans/10-5-kingdoms.md), [10-6-evolution.md](.plans/10-6-evolution.md) | Plan reviewed and revised. |
| 4 | 7, 8 | [10-7-results-and-report.md](.plans/10-7-results-and-report.md), [10-8-profiling.md](.plans/10-8-profiling.md) | Plan reviewed and revised. |

All eight plans have now been through a three-model plan review and rewritten against the findings. 24 reports, 4 synthesis files, 8 revised plans.

Step 9, the native-language port, is outside this goal.

## Current phase

Group 2, steps 3 and 4, delegated to one writer subagent as a single unit against the two revised plans. Pre-implementation SHA for the review round: `b21f465c4fabb3dbf2fecbe1b95e18edbf830227`.

Completion criterion: the 12 checks in the step 3 plan and the 20 checks in the step 4 plan pass, plan 10-4's wall-clock measurement is recorded, and the four verification commands pass.

Retry count: 0.

## Scope exception

`GOAL.md` puts client and server code out of scope. Narrow edits were still required, because without them this work breaks the running browser game rather than only leaving it untested. All were confirmed against the code, not assumed.

1. `src/server/schemas.ts` — add `mana`, `positionChanged`, `pendingChoice`, `kingdomId`, and `startingHealth` to `gameStateSchema`, add the new command variants, and take the fighter health maximum from the state instead of the literal 20. `gameStateSchema` is a non-strict `z.object`, so it strips unknown keys on load, and `src/server/persistence.ts:22` then runs `assertInvariants` on the stripped state. Without this, every request after a reload throws.
2. `src/server/gameService.ts` — line 188 sent `cards: structuredClone(CARDS)`, and `src/client/Game.tsx:114` and `src/client/App.tsx:98` render every entry. All fifteen new cards would have appeared as market and build-picker tiles reading `undefined left`, and the picker would have let a player build one whose command `gameCommandSchema` then rejects on save. Line 37 also needed the new `marketCost` signature.
3. `src/ai/briefing.ts` — same cause, same one-line fix.

Three further server lines were added after the implementation review, all in files the exception already covers: the AI turn recap and the starting-build briefing were reading canonical definitions instead of resolved ones, and `updateHumanBuild` returned HTTP 500 for an off-kingdom build. See [Group 1 review](#group-1-implementation-review).

No redesign and no other client or server change. Recorded as a deliberate deviation from the stated scope.

## Provisional decisions

Recorded under the `GOAL.md` ambiguity rule. Each is the conservative reading and keeps the phase moving.

1. **Cull is an always-available card, not a kingdom pile.** The design document says kingdom 1 has eight market piles and lists eight cards without Cull, and separately says Cull is available in every kingdom. Treating Cull like the treasures keeps both statements true. Each kingdom offers its own piles, plus Cull at 10, plus three treasures.
2. **Two duel kingdoms.** Today's browser market includes Cull and excludes Adapt. The design document's kingdom 1 swaps them. They cannot share an id. `distance-duel` is the browser default and reproduces today's supply exactly; `current-duel` is experiment kingdom 1 and arrives in step 5.
3. **`schemaVersion` stays 8**, made safe by the scope exception above rather than by hoping the dropped fields are harmless.
4. **The kingdom lives in a module registry, keyed by `GameState.kingdomId`.** Holding a resolved card library in `GameState` would make every clone in the action search copy it. Threading a kingdom argument through every engine function would change client and server call sites, which the scope forbids.
5. **Starting builds are limited to the kingdom's cards.** `submitBuild` accepts any card in `CARDS` today. With twenty-six cards implemented, that would let a player build a card the kingdom does not sell.
6. **The Exposed bonus stays tunable through the `feint` card.** `src/game/engine.ts:133` reads `feint.values.bonus` even in a kingdom with no Feint pile. That is the only tuning point for the bonus, and step 6 mutates overrides rather than piles, so it is deliberate. Removing Feint from a kingdom does not remove a Feint override's effect.
7. **An overflowed match is excluded from scoring, not paid 0.5.** `MatchResult` gains a distinct `aborted` outcome rather than reusing `draw`, so a strategy cannot earn half a point for blowing the state limit.

## Review rounds

| Round | Mode | Target | Result |
| --- | --- | --- | --- |
| v1 | plan | `.plans/10-1-card-batch.md` | Changes requested by all three. 12 decisions, synthesis written, plan revised. |
| v1 | plan | `.plans/10-2-kingdom-config.md` | Changes requested by all three. 10 decisions, synthesis written, plan revised. |
| v1 | implementation | steps 1 and 2, base `d8e6ddb` | Changes requested by both reviewers that ran. 8 findings fixed, 2 recorded, 1 declined. GLM failed to start. |
| v1 | plan | `.plans/10-3-match-runner.md` | Changes requested by all three. 13 decisions, plan rewritten. |
| v1 | plan | `.plans/10-4-strategies-and-action-search.md` | Changes requested by all three. 16 decisions, plan rewritten. |
| v1 | plan | `.plans/10-5-kingdoms.md` | Changes requested by all three. 11 decisions, plan rewritten. |
| v1 | plan | `.plans/10-6-evolution.md` | Changes requested by all three. 13 decisions, plan rewritten. |
| v1 | plan | `.plans/10-7-results-and-report.md` | Changes requested by all three. 14 decisions, plan rewritten. |
| v1 | plan | `.plans/10-8-profiling.md` | Changes requested by all three. 8 decisions, plan rewritten. |

### Findings that changed the group 3 and 4 plans

Three would have cost the whole goal, and each was confirmed by arithmetic or by reading the code.

- **The one hard gate could not be computed, and would then have failed for the right behaviour.** The rigged-melee check reads "actual purchases" from a tournament result that carried no purchase data, and nothing produced the seat-to-strategy mapping needed to build it. Worse, Heavy Blow costs 3 in that kingdom, so a strong melee leader can put three copies in its 12-money starting build and buy none — and a starting build is not a purchase. The gate would have reported a blocker for exactly the behaviour it exists to confirm, and `GOAL.md` forbids tuning it to pass. The check now counts **acquisition**, and "final leaders" is the last generation only, because the wider reading makes the 80 percent branch arithmetically unreachable.
- **The final tournament nearly doubled the run.** Retaining every leader gives ~165 entrants — 13,530 pairs × 25 seeds × 4 games ≈ 1.35M matches, against ≈1.6M for all 32 generations. Now one retained leader per generation: ≈42 entrants, ≈86k matches, about 5 percent. `roundRobin` also gained a deadline, so a run that stops cleanly cannot then enter an unbounded tournament.
- **Smoke and full runs shared an output directory**, so the full run would have overwritten the committed smoke `report.md` for that kingdom — the evidence `GOAL.md` asks for. Output is now `.experiments/<kingdom>/<mode>/`.

Two more, both interactions between decisions made in different plans:

- Suppressing events inside the action search would have zeroed `cardsDrawn`, which reads `draw` events, silently changing which actions the search picks. The search-mode apply keeps a counter.
- Draining `events` is ruled out: `invariants.ts:46` requires `event.sequence === index`, and `record` derives the sequence from `events.length`.

Also corrected: two step 4 baseline builds named `step`, which is deliberately in no kingdom, so they would have repaired away everywhere; and the starting-build repair rule differed between steps 4 and 6, so a mutated build would have been repaired one way at mutation time and another at match time — meaning the strategy recorded in the results was not the one that played.

Reviewers: Codex `gpt-5.6-sol`, Claude Opus 5, GLM 5p2. Synthesis files under `.reviews/`.

### Findings that changed the group 1 plans

Each was verified against the code before acceptance.

- **Flurry needs a Close gate.** `.plans/09-card-list.md:19` says "At Close"; the engine had no gate. This breaks `test/server-distance-duel.test.ts:96,110`, which runs in `npm test`.
- **`resolveDiscard` would have been misrouted.** `execute` dispatched on `'cardInstanceId' in command`, so a resolve command carrying that field would have gone through `playCard` and corrupted Flurry counts. It now dispatches on `command.type`, and the resolve commands use distinct field names.
- **Reclaim's own draw can destroy its target.** `draw` reshuffles the whole discard pile when the draw pile is empty. Reclaim now resolves through `pendingChoice` like Prism, which removes the case instead of defining a rule for it.
- **Feint's +2 was going to stay a literal.** The bonus is applied inside `dealDamage`, not in the Feint case, so `feint.values.bonus` would have been dead and a step 2 override of Feint a silent no-op.
- **`marketCost` cannot see overrides.** It took no state and gates the 12-money build.
- **A cycle risk** between `schema.ts` and `effects.ts` over the value-key map, resolved by the leaf module `src/game/values.ts`.
- **The old check 18 was tautological.** `replayCommands` calls `applyCommand`, so comparing them has no independent oracle.

### Group 1 implementation review

Both reviewers verified the batch itself as correct — 15 cards, the 3 corrections, the effect table, mana, pending choices, the registry, overrides, the memo, and the freeze policy all match the plans. Every defect was in a caller. Fixed in `2bf6d8c`:

| Finding | Fix |
| --- | --- |
| The `ranged-setup` fake AI build cost 14 after Footwork moved to cost 3, and `src/client/App.tsx:31` defaults to that preset, so the shipped default AI game threw. The test that caught it had been retargeted to another preset. | Build is `['footwork','aim','volley']` (11); preset text corrected; the test is back on `ranged-setup`. |
| Canonical `values` was mutable — `config.ts` froze each card only at the top level, and `resolveCard` returns that object directly when no override exists, so one write changed every game. Raised by both reviewers on both plans. | `freezeCard` freezes `values` before the card. |
| AI turn recaps read canonical definitions, so an overridden treasure or cost was reported wrong. | Three call sites route through `resolveCard`. |
| `buildAiStartingBuildBriefing` defaulted its kingdom, and the only caller passed nothing, so a non-default kingdom briefed the AI with the wrong market. | Parameter is required; the caller passes `record.state.kingdomId`. |
| An off-kingdom build reached `submitBuild` and surfaced as HTTP 500. | `updateHumanBuild` raises `BadBuildError`. |
| `chooseFakeAction` deadlocked while a choice was pending. | Pending choices take the first legal action. |
| `resolveRecover` bypassed `advanceChoice`. | It now uses it. |
| An unreachable `TREASURE_IDS` branch made a kingdom test pass for the wrong reason. | Branch dropped. |

Declined: making `values` an action/treasure discriminated union. It would touch every call site to replace a guard `src/game/schema.ts` already enforces at load and `test/cards.test.ts` already covers.

Disputed and resolved against a reviewer: GLM called the `mirrored` reflection sound. It is not. Reflecting both fighters about centre space 3 yields an isomorphic board — ochre still sits one space from a back wall, indigo still on centre — so it cancels no seat advantage and only relabels directions. The option is now `swapSides`, which **exchanges** the positions.

## Known stale e2e assertions

`GOAL.md` puts Playwright tests out of scope and forbids running them, so these are recorded rather than fixed. Unlike the scope exception above, the consequence is a stale test, not a live break.

| Test | Line | Cause | Correct expectation |
| --- | --- | --- | --- |
| `DD-E2E-031` | `test/e2e/distance-duel.spec.ts:224` | Footwork costs 3, seeded money is 2 | Seed 3 money |
| `DD-E2E-009` | `:103` | Aimed Far Volley is 6, not 7 | 14 health |
| `DD-E2E-012` | `:121` | Far Volley is 4, not 5, so it no longer kills at 5 health | Seed 4 health |
| `DD-E2E-007` | `:89-92` | Flurry now gates on Close and Muster is no longer Tactical, so the Far Flurry line is illegal | Rewrite the case at Close |

Also deferred: `src/client/Game.tsx:51` has no branch for the new `direction`, `discard`, or `recover` selections. Unreachable while `distance-duel` sells none of those cards, and the client is out of scope.

## Completed

- Product card decisions, five kingdoms, search design, run limits, and unattended guardrails recorded.
- Superseded documents moved to [.plans/archive/](.plans/archive/).
- Detailed plans written for all eight in-scope steps.
- Group 1 plan review, revision, implementation, implementation review, and fixes. **Steps 1 and 2 are done.**
- Group 2 plan review and revision. Both plans rewritten against 29 accepted decisions.

## Evidence

- **Baseline** at `2428e70`, before any change: `npm test` 49 passed, 1 skipped. Typecheck, lint, build clean.
- **Steps 1 and 2** at `2bf6d8c`, after the review fixes: `npm test` **89 passed, 1 skipped**. `npm run typecheck`, `npm run lint`, `npm run build` all clean.
- Commits: `18ba526`, `7773705`, `084f57c` (writer), `2bf6d8c` (review fixes), `b21f465` (group 2 plan revisions).
- Review outputs and synthesis files under `.reviews/plans/` and `.reviews/implementations/`.

`084f57c` repaired a literal NUL byte the writer left in `src/game/kingdom.ts`, which made the file binary to Git and would have hidden it from the review diff. Behaviour was unchanged.

## Blockers

None. GLM failed to start on both group 1 implementation rounds; Codex and Claude both produced reports, so the round was not re-run.

## Next action

Wait for the steps 3 and 4 writer, then run an implementation-mode panel round against base `b21f465c4fabb3dbf2fecbe1b95e18edbf830227`. Read the group 3 plan reports as they land and revise `.plans/10-5` and `.plans/10-6`.
