# Kingdom selection

## Goal

Give each of the 160 playable kingdoms a stable public number. Let a player open, share, and select a kingdom with `/play/<number>` while keeping the kingdom visible in setup and during play.

## Current state

- `/play` loads the game application. Other non-public paths also fall through to the game application.
- The setup response exposes 160 card arrays without public numbers.
- The browser chooses one array at random and sends its 10 card IDs when it creates a game.
- An active game ID in local storage resumes after reload.
- “New game” now returns to setup with the current game’s kingdom.
- “Refresh market” chooses a different trained market.

## Product behavior

1. `/play` chooses one of the 160 kingdoms when there is no active game, then replaces the address with `/play/<number>`.
2. `/play/<number>` selects that exact kingdom. Valid numbers are 1 through 160.
3. A matching saved active game resumes on reload. If an explicit URL names a different kingdom, the explicit URL wins: the browser clears the saved active-game pointer and opens setup for the requested kingdom.
4. A malformed or out-of-range kingdom URL recovers to a random valid kingdom, replaces the address with the valid canonical URL, and shows an error that explains the accepted range.
5. Setup shows a labeled kingdom-number input, `Load kingdom`, and `Random kingdom`. Submitting a valid number changes the market and canonical URL. Invalid input keeps the current market and URL and shows an inline error.
6. The market heading shows `Kingdom <number> of 160` in setup and during play.
7. `New game` keeps the current kingdom and URL. Reset continues to restart the same market and shuffle.
8. URL updates use `history.replaceState`. Kingdom selection does not add 160 setup choices to browser Back history.

## Decisions

### D1. Use `/play/<number>` as the canonical route

The route is short, bookmarkable, and shareable. `/play/42` identifies public Kingdom 42. Do not add a second `/play/kingdom/<number>` route.

### D2. Make public numbers explicit catalog data

The setup interface exposes `kingdoms: Array<{ number, variableCardIds }>` instead of an unlabelled array of card sets. Public numbers derive from the existing stable catalog IDs:

- `balance-tuning-001` through `balance-tuning-128` map to 1 through 128.
- `balance-validation-001` through `balance-validation-032` map to 129 through 160.

Catalog loading rejects an ID that cannot produce one unique number in this range. A future catalog must preserve these public assignments; array position is not identity.

### D3. Keep game creation card-based

The browser still sends the selected 10 `variableCardIds` to the existing game-creation interface. The server already validates those cards, and the AI trainer already requires a matching pretrained kingdom. Public numbering belongs to setup navigation, not deterministic game rules or saved-game schema.

### D4. Centralize selection and route conversion

The client setup-market module owns lookup by public number, lookup by card-set signature, random selection excluding the current kingdom, route parsing, and canonical path generation. `PlayApp` coordinates local storage and browser history through that small interface.

### D5. Put selection in setup and identity in the market heading

The setup rail contains the editable number control because changing kingdoms is setup work. During a match, the market heading remains visible but read-only, so selecting a number cannot silently abandon a live game.

### D6. Let an explicit route override a different saved game

A direct kingdom link must show the kingdom it names. Reload still resumes when the saved game and URL identify the same kingdom. This keeps shareable links reliable without removing active-game persistence.

## Implementation

### 1. Add stable public catalog numbers

- Extend the pretrained catalog model with a public number derived from the stable internal kingdom ID.
- Validate all 160 numbers for range and uniqueness while loading the catalog.
- Add a setup-catalog projection that contains only the public number and variable card IDs.
- Replace `trainedVariableCardSets` in `SetupCatalog` and `/api/setup` with `kingdoms`.
- Keep scientific plan data and game-record schemas unchanged.

Verification:

- Unit tests prove the four mapping boundaries: tuning 1, tuning 128, validation 1 as public 129, and validation 32 as public 160.
- HTTP tests prove exact ordered numbers 1 through 160, unique card signatures, and 10 valid cards per kingdom.
- Run the relevant pretrained-catalog, AI, and HTTP tests.

### 2. Add the client kingdom-selection module

- Replace raw card-array selection with numbered-kingdom selection.
- Add exact lookup by number and by order-independent card signature.
- Parse only `/play` and `/play/<integer>` as kingdom routes.
- Generate canonical `/play/<number>` paths.
- Return explicit invalid-route results so `PlayApp` can recover with useful copy.

Verification:

- Unit tests cover random selection, current-kingdom exclusion, card-order-independent lookup, valid paths, malformed paths, range errors, and canonical path output.
- Run the focused client unit tests and typecheck.

### 3. Coordinate URL, saved games, and setup state

- Initialize setup from the requested route or a random kingdom.
- Load a saved game only when `/play` is bare or its kingdom matches the explicit route.
- Clear the local active-game pointer when an explicit route selects a different kingdom.
- Canonicalize the URL after random choice, exact choice, active-game resume, and New game.
- Keep late-response generation guards intact.

Verification:

- Browser tests cover direct navigation, reload of a matching active game, explicit-route override of a different active game, New game retention, and canonical URL changes.
- Existing late-response and New game tests remain green.

### 4. Add the visible selector and kingdom label

- Add an accessible number form to the setup rail with a real label, `min=1`, `max=160`, inline validation, and a `Load kingdom` submit button.
- Rename `Refresh market` to `Random kingdom`.
- Show `Kingdom <number> of 160` beside the battlefield-pile heading in preview and live-game markets.
- Reuse existing control styles and add only the layout rules needed at supported desktop sizes.

Verification:

- Browser tests select a kingdom by keyboard and button, reject invalid values without changing the market, choose a different random kingdom, and confirm the displayed number during setup and play.
- Check 1280×720, 1920×1080, and 3840×2160 for clipping and page overflow.

### 5. Document and validate the finished behavior

- Update README playtest copy with the numbered route and selector.
- Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and the relevant Playwright coverage.
- Run `git diff --check` and inspect the final diff for unrelated changes.

## Not authorized

- Do not deploy or push.
- Do not change the 160 kingdom card sets, pretrained strategies, game rules, statistics, reset-series rules, or saved-game schema.
- Do not add arbitrary ten-card market building or kingdom search by card name.
