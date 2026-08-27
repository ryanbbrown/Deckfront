import { describe, expect, it } from 'vitest';
import {
  bindLaunchIntent, claimTaskLease, createStagePartition, deriveExecutionPolicy, deriveRunningCpuIntervals,
  goldfishIoRatio, heartbeatTaskLease, planRuntimeTick, publishTaskBatch, repartitionUnlaunchedSuffix,
  summarizeUtilization, validateMonotonicPhases
} from '../../src/sim/strategySearchScheduler';
import type { PublicationState, RuntimeJob } from '../../src/sim/strategySearchScheduler';

function job(input: Partial<RuntimeJob> & Pick<RuntimeJob, 'taskId' | 'kingdomId' | 'evidenceId' | 'stage'>): RuntimeJob {
  return { taskId: input.taskId, kingdomId: input.kingdomId, evidenceId: input.evidenceId,
    stage: input.stage, range: input.range ?? null, cpus: input.cpus ?? 4, status: input.status ?? 'ready',
    dependencyTaskIds: input.dependencyTaskIds ?? [], launchIntentId: null, callId: null,
    leaseUntilMs: null, attemptCount: input.attemptCount ?? 0 };
}
const evidenceId = 'a'.repeat(64);
describe('scalable strategy-search execution policy', () => {
  it('derives useful 15-to-60-second jobs and a precise capacity floor', () => {
    const policy = deriveExecutionPolicy({ maxActiveCpus: 400 });
    expect(policy).toMatchObject({ goldfishJobCpus: 4, goldfishStageTwoCpus: 4,
      matrixCpus: 4, psroCpus: 8, capacityFloor: 4, maxActiveGoldfishJobs: 100 });
    expect(policy.stageTwoCandidatesPerJob).toBeLessThanOrEqual(60_000);
    expect(policy.stageTwoCandidatesPerJob).toBeGreaterThan(10_000);
    expect(policy.expectedJobMs).toBeGreaterThanOrEqual(15_000);
    expect(policy.expectedJobMs).toBeLessThanOrEqual(60_000);
    expect(policy.expectedStageTwoJobMs).toBeGreaterThanOrEqual(15_000);
    expect(policy.expectedStageTwoJobMs).toBeLessThanOrEqual(60_000);
    expect(() => deriveExecutionPolicy({ maxActiveCpus: 3 })).toThrow('at least 4');
  });

  it('pins a complete partition and changes only an untouched suffix', () => {
    const partition = createStagePartition({ evidenceId, stage: 'goldfish-one', total: 1_000,
      candidatesPerJob: 300 });
    expect(partition.jobs).toEqual([{ start: 0, end: 300 }, { start: 300, end: 600 },
      { start: 600, end: 900 }, { start: 900, end: 1_000 }]);
    const changed = repartitionUnlaunchedSuffix(partition, { fromPosition: 600, candidatesPerJob: 100,
      touchedRanges: [{ start: 0, end: 300 }] });
    expect(changed.jobs.slice(0, 2)).toEqual(partition.jobs.slice(0, 2));
    expect(changed.jobs.slice(2)).toHaveLength(4);
    expect(() => repartitionUnlaunchedSuffix(partition, { fromPosition: 600, candidatesPerJob: 100,
      touchedRanges: [{ start: 600, end: 900 }] })).toThrow('untouched');
  });

  it('globally prioritizes ready downstream work and accounts for every CPU', () => {
    const jobs = [job({ taskId: 'g1', kingdomId: 'k1', evidenceId, stage: 'goldfish-one' }),
      job({ taskId: 'g2', kingdomId: 'k2', evidenceId, stage: 'goldfish-one' }),
      job({ taskId: 'm', kingdomId: 'k3', evidenceId, stage: 'matrix' }),
      job({ taskId: 'p', kingdomId: 'k4', evidenceId, stage: 'psro' })];
    const plan = planRuntimeTick({ jobs, maxActiveCpus: 12 });
    expect(plan.launches.map((entry) => entry.taskId)).toEqual(['p', 'g1', 'm']);
    expect(plan.allocatedCpus + plan.unusedCpus).toBe(12);
    const rejected = planRuntimeTick({ jobs: [jobs[0]!], maxActiveCpus: 10, modalWorkspaceRejected: true });
    expect(rejected).toMatchObject({ allocatedCpus: 4, unusedCpus: 6,
      unusedReason: 'modal-workspace-rejection' });
  });

  it('round-robins kingdoms and guarantees bounded Goldfish admission behind downstream priority', () => {
    const jobs = Array.from({ length: 4 }, (_unused, index) => job({ taskId: `a${index}`,
      kingdomId: 'a', evidenceId, stage: 'goldfish-one' })).concat(Array.from({ length: 4 }, (_unused, index) =>
      job({ taskId: `b${index}`, kingdomId: 'b', evidenceId, stage: 'goldfish-one' })));
    expect(planRuntimeTick({ jobs, maxActiveCpus: 16 }).launches.map((entry) => entry.kingdomId))
      .toEqual(['a', 'b', 'a', 'b']);
    const downstream = Array.from({ length: 4 }, (_unused, index) => job({ taskId: `p${index}`,
      kingdomId: `k${index}`, evidenceId, stage: 'psro' }));
    const plan = planRuntimeTick({ jobs: [...downstream, jobs[0]!], maxActiveCpus: 12 });
    expect(plan.launches[0]!.stage).toBe('psro');
    expect(plan.launches.some((entry) => entry.stage === 'goldfish-one')).toBe(true);
  });

  it('reports exact utilization reasons and nonoverlapping phase accounting', () => {
    const summary = summarizeUtilization([{ startMs: 0, endMs: 1_000, allocatedCpus: 8,
      unusedCpus: 2, reason: 'insufficient-ready-work' }, { startMs: 1_000, endMs: 2_000,
      allocatedCpus: 10, unusedCpus: 0, reason: null }], 10);
    expect(summary).toMatchObject({ wallMs: 2_000, allocatedCpuSeconds: 18, unusedCpuSeconds: 2,
      averageActiveCpus: 9, peakActiveCpus: 10 });
    const phases = { generationMs: 10, scoringMs: 80, intermediateSerializationAndReadMs: 1,
      temporaryVolumeWriteCommitMs: 1, publisherWaitMs: 1, publicationCommitMs: 1,
      reductionComputeMs: 4, finalTop500000WriteMs: 0, finalTop20000WriteMs: 0,
      orchestrationQueueMs: 2, elapsedMs: 100 };
    expect(validateMonotonicPhases(phases)).toBe(true);
    expect(goldfishIoRatio([phases])).toBeLessThan(0.05);
    expect(validateMonotonicPhases({ ...phases, elapsedMs: 90 })).toBe(false);
  });

  it('reports running CPU from worker events and submitted CPU separately', () => {
    const submitted = [{ startMs: 0, endMs: 100, allocatedCpus: 8, unusedCpus: 0, reason: null }];
    const running = deriveRunningCpuIntervals({ startMs: 0, endMs: 100, maxActiveCpus: 8, submitted,
      attempts: [{ submittedMs: 0, workerStartedMs: 20, workerFinishedMs: 80, cpus: 4 },
        { submittedMs: 0, workerStartedMs: 40, workerFinishedMs: 90, cpus: 4 }] });
    expect(running).toEqual([
      { startMs: 0, endMs: 20, allocatedCpus: 0, unusedCpus: 8, reason: 'modal-queue-delay' },
      { startMs: 20, endMs: 40, allocatedCpus: 4, unusedCpus: 4, reason: 'modal-queue-delay' },
      { startMs: 40, endMs: 80, allocatedCpus: 8, unusedCpus: 0, reason: null },
      { startMs: 80, endMs: 90, allocatedCpus: 4, unusedCpus: 4, reason: 'modal-queue-delay' },
      { startMs: 90, endMs: 100, allocatedCpus: 0, unusedCpus: 8, reason: 'modal-queue-delay' }
    ]);
    expect(summarizeUtilization(running, 8).allocatedCpuSeconds).toBe(0.44);
  });
});

