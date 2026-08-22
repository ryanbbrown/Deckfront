# Six-space arena and Scrap balance rules

## Approved rules

- Longshot uses absolute position distance. Its text is: “At Near or Far range, deal damage equal to the distance between you and your opponent.”
- The arena is spaces 1 through 6. Normal starts are ochre at 3 and indigo at 4; `swapSides` exchanges them. Range bands stay Close at distance 0, Near at 1, and Far at 2 or more.
- Only the first Scrap played by each player each turn deals 1 damage. Later copies deal 0 but stay legal Tactical Actions in the engine family. The first played copy has `copiesPlayed.scrap === 1`.
- Generic AI trash choices select Scrap before Copper. Cull and Scour use available Scrap first, then fill remaining capacity with Copper. Copper is trashed only when the existing purchase projection permits it.
- Reforge selects Scrap, then Copper, then itself. Scrap and Copper both cost 0, so either gives the same maximum gain; Scrap goes first to preserve Copper money. Reforge still trashes itself when neither starter card is available.
- The first-player health penalty does not change.

## Verification

- Add focused immutable-engine, tactical policy, position-value, and compact-kernel parity tests.
- Regenerate the intentional match oracle with `npx tsx scripts/write_match_oracle.ts --rewrite`.
- Run `npm run typecheck`, `npm run lint`, and `npm test` without E2E, training benchmarks, or a development server.
