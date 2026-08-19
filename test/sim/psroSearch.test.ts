import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { diagnosticStrategies } from '../../src/sim/baselines';
import { mixtureSchedule, percentileBootstrapMean } from '../../src/sim/mixtureEvaluation';
import {
  allocateLocalCandidates, generateResponseBatch, globalAdmission, nicheAdmission
} from '../../src/sim/responseOracle';
import { randomUniqueStrategies, strategyIsLegal } from '../../src/sim/randomStrategy';
import { assertDisjointSeedNamespaces, namespaceSeeds } from '../../src/sim/seedNamespaces';
import { canonicalStrategy } from '../../src/sim/strategy';
import { solveEquilibrium } from '../../src/sim/equilibrium';
import { rectifiedNiches } from '../../src/sim/psro';

describe('automatic PSRO search inputs', () => {
  afterEach(() => { resetKingdoms(); });
  it('generates deterministic, legal, unique, Copper-free strategies without baselines', () => {
    const first = randomUniqueStrategies('current-duel', 91, 20);
    const second = randomUniqueStrategies('current-duel', 91, 20);
    expect(first).toEqual(second);
    expect(new Set(first.strategies.map(canonicalStrategy)).size).toBe(first.strategies.length);
    for (const strategy of first.strategies) expect(strategyIsLegal('current-duel', strategy)).toBe(true);
  });

  it('initializes a registered kingdom that has no diagnostic baseline', () => {
    registerKingdom({ id: 'synthetic-psro', name: 'Synthetic', startingHealth: 20,
      actionPiles: [{ cardId: 'drive', count: 10 }, { cardId: 'footwork', count: 10 }] });
    const generated = randomUniqueStrategies('synthetic-psro', 2, 5);
    expect(generated.strategies).toHaveLength(5);
    expect(generated.strategies.every((strategy) => strategyIsLegal('synthetic-psro', strategy))).toBe(true);
  });

  it('uses the 70/30 target and fills local shortfalls with fresh random strategies', () => {
    const parents = new Map(diagnosticStrategies('current-duel').slice(0, 2).map((strategy) => [strategy.id, strategy]));
    const batch = generateResponseBatch({ kingdomId: 'current-duel', seed: 12, count: 20, parents,
      weights: Object.fromEntries([...parents.keys()].map((id) => [id, 0.5])), existing: [] });
    expect(batch.sources.requestedLocal).toBe(14);
    expect(batch.sources.requestedRandom).toBe(6);
    expect(batch.sources.actual).toBe(20);
    expect(new Set(batch.candidates.map(canonicalStrategy)).size).toBe(20);
  });

  it('allocates equal-weight local remainders by stable strategy id', () => {
    expect(allocateLocalCandidates({ c: 1, a: 1, b: 1 }, 5)).toEqual([
      ['a', 2], ['b', 2], ['c', 1]
    ]);
  });

  it('samples one total block budget against a weighted mixture and reports unsampled support', () => {
    const schedule = mixtureSchedule({ a: 0.99, b: 0.01 }, [1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(schedule.blocks).toHaveLength(8);
    expect(Object.values(schedule.realizedOpponentCounts).reduce((a, b) => a + b, 0)).toBe(8);
    expect(schedule.unsampledPositiveWeightStrategies).toContain('b');
  });

  it('uses the weighted mean instead of rejecting a candidate for negative blocks', () => {
    const values = [...Array<number>(15).fill(1), ...Array<number>(10).fill(0.49)];
    const interval = percentileBootstrapMean(values, 5);
    expect(values.reduce((a, b) => a + b, 0) / values.length).toBeGreaterThan(0.52);
    expect(interval.lower).toBeGreaterThan(0.5);
    expect(globalAdmission(0.6, interval)).toBe(true);
  });

  it('admits deterministic smoke wins and rejects noisy held-out results', () => {
    const dominant = percentileBootstrapMean(Array<number>(8).fill(1), 8);
    expect(globalAdmission(1, dominant)).toBe(true);
    expect(globalAdmission(0.7, { lower: 0.49, upper: 0.9 })).toBe(false);
    expect(nicheAdmission(0.03, { lower: 0.01, upper: 0.05 })).toBe(true);
    expect(nicheAdmission(0.01, { lower: 0.001, upper: 0.05 })).toBe(false);
  });

  it('keeps all seed namespaces disjoint', () => {
    const namespaces = Object.fromEntries(['matrix', 'global-screen', 'global-confirm', 'bootstrap', 'diagnostic']
      .map((phase) => [phase, namespaceSeeds(1, phase as Parameters<typeof namespaceSeeds>[1], 25)]));
    expect(() => assertDisjointSeedNamespaces(namespaces)).not.toThrow();
  });

  it('derives rectified niches from matrix payoffs without manual strategy families', () => {
    const strategies = diagnosticStrategies('current-duel').slice(0, 3);
    const payoff = [[0, 1, -1], [-1, 0, 1], [1, -1, 0]];
    const equilibrium = solveEquilibrium(strategies.map((strategy) => strategy.id), payoff);
    const niches = rectifiedNiches({
      protocol: { kingdomId: 'current-duel', cards: [], seeds: [1], turnLimitPerPlayer: 30,
        actionCapPerTurn: 200, stateLimit: 20000, orientationProtocol: 'test' },
      strategies: [...strategies], cells: [], complete: true, centeredPayoffs: payoff
    }, equilibrium);
    expect(niches).toHaveLength(3);
    for (const niche of niches) {
      expect(niche.weights[niche.focal.id]).toBeUndefined();
      expect(Object.keys(niche.weights)).toHaveLength(1);
      const focalIndex = strategies.findIndex((strategy) => strategy.id === niche.focal.id);
      const opponentIndex = strategies.findIndex((strategy) => strategy.id === Object.keys(niche.weights)[0]);
      expect(payoff[focalIndex]![opponentIndex]).toBeGreaterThanOrEqual(0);
    }
  });
});
