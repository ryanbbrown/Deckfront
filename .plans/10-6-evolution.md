# Step 6: evolution, retained leaders, and tournaments

Implements step 6 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on steps 4 and 5.

## Objective

A population of strategies evolves through repeated competition against leaders, several leaders survive each generation, earlier leaders are retained, and a final round-robin tournament reports the complete matchup table.

## One generation

1. Test every candidate against every leader over shared seeds.
2. Swap first player and arena side for each pairing. Each pairing therefore plays four games for each shared seed: two first-player orders times two arena sides.
3. Score a win as 1, a draw as 0.5, and a loss as 0.
4. Keep several strong, meaningfully different candidates as the next leaders.
5. Create the next population by mutating those leaders.

Generation 1 has no previous leaders. Seed it with the fixed baselines from step 4 as the first leader set, and with seeded coherent candidates.

## Leader selection

Deterministic, as the design document requires:

1. Rank by total score.
2. Drop exact duplicate strategies, comparing the canonical serialisation.
3. Keep the top leaders.
4. Break an equal score by a stable hash of the strategy.

Do not add a diversity or distance metric. The first run does not have enough data to define one, and an arbitrary threshold would hide real results.

"Meaningfully different" is satisfied by dropping exact duplicates only. Record this reading in `PROGRESS.md`, because the design document uses both phrasings and explicitly forbids a distance metric.

## Mutation

Mutations may change the starting build, agenda cards and order, desired counts, preferred range, state-scoring weights, and trash, reclaim, and discard priorities. Some mutations change one field; some change a related package, for example a preferred range together with the attacks in the agenda.

Budget validity is the only hard coherence constraint: a starting build must cost at most 12. A mutation that breaks it is repaired by dropping its most expensive card, not rejected, so mutation always makes progress.

Independent mutations must stay possible, so the search can find mixed decks and strategic pivots. Do not restrict a mutation to one card family.

Mutation uses a seeded generator derived from the run seed and the generation number, so a run replays exactly.

## Seeding the first population

Seed coherent starting-build and agenda pairs covering melee, ranged, mage, engine, and treasure shapes, then fill the rest of the population with mutations of those seeds. Seeded pairs must not be required to use one card family.

## Retained leaders

Keep the leaders from every earlier generation. The final round-robin runs between the current leaders and the retained leaders, and reports the complete pairwise win table. Cap the retained set only if measured runtime forces it, and record the cap.

## Run limits

From the design document. The implementation may lower the full run after measuring throughput, and must record the actual limits used. It must not raise them.

| Mode | Candidates | Leaders | Generations | Shared seeds |
| --- | ---: | ---: | ---: | ---: |
| smoke | 20 | 3 | 5 | 5 |
| full | at most 100 | 5 | at most 32 | 25 |

100 turns per player before a draw. Partial populations and results are preserved at every limit.

## Interface

```ts
export interface EvolutionConfig {
  kingdomId: string;
  seed: number;
  candidates: number;
  leaders: number;
  generations: number;
  sharedSeeds: number;
  turnLimitPerPlayer: number;
  deadline?: number;   // epoch milliseconds; stop cleanly when reached
}

export interface GenerationResult {
  generation: number;
  leaders: ScoredStrategy[];
  scores: Record<string, number>;
  matchCount: number;
  overflowCount: number;
}

export interface TournamentResult {
  entrants: Strategy[];
  wins: Record<string, Record<string, number>>;   // pairwise
  ranking: ScoredStrategy[];
}

export function evolve(config: EvolutionConfig, onGeneration: (r: GenerationResult) => void): GenerationResult[];
export function roundRobin(entrants: Strategy[], config): TournamentResult;
```

`onGeneration` fires after every generation so step 7 can write partial output before a limit or deadline ends the run. A run that stops at its deadline returns the generations it finished.

## Files expected to change

| File | Change |
| --- | --- |
| `src/sim/evolution.ts` | New. Generations, scoring, leader selection. |
| `src/sim/mutation.ts` | New. Mutation operators and the budget repair. |
| `src/sim/tournament.ts` | New. Round robin and the pairwise table. |
| `src/sim/seedPopulation.ts` | New. Coherent seeded strategies. |
| `test/sim/evolution.test.ts` | New. |

## Checks

1. A pairing plays four games for each shared seed, covering both first-player orders and both arena sides.
2. Scores are 1, 0.5, and 0, and the pairwise table is consistent with the recorded results.
3. Leader selection is deterministic: the same scores and strategies always give the same leaders, and an equal score is broken by the stable hash rather than by list order.
4. Exact duplicate strategies are dropped before the top leaders are taken.
5. A mutation that pushes a starting build over 12 money is repaired by dropping its most expensive card, and the result is valid.
6. Mutations can change each named field, and a package mutation changes a related group.
7. Two runs with the same config and seed produce identical generations.
8. The final round robin includes retained leaders from earlier generations.
9. A run stopped by its deadline returns the finished generations, and `onGeneration` already reported them.

## Completion criterion

Evolution, retained leaders, and the round-robin tournament work deterministically, the checks pass, and the four verification commands pass.
