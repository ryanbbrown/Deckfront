import { createHash } from 'node:crypto';
import { ORDERED_PRODUCT_SPACE_COUNT } from './orderedGoldfishProduct';
import { compareUtf16 } from './utf16';

export const STRATEGY_SEARCH_POLICY_VERSION = 'strategy-search-policy-v2' as const;
export const BOOTSTRAP_GOLDFISH_PROFILE = Object.freeze({
  cpus: 4, candidates: 150_000, elapsedMs: 41_800, minimumJobMs: 15_000, targetJobMs: 30_000,
  maximumJobMs: 60_000
});
export const GOLDFISH_STAGE_TWO_SEED_COUNT = 3;
export const MATRIX_CPU_PROFILE = Object.freeze({ minimum: 4, measuredUsefulMaximum: 4 });
export const PSRO_CPU_PROFILE = Object.freeze({ minimum: 4, measuredUsefulMaximum: 8 });
export type StrategySearchStage = 'goldfish-one' | 'goldfish-one-reduce' | 'goldfish-two'
  | 'goldfish-two-reduce' | 'matrix' | 'psro';
export interface CandidateRange { start: number; end: number }
export interface RuntimeJob {
  taskId: string; evidenceId: string; kingdomId: string; stage: StrategySearchStage;
  range: CandidateRange | null; cpus: number; status: 'blocked' | 'ready' | 'launching' | 'active'
    | 'retry-backoff' | 'complete' | 'terminal-incomplete';
  dependencyTaskIds: string[]; launchIntentId: string | null; callId: string | null;
  leaseUntilMs: number | null; attemptCount: number;
}
export interface StagePartition {
  policyVersion: typeof STRATEGY_SEARCH_POLICY_VERSION; evidenceId: string;
  stage: 'goldfish-one' | 'goldfish-two'; total: number; jobs: CandidateRange[];
  pinnedAtRevision: number; repartitions: Array<{ fromPosition: number; previousJobs: number; nextJobs: number }>;
}
export interface ThroughputObservation { candidates: number; elapsedMs: number; cpus: number }
export interface ExecutionPolicy {
  goldfishJobCpus: number; candidatesPerJob: number; expectedJobMs: number;
  goldfishStageTwoCpus: number; stageTwoCandidatesPerJob: number; expectedStageTwoJobMs: number;
  matrixCpus: number; psroCpus: number; capacityFloor: number; maxActiveGoldfishJobs: number;
  goldfishTimeoutSeconds: number; stageTwoTimeoutSeconds: number;
}
function positiveSafe(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
}
export function deriveExecutionPolicy(input: { maxActiveCpus: number; remainingCandidates?: number;
  throughput?: readonly ThroughputObservation[]; modalAdmissionLimitCpus?: number }): ExecutionPolicy {
  positiveSafe(input.maxActiveCpus, 'maxActiveCpus');
  const floor = Math.max(BOOTSTRAP_GOLDFISH_PROFILE.cpus, MATRIX_CPU_PROFILE.minimum,
    PSRO_CPU_PROFILE.minimum);
  if (input.maxActiveCpus < floor) throw new Error(`maxActiveCpus must be at least ${floor} to fit every whole-stage shape.`);
  const observations = (input.throughput ?? []).filter((entry) => entry.candidates > 0 && entry.elapsedMs > 0
    && entry.cpus > 0);
  const candidatesPerCpuMs = observations.length
    ? observations.reduce((sum, entry) => sum + entry.candidates / entry.elapsedMs / entry.cpus, 0)
      / observations.length
    : BOOTSTRAP_GOLDFISH_PROFILE.candidates / BOOTSTRAP_GOLDFISH_PROFILE.elapsedMs
      / BOOTSTRAP_GOLDFISH_PROFILE.cpus;
  const cpus = BOOTSTRAP_GOLDFISH_PROFILE.cpus;
  const minimum = Math.ceil(candidatesPerCpuMs * cpus * BOOTSTRAP_GOLDFISH_PROFILE.minimumJobMs);
  const maximum = Math.floor(candidatesPerCpuMs * cpus * BOOTSTRAP_GOLDFISH_PROFILE.maximumJobMs);
  const target = Math.round(candidatesPerCpuMs * cpus * BOOTSTRAP_GOLDFISH_PROFILE.targetJobMs);
  const admittedCpus = Math.min(input.maxActiveCpus, input.modalAdmissionLimitCpus ?? input.maxActiveCpus);
  const usefulSlots = Math.max(1, Math.floor(admittedCpus / cpus));
  const remaining = input.remainingCandidates ?? ORDERED_PRODUCT_SPACE_COUNT;
  positiveSafe(remaining, 'remainingCandidates');
  const exposeParallelism = Math.ceil(remaining / Math.max(usefulSlots * 2, 1));
  const candidatesPerJob = Math.max(1, Math.min(maximum, Math.max(minimum, Math.min(target, exposeParallelism))));
  const stageTwoCpus = cpus;
  const stageTwoWorkRate = candidatesPerCpuMs * stageTwoCpus / GOLDFISH_STAGE_TWO_SEED_COUNT;
  const stageTwoMinimum = Math.ceil(stageTwoWorkRate * BOOTSTRAP_GOLDFISH_PROFILE.minimumJobMs);
  const stageTwoMaximum = Math.floor(stageTwoWorkRate * BOOTSTRAP_GOLDFISH_PROFILE.maximumJobMs);
  const stageTwoTarget = Math.round(stageTwoWorkRate * BOOTSTRAP_GOLDFISH_PROFILE.targetJobMs);
  const stageTwoSlots = Math.max(1, Math.floor(admittedCpus / stageTwoCpus));
  const stageTwoExposeParallelism = Math.ceil(500_000 / Math.max(stageTwoSlots * 2, 1));
  const stageTwoCandidatesPerJob = Math.max(1, Math.min(stageTwoMaximum,
    Math.max(stageTwoMinimum, Math.min(stageTwoTarget, stageTwoExposeParallelism))));
  const expectedStageTwoJobMs = stageTwoCandidatesPerJob / stageTwoWorkRate;
  const expectedJobMs = candidatesPerJob / (candidatesPerCpuMs * cpus);
  const timeout = (expectedMs: number): number => Math.ceil((expectedMs * 2 + 30_000) / 1000);
  return { goldfishJobCpus: cpus, candidatesPerJob, expectedJobMs,
    goldfishStageTwoCpus: stageTwoCpus, stageTwoCandidatesPerJob, expectedStageTwoJobMs,
    matrixCpus: Math.min(input.maxActiveCpus, MATRIX_CPU_PROFILE.measuredUsefulMaximum),
    psroCpus: Math.min(input.maxActiveCpus, PSRO_CPU_PROFILE.measuredUsefulMaximum), capacityFloor: floor,
    maxActiveGoldfishJobs: Math.floor(admittedCpus / cpus), goldfishTimeoutSeconds: timeout(expectedJobMs),
    stageTwoTimeoutSeconds: timeout(expectedStageTwoJobMs) };
}
export function createStagePartition(input: { evidenceId: string; stage: 'goldfish-one' | 'goldfish-two';
  total: number; candidatesPerJob: number; revision?: number }): StagePartition {
  if (!/^[0-9a-f]{64}$/.test(input.evidenceId)) throw new Error('Partition evidence ID is invalid.');
  positiveSafe(input.total, 'partition total'); positiveSafe(input.candidatesPerJob, 'partition job size');
  const jobs: CandidateRange[] = [];
  for (let start = 0; start < input.total; start += input.candidatesPerJob) {
    jobs.push({ start, end: Math.min(start + input.candidatesPerJob, input.total) });
  }
  return { policyVersion: STRATEGY_SEARCH_POLICY_VERSION, evidenceId: input.evidenceId, stage: input.stage,
    total: input.total, jobs, pinnedAtRevision: input.revision ?? 0, repartitions: [] };
}
export function validateStagePartition(value: StagePartition): boolean {
  return value.policyVersion === STRATEGY_SEARCH_POLICY_VERSION && /^[0-9a-f]{64}$/.test(value.evidenceId)
    && Number.isSafeInteger(value.total) && value.total > 0 && value.jobs.length > 0
    && value.jobs.every((range, index) => Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end)
      && range.start === (index ? value.jobs[index - 1]!.end : 0) && range.end > range.start
      && range.end <= value.total) && value.jobs.at(-1)!.end === value.total;
}
export function repartitionUnlaunchedSuffix(partition: StagePartition, input: {
  fromPosition: number; candidatesPerJob: number; touchedRanges: readonly CandidateRange[] }): StagePartition {
  if (!validateStagePartition(partition)) throw new Error('Pinned stage partition is invalid.');
  positiveSafe(input.candidatesPerJob, 'partition job size');
  const prefix = partition.jobs.filter((range) => range.end <= input.fromPosition);
  if ((prefix.at(-1)?.end ?? 0) !== input.fromPosition
    || partition.jobs.some((range) => range.start < input.fromPosition && range.end > input.fromPosition)
    || input.touchedRanges.some((range) => range.start >= input.fromPosition)) {
    throw new Error('Only an untouched contiguous suffix can be repartitioned.');
  }
  const suffix = createStagePartition({ evidenceId: partition.evidenceId, stage: partition.stage,
    total: partition.total - input.fromPosition, candidatesPerJob: input.candidatesPerJob }).jobs
    .map((range) => ({ start: range.start + input.fromPosition, end: range.end + input.fromPosition }));
  return { ...structuredClone(partition), jobs: [...prefix, ...suffix], repartitions: [...partition.repartitions,
    { fromPosition: input.fromPosition, previousJobs: partition.jobs.length - prefix.length,
      nextJobs: suffix.length }] };
}

