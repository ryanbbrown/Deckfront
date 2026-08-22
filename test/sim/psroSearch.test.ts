import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { diagnosticStrategies } from '../../src/sim/baselines';
import { mixtureSchedule, percentileBootstrapMean } from '../../src/sim/mixtureEvaluation';
import { emptyAggregate } from '../../src/sim/pairing';
import {
  allocateLocalCandidates, generateResponseBatch, globalAdmission, runResponseSearch
} from '../../src/sim/responseOracle';
import { randomUniqueStrategies, strategyIsLegal } from '../../src/sim/randomStrategy';
import {
  assertDisjointSeedNamespaces, finalSearchSeedNamespaces, namespaceSeeds
} from '../../src/sim/seedNamespaces';
import { canonicalStrategy } from '../../src/sim/strategy';

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

  it('adds the intentional random tail after the complete local neighborhoods', () => {
    const parents = new Map(diagnosticStrategies('current-duel').slice(0, 2).map((strategy) => [strategy.id, strategy]));
    const batch = generateResponseBatch({ kingdomId: 'current-duel', seed: 12, count: 20, parents,
      weights: Object.fromEntries([...parents.keys()].map((id) => [id, 0.5])), existing: [] });
    expect(batch.sources.local).toBeGreaterThan(1_000);
    expect(batch.sources.local).toBeLessThan(2_000);
    expect(batch.sources.requestedLocal).toBe(batch.sources.local);
    expect(batch.sources.requestedRandom).toBe(20);
    expect(batch.sources.random).toBe(20);
    expect(batch.sources.requested).toBe(batch.sources.local + 20);
    expect(batch.sources.actual).toBe(batch.sources.local + 20);
    expect(new Set(batch.candidates.map(canonicalStrategy)).size).toBe(batch.sources.actual);
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
  });

  it('keeps all seed namespaces disjoint', () => {
    const namespaces = Object.fromEntries(['matrix', 'global-race', 'global-confirm', 'bootstrap']
      .map((phase) => [phase, namespaceSeeds(1, phase as Parameters<typeof namespaceSeeds>[1], 25)]));
    expect(() => assertDisjointSeedNamespaces(namespaces)).not.toThrow();
  });

  it('uses fresh final-search namespaces on every pass', () => {
    const first = finalSearchSeedNamespaces(9, 0);
    const second = finalSearchSeedNamespaces(9, 1);
    expect(first.screen).toHaveLength(15);
    expect(first.confirmation).toHaveLength(25);
    expect(first.bootstrap).toHaveLength(1);
    expect(() => assertDisjointSeedNamespaces({ ...Object.fromEntries(Object.entries(first)
      .map(([name, seeds]) => [`first:${name}`, seeds])), ...Object.fromEntries(Object.entries(second)
      .map(([name, seeds]) => [`second:${name}`, seeds])) })).not.toThrow();
  });

  it('records an empty candidate batch as a failed complete-schedule response', async () => {
    const strategies = diagnosticStrategies('current-duel').slice(0, 2);
    const runner = { run: async () => { throw new Error('empty batches must not run games'); }, async close() {} };
    const response = await runResponseSearch({ objective: 'global', targetWeights: {
      [strategies[0]!.id]: 0.5, [strategies[1]!.id]: 0.5
    }, strategies, kingdomId: 'current-duel', runSeed: 3, restart: 0, attempt: 0,
    candidateCount: 10, blocks: 4, turnLimitPerPlayer: 30, actionCapPerTurn: 200,
    runner, batchFactory: () => ({ candidates: [], sources: {
      requested: 10, requestedLocal: 7, requestedRandom: 3, actual: 0, local: 0, random: 0,
      duplicateRejections: 640, localShortfall: 7, randomShortfall: 3
    } }) });
    expect(response.candidate).toBeNull();
    expect(response.result).toMatchObject({ admitted: false, failureReason: 'empty-batch',
      matches: 0, sources: { requested: 10, actual: 0, localShortfall: 7, randomShortfall: 3 } });
    expect(response.result?.screenSchedule.blocks).toHaveLength(15);
    expect(response.result?.confirmSchedule.blocks).toHaveLength(4);
    expect(response.result?.screenSchedule.blocks.map((block) => block.seed))
      .not.toEqual(response.result?.confirmSchedule.blocks.map((block) => block.seed));
  });

  it('rejects a training winner when the disjoint held-out schedule is noisy', async () => {
    const strategies = diagnosticStrategies('current-duel').slice(0, 3);
    const calls: { seeds: number[]; allowEarlyStop: boolean | undefined }[][] = [];
    let call = 0;
    const runner = { run: async (jobs: readonly import('../../src/sim/pairingRunner').PairingJob[]) => {
      const current = call++;
      calls.push(jobs.map((job) => ({ seeds: [...job.options.seeds],
        allowEarlyStop: job.options.allowEarlyStop })));
      return { submitted: jobs.length, outcomes: jobs.map((job, index) => {
        const score = current === 0 ? 1 : index % 2;
        return { record: { played: 4, wins: score ? 4 : 0, draws: 0,
          losses: score ? 0 : 4, aborted: 0 }, candidateScore: score * 4,
        opponentScore: (1 - score) * 4, candidateMean: score, opponentMean: 1 - score,
        telemetry: emptyAggregate(), matches: 4, seedBlocks: 1, stopReason: 'maximum' as const,
        blocks: [{ seed: job.options.seeds[0]!, score, played: 4, aborted: 0 }], aborts: [] };
      }) };
    }, async close() {} };
    const result = await runResponseSearch({ objective: 'global', targetWeights: {
      [strategies[0]!.id]: 0.5, [strategies[1]!.id]: 0.5
    }, strategies: strategies.slice(0, 2), kingdomId: 'current-duel', runSeed: 19,
    restart: 0, attempt: 0, candidateCount: 1, blocks: 8,
    turnLimitPerPlayer: 30, actionCapPerTurn: 200, runner,
    batchFactory: () => ({ candidates: [strategies[2]!], sources: { requested: 1,
      requestedLocal: 0, requestedRandom: 1, actual: 1, local: 0, random: 1,
      duplicateRejections: 0, localShortfall: 0, randomShortfall: 0 } }) });
    expect(result.result).toMatchObject({ bestTrainingMean: 1, heldOutMean: 0.5, admitted: false });
    expect(calls).toHaveLength(2);
    expect(calls.flat().every((job) => job.allowEarlyStop === false)).toBe(true);
    expect(calls[0]!.map((job) => job.seeds[0])).not.toEqual(calls[1]!.map((job) => job.seeds[0]));
  });

});
