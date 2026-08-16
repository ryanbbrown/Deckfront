# Distance duel technical implementation

## Status

This technical plan implements the approved behavior in [05-distance-duel-experiment.md](./05-distance-duel-experiment.md). The behavior plan is authoritative if the two plans conflict.

Stable review feature name: `distance-duel`.

## Result

The application supports a complete human-versus-AI or two-player local distance duel:

1. Select and edit the AI strategy prompt.
2. Select whether the human or AI takes the first turn.
3. Build a starting deck with 12 money.
4. Submit the build without seeing the AI build.
5. Wait for the AI to submit its independent build.
6. Reveal both completed builds.
7. Play complete turns through visible controls.
8. Save every committed decision and restore the game after refresh.
9. End immediately when one fighter reaches 0 health.

The implementation replaces the existing hex ring-out game. It does not preserve old rules, saved games, fixtures, or compatibility paths.

## Architecture

Keep the useful application shell:

- React and Vite client;
- authoritative local HTTP server;
- revision-locked persistence;
- immediate actions and one-step Undo;
- deterministic shuffling and replay;
- ThinHarness AI runner, status, retry, and traces;
- production-build Playwright tests.

Replace the game domain and game-specific browser interface.

### Game module

Build one deep `src/game` module with a small public interface:

- `createGame(config)`;
- `submitStartingBuild(state, playerId, cardIds)`;
- `listActionAvailability(state, playerId)`;
- `listLegalActions(state)`;
- `applyAction(state, actionId)`;
- `applyCommand(state, command)`;
- `replayCommands(initialState, commands)`;
- `assertInvariants(state)`.

Callers and tests use this interface. Card resolution, range checks, movement, damage, conditions, drawing, shuffling, cleanup, and turn changes stay inside the module.

Keep deterministic seeded shuffling. Delete obsolete hex geometry, tactical search, ring-out, respawn, block, pin, Brace, Guard, and multiple-piece rules.

### Persistence seam

Keep `GameRepository`. The file repository and in-memory test repository are two adapters at this seam.

Use schema version 5 for game state, game record, persistence parsing, safe views, and shared transport. Use AI bridge protocol version 2 with separate starting-build and normal-action outputs. Reject old saves with a specific version error and preserve that message through HTTP error mapping. Do not migrate old saves.

## State model

The state contains:

- phase: `startingBuild`, `action`, `buy`, or `ended`;
- active player and selected first player;
- turn number and deterministic random state;
- one fighter per player, with position and health;
- each player's draw, hand, discard, and play zones;
- current money and unspent starting money;
- each completed starting build;
- Aimed and Exposed conditions;
- the count and identity of Action cards resolved during the current turn;
- ten-copy Action supply piles;
- nondepleting Copper, Silver, and Gold base piles;
- shared trash;
- winner;
- ordered public events;
- unique card-instance serial.

Ochre starts on space 2. Indigo starts on space 3. First-player selection changes turn order, not position. Fighters can share spaces and move through each other.

Before both builds finish, no card instances exist and no cards are shuffled or drawn. During setup, the active player is the human until the human completes a build, then the AI until the AI completes its build. The selected first player remains separate. The human edits and completes a build first. The AI then chooses its build without receiving any human build information.

After the AI completes the second build, resolve setup in this exact order:

1. Create ochre's seven Copper instances followed by ochre's selected cards in submitted order.
2. Create indigo's seven Copper instances followed by indigo's selected cards in submitted order.
3. Retain `12 - selected card costs` as each player's first-buy money.
4. Shuffle ochre's deck, then indigo's deck.
5. Draw five cards for ochre, then five for indigo.
6. Reveal both completed build lists.
7. Enter the Action phase for the selected first player.

Both fighters start at 20 health. Ochre starts on space 2 and indigo starts on space 3. Starting builds do not reduce market piles.

## Commands and phases

### Starting build

Persist the human's incomplete proposal in `GameRecord`, outside replayed `GameState`, so refresh does not discard setup work. Proposal edits are revision-locked record updates, not replay commands. Completing the human build commits one validated game command and rejects all later edits. The AI then submits its full build as one validated game command. Normal legal actions are empty during setup.

The build validator must:

- accept a build with no paid cards;
- accept repeated cards and any number of zero-cost Copper cards;
- reject unknown cards;
- reject total paid cost above 12;
- compute carried money on the server;
- reject edits after completion;
- prevent either player from seeing the other's proposal before both complete.

