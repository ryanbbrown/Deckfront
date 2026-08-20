# Opponent-aware movement

## Goal

Make movement account for both players' public card ownership. Preserve all existing higher-priority Action-phase decisions. Do not inspect either hidden draw order or zone placement. Keep both simulation paths above two thirds of their current throughput.

Baselines on Node 22.23.1 and an otherwise idle Apple M4 Pro:

- Fast kernel: 19,881 median games per second across 75,000 fixed matches.
- Full search: 185 median games per second across 1,500 fixed matches.

## Behavior

- Current-turn lethal damage, damage, and planned purchases remain more important than future position.
- Preserve the full-search order: lethal, current damage, planned purchases, Copper trashing, obsolete Cull removal, cards drawn, public position value, then the stable final tie-break.
- In the compact pilot, compare total current-hand damage first and public position value second. Mana from Ley Step contributes only through the total current-hand result; it is not an independent reason to sacrifice damage.
- Public position value combines current attack value with the movement steps each owned attack needs to reach its best range. More required steps mean less value. This makes Far safer than Near against a Melee deck even though Melee is disabled at both distances.
- Normalize each player's value by live deck size with exact integer cross-multiplication. Do not compare floating-point ratios.
- Build public ownership from definition counts across all live draw, hand, discard, and play zones at once. Use only the unconsumed part of the compact kernel's draw array. Do not use zone-specific opponent data or the kernel's acquisition counters.
- Close attacks reach their best value at Close. Drive includes its wall bonus only when the hypothetical Close position is space 1 or 5.
- Steady Shot reaches its best value at Near or Far. Volley's current-hand value uses the current Aim state; its public future value uses the best printed value at each range, including Aim.
- Mage damage has the same value at every position. A Mage strategy therefore moves away from Melee when it can do so without losing a higher-priority result.
- Mage damage does not change with position. A Mage strategy therefore moves away from Melee when it can do so without losing a more important result.
- A Ranged strategy moves from Close to enable attacks and prefers Far for Volley. If Steady Shot deals the same damage at Near and Far, the opponent's public deck breaks the tie.
- A strategy does not buy movement automatically. Strategy generation still decides whether Step, Footwork, or Ley Step belongs in the deck.

## Implementation

- Put attack-profile construction and position scoring behind one small shared interface used by the full Action-phase search, tactical agent, and compact kernel.
- A profile contains definition totals and live deck size, not cards grouped by zone. The current hand may also appear in the public total because the two values are compared in sequence rather than added together.
- The full search replaces its existing printed attack-potential tie-break with public position value. Cache the opponent profile once per `searchAction` call. Rebuild the active profile at a leaf because Cull can change it. Do not widen the memo across turns.
- Pass compact profiles into the tactical pilot. Avoid copying full decks into each movement choice. Optimize the implementation before balance testing if profile construction causes the speed gate to fail.
- Step, Ley Step, Footwork, and Adapt movement use current-hand damage first and public position value second. Drive direction uses its direction-specific immediate damage first and public position value second.
- If both scores tie, prefer Stay when available, then the direction farther from the opponent, then Left. This prevents pointless Footwork movement and stays deterministic.
- Do not play Step or Ley Step when neither current-hand damage, mana-adjusted current-hand damage, nor public position value improves. A non-combat deck must not move forever.
- Increment both `TACTICAL_PILOT_PROTOCOL_VERSION` and `SIMULATION_KERNEL_PROTOCOL_VERSION`. The new rules fingerprint intentionally makes every old balance artifact stale.
- Regenerate `test/sim/fixtures/match-oracle.json` with `npx tsx scripts/write_match_oracle.ts --rewrite`. Read each changed headline and update `test/sim/identity.test.ts` only for accepted behavior changes.

## Smoke checks

- Test the shared score at Close, Near, and Far for Melee, Drive at both walls and away from a wall, Steady Shot, aimed and unaimed Volley, and position-neutral Mage.
- Prove through the production movement interface that Mage with Step moves away from a Melee deck.
- Prove that Ranged with Steady Shot prefers Far over Near against Melee when current damage is equal.
- Prove that Volley still prefers Far because its current damage is higher there.
- Prove that Melee still prefers Close and that mixed decks make a deterministic trade-off.
- Cover both arena walls, equal scores, Footwork Stay, Adapt, no movement card, unequal deck sizes, Cull changing the profile, a hidden-pile permutation, and movement that would reduce current damage.
- Run compact-kernel matches across all four curated kingdoms and confirm no aborts, invalid states, search overflows, or action loops. Run `npm run compare:pilots` and inspect material policy drift.
- Measure the fast kernel with `npx tsx scripts/measure_search.ts --pilot kernel --seeds 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25 --repeats 30`. Stop and optimize before balance testing if median throughput is below 13,250 games per second.
- Measure the full search with `npx tsx scripts/measure_search.ts --pilot full --seeds 3,17,41 --repeats 5`. Stop and optimize before balance testing if median throughput is below 123 games per second.
- If behavior and speed pass, run focused simulator tests, full tests, typecheck, lint, simulator build, production build, and E2E tests.

## Balance check after implementation

- Keep Drive at 2 base damage and 2 wall damage.
- Before any rerun, copy the 20 saved Drive-2 artifact directories to `.experiments/balance-comparisons/opponent-aware-movement/drive-2-baseline/`. The directory is ignored by Git.
- Rerun these tuning kingdoms: 001, 002, 003, 004, 011, 023, 024, 027, 030, 031, 033, 042, 043, 051, 058, 067, 068, 069, 074, and 078.
- Compare Melee, Ranged, and Mage distribution with the copied Drive-2 baseline. Report the exact exclusive and family-involvement percentages; do not set an automatic balance pass threshold.
- Do not run the other tuning or validation kingdoms until the user reviews the 20-kingdom result.
