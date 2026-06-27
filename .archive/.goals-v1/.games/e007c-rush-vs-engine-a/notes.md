# E007c Rush vs Engine A Notes

## Strategy

- P1 followed the assigned rush/tempo plan: early Zap/Blast buys, fast northeast/east/center flips, and raider/scout replacement when supply reached 6.
- P2 followed the assigned economy/engine/healing stabilization plan: Village/Peddler/Gold/Healer buys, guarded support units, and delayed recruits to keep at least two viable attackers or contestants.

## Rules Calls

- The run was initialized from `.games/e007-damagecap-starter.board.json` under `territory-v1-cost6-damagecap` on `sketch-v2-access`.
- The rules text describes 7 Copper plus draft coin, while `deck.yaml` and the run initializer encode a fixed starter deck. I used the initialized deck state for snapshots and treated the timeline hands as the drafted strategy plan; this is a setup ambiguity, not a board-state rules change.
- Recruited units were delayed. They entered at the end of the board phase and did not move, attack, heal, capture, or reattack until that player's next board phase.
- Deck damage was attached only to legal attacks by ready units, with at most 1 deck-produced damage per attacking unit per turn. Excess damage expired.
- Printed healing and deck-produced healing were capped at max HP and could not revive removed units.

## Ambiguities

- The board schema has no readiness marker for newly recruited units, so delayed activation is tracked in the timeline reasoning.
- Movement and attack legality were hand-audited from the odd-column map rules; `validate-run` verifies schema and continuity, not tactical legality.
- Several P1 turns produced more deck damage than could legally attach under the cap. I used the least expansive interpretation and expired the excess.

## Checkpoint

- The original checkpoint after 16 completed player turns was unresolved.
- No legal earlier winner occurred: no start-of-turn check had either player leading by at least 3 living units.
- Checkpoint living units: P1 6, P2 7.
- Checkpoint supply centers: P1 4, P2 2, neutral 2.
- Checkpoint saved supply: P1 5, P2 2.

## Final Result

- Continued to 24 completed player turns.
- Winner: P1 at the beginning of turn 25 / round 13, before income, movement, combat, or recruitment.
- Final living units: P1 10, P2 7.
- Final supply centers: P1 5, P2 2, neutral 1.
- Final saved supply: P1 1, P2 0.
- P1's decisive swing came on turn 23: capped attacks killed the center-south guardian, then a Second Wind reattack killed the wounded west-south marksman. P2 recruited once on turn 24 but could only reduce the deficit to three units.

## Evidence Quality

- Evidence quality: full for replay-bundle continuity, partial for tactical precision because board play is hand-authored and the fixed-starting-deck/draft mismatch remains documented.
- Key observation: the 1 deck-produced damage per attacking unit cap prevented P1 from turning large damage hands into single-attacker kills, but P1 still converted early access into a center lead.
