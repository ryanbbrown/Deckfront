import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { DIAGONAL_PURPOSE } from '../../src/sim/initialMatrixCalibration';
import type { InitialMatrixSeedRecord } from '../../src/sim/initialMatrixCalibration';
import { emptyAggregate } from '../../src/sim/pairing';
import { fixedBuyPlan } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import {
  createStrategySearchMatrixChunk, createStrategySearchMatrixManifest, executeStrategySearchMatrixBatches,
  strategySearchMatrixJobs, validateStrategySearchMatrixBatchTiming, validateStrategySearchMatrixChunk,
  validateStrategySearchMatrixCommandTiming
} from '../../src/sim/strategySearchMatrix';

const kingdomId = 'deep-beam-tuning-002';
beforeAll(() => registerKingdom(deepBeamSuite.kingdoms.find((entry) => entry.id === kingdomId)!));
function strategies(): Strategy[] {
  return Array.from({ length: 50 }, (_unused, index) => ({ id: `strategy-${index}`,
    startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: index % 2 ? 'drive' : 'volley',
      desiredCount: index + 1 }]) }));
}
function manifest() {
  return createStrategySearchMatrixManifest({ stageId: '1'.repeat(64), source: { kingdomId,
    orderedProductIdentityHash: '2'.repeat(64), rankedSha256: '3'.repeat(64), reservoirSha256: '4'.repeat(64) },
  strategies: strategies() });
}
function records(row: Strategy, column: Strategy, seeds: readonly number[]): InitialMatrixSeedRecord[] {
  return seeds.map((seed) => {
    const telemetry = emptyAggregate();
    for (const strategy of new Map([[row.id, row], [column.id, column]]).values()) {
      telemetry.acquisitionsByStrategy[strategy.id] = {};
      telemetry.planPositionPurchasesByStrategy![strategy.id] = {};
    }
    telemetry.byOrientation.firstOchre.normal = { played: 1, wins: 0, draws: 1, losses: 0, aborted: 0 };
    telemetry.byOrientation.firstIndigo.normal = { played: 1, wins: 0, draws: 1, losses: 0, aborted: 0 };
    return { seed, payoffScore: row.id === column.id ? null : 0.5, played: 2 as const,
      aborted: 0 as const, matches: 2 as const, telemetry };
  });
}

describe('campaign Matrix schema and batching', () => {
  it('pins 25-seed chunks and deterministic upper-triangle result slots', () => {
    const held = manifest(), jobs = strategySearchMatrixJobs(held);
    expect(jobs).toHaveLength(6_375);
    expect(jobs.slice(0, 7).map((job) => [job.slot, job.rowIndex, job.columnIndex,
      job.startSeedIndex, job.count])).toEqual([
      [0, 0, 0, 0, 25], [1, 0, 0, 25, 25], [2, 0, 0, 50, 25],
      [3, 0, 0, 75, 25], [4, 0, 0, 100, 25], [5, 0, 1, 0, 25], [6, 0, 1, 25, 25]
    ]);
    expect(held.trainingPrefixes).toEqual([75, 100]);
    expect(held.heldOutOrdinals).toEqual({ start: 101, end: 125 });
  });

  it('places shuffled worker results in slot order and records one exact batch timing', async () => {
    const held = manifest(), jobs = strategySearchMatrixJobs(held).slice(4, 8), events: unknown[] = [];
    const output = await executeStrategySearchMatrixBatches({ manifest: held, jobs, jobsPerBatch: 4,
      workerCount: 4, async runBatch(batch) {
        return [...batch].reverse().map((job) => ({ slot: job.slot,
          records: records(held.strategies[job.rowIndex]!, held.strategies[job.columnIndex]!, job.seeds) }));
      }, checkpoint(event) { events.push(event); } });
    expect(output.chunks.map((chunk) => chunk.slot)).toEqual([4, 5, 6, 7]);
    expect(output.chunks.every((chunk, index) => validateStrategySearchMatrixChunk(chunk, held, jobs[index]!)))
      .toBe(true);
    expect(output.chunks[0]).not.toHaveProperty('simulationMs');
    expect(output.timings).toHaveLength(1);
    expect(validateStrategySearchMatrixBatchTiming(output.timings[0], held, [4, 5, 6, 7])).toBe(true);
    expect(validateStrategySearchMatrixCommandTiming(output.commandTiming, held)).toBe(true);
    expect(output.commandTiming.workerCount).toBe(4);
    expect(events).toHaveLength(1);
  });

  it('keeps semantic chunk bytes independent of worker batching and fails closed on corrupt resume data', async () => {
    const held = manifest(), jobs = strategySearchMatrixJobs(held).slice(0, 3);
    const execute = (jobsPerBatch: number) => executeStrategySearchMatrixBatches({ manifest: held, jobs,
      jobsPerBatch, workerCount: 4, async runBatch(batch) { return batch.map((job) => ({ slot: job.slot,
        records: records(held.strategies[job.rowIndex]!, held.strategies[job.columnIndex]!, job.seeds) })); },
      checkpoint() {} });
    const single = await execute(1), batched = await execute(3);
    expect(single.chunks).toEqual(batched.chunks);
    expect(single.timings).toHaveLength(3);
    expect(batched.timings).toHaveLength(1);
    const corrupt = structuredClone(batched.chunks[0]!); corrupt.records[0]!.seed += 1;
    expect(validateStrategySearchMatrixChunk(corrupt, held, jobs[0]!)).toBe(false);
    expect(() => createStrategySearchMatrixChunk({ manifest: held, job: jobs[0]!,
      records: records(held.strategies[0]!, held.strategies[0]!, jobs[0]!.seeds).map((record) =>
        ({ ...record, payoffScore: record.payoffScore === null ? 0.5 : record.payoffScore })) }))
      .toThrow('chunk evidence is invalid');
    expect(batched.chunks[0]!.purpose).toBe(DIAGONAL_PURPOSE);
  });
});
