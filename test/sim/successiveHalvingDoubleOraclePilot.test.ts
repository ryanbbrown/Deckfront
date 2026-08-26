import { describe, expect, it } from 'vitest';
import { diagnosticStrategies } from '../../src/sim/baselines';
import type { CandidateEvaluation } from '../../src/sim/mixtureEvaluation';
import { emptyAggregate } from '../../src/sim/pairing';
import type { Strategy } from '../../src/sim/strategy';
import { canonicalStrategy } from '../../src/sim/strategy';
import { runStandardHalving } from '../../scripts/successive_halving_double_oracle_pilot';

describe('exploratory Successive-Halving Double Oracle pilot', () => {
  it('screens every inactive strategy, reranks cumulative scores, and selects one response', async () => {
    const strategies = diagnosticStrategies('current-duel').slice(0, 5);
    const candidates = strategies.map((strategy, index) => ({ strategy, identity: {
      goldfishRank: index + 51, strategyId: strategy.id, canonicalStrategy: canonicalStrategy(strategy)
    } }));
    const firstRoundSizes: number[] = [];
    let round = 0;
    const scores = [
      [1, 0.9, 0.8, 0.7, 0.6, 0.5],
      [0, 0.9, 0.8],
      [0.75, 0.75, 1, 1]
    ];
    const evaluate = async (active: readonly Strategy[]): Promise<CandidateEvaluation[]> => {
      firstRoundSizes.push(active.length);
      const roundScores = scores[round++]!;
      let offset = 0;
      return active.map((strategy) => {
        const count = round === 3 ? 2 : 1;
        const blockScores = roundScores.slice(offset, offset + count); offset += count;
        return { strategy, mean: blockScores.reduce((sum, score) => sum + score, 0) / count,
          blockScores, interval: null, matches: count * 2, telemetry: emptyAggregate() };
      });
    };
    const runner = { async run() { throw new Error('custom evaluator must own this fixture'); }, async close() {} };
    const result = await runStandardHalving({ candidates, opponents: new Map(), weights: { target: 1 },
      seeds: { halving: [1, 2, 3, 4], halvingOpponent: 5, tie: 6,
        confirmation: [], confirmationOpponent: 7, bootstrap: 8 },
      kingdomId: 'current-duel', runner, depths: [1, 2, 4], evaluate: evaluate as never });

    expect(firstRoundSizes).toEqual([5, 3, 2]);
    expect(result.rounds.map((held) => [held.entered, held.survivors])).toEqual([[5, 3], [3, 2], [2, 1]]);
    expect(result.selected.id).toBe(strategies[2]!.id);
    expect(result.candidateSeedEvaluations).toBe(12);
    expect(result.games).toBe(24);
  });
});