### Normal actions

Use opaque legal action IDs for:

- Footwork with Left or Right;
- Cull with exactly two eligible card-instance IDs;
- Muster;
- Feint;
- Drive with a Left or Right push;
- Flurry;
- Aim;
- Volley;
- end Action phase;
- buy one card;
- end Buy phase.

Treasures are not manually played. Ending the Action phase moves all Treasure cards from hand to play, adds their money, and adds unused starting money during that player's first buy phase.

`listActionAvailability` returns one entry per human card instance with its enabled state, stable disabled-reason code, required selection kind, and eligible choices. React uses this result instead of repeating game rules. Complete opaque actions remain the only inputs accepted for immediate commits and AI decisions. For Cull, the browser selects two eligible instances and then submits the matching complete action.

A committed purchase leaves the player in the Buy phase. The player can buy any number of cards, including repeated free Copper, then explicitly end the Buy phase. Base Treasure piles never deplete. Action piles begin with ten copies and reject an 11th purchase.

Ending the Buy phase:

1. Discards the remaining hand and played cards.
2. Draws five cards, reshuffling the discard pile as needed.
3. Clears unused Aimed from the active fighter and unused Exposed from the opponent.
4. Clears unspent normal money.
5. Gives the opponent the next complete turn.

Carried starting money is available only in that player's first Buy phase. Any remainder expires when that Buy phase ends.

## Card resolution

Implement the approved cards directly:

- **Copper, Silver, Gold:** provide 1, 2, and 3 money.
- **Footwork:** validate Left and Right against the arena walls, move one space even when another fighter occupies the destination, then draw one.
- **Cull:** legal only when two eligible cards can be selected. Trash either Cull plus one card still in hand or two other cards still in hand. It cannot select another played card. A self-trashed Cull still counts as a resolved Action for Flurry.
- **Muster:** draw two cards.
- **Feint:** legal only at Close range. Give the opponent Exposed. Playing Feint while Exposed already exists is legal and refreshes the same non-stacking condition.
- **Drive:** legal only when both fighters share a space. Deal 2 damage, apply and consume Exposed when present, then push the target Left or Right as chosen. The actor does not follow. A wall collision adds 2 damage and moves neither fighter.
- **Flurry:** legal at every range. Deal damage equal to previously resolved Action cards this turn, capped at 5. It does not count itself. At Close range, the damage consumes Exposed and gains 2 even when its base damage is 0.
- **Aim:** legal only at Near or Far range. Set Aimed, then draw one. Playing Aim while Aimed already exists is legal, refreshes the same non-stacking condition, and still draws.
- **Volley:** legal only at Near or Far range. Deal 2 at Near or 5 at Far. Aimed changes this to 5 at Near or 7 at Far and is then removed.

Drawing reshuffles discard when needed and stops when no cards remain. One draw effect can cross the shuffle boundary.

Damage clamps health at 0. Reaching 0 ends the game immediately. Do not resolve later movement, drawing, cleanup, or turn changes after victory.

This experiment has no stalemate rule or turn cap. A human can start a new game if a playtest cannot progress.

## Immediate actions, Undo, and replay

Normal player actions commit immediately under the revision lock. The record stores one checkpoint from before the latest player action. Undo restores that checkpoint, including command history, random state, zones, money, health, conditions, phase, turn, and winner, then clears the checkpoint. A new player action replaces the prior checkpoint. Refresh preserves an available checkpoint.

An AI commit clears player Undo. Starting-build edits and completion are not undoable.

Replay from the new initial state must reproduce every committed state exactly, including setup commands and shuffles.

## Server and shared data

Update the server and shared interfaces for the new domain. Expected areas include:

- `src/server/types.ts`;
- `src/server/schemas.ts`;
- `src/server/gameService.ts`;
- `src/server/persistence.ts`;
- `src/server/httpServer.ts`;
- `src/shared/api.ts`.

Add a starting-build route that accepts:

- expected revision;
- complete card-definition list;
- completion status.

Game creation accepts:

- AI strategy preset ID;
- editable AI strategy Markdown;
- first player;
- optional seed.

The safe game view exposes:

- the human's in-progress build;
- no AI proposal before both builds complete;
- both completed build lists after reveal;
- only the human hand;
- public zone counts, purchases, trash, positions, health, conditions, phase, money, and supply;
- human action availability and legal actions only at valid human decision points.

Safe views, public exports, traces, events, and rendered HTML must not contain the AI hand, either ordered draw pile, or an incomplete opponent build.

