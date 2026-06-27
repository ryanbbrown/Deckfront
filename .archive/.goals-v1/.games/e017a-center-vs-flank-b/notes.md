# E017a Center vs Flank B Notes

Turn 41 P1 start: P1 created pending tight center-control threat with 5 centers and unit count 14-11 after 40 completed player turns.
Turn 43 P1 start: pending P1 center-control threat cleared at centers P1 4 / P2 4 and units P1 15 / P2 10.
Turn 43 P1 start: P1 created pending lead-4 threat at 15-10.
Turn 45 P1 start: P1 confirmed pending lead-4 threat at 16-9.

## Final Result
- Winner: P1.
- Completed player turns: 44.
- Unit counts: P1 16, P2 9.
- Center split: P1 4, P2 4, neutral 0.
- Saved supply: P1 1, P2 19.
- Continued past 40 completed player turns because the position was not stalled: P1 created a center-control threat at the checkpoint, P2 answered it, and the unit-lead response window then resolved the game.
- Evidence quality: full if validator passes; tactical legality was generated with movement, range, occupancy, normal income, response-window threats, and recruit-cost checks.

## Rules Calls
- Normal income used: 2 + controlled centers. Recruitment cost remained 6 supply per unit.
- Deck damage was attached to legal attacks and capped at 1 deck damage per attacking unit; unused damage expired.
- Pending lead-4 state is logged here and in timeline reasoning because board.json has no field for it.
- Tight center-control was gated until at least 16 completed timeline entries, then required 5+ centers and a 2-unit living-unit lead.
- Pending center-control state is logged here and in timeline reasoning because board.json has no field for it.
