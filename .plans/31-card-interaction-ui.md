# Card interaction UI

## Scope

Improve gameplay interactions and card layout without changing game rules or starting a broader UI redesign.

## Decisions

- Movement choices appear on the arena. A legal destination space is a real button with a clear highlight and action label. The current, left, and right spaces are used as applicable. A wall-collision direction maps to the fighter's current edge space and states that it moves into the wall.
- Pending discard and trash choices use the hand. Clicking an eligible hand stack selects one physical card, highlights it, and shows compact confirm/skip controls near the hand. No card-name strip or card-picker modal is used for hand choices.
- Recover and gain choices use one reusable modal card picker. It renders canonical card faces, groups identical cards into stacks, shows an absolute count badge, and resolves one physical choice from the clicked stack.
- The server projects each pending choice's card definition ID. The client does not parse display labels to identify cards.
- A grouped hand card with at least two directly playable copies gets an absolute `Play all ×N` control at the bottom right. It submits one current legal action at a time and stops when no matching direct play remains. Cards that need movement or target choices do not offer Play all.
- Hand groups get a stable order for the active player's turn. Initial groups keep draw order; groups that first appear later append on the right. Playing one copy does not move the remaining stack. Undo can restore a group to its prior slot. The order resets for the next active-player turn.
- Fixed and kingdom markets are centered. Kingdom uses exactly five columns, so ten kingdom piles always use two complete rows. The row and table sizing must not clip the second row, and vertical labels are centered.
- Every card face uses one canonical internal layout. Smaller played cards scale that layout instead of reflowing it. Headers start at the top, count badges are absolute at the top right and do not consume title width, rule text has no white panel, and text tiers fit long current card text without clipping.

## Acceptance checks

- Footwork, Step, Drive, and other presented movement choices are selectable on legal arena spaces; the old movement choice bar is absent.
- Reclaim shows a grouped visual discard picker. Multiple identical discard cards show one stack and the correct count.
- Mandatory discard and optional trash choices select and highlight cards in the hand and resolve through hand controls. Existing targeted play-card selection still works.
- A stack of directly playable copies can play all through one control. A movement or target-dependent stack cannot bypass its required choice.
- Removing one copy from a hand stack does not change that stack's horizontal position in the same turn. Newly drawn definitions append.
- At supported desktop sizes, kingdom piles render as centered 5-by-2 rows with no clipped pile, and the Kingdom label is vertically centered.
- Card banners, count badges, and line breaks are consistent between hand, played, reference, and picker contexts. Reclaim, Precision Shot, Salvage Shot, Drive, and Repelling Shot text remains visible.
- No gameplay rule, AI strategy, or unrelated UI redesign changes.

## Validation

Run after implementation and review fixes:

- Relevant Vitest and Playwright UI tests, including new regressions for the interactions and layout above.
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