File writes remain atomic and revision locked.

## AI

Keep the current ThinHarness shape:

- editable Markdown strategy prompts;
- one legal choice per model decision;
- opaque action IDs;
- persisted traces;
- retry after model failure.

One server coordinator job owns either the AI starting-build decision or one complete AI turn. During a turn, the coordinator repeatedly runs one model decision, validates and persists it, fetches the new revision, and continues until control changes or the game ends. The turn continues when no browser is open.

Provide two decision schemas.

### AI starting build

The model receives:

- its strategy prompt;
- market definitions and costs;
- 12-money budget;
- seven-Copper base deck;
- no human build information.

It returns ordered card-definition IDs and a short summary. The server validates the build through the game module before commit.

### AI turn decision

The model receives:

- its private hand;
- counts and unordered contents for its draw and discard zones, never ordered draw arrays;
- public completed builds and purchases;
- positions, health, conditions, phase, money, and public turn history;
- opaque legal action IDs and summaries;
- no human hand or draw information.

It returns one action ID. The server loop lets the AI reconsider after Footwork, Muster, Aim, purchases, and phase changes. The AI can make strategic mistakes; the server does not reject a legal choice because another action would win immediately.

Earlier committed decisions remain committed if a later model request fails. Retry resumes from the latest persisted revision. After 30 model-chosen decisions in one AI turn, stop querying the model and deterministically commit the legal phase-ending actions until control changes. Record the fallback and reset the count when the next AI turn begins.

The fake AI adapter supplies a valid deterministic starting build and scripted decisions for behavior tests. Its fallback always reaches phase completion and cannot loop on free Copper.

Persist traces through an allowlist: edited strategy, redacted public briefing, legal-action summaries, selected action or starting build, model summary, duration, decision index, and server outcome. Do not persist raw private prompts, private hand contents, ordered zones, or arbitrary model transcripts in the public trace.

Replace persisted AI `round` and `actionStep` fields with turn, phase, and decision index. Replace obsolete strategy files with editable close-pressure and ranged-setup prompts. Each prompt covers its starting build, movement, card order, purchases, health pressure, and phase completion.

## Browser interface

Replace the hex board with a five-space line arena.

### Setup

Show:

- AI strategy preset;
- editable strategy Markdown;
- human-first or AI-first selection;
- optional seed;
- start control.

### Starting build

Show:

- every market card with cost and rules text;
- increment and decrement controls;
- selected quantity;
- money spent and remaining;
- selected deck list;
- finish-build control.

Allow repeated free Copper. Disable completion only when paid cost exceeds 12 or the server rejects the build. Restore the saved proposal after refresh.

After human completion, show a waiting state without AI choices. Reveal both builds only after AI completion.

### Game

Show:

- five labeled spaces;
- fighter positions and health;
- current Close, Near, or Far range;
- Aimed and Exposed indicators;
- current phase, player, and turn;
- human hand;
- draw, discard, play, trash, and money counts;
- public starting builds and purchases;
- market pile counts;
- action history;
- one global Undo control and immediate phase controls;
- end Action and end Buy controls;
- AI status, elapsed time, retry, and last summary;
- victory and new-game controls.

Card interaction requirements:

- Footwork shows separate Left and Right choices and only directions that stay on the board.
- Drive shows separate Push Left and Push Right choices.
- Cull changes eligible cards into a two-card selection interface. Cull itself is eligible. Other played cards are not.
- A card with one complete legal resolution commits from its card control.
- A card blocked by range, wall, landing space, or another rule stays visible but disabled with a specific reason.
- Market cards remain available after each committed purchase while affordable.
- Drawn cards appear immediately.
- Private opponent information never appears in the document.

Use stable top-level React modules for setup, starting build, arena, hand, market, history, and AI status. Derive presentation state during render instead of mirroring it with effects.

## Files and obsolete code

Replace or rewrite the current game-specific files, including:

- `src/game/*`;
- `src/game-data/*`;
- `src/shared/api.ts`;
- relevant `src/server/*` and `src/ai/*`;
- `scripts/run_ai_action.py`;
- `src/client/*`;
- strategy Markdown files;
- game, server, AI, and browser tests;
- E2E coverage manifest and validator requirements;
- `README.md`.

Delete obsolete hex geometry, tactical search, `games/*.json`, ring-out strategies, compatibility tests, and rule fixtures. Replace `README.md`, `GOAL.md`, and `KEY_DECISIONS.md` so they describe the distance duel. Do not leave old rules beside the replacement.

