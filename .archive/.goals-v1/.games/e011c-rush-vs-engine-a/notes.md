# E011c Rush vs Engine A Emergency-Response Replay Notes

## Source And Retarget

- Source comparison: .games/e010c-rush-vs-engine-a validates at 26 entries under territory-v1-cost6-damagecap-responsewin.
- Source final state: P1 confirmed after P2 could not recruit or kill enough, ending P1 11 / P2 7, centers P1 5 / P2 2 / neutral 1.
- E011c retargets the line to territory-v1-cost6-damagecap-responsewin-emergency on sketch-v2-access.
- E011 keeps E010 response-window timing, normal recruitment, supply income, delayed recruits, and the 1 deck-produced damage per attacking unit cap.

## Pending Threat And Emergency Defender Handling

- Under response-window timing, the 10-to-7 count at the beginning of P1 turn 25 recorded a pending P1 unit-count win threat rather than an immediate win.
- P1 completed turn 25 and recruited P1-raider-6 from the only empty P1 home-base hex, moving the response count to P1 11 / P2 7.
- P2 received the required full response turn on turn 26.
- P2 gained 4 supply from 2 centers plus base income. Normal recruitment still required 6 supply, so E010 could not recruit here.
- Because P2 was responding to P1's pending unit-count win threat and had at least 3 supply, E011 allowed one emergency defender if legal and useful.
- P2 recruited P2-scout-1 for 3 supply at the empty P2 home-base hex 0,9, leaving 1 saved supply. The scout was chosen over guardian or healer because all three add one body immediately, and scout mobility is more useful if the response actually extends the game.
- P2-guardian-2 moved from 4,8 to 4,7 and attacked P1-scout-3 at 4,6 for 4 damage, leaving the scout alive at 4 HP.
- P2 had no legal kill available on the response turn; P2's deck counters were healing only.
- The emergency defender reduced the response count from P1 11 / P2 7 to P1 11 / P2 8, but did not reduce P1's lead below 3.
- P1's pending threat therefore remained live and was confirmed at the beginning of turn 27 / round 14.

## Final Result

- Completed player turns: 26.
- Winner: P1 at the beginning of turn 27 / round 14, before income, movement, combat, or recruitment.
- Final living units: P1 11, P2 8.
- Final supply centers: P1 5, P2 2, neutral 1.
- Final saved supply: P1 2, P2 1.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field, so pending threat state is recorded in timeline reasoning and these notes.
- Emergency defender legality was treated as satisfied because the recruit reduced the pending lead by one body and was P2's only available body response at 4 supply.
- The emergency defender did not clear the threat because the win-condition text says the pending threat clears only if the lead is reduced below 3 before the threatened player's next start-of-turn check.
- The source fixed-starter-deck/draft mismatch from E007c remains inherited and documented; this replay does not alter the deck setup.
- Movement and attack legality remain hand-audited from the odd-column map rules; validate-run checks schema and continuity, not tactical legality.
- P1's turn-25 deck damage and reattack were allowed to expire because using them was unnecessary to preserve the pending threat.