describe('task leases and exactly-once publication', () => {
  function state(): PublicationState { return { controllerFence: 3, leases: {}, intents: {}, artifacts: {}, receipts: {} }; }
  function prepared() { let held = claimTaskLease(state(), { taskId: 'task', evidenceId, ownerId: 'one', nowMs: 0, leaseMs: 100 });
    held = bindLaunchIntent(held, { taskId: 'task', evidenceId, launchId: 'launch', fence: 1,
      temporaryPath: 'temporary/launch', temporarySha256: 'b'.repeat(64), intendedPath: 'evidence/task' });
    return held; }

  it('publishes identical bytes once and rejects conflicting bytes and stale publishers', () => {
    const held = prepared(), published = publishTaskBatch(held, { controllerFence: 3, nowMs: 1,
      temporaryHashes: { 'temporary/launch': 'b'.repeat(64) }, taskIds: ['task'] });
    expect(published.receipts.task).toMatchObject({ sha256: 'b'.repeat(64), artifactPath: 'evidence/task' });
    expect(publishTaskBatch(published, { controllerFence: 3, nowMs: 2,
      temporaryHashes: { 'temporary/launch': 'b'.repeat(64) }, taskIds: ['task'] })).toEqual(published);
    expect(() => publishTaskBatch(held, { controllerFence: 2, nowMs: 1,
      temporaryHashes: { 'temporary/launch': 'b'.repeat(64) }, taskIds: ['task'] })).toThrow('fenced');
    expect(() => publishTaskBatch(held, { controllerFence: 3, nowMs: 1,
      temporaryHashes: { 'temporary/launch': 'c'.repeat(64) }, taskIds: ['task'] })).toThrow('validation');
  });

  it('fails closed for artifact/receipt splits, takeover, and expired unbound intent', () => {
    const artifactWithoutReceipt = prepared(); artifactWithoutReceipt.artifacts['evidence/task'] = 'b'.repeat(64);
    expect(() => publishTaskBatch(artifactWithoutReceipt, { controllerFence: 3, nowMs: 1,
      temporaryHashes: { 'temporary/launch': 'b'.repeat(64) }, taskIds: ['task'] })).not.toThrow();
    const receiptWithoutArtifact = prepared(); receiptWithoutArtifact.receipts.task = { taskId: 'task', evidenceId,
      artifactPath: 'evidence/task', sha256: 'b'.repeat(64), fence: 1 };
    expect(() => publishTaskBatch(receiptWithoutArtifact, { controllerFence: 3, nowMs: 1,
      temporaryHashes: { 'temporary/launch': 'b'.repeat(64) }, taskIds: ['task'] })).toThrow('Receipt and artifact');
    expect(() => publishTaskBatch(prepared(), { controllerFence: 3, nowMs: 101,
      temporaryHashes: { 'temporary/launch': 'b'.repeat(64) }, taskIds: ['task'] })).toThrow('validation');
    const taken = claimTaskLease(prepared(), { taskId: 'task', evidenceId, ownerId: 'two', nowMs: 101, leaseMs: 100 });
    expect(taken.leases.task?.fence).toBe(2);
    expect(() => heartbeatTaskLease(taken, { taskId: 'task', ownerId: 'one', fence: 1,
      nowMs: 102, leaseMs: 100 })).toThrow('stale');
  });
});