function stagePriority(stage: StrategySearchStage): number {
  if (stage === 'psro') return 0;
  if (stage === 'matrix') return 1;
  if (stage.endsWith('reduce')) return 2;
  return 3;
}
function roundRobinReady(jobs: readonly RuntimeJob[]): RuntimeJob[] {
  const stages = new Map<number, Map<string, RuntimeJob[]>>();
  for (const job of jobs) {
    const kingdoms = stages.get(stagePriority(job.stage)) ?? new Map<string, RuntimeJob[]>();
    const held = kingdoms.get(job.kingdomId) ?? [];
    held.push(job); kingdoms.set(job.kingdomId, held); stages.set(stagePriority(job.stage), kingdoms);
  }
  const ordered: RuntimeJob[] = [];
  for (const priority of [...stages.keys()].sort((left, right) => left - right)) {
    const kingdoms = stages.get(priority)!;
    const ids = [...kingdoms.keys()].sort(compareUtf16);
    for (const jobsForKingdom of kingdoms.values()) jobsForKingdom.sort((left, right) =>
      compareUtf16(left.taskId, right.taskId));
    for (let index = 0; ids.some((id) => index < kingdoms.get(id)!.length); index += 1) {
      for (const id of ids) { const job = kingdoms.get(id)![index]; if (job) ordered.push(job); }
    }
  }
  return ordered;
}
export interface SchedulerPlan { launches: RuntimeJob[]; allocatedCpus: number; unusedCpus: number;
  unusedReason: UtilizationReason | null }
