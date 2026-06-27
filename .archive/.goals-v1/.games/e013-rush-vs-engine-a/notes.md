# E013 Rush vs Engine A Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e013-contest-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player. The rules prose still mentions an older 7-Copper draft baseline, so this run records the fixed deck-file setup as the operative setup.
- P1 strategy: early damage and tempo, rushing the northeast/east/center cluster to test whether a 5-2 or 6-2 lock is still reliable.
- P2 strategy: economy, draw/actions, healing, and preservation, contesting center-south/east/southeast early instead of racing raw damage.

## Lead-4 Threat Handling

- No lead-4 threat existed through turn 14 because the active start-of-turn checks never found an active-player 4-unit lead.
- Turn 15 / P1 start: P1 began at 9 units to P2's 5, so P1 recorded a pending lead-4 threat. P1 recruited to 10 / 5 and forced P2 to answer.
- Turn 16 / P2 response: P2 recruited Guardian-4 and killed P1 Scout-1, changing the count to P1 9 / P2 6. The lead dropped below 4, clearing P1's pending threat.
- Turn 22 / P2 start: after the engine swing, P2 began at 9 units to P1's 5, so P2 recorded a pending lead-4 threat. P2 recruited Druid-4 and ended at 10 / 5.
- Turn 23 / P1 response: P1 recruited Marksman-4 but did not kill a P2 unit, ending at P1 6 / P2 10. The P2 lead stayed exactly 4.
- Winner: P2 confirms the pending lead-4 threat at the beginning of turn 24 / round 12, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 23.
- Winner: P2 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 6, P2 10.
- Final supply centers: P1 2, P2 5, neutral 1.
- Final saved supply: P1 0, P2 1.

## Map And Strategy Takeaways

- P1 temporarily achieved the intended 5-center pressure posture, but P2's earlier southeast/east contest kept the rush from becoming a stable 6-2 lock.
- The shifted east/southeast centers gave P2 enough reachable counterplay to preserve units, clear P1's first pending threat, and later turn the board with an engine/heal payload.
- P1's damage-heavy deck still mattered: it created the first pending lead-4 threat and forced P2 into a precise response. It was not enough once P2's healing and recruit economy came online.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Storm on turn 20 used the least expansive interpretation: one legal original target plus one adjacent occupied enemy storm target, with base attack damage only on the original target.
- Tactical movement, targeting, and supply math were hand-audited; `validate-run` verifies schema, snapshot existence, and continuity, not full combat legality.
