# Step 6: evolution, retained leaders, and tournaments

Implements step 6 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on steps 4 and 5.

## Objective

A population of strategies evolves through repeated competition against leaders, several leaders survive each generation, earlier leaders are retained, and a final round-robin tournament reports the complete matchup table.

## Strategy identity

`Strategy.id` is a hash of the **canonical form**: every behavioural field, object keys sorted, `id` itself excluded.

This is load-bearing in three places. Exact duplicates collapse naturally, so leader selection's dedup step is not dead code. A mutant cannot inherit its parent's id and collide in the score map. And a leader retained unchanged across several generations enters the round robin once, not several times under different ids with `wins[a][a]` self-pairs.

## One generation

1. Test every candidate against every leader over the shared seeds. The current leaders are themselves candidates, so a leader is re-scored rather than replaced wholesale by mutants. A strategy never plays itself; that pair is skipped.
2. Swap first player and `swapSides` for each pairing. Each pairing therefore plays four games for each shared seed: two first-player orders times two arena sides.

   The orientations are enumerated `(firstOchre, normal), (firstOchre, swapped), (firstIndigo, normal), (firstIndigo, swapped)`, and the candidate takes **`ochre` in orientations 1 and 4, `indigo` in 2 and 3**.

   There are three binary factors to balance — seat, who moves first, and **arena position** — so four games need a half-fraction, not the obvious assignment. `createGame` puts ochre at position 2 and indigo at 3, exchanging them when `swapSides` is true (`src/game/state.ts:20-21`), and those positions are not equivalent: the fighter at 2 has one space of retreat behind it and the fighter at 3 has two. Assigning the candidate `ochre` in 1 and 3 leaves it at **position 2 in all four games**, so `swapSides` cancels nothing for the candidate — the exact defect `swapSides` was added to fix. The assignment above gives seat 2/2, moves-first 2/2, and position 2/2.

   This is load-bearing for leader selection, not cosmetic. A leader plays both sides across its pairings, but a non-leader candidate only ever plays the candidate side, so a uniform candidate-side advantage would bias selection toward mutants over their parents.
3. Score a win as 1, a draw as 0.5, and a loss as 0.
4. **Aborted games are excluded from both the numerator and the denominator**, and ranking is by **mean score per completed game**. Ranking by total silently penalises overflow-prone candidates, which are exactly the strategies with the deepest search trees. `overflowCount` is the number of aborted games in the generation. A candidate with no completed games ranks last and is recorded, not dropped.
5. Keep several strong, meaningfully different candidates as the next leaders.
6. Create the next population by mutating those leaders.

Generation 1 has no previous leaders. Seed it with the five fixed baselines from step 4 as the first leader set — **all five, regardless of the `leaders` limit**, which governs generation 2 onward. Record this, because `matchCount` and every generation-1 score depend on it.

## Leader selection

Deterministic, as the design document requires:

1. Sort by **one comparator**: score descending, then the stable hash of the canonical form ascending, then the canonical string itself so a hash collision is still deterministic.
2. Drop exact duplicates by canonical form.
3. Take the top `leaders`.

The order matters. Truncating before applying the tiebreak would truncate against an under-determined order, so the hash could never decide and check 3 could not pass.

Do not add a diversity or distance metric. The first run does not have enough data to define one, and an arbitrary threshold would hide real results.

"Meaningfully different" is satisfied by dropping exact duplicates only. Record this reading in `PROGRESS.md`, because the design document uses both phrasings and explicitly forbids a distance metric.

## Mutation

Mutations may change the starting build, agenda cards and order, desired counts, preferred range, state-scoring weights, and trash, reclaim, and discard priorities. Some mutations change one field; some change a related package, for example a preferred range together with the attacks in the agenda.

Independent mutations must stay possible, so the search can find mixed decks and strategic pivots. Do not restrict a mutation to one card family.

**Bounds.** Every mutation produces a valid strategy:

- weights stay finite and clamp to `[-100, 100]`. An unbounded chain can reach `Infinity` or `NaN`, and a `NaN` weight makes the score comparator non-transitive, silently corrupting both the action search and the ranking;
- `desiredCount` is an integer in `[0, 10]`;
- `preferredRange` is one of `Close`, `Near`, `Far`;
- cards are drawn from `kingdomMarket(kingdomId)` only, never from all of `CARDS`. Otherwise agendas fill with entries step 4 silently skips and builds fill with cards the repair silently drops, spending population diversity on dead fields.

**Budget validity is the only hard coherence constraint**, and it uses the **same repair rule as step 4**: drop cards the market does not offer, then repeatedly drop the most expensive card — ties broken by definition id ascending — until the resolved cost is at most 12. Cost resolves through the kingdom, because `rigged-melee` re-prices Heavy Blow.

One shared rule matters: with two different rules, a mutated build is repaired one way at mutation time and another at match time, so the strategy recorded in `strategies.json` is not the one that played. Repair is repeated until the build fits, not a single drop.

Mutation uses a seeded generator derived from the run seed, the generation number, and the candidate index, so every child gets a distinct stream and a run replays exactly.