export type UtilizationReason = 'modal-workspace-rejection' | 'modal-queue-delay' | 'failure-or-retry-backoff'
  | 'reserved-ready-downstream' | 'minimum-useful-job-size' | 'insufficient-ready-work' | 'final-tail';
export function planRuntimeTick(input: { jobs: readonly RuntimeJob[]; maxActiveCpus: number;
  modalWorkspaceRejected?: boolean; finalTail?: boolean }): SchedulerPlan {
  positiveSafe(input.maxActiveCpus, 'maxActiveCpus');
  const active = input.jobs.filter((job) => job.status === 'launching' || job.status === 'active');
  let allocatedCpus = active.reduce((sum, job) => sum + job.cpus, 0);
  if (allocatedCpus > input.maxActiveCpus) throw new Error('Active jobs exceed maxActiveCpus.');
  const ready = roundRobinReady(input.jobs.filter((job) => job.status === 'ready'));
  const launches: RuntimeJob[] = [];
  let reservedDownstream = false;
  const firstGoldfish = ready.find((job) => job.stage === 'goldfish-one' || job.stage === 'goldfish-two');
  const first = ready[0];
  const launchOrder = firstGoldfish && first && firstGoldfish !== first
    && allocatedCpus + first.cpus + firstGoldfish.cpus <= input.maxActiveCpus
    ? [first, firstGoldfish, ...ready.filter((job) => job !== first && job !== firstGoldfish)] : ready;
  for (const job of launchOrder) {
    if (job.cpus > input.maxActiveCpus) throw new Error(`maxActiveCpus cannot fit ${job.stage}; requires ${job.cpus}.`);
    if (allocatedCpus + job.cpus > input.maxActiveCpus) {
      if (job.stage === 'matrix' || job.stage === 'psro') reservedDownstream = true;
      continue;
    }
    launches.push(structuredClone(job)); allocatedCpus += job.cpus;
  }
  const unusedCpus = input.maxActiveCpus - allocatedCpus;
  let unusedReason: UtilizationReason | null = null;
  if (unusedCpus) {
    if (input.modalWorkspaceRejected) unusedReason = 'modal-workspace-rejection';
    else if (input.jobs.some((job) => job.status === 'retry-backoff')) unusedReason = 'failure-or-retry-backoff';
    else if (reservedDownstream) unusedReason = 'reserved-ready-downstream';
    else if (ready.some((job) => job.cpus > unusedCpus)) unusedReason = 'minimum-useful-job-size';
    else if (input.finalTail) unusedReason = 'final-tail';
    else unusedReason = 'insufficient-ready-work';
  }
  return { launches, allocatedCpus, unusedCpus, unusedReason };
}
export interface UtilizationInterval { startMs: number; endMs: number; allocatedCpus: number;
  unusedCpus: number; reason: UtilizationReason | null }
