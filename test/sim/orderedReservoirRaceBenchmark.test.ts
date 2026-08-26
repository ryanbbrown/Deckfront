import { describe, expect, it } from 'vitest';
import type { EquilibriumResult } from '../../src/sim/equilibrium';
import type { OrderedChallengePoolArtifact } from '../../src/sim/orderedReservoirChallenge';
import {
  ORDERED_RACE_BENCHMARK_PROTOCOL, benchmarkPoolSlices, benchmarkTrialSchedule,
  compareSets, createOrderedRaceBenchmarkChunkArtifact, createOrderedRaceBenchmarkReport,
  orderedRaceBenchmarkSeedPlan, rankBenchmarkCandidates, tieAdjustedSpearman,
  validateOrderedRaceBenchmarkChunkArtifact
} from '../../src/sim/orderedReservoirRaceBenchmark';
import type {
  OrderedRaceBenchmarkCandidateEvidence, OrderedRaceBenchmarkMatrixArtifact,
  OrderedRaceBenchmarkProtocol
} from '../../src/sim/orderedReservoirRaceBenchmark';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

function strategy(index: number): Strategy {
  return identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: `card-${index}`, desiredCount: 1 }
  ]) });
}
function pool(count: number): OrderedChallengePoolArtifact {
  return { kingdomId: 'deep-beam-tuning-009', generatedHash: 'abcdef123', reservoirHash: '123456789abcdef',
    source: { rankedSha256: 'a'.repeat(64) }, reservoir: Array.from({ length: count }, (_unused, index) => ({
      goldfishRank: index + 1, strategy: strategy(index)
    })) } as OrderedChallengePoolArtifact;
}
function equilibrium(ids: readonly string[]): EquilibriumResult {
  return { strategyIds: [...ids], weights: Object.fromEntries(ids.map((id) => [id, 1 / ids.length])),
    maximumEquilibriumWeight: Object.fromEntries(ids.map((id) => [id, 1 / ids.length])), value: 0,
    maximumKnownAdvantage: 0,
    residuals: { nonnegative: 0, totalWeight: 0, value: 0, payoff: 0 } };
}

const smallProtocol: OrderedRaceBenchmarkProtocol = {
  ...ORDERED_RACE_BENCHMARK_PROTOCOL, rankLimit: 5, initialStrategies: 2, matrixBlocks: 2,
  evaluationTrials: 2, candidateBlocks: 2, chunkSize: 2
};
function smallMatrix(source: OrderedChallengePoolArtifact): OrderedRaceBenchmarkMatrixArtifact {
  const initial = benchmarkPoolSlices(source, smallProtocol).initial;
  return { schemaVersion: 1, experiment: 'ordered-reservoir-race-benchmark-matrix',
    version: 'ordered-reservoir-race-benchmark-v3', poolHash: source.generatedHash,
    reservoirHash: source.reservoirHash, sourceRankedSha256: source.source.rankedSha256,
    protocol: smallProtocol, seedPlan: orderedRaceBenchmarkSeedPlan(source.reservoirHash, smallProtocol),
    matrix: { protocol: {} as OrderedRaceBenchmarkMatrixArtifact['matrix']['protocol'], strategies: initial,
      cells: [], complete: true, centeredPayoffs: [[0, 0], [0, 0]] },
    equilibrium: equilibrium(initial.map((entry) => entry.id)), elapsedMs: 0, evidenceHash: 'matrix-hash' };
}

describe('ordered reservoir early-race benchmark protocol', () => {
  it('reuses the v1 matrix seeds and gives each candidate 25 independent shuffle seeds per trial', () => {
    const plan = orderedRaceBenchmarkSeedPlan('123456789abcdef');
    const allSeeds = [...plan.matrixSeeds,
      ...plan.trials.flatMap((trial) => [...trial.blockSeeds, trial.opponentSamplingSeed])];
    expect(new Set(allSeeds).size).toBe(allSeeds.length);
    expect(plan.trials).toHaveLength(3);
    expect(plan.matrixSeeds[0]).toBe(1_815_467_663);
    expect(plan.trials.every((trial) => trial.blockSeeds.length === 25)).toBe(true);
    expect(orderedRaceBenchmarkSeedPlan('123456789abcdef')).toEqual(plan);

    const source = pool(5);
    const base = smallMatrix(source);
    const matrix = { ...base, protocol: ORDERED_RACE_BENCHMARK_PROTOCOL,
      seedPlan: plan };
    const schedule = benchmarkTrialSchedule(matrix, 0);
    expect(schedule.blocks).toHaveLength(25);
    expect(Object.values(schedule.realizedOpponentCounts).reduce((sum, count) => sum + count, 0)).toBe(25);
    expect(ORDERED_RACE_BENCHMARK_PROTOCOL.candidateBlocks
      * ORDERED_RACE_BENCHMARK_PROTOCOL.gamesPerSeedEvaluation).toBe(50);
  });

  it('selects one ranked prefix for the fixed matrix and the following ranks for evaluation', () => {
    const source = pool(5);
    const slices = benchmarkPoolSlices(source, smallProtocol);
    expect(slices.initial.map((entry) => entry.id)).toEqual([
      source.reservoir[0]!.strategy.id, source.reservoir[1]!.strategy.id
    ]);
    expect(slices.candidates.map((entry) => entry.id)).toEqual(source.reservoir.slice(2).map((entry) => entry.strategy.id));
    const stale = structuredClone(source);
    stale.reservoir[3]!.goldfishRank = 99;
    expect(() => benchmarkPoolSlices(stale, smallProtocol)).toThrow('ranked reservoir prefix');
  });

  it('accepts complete resumable chunks and rejects changed schedules or block evidence', () => {
    const source = pool(5), matrix = smallMatrix(source);
    const schedule = benchmarkTrialSchedule(matrix, 0);
    const expected = source.reservoir.slice(2, 4);
    const chunk = createOrderedRaceBenchmarkChunkArtifact({
      matrixEvidenceHash: matrix.evidenceHash, trial: 0, chunk: 0, startRank: 3, endRank: 4,
      schedule, candidates: expected.map((entry) => ({ goldfishRank: entry.goldfishRank,
        strategyId: entry.strategy.id, canonicalStrategy: JSON.stringify({
          buyPlan: entry.strategy.buyPlan.map((slot) => slot.kind === 'buy'
            ? ['buy', slot.cardId, slot.desiredCount] : ['inactive']), startingBuild: [] }),
        blockScores: [0.5, 0.75], matches: 4 })), elapsedMs: 10
    });
    expect(validateOrderedRaceBenchmarkChunkArtifact(chunk, source, matrix, smallProtocol)).toBe(true);
    const changedScore = structuredClone(chunk); changedScore.candidates[0]!.blockScores[1] = 0.5;
    expect(validateOrderedRaceBenchmarkChunkArtifact(changedScore, source, matrix, smallProtocol)).toBe(false);
    const changedSchedule = structuredClone(chunk); changedSchedule.schedule.blocks[0]!.seed += 1;
    expect(validateOrderedRaceBenchmarkChunkArtifact(changedSchedule, source, matrix, smallProtocol)).toBe(false);
  });
});

