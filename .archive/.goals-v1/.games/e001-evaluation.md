# E001 Baseline Evaluation

## Run Validity Summary

- `.games/e001-rush-vs-engine-a/`: `partial`. `bun run validate-run -- .games/e001-rush-vs-engine-a/timeline.json` passed with 12 entries. Bundle is complete and coherent. The main issue is shared across the batch: the run seeded damaged starter units from the requested snapshot even though `board-rules.md` says units start at max HP. This makes early combat more lethal and reduces confidence in pacing/combat conclusions. Stopped after 12 completed player turns with P1 ahead 8 units to 6 and controlling five centers; no win check had fired.
- `.games/e001-rush-vs-engine-b/`: `partial`. Validator passed with 12 entries. Complete bundle, notes log deck damage and healing ambiguity. P1 reaches a start-of-turn win position after turn 012, ahead 7 units to 4. This is useful evidence that early board pressure plus supply lead can snowball, but the low-HP seed likely amplified P1's rush kills.
- `.games/e001-center-vs-flank-a/`: `partial`. Validator passed with 16 entries. This is the strongest run in the batch: ambiguities are logged, the game reaches the target 12-16 turn band, and the board remains contested at 8 units to 7 with P1 controlling four centers and P2 three. Still partial because the damaged starter seed and ad hoc unit-healing timing are material rules deviations/interpretations.
- `.games/e001-center-vs-flank-b/`: `partial`. Validator passed with 8 entries. Complete checkpoint bundle and useful early-game evidence, but it stops before a full arc. It ends stable at 5 units each, with P1 controlling four centers and P2 three. Timeline deck summaries also look less detailed than the other runs, so I weight it mainly for early board-position evidence.

No run is `full` because the whole batch uses a damaged starter snapshot that conflicts with the written setup rule. No run is `invalid`; the replay bundles validate and the known ambiguities were generally surfaced.

## Batch Score: 68 / 100

- Pacing and Arc: 17 / 25. The center/flank A run produced the best arc: 16 completed player turns, visible early expansion, midgame center fight, and no immediate runaway. Rush B ended at the start-of-turn win threshold after 12 turns, which is in range, but the low-HP seed makes that result look faster and more lethal than the baseline rules may intend. Center/flank B is only an 8-turn checkpoint.
- Strategic Diversity: 18 / 30. Rush pressure, central guardian/marksman formations, and flank/support plans all showed some viability. Center/flank A is good evidence that a healing/control flank can keep playing after losing tempo. However, the slower engine plan in both rush-vs-engine runs did not stabilize before P1's supply and unit lead became decisive, and P1's early east/northeast access looked consistently efficient.
- Board Tension: 18 / 20. This is the batch's strongest area. Supply center control repeatedly drove decisions: rush B turn 005 had P1 on both central supplies plus northeast/east, while center/flank A turn 008 showed a meaningful 4-3 center split with P2 holding southeast via the flank. Control persistence mattered because units could leave or die while prior claims continued shaping income.
- Combat Interest: 15 / 25. Positioning and target priority mattered: exposed scouts were punished, guardians worked as anchors, and marksmen/support pieces created different tactical roles. But combat conclusions are weakened by the damaged starter units, conservative but unresolved deck-damage interpretation, and improvised druid/healer action timing. Several kills were driven by fragile seeded HP rather than fully developed combat systems.

## Main Lessons

- The map creates real pressure over central and flank supply centers. Players are not safely building in isolation.
- Early pressure is clearly viable, possibly too viable with the current seed and first-player access pattern.
- Slower deck-engine scaling is not yet proven viable. In rush A/B, P2's engine cards arrived after the board deficit was already severe.
- Unit plans have promise: scouts create tempo and flanks, guardians stabilize, marksmen punish exposed pieces, and support units mattered in center/flank A. The healing rules need to be specified before support-unit balance can be trusted.
- The current evidence cannot cleanly distinguish baseline rules balance from the damaged-start snapshot effect.

## Recommended Next Experiment

Iterate near this experiment rather than discarding it. First, rerun the same two matchups from a rules-legal max-HP starter board so pacing and combat lethality can be compared directly. Also clarify before the next batch:

- whether druid/healer printed heal is an attack replacement, automatic support action, or not active yet;
- whether deck `damage` must attach to a legal attack;
- exact ordering inside the board phase, especially recruitment vs movement/combat;
- whether the map should reduce P1's easy early access to northeast/east or give P2 a comparably efficient second-center route.

After the max-HP rerun, test a nearby variant that helps slower strategies stabilize: either slightly cheaper first support recruitment, a less snowbally supply income curve, or a map tweak that makes the southeast/northwest flanks matter earlier.
