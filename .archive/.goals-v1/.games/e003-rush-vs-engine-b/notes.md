# E003 Rush vs Engine B Notes

## Setup

- Ruleset: `territory-v1-locked`
- Map: `sketch-v1`
- Starter board: `.games/e003-locked-starter.board.json`
- Title: `E003 Rush vs Engine B`
- Initial deck state was created through the CLI with `--starting-deck` before any turn actions were saved.
- P1 starting deck: `copper,copper,copper,copper,copper,copper,copper,blast,blast,zap`
- P2 starting deck: `copper,copper,copper,copper,copper,copper,copper,village,peddler,silver`

## Strategy

- P1 deck plan: early damage and tempo, buying Blast/Zap/Silver or tactical cards while avoiding Copper.
- P1 board plan: rush east/northeast, pressure the center, and respect delayed recruit activation.
- P1 unit priorities: scouts and raiders carried pressure and center flips; marksman stayed behind the line.
- P2 deck plan: slower economy/engine, prioritizing Village/Peddler/Silver/Gold and avoiding Copper.
- P2 board plan: preserve units, take west/south and central centers safely, then stabilize with guardians/druids.
- P2 unit priorities: guardians screened, druids stabilized or attacked when preventing unit-count loss mattered more than healing.

## Rules Calls

- Recruited units were placed in empty home-base hexes at the end of the board phase and did not move, attack, heal, capture, or reattack until their controller's next board phase.
- Deck damage was assigned only through legal attacks by ready units. Damage with no legal target expired.
- P1 used deck damage conservatively under the locked interpretation: no direct global damage, no damage from newly recruited units, and no storm-style splitting without `stormTargets`.
- Supply income was collected before movement/captures each board phase.
- Control of a center persisted after a unit left or died; the center only flipped when a unit ended movement there.
- The unit-count win check was applied at the beginning of the active player's turn. P2 did not lose at the start of turn 10 even though P1 had the larger army; P1 wins at the start of P1 round 6.

## Stopping Point

Stopped after 10 completed player turns. Final board state is P1 to act in round 6 with 8 living P1 units versus 5 living P2 units. Under the locked win condition, P1 wins before deck, income, movement, combat, or recruitment can happen on that turn.

P2's engine bought repeated Golds, but the economy did not convert into enough board stabilization before P1's Blast/Zap turns killed both P2 scouts and kept recruitment pressure high.

## Ambiguities

- No unresolved rules ambiguity is known for validation purposes.
- Board state has no explicit ready/exhausted marker, so delayed recruit status is documented in timeline reasoning instead of encoded in `board.json`.
- Deck phases were advanced with the repo's deck engine using the same action rules as the CLI; the fixed starting decks were initialized through the requested CLI `--starting-deck` path.

## Evidence Quality

`full`: replay validation passes, before/after deck and board snapshots exist for every completed player turn, the stopping point follows the written win condition, and material rules calls are recorded above.
