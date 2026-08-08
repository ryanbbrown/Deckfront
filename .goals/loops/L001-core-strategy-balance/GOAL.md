# L001: Core strategy balance

Code root: .
Run root: .games/L001

## Objective

Establish a balanced baseline for attack, movement, and range strategies when both players have equal market access.

Each strategy should be a credible choice. No strategy should be the best choice in every normal matchup. A limited matchup advantage is acceptable, including a possible rock-paper-scissors pattern.

## Why this loop exists

The current Skirmish runner produces complete, strictly validated games. The deck can create a meaningful combat advantage. The next uncertainty is whether the core upgrade strategies are reasonably balanced.

## In scope

- Define the attack, movement, and range strategies.
- Define how a run proves that an assigned strategy was represented.
- Compare the three strategies under equal market access.
- Tune the approved balance levers.
- Confirm a promising baseline across repeated, controlled matchups.

## Allowed changes

The allowed balance levers are not yet approved. Complete this section before experiment E001 starts.

## Frozen parts

- The shared ThinHarness turn workflow.
- Strict deck, board, and win validation.
- The requirement to play every action card before trash and purchase decisions.

Add all other frozen rules, map parts, units, cards, and model settings before experiment E001 starts.

## Experiment method

The exact matchup, seed, player-order, and strategy-representation rules are not yet approved.

## Evidence and metrics

The exact balance thresholds and required sample size are not yet approved.

Every balance conclusion must use full evidence or explain why partial evidence remains useful.

## Completion criteria

- Each core strategy has enough valid, representative games against the other strategies.
- No core strategy is universally dominant under the approved balance threshold.
- The result survives the approved confirmation batch.
- The final baseline and remaining uncertainties are recorded in `EXPERIMENTS.md`.

## Autonomy

- The agent may inspect the current game and propose the missing loop definitions.
- User approval is required before experiment E001 starts.
- Experiment autonomy after E001 is not yet approved.
