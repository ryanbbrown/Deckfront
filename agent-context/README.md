# Agent Context

This directory contains the reusable prompts and context templates for AI playtests.

The runners should not hide durable player instructions inside Python string literals. Keep stable role instructions here, then let runners render only run-specific and turn-specific context.

## Prompt Layers

- `prompts/playtest-player.system.md`: stable player-agent policy. It tells a player agent how to optimize, how to reason about deck and board play, and how to treat legality.
- `prompts/playtest-initial.user.md`: rendered once at the beginning of each player session. It identifies the run, player, strategy assignment, rules files, map, draft, and setup.
- `prompts/playtest-turn.user.md`: rendered for each active turn. It gives the current compact state briefing and exact command/file contract for one turn.
- `prompts/playtest-repair.user.md`: rendered only after validation fails. It tells the same player session to repair the same turn instead of advancing the game.
- `prompts/review-evaluate.system.md`: stable reviewer/evaluator policy for later batch evaluation agents.

Each runner snapshots rendered prompts under `.games/<run>/context/` so a playthrough can be audited after the shared prompts change.
