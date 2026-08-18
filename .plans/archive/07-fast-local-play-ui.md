> **Superseded:** Use [12-repository-cleanup.md](../12-repository-cleanup.md) for the current repository and browser scope. Use [09-card-list.md](../09-card-list.md), [10-automated-balance-search.md](../10-automated-balance-search.md), and [11-search-performance.md](../11-search-performance.md) for current game and simulator decisions.

# Fast local play and UI fixes

## Status

Approved product direction. This plan fixes the local two-player play loop and replaces per-action preview and confirmation with immediate actions plus one global Undo control.

Stable review feature name: `fast-local-play-ui`.

## Goals

- A local two-player game must switch between Player 1 and Player 2 after each completed Buy phase.
- Normal money must expire when the Buy phase ends. Only unspent starting-build money carries into that player's first Buy phase.
- Every Treasure card must show its correct name and money value in the hand.
- Players must be able to reach every card in a large hand without horizontal page overflow.
- Card plays, purchases, and phase changes must resolve with one click after any required target or direction choice.
- One global Undo control must reverse the latest local player action.
- The arena and game controls must be compact, clear, and usable on a laptop screen.

## Interaction rules

### Immediate actions

Remove the Preview and Confirm steps from normal human and local-player actions.

- A card with no choice resolves when the player selects it.
- Footwork resolves after the player selects Left or Right.
- Drive resolves after the player selects Push Left or Push Right.
- Cull resolves after the player selects exactly two cards and selects Trash selected cards.
- A purchase resolves when the player selects the market card.
- End Action phase and End Buy phase resolve when selected.
- Drawn cards appear immediately.

Keep server-side revision checks and legal-action validation. Immediate interaction must not move game rules into React.

### Global Undo

Show one Undo button in the main game controls.

- Undo restores the exact state before the latest immediate local or human action.
- Undo covers card plays, purchases, End Action phase, End Buy phase, movement, draws, damage, conditions, and victory.
- Undo restores the random state, zones, money, range, active player, phase, turn number, health, and history.
- Undo is one step. After Undo, the button is disabled until the player performs another action.
- A new action replaces the previous undo checkpoint.
- Starting-build edits and completion are not gameplay actions and are not undoable.
- In a local game, Undo remains available after End Buy phase so the next player can restore the previous player's Buy phase.
- In an AI game, Undo is available only until the AI commits its first decision after control changes. Do not roll back completed AI decisions.
- Refresh preserves the current state and the available one-step Undo checkpoint.

Remove the saved preview model, preview-only card hiding, Confirm, and action-specific Undo paths. Increment the saved-game schema version and reject older saves without migration.

## Turn and money correctness

Verify the rules through the game module, server, and browser:

- End Buy phase always sets normal money to 0.
- Unspent normal money never enters a later turn.
- Starting-build carry applies only during that player's first Buy phase.
- End Buy phase clears `firstBuyPending` and `firstBuyMoney` for that player.
- End Buy phase gives the other player the Action phase and increments the turn exactly once.
- Player 1 and Player 2 can each complete several turns in one local browser session.
- Undoing End Buy phase restores the previous player, Buy phase, money, hand and played zones, conditions, and turn number exactly.
- Repeating End Buy after Undo switches players exactly once.

## Treasure clarity

- Copper displays `+1 money`, Silver displays `+2 money`, and Gold displays `+3 money` on hand and market cards.
- Bought cards remain in the discard pile until cleanup and later draws. The interface explains this rule near the market or discard summary.
- Show the active player's deck summary by card name and count so a player can see bought Silver and Gold before drawing them.
- Local mode can show the active player's complete deck composition. Do not reveal ordered draw piles.
- AI mode keeps opponent private information hidden.

## UI layout

Keep the current visual identity but make the play area smaller and easier to scan.

- Replace large fighter ovals with compact round tokens inside each arena space.
- Keep both tokens readable when fighters share a space.
- Keep health and conditions in a compact score area outside the tokens.
- Keep the arena, turn banner, phase actions, money, and Undo control visible near the top.
- Render the hand as a wrapping responsive grid. Do not use a horizontal card strip.
- Large hands must remain inside the viewport and all cards must be reachable by vertical scrolling.
- Use smaller cards with clear name, cost, type, effect, and Treasure value.
- Make selected Cull cards and movement choices visually clear.
- Use Player 1 and Player 2 in local history instead of ochre and indigo.
- Keep the market responsive and reduce excess card height and empty space.
- Verify at 1440×900, 1280×720, and 1024×768.

## Implementation shape

- Add one immediate-action server operation that accepts an opaque legal action ID and commits it under the existing revision lock.
- Store one persisted undo checkpoint in `GameRecord`. The checkpoint contains enough authoritative record state to restore the exact state before the latest human or local action.
- Clear the checkpoint when an AI decision commits, setup changes, or a new game ends AI control of undo.
- Keep replay validation for committed command history. Undo must remove or restore command history so replay still equals the saved state.
- Delete obsolete draft preview state, preview redaction, confirm and preview routes, client calls, types, and tests instead of keeping compatibility paths.
- Keep AI actions immediate and server-owned. Do not add UI confirmation to AI decisions.

## Backend tests

Use literal expected values through public game and server interfaces.

- Normal money resets after one Buy phase and remains absent in the player's second Buy phase.
- Starting carry appears in the first Buy phase only.
- Three Gold purchases cost 18, enter discard as Gold, survive cleanup, and later draw as Gold with money value 3.
- At least three complete local turns alternate Player 1, Player 2, Player 1, Player 2.
- Every gameplay action type commits immediately with one revision increase.
- Undo restores every action type, including draw random state and End Buy phase.
- Undo after End Buy restores the previous active player and does not create a double turn when End Buy is selected again.
- Only one checkpoint exists. A new action replaces the prior checkpoint. Undo clears it.
- Refresh and schema parsing preserve an available checkpoint.
- Old schema saves fail with the specific unsupported-version message.
- An AI commit clears human Undo. Local actions never start the AI coordinator.
- Replay and card-instance invariants hold after immediate actions and Undo.

## Browser tests

Run Playwright against the production client and real HTTP server. Use visible controls for all behavior claimed below.

- Start one local game through both sequential drafts.
- Complete at least three full local turns and assert the exact player and phase after each phase change.
- Enter a Buy phase with known normal money, leave money unspent, end Buy, cycle back to that player, and prove the old money is absent.
- Prove starting-build carry appears once and does not return.
- Buy three Gold, show them in discard or deck summary as Gold, cycle the deck until one enters the hand, and assert that the card says Gold and `+3 money`.
- Resolve representative no-choice, movement, Drive-direction, Cull-selection, purchase, End Action, and End Buy actions without any Preview or Confirm control.
- Undo a card play, purchase, End Action, End Buy, draw, damage action, and winning action through the one global Undo control.
- Refresh while Undo is available, then use Undo successfully.
- Create a hand of at least 15 cards and prove every card is inside the hand panel, the page has no horizontal overflow, and the last card can be selected.
- Prove both fighters remain readable in one shared arena space.
- Capture layout assertions at 1440×900, 1280×720, and 1024×768.
- Keep all existing card, privacy, local mode, AI, lifecycle, and full-game coverage current. Remove obsolete preview and confirmation mappings.

## Acceptance checks

All commands pass:

```text
npm test
npm run test:e2e:manifest
npm run test:e2e
npm run test:ai:live
npm run typecheck
npm run lint
npm run build
git diff --check
```

The implementation is incomplete if local turn alternation, money expiry, Gold identity, large-hand access, immediate actions, and global Undo do not each have both backend and real-browser evidence.
