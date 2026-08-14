# Larger board

## Approved scope

Increase the playable board by one hex ring. Use axial radius 3 with 37 hexes. Keep all four starting positions and respawn anchors on the current inner ring.

Do not change the starting deck, card rules, score target, market, or AI strategy in this change.

## Required behavior

- Use one shared board-radius constant for board bounds and coordinate generation.
- Treat coordinates at distance 3 from the center as playable.
- Treat coordinates at distance 4 as off-board.
- Render all 37 hexes without clipping or overlapping surrounding controls.
- Keep the current starting positions and respawn anchors unchanged.
- Require three outward displacements to ring out a piece that starts on ring 1.
- Let two Shoves move that piece to the edge without scoring.
- Let a third outward displacement ring it out and score once.
- Preserve all card, status, purchase, undo, replay, persistence, and AI behavior.

## Validation

- Add direct board-rule tests for the 37-cell board and radius boundaries.
- Add a regression that proves two Shoves do not score from ring 1 and a third scores.
- Update scenario tests to place intended edge targets on the new outer ring.
- Run unit tests, typecheck, lint, build, the coverage manifest, and the full browser suite.
- Complete a live browser check of the 37-hex board and one real AI handoff.
