# Multi-level undo and action rail

## Goal

Let players undo every browser-game action back to the start of play. Replace both side drawers with an always-visible right rail that shows the full public action history and each player’s deck composition.

## Decisions

- Undo history belongs to persisted browser games in `GameService`. Simulation games must not create or maintain undo history.
- Players can undo one submitted action at a time until they reach the state immediately after both starting builds are complete.
- An AI response is part of the human action that caused it. One undo restores the previous human decision point and never exposes a state in the middle of an AI turn.
- Starting-build edits and submissions are not part of multi-level undo.
- The right rail is always visible on the 1920×1080 table. The page itself must not scroll.
- The action log is the only normally scrollable part of the table.
- The log shows public actions from both players, including AI actions. It must not reveal hands, draw order, or other hidden card information.
- The fixed bottom of the rail shows the full owned-deck composition for Ochre and Indigo as card names and counts.
- Do not show zone counts.
- Remove the left deck drawer, the right opponent drawer, and both edge toggle buttons.

## Implementation

1. Replace the single `undoCheckpoint` with an ordered persisted undo history. Each entry stores the command count and the existing completion metadata needed to replay the prior state without storing a full game-state copy.
2. Add one history entry before each human or local-player action. Keep automatic AI commands after that entry so undo removes the initiating human action and the complete AI response together.
3. On undo, remove the latest history entry, replay commands to its command count, and leave earlier entries available. Keep `canUndo` true while any entry remains.
4. Keep starting-build updates outside the undo history. Clear any undo history while setup is incomplete.
5. Migrate the persisted record schema directly to the new current shape. This greenfield project does not need backward compatibility for old local save files.
6. Return public events for both players in AI and local games. Convert events into clear action-log text in the client. Include turn starts, cards played, movement, damage, conditions, discards, recovery, trashing, phase changes, purchases, and victory. Omit or generalize events that reveal hidden cards or draw order.
7. Replace the side drawers and edge controls with a fixed right rail. Use a flexible, scrollable log above a fixed deck-composition section.
8. Group log entries by turn or make turn-start entries visually distinct. Keep entries in chronological order and keep the newest action visible when new events arrive, without taking keyboard focus.
9. Show both complete owned decks at all times in compact two-column summaries. Derive these summaries from the existing deck counts.
10. Rebalance the center table width so the market, played area, and hand remain usable at 1920×1080 with no document overflow.
11. Update README or other current UI documentation if it describes the removed drawers or one-level undo.

## Tests

- Server integration: commit at least three actions, undo each action in order, and confirm the exact replayed state and `canUndo` value after every undo.
- Server integration: undo reaches the start-of-play boundary and cannot enter starting-build setup.
- AI integration: multiple human turns can be undone in order; each undo returns a human decision point and never an intermediate AI state.
- Persistence: save and reload a game with several undo entries, then continue undoing correctly.
- API contract: AI game views contain public AI action events but no opponent hand or draw-order details in the log data.
- End-to-end: play several actions, undo all of them one at a time, and choose a different Step direction after undo.
- End-to-end: the right rail is always visible, both old drawers and edge toggles are absent, and the action log shows both players’ turn and action entries.
- End-to-end: both deck summaries show exact card counts and no zone counts.
- End-to-end at 1920×1080: the document has no horizontal or vertical overflow; the action log scrolls when long; the deck summaries stay fixed and visible.

## Validation

Run:

```bash
npm test
npm run typecheck
npm run lint
npx playwright test
```

Inspect the finished table at 1920×1080 in a real browser. Confirm that the rail remains readable, only the log scrolls, the deck summaries stay visible, and repeated undo returns to the start of play.
