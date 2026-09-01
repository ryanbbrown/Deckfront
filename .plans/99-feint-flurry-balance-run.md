# Feint and Flurry balance run

Status: Complete

## Rules

- Feint costs 4, draws 1 card, and gives the next two Close attacks this turn +2 damage each.
- A second Feint refreshes the two attacks. It does not add more charges.
- Flurry is an Engine card that costs 5 and works at any range.
- Flurry deals 1 damage for each other Tactical Action played this turn. It has no base damage.
- Tactical Actions are Melee, Ranged, or Mana Actions, plus non-Scrap Attacks and Movement Actions.

## Implementation

1. Update the card catalog, game rules, public state, and UI.
2. Update the TypeScript simulation, tactical pilot, Rust kernel, and scientific protocol identity.
3. Add focused behavior and TypeScript/Rust parity tests.
4. Regenerate native kingdom data and verify fingerprints.

## Evidence run

1. Run Goldfish for the existing 30-kingdom subset.
2. Build the local payoff matrices.
3. Run Modal PSRO with two clean final searches for every kingdom.
4. Generate and validate the stored-equilibrium HTML report.
5. Compare the result with the accepted Aim-pilot baseline.

## Acceptance

- Focused tests, typecheck, lint, builds, native checks, and parity checks pass.
- All 30 kingdoms are valid with no missing outputs.
- Every kingdom has two clean final PSRO searches.
- The report records the exact scientific commit and source evidence.

## Result

Scientific commit: `9bcc8d28f1e59603680b3c8ae7ca28a82d767a70`.

All 30 kingdoms completed Goldfish, local Matrix, and Modal PSRO. Goldfish completed 60 tasks with no retries or admission failures. Every kingdom passed structural validation and ended with two clean final PSRO searches.

Modal cost was $0.988457 for Goldfish and $0.584902 for the PSRO ledger, for $1.573360 total. Cumulative Modal cost across the recorded balance experiments is about $12.7508.

Compared with the accepted Aim-pilot baseline:

- Melee expected damage fell from 11.4936 to 10.4207 per player side.
- Ranged expected damage rose from 11.2074 to 11.6249.
- Mage expected damage fell from 10.6890 to 10.5197.
- Engine expected damage rose from 8.9180 to 9.7896.
- Flurry selection rose from 28.40% to 38.33% across the ten kingdoms that offered it. Conditional copies rose from 0.217 to 0.653.
- Feint selection stayed at 14.29% across seven offered kingdoms. Conditional copies rose from 0.038 to 0.144, so Feint remains barely reached.

The result improves family damage balance without increasing Melee's metagame presence materially. The report is `.html/strategy-search-30-feint-flurry-engine-head-9bcc8d2.html`.
