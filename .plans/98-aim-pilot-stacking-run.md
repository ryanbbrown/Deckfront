# Aim-stacking pilot balance run

Status: approved and in progress.

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
