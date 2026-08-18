# Goal

Build the first automated balance-search system for Hexdeck and run its five curated kingdoms.

## Authoritative decisions

Read these before planning or changing code:

- [.plans/09-card-list.md](.plans/09-card-list.md): card scope, rules, values, and Tactical Action classification.
- [.plans/10-automated-balance-search.md](.plans/10-automated-balance-search.md): simulation design, five kingdoms, search method, limits, and expected results.
- [AGENTS.md](AGENTS.md): project workflow and verification rules.

These documents contain the approved product decisions. Implementation work may not rebalance cards, change kingdoms, or add strategy restrictions.

Everything in [.plans/archive/](.plans/archive/) is superseded. Do not read it for decisions. Older numbered plans describe the shipped browser game, not this goal.

On a genuine product ambiguity: record it in `PROGRESS.md`, choose the most conservative option that keeps the phase moving, and mark the choice as provisional. Stop only when no option is safe.

## Required result

The repository must contain:

- every card in the first implementation batch, with game-module test coverage appropriate to its behavior;
- configurable kingdoms, starting health, and per-experiment numeric card overrides;
- a deterministic headless match runner with a turn limit and useful telemetry;
- readable strategies containing a starting build, buy agenda, and action preferences;
- deterministic full Action-phase search with its programmatic behavior checks;
- fixed baseline strategies;
- population evolution, several leaders, retained earlier leaders, and a final round-robin tournament;
- the five approved kingdoms;
- machine-readable experiment output and a concise Markdown report;
- smoke-run results for all five kingdoms;
- a capped full run when measured throughput permits it.

Rigged melee must pass the calibration check in `.plans/10-automated-balance-search.md`. Other kingdom results are findings and must not be forced to match a preferred balance result.

## Scope

This goal is backend only. It does not change the browser client, and it does not use generative AI at run time.

Out of scope:

- client, server, and browser code;
- Playwright tests, the e2e coverage manifest, and live-AI tests;
- `cproxy`, Codex, and any model bridge.

New cards do not need browser coverage in this goal. The e2e coverage manifest will not list them, and that is accepted.

## Verification

Run these commands, and only these:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Do not run `npm run test:e2e`, `npm run test:e2e:manifest`, or `npm run test:ai:live`. They need a browser, a network model, or a Codex login, and they do not cover this goal.

## Execution

Act as the orchestrator. For each numbered implementation step in `.plans/10-automated-balance-search.md`:

1. Inspect the current code and write a short phase brief in `PROGRESS.md` with its interface, files, checks, and completion criterion.
2. Delegate substantial implementation to one writer subagent.
3. Delegate independent review to a fresh subagent after the implementation snapshot is stable.
4. Apply or delegate required fixes.
5. Run the phase checks and relevant project verification.
6. Update `PROGRESS.md` with exact evidence and the next step.

Keep one writer for the same working tree at a time. Preserve unrelated existing changes. Prefer the smallest implementation that meets the approved design. Use existing project dependencies before adding one.

## Guardrails

- Simulation and search code lives in `src/sim/` and does not import client or server code.
- TypeScript is the reference implementation for this goal.
- Profile before optimizing. A native-language port is outside this goal.
- Use deterministic search and evolution, not generative AI or neural networks.
- Use only the five curated kingdoms. Random kingdom generation is outside this goal.
- Preserve partial experiment output when a run reaches a time or generation limit.
- Mark action-search overflow as an explicit failure or result. Do not silently choose an approximate action.
- Use the run limits in `.plans/10-automated-balance-search.md`. The unattended run may lower a measured workload but may not increase the limits.
- Stop after three failed repair attempts for the same acceptance check. Record the blocker, evidence, and attempted fixes in `PROGRESS.md`.
- A dependent phase does not start while its prerequisite is red.
- Do not weaken, delete, skip, or rewrite a failing acceptance check to make it pass.

## Completion

The goal is complete when:

- the required result exists;
- Rigged melee passes its calibration check;
- deterministic and action-search checks pass;
- the four verification commands above pass;
- `PROGRESS.md` links the final outputs and records actual experiment limits, verification commands, results, and residual risks.

## Budget

Eight hours covers the complete goal: implementation, review, verification, the search runs, and the report. It is not a separate experiment budget.

Size the full search run from measured throughput after the smoke run, and leave at least 45 minutes for final verification and reporting. If the budget ends first, finish with verified code, preserved partial results, and a precise continuation point in `PROGRESS.md`.
