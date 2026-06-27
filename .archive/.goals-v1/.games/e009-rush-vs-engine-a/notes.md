# E009 Rush vs Engine A Notes

## Strategy

- P1 followed the assigned rush/tempo plan: early Zap/Blast pressure, center-first movement, and continued damage buys with enough Silver/Second Wind support to keep capped attacks relevant.
- P1 used start-of-turn trashing in the deck plan when weak Rest/Copper cards were exposed by the scripted line; deck snapshots are hand-authored continuations from the prior damage-cap rush line and preserve replay continuity.
- P2 followed the assigned economy/engine/healing plan: Village/Peddler/Gold/Healer/Potion buys, preserving guardians and support units while contesting enough centers to avoid an immediate 5-2 lock snowball.
- Both players obeyed the E009 one-recruit-per-turn cap from the first recruit onward.

## Rules Calls

- The run was initialized with `bun run init-run` from `.games/e009-recruitcap-starter.board.json` using ruleset `territory-v1-cost6-damagecap-recruitcap` and map `sketch-v2-access`.
- The first 22 turns replay the validated E007c rush-vs-engine A line retargeted to the E009 ruleset; no turn in that prefix used more than one recruit, so the recruit-cap branch first changes the game on turn 23.
- On turn 23, P1 had enough saved supply for multiple recruits under the previous rules, but recruited only `P1-raider-5` and banked the remaining supply.
- Recruited units were delayed. The board schema has no readiness marker, so delayed activation is tracked in timeline reasoning.
- Deck damage was attached only to legal attacks by ready units, with at most 1 deck-produced damage per attacking unit per turn; excess damage expired.
- Healing was capped at max HP and could not revive removed units.

## Ambiguities

- The rules text describes 7 Copper plus 12 draft coin, while `deck.yaml` encodes a fixed starter deck. This run follows the initialized/snapshot deck line and treats card choices as the scripted strategy plan.
- Movement and attack legality were hand-audited from the odd-column map rules. `validate-run` verifies schema, snapshot existence, active player/round alignment, and continuity, not tactical legality.
- The turn-23 branch is intentionally derived from E007c to isolate the recruit-cap change at the exact old multi-recruit swing.

## Checkpoints

- After 16 completed player turns: no winner; living units P1 6 / P2 7; centers P1 4 / P2 2 / neutral 2; saved supply P1 5 / P2 2.
- After 24 completed player turns: no winner; living units P1 8 / P2 7; centers P1 5 / P2 2 / neutral 1; saved supply P1 13 / P2 0. In the prior no-recruit-cap line, this position would have been a P1 start-turn win because turn 23 produced three P1 recruits.

## Final Result

- Continued to 32 completed player turns.
- Winner: P1 at the beginning of turn 33 / round 17, before income, movement, combat, or recruitment.
- Final living units: P1 9, P2 6.
- Final supply centers: P1 5, P2 2, neutral 1.
- Final saved supply: P1 17, P2 4.
- The one-recruit cap prevented the old fast 3-unit win and gave P2 several response turns, but P1's 5-2 center lead still produced enough consistent one-body turns that P2 eventually ran out of kill/recruit responses.

## Evidence Quality

- Evidence quality: full for replay-bundle continuity after validation; partial for tactical precision because the board play is hand-authored and the fixed-starting-deck/draft mismatch remains documented.
