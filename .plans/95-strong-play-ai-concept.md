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

### Why action policy alone has headroom

The plans are adapted to the pilot, but the pilot was never optimized for the plans — it is a
fixed heuristic. So "the pilot is as good as it gets for these plans" does not follow, and it is
measured false: intra-turn full-tree search scored 0.537 against the pilot with matched plans
(old 40-health rules; the measuring script was deleted in the legacy cleanup). Mirror headroom is
modest because most decisions are small. The headroom against humans is larger, because human wins
exploit multi-turn positioning (kiting, hit-and-run) that intra-turn search never sees.

Before building stage 1, run the two-part headroom analysis:

1. Re-measure intra-turn search vs the pilot under current 50-health rules, matched plans, both
   seats, across kingdoms. This refreshes the stale 0.537 number.
2. Disagreement mining: sample decision points from the saved human games and from self-play, run
   a 2–3-turn lookahead rollout search, and count where its choice differs from the pilot's
   (movement, targeting, Cull, end-phase). This locates the multi-turn gains stage 1 must capture.

## Stage 2 — adaptive buys by replanning

At each buy decision, do not follow one ladder. Evaluate several candidate continuation plans by
rollouts from the actual current state, and follow this turn's buy from the winner. Re-decide every
turn. Unexpected coin rolls (5/2 openings, windfall turns) need no special handling: the decision
always starts from the real state.

### What replanning changes in practice

Each player still follows an ordered buy plan at every moment; plan structure does not change. The
AI's plan just stops being fixed at game start. At the start of each of its buy phases it asks:
given the cards I actually own and the state right now, which library plan is best to be on from
here? Compatible means the plan's early slots are consistent with the AI's acquisitions so far.
Usually the answer is the same plan as last turn, and behavior matches today's. When the answer
changes — the opponent's kiting deck appeared, so melee continuations now lose rollouts — the AI
swaps to following a different whole coherent plan. Swapping between plans, never editing one.

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

### The online matrix step

"Their strongest continuation depends on ours, and ours on theirs" is a real regress. The escape
is the same tool the offline pipeline uses: a payoff matrix, built online from the live state.

Take our ~15 compatible continuations and their ~30 plausible continuations. Simulate every
pairing from the current state. Each cell is well-defined with no regress, because inside a cell
both sides follow fixed plans plus a fixed action policy. Then choose our row by one of:

- **Weighted average** over their rows, weighted by plausibility (equilibrium prior × match with
  their observed buys). Simple; can overfit to weak opponent rows.
- **Maximin** over their strongest rows: keep the candidate that holds up against all of them.
- **Subgame Nash**: solve the small matrix and play our side of the equilibrium.

Maximin or Nash is why no future information is needed: we never predict their actual plan, we
choose the continuation that survives the plausible set. This is the PSRO Matrix step run once per
turn from the live state — online double oracle, receding-horizon planning. It also matches how
strong turn-level rollout agents work in comparable games (for example Tales of Tribute). MCTS is
the deeper version of the same thing; depth one is correct for stage 2.

Two practical rules. Humans never exactly prefix-match an ordered plan, so opponent compatibility
needs a tolerance — match the acquisition multiset with small allowed mismatch, or match on family
and package instead of exact cards. And their frozen current deck (level 0) is always one of their
rows, because it is the one continuation guaranteed to be real.

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
