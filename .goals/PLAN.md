# Plan

## Current Strategy

Rerun baseline matchups from the corrected max-HP starter board.

Each experiment should use 2-3 strategy matchups, with 2 parallel playthroughs per matchup.

## Next Queue

1. E002 - Baseline rerun using `.games/territory-v1-playtest/snapshots/turn-001.before.board.json` as the max-HP starter board, with clarified support/damage timing.
2. E003 - Early board-pressure variant if rush remains too strong.
3. E004 - Slower deck-engine stabilization variant.
4. E005 - Unit role differentiation variant.

## Current Best

E001 scored 68 / 100 as partial evidence. It showed strong board tension but exposed a damaged-starter setup flaw.

## Open Questions

- Should deck `damage` require a legal unit attack?
- How exactly do druid/healer unit healing actions work?
- What is the board phase order for income, recruitment, movement, combat, and healing?
- Can slower deck-building catch up after early board pressure?
