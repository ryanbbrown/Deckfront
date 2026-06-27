# E012c Rush vs Engine A Lead-4 Response-Window Replay Notes

## Source And Retarget

- Source comparison: `.games/e010c-rush-vs-engine-a/` validates at 26 entries and confirmed P1 at 11 / 7 under the 3-unit response-window threshold.
- E012c retargets that replay to `territory-v1-cost6-damagecap-responsewin-lead4` on `sketch-v2-access`.
- Normal recruitment, supply income, delayed recruits, and the 1 deck-produced damage per attacking unit cap remain unchanged.
- Only the pending/confirmed unit-count threshold changes from 3 units to 4 units.

## Lead-4 Threat Handling

- Under E012, the old 10-to-7 start-of-turn position at P1 turn 25 is an exact 3-unit lead, so it creates no pending threat and confirms nothing.
- P1 turn 25 still recruited P1-raider-6, moving the post-turn count to 11 / 7, but pending threats are checked only at the active player's start of turn.
- P2 turn 26 was therefore a normal turn under E012, not a response to a pending threat. P2 could not recruit and only wounded P1-scout-3, so P1 started turn 27 at 11 / 7.
- P1 turn 27 recorded the first pending P1 lead-4 threat at the start check. P1 then moved the wounded scout out of P2-guardian-2's immediate melee reach, moved P1-raider-6 out of home, and recruited P1-raider-7.
- P2 turn 28 received the required full response turn. P2 recruited P2-guardian-6 and wounded P1-raider-3, but did not kill a P1 unit. Counts ended 12 / 8, so the lead stayed exactly 4 and the pending P1 threat survived.
- P1's pending lead-4 threat is confirmed at the beginning of turn 29 / round 15.

## Final Result

- Completed player turns: 28.
- Winner: P1 at the beginning of turn 29 / round 15, before income, movement, combat, or recruitment.
- Final living units: P1 12, P2 8.
- Final supply centers: P1 5, P2 2, neutral 1.
- Final saved supply: P1 3, P2 2.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field, so pending lead-4 state is recorded in timeline reasoning and these notes.
- The inherited fixed-starter-deck/draft mismatch remains inherited from the source replay; this retarget does not alter deck setup.
- Movement and attack legality remain hand-audited from the odd-column map rules; `validate-run` checks schema, snapshot existence, and continuity, not tactical legality.
- P1's turn-27 deck damage and reattack were allowed to expire because using them was unnecessary and riskier than preserving the pending lead.
- P2's turn-28 deck healing had no material use for clearing the unit-count threat.
