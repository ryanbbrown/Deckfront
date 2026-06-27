# E001 Center vs Flank B Notes

- Initial board was seeded from `.games/territory-v1-playtest/snapshots/turn-001.before.board.json`, including damaged starting units.
- Interpreted deck `damage` as extra damage attached to a legal attacking unit this turn, not standalone direct damage.
- Interpreted deck `heal` as assignable healing up to max HP on friendly living units during the active board phase.
- Native druid/healer unit healing was applied conservatively as one support heal during that player's board phase.
- P2's desired healing/control unit plan was supply-constrained after the early scout recruit; healer support did not enter until turn 008.
- Stopped after 8 completed player turns at a stable baseline checkpoint: P1 5 units, P2 5 units, P1 controls 4 centers, P2 controls 3 centers, and center-northwest is neutral.
- Main ambiguity: exact ordering inside board phase. I resolved supply income, recruitment, movement, then attacks/heals where tactically noted.