export interface UtilizationSummary { wallMs: number; allocatedCpuSeconds: number; unusedCpuSeconds: number;
  unusedCpuSecondsByReason: Record<UtilizationReason, number>; averageActiveCpus: number; peakActiveCpus: number }
export function summarizeUtilization(intervals: readonly UtilizationInterval[], maxActiveCpus: number): UtilizationSummary {
  positiveSafe(maxActiveCpus, 'maxActiveCpus');
  const byReason = Object.fromEntries((['modal-workspace-rejection', 'modal-queue-delay', 'failure-or-retry-backoff',
    'reserved-ready-downstream', 'minimum-useful-job-size', 'insufficient-ready-work', 'final-tail'] as const)
    .map((reason) => [reason, 0])) as Record<UtilizationReason, number>;
  let wallMs = 0, allocatedCpuMs = 0, unusedCpuMs = 0, peakActiveCpus = 0;
  for (const interval of intervals) {
    const duration = interval.endMs - interval.startMs;
    if (!Number.isSafeInteger(duration) || duration < 0 || interval.allocatedCpus + interval.unusedCpus !== maxActiveCpus
      || interval.allocatedCpus < 0 || interval.unusedCpus < 0
      || (interval.unusedCpus === 0) !== (interval.reason === null)) {
      throw new Error('CPU utilization interval violates exact accounting.');
    }
    wallMs += duration; allocatedCpuMs += duration * interval.allocatedCpus;
    unusedCpuMs += duration * interval.unusedCpus; peakActiveCpus = Math.max(peakActiveCpus, interval.allocatedCpus);
    if (interval.reason) byReason[interval.reason] += duration * interval.unusedCpus / 1000;
  }
  return { wallMs, allocatedCpuSeconds: allocatedCpuMs / 1000, unusedCpuSeconds: unusedCpuMs / 1000,
    unusedCpuSecondsByReason: byReason, averageActiveCpus: wallMs ? allocatedCpuMs / wallMs : 0,
    peakActiveCpus };
}

export interface WorkerAttemptInterval { submittedMs: number; workerStartedMs?: number; workerFinishedMs?: number;
  cpus: number }
