import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { DIAGONAL_PURPOSE } from '../../src/sim/initialMatrixCalibration';
import type { InitialMatrixSeedRecord } from '../../src/sim/initialMatrixCalibration';
import { emptyAggregate } from '../../src/sim/pairing';
import { fixedBuyPlan } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import {
  createStrategySearchMatrixBatchTiming, createStrategySearchMatrixChunk,
  createStrategySearchMatrixCommandTiming, createStrategySearchMatrixManifest,
  createStrategySearchMatrixP75Source,
  executeStrategySearchMatrixBatches, reconcileStrategySearchMatrixResume,
  runStrategySearchMatrixPairingBatch, strategySearchMatrixChunkPath, strategySearchMatrixJobs, strategySearchMatrixTimingPath,
  validateStrategySearchMatrixBatchTiming, validateStrategySearchMatrixChunk,
  validateStrategySearchMatrixCommandTiming, validateStrategySearchMatrixP75Source
} from '../../src/sim/strategySearchMatrix';
import {
  createCampaignStageControlMarker, validateCampaignMatrixStage
} from '../../src/sim/strategySearchStages';

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
function reseal<T extends { evidenceHash: string }>(value: T): T {
  const copy = structuredClone(value); copy.evidenceHash = '';
  return { ...copy, evidenceHash: createHash('sha256').update(JSON.stringify(copy)).digest('hex') };
}
function records(row: Strategy, column: Strategy, seeds: readonly number[], payoffScore = 0.5): InitialMatrixSeedRecord[] {
  return seeds.map((seed) => {
    const telemetry = emptyAggregate();
    for (const strategy of new Map([[row.id, row], [column.id, column]]).values()) {
      telemetry.acquisitionsByStrategy[strategy.id] = {};
      telemetry.planPositionPurchasesByStrategy![strategy.id] = {};
    }
    telemetry.byOrientation.firstOchre.normal = { played: 1, wins: 0, draws: 1, losses: 0, aborted: 0 };
    telemetry.byOrientation.firstIndigo.normal = { played: 1, wins: 0, draws: 1, losses: 0, aborted: 0 };
    return { seed, payoffScore: row.id === column.id ? null : payoffScore, played: 2 as const,
      aborted: 0 as const, matches: 2 as const, telemetry };
  });
}

