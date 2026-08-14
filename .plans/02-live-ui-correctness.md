# Live UI correctness pass

## Goal

Make the browser interface the verified product boundary.
Every player action must work through the same live React client and HTTP server that the human uses.
Engine-only legality tests do not satisfy this plan.

## Required interaction model

Use one role-based selection flow for all board cards.

1. Select a card.
2. Highlight only friendly pieces that can legally act with that card.
3. Select one highlighted friendly piece.
4. Highlight only legal enemy targets or legal destination hexes for that actor.
5. Select the target or destination to resolve the action.

Do not treat an actor and a target as interchangeable selections.
Do not highlight an enemy before the human selects an actor.
Do not allow a friendly actor when that actor has no legal completion.
Allow the human to change the selected actor before the action resolves.

Cards without an enemy target must use the shortest clear form of this flow.
Show one short instruction above the board for the current selection step.
Show the selected card and selected actor clearly.
Show why a card is unavailable when no legal action exists.

For Shove, the exact flow is mandatory.
Selecting Shove highlights each friendly piece with at least one adjacent legal enemy.
Selecting a friendly piece highlights every adjacent enemy that this piece can legally shove.
Selecting an enemy moves only that enemy directly away from the chosen friendly piece.
The chosen friendly piece does not move.

## Browser end-to-end boundary

Add Playwright browser tests that start a real production server on an isolated port.
Use a temporary game data directory for each worker.
Load the built React application in a real browser.
Drive actions through visible cards, pieces, hexes, buttons, and form controls.
Observe results through the rendered board, history, scores, zones, and page reloads.

Create scenario records through the normal game engine and repository before server start.
Do not add a production test endpoint.
Do not submit engine commands directly from a browser test when the behavior under test is a human interaction.

Keep a checked-in coverage manifest that maps every rule below to one or more browser tests.
Fail the suite when a card or required scenario has no mapped browser test.

## Required browser scenario matrix

### Shared interaction behavior

- Select and deselect every playable card.
- Show only friendly legal actors before actor selection.
- Show only legal targets or destinations after actor selection.
- Change the selected actor before resolution.
- Clear card and actor selections after resolution and Undo.
- Disable cards with no complete legal action.
- Never execute a different action when multiple legal actions share one target.
- Preserve the current game after page reload.
- Restore the exact board, hand, phase, score, and history after reload.

### Baseline movement

- Move either friendly piece to each legal adjacent direction.
- Reject occupied and off-board destinations.
- Remove only the chosen piece's baseline move.
- Keep card movement available after baseline movement.
- Prevent a pinned piece from using baseline movement.

### Shove

- Use either friendly piece as the actor.
- Target either enemy piece when adjacent.
- Offer both enemies when both are legal for one actor.
- Offer both friendly actors when both have a legal target.
- Move only the chosen enemy.
- Never move or target a friendly piece.
- Reject non-adjacent enemies.
- Reject a push with an occupied destination.
- Consume Brace without movement.
- Ring out an edge target and award exactly one point.

### Dash

- Move either friendly piece to every legal adjacent direction.
- Reject occupied and off-board destinations.
- Preserve the piece's baseline move count.
- Allow Dash after baseline movement.

### Brace

- Target either friendly piece.
- Never target an enemy.
- Cancel each displacement card as specified.
- Clear after cancellation.
- Expire at the correct turn boundary.

### Cull

- Trash Cull itself.
- Trash another card from the hand.
- Never offer a card outside the hand.
- Update the hand, play zone, trash count, and cleanup result.

### Drive

- Use either friendly actor and either adjacent enemy.
- Resolve without Follow.
- Resolve with Follow into the vacated hex.
- Offer Follow only after movement or ring-out.
- Do not offer Follow after Brace or a blocked push.
- Keep the actor still until Follow is chosen.

### Breaker

- Push an unbraced target.
- Remove Brace and push a braced target.
- Handle an occupied destination according to the approved displacement rules.
- Never target a friendly or non-adjacent piece.

### Press

