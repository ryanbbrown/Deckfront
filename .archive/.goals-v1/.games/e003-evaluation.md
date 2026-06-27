# E003 Evaluation

## Validation

All six requested replay bundles validate:

- `.games/e003-rush-vs-engine-a/timeline.json`: valid, 14 entries.
- `.games/e003-rush-vs-engine-b/timeline.json`: valid, 10 entries.
- `.games/e003-center-vs-flank-a/timeline.json`: valid, 15 entries.
- `.games/e003-center-vs-flank-b/timeline.json`: valid, 16 entries.
- `.games/e003-swarm-vs-upgrade-a/timeline.json`: valid, 14 entries.
- `.games/e003-swarm-vs-upgrade-b/timeline.json`: valid, 14 entries.

## Run Validity

- `rush-vs-engine-a`: full evidence, no material issues found. Draft-start is consistent with 7 Copper plus drafted cards, delayed recruits are recorded, printed druid healing is logged, and deck damage is attached only to legal attacks.
- `rush-vs-engine-b`: full evidence, no material issues found. The run records the fixed draft decks, delayed recruit activation, conservative deck damage, and the start-of-turn win timing.
- `center-vs-flank-a`: full evidence, no material issues found. The run records delayed recruits, legal attack-bound damage, capped healing, and no Storm use.
- `center-vs-flank-b`: full evidence, no material issues found. The run records delayed recruits, printed healing instead of attacking, unused deck healing, and no start-of-turn win.
- `swarm-vs-upgrade-a`: full evidence with minor residual tactical-check risk. The replay validates and the notes log delayed recruits, capped healing, upgrades, and conservative damage. Storm was bought but not resolved as Storm targeting.
- `swarm-vs-upgrade-b`: full evidence, no material issues found. The run records one intentionally unspent P2 draft amount, delayed recruits, capped healing, and conservative upgrade/heal allocation.

Batch caveat: the official validator confirms replay bundle continuity, not full board legality. The run notes and timelines provide adequate evidence for this evaluation, but movement/range legality remains partly dependent on the playthrough agents' manual or run-local checks.

## Score

Ruleset/map score: **73 / 100**

- Pacing and arc: **20 / 25**. Runs ended or reached a useful unresolved state in 10-16 completed player turns. That is in the target range, but `rush-vs-engine-b` ended very fast at 10 turns and multiple games were already functionally leaning P1 before the opponent could turn deck economy into board response.
- Strategic diversity: **18 / 30**. Center/flank produced the healthiest evidence: both A and B stayed unresolved at 15-16 turns with P2 pressure still live. Rush beat engine twice, and swarm/economy beat or led upgrade/heal in both runs, so slower engine and elite-upgrade lines look underpowered against early center/economy pressure.
- Board tension: **17 / 20**. Supply centers mattered every game and forced real choices: center mass versus southeast/east flank, compact formation versus capture coverage, and income versus unit-count pressure. The concern is that P1 led every final board, often by holding the same northeast/east plus center cluster, which points to map/economy or first-player pressure.
- Combat interest: **18 / 25**. Combat had meaningful choices around attack-bound deck damage, upgraded anchors, healing instead of attacks, and target selection. Still, the strongest outcomes often came from converting supply leads into bodies, with damage cards finishing units faster than healing or upgrades could stabilize.

## Main Lessons

The locked draft-start and delayed recruit timing were applied consistently enough for the batch to be useful. Printed healing was also treated consistently: healers and druids healed instead of attacking, healing was capped, and dead units were not revived. Storm targeting was defined but effectively untested, since Storm was only bought in `swarm-vs-upgrade-a` and no timeline resolved a `stormTargets` split.

The best matchup evidence is `center-vs-flank-a/b`. Those runs show the map can create an interesting center-versus-flank problem, with P2's southern/eastern pressure forcing P1 to spread and delaying the win condition. The rush and swarm/upgrade runs are still legal evidence, but they point to a sharper balance concern: early P1 center/east access plus supply income can become a unit-count clock before slower decks cash out.

P1 leading every final board is meaningful. It is not proof of a deterministic first-player win, because the assigned P1 strategies were often proactive and center/economy oriented, but the repeated pattern suggests the current map/economy favors P1's near-side northeast/east expansion and first claim on the central cluster.

## Recommended Next Experiment

Run a focused E004 first-player-pressure test: keep `territory-v1-locked`, but either swap player strategy seats on the same matchups or test a small map/economy variant that reduces P1's early northeast/east plus center acceleration. The highest-value matchup is center versus flank with seats reversed, followed by rush versus engine with P2 given the rush role, because that directly separates strategy strength from map/turn-order pressure.