## Implementation order

1. Make one compiling vertical replacement across game types, shared data, server, AI adapters, and a minimal client shell. Remove obsolete callers and tests in the same milestone.
2. Implement setup, range, movement, drawing, damage, conditions, cards, phases, purchases, cleanup, victory, replay, and game-module tests.
3. Complete safe views, availability reasons, setup persistence, one-step Undo, schema rejection, and persistence tests.
4. Complete AI starting builds, briefings, server-owned turns, both bridge schemas, trace allowlisting, retry behavior, and AI tests.
5. Complete setup, starting-build, arena, hand, market, history, selection, and phase controls.
6. Add card-by-card, combination, lifecycle, privacy, and AI browser tests.
7. Replace the E2E coverage manifest and validator requirements.
8. Update all current-state documentation and remove obsolete files.
9. Run the complete verification suite.

Every milestone ends with passing relevant tests plus whole-project typecheck, lint, and build.

## Backend verification

Tests use literal expected positions, health, money, cards, and zones. They enter through the game-module or server interface, not private helpers.

### Setup and privacy

Prove:

- seven Copper and 12 starting money;
- a zero-paid build and any number of selected cards;
- repeated paid cards and repeated free Copper;
- under-budget carry and exact-budget zero carry;
- over-budget and unknown-card rejection;
- no card instances, shuffle, or draw before both completions;
- exact creation, shuffle, draw, health, position, and opening-hand order after the second completion;
- starting purchases leave supplies unchanged;
- hidden opponent proposal before completion;
- completed build reveal;
- edits rejected after completion;
- stale and concurrent build revisions;
- selected first player;
- empty normal legal actions during setup;
- refresh during both setup states;
- AI briefing contains no human proposal.

### Arena and range

For every pair of positions, prove:

- Close, Near, and Far derivation;
- shared positions accepted as Close;
- Left and Right use absolute arena direction;
- walls stop movement;
- occupied spaces do not stop movement;
- fighters can move onto and past each other.

### Cards

Prove:

- Copper, Silver, and Gold provide exactly 1, 2, and 3 money.
- Footwork covers both directions, both walls, occupied destinations, drawing, and reshuffling.
- Cull covers both valid forms, no legal pair, self-trash counting for Flurry, and rejection of duplicate IDs, wrong counts, missing cards, and other played cards.
- Muster draws two across a shuffle and handles deck exhaustion.
- Feint covers invalid range, creation, legal reapplication without stacking, consumption, and expiry.
- Drive covers both push directions, no follow, wall collision, Exposed damage, and victory before movement.
- Flurry covers 0 through 5 previous Actions, the cap above 5, every range, ordering, and zero-base Close damage consuming Exposed for 2.
- Aim covers invalid Close range, Near, Far, drawing, legal reapplication without stacking, consumption, and expiry.
- Volley covers invalid Close, normal Near 2, normal Far 5, Aimed Near 5, and Aimed Far 7.

### Turn and deck lifecycle

Prove:

- Action cards do not change the active player;
- any number of Actions can resolve;
- card order changes results;
- all Treasures auto-play when Action phase ends;
- starting money applies only to the first buy;
- multiple paid purchases and repeated free Copper purchases;
- bought cards enter discard;
- Buy completion performs cleanup and draw;
- unspent normal money expires;
- conditions expire at the approved times;
- the opponent receives the next complete turn;
- deterministic shuffle and exact one-step Undo;
- Action supply depletion without starting-build depletion;
- health clamped at 0 and immediate victory;
- replay equivalence after every command;
- no duplicate or lost existing card instance across zones while purchases create new instances.

### Server, persistence, and AI

Prove:

- stale revisions cannot change state;
- immediate actions, one-step Undo, and refresh work in each normal phase;
- draws reveal immediately and Undo restores the exact prior random state;
- availability reason codes agree across the game module and safe view;
- schema version 5 round-trips and version 4 fails through HTTP with a specific message;
- seeded fixture replay still succeeds after immediate actions and Undo;
- concurrent writes serialize;
- sentinel card IDs prove safe views, exports, traces, events, and HTML omit private data;
- AI starting builds use the same domain validation;
- fake AI supplies a valid starting build;
- AI bridge protocol version 2 dispatches the starting-build and normal-action schemas;
- normal AI choices use server-validated opaque IDs;
- invented and stale IDs fail without state changes;
- AI replans after draws;
- one server job completes several Actions and purchases without a browser;
- regular AI failures preserve earlier commits and retry from the latest revision;
- the 30-decision guard ends the phase, records the fallback, and resets next turn;
- AI ends both phases;
- traces record only allowlisted fields and server outcomes.

