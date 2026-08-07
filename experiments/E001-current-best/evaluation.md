# Evaluation

## ThinHarness validating-tool runner

Command:

```sh
uv run scripts/run_game_thinharness.py --run ../runs/thinharness-gpt55-rulesconfig-20turn-01 --reset --max-turns 20 --model openai:gpt-5.5 --effort low --timeout-seconds 120 --tool-retries 4 --max-model-requests 12 --max-tool-calls 12
```

Result: user interrupted the live run after 11 strict-valid entries. This is not a full 20-turn benchmark.

Timing from `runs/thinharness-gpt55-rulesconfig-20turn-01/timings.jsonl`:

- Average player turn: 20.78s
- Median player turn: 19.54s
- Max player turn: 37.40s
- Turns over 30s: 1 of 11

Tool behavior:

- `submit_deck_turn` writes the proposed deck action list and validates it through the real deck CLI.
- `submit_board_turn` writes board actions, runs the board CLI, commits the turn, and strict-validates the replay.
- Invalid submissions are returned to the model as retryable tool errors; the runner does not replace them with deterministic fallback turns.
- The ThinHarness system prompt now composes the canonical `playtest-player.system.md` with a tool-only addendum, and each turn prompt includes the same injected setup/rules context used by the Claude runner.
- Board rules are now represented by explicit code config instead of parsing ruleset-name substrings. The previous matched-context 20-turn run is no longer valid evidence because it accidentally used cost-5 recruitment through the old string fallback while the written `current` rules require cost 6.
- Live corrected-rules run retries: 1 deck-tool retry across 11 turns.

Gameplay notes: the corrected-rules run remains tactically active through the interrupted 11-turn sample. First recruit occurs on turn 004, and the run recruits 7 units in 11 turns under the corrected cost-6 rule. The players contest centers, chain deck actions before buying, recruit from supply income when legal, and resolve attacks through validated board actions.
