# Strategy search process

This is the working process for finding one representative competitive strategy lottery for each kingdom. It records the current decisions and the decisions that still need evidence.

## Goal

For each kingdom:

1. Generate the complete deterministic strategy grammar.
2. Reduce it to a practical competitive reservoir.
3. Find a lottery that has no material known response in that reservoir.
4. Report cards acquired, damage archetypes, and strategy shares from actual games.
5. Produce similar results when the process uses new shuffle seeds.

The eventual runtime target is about 20 minutes per kingdom: about 10 minutes for goldfish work and 10 minutes for competitive search. Reaching that target will probably require a Rust competitive simulator and Modal parallelism. It is an optimization target, not a requirement for calibration or process acceptance. Local calibration can take longer. An authorized overnight loop can start this optimization only after the evidence rules and competitive process are stable.

## Necessary pipeline

### 1. Generate every strategy

Generate all 12,972,960 legal strategies in a fixed order. The same rules, kingdom, and code must produce the same candidates.

### 2. Build the goldfish reservoir

For the current calibration runs:

1. Score all 12,972,960 strategies with one goldfish seed.
2. Keep the best 500,000.
3. Score those 500,000 with three more seeds.
4. Keep the best 20,000 as the competitive reservoir.

The 500,000, four-seed, and 20,000 limits are temporary engineering choices. Do not increase retention during this calibration.

### 3. Build the initial restricted game

Start with the top 50 reservoir strategies. Play every strategy pair and solve the resulting two-player zero-sum matrix for a lottery.

The required number of shuffle seeds per matrix pair is not decided.

### 4. Find responses to the lottery

Use a response-search method to find reservoir strategies that can materially beat the current lottery. Use fresh games before making an admission decision.

For each admitted strategy:

1. Add the missing pairings between that strategy and the existing matrix.
2. Solve the expanded matrix.
3. Continue response search against the new lottery.

The exact response-search algorithm is not decided. Do not assume that every cycle must rescreen all remaining 20,000 strategies. Do not assume that every apparent counter should enter one large batch.

### 5. Establish closure

Stop only when the chosen response-search method finds no material response with enough evidence and the matrix payoffs are precise enough for the required balance report.

The closure rule is not decided.

### 6. Report the lottery

Use actual game acquisitions to report:

- selected strategy weights;
- Melee, Ranged, Mage, and mixed shares;
- action-card acquisition shares;
- expected copies of each card per player-game.

Use the selected deterministic equilibrium for headline results. Use feasible equilibrium ranges only as diagnostics.

## Success priorities

The pipeline has two priorities, in this order:

1. **Trustworthy results:** independent runs must produce consistent card-acquisition, card-use, and strategy-archetype distributions. The results must be consistent enough to support card-balance decisions.
2. **Minimum work:** after the process meets the consistency requirement, reduce the number of simulated games and the runtime as far as possible without weakening that consistency.

A faster process is not useful when its balance report changes materially between runs.

## Settled decisions

- The candidate grammar contains 12,972,960 strategies in deterministic order.
- The current goldfish calibration keeps 500,000 strategies after one seed and 20,000 after four seeds.
- The initial restricted game starts with 50 strategies.
- One shuffle seed means two games: strategy A goes first once and strategy B goes first once.
- Each strategy keeps the same seat and starting side in both games.
- Reflection-symmetric movement removes the need for separate left-side and right-side games.
- Strategy equivalence must use executed behavior and actual acquisitions, not only strategy IDs or purchase-plan text.
- Fresh progressive confirmation remains available. It is not the main measured runtime cost.
- The selected deterministic equilibrium supplies the headline report.

## Decisions required before competitive calibration

### 1. Choose the PSRO or Double Oracle structure

Review established methods before choosing the response loop. Compare:

- standard Double Oracle or PSRO, which normally adds a best response and resolves the restricted game;
- parallel or pipelined response oracles;
- adaptive candidate racing instead of fixed full-reservoir screens;
- controlled multi-response batches;
- population management or pruning, only if matrix growth requires it.

The method must fit a fixed reservoir of 20,000 deterministic strategies with simulation-based payoffs. The literature baseline is standard two-player zero-sum Double Oracle: add one best response, calculate only its missing matrix row and column, and solve again. Large response batches are a variant that must earn their added matrix cost. Training-focused PSRO variants are not a direct fit because these 20,000 strategies already exist.

