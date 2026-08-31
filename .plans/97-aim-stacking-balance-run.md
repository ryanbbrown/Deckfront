# Stacking Aim balance run

Status: complete.

## Goal

Measure stacking Aim at market cost 4 across the existing 30-kingdom `balance-smoke-v1` suite. Keep Overload at cost 4 and keep every other card and search rule unchanged.

## Rule

Each Aim draws 1 card and adds 2 damage to the next Ranged attack this turn. Multiple Aim bonuses add together. The next Ranged attack consumes the full bonus.

## Verification

Update the playable TypeScript engine, compact TypeScript simulation, tactical state, Rust simulation, generated native kingdom data, rule fingerprints, API state, and focused tests. Run required builds, focused TypeScript and Rust parity tests, native kingdom checks, typecheck, lint, and cheap structural checks. Do not refresh broad balance fixtures or manifests. Do not run deep Goldfish, Matrix, or PSRO verification.

## Search

1. Run fresh Goldfish evidence on Modal for the 30 smoke kingdoms with 16 cores per score container and at most 512 active CPUs.
2. Run Matrix locally.
3. Run PSRO on Modal with 16 cores per kingdom, at most 480 active CPUs, the confirmed-candidate queue cap of 100, and the two-clean-full-search stop.
4. Generate a fresh equilibrium-weighted JSON and HTML report with diagonal self-play telemetry.
5. Keep both prior cost-5 and non-stacking cost-4 reports unchanged.

## Acceptance

- Two Aim cards produce a pending +4 bonus, and the next Ranged attack consumes it.
- TypeScript and Rust agree on the rule.
- Focused verification passes.
- All 30 kingdoms complete Goldfish -> Matrix -> PSRO with two clean final searches each.
- The report passes routine structural checks.

## Result

Scientific commit: `9e159057b22a860d65a7cf79fd19d335a034d29c`.

All 30 kingdoms completed Goldfish, local Matrix, and Modal PSRO. Goldfish completed 60 tasks with no retries or admission failures. Every kingdom passed PSRO validation with two clean final searches.

Modal cost was $0.9247 for Goldfish and $0.5045 for PSRO, for $1.4292 total. The report is `.html/strategy-search-30-stacking-aim-head-9e15905.html`.

Stacking increased Aim's equilibrium selection rate from 15.77% to 38.21% across the eight kingdoms that offered it. Conditional acquired copies increased from 0.539 to 1.812. Ranged expected damage increased from 9.7948 to 9.9155 per player side, while Ranged-family presence increased from 42.39% to 43.07%.
