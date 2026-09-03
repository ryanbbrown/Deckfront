# Battlefield selection

## Goal

Give each of the 160 playable battlefields a stable public number. Let a player open, share, and select a battlefield with `/play/<number>` while keeping the battlefield number visible in setup and during play.

The engine and strategy-search code use “kingdom” internally. Player-facing routes, copy, and setup data use the game term “battlefield.”

## Current state

- `/play` loads the game application. Other non-public paths also fall through to the game application.
- The setup response exposes 160 card arrays without public numbers.
- The browser chooses one array at random and sends its 10 card IDs when it creates a game.
- Local storage holds one active-game ID, which resumes after reload.
- “New game” now returns to setup with the current game’s battlefield.
- “Refresh market” chooses a different trained market.

## Product behavior

1. `/play` resumes the one active browser game when it exists. With no active game, `/play` chooses one of the 160 battlefields and replaces the address with `/play/<number>`.
2. `/play/<number>` selects that exact battlefield. Valid numbers are 1 through 160.
3. A saved active game resumes when its battlefield matches the explicit URL. If the URL names a different battlefield, the URL opens setup for the requested battlefield but keeps the old active-game pointer until the player starts another game.
4. Starting a game replaces the browser’s active-game pointer. The old server record remains, but the normal interface has no list for returning to it.
5. A malformed or out-of-range battlefield URL recovers to a random valid battlefield, replaces the address with the valid canonical URL, and shows an error that explains the accepted range.
6. Setup shows a labeled battlefield-number input and `Load battlefield`. Submitting a valid number changes the market and canonical URL. Invalid input keeps the current market and URL and shows an inline error.
7. The existing `Refresh market` button keeps its label and chooses a different numbered battlefield. It also updates the canonical URL.
8. The market heading shows `Battlefield <number> of 160` in setup and during play.
9. `New game` keeps the current battlefield and URL. Reset continues to restart the same market and shuffle.
10. URL updates use `history.replaceState`. Battlefield selection does not add setup choices to browser Back history.
11. The first implementation uses the existing visual system and supported desktop layouts. User feedback after implementation supplies the final visual finishing touches.

## Saved-game examples

Assume the browser’s active-game pointer names an unfinished game on Battlefield 40.

- Opening `/play` resumes that game and sets the address to `/play/40`.
- Opening `/play/40` resumes that game.
- Opening `/play/60` shows new-match setup for Battlefield 60. The Battlefield 40 game remains the active pointer until another game starts.
- Returning to `/play` before starting Battlefield 60 resumes the Battlefield 40 game.
- Starting a game on Battlefield 60 changes the active pointer to the new game. After that, `/play` and `/play/60` resume the new game.
- Opening `/play/40` after Battlefield 60 starts shows setup for Battlefield 40; it does not recover the old Battlefield 40 game because battlefield URLs identify card sets, not individual saved games.

## Decisions

### D1. Use `/play/<number>` as the canonical route

The route is short, bookmarkable, and shareable. `/play/42` identifies public Battlefield 42. Do not add a second `/play/battlefield/<number>` route.

### D2. Make public numbers explicit catalog data

The setup interface exposes `battlefields: Array<{ number, variableCardIds }>` instead of an unlabelled array of card sets. Public numbers derive from the existing stable internal catalog IDs:

- `balance-tuning-001` through `balance-tuning-128` map to 1 through 128.
- `balance-validation-001` through `balance-validation-032` map to 129 through 160.

Catalog loading rejects an ID that cannot produce one unique number in this range. A future catalog must preserve these public assignments; array position is not identity.

### D3. Keep game creation card-based

The browser still sends the selected 10 `variableCardIds` to the existing game-creation interface. The server already validates those cards, and the AI trainer already requires a matching pretrained internal kingdom. Public battlefield numbering belongs to setup navigation, not deterministic game rules or saved-game schema.

### D4. Centralize selection and route conversion

The client setup-market module owns lookup by public battlefield number, lookup by card-set signature, random selection excluding the current battlefield, route parsing, and canonical path generation. `PlayApp` coordinates local storage and browser history through that small interface.

