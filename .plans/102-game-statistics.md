# Game statistics and reset attempts

## Goal

Show sitewide completed AI-game results for the selected difficulty on the match setup screen. Preserve every pre-reset game as a distinct full record linked to the fresh attempt, while counting only the latest attempt in each linked series for public results. Statistics must not delay or prevent starting a game. This plan does not add player identity, an operator game browser, or deploy the change.

## Current state

- `src/server/persistence.ts` stores one JSON file per game and can load a game only by ID; it cannot summarize the directory.
- `src/server/gameService.ts` currently resets a game by replacing its state, commands, progress, and result inside the same file.
- `src/server/types.ts` records the mode, AI difficulty, human player, finish time, winner, and full game state needed for results and reset analysis.
- Render can contain schema 14 and schema 15 files. Current gameplay loads schema 15 only, and the production image has no shell for an operator migration.
- `src/client/App.tsx` owns the active game ID in local storage; `src/client/Game.tsx` owns reset and difficulty selection.

## Decisions

- Bump the game record, game view, and export contract to schema 16. Schema 16 adds a first-game ID as the stable series ID, a one-based attempt number, nullable previous and next attempt IDs, and no player identity.
- On reset, preserve the parent gameplay state, commands, events, result, and setup in its file, but mark it with the successor ID and advance its revision under the existing per-game lock. Create a full child file with a new UUID. Reject actions and further resets on a superseded parent, so one attempt cannot fork.
- Start the child at revision 0 with fresh creation and update times, no finish time or duration, and the next attempt number. Reuse the same kingdom, initial state, completed local-draft setup, AI strategy, and training without retraining; apply the present AI-first reset behavior.
- Support schema 16 only after this change. Do not load, normalize, migrate, or count schema 14 and 15 files; leave them untouched on disk. Public statistics begin with schema 16 games.
- Add `GET /api/stats` before the game-ID route. It returns `{ difficulties: [{ difficulty, gamesPlayed, humanWins, aiWins }] }` in easy, normal, hard, expert order. Group schema 16 records by series, choose the unique highest attempt number, and count it only when both `finishedAt` and `state.winner` are present. Exclude local and unfinished latest attempts.
- The statistics reader parses metadata only: schema and lineage, mode, difficulty, human player, finish time, and winner. It does not register kingdoms, parse full game state, or run game invariants. It accepts only UUID `.json` filenames, ignores older schemas and temporary or unrelated files, and fails the optional request on malformed schema 16 data. Results are scanned on each request and are not cached.
- A reset after a win intentionally removes that earlier result from public totals until the latest attempt finishes. A completed latest attempt counts even if the AI won before the human acted. Undo behavior remains unchanged.
- Load statistics independently when setup first appears and refresh them whenever New game returns to setup. Ignore stale responses from older refreshes. Loading or failure must not block or report an error through required setup or Start game behavior.
- In AI mode, place one compact sitewide result panel below the difficulty selector. Show only the selected difficulty and always show numeric values, including `0 games played`, `Human 0`, and `AI 0`.

## Changes

### 1. Preserve one non-forking file per reset attempt

- **Files**: `src/server/types.ts`, `src/server/schemas.ts`, `src/server/persistence.ts`, `src/server/gameService.ts`, `src/shared/api.ts`, `src/client/App.tsx`, `src/client/Game.tsx`, `scripts/seed_playable_game.ts`, `test/server-distance-duel.test.ts`, `test/ai-game.test.ts`, `test/http-distance-duel.test.ts`, `test/random-market.test.ts`, `test/seed-playable-game.test.ts`, `test/e2e/fixture.ts`, `test/e2e/distance-duel.spec.ts`
- **Change**: Add the schema 16 lineage and successor marker across saved and public contracts. Change reset so the locked parent retains its complete pre-reset gameplay data, records one successor, and produces a fresh full child record. All mutating operations reject a parent with a successor. Make test repositories ID-keyed and duplicate-safe. Store the returned child ID in local storage immediately when the reset response arrives, before any AI playback.
- **Tests**:
  - Reset after meaningful progress preserves the parent's state, commands, events, result, and setup while creating a fresh file with a different ID and correct bidirectional lineage.
  - The child has revision 0, fresh timestamps, cleared progress metadata, the same market and setup, and preserved AI strategy and training without calling the trainer.
  - Four resets produce five full files in one ordered series.
  - Concurrent or repeated reset requests against one parent create only one child; the other request fails with a conflict.
  - Actions and resets against a superseded parent fail, including when the caller fetched its advanced revision, and its gameplay data stays unchanged.
  - Schema 14 and schema 15 files remain untouched and unavailable through schema 16 gameplay.
  - Reset updates local storage before AI playback; immediate reload resumes the child.
  - Existing reset, seed, export, fixture, and schema assertions use the schema 16 contract and new game ID behavior.

