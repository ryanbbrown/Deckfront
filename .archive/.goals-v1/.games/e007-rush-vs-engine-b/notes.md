# E007 Rush vs Engine B Notes

## Strategy

- P1 followed the assigned rush/tempo plan: early Blast/Zap pressure, fast east and center captures, and scout/raider recruits when supply reached 6.
- P2 followed the assigned slower engine/stabilization plan: Village/Peddler/Silver/Gold development, guardians as screens, and druid support when the line started taking damage.

## Rules Calls

- Fixed starting decks used the requested 7 Copper plus 11-cost draft packages for each player; no draft coin carried over.
- Recruited units were treated as delayed. They entered at the end of the recruiting board phase and did not move, attack, heal, capture, or reattack until that player's next board phase.
- Deck damage was attached only to legal attacks by ready units. Each attacker received at most 1 extra deck-produced damage for the whole turn; unassigned damage expired.
- Printed druid healing was used instead of attacking on turns where the notes say P2 preserved a damaged unit.

## Ambiguities

- The board state schema has no explicit readiness marker for newly recruited units, so delayed activation is tracked in timeline reasoning rather than in JSON.
- Movement and attack legality were resolved manually from the odd-column map rules; validation checks bundle continuity but does not independently verify tactical legality.
- Some P1 turns produced more deck damage than available legal attacking units could assign. I used the least expansive interpretation and expired the excess.

## Stopping Point

- Stopped after 16 completed player turns, at the target evidence window.
- No start-of-turn unit-count win occurred. Final living units: P1 7, P2 7.
- Final supply centers: P1 5, P2 2, neutral 1.
- Final saved supply: P1 5, P2 5.
- Leader: P1 by supply centers and board pressure; unit count is tied, so there is no winner yet.

## Evidence Quality

- Evidence quality: full for replay continuity and damage-cap stress, with the tactical-legality caveat above.
- The key observation is that the cap repeatedly prevented P1 from converting large Blast/Zap hands into single-attacker kills. P2 survived to the 16-turn window with equal living units, but P1 still led the center economy.
