# Action-policy investigation: findings and rejected approaches

A record, not a plan. It exists so the next attempt does not repeat two that were measured and
rejected. All numbers were produced on an Apple M4 Pro, Node.js v22.23.1.

Labels: **FACT** is readable in the repository. **MEASURED** has a number and a command.
**HYPOTHESIS** is untested.

## Two rejected approaches

Neither is on `main`. Both live on branches off `0457bcb`.

### v5 purchase-safety gate — `bb/improve-shared-tactical-pilot-thr_85a5qpwnhr`

Made Cull refuse any option that dropped permanent money below the agenda's floor.

**MEASURED** Old Cull-heavy plans scored 22.1% under v5 against the same plans under v4. Complete v5
scored 42.7% against complete v4 over 40 comparable non-Flurry kingdoms.

The lesson is not that the floor was miscalculated. **A policy preference must not become a legality
rule.** A gate removes the branch from consideration, so no amount of evidence can recover it.

### Bounded DP with a fitted value function — `bb/design-bounded-tactical-optimizer-thr_ahndapae3m`

A layered dynamic program over the Action phase, scoring frontier states with a logistic model
fitted on real match outcomes.

**MEASURED** The value function predicts well: test AUC **0.9199**, **0.9163** on held-out kingdoms,
from 120,000 matches and ~2.0M snapshots. **MEASURED** It plays worse: **0.4837** [0.4799, 0.4877]
against the pilot over 48,000 matches in all four orientations. Policy iteration plateaued near 0.47
and round 2 was worse than round 1.

Three things worth carrying forward:

1. **A good predictor is not a good controller.** AUC measures ranking of positions, not quality of
   decisions. Validate a policy change head to head from the start; do not infer play strength from
   prediction accuracy.
2. **Observational weights used causally invert.** Raw range `distance` fitted at **+0.0995** because
   ranged decks win, not because retreating helps. Optimizing it directly sent both sides running
   away and produced **7.0%** turn-limit draws. Stranded cards fit **+0.66** even after controlling
   for hand size, because stranding predicts holding a big engine hand.
3. **Some features cannot be fitted at all.** `unplayedHandDamage` had *zero variance* under the
   pilot, which always plays the damage it can, so the regression never saw it. A feature the
   incumbent policy never varies cannot be learned from the incumbent's games.

## Measured properties of the simulator

- **MEASURED** Fixed-kernel baseline: **15,701.5 games/s** median over 75,000 matches
  (`scripts/measure_search.ts --pilot kernel --repeats 30`). Mean match 0.064 ms, 76.37 Action
  decisions per match, so **~822 ns of total match time per decision**.
- **MEASURED** `pilotView` costs **285 ns per call**, measured as the slope of running it 1, 2 and 4
  extra times per decision. That is **34.7% of the entire per-decision budget**, spent building a
  boxed view rather than deciding. **FACT** it allocates a `PilotCard[]`, an object per hand card, a
  `movements` array per card, and a Copper filter over four zones, on every decision.
- **MEASURED** Real decisions are small: 3.06 decisions per player-turn, mean hand 3.95, mean
  playable cards 2.13, mean branch factor 4.13. Resource dimensions are rarely live together —
  position 57.7%, opponent position 9.3%, mana 8.4%, flurry count 2.0%, aimed 0.5%.
- **MEASURED** The full-tree Action-phase search in `src/sim/search.ts` scores **0.5372** against the
  pilot over 6,400 matches with no overflows, in 25 s. It is slow, but it is the only policy measured
  to beat the pilot.

## Findings from real games

Saved games live in `.data/games`. `scripts/trace_game.ts` prints a readable transcript.

- **FACT** `gameService` plays the AI with `tacticalAgent`, the shared pilot. `aiDifficulty` only
  changes *which strategy is sampled* from the equilibrium; `expert` takes a weighted draw from the
  support. It does not change how well the AI plays.
- **FACT** Before `0457bcb` the browser used `strategyAgent` instead. Games saved earlier than that
  commit were played by a **different policy than the one that discovered their strategy**. Check the
  timestamp before drawing conclusions from an old game.
  **MEASURED** The same strategy that lost badly under that mismatch reached a perfect 4-card engine
  and lost by 1 hp once played by its matching policy.
- **FACT** Cull targets are restricted to Coppers and Cull itself, in both `tacticalAgent.ts` and the
  `allowedActions` filter in `search.ts`. The engine allows trashing **any** one or two cards from
  hand. So no policy in the repository can trash a Silver or a dead Action card, and any strategy
  whose value depends on doing so cannot be executed or valued in simulation.
- **FACT** `ALWAYS_AVAILABLE_ACTION_IDS` puts `step`, `cull` and `focus` in **every** kingdom at 10
  copies each. Cull costs 3, trashes up to 2 cards per play including itself, and nothing penalises a
  small deck — no floor, no reshuffle cost. Hand size is 5, so any deck of 5 or fewer cards draws
  itself completely every turn.
  **MEASURED** Both sides routinely finish with 3–4 card decks. In one game the AI ended on 3 cards
  having bought exactly **one** card in 15 turns.

## The open problem

**MEASURED** PSRO put **100% weight**, out of 37 evaluated strategies, on a deck holding both
`steadyShot` (requires not Close) and `heavyBlow` (requires Close). One of its two attacks is dead
every turn wherever it stands: 4 damage a turn against 8 for a coherent alternative that is two cards
away in the same 10-card kingdom.

The composition clearly matters, so this is not a case of the buy agenda being irrelevant. Either
that alternative was never generated as a candidate, or it was generated and scored wrong. Those
have different fixes — candidate generation and admission thresholds, versus evaluation noise and
seed counts — and `scripts/compare_strategies.ts` separates them: any strategy that beats a
full-weight equilibrium strategy head to head disproves the equilibrium.

**HYPOTHESIS, and the reason to be careful:** strategy discovery is currently judged only by the
payoff matrix it produces, which is circular. Every real signal in this investigation came from a
human playing a game. A ground truth that does not depend on PSRO — an exhaustive sweep over
coherent damage packages in a 10-card kingdom is cheap — would make the question decidable without a
human in the loop.
