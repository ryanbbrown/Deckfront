# E013b Rush vs Engine D Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e013-contest-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player.
- P1 strategy: early damage/tempo with Zap/Blast/Second Wind used only when they supported concrete attacks.
- P2 strategy: engine/healing/economy, preserving units while contesting the lower centers.

## Lead-4 Threat Handling

- No lead-4 threat existed through turn 20. P1 had pressure, but P2's recruits and the turn-16 scout kill kept the deficit below 4 at start-of-turn checks.
- Turn 21 / P1 start: P1 began at 10 units to P2's 6, so P1 recorded a pending lead-4 threat.
- Turn 21 / P1 board phase: P1 killed P2 Guardian-2 and recruited Marksman-4, ending at P1 11 / P2 5.
- Turn 22 / P2 response: P2 killed P1 Raider-3 and recruited Scout-4, ending at P1 10 / P2 6.
- Winner: P1 confirms the pending lead-4 threat at the beginning of turn 23 / round 12, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 22.
- Winner: P1 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 10, P2 6.
- Final supply centers: P1 5, P2 3, neutral 0.
- Final saved supply: P1 5, P2 10.

## Map And Strategy Takeaways

- This repeat found a cleaner P1 rush line than the earlier A run: P1 held northeast/east/southeast plus center-north/center long enough for the 5-3 income edge to become extra bodies.
- P2's engine did stabilize the first rush wave and killed two P1 units, but the turn-17 healer wound made later guardian preservation fail.
- The contest map still created counterplay: P2 flipped northwest late and forced P1 to win by unit lead rather than by a permanent 6-2 supply lock.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was recorded only when attached to concrete attacks; excess produced damage expired.
- Tactical board play was manually recorded turn by turn. `validate-run` verifies schema, snapshot existence, and continuity, not full tactical legality.
- Evidence quality: full, assuming reviewer accepts the manually recorded movement/combat decisions; no known material legality issue was identified during this playthrough.
