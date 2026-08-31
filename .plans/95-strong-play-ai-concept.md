# Strong-play AI: concept

Status: direction record. No implementation is committed yet. This document explains the concept
and the open decisions. A separate numbered plan will specify each stage before implementation.

## Goal

Build an AI opponent that is as hard as possible for a strong human to beat.

The constraints are different from the balancing AI:

- Strength matters. Speed and run-to-run consistency do not.
- The AI may spend seconds per decision. A human turn is slower than that.
- The fast deterministic pilot and the full balance pipeline stay unchanged. The strong player is a
  separate play-time policy. The two must never be mixed in one measurement.

## Why the current AI loses

Evidence: every finished expert game in `.data/games` is a human win. The traced game
`0f8ac405` shows the pattern. The AI held a melee Drive plan. The human built a
Repelling Shot kiting deck. The AI spent turns 18–30 walking while holding dead Drives, and its
ladder kept buying Drive anyway.

The causes are structural:

1. The buy policy is a fixed ordered ladder chosen before turn 1. It never reads the opponent's
   deck, the positions, or the health totals.
2. The action policy is a one-ply heuristic. The only measured stronger policy is the full-tree
   action search (0.537 against the pilot), and it looks only inside one turn.
3. The equilibrium was computed under that weak pilot. The stored plans are "unexploitable" only
   against opponents who pilot at pilot level and never adapt. A human does both better.

## The core idea

Replace fixed policies with search at play time. The simulator is fast enough to be the evaluator:
about 15,700 games/s in TypeScript, more in Rust. One second of thinking is thousands of complete
simulated games.

A **rollout** is one simulated continuation of the current game, played by cheap policies for both
sides, from the current state to the end. To choose an action, simulate each candidate action, then
many rollouts after it, and pick the candidate with the best mean result.

**MCTS** (Monte Carlo Tree Search) is the grown-up version: it builds a tree of moves, spends more
rollouts on branches that look good, and deepens the tree only where it matters. It is anytime —
stop at the time budget and play the most-visited move.

Hidden information is mild in this game. Deck compositions are public; only draw order and hands
are hidden. So rollouts sample a shuffle consistent with public information ("determinization").
This is the standard approach in card-game AI (PIMC / Information Set MCTS).

## Stage 1 — search-based tactical play

At each Action-phase decision: sample N consistent shuffles, roll each legal action forward with
the existing pilot as the rollout policy for both sides, over the current turn plus 2–3 future
turns, and pick the best mean outcome. The buy ladder stays as-is.

This fixes "walks into kiting range holding dead cards" with no new theory. If flat rollout search
plateaus, the same machinery becomes ISMCTS.

Measurement: head-to-head against the pilot with matched plans. Never prediction accuracy —
`.plans/29-action-policy-findings.md` records why (test AUC 0.92 played at 0.484).

## Stage 2 — adaptive buys by replanning

At each buy decision, do not follow one ladder. Evaluate several candidate continuation plans by
rollouts from the actual current state, and follow this turn's buy from the winner. Re-decide every
turn. Unexpected coin rolls (5/2 openings, windfall turns) need no special handling: the decision
always starts from the real state.

### The opponent model, precisely

A rollout must play both sides. So the simulated opponent needs two things:

1. **A hidden-state sample.** Shuffle order and hand, drawn consistent with public information.
   Cheap, because deck composition is public.
2. **A future policy.** What the simulated opponent buys and plays for the rest of the rollout.

Point 2 is the part that was unclear. Three levels, weakest to strongest:

- **Level 0 — frozen deck.** The simulated opponent buys nothing new and pilots its current deck.
  Wrong, but already carries most of the signal, because the opponent's current deck is public and
  is most of their future. "They have more movement than me" is visible today.
- **Level 1 — coherent continuations.** Give the simulated opponent a few plausible continuation
  plans drawn from the plan library (below), filtered to those compatible with what they actually
  bought so far. Average over them.
