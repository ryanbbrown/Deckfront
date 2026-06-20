# CLI Fixes

## Goal

Build validation-grade playtest tooling where agents choose intended actions, shared CLIs execute or reject those actions, and replay artifacts are derived from executed state transitions rather than model-authored summaries.

## Assumptions

- Evidence runs should be turn-by-turn. Whole-game or multi-turn generated logs can still be design sketches, but they are not full playtest evidence until replayed through validation-grade tooling.
- The existing deck engine and interactive CLI should be adapted, not replaced.
- Deck execution is the first segment because it closes the clearest evidence gap from `.goals/IMPROVEMENTS.md`.
- Board execution should be a separate CLI segment that consumes deck-produced counters and applies/validates board actions.

## Segments

| Segment | Scope | Status |
| --- | --- | --- |
| 1 | Structured deck-turn CLI plus strict deck replay validation | Complete for this segment |
| 2 | Structured board-turn CLI plus board action application | Complete for this segment |
| 3 | Playtest orchestration that commits one coherent deck+board player turn | Complete for this segment |

## Segment 1 Plan Review

- Plan file: `.plans/structured-deck-cli.md`
- Review command: `/Users/ryanbrown/code/global-agent-context/plugins/personal/skills/multi-review/scripts/review-round.sh --feature "structured deck CLI" --mode plan --target-file .plans/structured-deck-cli.md`
- Review output:
  - `.reviews/plans/structured-deck-cli/structured-deck-cli-codex-v1.md`
  - `.reviews/plans/structured-deck-cli/structured-deck-cli-claude-v1.md`
  - `.reviews/plans/structured-deck-cli/structured-deck-cli-droid-custom-deepseek-v4-pro-0-v1.md`
- Result: changes requested; plan updated to address strict-deck gating, replay action data, pending actions, card id canonicalization, snapshot writing, and produced-counter derivation.

## Segment 1 Implementation

- Implementation status: structured deck action schema, legal-actions CLI, deck-turn CLI, deck action replay validation, strict-deck validate flag, and focused tests added.
- Verification:
  - `bun test tests/cli/structured.test.ts` passed.
  - `bun test tests/playtest/deck-validation.test.ts` passed.
  - `bun run typecheck` passed.
  - `bun run test` passed before implementation review: 23 files, 82 tests.
- Implementation review command: `/Users/ryanbrown/code/global-agent-context/plugins/personal/skills/multi-review/scripts/review-round.sh --feature "structured deck CLI" --mode implementation`
- Implementation review output:
  - `.reviews/implementations/structured-deck-cli/structured-deck-cli-codex-v1.md`
  - `.reviews/implementations/structured-deck-cli/structured-deck-cli-claude-v1.md`
  - `.reviews/implementations/structured-deck-cli/structured-deck-cli-droid-custom-deepseek-v4-pro-0-v1.md`
- Review fixes applied:
  - Fixed `deck-turn` mutable `deck.json` persistence to write the executed after snapshot's advanced `rngState`.
  - Added regression coverage that persisted `deck.json.rngState` matches the after snapshot.
  - Made `legal-actions --json` meaningful by emitting human-readable legal actions when omitted.
  - Added strict board validation coverage for logged recruits that are absent from `board.after`.
- Final verification after review fixes:
  - `bun test tests/cli/structured.test.ts` passed: 5 tests.
  - `bun test tests/playtest/run.test.ts tests/playtest/deck-validation.test.ts` passed: 26 tests.
  - `bun run typecheck` passed.
  - `bun run test` passed: 23 files, 84 tests.
  - `bun run viewer:typecheck` passed.
  - `git diff --check` passed.

## Open Decisions

- Segment 2 plan file: `.plans/structured-board-cli.md`.
- Segment 2 plan review command: `/Users/ryanbrown/code/global-agent-context/plugins/personal/skills/multi-review/scripts/review-round.sh --feature "structured board CLI" --mode plan --target-file .plans/structured-board-cli.md`
- Segment 2 plan review output:
  - `.reviews/plans/structured-board-cli/structured-board-cli-codex-v1.md`
  - `.reviews/plans/structured-board-cli/structured-board-cli-claude-v1.md`
  - `.reviews/plans/structured-board-cli/structured-board-cli-droid-custom-deepseek-v4-pro-0-v1.md`
