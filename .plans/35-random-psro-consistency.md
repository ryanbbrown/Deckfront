# Random PSRO consistency experiment

## Intent

Replace beam proposals for this experiment with broad uniform random complete purchase policies. Keep the current draft-off, 50-health rules, payoff matrix, equilibrium solver, mixture evaluation, and PSRO evidence hygiene. Do not add behavior vectors, fingerprints, or QD search.

## Implementation

- Add a `ResponsePolicyDomain` option for stopless policies with no no-buy floor. Random policies have 1–8 active purchase slots, finite purchase rungs only, and one mandatory infinite-card fallback.
- In each oracle round, sample at least 20,000 unique complete policies with a fresh proposal seed. Race them on disjoint 1/2/4/8-block evidence, then evaluate up to eight finalists on a fresh held-out schedule. Admit only the best finalist whose 95% bootstrap CI lower bound is above 0.50.
- Add one confirmed response, refill the payoff matrix, solve the new equilibrium, and start a fresh batch against the new lottery. Converge only after two consecutive batches have no confirmed response. A configurable round cap writes an `incomplete` result and never reports success.
- After convergence, run a fresh independent random attack. Its empirical gate is no confirmed challenger with a 95% CI lower bound above 0.55.
- Store one atomic JSON artifact per kingdom and seed under a rules-fingerprint directory. Validate the kingdom, rules, configuration, matrix, equilibrium, seed separation, and terminal state before reuse.
- Provide one-kingdom, deterministic 10-kingdom × 2-seed, status, and concise report commands. The suite keeps valid completed units when another unit fails or is interrupted.
- For Kingdom 001, require the exact Mage-heavy ordinary artifact and the Melee-heavy stratified artifact. Pool both positive supports, then use fresh held-out schedules for old-support attacks, new-support attacks on each old lottery, and lottery cross-play. Reject an absent or mismatched Mage-heavy source.

## Exact experiment gates

- Rules: `deep-beam-tuning-001` through `deep-beam-tuning-010`, 50 health, current rules fingerprint, starting draft off, and at most 8 active slots.
- Full oracle batch: at least 20,000 unique random proposals; successive racing uses disjoint evidence; finalist confirmation uses held-out evidence; admission requires CI lower bound `> 0.50`.
- Convergence: two consecutive clean random batches. Reaching the safety cap is incomplete.
- Consistency: run each deterministic kingdom with two independent configured seeds.
- Report, per kingdom: run-vs-run lottery cross-play; worst confirmed support from each run against the other lottery; selected archetype shares and feasible equilibrium ranges; exact canonical support overlap; strategy/card summaries; convergence/completion; and independent random attacks.
- Empirical validation: old support versus the new lottery has no CI lower bound `> 0.50`; cross-run lottery score is within `0.47–0.53`; cross-run support has no CI lower bound `> 0.50`; independent attack has no CI lower bound `> 0.55`.
- Verification: focused tests for grammar, seed separation, convergence, resumability and validation, cross-play/report math, and source rejection; then full tests, typecheck, lint, and a final diff/status check.

Generated experiment artifacts stay uncommitted. The full 20-unit suite is not part of implementation verification.
