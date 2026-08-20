# Full-screen game UI and AI opponent

## Goal

Replace the setup and starting-build pages with one 1920×1080 game table. A player can refresh a random 10-card kingdom, inspect every card, choose local or AI play, complete the starting build in the market, and play without page scrolling. AI games train and select a strategy before play, then return only the state at the start of the human player’s next decision.

## Product decisions

- Support desktop screens at 1920×1080. Mobile and smaller desktop layouts are out of scope.
- The document, market dialog, played area, and hand must not scroll. The deck drawer may scroll.
- The fixed market is Copper, Silver, Gold, Step, Cull, and Focus.
- Step is always available. Footwork remains part of the random card pool.
- Each refreshed kingdom contains 10 unique action cards chosen from all action cards except Step, Cull, and Focus.
- A refresh only changes the preview. The chosen kingdom becomes persistent when the player starts a game.
- Every player starts with 7 Copper and may spend 12 money on a starting build. Up to 3 unspent money carries into that player’s first Buy phase, as it does now.
- Starting-build cards do not reduce market pile counts.
- Local games use Player 1 as the first player and do not show a first-player setting.
- AI games let the human choose “I go first” or “AI goes first.”
- AI games use the full-strength policy-space response-oracle search. The server samples one strategy from the solved equilibrium lottery with the game seed and stores that strategy with the game.
- The AI chooses its starting build from the selected strategy. During play, the server applies a complete AI turn before it returns the next human-visible state. The UI does not show an AI action log or animation in this version.
- A single Undo in an AI game must never expose an intermediate AI state. It undoes the latest human action and every automatic AI action caused by it.
- Card families have one visual color: treasure is yellow, ranged is green, mana and spells are blue, melee is red, and engine, movement, and utility are gray.

## Card and kingdom model

1. Add an explicit visual family to every card definition. Keep the family in card data rather than duplicating mechanic-to-color rules in React.
   - Treasure: Copper, Silver, Gold.
   - Ranged: Aim, Volley, Steady Shot, Shot.
   - Mana: Focus, Channel, Ley Step, Prism, Arc Bolt, Fireball, Starfire.
   - Melee: Feint, Drive, Flurry, Heavy Blow, Strike.
   - Engine: Footwork, Cull, Muster, Stipend, Reclaim, Adapt, Step.
2. Add Step to `ALWAYS_AVAILABLE_ACTION_IDS`. Do not add Footwork. Update kingdom, supply, invariant, simulator-kernel, and rules-fingerprint tests for the new fixed pile. Do not regenerate or rerun the 100-kingdom balance corpus in this work.
3. Add one pure random-market function. It accepts a random-number source and returns 10 unique eligible card IDs. It must never return a treasure or an always-available action.
4. Treat a started random market as a real kingdom. Give it 40 starting health and 10 cards in each variable pile.
5. Persist the complete kingdom definition in the game record. Register the persisted kingdom before validating or replaying a loaded record so games survive a server restart. Increment saved-record, game-view, and export schema versions. Do not support old saved records.
6. Validate create-game input on the server: exactly 10 unique eligible variable cards, a supported game mode, and a valid AI seat when the mode is AI.

## Game and AI module

1. Add game mode and opponent data to the saved record and browser view:
   - `local`, with no computer player.
   - `ai`, with the human player ID, AI player ID, selected strategy, and training result needed to explain or resume the game.
2. Put AI training behind one small module interface that accepts a kingdom and seed and returns one executable strategy. Keep PSRO configuration, worker management, equilibrium sampling, and failure handling inside the module.
3. Use the current full experiment limits and the optimized simulation kernel. Pairing workers must receive and register the persisted random kingdom before they evaluate it. Close workers after training succeeds or fails.
4. Fail game creation with a specific error if training does not produce a valid equilibrium and strategy. Do not create a partial game record.
5. Extend the game module used by the server so one call can advance an AI player from the current state until one of these conditions is true:
   - control returns to the human;
   - the game ends;
   - a safety action limit is reached, which returns a specific server error.
6. The selected strategy supplies the AI starting build, Buy choices, and Action choices through the existing strategy agent. Do not create a second AI rules implementation.
7. Keep automatic AI work inside the same repository lock as the human command that triggered it. Save once after the complete visible transition.
8. Move Undo checkpoint ownership above individual automatic commands. In local games, preserve current one-action Undo. In AI games, checkpoint before the human command and restore that checkpoint after all resulting AI actions.
9. Allow tests to inject an AI trainer through the server construction seam. Use a fixed real strategy in HTTP and browser tests; separately test the production trainer with reduced limits so tests exercise real registration, simulation, equilibrium selection, and worker cleanup without running a full production search.

## Server interface

1. Add a setup-catalog response with all card definitions, the six fixed card IDs, and the eligible variable card IDs. The preview page uses this before a game exists.
2. Change create-game input to include:
   - the 10 selected variable card IDs;
   - `mode: "local" | "ai"`;
   - the human first-player choice only for AI mode;
   - an optional seed for deterministic tests.
3. Return a clear training state to the client while AI creation is pending. A synchronous create request with a full-screen “Training opponent…” state is acceptable; no progress percentages are required.
4. Keep the existing build and action routes. Their responses must already include any automatic AI build or turn that follows the human command.
5. Keep load, export, persistence, revision locking, and replay validation working for both game modes and random kingdoms.

