# E001 Rush vs Engine A Notes

- Seeded board from `.games/territory-v1-playtest/snapshots/turn-001.before.board.json` as requested.
- That seed uses corrected low-HP starter units rather than max-HP units from `units.json`, making early combat much more lethal.
- Deck damage was treated as extra damage assigned through a legal attack, not free global direct damage.
- Druid healing was applied conservatively during P2 board phases where relevant.
- Stopped after 12 completed player turns with P1 ahead on units and supply center control; the start-of-turn unit-lead win condition had not yet fired at the final completed turn.
