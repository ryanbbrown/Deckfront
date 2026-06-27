# E002 Evaluation

## Validation

All six replay bundles validate structurally:

- `.games/e002-rush-vs-engine-a/timeline.json`: valid, 12 entries.
- `.games/e002-rush-vs-engine-b/timeline.json`: valid, 13 entries.
- `.games/e002-center-vs-flank-a/timeline.json`: valid, 15 entries.
- `.games/e002-center-vs-flank-b/timeline.json`: valid, 16 entries.
- `.games/e002-swarm-vs-upgrade-a/timeline.json`: valid, 14 entries.
- `.games/e002-swarm-vs-upgrade-b/timeline.json`: valid, 14 entries.

Validator success only confirms replay bundle continuity/schema. Board legality and ambiguous rules calls were reviewed from notes, timelines, snapshots, and final boards.

## Run Validity

- `e002-rush-vs-engine-a`: partial, minor issues. Coherent delayed-recruit run using conservative deck damage. Uses the configured default starter deck instead of the written 7 Copper plus 12 draft-coin setup, so it is useful but not clean setup evidence. Ends unresolved after 12 turns with P1 ahead 7 units to 5 and 5 centers to 2.
- `e002-rush-vs-engine-b`: low, major issue. The bundle validates, but recruits were allowed to move/action on their entry turn. Mechanical inspection found P1 recruits ending outside home on their recruit turns, including turn 003 and the two fast recruits on turn 011. Because this materially supports the P1 unit-count win at the start of P2 turn 014, use only as a weak pressure signal.
- `e002-center-vs-flank-a`: partial, minor issues. Coherent delayed-recruit run with conservative deck damage and no printed unit-heal actions. It uses the default starter deck rather than the written draft setup. Ends unresolved after 15 turns with P1 leading 6 units to 5 and 4 centers to 3.
- `e002-center-vs-flank-b`: full, no material issues found. Best evidence in the batch: uses 7 Copper plus 12 draft coin, delays recruits, leaves unassignable deck damage unused, and does not use printed unit healing. P1 wins at the start of round 9 with 9 units to 6 after P2's final flank counterkill.
- `e002-swarm-vs-upgrade-a`: partial, minor issues. Coherent delayed-recruit run with conservative Storm/damage handling, but default starter deck. Ends unresolved after 14 turns at 8 units each; P1 has a strong center/supply edge, 5 centers to 2.
- `e002-swarm-vs-upgrade-b`: partial, minor-to-moderate issues. Valid and coherent, but default starter deck plus an explicit printed unit-heal interpretation that other runs avoided. Because healing mostly helps P2 stabilize while P1 still leads 9 units to 8 and 5 centers to 2, the main board lesson remains useful but not clean.

Deck damage was generally handled according to the written conservative interpretation: extra damage assigned to legal attacks, with excess left unused when no legal target existed. Storm was also narrowed in the better-documented runs. The unresolved rules gaps are same-turn recruit activation and printed unit healing timing/range.

## Score: 75/100

- Pacing and arc: 20/25. The batch sits in the target range: 12, 13, 15, 16, 14, and 14 completed player turns. Max-HP starts avoided immediate collapse, and several games gave the defender a response window. Some runs stopped unresolved, but most had a clear leader or imminent start-turn win.
- Strategic diversity: 20/30. Rush, center-control, flank, swarm, and upgrade plans all produced recognizable play patterns. However, P1 or early center-income pressure led nearly every usable run, while engine/upgrade plans mostly stabilized rather than threatened to win. Setup inconsistency also weakens cross-strategy comparison.
- Board tension: 17/20. Supply centers strongly mattered. Center/flank runs showed real tradeoffs between compact central control and southern wrap pressure, and swarm/upgrade runs showed quantity versus elite-line tension. The concern is that 5-to-2 center splits appeared repeatedly and may make income snowball faster than comeback tools can answer.
- Combat interest: 18/25. Unit roles mattered: scouts enabled captures, guardians absorbed, raiders punished exposed units, marksmen/druids created focus-fire turns, and upgrades created tactical targets. Deck damage as attack support produced meaningful spikes without becoming global direct damage. Combat still loses confidence from undefined unit healing, Storm wording, and the material recruit-activation ambiguity.

## Main Lessons

- E002 is materially healthier than a too-fast collapse pattern: max-HP starts plus start-turn win checks create response windows.
- Early board pressure remains viable and probably strong. P1 repeatedly converts nearby eastern centers into tempo, recruits, and eventual unit-count pressure.
- Slower engine/upgrade/support strategies are viable for stabilization but not yet proven as equal win plans. The best support evidence is tactical survival, not reversal.
- Center-versus-flank tension is promising. `center-vs-flank-b` is especially useful: P2's flank killed the upgraded guardian, but P1's center economy still produced the winning unit edge.
- Quantity versus quality is promising but unresolved. `swarm-vs-upgrade-a` ended 8-8 with P1 leading economy and P2's upgraded line intact, which is exactly the kind of tension worth refining.

## Recommended Next Experiment

Iterate near E002, but first lock the rules/setup so the next batch is cleaner:

1. Use only the written 7 Copper plus 12 draft-coin start, or formally change `deck.yaml` to match the intended starter.
2. Define recruited unit activation. I recommend delayed activation for the next test because it is the conservative interpretation used by most valid runs and avoids sudden unit-count spikes.
3. Define printed unit healing timing, range, and whether it replaces attack.
4. Define Storm target counting and adjacency precisely.

Then rerun the strongest matchups with side pressure in mind: center-vs-flank and swarm-vs-upgrade, plus one rush-vs-engine rerun under delayed recruits and draft starts. Consider swapping player strategy/map sides or adjusting nearby center access if P1 center income continues to dominate.
