# E018a Upgrade/Support vs Swarm/Economy

Ruleset: territory-v1-cost6-damagecap-responsewin-lead4-no-printheal
Map: sketch-v3-contest
Deck seed: 18018

Important rules calls:
- Printed druid/healer unit healing was never used; their printed heal is treated as 0.
- Deck heal counters and upgradeHealth healing were allowed.
- Deck damage was attached only to legal attacks and capped at 1 deck damage per attacking unit.
- Pending lead-4 win markers are tracked in timeline reasoning and in these notes, not board.json.

- turn-043: pending P1 lead-4 threat created at 9-5 living units.
- turn-044: pending P1 lead threat cleared at 8-6 living units.
- turn-045: pending P1 lead-4 threat created at 9-5 living units.
- turn-046: pending P1 lead threat cleared at 8-6 living units.
- turn-047: pending P1 lead-4 threat created at 9-4 living units.
- turn-048: pending P1 lead threat cleared at 8-6 living units.
- turn-049: pending P1 lead-4 threat created at 8-4 living units.
- turn-050: pending P1 lead-4 threat created at 8-4 living units.
- turn-051: P1 won at start of turn by confirmed lead-4 unit-count response window.

Final state:
- Winner: P1
- Completed player turns: 50
- Unit counts: P1 8, P2 4
- Center split: P1 5, P2 3, neutral 0
- Supply saved: P1 5, P2 5

Support/healing observations:
- P1 support remained relevant through Armory, Training, Bandage, Potion, and Healer cards, but missing repeatable printed healing meant damaged guardians stayed vulnerable between deck-heal turns.
- P2 swarm/economy could convert center control into frequent recruits, but the lead-4 response window still gave P1 chances to answer with kills and deck heal rather than folding instantly.
- No printed unit healing was applied by druids or healers in any board phase.
