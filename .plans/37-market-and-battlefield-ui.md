# Market and battlefield UI

## Goal

Implement the approved market and tactical-map battlefield mockups in the game UI without changing the hand, played-card, action-rail, or card-face designs.

Reference files:

- `.html/market-visual-directions.html`
- `.html/battlefield-visual-directions.html`

## Decisions

- Reduce the table header from 62px to 42px and give the recovered 20px to the market.
- Keep the arena within its current 94px row.
- Put fixed and Kingdom piles beside each other. Fixed piles use a 2-by-3 grid. Kingdom piles use a 5-by-2 grid.
- Make Scrap the sixth always-available action pile with the same 10-card supply as Step and Focus. It is a normal cost-0 purchase. Existing gain effects continue to exclude Scrap.
- Use card art in every market pile. Fixed piles use a small top title shadow, cost at bottom-left, and quantity at bottom-right. Kingdom piles use the approved larger title shadow, cost at bottom-left, quantity at top-right, and short rules text at bottom-right.
- Keep right-click and keyboard card inspection, purchase animation anchors, disabled states, starting-build selection, and responsive minimum dimensions working.
- Replace the plain arena with the approved Tactical Map treatment: parchment grid, contour lines, and six clear positions.
- Replace each player rectangle with a compact helmeted fighter counter. Each counter shows `P1` or `P2` and makes HP the strongest text.
- Two fighter counters must fit side by side when both players occupy one position.
- Keep movement-choice buttons, damage feedback, Aimed and Exposed status, player labels, test selectors, and accessible names working.
- Use the same battlefield presentation on the setup preview and in a running game.

## Implementation steps

1. Add Scrap to the always-available market contract, supply, setup response, and tests. Confirm that normal purchases include Scrap and gain effects still exclude it.
2. Replace `CompactMarket` markup and styles with the side-by-side image market. Update affected E2E selectors and assertions. Verify preview, starting build, buy availability, depletion, card inspection, and purchase previews.
3. Add one reusable fighter counter component and use it in `Board` and `PreviewArena`. Apply the Tactical Map styles and preserve movement and damage behavior. Add an E2E assertion that two full counters fit inside one space without overlap or overflow.
4. Run the relevant focused tests after each step, then run the complete required validation.

## Acceptance checks

- The fixed market shows Copper, Silver, Gold, Step, Focus, and Scrap in two columns and three rows.
- The Kingdom market shows ten image piles in five columns and two rows.
- Market counts are overlays and do not add vertical rows.
- The top bar is 42px high and the market receives the recovered height.
- Existing hand and played-card dimensions and faces are unchanged.
- Scrap starts with 10 cards, can be bought for 0 money, decrements after purchase, and remains unavailable to gain effects that exclude it.
- The battlefield has six visible Tactical Map positions.
- P1 and P2 counters show a helmeted fighter, an emphasized HP value, and full accessible player names.
- Both counters fit in one position when the fighters share a space.
- Movement targets remain clickable and damage feedback remains visible.
- The setup preview uses the same market and battlefield designs.
- The interface fits at 1280×720 and 1920×1080 without page scrolling or clipped required controls.

## Validation

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:e2e`
- Inspect screenshots of the setup preview and a shared-space game at 1280×720 and 1920×1080.