export function deriveRunningCpuIntervals(input: { attempts: readonly WorkerAttemptInterval[];
  submitted: readonly UtilizationInterval[]; startMs: number; endMs: number; maxActiveCpus: number }): UtilizationInterval[] {
  positiveSafe(input.maxActiveCpus, 'maxActiveCpus');
  const events = new Map<number, number>();
  for (const attempt of input.attempts) {
    if (attempt.workerStartedMs === undefined || attempt.workerFinishedMs === undefined) continue;
    if (!Number.isSafeInteger(attempt.workerStartedMs) || !Number.isSafeInteger(attempt.workerFinishedMs)
      || attempt.workerFinishedMs < attempt.workerStartedMs || !Number.isSafeInteger(attempt.cpus) || attempt.cpus < 1) {
      throw new Error('Worker attempt interval is invalid.');
    }
    events.set(attempt.workerStartedMs, (events.get(attempt.workerStartedMs) ?? 0) + attempt.cpus);
    events.set(attempt.workerFinishedMs, (events.get(attempt.workerFinishedMs) ?? 0) - attempt.cpus);
  }
  const times = [...new Set([input.startMs, input.endMs, ...events.keys()])].sort((left, right) => left - right);
  let running = 0; const intervals: UtilizationInterval[] = [];
  for (let index = 0; index < times.length - 1; index += 1) {
    const startMs = times[index]!, endMs = times[index + 1]!; running += events.get(startMs) ?? 0;
    if (endMs <= startMs) continue;
    const submitted = input.submitted.find((entry) => entry.startMs <= startMs && startMs < entry.endMs);
    const reason: UtilizationReason | null = running === input.maxActiveCpus ? null
      : submitted && submitted.allocatedCpus > running ? 'modal-queue-delay'
        : submitted?.reason ?? 'insufficient-ready-work';
    intervals.push({ startMs, endMs, allocatedCpus: running,
      unusedCpus: input.maxActiveCpus - running, reason });
  }
  return intervals;
}

export interface MonotonicPhases {
  generationMs: number; scoringMs: number; intermediateSerializationAndReadMs: number;
  temporaryVolumeWriteCommitMs: number; publisherWaitMs: number; publicationCommitMs: number;
  reductionComputeMs: number; finalTop500000WriteMs: number; finalTop20000WriteMs: number;
  orchestrationQueueMs: number; elapsedMs: number;
}
const PHASE_KEYS: Array<keyof Omit<MonotonicPhases, 'elapsedMs'>> = ['generationMs', 'scoringMs',
  'intermediateSerializationAndReadMs', 'temporaryVolumeWriteCommitMs', 'publisherWaitMs',
  'publicationCommitMs', 'reductionComputeMs', 'finalTop500000WriteMs', 'finalTop20000WriteMs',
  'orchestrationQueueMs'];
export function validateMonotonicPhases(phases: MonotonicPhases): boolean {
  if (PHASE_KEYS.some((key) => !Number.isFinite(phases[key]) || phases[key] < 0)
    || !Number.isFinite(phases.elapsedMs) || phases.elapsedMs < 0) return false;
  const sum = PHASE_KEYS.reduce((total, key) => total + phases[key], 0);
  return phases.elapsedMs === 0 ? sum === 0 : Math.abs(sum - phases.elapsedMs) / phases.elapsedMs <= 0.01;
}
export function goldfishIoRatio(phases: readonly MonotonicPhases[]): number {
  if (!phases.every(validateMonotonicPhases)) throw new Error('Goldfish phase accounting is invalid.');
  const io = phases.reduce((sum, value) => sum + value.intermediateSerializationAndReadMs
    + value.temporaryVolumeWriteCommitMs + value.publicationCommitMs, 0);
  const denominator = phases.reduce((sum, value) => sum + value.generationMs + value.scoringMs
    + value.intermediateSerializationAndReadMs + value.temporaryVolumeWriteCommitMs
    + value.publicationCommitMs + value.reductionComputeMs, 0);
  return denominator ? io / denominator : 0;
}

export interface TaskLease { taskId: string; evidenceId: string; ownerId: string; fence: number;
  leaseUntilMs: number; heartbeatMs: number }
