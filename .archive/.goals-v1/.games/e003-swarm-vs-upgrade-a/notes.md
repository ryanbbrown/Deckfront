# E003 Swarm vs Upgrade A Notes

## Strategy Execution

- P1 followed the swarm/economy assignment: early Gold buys from the fixed starter, Copper trashing once it did not block payload, then Peddler, Storm, and Second Wind as support/tactical buys.
- P1 converted center control into board quantity. The key swing was turn 13, where six controlled centers produced enough supply for two delayed recruits.
- P2 followed the upgrade/heal assignment: Armory, Training, Potion, Healer, and Bandage were prioritized over Copper. The upgraded marksman carried most of P2's removal.
- P2 preserved a smaller elite formation for several turns, but falling to one controlled center meant turn 14 produced only 3 supply and no recruit.

## Rules Calls

- Recruited units were delayed. They entered during recruitment and did not move, attack, heal, capture, or receive reattack on that same board phase.
- Deck damage was only assigned alongside legal attacks by active ready units. Unused early Zap damage was not treated as direct global damage.
- Armory and Training upgrades were recorded directly on the target unit's `maxHp`, `hp`, and `attack` fields.
- Potion/Healer/Bandage-style deck healing was capped at target max HP and did not revive removed units.
- Start-turn win checks were applied before each active turn. After turn 14, board state advances to P1 round 8 with P1 leading 8 living units to 5, so P1 wins at that start-turn check before any turn-15 deck phase.

## Ambiguities

- The validator checks replay continuity and schema, not tactical movement/combat legality. Movement, attacks, and captures were checked manually.
- Several ranged attacks depend on shortest-path odd-column distance. I used the locked odd-column movement table and chose conservative targets when uncertain.
- P2's turn 14 illustrates a timing edge: because the win check happens at the start of P1's next turn, P2 was allowed a full response, but healing without damage or recruit could not reduce P1's unit lead.

## Stopping Point

- Stopped after 14 completed player turns.
- Winner: P1 by start-of-turn unit-count lead at the beginning of P1 round 8.
- Final living unit count: P1 8, P2 5.
- Final supply-center control: P1 controls 6 centers, P2 controls 1 center, and 1 center remains neutral.
- Final saved board supply: P1 2, P2 3.

## Evidence Quality

- Evidence quality: full for replay structure and deck CLI snapshots; medium-high for tactical board evidence because board legality is manual.
- The run uses the exact requested fixed starting decks via CLI `--starting-deck` before the first deck save.
- The final state is decisive for the intended tension: quantity from board income overcame P2's upgraded durable formation once P2 lost enough center income to miss a response recruit.
