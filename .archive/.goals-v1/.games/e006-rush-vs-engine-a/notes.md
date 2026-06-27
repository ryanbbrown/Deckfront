# E006 Rush vs Engine A Notes

## Setup

- Ruleset: territory-v1-cost6.
- Map: sketch-v2-access.
- Initial board: .games/e006-cost6-starter.board.json.
- Fixed starting decks were used instead of the ruleset default draft.
- P1 starter: copper,copper,copper,copper,copper,copper,copper,blast,blast,zap.
- P2 starter: copper,copper,copper,copper,copper,copper,copper,village,peddler,silver.

## Strategy

- P1 played rush/tempo: early center access, pressure with scouts and raiders, and no Copper buys.
- P2 played engine/stabilization: Village/Peddler/Silver/Gold development, guardian screens, and druid healing when it preserved a contested unit.
- Both players used start-of-turn trashing opportunistically; this made the decks cleaner but sometimes reduced the immediate buy.

## Rules Calls

- Recruits cost 6 supply and entered delayed; they did not move, attack, heal, capture, or reattack until the next friendly board phase.
- Deck damage was attached only to legal attacks by ready friendly units. When no legal attack existed, the damage was unused.
- Printed druid healing was used instead of attacking on turns where preserving a damaged scout mattered.
- The start-of-turn unit-count win check was not triggered during the 16 recorded completed turns. The final state is active P1, round 9, with an 8-5 unit lead, so applying that next start-turn check gives P1 the win before further actions.

## Ambiguities

- The CLI deck phase allows aggressive Copper trashing. In this fixed starter, P1's first hand had only three Coppers, so trashing one meant no turn-1 buy despite producing Blast damage. I kept the choice because the playtest guide favors trashing weak cards, but it may understate P1's deck tempo.
- Board legality was recorded manually. I used conservative odd-column movement and delayed-recruit timing, but the validator checks replay continuity rather than tactical legality.
- Some deck damage was intentionally unused when no legal target or useful kill existed.

## Stopping Point

- Stopped after 16 completed player turns.
- Final control: P1 controls northwest, center-north, center, northeast, and east; P2 controls west-south and center-south; southeast remains neutral.
- Final saved supply: P1 5, P2 5.
- Final unit count: P1 8, P2 5. P1 is the clear leader and wins on the pending start-turn check before taking another action.

## Evidence Quality

- Evidence quality: partial.
- The replay validates structurally and captures the intended cost-6 tension, but the board phase is hand-authored and not engine-validated. Treat the exact tactics as useful playtest evidence rather than a fully adjudicated rules proof.