describe('campaign Matrix schema and batching', () => {
  it('pins 25-seed chunks and deterministic upper-triangle result slots', () => {
    const held = manifest(), jobs = strategySearchMatrixJobs(held);
    expect(jobs).toHaveLength(6_375);
    expect(strategySearchMatrixJobs(held)).toBe(jobs);
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
    expect(validateStrategySearchMatrixBatchTiming(output.timings[0], held,
      { batchIndex: 0, jobs, workerCount: 4 })).toBe(true);
    expect(validateStrategySearchMatrixCommandTiming(output.commandTiming, held)).toBe(true);
    expect(output.commandTiming.workerCount).toBe(4);
    const wrongIdentity = createStrategySearchMatrixBatchTiming({ manifest: held, batchIndex: 1,
      jobs, workerCount: 4, simulationMs: 1 });
    expect(validateStrategySearchMatrixBatchTiming(wrongIdentity, held,
      { batchIndex: 0, jobs, workerCount: 4 })).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('gives resumed subsets immutable noncolliding timing paths', async () => {
    const held = manifest(), all = strategySearchMatrixJobs(held);
    const paths: string[] = [];
    const execute = (jobs: readonly (typeof all)[number][], jobsPerBatch: number, workerCount: number) =>
      executeStrategySearchMatrixBatches({ manifest: held, jobs, jobsPerBatch, workerCount,
        async runBatch(batch) { return batch.map((job) => ({ slot: job.slot,
          records: records(held.strategies[job.rowIndex]!, held.strategies[job.columnIndex]!, job.seeds) })); },
        checkpoint(event) { paths.push(event.timing.path); } });
    const first = await execute(all.slice(0, 4), 2, 4);
    const resumed = await execute([all[1]!, all[3]!, all[5]!], 3, 2);
    expect(first.timings[0]!.batchIndex).toBe(0);
    expect(resumed.timings[0]!.batchIndex).toBe(0);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([...first.timings, ...resumed.timings]
      .map((timing) => strategySearchMatrixTimingPath(timing.batchIdentity)));
  });

  it('quarantines both Matrix crash orders and reruns only invalid coverage', () => {
    const held = manifest(), jobs = strategySearchMatrixJobs(held).slice(0, 2);
    const chunks = jobs.map((job) => createStrategySearchMatrixChunk({ manifest: held, job,
      records: records(held.strategies[job.rowIndex]!, held.strategies[job.columnIndex]!, job.seeds) }));
    const orphan = reconcileStrategySearchMatrixResume({ manifest: held, chunks: [chunks[0]!], timings: [] });
    expect(orphan.quarantineChunkSlots).toEqual([0]);
    expect(orphan.missingJobs.some((job) => job.slot === 0)).toBe(true);
    const timing = createStrategySearchMatrixBatchTiming({ manifest: held, batchIndex: 0,
      jobs, workerCount: 2, simulationMs: 1 });
    const missingChunk = reconcileStrategySearchMatrixResume({ manifest: held,
      chunks: [chunks[0]!], timings: [timing] });
    expect(missingChunk.quarantineTimingHashes).toEqual([timing.evidenceHash]);
    expect(missingChunk.quarantineChunkSlots).toEqual([0]);
    expect(missingChunk.missingJobs.slice(0, 2).map((job) => job.slot)).toEqual([0, 1]);
  });

  it('passes the shutdown margin into the resident pairing runner and rejects partial dispatch', async () => {
    let seenDeadline = 0;
    const runner = { async run(jobs: readonly unknown[], options?: { deadline?: number }) {
      seenDeadline = options?.deadline ?? 0; return { outcomes: Array(jobs.length).fill(null), submitted: 0 };
    }, async close() {} };
    await expect(runStrategySearchMatrixPairingBatch(runner as never, [{}] as never, 12345))
      .rejects.toThrow('shutdown-margin');
    expect(seenDeadline).toBe(12345);
  });

  it('rejects extra, duplicate, and foreign result slots and jobs', async () => {
    const held = manifest(), jobs = strategySearchMatrixJobs(held).slice(0, 2);
    const result = (job: (typeof jobs)[number]) => ({ slot: job.slot,
      records: records(held.strategies[job.rowIndex]!, held.strategies[job.columnIndex]!, job.seeds) });
    const run = (runBatch: (batch: readonly (typeof jobs)[number][]) => Promise<readonly ReturnType<typeof result>[]>) =>
      executeStrategySearchMatrixBatches({ manifest: held, jobs, jobsPerBatch: 2, workerCount: 2,
        runBatch, checkpoint() {} });
    await expect(run(async (batch) => [result(batch[0]!), result(batch[0]!)]))
      .rejects.toThrow('extra or duplicate');
    await expect(run(async (batch) => [...batch.map(result), { ...result(batch[0]!), slot: 99 }]))
      .rejects.toThrow('extra or duplicate');
    const foreign = structuredClone(jobs);
    foreign[0]!.seeds[0] = foreign[0]!.seeds[0]! + 1;
    await expect(executeStrategySearchMatrixBatches({ manifest: held, jobs: foreign, jobsPerBatch: 2,
      workerCount: 2, async runBatch() { return []; }, checkpoint() {} }))
      .rejects.toThrow('batch plan is invalid');
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

  it('constructs and deeply validates the real 50-strategy P75 source', () => {
    const held = manifest(), allJobs = strategySearchMatrixJobs(held);
    const chunks = allJobs.map((job) => createStrategySearchMatrixChunk({ manifest: held, job,
      records: records(held.strategies[job.rowIndex]!, held.strategies[job.columnIndex]!, job.seeds,
        job.rowIndex === 0 && job.columnIndex > 0 ? 0.75 : 0.5) }));
    const p75Chunks = chunks.filter((chunk) => chunk.startSeedIndex < 75);
    const source = createStrategySearchMatrixP75Source(held, p75Chunks);
    expect(source.cellChunkHashes).toHaveLength(3_825);
    expect(source.centeredPayoffs[0]![1]).toBe(0.5);
    expect(source.equilibrium.weights[held.strategies[0]!.id]).toBeCloseTo(1);
    expect(validateStrategySearchMatrixP75Source(source, held, p75Chunks)).toBe(true);
    const timing = createStrategySearchMatrixBatchTiming({ manifest: held, batchIndex: 0,
      jobs: allJobs, workerCount: 4, simulationMs: 1 });
    const command = createStrategySearchMatrixCommandTiming({ manifest: held, workerCount: 4,
      commandWallMs: 2, batchTimingHashes: [timing.evidenceHash] });
    const artifactHashes: Record<string, string> = {
      'output/manifest.json': held.evidenceHash, 'output/p75.json': source.evidenceHash,
      [`output/timing/batch-${timing.batchIdentity}.json`]: timing.evidenceHash,
      [`output/commands/${command.evidenceHash}.json`]: command.evidenceHash
    };
    for (const chunk of chunks) {
      artifactHashes[`output/${strategySearchMatrixChunkPath(allJobs[chunk.slot]!)}`] = chunk.evidenceHash;
    }
    const marker = createCampaignStageControlMarker({ stage: 'matrix', stageId: held.stageId,
      status: 'complete', artifactHashes });
    expect(validateCampaignMatrixStage({ stageId: held.stageId, manifest: held, chunks,
      timings: [timing], commandTimings: [command], p75: source,
      fileHashes: artifactHashes, marker })).toBe(true);
    const corrupt = structuredClone(source); corrupt.centeredPayoffs[0]![1] = 0;
    expect(validateStrategySearchMatrixP75Source(reseal(corrupt), held, chunks)).toBe(false);
    const corruptChunks = [...p75Chunks];
    corruptChunks[0] = structuredClone(corruptChunks[0]!); corruptChunks[0]!.records[0]!.seed += 1;
    expect(validateStrategySearchMatrixP75Source(source, held, corruptChunks)).toBe(false);
  }, 30_000);
});
