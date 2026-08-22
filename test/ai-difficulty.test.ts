import { describe, expect, it } from 'vitest';
import { VARIABLE_ACTION_IDS, randomKingdom } from '../src/game';
import { ProductionAiTrainer } from '../src/server/aiTrainer';
import type { AiTrainingLimits } from '../src/server/aiTrainer';
import type { EquilibriumResult } from '../src/sim/equilibrium';
import type { MatrixSnapshot } from '../src/sim/payoffMatrix';
import type { PairingRunner } from '../src/sim/pairingRunner';
import type { PsroResult } from '../src/sim/psro';
import { INFINITE_COUNT } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';

const limits: AiTrainingLimits = {
  restarts: 1, initialStrategies: 1, candidates: 1, iterations: 1,
  seeds: 1, unionIterations: 1, workers: 1, deadlineMinutes: 1
};
const kingdom = randomKingdom('ai-difficulty-fixture', VARIABLE_ACTION_IDS.slice(0, 10));
const runner: PairingRunner = {
  run: async () => { throw new Error('Literal training results do not run games.'); },
  close: async () => undefined
};
function strategy(id: string): Strategy {
  return { id, startingBuild: [], buyPlan: [{ kind: 'buy', cardId: 'silver', desiredCount: INFINITE_COUNT }] };
}
function result(strategies: Strategy[], payoffs: number[][], weights: number[]): PsroResult {
  const weightMap = Object.fromEntries(strategies.map((entry, index) => [entry.id, weights[index]!]));
  const equilibrium: EquilibriumResult = {
    strategyIds: strategies.map((entry) => entry.id), weights: weightMap,
    maximumEquilibriumWeight: weightMap, value: 0, maximumKnownAdvantage: 0,
    residuals: { nonnegative: 0, totalWeight: 0, value: 0, payoff: 0 }
  };
  const matrix: MatrixSnapshot = {
    protocol: {
      kingdomId: kingdom.id, cards: [], seeds: [1], turnLimitPerPlayer: 30,
      actionCapPerTurn: 100, orientationProtocol: 'literal', rulesFingerprint: 'literal'
    },
    strategies, cells: [], complete: true, centeredPayoffs: payoffs
  };
  return {
    valid: true, restarts: [], strategies, matrix, equilibrium, events: [], finalFailures: [],
    restartAgreement: [], matches: 1200, stopReason: 'literal', restartStatuses: [], failure: null,
    seedNamespaces: {}
  };
}
function trainer(trainingResult: PsroResult): ProductionAiTrainer {
  return new ProductionAiTrainer(limits, {
    createRunner: () => runner,
    runSearch: async () => trainingResult
  });
}
describe('AI difficulty strategy selection', () => {
  it('chooses Easy, Normal, and Hard strategies only from their score bands', async () => {
    const strategies = ['lottery', 'easy-low', 'easy-high', 'normal', 'hard', 'weak'].map(strategy);
    const payoffs = [
      [0, 0.38, 0.32, 0.2, 0.1, 0.8],
      [-0.38, 0, 0, 0, 0, 0],
      [-0.32, 0, 0, 0, 0, 0],
      [-0.2, 0, 0, 0, 0, 0],
      [-0.1, 0, 0, 0, 0, 0],
      [-0.8, 0, 0, 0, 0, 0]
    ];
    const production = trainer(result(strategies, payoffs, [1, 0, 0, 0, 0, 0]));

    const easy = await production.train(kingdom, 17, 'easy');
    const normal = await production.train(kingdom, 17, 'normal');
    const hard = await production.train(kingdom, 17, 'hard');

    expect(['easy-low', 'easy-high']).toContain(easy.strategy.id);
    expect(normal.strategy.id).toBe('normal');
    expect(hard.strategy.id).toBe('hard');
  });

  it('uses only nearest strategies when the requested score band is empty', async () => {
    const strategies = ['lottery', 'below', 'above', 'weak'].map(strategy);
    const payoffs = [
      [0, 0.32, 0.08, 0.8],
      [-0.32, 0, 0, 0],
      [-0.08, 0, 0, 0],
      [-0.8, 0, 0, 0]
    ];
    const production = trainer(result(strategies, payoffs, [1, 0, 0, 0]));

    const selected = await production.train(kingdom, 4, 'normal');

    expect(['below', 'above']).toContain(selected.strategy.id);
  });

  it('is deterministic for the same training seed and difficulty', async () => {
    const strategies = ['lottery', 'easy-low', 'easy-high'].map(strategy);
    const payoffs = [[0, 0.38, 0.32], [-0.38, 0, 0], [-0.32, 0, 0]];
    const production = trainer(result(strategies, payoffs, [1, 0, 0]));

    const first = await production.train(kingdom, 81, 'easy');
    const second = await production.train(kingdom, 81, 'easy');

    expect(second.strategy.id).toBe(first.strategy.id);
  });

  it('uses the non-uniform final lottery probabilities for Expert', async () => {
    const strategies = ['primary', 'secondary'].map(strategy);
    const payoffs = [[0, 0], [0, 0]];

    const primary = await trainer(result(strategies, payoffs, [0.95, 0.05])).train(kingdom, 0, 'expert');
    const secondary = await trainer(result(strategies, payoffs, [0.9, 0.1])).train(kingdom, 0, 'expert');

    expect(primary.strategy.id).toBe('primary');
    expect(secondary.strategy.id).toBe('secondary');
  });
});