Primary references: [Double Oracle](http://www.cs.cmu.edu/~ggordon/mcmahan-ggordon-blum.icml2003.pdf) and [PSRO](https://mlanctot.info/files/papers/nips17-psro.pdf).

### 2. Choose matrix seeds per pair

Generate one larger nested payoff sample and compare smaller prefixes. Choose the first seed count where more seeds do not materially change:

- direct lottery strength;
- selected responses;
- actual acquisitions;
- archetype shares.

The first calibration compared 5 to 25 training seeds with 25 held-out seeds. A second calibration compared 25 and 50 training seeds with fresh held-out seeds. Protocol v2 measures lottery-versus-itself acquisitions on shared held-out seeds, including self-play. Its 50-versus-75 comparison was not stable. Its 75-versus-100 comparison was stable enough to use 75 as the provisional depth: the largest remaining direct-strength shift was 0.0035 percentage points, and the largest expected-card shift was 0.037 copies per player-game. K008 still changed restricted best-response score by 0.23 percentage points and changed best-response identity. These tests measure stability inside the initial 50 strategies, not responses from the full reservoir.

### 3. Choose how to search the reservoir

Decide whether candidate evaluation uses a fixed screen, adaptive racing, or another established response oracle. Measure response quality, game count, and sensitivity to shuffle seeds.

The two 100-seed reference folds removed fixed 16, fixed 25, and fixed 50 from the pooled joint frontier because Successive Halving was cheaper with no worse raw top-one or top-four regret. Fixed 8, Successive Halving, and fixed 32 remain. The selected reference leader still changed in every kingdom, and the K007 and K008 top-score tie sets were disjoint between folds.

An exploratory single-admission Successive Halving loop tested the cycle-count risk. K001 and K007 each admitted two responses and stopped on cycle 3 with a 52-strategy matrix. K008 admitted none and stopped on cycle 1 with its original 50-strategy matrix. The three runs added 2,404,186 games and about 161 seconds of measured simulation time. No run approached the 100-cycle cap. This is cycle-count evidence, not formal closure or independent-seed consistency evidence.

### 4. Choose admission and population rules

Decide:

- what evidence makes a candidate a response;
- whether to add one response or a controlled batch;
- whether strategies always remain in the matrix;
- whether any pruning rule is needed.

Do not add a strategy-distance or novelty rule. The deterministic grammar already supplies broad strategy forms.

### 5. Choose the closure rule

Define the evidence required to say that no material response remains. Also define the payoff precision required for stable acquisition and archetype reports.

### 6. Choose final reporting evidence

Choose the number of reporting seeds from measured stability in card acquisitions and archetype shares. Do not use a fixed panel count without evidence.

## Game-count formulas

Every shuffle seed costs two games.

Let:

- `M` be the current matrix size;
- `B` be the number of added strategies;
- `S` be matrix shuffle seeds per pair;
- `C` be candidates evaluated against a lottery;
- `Q` be shuffle seeds per candidate.

Then:

- Complete matrix: `2 × S × M × (M - 1) / 2` games.
- Add `B` strategies: `2 × S × (M × B + B × (B - 1) / 2)` new games.
- Candidate evaluation: `2 × Q × C` games.

Examples:

- Initial 50-strategy matrix at 25 seeds: 61,250 games.
- One 100-game evaluation of 19,950 candidates: 1,995,000 games.
- Complete 550-strategy matrix at 25 seeds: 7,548,750 games.
- Extending a 50-strategy matrix to 550 at 25 seeds: 7,487,500 new games.

Solving the zero-sum matrix adds computation but no simulation games. Generating the pairwise payoffs is the main matrix cost. The current maximum-support solver also runs one value solve plus one witness solve per strategy, so large matrices require a separate solver benchmark.

## Later checks, not current requirements

Do not add these until the core response process is credible:

- increasing matrix depth after a clean response search;
- matrix pruning or reactivation rules;
- fixed multi-panel reporting schedules;
- attacks from old historical reservoirs;
- two complete independent production runs;
- large final cross-play schedules;
- porting competitive simulation to Rust or distributing it through Modal.

## Current order of work

1. Repeat the single-admission loop with independent seeds to measure cycle-count and final-lottery consistency.
2. Set the material response-quality tolerance and formal closure evidence.
3. Select the simplest process that meets the consistency goal, then optimize its runtime.
