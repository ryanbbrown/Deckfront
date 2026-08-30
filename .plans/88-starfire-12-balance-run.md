# Starfire 12 balance run

Status: authorized for overnight execution by the user on 2026-08-30.

## Goal

Measure the final Starfire 12 rule across the existing 30-kingdom balance suite. Run fresh Goldfish on Modal, Matrix locally, and PSRO on Modal. Produce an equilibrium-weighted HTML report and analysis.

## Kingdoms

Use the ordered 30-kingdom `balance-smoke-v1` list from `.data/persistent-mana-balance-85/source-manifest.json`.

## Pipeline

1. Run Goldfish-only Modal route at 16 cores per score container and at most 512 active CPUs. The route hard cap requires two requests: the first 16 kingdoms and the final 14 kingdoms. Each request has a 1,800-second scientific wall limit and a $100 guard; measured cost is expected to be much lower.
2. Copy each completed Goldfish campaign into `.data/starfire-12-balance-88` through the unpaid PSRO `matrix` operation. Run Matrix locally for each subset and rebuild the combined Matrix batch report.
3. Plan and run all 30 PSRO kingdoms through the Modal batch route at 16 cores per kingdom, at most 480 active CPUs, 7,200 seconds per kingdom, and a $60 execution guard.
4. Require the confirmed-candidate queue cap of 100 and the two-clean-full-search stop. Use routine structural checks. Do not run deep verification.
5. Generate the 30-kingdom Rust balance report and HTML. Report equilibrium-weighted archetype shares, family damage, card use, support, feasible archetype ranges, and the best non-winning-archetype strategy score against the stored equilibrium lottery.

## Goldfish plans

- First 16: execution `3be529ac19b195c4eaf04891d743f247484c111df87c8039b854ec0ce9d5654d`; worst-case guard bound `$80.414972`; request `.data/starfire-12-balance-88/goldfish-request-a.json`.
- Final 14: execution `db5cddb9035da82afd2f3cb74c61d33d77cf080370f3806fe8a10f31dc84e7a9`; worst-case guard bound `$70.375882`; request `.data/starfire-12-balance-88/goldfish-request-b.json`.

## PSRO plan

Execution `d6b0497a366319e56160b9ad8ac0b288ac3342491bb783b4a5b76f2a8b445338` has 30 slots, a `$1.6642752` one-attempt bound per kingdom, a `$49.9361556` full launch bound including readiness, and a `$60` execution guard.

## Stop conditions

Stop and report if a route rejects source or input identity, evidence structure fails, a cost guard blocks a launch, a PSRO kingdom does not reach two clean full searches, active PSRO machines exceed planned slots, or any paid retry needs a changed request or authorization token.
