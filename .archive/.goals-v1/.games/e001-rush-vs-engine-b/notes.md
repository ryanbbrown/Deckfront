# E001 Rush vs Engine B Notes

## Setup

- Ruleset: `territory-v1`.
- Map: `sketch-v1`.
- Board seed copied from `.games/territory-v1-playtest/snapshots/turn-001.before.board.json`.
- P1 played early damage / board pressure and avoided Copper buys.
- P2 played slower engine scaling and avoided Copper buys.

## Outcome

- Stopped after 12 completed player turns.
- P1 wins at the beginning of turn 013 by the 3-unit lead condition: P1 has 7 living units, P2 has 4.
- P1 controlled four supply centers for most of the middle game, which funded repeated recruits and kept P2 below stabilization pace.

## Rules Ambiguities Logged

- Deck `damage` was interpreted conservatively: it was not used as direct spell damage without a legal unit attack.
- `bonusHp` did not appear in a relevant deck turn, so temporary vs persistent HP was not tested.
- Druid/healer printed `heal` stats were not used as automatic board healing because timing/targeting is not specified in the rules contract.

## Play Pattern Notes

- The seeded low-HP units made early scout trades very lethal.
- P1 reached a durable supply lead by taking northeast, east, center-north, and center-center before P2 could contest.
- P2 engine buys improved deck quality, but the board state ended before that scaling could matter much.
