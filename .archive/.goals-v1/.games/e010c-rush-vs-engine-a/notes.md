# E010c Rush vs Engine A Response-Window Replay Notes

## Source And Retarget

- Source comparison: .games/e007c-rush-vs-engine-a validated at 24 entries under territory-v1-cost6-damagecap.
- Source final state: P1 10 living units, P2 7 living units, with P1 active at round 13.
- E010c retargets the line to territory-v1-cost6-damagecap-responsewin on sketch-v2-access.
- Normal recruitment, supply income, delayed recruits, and the 1 deck-produced damage per attacking unit cap remain unchanged.

## Pending Threat Handling

- Under the old immediate start-turn unit-count check, P1 won at the beginning of turn 25.
- Under response-window timing, the same 10-to-7 count at the beginning of P1 turn 25 records a pending P1 unit-count win threat, not a confirmed win.
- P1 then completed turn 25 and recruited one delayed raider from the only empty home-base hex, moving the count to P1 11 / P2 7.
- P2 received the required full response turn on turn 26.
- P2 gained only 4 supply, below the 6 required to recruit, and could not kill enough P1 units. P2-guardian-2 wounded P1-scout-3 to 4 HP but did not reduce the lead below 3.
- P1's pending threat was therefore confirmed at the beginning of turn 27 / round 14.

## Final Result

- Completed player turns: 26.
- Winner: P1 at the beginning of turn 27 / round 14, before income, movement, combat, or recruitment.
- Final living units: P1 11, P2 7.
- Final supply centers: P1 5, P2 2, neutral 1.
- Final saved supply: P1 2, P2 4.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field, so pending threat state is recorded in timeline reasoning and these notes.
- The source fixed-starter-deck/draft mismatch from E007c remains inherited and documented; this replay does not alter the deck setup.
- Movement and attack legality remain hand-audited from the odd-column map rules; validate-run checks schema and continuity, not tactical legality.
- P1's turn-25 deck damage and reattack were allowed to expire because using them was unnecessary to preserve the pending threat.
