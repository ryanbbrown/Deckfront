# Response optimizer pilot

## Goal

Compare four established best-response generators against one frozen Hexdeck equilibrium under the same simulation budget. The pilot must show which generator finds the strongest held-out response without changing the target lottery during the comparison.

## Scope

Use `deep-beam-tuning-001` and its current saved target mixture. This kingdom is the fastest useful test because the current matrix omits a known Mage response that independently scored 88.8%.

Implement and compare:

1. The current stratified beam generator.
2. Uniform random complete-policy search with racing.
3. A discrete cross-entropy method that samples complete grammar-valid policies and updates a dependency-aware distribution from elites.
4. UCT-style Monte Carlo tree search over a canonical append-only policy grammar, with complete rollouts for terminal reward.

Keep PSRO and equilibrium calculation unchanged. This pilot compares response oracles against one frozen lottery; it does not add their responses or recompute the lottery.

## Decisions

### Common policy domain

- Draft is off, so `startingBuild` is empty.
- Use at most eight active purchase slots.
- A complete policy has zero to seven finite purchase or stop-prefix slots followed by one terminal floor: an infinite purchase or no-buy.
- Use the same legal cards, finite counts, stop thresholds, repair, and canonical identity as the current beam experiment.
- Construction must be canonical so one policy does not appear through several tree paths.

### Fair budget

- Introduce one shared objective/evaluator that counts candidate seed-block evaluations and actual matches.
- Give every optimizer the same training seed-block budget. An optimizer must not silently exceed it; it may stop before a batch that does not fit.
- Use common random numbers where practical, but keep each optimizer’s search state independent.
- Exclude final held-out confirmation from the training budget and give every optimizer the same untouched confirmation seeds.
- Record best-so-far response quality against cumulative training matches.

The initial single-kingdom run may use one restart per optimizer and a budget near the known full-width Mage beam cost, provided all four receive the exact same budget. The CLI must expose the budget and optimizer seed so later repeated trials need no code changes.

### Cross-entropy method

- Sample complete policies, not partial policies.
- Model policy length, terminal floor, and ordered prefix tokens.
- Preserve dependencies between adjacent or earlier tokens; do not use only independent per-slot frequencies.
- Update from an elite fraction with smoothing and a nonzero exploration floor to prevent immediate family collapse.

### MCTS

- Use a canonical append-only grammar with an explicit completion action or predetermined length.
- Use UCT for tree selection and complete grammar-valid rollouts for evaluation.
- Batch simulation work where possible so process overhead does not dominate.
- Report visits and best complete policy; do not claim a finite-budget optimality guarantee.

### Output

Write one ignored JSON artifact containing:

- frozen kingdom and target-mixture identity;
- exact optimizer configuration and random seeds;
- training blocks and matches consumed;
- runtime;
- best policy;
- best-so-far training curve;
- held-out mean score, match count, and 95% interval.

Print a compact comparison table. Use held-out score as the primary result. A practical exploit is a point score above 52%; statistical success requires the held-out 95% lower bound to exceed 50%.

## Acceptance checks

- All four optimizers use the same frozen target mixture, policy grammar, training budget, and held-out seeds.
- Budget accounting is tested and no optimizer exceeds the configured training budget.
- Every returned policy is legal, canonical, and executable under draft-off rules.
- CEM samples and updates complete ordered policies with dependency information.
- MCTS evaluates complete rollouts rather than scoring incomplete prefixes as final policies.
- The CLI can reproduce a one-kingdom comparison from explicit seed and budget arguments.
- The pilot completes on kingdom 001 and produces held-out results for all four optimizers.
- Generated experiment results remain ignored and uncommitted.

## Validation

- Focused tests for grammar construction, budget accounting, CEM updating, MCTS completion, deterministic seeded behavior, and output schema.
- Existing simulation and beam tests.
- Full test suite.
- `npm run typecheck`.
- `npm run lint`.
- `git diff --check`.

## Review

- Plan review cycles: 0.
- Implementation review cycles: 1.
- Record the clean pre-implementation SHA after committing this plan.
- Review the implementation against that SHA, resolve required findings with the same writer, and rerun validation.
