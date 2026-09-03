# Battlefield selection

## Goal

Give each of the 160 playable battlefields a stable public number. Let a player open, share, and select a battlefield with `/play/<number>` while keeping the battlefield number visible in setup and during numbered games.

The engine and strategy-search code use “kingdom” internally. Player-facing routes, copy, and setup data use the game term “battlefield.” The rules and README will explain that a numbered battlefield identifies the ten variable market piles used with the six-space arena.

## Current state

- `/play` loads the game application. Other non-public paths also fall through to the game application.
- The setup response exposes 160 card arrays without public numbers.
- The browser chooses one array at random and sends its 10 card IDs when it creates a game.
- Local storage holds one active-game ID, which resumes after reload.
- The server also accepts local games whose card set is not one of the 160 pretrained battlefields.
- `New game` clears the active-game ID and returns to setup with the current game’s market.
- `Refresh market` chooses a different trained market.

## Product behavior

1. The browser loads the setup catalog, then checks the active-game pointer, then chooses a random battlefield only when no game resumes or explicit route applies. It must not write a temporary random URL before resume is decided.
2. `/play` resumes the one active browser game when it exists. A numbered active game changes the address to `/play/<number>`. An unnumbered local/API game resumes at `/play` without invented numbering.
3. With no active game, `/play` chooses one of the 160 numbered battlefields and replaces the address with `/play/<number>`.
4. `/play/<number>` selects that exact battlefield. Valid numbers come from the loaded catalog, currently 1 through 160.
5. `/play/` is accepted as bare `/play`. `/play/042`, `/play/42/`, and forms with both are accepted and normalized to `/play/42`. Signs, decimals, `/play//`, and other empty or extra path segments are invalid. Canonicalization preserves the current query string and hash.
6. A saved active game resumes when its numbered battlefield matches the explicit URL. If the URL names a different battlefield, the URL opens setup for the requested battlefield but keeps the old active-game pointer until the player starts another game.
7. Starting a game replaces the browser’s active-game pointer only after game creation succeeds. The old server record remains, but the normal interface has no list for returning to it. No replacement warning is added.
8. A malformed or out-of-range `/play/...` route stays in setup, chooses a random valid battlefield, replaces the address with its canonical URL, and shows a page-level error with the valid range. It never resumes the active game during that recovery, even if the random choice matches.
9. A path outside `/`, `/rules`, `/about`, and `/play...` behaves like bare `/play` without a battlefield-range error, then canonicalizes when a numbered battlefield is known.
10. Setup shows a blank `Go to battlefield` number input, a `Load` button, and the valid range. Submitting a valid number changes the market and canonical URL, then clears the input. Invalid input keeps the current market and URL and shows an inline field error.
11. The existing `Refresh market` button keeps its label, chooses a different numbered battlefield, updates the URL, keeps the selector blank, and clears route or field errors.
12. Loading a valid battlefield clears route or field errors. Game-creation failures continue to use the existing page-level error.
13. The battlefield-pile heading shows `Battlefield <number>` in setup and during numbered games. An unnumbered active game keeps the existing `Battlefield piles` heading without a false number.
14. `New game` keeps the current market and numbered URL but clears the active-game pointer immediately. Reload from that setup page stays in setup. Reset continues to restart the same market and shuffle.
15. URL updates use `history.replaceState`. Battlefield selection does not add setup choices to browser Back history.
16. The selector uses the existing visual system and fits the supported desktop layouts.

## Saved-game examples

Assume the browser’s active-game pointer names an unfinished game on Battlefield 40.

- Opening `/play` resumes that game and sets the address to `/play/40`.
- Opening `/play/40` resumes that game.
- Opening `/play/60` shows new-match setup for Battlefield 60. The Battlefield 40 game remains the active pointer until another game starts.
- Returning to `/play` before starting Battlefield 60 resumes the Battlefield 40 game.
- Starting a game on Battlefield 60 changes the active pointer to the new game. After that, `/play` and `/play/60` resume the new game.
- Opening `/play/40` after Battlefield 60 starts shows setup for Battlefield 40; it does not recover the old Battlefield 40 game because battlefield URLs identify card sets, not individual saved games.
- Choosing `New game` from a live Battlefield 40 game clears the pointer and shows Battlefield 40 setup. Reload stays on that setup rather than resuming the closed game.

## Decisions

### D1. Use `/play/<number>` as the canonical route

The route is short, bookmarkable, and shareable. `/play/42` identifies public Battlefield 42. Do not add a second `/play/battlefield/<number>` route. Treat `/play/` as bare `/play`, but reject `/play//`. Normalize leading zeroes and a trailing slash on numbered routes while preserving query and hash values.

### D2. Make public numbers explicit catalog data

The setup interface exposes `battlefields: Array<{ number, variableCardIds }>` instead of an unlabelled array of card sets. Public numbers derive from the existing stable internal catalog IDs:

- `balance-tuning-001` through `balance-tuning-128` map to 1 through 128.
- `balance-validation-001` through `balance-validation-032` map to 129 through 160.

Catalog loading rejects an unrecognized ID, an out-of-range number, or a duplicate public number. The current public suite is fixed at 160 entries; future catalog work must preserve these assignments or define a new non-colliding public scheme. Array position is not identity.

### D3. Keep game creation card-based

The browser still sends the selected 10 `variableCardIds` to the existing game-creation interface. The server already validates those cards, and the AI trainer already requires a matching pretrained internal kingdom. Public battlefield numbering belongs to setup navigation, not deterministic game rules or saved-game schema.

An active local/API game with no catalog match remains supported: it resumes only from bare `/play`, stays unnumbered, and uses the existing `Battlefield piles` heading.

### D4. Centralize selection and route conversion