## Real-browser E2E verification

Run Playwright against the production-built client and real local HTTP server. Tests may seed deterministic saved states before the browser opens. Every behavior under test must then be selected and completed through visible browser controls. Tests must not call action endpoints to perform the card behavior they claim to prove.

Each test must assert exact visible results and identify the regression it catches. Do not use snapshot-only, truthiness-only, mock-only, or assertion-free tests.

### Setup flows

Cover:

- each AI strategy preset;
- edited prompt text reaching the AI trace;
- human-first and AI-first setup;
- adding, removing, and repeating starting cards;
- repeated free Copper;
- rejected over-budget build;
- in-progress build restoration after refresh;
- completion preventing later edits;
- hidden AI build before both complete;
- revealed completed builds;
- carried starting money in the first buy;
- zero-paid starting build.

### Individual cards

Cover through visible controls:

- Copper, Silver, and Gold auto-play and produce exact visible money.
- Footwork selects Left and Right, moves onto and past the opponent, draws, and hides wall-blocked directions.
- Cull selects Cull plus one hand card and two other hand cards, prevents a third selection, never offers other played cards, and shows a specific disabled reason when no pair exists.
- Muster increases the visible hand by two and crosses a seeded reshuffle.
- Feint is disabled outside Close, applies Exposed at Close, and shows consumption.
- Drive is disabled outside Close and shows both push choices, normal damage, no follow, wall collision, and Exposed damage.
- Flurry resolves at Close, Near, and Far with literal damage for short and capped Action chains.
- Aim is disabled at Close, draws, and shows Aimed at Near and Far.
- Volley is disabled at Close and shows exact normal and Aimed damage at Near and Far.

### Combinations

Cover through visible controls:

- `Footwork -> Feint -> Drive -> Flurry`, with exact final positions and 7 total damage in an open-space case;
- `Footwork -> Footwork -> Aim -> Volley`, with pass-through, exact final range, draw count, and 7 damage at Far;
- `Feint -> Drive` against a wall for 6 damage;
- Aim plus Volley versus two unprepared Volleys at Near: 5 versus 4;
- Aim plus Volley at Far for 7;
- draw effects revealing the next required combination card;
- Cull followed by cleanup and reshuffle with trashed cards absent;
- several purchases in one Buy phase followed by explicit completion;
- a damage action ending the game before later effects or controls resolve.

### Lifecycle and AI

Cover:

- normal setup through one complete human and AI turn without test-time repository mutation;
- one complete deterministic browser game from setup through victory with scripted fake AI and an explicit runtime limit;
- both first-player paths;
- refresh during starting build, an undoable Action, AI wait or error, Buy phase, and ended game;
- immediate draws and exact one-step Undo;
- AI completing a turn while the browser is closed, then showing the persisted result after reopen;
- AI failure, refresh, retry, and recovery without duplicate commands;
- 10th Action purchase accepted and 11th rejected;
- repeated nondepleting Copper, Silver, and Gold purchases;
- opponent hand, ordered draw piles, and incomplete builds absent from rendered HTML;
- victory result and new-game flow.

Maintain an exact E2E coverage manifest. It maps all 12 cards and every required setup, selection, combination, lifecycle, and AI flow to discovered test IDs. Its validator rejects missing, stale, and obsolete mappings.

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

The live AI suite completes an independent AI starting build and at least one full AI turn through the real ThinHarness bridge. The E2E suite completes within its configured operational timeout.

The implementation is not complete if a card has only backend coverage. Every card must have a real-browser test that selects every required target, movement, or trash choice and confirms exact visible results.

## Risks

- Free Copper can create intentional deck bloat and AI purchase loops. Keep the rule legal and test the AI completion guard.
- Seeded browser fixtures can hide integration failures. Use fixtures only for state preparation and drive every claimed interaction through the browser, HTTP server, game service, persistence, and game module.
- Undoing draw effects requires exact random-state rollback. Compare literal card identities and zones after action, Undo, replay, and refresh.
- Starting-build privacy can leak through safe views, traces, exports, events, or HTML. Test each output.
- Retained obsolete files can create conflicting rules. Remove them instead of adding compatibility paths.