## Full-screen UI

1. Replace `Setup`, `StartingBuild`, and the current stacked page with one game-table shell sized to `100dvh` and hidden document overflow.
2. Use the same table before and after game creation:
   - top: compact controls and the five-space arena;
   - center: market;
   - below market: played cards;
   - bottom: hand;
   - edge controls: collapsed deck drawer and a reserved collapsed opponent/AI drawer.
3. Put fighter health, status, and identity directly into the five-space arena. Remove the separate health row.
4. Before game creation:
   - show the arena, empty played area, and empty hand;
   - show Local players and Play against AI controls;
   - show first-player controls only when AI is selected;
   - show Refresh market, View cards, and Start game;
   - create one random 10-card preview on initial load.
5. Render the compact market as two clearly labelled groups:
   - fixed: Copper, Silver, Gold, Step, Cull, Focus;
   - kingdom: the 10 random cards.
   Each compact pile shows only card name, cost, and remaining count when a game has started.
6. Make compact market piles interactive by phase:
   - preview: no purchase action;
   - starting build: add a copy to the active builder’s proposal;
   - Buy phase: buy the selected pile;
   - other phases: disabled.
7. During a starting build, show the active builder, `spent / 12`, first-Buy carry, selected-card list, remove controls, and Finish starting build in the table. Keep both local builds in sequence. In AI mode, submit the AI build automatically and only show the human build.
8. Add a large market dialog that fits all 16 full cards at once on 1920×1080 without internal scrolling. It must close by button, Escape, or backdrop. Compact market interaction remains available after the dialog closes.
9. Use one reusable full card face for the hand, played area, and market dialog:
   - title at top left;
   - cost at top right;
   - blank image rectangle below the title bar;
   - rules box below the image;
   - family color applied to border, title bar, and restrained accents while keeping text contrast accessible.
10. Keep played cards above the hand. Keep both areas visible at 1920×1080.
11. Fit every hand into one row without horizontal scrolling. Cards may overlap at their right edges as the hand grows. Hover and keyboard focus lift and emphasize one complete card above its neighbours.
12. Preserve card grouping, quantity badges, Cull selection, movement choices, pending discard/recover choices, phase controls, victory, New game, and error messages.
13. Keep the deck drawer collapsed by default and scrollable. Keep current deck, zones, builds, purchases, and history content. Add the collapsed opponent/AI drawer control as a simple reserved surface; detailed AI turn content is out of scope.
14. Remove mobile media rules and tests that conflict with the 1920×1080-only product decision.

## Test plan

### Game and server tests

- The fixed market contains exactly Copper, Silver, Gold, Step, Cull, and Focus.
- Random market generation returns exactly 10 unique eligible cards and is deterministic with a seeded random source.
- Game creation rejects duplicate, fixed, treasure, unknown, or wrong-count variable card IDs.
- A random kingdom saves, reloads through a fresh repository/server registration state, replays, and exports.
- Starting builds still use 7 Copper, a 12-money limit, and up to 3 carry money without reducing piles.
- Local games default to Player 1 first.
- AI first and AI second create the correct seats and health penalty.
- AI training failure creates no saved game.
- AI starting build and complete turns run automatically.
- AI game Undo restores the prior human-visible state and never returns a state with the AI active.
- Production AI training runs a reduced real search against a generated kingdom and returns a legal strategy.

### Browser tests

- Initial navigation shows the complete game table without a separate setup page.
- Refresh changes the 10-card kingdom while fixed piles remain unchanged.
- Local and AI controls show the first-player choice only for AI.
- Both local players draft from the compact market, can remove choices, and finish in sequence.
- AI creation shows a training state and then the human starting build or first turn.
- Compact market piles buy cards during Buy phase.
- The market dialog shows all 16 cards with title, cost, image placeholder, rules, and no overflow.
- Treasure, ranged, mana, melee, and engine examples receive the correct family styling.
- Health and status appear in the arena, with no separate score row.
- At 1920×1080, the document, played area, market, and hand have no horizontal or vertical overflow.
- A large unique-card hand stays in one row, overlaps when needed, and raises the hovered or focused card.
- Existing card actions, choices, Undo, reload, victory, drawers, and grouped-card behavior remain covered through the new interface.

## Documentation and cleanup

- Update `README.md` to describe random kingdoms, fixed piles, the full-screen desktop requirement, local play, AI training delay, and the AI’s hidden automatic turns.
- Update the E2E coverage manifest for removed setup/mobile behavior and new preview, draft, AI, modal, color, and 1080p layout behavior.
- Remove obsolete setup/build-only React and CSS paths instead of keeping compatibility layers.
- Do not regenerate balance artifacts or change card costs, text, damage, simulation search rules, or difficulty settings.

## Validation

Run all of these before completion:

```bash
npm test
npm run typecheck
npm run lint
npm run test:e2e
```

Manually open the built app at 1920×1080 and verify preview refresh, local drafting, full market dialog, one complete local turn, AI-first creation, one automatic AI turn, Undo, reload, and no page scrolling.
