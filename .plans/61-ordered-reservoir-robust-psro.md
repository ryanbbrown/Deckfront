# Ordered-reservoir robust PSRO

## Goal

Close three Kingdom 009 lotteries using only the validated final ordered 20,000-strategy reservoir. Then audit each final lottery with all five historical fixed-reservoir v1 pools and explain every confirmed historical attacker.

This experiment does not generate or goldfish-score strategies. It does not admit historical strategies into an ordered matrix.

## Frozen inputs and game protocol

- Ordered source: `.experiments/ordered-goldfish-product/native-e760135dba6f-5625a0ff0bf6048653f9`.
- Validate `ranked.json` and its exact 20,000-entry `reservoir.json` prefix with the ordered-product validator.
- Historical audit sources: the five read-only Kingdom 009 `fixed-reservoir-psro-v1` pools.
- Use evaluation seeds 9,100,009, 9,200,009, and 9,300,009.
- Start each ordered run with the top 50 strategies.
- Use 25 matrix blocks, draft off, 50 health, the existing action and turn caps, and four pairing workers.
- Race through the score-only pairing path. Matrix cells keep full evidence.

## Search and closure

Every ordinary and closure scan runs two independent cumulative races over all ordered-reservoir strategies outside the active matrix.

1. Each pass allocates fresh stages of 1, 2, 4, and 8 blocks.
2. Rank survivors on all blocks seen in that pass.
3. Keep `n <= 3 ? 1 : max(3, ceil(n / 3))` after each stage.
4. Union up to eight finalists from each pass by canonical strategy, for at most 16 finalists.
5. Confirm the union on one fresh 400-block schedule.
6. Admit every finalist whose bootstrap 95% lower bound is above 50%.

After two clean ordinary scans, run a mandatory closure scan with a separate seed phase. A closure admission refills the matrix, resets the clean streak, and resumes ordinary scans. Finish only when a closure scan is clean against the same matrix and lottery snapshot. Stop incomplete after 32 ordinary scans or four closure-admission cycles.

## Seeds, checkpoints, and validation

- Derive every matrix, ordinary, closure, audit, and analog seed from the ordered reservoir hash, evaluation seed, complete namespace label, and index.
- Seed derivation does not depend on execution or resume order. All namespaces in one suite are disjoint.
- Write an atomic checkpoint after the initial matrix and after every completed scan plus matrix refill.
- Resume from the last deeply valid checkpoint. Rerun an interrupted scan with the same seeds.
- Validation recomputes source identity, rules and matrix protocol, matrix cells, equilibrium, scan ranks and survivors, finalist union, bootstrap intervals, admissions, state transitions, caps, and next phase.
- A valid final run contains only strategies from the ordered 20,000 pool.

## Historical audit

For each of the three final ordered lotteries, independently scan all five historical pools with the same two-pass cumulative union race and 400-block confirmation.

- Exclude historical strategies already active in the target matrix.
- Never add a historical strategy to the ordered matrix.
- Save the strongest confirmed historical counter, all confirmed finalists, exact scan coverage, seeds, and evidence.
- Report support identity, Jaccard similarity, and lottery total-variation distance across the three ordered runs. Whole-lottery cross-play is optional.

## Generation diagnostics

For every confirmed historical attacker:

- Print the readable starting build and purchase plan.
- Check exact membership in the 12,972,960-strategy ordered five-rung space: empty starting build, exactly five distinct legal cards, finite buys only, first three counts from 1 through 4, last two counts equal to 3, and total count at most 15.
- If representable, report candidate index and traversal position.
- Stream the split 500,000-record ranked artifact to report stage-one rank, final rank, and top-20,000 membership without loading all ranked records.
- If absent, report every violated constraint. Build deterministic order-preserving representable analogs, including finite replacements for count 99, and prefer the best ranked sensible analog.
- Test the selected analog directly against the same final ordered lottery on a fresh 400-block schedule. Do not rescore the complete candidate space.
- Record card mechanics from game data. Use acquisition telemetry only when saved pairing evidence supplies it; otherwise state that the score-only audit has no acquisition evidence.

## Commands and outputs

Add run, status, and report commands. Store ignored checkpoints and reports under:

`.experiments/ordered-reservoir-robust-psro/ordered-reservoir-robust-v1/`

Do not create `.plans/62-ordered-reservoir-robust-psro-results.md` until production finishes.

## Tests and verification

Tests must prove cumulative two-pass union behavior, independent deterministic namespaces, resume and cap transitions, deep artifact rejection, exact ordered-space diagnostics, nearest analog construction, split-ranked lookup, and audit-only historical strategies.

Before handoff, run focused tests, the full test suite, typecheck, lint, build, `build:sim`, and `git diff --check`. Do not run production.
