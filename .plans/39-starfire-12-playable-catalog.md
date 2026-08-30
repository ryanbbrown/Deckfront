# Starfire 12 playable rules and AI catalog

## Goal

Port the final playable rules and final pretrained opponents from the completed Starfire 12 balance evidence into the current `main` UI. Keep playable AI startup server-only and immediate.

## Evidence

- Source worktree: `/Users/ryanbrown/.bb/worktrees/env_dqhsrzufi4/hexdeck` at `41f9e98`.
- Scientific implementation: `c1995c1` for Goldfish, Matrix, PSRO, and self-play telemetry.
- Analysis: `.data/starfire-12-balance-88/rust-balance-analysis-v2.json`, SHA-256 `9c8c0ff5bc09cda7ea4c44bacea99ff301dff23538b7c4047f8e8ecf8cc5a8de`.
- Provenance: `.data/starfire-12-balance-88/source-provenance-v2.json`, SHA-256 `02ab1ab354d4571bc1e045006a77ee9db749cf90de24b342bafe4e1fdb7e6589`.
- The evidence has 30 kingdoms, 1,588 final-Matrix strategies, and 71 positive-weight equilibrium entries. All strategies have five ordered buy steps and no starting build.
- The evidence was trained at 40 starting health. Playable games use 50 starting health, so the saved strategies and weights are provisional for the playable health setting.

## Decisions

- Preserve the current React UI, card art, `headline` and `detail` presentation fields, setup rail, game playback, persistence, and server API.
- Port only final product rules that differ from `main`:
  - 50 playable starting health with the existing 3-health first-player penalty;
  - Scrap remains in the draft-off starting deck but is not a market pile;
  - Arc Bolt deals 3; Fireball deals 6; Starfire deals 12;
  - Overload deals 3 per mana spent;
  - Rally costs 3 and deals 2 plus 2 per earlier Rally;
  - Bull Rush costs 3 and deals 7;
  - Repelling Shot costs 4; Longshot costs 3; Volley costs 5 and deals 2 at Near or 4 at Far;
  - mana is not cleared after the Action phase and persists between turns, capped at 3 when the Buy phase ends;
  - Opening Strike checks for an earlier attack, not an earlier card.
- Keep the current six-space arena, first-Scrap-per-turn behavior, Improvise family behavior, and all current-main UI work.
- Update only the tactical-policy state needed for the Opening Strike rule. Do not port unrelated simulator or balance-branch policy work.
- Keep the compact server-only catalog shape. Derive every kingdom and strategy from the final analysis. Treat Scrap as a non-market starter when deriving the 10 variable cards. Strategy IDs need only be unique inside a kingdom because the final evidence contains one valid cross-kingdom duplicate.
- Expert samples the saved positive-weight equilibrium lottery. Easy, Normal, and Hard keep the current score targets, score band, fallback, and deterministic seeds.
- Add no Rust, worker, Modal, or training dependency to playable game creation. Do not run Modal or any paid command.
- Do not change `package.json` or add npm scripts.

## Implementation

1. Update card data, starting health, market composition, mana cleanup, Opening Strike engine behavior, and the matching tactical view.
2. Regenerate `src/server/pretrained-opponents.json` exactly from the final analysis. Update strict loader signatures and counts, and update the verifier to accept the final analysis path without embedding a machine-specific path.
3. Add strict tests for all changed card values and rules, all 30 literal kingdom signatures and plan counts, strategy validity, equilibrium sums and support count, deterministic difficulty choices, weighted Expert choices, immediate catalog-backed server creation, and a complete real catalog-backed AI game.
4. Update README play rules, catalog counts, evidence identity, and verification command.

## Acceptance checks

- The server exposes exactly the same 30 trained 10-card kingdom signatures as the final evidence.
- The catalog contains exactly 1,588 strategies and 71 positive-weight entries. Each kingdom's weights total 1 within strict floating-point tolerance.
- The committed catalog is byte-for-byte equal to data derived by the verifier from the final analysis.
- Every buy step names a card available in that kingdom, and each decoded strategy has five active plus five inactive slots.
- Same kingdom, seed, and difficulty gives the same strategy. Expert selects only saved positive-weight entries. Other difficulties use their existing score rules.
- A real `GameService` AI game uses the default pretrained trainer, starts without workers or matches, advances automatic AI turns, and reaches a valid result.
- Refresh remains limited to the 30 trained kingdoms.
- `package.json` is unchanged.

## Validation

- Install locked dependencies with `npm ci` if the fresh worktree has no `node_modules`.
- Run the final-analysis catalog verifier against the read-only source path.
- Run focused card, kingdom, AI difficulty, AI game, setup, HTTP, and server Vitest files.
- Run the complete non-E2E Vitest suite, updating only assertions or fixtures that represent intentionally changed playable rules.
- Run `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`.
- Run other repository checks only when the changed rules require them. Do not run Modal, paid actions, or runtime Rust training.
