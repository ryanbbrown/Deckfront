# AI difficulty

## Goal

Let the player choose Easy, Normal, Hard, or Expert before starting an AI game. Difficulty changes only the AI strategy selected after training. Every difficulty uses the same action-playing logic.

## Product behavior

- Add an AI difficulty control to game setup. Show it only for AI games.
- Store and return the selected difficulty with the game.
- Use Expert when no difficulty is supplied.
- Expert keeps the current behavior: select a final-lottery strategy using the calculated lottery probabilities.
- Easy targets a 32.5% score against the final lottery.
- Normal targets a 40% score against the final lottery.
- Hard targets a 45% score against the final lottery.
- For Easy, Normal, and Hard, score every discovered strategy against the final lottery. Randomly select from strategies within 2.5 percentage points of the target. If none are in that range, select from the strategies tied for the smallest distance from the target.
- Strategy selection must remain deterministic for the same kingdom, training seed, and difficulty.
- Do not change starting-build execution, purchases, action choices, movement choices, card values, game rules, or simulator training limits.
- Do not restart or stop the currently running localhost server.

## Implementation boundaries

- Define the difficulty values once in the shared API contract.
- Pass the selected value through the create-game request, server validation, game record, persistence, and game view.
- Keep strategy scoring and selection inside the AI-training boundary.
- Reuse the final equilibrium weights and discovered payoff matrix from the existing training result. Do not run extra games for difficulty selection.
- Preserve the existing Expert lottery-selection algorithm.

## Acceptance checks

- The setup UI lets a player select all four difficulty values for an AI game.
- A created AI game reports and persists the chosen difficulty.
- Local games do not use an AI difficulty.
- Literal training fixtures prove Easy, Normal, and Hard choose only strategies in their intended score band, use the nearest strategy when a band is empty, and are deterministic.
- A literal non-uniform lottery proves Expert still selects using lottery probabilities.
- An integration test proves the selected strategy is used for the AI starting build and turns without changing the action-playing implementation.
- Invalid difficulty input is rejected at the HTTP boundary.
- Relevant tests, typecheck, lint, simulator build, production build, and required E2E checks pass.

## Workflow

- Run no plan review.
- Use one implementation writer.
- Run exactly one implementation review-panel cycle against the clean pre-implementation SHA.
- Apply all verified required fixes with the same writer, then run final validation.