### 2. Summarize only the latest attempt in each series

- **Files**: `src/server/persistence.ts`, `src/server/types.ts`, `src/shared/api.ts`, `test/http-distance-duel.test.ts`
- **Change**: Add a repository statistics interface with a metadata-only file implementation. Ignore files that are not UUID JSON records and records with older schema versions. Return the exact ordered public aggregate contract without game or lineage details.
- **Tests**:
  - Completed schema 16 AI records across different human seats produce exact per-difficulty human and AI win counts, while schema 14 and schema 15 files do not contribute.
  - A preserved completed attempt followed by an unfinished reset attempt contributes no completed result.
  - Multiple preserved attempts followed by one completed latest attempt contribute exactly that latest result.
  - Local records, standalone unfinished AI records, and records without both completion fields do not contribute.
  - Every supported difficulty is returned with zeros when no matching games exist.
  - Temporary and unrelated filenames do not contribute, and the scan does not register persisted kingdoms.
  - Separate requests each scan current files; a malformed schema 16 file fails the statistics request instead of returning partial totals.

### 3. Expose aggregate statistics

- **Files**: `src/server/httpServer.ts`, `src/client/api.ts`, `test/http-distance-duel.test.ts`
- **Change**: Route `GET /api/stats` before game-ID parsing and add the typed client request. Return aggregate counts only.
- **Tests**:
  - `GET /api/stats` returns status 200 and the exact difficulty order and field values.
  - The response contains no game IDs, lineage, timestamps, markets, or player state.
  - Malformed schema 16 data produces the existing generic server error response without affecting other routes.

### 4. Show fresh selected-difficulty results without blocking setup

- **Files**: `src/client/App.tsx`, `src/client/Game.tsx`, `src/client/styles.css`, `test/e2e/distance-duel.spec.ts`
- **Change**: Fetch statistics independently whenever setup becomes active, keep only the newest response, and render the selected difficulty in a compact panel below AI strength. Use tabular numerals. Show a concise loading state; omit the panel after failure rather than reusing the setup error or disabling Start game.
- **Tests**:
  - Selecting each AI difficulty changes the panel to that difficulty's games-played, human-win, and AI-win values without showing other difficulty results.
  - A zero-count difficulty explicitly shows `0 games played`, `Human 0`, and `AI 0`.
  - Returning through New game refreshes statistics, and a delayed older response cannot replace the refreshed values.
  - Failed and pending statistics requests leave setup and Start game usable.
  - The setup rail remains inside the supported 1280×720 viewport with the statistics panel present.

### 5. Describe the shipped public statistics

- **Files**: `README.md`, `src/client/PublicPages.tsx`, `test/e2e/public-pages.spec.ts`
- **Change**: List difficulty-filtered aggregate game results as available and remove public statistics from coming-soon copy. Keep player accounts and profiles as future work.
- **Tests**:
  - Public project copy describes aggregate AI results as available and does not claim all public statistics are still coming later.

## Acceptance checks

- Every reset preserves the prior attempt's complete gameplay data in its own linked file and returns one new game ID.
- Superseded attempts cannot fork or receive gameplay changes.
- Schema 16 is the only supported gameplay and statistics format; older files stay untouched and do not contribute.
- Public statistics deduplicate linked schema 16 attempts and classify only the latest completed AI attempt in each series.
- The public endpoint exposes aggregate counts only and does not perform full game parsing.
- The setup screen shows fresh sitewide results for only the selected difficulty, including explicit zeros.
- Statistics loading and failure never block game creation.
- No production deployment or Render configuration change is included.

## Validation

- `npx vitest run test/server-distance-duel.test.ts test/ai-game.test.ts test/http-distance-duel.test.ts test/random-market.test.ts test/seed-playable-game.test.ts`
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- `git diff --check`

## Deferred

- A private operator interface for browsing reset chains or individual game files.
- A separate operator migration if old production files later prove valuable.
- Retention, export, or capacity alarms for full reset files if disk growth becomes material.
- Cached or incrementally maintained aggregates for a measured high-volume performance problem.
- Player accounts or cross-series identity.