### D5. Put selection in setup and identity in the market heading

The setup rail contains the editable number control because changing battlefields is setup work. During a match, the market heading remains visible but read-only, so selecting a number cannot silently abandon a live game.

### D6. Let an explicit route suppress a different saved game without replacing it

A direct battlefield link must show the battlefield it names. A different saved game remains the browser’s active pointer until the player starts a replacement game. This makes preview navigation reversible through bare `/play` while keeping direct links reliable.

### D7. Keep `Refresh market`

The existing button label stays unchanged. Its current behavior still selects another random trained market; the new behavior also writes that battlefield’s canonical URL.

### D8. Treat the first styling pass as reviewable

The implementation fits the selector and battlefield label into the current visual system without redesigning the table. Final spacing and presentation can change after the user reviews the rendered result.

## Implementation

### 1. Add stable public battlefield numbers

- Extend the pretrained catalog model with a public number derived from the stable internal kingdom ID.
- Validate all 160 numbers for range and uniqueness while loading the catalog.
- Add a setup-catalog projection that contains only the public number and variable card IDs.
- Replace `trainedVariableCardSets` in `SetupCatalog` and `/api/setup` with `battlefields`.
- Keep scientific plan data and game-record schemas unchanged.

Verification:

- Unit tests prove the four mapping boundaries: tuning 1, tuning 128, validation 1 as public 129, and validation 32 as public 160.
- HTTP tests prove exact ordered numbers 1 through 160, unique card signatures, and 10 valid cards per battlefield.
- Run the relevant pretrained-catalog, AI, and HTTP tests.

### 2. Add the client battlefield-selection module

- Replace raw card-array selection with numbered-battlefield selection.
- Add exact lookup by number and by order-independent card signature.
- Parse only `/play` and `/play/<integer>` as battlefield routes.
- Generate canonical `/play/<number>` paths.
- Return explicit invalid-route results so `PlayApp` can recover with useful copy.

Verification:

- Unit tests cover random selection, current-battlefield exclusion, card-order-independent lookup, valid paths, malformed paths, range errors, and canonical path output.
- Run the focused client unit tests and typecheck.

### 3. Coordinate URL, the active-game pointer, and setup state

- Initialize setup from the requested route or a random battlefield.
- Resume the active game when `/play` is bare or its battlefield matches the explicit route.
- Keep a different active-game pointer while the explicit route shows another battlefield’s setup.
- Replace the pointer only after successful creation of a new game.
- Canonicalize the URL after random choice, exact choice, active-game resume, and New game.
- Keep late-response generation guards intact.

Verification:

- Browser tests cover direct navigation, reload of a matching active game, explicit setup for a different battlefield, bare `/play` recovery before replacement, pointer replacement on Start game, New game retention, and canonical URL changes.
- Existing late-response and New game tests remain green.

### 4. Add the visible selector and battlefield label

- Add an accessible number form to the setup rail with a real `Battlefield number` label, `min=1`, `max=160`, inline validation, and a `Load battlefield` submit button.
- Keep the existing `Refresh market` copy and make it update the URL after choosing another battlefield.
- Show `Battlefield <number> of 160` beside the battlefield-pile heading in preview and live-game markets.
- Reuse existing control styles and add only the layout rules needed at supported desktop sizes.

Verification:

- Browser tests select a battlefield by keyboard and button, reject invalid values without changing the market, refresh to a different battlefield, and confirm the displayed number during setup and play.
- Check 1280×720, 1920×1080, and 3840×2160 for clipping and page overflow.

### 5. Document and validate the finished behavior

- Update README playtest copy with the numbered route and selector.
- Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and the relevant Playwright coverage.
- Run `git diff --check` and inspect the final diff for unrelated changes.

## Not authorized

- Do not deploy or push.
- Do not change the 160 battlefield card sets, pretrained strategies, game rules, statistics, reset-series rules, or saved-game schema.
- Do not add arbitrary ten-card market building, battlefield search by card name, or a saved-game list.