The client setup-market module owns lookup by public battlefield number, lookup by card-set signature, random selection excluding the current battlefield, route parsing, and canonical URL generation. `PlayApp` coordinates local storage and browser history through that small interface.

The catalog array length supplies the numeric input maximum and validation range. Do not repeat 160 in client behavior.

### D5. Put selection in setup and identity in the market heading

The setup rail contains the editable number control because changing battlefields is setup work. During a match, the market heading remains visible but read-only, so selecting a number cannot silently abandon a live game.

Route errors use the existing page alert. Field errors stay next to the labeled input with `aria-invalid` and `aria-describedby`. A successful load or refresh clears both selection errors.

### D6. Let an explicit route suppress a different saved game without replacing it

A direct battlefield link must show the battlefield it names. A different saved game remains the browser’s active pointer until the player starts a replacement game. This makes preview navigation reversible through bare `/play` while keeping direct links reliable.

Invalid `/play/...` recovery is setup-only and never resumes the pointer. `New game` is a separate explicit close action and continues to clear the pointer immediately.

### D7. Keep `Refresh market`

The existing button label stays unchanged. It selects another random trained market, writes that battlefield’s canonical URL, and leaves the number input blank.

### D8. Use a quiet action field

The selector has no enclosing card surface. It uses a dark inset number field and a gold `Load` button so that the input and action have distinct roles. The input starts blank and does not mirror the current battlefield.

## Implementation

### 1. Add stable public battlefield numbers

- Extend the pretrained catalog model with a public number derived from the stable internal kingdom ID.
- Validate all public numbers for recognized ID pattern, range, and uniqueness while loading the catalog.
- Add a setup-catalog projection that contains only the public number and variable card IDs.
- Replace `trainedVariableCardSets` in `SetupCatalog` and `/api/setup` with `battlefields`. Keep the existing internal card-set helper where simulation and AI callers still use it.
- Keep scientific plan data and game-record schemas unchanged.

Verification:

- Unit tests prove valid mapping boundaries and rejection of malformed IDs, out-of-range derived numbers, and duplicate public numbers.
- Tests prove all public numbers round-trip and form the exact sequence 1 through the catalog count.
- HTTP tests prove ordered numbers, unique card signatures, and 10 valid cards per battlefield.
- Run the relevant pretrained-catalog, AI, and HTTP tests.

### 2. Add the client battlefield-selection module

- Replace raw card-array selection with numbered-battlefield selection.
- Add exact lookup by number and by order-independent card signature, with an explicit unmatched result.
- Parse bare `/play`, accepted numeric forms, invalid `/play/...` forms, and other fallback paths as distinct cases.
- Generate canonical URLs that preserve query strings and hashes.

Verification:

- Unit tests cover random selection, current-battlefield exclusion, selector synchronization, order-independent and unmatched card lookup, accepted normalization, malformed paths, range errors, fallback paths, and query/hash preservation.
- Run the focused client unit tests and typecheck.

### 3. Coordinate URL, the active-game pointer, and setup state

- Use the required initialization order: setup catalog, active pointer load, route decision, then random choice if needed.
- Resume numbered and unnumbered active games from bare `/play` without an intermediate random URL.
- Resume an active game from an explicit route only when its public number matches.
- Keep a different active-game pointer while the explicit route shows another battlefield’s setup.
- Keep invalid-route recovery in setup without resuming the pointer.
- Replace the pointer only after successful creation of a new game; preserve `New game` pointer clearing and late-response generation guards.
- Rewrite the E2E `openGame` fixture so it sets the active pointer and then navigates to bare `/play`, rather than reloading a random canonical URL.

Verification:

- Browser tests cover numbered and unnumbered resume, no intermediate wrong URL, explicit setup for a different battlefield, bare `/play` recovery before replacement, pointer replacement on Start game, invalid route with an active pointer, New game reload behavior, and canonical URL changes.
- Existing late-response and New game tests remain green.

### 4. Add the visible selector and battlefield label

- Add an accessible number form to the setup rail with a `Go to battlefield` label, a blank dark input, `min=1`, a maximum from the catalog count, persistent range help, inline validation, and a gold `Load` submit button.
- Keep the existing `Refresh market` copy. Make it update the URL and error states after choosing another battlefield while the selector stays blank.
- Show `Battlefield <number>` beside the battlefield piles in preview and numbered live games. Preserve the plain heading for unnumbered live games.
- Keep the selector visually quiet and distinct from the surrounding buttons at supported desktop sizes.

Verification:

- Browser tests select a battlefield by keyboard and button, reject invalid values without changing the market, clear errors after a valid load, refresh to a different battlefield, synchronize the input, and confirm the displayed number during setup and play.
- Browser tests prove selection uses replacement rather than extra Back-history entries.
- Re-run instruction query-string reload coverage and the compact market geometry checks.
- Check 1280×720, 1920×1080, and 3840×2160 for clipping and page overflow.

### 5. Document and validate the finished behavior

- Update README and the battlefield rules copy to define a numbered battlefield without changing game mechanics.
- Add new Playwright IDs to `test/e2e/coverage-manifest.json` and `requiredBrowserFlows` in `scripts/validate_e2e_manifest.ts`.
- Confirm the HTTP server returns the client shell for `/play/42`.
- Run `npm run test:e2e:manifest`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and the relevant Playwright coverage.
- Run `git diff --check` and inspect the final diff for unrelated changes.

## Not authorized

- Do not deploy or push.
- Do not change the 160 battlefield card sets, pretrained strategies, game rules, statistics, reset-series rules, or saved-game schema.
- Do not add arbitrary ten-card market building, battlefield search by card name, a saved-game list, or a replacement warning.
