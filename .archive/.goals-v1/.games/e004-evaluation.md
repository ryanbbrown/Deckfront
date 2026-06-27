# E004 Evaluation

## Validation

All four seat-swap replay bundles validate:

- `.games/e004-engine-vs-rush-a/timeline.json`: valid, 20 entries.
- `.games/e004-engine-vs-rush-b/timeline.json`: valid, 16 entries.
- `.games/e004-flank-vs-center-a/timeline.json`: valid, 16 entries.
- `.games/e004-flank-vs-center-b/timeline.json`: valid, 16 entries.

## Run Validity

- `engine-vs-rush-a`: full evidence. P2 rush from second position produced a large 9-to-5 unit lead by turn 20. This shows rush pressure is not only a P1 artifact.
- `engine-vs-rush-b`: full evidence. The run stayed unresolved at 16 turns; P1 engine led units 9-to-7 while P2 rush led centers 4-to-3. This is useful counterweight against treating rush as deterministic.
- `flank-vs-center-a`: full evidence. P1 flank/control beat P2 center pressure positionally, ending 9-to-7 units and 5-to-2 centers.
- `flank-vs-center-b`: partial evidence. The bundle validates and follows the seat-swap assignment, but notes downgrade it because the fixed starting decks intentionally differ from the locked draft framing. It still supports the main lesson: P1 led positionally despite P2 holding the center-pressure strategy.

## Score

Ruleset/map score: **74 / 100**

- Pacing and arc: **20 / 25**. Three runs reached 16 turns and one reached 20, with no inert openings. The 20-turn engine-vs-rush A run was useful but started to show a decisive unit-count gap rather than a clean finish.
- Strategic diversity: **19 / 30**. Rush can win from P2, engine can stabilize in one paired run, and flank/control remains live. However, slower plans still mostly stabilize rather than create their own clock, and P1's positional edge appears across strategy swaps.
- Board tension: **18 / 20**. Centers strongly drove every result. The seat swap showed real positional tradeoffs, especially P2 holding more centers in `engine-vs-rush-b` while P1 held more units. The persistent concern is P1's near-side access to east/southeast/center routes.
- Combat interest: **17 / 25**. Attack-bound deck damage, guardian screens, healer timing, and raider/scout trades mattered. Still, many outcomes were decided by supply-to-body conversion after positional leads emerged.

## Main Lessons

The seat-swap control separates two effects. Rush is intrinsically dangerous: P2 rush can put P1 engine under a severe unit-count clock. But P1's side remains advantaged in the center/flank problem: P1 led both flank-vs-center runs even when P2 had the center-pressure strategy.

The current map likely gives P1 too much reliable near-side pressure. Distance checks support this: P1 has `center-northeast` and `center-east` at distance 2, then `center-center-north` and `center-center` at distance 5-6. P2 has one distance-2 center, while its comparable central routes are slower or less connected.

## Recommended Next Experiment

Run E005 as a map-access variant, keeping `territory-v1-locked` unchanged. The map should reduce P1's immediate east/northeast-to-center acceleration and improve P2's ability to contest a second meaningful lane before P1's supply lead becomes a unit-count clock.