function evidence(index: number, score: number): OrderedRaceBenchmarkCandidateEvidence {
  return { goldfishRank: index + 1, strategyId: `sg-${String(index).padStart(3, '0')}`,
    canonicalStrategy: `strategy-${index}`, blockScores: Array(25).fill(score), matches: 100 };
}

describe('ordered reservoir early-race consistency calculations', () => {
  it('uses score prefixes, tie-adjusted rank correlation, and exact set Jaccard', () => {
    const rows = [
      { ...evidence(0, 0), blockScores: [1, ...Array(24).fill(0)] },
      { ...evidence(1, 0.5), blockScores: Array(25).fill(0.5) },
      { ...evidence(2, 0.4), blockScores: Array(25).fill(0.4) }
    ];
    expect(rankBenchmarkCandidates(rows, 1).map((entry) => entry.strategyId)).toEqual(['sg-000', 'sg-001', 'sg-002']);
    expect(rankBenchmarkCandidates(rows, 8).map((entry) => entry.strategyId)).toEqual(['sg-001', 'sg-002', 'sg-000']);
    expect(rankBenchmarkCandidates(rows, 25).map((entry) => entry.strategyId)).toEqual(['sg-001', 'sg-002', 'sg-000']);
    expect(compareSets(new Set(['a', 'b']), new Set(['b', 'c']))).toEqual({ intersection: 1, union: 3, jaccard: 1 / 3 });
    expect(tieAdjustedSpearman(rankBenchmarkCandidates(rows, 25), rankBenchmarkCandidates(rows, 25))).toBeCloseTo(1);
  });

  it('reports pairwise and triple top-cutoff consistency from the saved block scores', () => {
    const protocol: OrderedRaceBenchmarkProtocol = { ...ORDERED_RACE_BENCHMARK_PROTOCOL,
      rankLimit: 100, initialStrategies: 0, matrixBlocks: 1, evaluationTrials: 3,
      candidateBlocks: 25, chunkSize: 100 };
    const sets = [new Set(Array.from({ length: 16 }, (_unused, index) => index)),
      new Set(Array.from({ length: 16 }, (_unused, index) => index + 8)),
      new Set(Array.from({ length: 16 }, (_unused, index) => index + 12))];
    const matrix = { elapsedMs: 10, evidenceHash: 'matrix-hash' } as OrderedRaceBenchmarkMatrixArtifact;
    const chunks = sets.map((top, trial) => createOrderedRaceBenchmarkChunkArtifact({
      matrixEvidenceHash: matrix.evidenceHash, trial, chunk: 0, startRank: 1, endRank: 100,
      schedule: { targetWeights: { target: 1 }, blocks: [], realizedOpponentCounts: { target: 25 },
        unsampledPositiveWeightStrategies: [] },
      candidates: Array.from({ length: 100 }, (_unused, index) => evidence(index, top.has(index) ? 1 : index / 1000)),
      elapsedMs: 20
    }));
    const report = createOrderedRaceBenchmarkReport({ matrix, chunks, protocol });
    const top16 = report.depths[0]!.cutoffs[0]!;
    expect(top16.pairwise.map((entry) => entry.intersection)).toEqual([8, 4, 12]);
    expect(top16.triple).toEqual({ intersection: 4, union: 28, jaccard: 1 / 7 });
    expect(report.depthComparisons.every((entry) => entry.intersection === entry.cutoff)).toBe(true);
    expect(report.depths.map((entry) => entry.blocks)).toEqual([1, 8, 25]);
    expect(report.matches).toBe(3 * 100 * 25 * 2);
  });
});