## Seeding the first population

Derive the seeded shapes from `src/sim/baselines.ts` rather than restating them. Seeding is kingdom-aware: repair each seed against the kingdom market before it enters the population. Without this, the mage seed in `current-duel` repairs to an empty build with a fully skipped agenda, and a fifth of the population starts degenerate.

Fill the rest of the population with mutations of those seeds. Seeded pairs must not be required to use one card family.

## Retained leaders and the final tournament

Retain the **best leader of each generation**, not the whole leader set. The final round robin runs between the current leaders, the retained per-generation leaders, and the fixed baselines, deduped by canonical form, and reports the complete pairwise table.

The cap is forced by arithmetic, not by measurement. Retaining all leaders gives 5 × 32 = 160 retained plus 5 current plus baselines ≈ 165 entrants, so 13,530 pairs × 25 seeds × 4 games ≈ **1.35M matches** against ≈1.6M for all 32 generations — the tournament would nearly double the run. Retaining one per generation gives ≈42 entrants → 861 pairs × 25 × 4 ≈ **86k matches**, about 5 percent of the evolution. Record the cap actually used.

Sizing formula:

```text
evolution  = candidates × leaders × sharedSeeds × 4 × generations
tournament = C(entrants, 2) × sharedSeeds × 4
total      = evolution + tournament
```

## Run limits

Measured, not assumed. `scripts/measure_search.ts` on `a6e5fd5` gives **11.3 matches per second** single-threaded over 375 baseline matches; `PROGRESS.md` records the full table.

The design document's full run does not fit. 100 × 5 × 25 × 4 × 32 = **1.6M** evolution matches plus ~86k tournament matches is **41 hours**, against a 240-minute deadline that affords about **163,000 matches** — roughly 10 percent. The parent plan allows lowering the full run after measuring throughput, so the full row below is the measured size. The design maxima stay as ceilings in step 7's option validation, so an explicit `--candidates 100` is still legal and the deadline remains the real guard.

| Mode | Candidates | Leaders | Generations | Shared seeds | Matches | Projected |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| smoke | 20 | 3 | 5 | 5 | 7,560 | ~11 min |
| full | 30 | 4 | 32 | 8 | 149,120 | ~220 min |
| design maximum | 100 | 5 | 32 | 25 | 1,690,000 | ~41 h |

Full: 30 × 4 × 8 × 4 = 3,840 per generation × 32 = 122,880 evolution, plus 41 entrants → 820 pairs × 8 × 4 = 26,240 tournament. That is 220 minutes against a 240-minute deadline, with the 20 percent tournament reserve step 7 sets aside covering the tournament term.

Width was cut in preference to depth. Generational depth is what the search exists to produce, and 8 shared seeds × 4 orientations still gives 32 games per pairing for noise control. Re-measure after step 8: if throughput improves, raise `candidates` first, because population width is what thinned most.

100 turns per player before a draw. Partial populations and results are preserved at every limit.

100 turns per player before a draw. Partial populations and results are preserved at every limit.

The shared seeds are **fixed for the whole run**, so scores stay comparable across generations. Re-deriving them per generation would remove that comparability, which the report depends on. The cost is a risk of overfitting the leaders to those 8 shuffles; recorded rather than traded away, and sharper now that the measured run uses 8 seeds rather than 25.

## Interface

```ts
export interface ScoredStrategy {
  strategy: Strategy;
  score: number;           // mean score per completed game
  completedGames: number;
  abortedGames: number;
}

export interface PairRecord {
  played: number; wins: number; draws: number; losses: number; aborted: number;
}

// Aggregated across matches, keeping the orientation split report item 8 needs.
export interface TelemetryAggregate {
  acquisitionsByStrategy: Record<string, Record<string, number>>;
  damageByCard: Record<string, number>;
  playsByCard: Record<string, number>;
  deadDraws: { range: number; mana: number; setup: number; total: number };
  turnsToWin: { total: number; count: number };
  byOrientation: Record<'firstOchre' | 'firstIndigo', Record<'normal' | 'swapped', PairRecord>>;
}

export interface EvolutionConfig {
  kingdomId: string;
  seed: number;
  candidates: number;
  leaders: number;
  generations: number;
  sharedSeeds: number;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  deadline?: number | undefined;      // epoch milliseconds
  now?: (() => number) | undefined;   // injectable clock, for tests
}

export interface GenerationResult {
  generation: number;
  partial: boolean;
  leaders: ScoredStrategy[];
  scores: Record<string, number>;
  matchCount: number;
  overflowCount: number;
  elapsedMs: number;
  telemetry: TelemetryAggregate;
}

export interface TournamentConfig {
  kingdomId: string; seed: number; sharedSeeds: number;
  turnLimitPerPlayer: number; actionCapPerTurn: number;
  // Required. `entrants` also holds retained leaders from every generation and the baselines, so the
  // final leaders cannot be recovered from it, and step 5's calibration input is defined over them.
  finalLeaderIds: readonly string[];
  deadline?: number | undefined; now?: (() => number) | undefined;
}

export interface TournamentResult {
  entrants: Strategy[];
  pairs: Record<string, Record<string, PairRecord>>;
  ranking: ScoredStrategy[];
  telemetry: TelemetryAggregate;
  calibration: CalibrationInput;   // built here, consumed by step 5's checkRiggedMelee
}

export function evolve(config: EvolutionConfig, onGeneration: (r: GenerationResult) => void): GenerationResult[];
export function roundRobin(entrants: Strategy[], config: TournamentConfig): TournamentResult;
```