- Push once without prior qualifying displacement.
- Push twice after each qualifying setup card.
- Do not let Press qualify a later Press.
- Stop after Brace cancellation or first-step ring-out.
- Score a second-step ring-out once.

### Pull

- Use either friendly actor and either enemy on an exact two-hex line.
- Move the enemy into the empty middle hex.
- Reject the wrong range or a non-collinear target.
- Reject an occupied middle hex for an unbraced target.
- Resolve Brace according to the approved displacement rules.
- Never move the actor.

### Vault

- Use either friendly piece.
- Jump over a friendly piece and an enemy piece.
- Cover all six jump directions.
- Reject an empty adjacent hex, occupied landing, off-board landing, and bent jump.
- Preserve baseline movement.

### Sweep

- Use either friendly actor and either adjacent enemy.
- Offer both clockwise and counterclockwise destinations when legal.
- Resolve each direction independently.
- Reject occupied on-board destinations.
- Ring out through an off-board destination.
- Consume Brace without movement.

### Relay

- Swap the two friendly pieces at distance one and two.
- Reject distance greater than two.
- Preserve each piece's status and baseline move count.
- Never offer an enemy piece.

### Block

- Place a block in each legal adjacent direction for either friendly actor.
- Reject occupied and off-board destinations.
- Keep blocks through the correct turn boundary.
- At the two-block limit, require selection of the replaced owned block.
- Never replace an opponent block.

### Pin

- Use either friendly actor and either adjacent enemy.
- Never target a friendly or non-adjacent piece.
- Prevent the target's next baseline move.
- Keep card movement available.
- Clear Pin at the approved boundary.

### Corner

- Resolve one push without setup.
- Resolve the extra push for a pre-pinned target.
- Resolve the extra push when the first destination touches an owned block.
- Do not use an opponent block as setup.
- Stop after Brace cancellation or first-step ring-out.
- Score a second-step ring-out once.

### Respawn, scoring, and match end

- Offer each empty owner anchor.
- Exclude occupied anchors.
- Offer every nearest empty fallback when both anchors are occupied.
- Resolve two respawns one at a time.
- Clear statuses and restore baseline movement.
- Award points only to the opponent of the ringed piece.
- Stop the match immediately at five points.
- Prevent actions, purchases, cleanup, and AI work after the win.

### Turn, market, Undo, and persistence

- Interleave both baseline moves and multiple cards.
- Enter the buy phase once.
- Auto-play treasure and calculate money.
- Buy every market card when affordable.
- Reject unaffordable and empty piles.
- Put purchases in discard.
- End turn, discard, shuffle deterministically, and draw five.
- Undo every action type and restore the exact prior view.
- Reject stale revisions without corrupting the saved game.
- Reload an in-progress draft and continue it through the UI.

### AI handoff

- Show visible progress while the AI runs.
- Require at least one legal board action before an AI enters buy on its opening turn.
- Require every available immediate point before buy.
- Commit the AI turn atomically.
- Show a summary that names board actions and the purchase.
- Return control to the human with a visibly updated board.
- Recover from one rejected AI plan and one process error.
- Run one real ThinHarness browser smoke test with the configured model.

## Test quality requirements

Write each regression before its fix and confirm that it fails for the reported reason.
Assert exact piece owners, piece positions, scores, statuses, zones, and history events.
Do not use snapshot-only assertions.
Do not assert only that a button exists or a request succeeds.
Use semantic labels for cards, pieces, targets, destinations, and current instructions.

Run browser tests in parallel only when their server and data directories are isolated.
Capture a screenshot, browser console, server output, and saved game for every failure.

## Completion checks

- `npm test`
- `npm run test:e2e`
- `npm run test:ai:live`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Coverage manifest validation passes.
- One independent review panel round completes.
- Every required review fix passes focused and full validation.
- A final headed browser playthrough uses both pieces, plays Shove, plays one movement card, buys a card, completes an AI handoff, reloads, and continues.
- The local server runs and passes `/api/health` after the final build.

## Review

Use the stable feature name `live-ui-correctness`.
Run exactly one independent review panel round after the implementation passes all required checks.
