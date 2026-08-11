# L001: Core strategy balance

Code root: .
Run root: .games/L001

## Objective

Establish a balanced baseline for coherent strategies that combine attack, movement, range, unit composition, and card choices under equal market access.

A strategy is a complete battlefield plan, not a commitment to one stat. For example, a range strategy can add attack or movement when those investments support its plan.

Pure attack, movement, or range builds are useful reference points. Mixed builds are equally valid. No build or unit composition should be the best choice in every normal matchup.

## Why this loop exists

The current Skirmish runner produces complete, strictly validated games. The deck can create a meaningful combat advantage. The next uncertainty is whether several distinct builds can compete without one universal best choice.

## In scope

- Create and revise any number of cohesive strategy files during the loop.
- Test pure and mixed investments across attack, movement, and range.
- Test pure and mixed soldier and archer compositions.
- Determine whether one unit composition or build is universally superior.
- Define how a run proves that an assigned strategy was represented.
- Compare strategies under equal market access.
- Tune any game value, rule, or system that affects strategy balance.
- Confirm a promising baseline across repeated, controlled matchups.

## Allowed changes

- The loop may change any repository file when the change supports the objective.
- Start with card costs, card outputs, unit base stats, upgrade costs, key-point rewards, unit setups, and map values.
- Change rules, cards, units, maps, prompts, runners, validators, or experiment methods when evidence supports a broader change.
- Preserve strict evidence. A runner or validator change must improve correctness or support a recorded rule change.

## Frozen parts

- No game value, rule, map part, unit, card, or strategy is frozen.
- Evidence runs must remain reproducible and pass the strict validation required by `.goals/OPERATING.md`.
- Every run must preserve its exact player strategies and configuration.

## Experiment method

- Define each strategy as a cohesive plan with unit composition, purchase priorities, upgrade priorities, and board tactics.
- Store strategies under this loop's `strategies/` folder. Add and revise strategy variants as evidence develops.
- Use equal market access and record both player setups for every run.
- Cap initial games at 30 completed player turns, which gives each player at most 15 turns.
- Review the full trace before accepting a result. Confirm that each player followed its assigned plan.
- One representative game can justify tuning when the imbalance is clear.
- Run a second game when the first result is close, balanced, or uncertain.
- Use mirrored player order when first-player advantage could explain the result.
- Treat two runs as the normal limit for one matchup. Run more only when the traces show a specific unresolved question.

## Evidence and metrics

Every balance conclusion must use full evidence or explain why partial evidence remains useful.

Use surviving units as an initial balance signal:

- A `1-0` result is close.
- A `2-0` result is acceptable.
- A `3-0` result is concerning.
- A `4-0` or `5-0` result is strong imbalance evidence.
- Reaching the 30-turn cap without a clear winner suggests balance, unless the board and HP totals show a decisive advantage or a stalled game.

These thresholds are early guidance. The loop may revise them as evidence improves. Record each revision before applying it to later experiments.

A representative strategy must show its stated plan in its unit composition, purchases, upgrades, and board decisions. Classify a run as partial or invalid when agent play obscures the strategy comparison.

## Completion criteria

- Several materially different pure and mixed strategies have valid, representative evidence.
- Pure and mixed unit compositions include credible choices.
- No build or composition is universally dominant under the current balance guidance.
- Promising results survive confirmation against relevant contrasting strategies.
- The final baseline and remaining uncertainties are recorded in `EXPERIMENTS.md`.

## Autonomy

- Run autonomously until the completion criteria are met.
- Make all experiment, implementation, tuning, and evidence decisions without routine user approval.
- Record every experiment and material change in `EXPERIMENTS.md`.
- Stop only when the goal is complete or a serious concern prevents trustworthy continuation.
- Serious concerns include invalid evidence that cannot be repaired, destructive work outside this repository, or required external authority.