`calibration.finalLeaders` lists exactly the `finalLeaderIds` strategies, in tournament rank order, with `rank` 1..n. The field is required rather than optional because the alternative — inferring the final leaders from the entrant list — is a silent guess that would produce a wrong calibration result rather than an error, and the caller always knows them.

`PairRecord` carries `played` and `draws` so step 7 can render a win **rate**, not a bare count. Aggregated telemetry is on both result types because step 5's gate and six of step 7's nine report sections need it, and a summed score cannot recover the orientation split.

`onGeneration` fires after every generation so step 7 can write partial output before a limit or deadline ends the run.

**Deadline.** Checked **between pairings**, not only between generations. A full generation can be ~50,000 matches, so a generation-boundary check could overshoot the 45-minute reserve in `GOAL.md` by hours. A generation cut short is still reported through `onGeneration` with `partial: true`, keeping the matches it finished. `roundRobin` takes the deadline too, so a run that stops cleanly does not then enter an unbounded tournament.

**Determinism is claimed for deadline-free runs only.** Stated explicitly, because a wall-clock deadline and exact reproducibility cannot both hold. Tests inject `now()`.

Per-match seeds derive deterministically from the run seed, the seed index, and the orientation — **and from nothing else**.

The generation and the pairing index must not enter the derivation. If they did, no two pairings and no two generations would play the same shuffles, so the seeds would not be shared and the cross-generation score comparability the report depends on would be gone. Holding the shuffles fixed across every pairing and generation is the point: it is common random numbers, and it is what makes a generation-5 score comparable with a generation-1 score.

## Files expected to change

| File | Change |
| --- | --- |
| `src/sim/types.ts` | The three result interfaces and `ScoredStrategy`. |
| `src/sim/evolution.ts` | New. Generations, scoring, leader selection. |
| `src/sim/mutation.ts` | New. Mutation operators, bounds, and the shared budget repair. |
| `src/sim/tournament.ts` | New. Round robin, the pairwise table, and the calibration input. |
| `src/sim/seedPopulation.ts` | New. Kingdom-aware seeds derived from `baselines.ts`. |
| `test/sim/evolution.test.ts` | New. |
| `test/sim/mutation.test.ts` | New. |
| `test/sim/tournament.test.ts` | New. |
| `PROGRESS.md` | The "meaningfully different" reading, the actual limits, and the retained cap. |

## Checks

1. A pairing plays four games for each shared seed, covering both first-player orders and both arena sides, and the candidate takes each seat twice.
2. Scores are 1, 0.5, and 0. For every pair, `wins[a][b] + wins[b][a] + draws === played`, there is no `wins[a][a]` entry, and entrants are unique.
3. An aborted game increments `overflowCount`, contributes to neither side's score nor to `played`, and leaves the ranking comparable. A candidate with no completed games ranks last.
4. Leader selection is deterministic: equal scores are broken by the stable hash, not by list order, and the tiebreak decides **before** truncation.
5. Two strategies identical except `id` collapse to one leader. Two differing only in `buyAgenda` order do not.
6. A build 30 money over budget repairs to at most 12 in **one call**, not one drop, and two equally expensive cards repair identically across repeated runs. The same rule gives the same result at mutation time and at match time.
7. Mutation fuzz: from each baseline, seeded mutation chains in all five kingdoms all produce finite weights, integer `desiredCount` in range, a valid `RangeBand`, only market cards, a build that `submitBuild` accepts, and one short `runMatch` that does not throw.
8. Mutations can change each named field, a package mutation changes a related group, and two candidates in one generation do not receive identical mutations.
9. Two deadline-free runs with the same config and seed produce identical generations, including leader order and every score.
10. With an injected clock, a deadline mid-generation returns the finished generations plus the partial one, `onGeneration` fired for each before `evolve` returned, and `roundRobin` respects the same deadline.
11. The final round robin includes the retained per-generation leaders, deduped, and a leader retained unchanged appears once.
12. `TournamentResult.calibration` feeds step 5's `checkRiggedMelee` unchanged, and acquisitions aggregate correctly when one strategy plays both seats and both arena sides.
13. Limit validation: `candidates < 5`, `leaders > candidates`, and zero values are rejected or clamped, and the behaviour is stated.

## Completion criterion

Evolution, retained leaders, and the round-robin tournament work deterministically, the checks pass, and the four verification commands pass. Record measured matches per second from the smoke run and the projected full-run total **including the tournament term**.
