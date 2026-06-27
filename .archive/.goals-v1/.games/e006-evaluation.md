# E006 Evaluation

## Validation

All four recruit-cost-6 replay bundles validate:

- `.games/e006-rush-vs-engine-a/timeline.json`: valid, 16 entries.
- `.games/e006-rush-vs-engine-b/timeline.json`: valid, 16 entries.
- `.games/e006-center-vs-flank-a/timeline.json`: valid, 16 entries.
- `.games/e006-center-vs-flank-b/timeline.json`: valid, 16 entries.

## Run Validity

- `rush-vs-engine-a`: partial evidence. The bundle validates and tests the cost-6 tension, but notes downgrade exact tactics because board play is hand-authored. It ends with P1 ahead 8-to-5 and winning on the pending start-turn check.
- `rush-vs-engine-b`: full evidence. Cost 6 delayed first recruits and kept P2 within one unit through turn 16, but P1 still led 5 centers to 2.
- `center-vs-flank-a`: full evidence. Cost 6 preserved the center/flank split and ends close: P1 leads 7-to-6 units and 4-to-3 centers, while P2 has live flank pressure and more saved supply.
- `center-vs-flank-b`: full evidence. Best cost-6 evidence: no winner, units tied 8-to-8, P1 leads 4-to-3 centers, and P2 has slightly more saved supply.

## Score

Ruleset/map score: **80 / 100**

- Pacing and arc: **22 / 25**. All four runs reached 16 completed turns. The opening still had pressure, but recruit timing slowed enough to create more midgame interaction.
- Strategic diversity: **22 / 30**. Center/flank is now consistently healthy, and engine/stabilization survives longer in one rush run. Rush still wins or leads both rush-vs-engine runs, so slower engine is not yet an equal win plan.
- Board tension: **19 / 20**. Supply centers remain decisive without immediately converting every lead into bodies. Saved-supply tension appears more often because players sit one supply short of recruits.
- Combat interest: **17 / 25**. Combat remains tactical around upgrades, healing, and attack-bound damage. The remaining weakness is deck damage burst: rush can still remove key units before engine/healing converts.

## Main Lessons

Recruit cost 6 is an improvement over E005. It preserves the better map tension from `sketch-v2-access` and slows supply-to-body conversion enough that center/flank games stay live and tactically rich.

The remaining imbalance is not just recruitment pace. Rush-vs-engine still shows damage bursts converting into pending unit-count wins, especially when multiple Blast/Zap cards stack onto a legal attack. Slower engine/healing can build money and screens, but often cannot prevent a key unit from dying once burst damage arrives.

## Recommended Next Experiment

Deepen near E006. Keep `sketch-v2-access` and recruit cost 6, then test a deck-damage tempo cap: deck `damage` may add at most 1 extra damage per attacking unit per turn. This preserves the attack-bound damage identity but prevents a single scout or raider from carrying a 5-9 damage spell burst into one kill.