export interface LaunchIntent { taskId: string; evidenceId: string; launchId: string; fence: number;
  temporaryPath: string; temporarySha256: string; intendedPath: string }
export interface PublicationReceipt { taskId: string; evidenceId: string; artifactPath: string;
  sha256: string; fence: number }
export interface PublicationState { controllerFence: number; leases: Record<string, TaskLease>;
  intents: Record<string, LaunchIntent>; artifacts: Record<string, string>; receipts: Record<string, PublicationReceipt> }
export function claimTaskLease(state: PublicationState, input: { taskId: string; evidenceId: string;
  ownerId: string; nowMs: number; leaseMs: number }): PublicationState {
  const existing = state.leases[input.taskId];
  if (existing && existing.leaseUntilMs > input.nowMs && existing.ownerId !== input.ownerId) {
    throw new Error('Scientific task lease is active.');
  }
  const fence = (existing?.fence ?? 0) + 1, next = structuredClone(state);
  next.leases[input.taskId] = { taskId: input.taskId, evidenceId: input.evidenceId,
    ownerId: input.ownerId, fence, heartbeatMs: input.nowMs, leaseUntilMs: input.nowMs + input.leaseMs };
  return next;
}
export function heartbeatTaskLease(state: PublicationState, input: { taskId: string; ownerId: string;
  fence: number; nowMs: number; leaseMs: number }): PublicationState {
  const lease = state.leases[input.taskId];
  if (!lease || lease.ownerId !== input.ownerId || lease.fence !== input.fence || lease.leaseUntilMs <= input.nowMs) {
    throw new Error('Scientific task heartbeat is stale or expired.');
  }
  const next = structuredClone(state); next.leases[input.taskId] = { ...lease, heartbeatMs: input.nowMs,
    leaseUntilMs: input.nowMs + input.leaseMs }; return next;
}
export function bindLaunchIntent(state: PublicationState, intent: LaunchIntent): PublicationState {
  const lease = state.leases[intent.taskId];
  if (!lease || lease.evidenceId !== intent.evidenceId || lease.fence !== intent.fence
    || !/^[0-9a-f]{64}$/.test(intent.temporarySha256) || !intent.launchId
    || state.intents[intent.taskId]) throw new Error('Launch intent is stale, duplicate, or unleased.');
  const next = structuredClone(state); next.intents[intent.taskId] = structuredClone(intent); return next;
}
export function publishTaskBatch(state: PublicationState, input: { controllerFence: number; nowMs: number;
  temporaryHashes: Readonly<Record<string, string>>; taskIds: readonly string[] }): PublicationState {
  if (input.controllerFence !== state.controllerFence) throw new Error('Artifact publisher is fenced out.');
  const next = structuredClone(state), intended = new Set<string>();
  for (const taskId of input.taskIds) {
    const intent = state.intents[taskId], lease = state.leases[taskId], receipt = state.receipts[taskId];
    if (!intent || !lease || lease.fence !== intent.fence || lease.leaseUntilMs <= input.nowMs
      || input.temporaryHashes[intent.temporaryPath] !== intent.temporarySha256
      || intended.has(intent.intendedPath)) throw new Error('Publication validation failed.');
    intended.add(intent.intendedPath);
    const existing = state.artifacts[intent.intendedPath];
    if (receipt && (!existing || existing !== receipt.sha256)) throw new Error('Receipt and artifact differ.');
    if (existing && existing !== intent.temporarySha256) throw new Error('Conflicting deterministic artifact bytes.');
    if (receipt && receipt.sha256 !== intent.temporarySha256) throw new Error('Conflicting publication receipt.');
  }
  for (const taskId of input.taskIds) {
    const intent = state.intents[taskId]!;
    next.artifacts[intent.intendedPath] = intent.temporarySha256;
    next.receipts[taskId] = { taskId, evidenceId: intent.evidenceId,
      artifactPath: intent.intendedPath, sha256: intent.temporarySha256, fence: intent.fence };
  }
  return next;
}
export function taskIdentity(evidenceId: string, stage: StrategySearchStage, range: CandidateRange | null): string {
  return createHash('sha256').update(JSON.stringify({ evidenceId, stage, range })).digest('hex');
}
