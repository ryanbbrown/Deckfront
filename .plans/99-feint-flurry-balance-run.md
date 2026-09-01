# Feint and Flurry balance run

Status: In progress

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