- Segment 2 plan review result: changes requested; plan updated to use `cli board-turn`, derive attack damage/removal, require turn id matching, define counter defaults, clarify center stickiness, specify no-write-on-failure, and add edge-case tests.
- Segment 2 implementation status: `board-turn` CLI, board action input/result schemas, board action executor, snapshot/result/state writing, shared income/recruit-cost helpers, and focused tests added.
- Segment 2 verification before implementation review:
  - `bun test tests/cli/board-turn.test.ts` passed: 12 tests.
  - `bun run typecheck` passed.
  - `bun run test` passed: 24 files, 96 tests.
  - `bun run viewer:typecheck` passed.
  - `git diff --check` passed.
- Segment 2 implementation review command: `/Users/ryanbrown/code/global-agent-context/plugins/personal/skills/multi-review/scripts/review-round.sh --feature "structured board CLI" --mode implementation`
- Segment 2 implementation review output:
  - `.reviews/implementations/structured-board-cli/structured-board-cli-codex-v1.md`
  - Claude failed due usage/session limits; log: `.reviews/implementations/structured-board-cli/.logs/v1/claude.stdout`
  - `.reviews/implementations/structured-board-cli/structured-board-cli-droid-custom-deepseek-v4-pro-0-v1.md`
- Segment 2 review fixes applied:
  - Enforced recruit-cap rulesets in `board-turn`.
  - Enforced recruit-cap rulesets in strict replay validation.
  - Enforced enemy-occupied movement path blocking in strict replay validation.
  - Enforced cumulative printed-heal budget per healer in strict replay validation.
  - Added regression tests for all four fixes.
- Segment 2 final verification:
  - `bun test tests/cli/board-turn.test.ts` passed: 13 tests.
  - `bun test tests/playtest/run.test.ts` passed: 26 tests.
  - `bun run typecheck` passed.
  - `bun run test` passed: 24 files, 100 tests.
  - `bun run viewer:typecheck` passed.
  - `git diff --check` passed.
- Segment 3 plan file: `.plans/playtest-commit-turn.md`.
- Segment 3 plan review command:
  - First attempt failed at Claude preflight before other reviewers ran.
  - Rerun: `SKIP_PREFLIGHT=1 /Users/ryanbrown/code/global-agent-context/plugins/personal/skills/multi-review/scripts/review-round.sh --feature "playtest commit turn" --mode plan --target-file .plans/playtest-commit-turn.md`
- Segment 3 plan review output:
  - `.reviews/plans/playtest-commit-turn/playtest-commit-turn-codex-v1.md`
  - Claude failed due usage/session limits; log: `.reviews/plans/playtest-commit-turn/.logs/v1/claude.stdout`
  - `.reviews/plans/playtest-commit-turn/playtest-commit-turn-droid-custom-deepseek-v4-pro-0-v1.md`
- Segment 3 plan review result: changes requested; plan updated to require conventional safe deck and board snapshot paths, explicit board-before reads, run-root temp validation, `{ strict: true, strictDeck: true }`, and default `winEvents: []`.
- Segment 3 implementation status: `playtest commit-turn` subcommand, timeline assembly, conventional snapshot path checks, candidate temp-file validation, default `winEvents: []`, and focused tests added.
- Segment 3 verification before implementation review:
  - `bun test tests/playtest/commit-turn.test.ts` passed: 7 tests.
  - `bun run typecheck` passed.
  - `bun run test` passed: 25 files, 107 tests.
  - `bun run viewer:typecheck` passed.
  - `git diff --check` passed.
- Segment 3 implementation review command: `SKIP_PREFLIGHT=1 /Users/ryanbrown/code/global-agent-context/plugins/personal/skills/multi-review/scripts/review-round.sh --feature "playtest commit turn" --mode implementation`
- Segment 3 implementation review output:
  - `.reviews/implementations/playtest-commit-turn/playtest-commit-turn-codex-v1.md`
  - Claude failed due usage/session limits; log: `.reviews/implementations/playtest-commit-turn/.logs/v1/claude.stdout`
  - `.reviews/implementations/playtest-commit-turn/playtest-commit-turn-droid-custom-deepseek-v4-pro-0-v1.md`
- Segment 3 review fixes applied:
  - Added `--win-events` and `--terminal-win-events` inputs so `commit-turn --strict-win` can commit turns with required win events.
  - Added strict board validation for `board.after.turn` advancement.
  - Kept board turn advancement validation under `strict` board validation so strict-win-only archival checks remain possible.
  - Added regression tests for supplied win events under strict-win and stale `board.after.turn` rejection.
- Segment 3 final verification:
  - `bun test tests/playtest/commit-turn.test.ts` passed: 9 tests.
  - `bun test tests/playtest/run.test.ts` passed: 26 tests.
  - `bun run typecheck` passed.
  - `bun run test` passed: 25 files, 109 tests.
  - `bun run viewer:typecheck` passed.
  - `git diff --check` passed.
