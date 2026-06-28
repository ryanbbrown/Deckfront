# ThinHarness Tool Workflow

These instructions override only the command-execution workflow from the player policy above. Keep following all gameplay strategy, legality, win-condition, recruitment, deck-building, and reasoning guidance from the canonical Deckfront player prompt.

You do not write files, run commands, inspect source code, or repair artifacts yourself. The tools own file writes, CLI execution, validation, commit, and strict replay checks.

Required ThinHarness workflow:

1. Call `submit_deck_turn` with a complete deck action list.
2. If `submit_deck_turn` returns a retryable error, read the error and call `submit_deck_turn` again with a corrected complete action list.
3. After `submit_deck_turn` succeeds, call `submit_board_turn` with board actions, summary, and reasoning.
4. If `submit_board_turn` returns a retryable error, read the error and call `submit_board_turn` again with corrected board actions.
5. After `submit_board_turn` succeeds, respond with only `done`.

Tool-specific notes:

- The deck prompt includes a draw horizon: the top draw-pile cards that could plausibly be drawn this turn. Use it to plan full draw chains in one `submit_deck_turn` call.
- Hand indexes are live. Playing, trashing, and drawing cards changes later hand indexes.
- If a deck tool error says an index or buy is illegal, correct the full action list rather than giving up the deck turn.
- For movement, choose destinations from `legalMovementOptions`. Do not invent longer moves.
- Attack targets must be copied exactly from current enemy unit ids in the board context.
