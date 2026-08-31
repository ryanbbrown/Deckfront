# Aim and Overload cost balance run

Status: complete.

## Goal

Measure Aim and Overload at market cost 4 across the existing 30-kingdom `balance-smoke-v1` suite. Keep all other card rules and search rules unchanged.

## Changes

- Aim costs 4. It still draws 1 card and gives the next Ranged attack this turn +2 damage. It does not stack.
- Overload costs 4. It still deals 3 damage per mana spent this turn.

## Verification

Run focused card-rule tests, TypeScript and Rust parity checks, required builds, native kingdom generation and checks, rule-fingerprint checks, typecheck, and lint. Do not refresh broad balance fixtures or manifests. Do not run deep Goldfish, Matrix, or PSRO verification.

## Search

1. Run fresh Goldfish evidence on Modal for the 30 smoke kingdoms with 16 cores per score container and at most 512 active CPUs. Split the request if required by the cost guard.
2. Run Matrix locally.
3. Run PSRO on Modal with 16 cores per kingdom, at most 480 active CPUs, the confirmed-candidate queue cap of 100, and the two-clean-full-search stop.
4. Generate a fresh equilibrium-weighted JSON and HTML report with diagonal self-play telemetry.
5. Keep the persistent-mana cap-two report as the unchanged baseline.

## Acceptance

- Aim and Overload both cost 4 in TypeScript and generated native kingdom data.
- Focused verification passes.
- All 30 kingdoms complete Goldfish -> Matrix -> PSRO with no changed search rules and two clean final PSRO searches each.
- The report passes routine structural checks and opens in Google Chrome beside the baseline report.

## Result

- Scientific implementation commit: `1b0f4af47d3da5129d923eae882c9e7c199db1c3`.
- Goldfish, Matrix, and PSRO completed for all 30 kingdoms. Goldfish had no retries. Every PSRO result is valid and reached the two-clean-full-search stop.
- Goldfish cost $0.859190. The PSRO ledger cost $0.522724. Total Modal cost was $1.381914.
- Routine structural report validation passed. No deep verification ran.
- Analysis: `.data/aim-overload-cost4-balance-96/rust-balance-analysis-v2.json`.
- HTML: `.html/strategy-search-30-aim-overload-cost4-head-1b0f4af.html`.
