# Aim-stacking pilot balance run

Status: complete.

## Goal

Make the tactical pilot play every available Aim before it spends the pending bonus on Volley. Measure the change in the eight `balance-smoke-v1` kingdoms that offer Aim, then combine those fresh results with the unchanged 22 kingdoms from the stacking-Aim run.

## Rule and policy

Aim remains cost 4. Each copy draws 1 card and adds 2 damage to the next Ranged attack this turn. When the pilot has a pending Aim bonus, another playable Aim takes priority over Volley. Volley takes priority once no playable Aim remains.

## Verification

Update the shared TypeScript tactical policy and the native Rust policy. Bump the simulation protocol, regenerate native kingdom fingerprints, and add a regression test that observes the selected action through the production tactical-agent boundary. Run focused TypeScript and Rust parity tests, required builds, native kingdom checks, typecheck, lint, and cheap structural checks.

## Search

1. Run fresh Goldfish, local Matrix, and Modal PSRO evidence for the eight smoke kingdoms that offer Aim.
2. Require two clean final PSRO searches for every rerun kingdom.
3. Build a combined 30-kingdom evidence root from the eight fresh kingdoms and the 22 unchanged kingdoms from `.data/stacking-aim-balance-97`.
4. Record split source provenance for the fresh and reused evidence.
5. Generate and open a fresh combined HTML report.

## Acceptance

- With a pending Aim bonus and both Aim and Volley in hand, the pilot selects Aim.
- With a pending Aim bonus and Volley but no Aim in hand, the pilot selects Volley.
- TypeScript and Rust agree on the policy.
- All eight affected kingdoms complete Goldfish -> Matrix -> PSRO with two clean final searches each.
- The combined report contains all 30 smoke kingdoms and passes routine structural checks.

## Result

Scientific policy commit: `f746a8767b9164e3b29bfa2b9204a57b98738d66`. Mixed-evidence fingerprint and verifier commit: `ab08a790a46c6e521924e56a437a4d02a8d1fded`.

All eight Aim kingdoms completed fresh Goldfish, local Matrix, and Modal PSRO evidence. Goldfish completed 16 tasks with no retries or admission failures. Every kingdom passed PSRO validation with two clean final searches. Modal cost was $0.3068 for Goldfish and $0.1503 for PSRO, for $0.4571 total.

The combined report reuses the unchanged Goldfish, Matrix, and PSRO evidence for the other 22 kingdoms. The current verifier regenerated self-play telemetry for all 30 kingdoms; every regenerated HST file was byte-identical to its corresponding prior or fresh source file.

Compared with stacking Aim under the old pilot, Aim selection increased from 38.21% to 59.66%, expected acquired copies increased from 0.692 to 1.299, and conditional copies increased from 1.812 to 2.177. Ranged expected damage increased from 9.9155 to 11.2074 per player side. Pure Ranged share increased from 20.27% to 24.19%, and any-Ranged presence increased from 43.07% to 46.33%.

The report is `.html/strategy-search-30-aim-stack-pilot-head-f746a87.html`.
