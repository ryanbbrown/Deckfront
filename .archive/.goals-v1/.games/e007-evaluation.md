# E007 Partial Evaluation

## Validation

Two of four planned damage-cap replay bundles completed and validate:

- `.games/e007-rush-vs-engine-b/timeline.json`: valid, 16 entries.
- `.games/e007-center-vs-flank-a/timeline.json`: valid, 16 entries.

Two planned workers failed before producing bundles because of rate limits:

- `.games/e007-rush-vs-engine-a`
- `.games/e007-center-vs-flank-b`

## Run Validity

- `rush-vs-engine-b`: full evidence for the damage-cap stress. It ends unresolved at 16 turns with units tied 7-to-7. P1 still leads positionally, 5 centers to 2, but the cap prevents the rush from creating the unit-count clock seen in E005/E006 paired runs.
- `center-vs-flank-a`: useful but slightly caveated evidence. It validates and records damage-cap timing, but notes say it reuses a matching cost-6 center/flank line retargeted to the damage-cap ruleset because relevant damage turns already obeyed the cap. It ends close: P1 leads 7-to-6 units and 4-to-3 centers, while P2 has live flank pressure.

## Partial Score

Ruleset/map score: **82 / 100 as partial evidence**

- Pacing and arc: **22 / 25**. Both completed runs reach 16 turns and stay active.
- Strategic diversity: **23 / 30**. The rush-vs-engine result is the first strong evidence that engine/stabilization can avoid falling behind on unit count against rush. More runs are needed because P1 still has a large center lead.
- Board tension: **19 / 20**. The E006 board tension appears preserved.
- Combat interest: **18 / 25**. The cap reduces single-attacker burst kills without removing attack-bound deck damage. It may make some Blast-heavy hands waste damage, which could be acceptable if it rewards broader formations.

## Main Lessons

The damage cap is promising but under-sampled. The completed rush-vs-engine run directly addresses the E006 failure mode: units are tied at 16 turns instead of P1 threatening or reaching a unit-count win. However, P1 still controls 5 centers to P2's 2, so the cap improves combat lethality more than board economy.

The center/flank control does not show obvious harm. P1 remains slightly ahead, but P2's flank remains live and the run stays unresolved.

## Recommended Next Experiment

Repeat and deepen E007 before moving on. Run the missing paired playthroughs, especially another rush-vs-engine run, and add one swapped-seat rush/control run if possible. Treat E007 as the current most promising candidate only after the missing evidence confirms the first rush result.