- **Level 2 — robust continuations.** Instead of averaging, test each of our candidates against
  the few *strongest* continuations of the opponent's visible deck, and prefer the candidate that
  holds up against all of them. This is a small best-response step, and it is the honest answer to
  "the human is not on any stored plan": we never claim to know their plan. We only require that
  our choice survives strong plausible futures of their *visible* deck.

Important property: every one of our candidates is evaluated against the *same* opponent model, so
model error mostly cancels in the comparison. The model needs to be plausible, not correct.

## Stage 3 — one unified search

Merge stages 1 and 2: one turn-level MCTS that searches actions and buys together, with
determinized shuffles and a level-1/2 opponent model inside the rollouts. Move rollouts onto the
Rust kernel when depth needs it.

### Why plans are still needed, and what they become

Greedy per-buy search with a weak rollout policy undervalues engines: a setup card pays off many
turns later, and raw playouts are too noisy to see it. The fix: when a rollout reaches a future buy
for either side, it follows a *coherent plan continuation* instead of improvising. The top-level
search then chooses **which coherent future to steer toward this turn**, and re-chooses every turn.
A plan stops being a commitment and becomes a rollout prior.

Branching is not the problem: 10–15 buy options per decision, and multi-buy turns are sequential
single decisions. Horizon is the problem, and plan-shaped rollouts are the cheap answer.

### The plan library, and the coverage concern

The concern: the final Matrix has ~54 plans per kingdom (measured on the catalog: average 54.1,
range 50–171) but on average only 2.69 carry equilibrium weight (range 1–10). Most unweighted
entries are early seeds. If a kingdom's equilibrium is 100% melee, and the human's ranged counter
is far from every stored plan, plan-guided search could never steer there.

The concern is valid against the *catalog*, and the answer is to not use the catalog as the
library:

1. **The library is the goldfish reservoir, not the final Matrix.** Every suite kingdom kept
   `goldfish/reservoir.hgf` — about 20,000 diverse ordered plans — plus `top-500000.hgf`, and both
   are regenerable deterministically. Take the library as the top-k reservoir plans *per damage
   family* (Melee, Ranged, Mage, mixed, via `classifyStrategyDamage`), a few hundred plans with
   guaranteed family coverage. A ranged library entry exists even where PSRO gave Ranged zero
   weight.
2. **Play-time search revalues the library under the strong policy.** Goldfish and PSRO scored
   plans under the weak pilot. The library only needs *coverage*; the value of each continuation is
   measured fresh, in rollouts piloted by the stage-1 policy, from the actual game state. A ranged
   plan that was mediocre under the weak pilot can win those rollouts.
3. **Replanning conditions on the current deck.** We never need a library plan close to the
   human's whole strategy. We need a decent continuation *from wherever our deck is now*, each
   turn. Continuation coverage is a much weaker requirement than whole-plan coverage.
4. **Escape hatch.** The unified search may deviate from every library plan for the current buy
   when rollouts show a clear win. The library guides; it does not bound.

Residual risk, stated honestly: goldfish ranking is also pilot-based, so a plan that is only good
under clever piloting can rank low even inside its family. Family-stratified selection reduces
this. If it still bites, re-rank the reservoir with the strong policy for the browser kingdoms —
expensive, but this AI is allowed to be expensive.

## Measurement ladder

Every stage must win head-to-head before it ships:

1. New policy vs current expert AI, matched kingdoms, both seats.
2. New policy vs the human benchmark decks: extract the acquisition sequences from the saved won
   games in `.data/games` as ordered plans, and require strong results against them.
3. Ryan plays it. "Repeatable strength" is the standard: it stays hard on the next attempt too.

## Out of scope for now

Stage 4 — a self-play policy/value network guiding the search (AlphaZero-style on determinized
states). Revisit only if stages 1–3 are still beatable. If revisited, train on search-improved
targets and gate head-to-head; never accept prediction accuracy as evidence.
