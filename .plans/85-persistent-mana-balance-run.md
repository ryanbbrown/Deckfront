# Persistent mana balance run

## Objective

Apply the approved card rules, run the existing eight-kingdom smoke, and continue to a fresh 30-kingdom run only if the smoke has no extreme result such as Mage exceeding 50% equilibrium-weighted archetype share.

## Rules

- Mana persists between turns. At the end of each turn, reduce mana above 3 to 3. Mana can exceed 3 during the current turn.
- Focus stays at cost 1 and gains 1 mana. Remove its draw.
- Overload stays at cost 5 and deals 3 damage per mana spent this turn.
- Volley costs 5 and keeps Near 2 / Far 4 damage.
- Bull Rush costs 3 and keeps 7 damage.
- Opening Strike deals 4 when it is the first attack played this turn, even after non-attack cards. Later Opening Strikes deal 1.

Apply behavior and card data consistently in TypeScript, Rust, tactical evaluation, generated native kingdom data, and rule fingerprints.

## Implementation boundaries

- Add or update focused tests for persistent mana, the end-of-turn cap, current-turn mana above 3, Focus without draw, Overload at x3, the changed card costs, and Opening Strike after setup and after an earlier attack.
- Run focused TypeScript and Rust parity tests, required builds, native kingdom generation/checks, typecheck, and changed-file lint.
- Do not update broad hard-coded match fixtures or generated balance manifests.
- Do not run the broad fixture-heavy suite.
- Do not run deep Goldfish, Matrix, or PSRO verification.

## Eight-kingdom gate

Use these kingdoms in order:

1. `balance-tuning-005`
2. `balance-tuning-010`
3. `balance-tuning-013`
4. `balance-tuning-021`
5. `balance-tuning-033`
6. `balance-tuning-053`
7. `balance-tuning-082`
8. `balance-tuning-090`

Run fresh Goldfish evidence on Modal with 16 cores per score container and 512 maximum active score CPUs, allowing 32 score containers. Run Matrix and complete PSRO locally. Keep the confirmed-candidate queue cap at 100, deferred-candidate fresh full-reservoir behavior, and two-clean-full-search stopping rule.

Generate the eight-kingdom comparison report and inspect equilibrium-weighted archetype shares, mixed shares, diagonal self-play telemetry, family damage, card selection, strategy support, and evidence structure. If Mage exceeds 50% or another result is clearly invalid or extreme, make the smallest exact balance correction and rerun the eight-kingdom smoke before continuing. A merely weak, noisy, or unexpected effect is not a stop condition.

## Full run

If the smoke passes the gate, run fresh Goldfish evidence for the remaining 22 kingdoms on Modal with the same 32-by-16 capacity. Run Matrix and complete PSRO locally for all remaining kingdoms. Generate a fresh 30-kingdom equilibrium-weighted report with diagonal self-play telemetry.

Use cheap structural checks for source identity, headers, CRCs, checkpoint completion, final Matrix order, PSRO completion, and HST presence. Keep the original 30-kingdom evidence unchanged.

## Acceptance

- The six approved rule changes match in TypeScript and Rust.
- Focused tests and required structural checks pass without broad fixture refreshes or deep verification.
- The eight-kingdom gate is reviewed before the remaining 22 kingdoms start.
- If the gate passes, all 30 kingdoms complete the full Goldfish -> Matrix -> PSRO process and two-clean-full-search stopping rule.
- Reports use equilibrium/metagame weighting and include diagonal self-play telemetry.
- The implementation diff receives a quick main-agent review before simulation starts.
