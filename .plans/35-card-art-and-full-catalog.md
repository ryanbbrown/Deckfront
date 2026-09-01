# Card art and full catalog

Pre-implementation SHA: `6b7cdd53d83349bffc4f4b7d5fbd5f53ba8b5593`

## Goal

Use the selected illustration for every card, apply the approved card format everywhere, and add a full-width viewer for all 46 cards.

## Implementation

1. Ship one selected image for each of the 46 cards at `public/card-art/<card-id>.jpg`.
2. Update the shared card face to use `/card-art/<card-id>.jpg` and the approved format: 32px title, edge-to-edge 96px art, no image rails or title keylines, and the compact 20px cost badge at bottom 1px and left 2px.
3. Add a `View all cards` button next to `New game` in the game action rail.
4. Open a full-viewport card catalog from that button. Group cards by family in the order Treasure, Engine, Melee, Ranged, Mana. Sort each family by cost, then name.
5. Render catalog cards at 222×330px, which is 1.5 times the current 148×220px reference card size. Let the catalog body scroll while its header and close control stay visible.
6. Keep the existing market reference for the current 16-card market.

## Verification

- Add a test that every card definition has a selected public image.
- Add a test for full-catalog family, cost, and name ordering.
- Add an end-to-end test that opens `View all cards`, sees all 46 cards, confirms the full-width overlay and 222×330px cards, verifies representative ordering, and closes it.
- Update existing card-layout expectations for the 96px image format.
- Run relevant unit tests, typecheck, lint, build, and the relevant Playwright test.
