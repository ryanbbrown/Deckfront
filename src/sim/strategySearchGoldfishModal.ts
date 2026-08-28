import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  canonicalStrategySearchJson, campaignExecutionRoot, deriveStrategySearch, kingdomArtifactRoot
} from './strategySearchCampaign';
import type { KingdomEvidenceIdentity, SourceImageIdentity } from './strategySearchCampaign';
import {
  BOOTSTRAP_GOLDFISH_PROFILE, createStagePartition, GOLDFISH_STAGE_TWO_SEED_COUNT, taskIdentity
} from './strategySearchScheduler';
import type { CandidateRange, RuntimeJob, StagePartition } from './strategySearchScheduler';

export const GOLDFISH_MODAL_ROUTE = 'goldfish-only-v1' as const;
export const GOLDFISH_MODAL_CPU_USD_PER_CORE_SECOND = 0.0000131;
export const GOLDFISH_MODAL_MEMORY_USD_PER_GIB_SECOND = 0.00000222;
export const GOLDFISH_MODAL_HARD_COST_CAP_USD = 100;
export const GOLDFISH_MODAL_MAX_WORKER_CORES = 64;
export const GOLDFISH_MODAL_MIN_WALL_SECONDS = 300;
export const GOLDFISH_MODAL_MAX_WALL_SECONDS = 21_600;
export const GOLDFISH_MODAL_SCORE_MEMORY_MIB = 4096;
export const GOLDFISH_MODAL_REDUCE_MEMORY_MIB = 8192;
export const GOLDFISH_MODAL_SCORE_TIMEOUT_SECONDS = 180;
export const GOLDFISH_MODAL_REDUCE_ONE_TIMEOUT_SECONDS = 600;
export const GOLDFISH_MODAL_REDUCE_TWO_TIMEOUT_SECONDS = 300;
export const GOLDFISH_MODAL_ATTEMPTS = 3;
export const GOLDFISH_MODAL_REDUCER_CORES = 4;

const identifier = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const goldfishModalRequestSchema = z.object({
  kingdomIds: z.array(identifier).min(1),
  workerCores: z.number().int().safe().min(1).max(GOLDFISH_MODAL_MAX_WORKER_CORES),
  maxActiveCpus: z.number().int().safe().min(GOLDFISH_MODAL_REDUCER_CORES),
  maxWallSeconds: z.number().int().safe().min(GOLDFISH_MODAL_MIN_WALL_SECONDS)
    .max(GOLDFISH_MODAL_MAX_WALL_SECONDS),
  maxCostUsd: z.number().positive().finite().max(GOLDFISH_MODAL_HARD_COST_CAP_USD)
}).strict().superRefine((request, context) => {
  if (new Set(request.kingdomIds).size !== request.kingdomIds.length) {
    context.addIssue({ code: 'custom', path: ['kingdomIds'], message: 'Kingdom IDs must be unique.' });
  }
  if (request.workerCores > request.maxActiveCpus) {
    context.addIssue({ code: 'custom', path: ['workerCores'],
      message: 'workerCores cannot exceed maxActiveCpus.' });
  }
});
export type GoldfishModalRequest = z.infer<typeof goldfishModalRequestSchema>;

export function parseGoldfishModalRequest(value: unknown): GoldfishModalRequest {
  return goldfishModalRequestSchema.parse(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function candidatesPerScoreTask(workerCores: number, seedFactor: number): number {
  const candidatesPerCoreSecond = BOOTSTRAP_GOLDFISH_PROFILE.candidates
    / (BOOTSTRAP_GOLDFISH_PROFILE.elapsedMs / 1000) / BOOTSTRAP_GOLDFISH_PROFILE.cpus;
  return Math.max(1, Math.round(candidatesPerCoreSecond * workerCores
    * (BOOTSTRAP_GOLDFISH_PROFILE.targetJobMs / 1000) / seedFactor));
}

export interface GoldfishModalTaskCounts {
  scoreOne: number;
  reduceOne: number;
  scoreTwo: number;
  reduceTwo: number;
  total: number;
}

export interface GoldfishModalResourceShape {
  workerCoresPerContainer: number;
  maxActiveCpus: number;
  maxScoreContainers: number;
  maxScheduledScoreCpus: number;
  unusedCpuCapacity: number;
  scoreMemoryMiBPerContainer: typeof GOLDFISH_MODAL_SCORE_MEMORY_MIB;
  reducerCores: typeof GOLDFISH_MODAL_REDUCER_CORES;
  reducerMemoryMiB: typeof GOLDFISH_MODAL_REDUCE_MEMORY_MIB;
  maxConcurrentReducers: number;
}

export interface GoldfishModalCostGuard {
  cpuUsdPerCoreSecond: typeof GOLDFISH_MODAL_CPU_USD_PER_CORE_SECOND;
  memoryUsdPerGibSecond: typeof GOLDFISH_MODAL_MEMORY_USD_PER_GIB_SECOND;
  attemptCount: typeof GOLDFISH_MODAL_ATTEMPTS;
  hardMaximumCostUsd: typeof GOLDFISH_MODAL_HARD_COST_CAP_USD;
  requestedMaximumCostUsd: number;
  worstCaseModalComputeUsd: number;
  taskCounts: GoldfishModalTaskCounts;
}

export interface ParsedGoldfishModalRequest {
  request: GoldfishModalRequest;
  sourceImage: SourceImageIdentity;
  kingdoms: KingdomEvidenceIdentity[];
  partitions: Record<string, StagePartition>;
  taskCounts: GoldfishModalTaskCounts;
  resourceShape: GoldfishModalResourceShape;
  costGuard: GoldfishModalCostGuard;
  executionPlanHash: string;
  campaignExecutionId: string;
  authorizationToken: string;
  downloadRoot: string;
}

function resourceShape(request: GoldfishModalRequest): GoldfishModalResourceShape {
  const maxScoreContainers = Math.floor(request.maxActiveCpus / request.workerCores);
  const maxScheduledScoreCpus = maxScoreContainers * request.workerCores;
  const maxConcurrentReducers = Math.min(request.kingdomIds.length,
    Math.floor(request.maxActiveCpus / GOLDFISH_MODAL_REDUCER_CORES));
  return { workerCoresPerContainer: request.workerCores, maxActiveCpus: request.maxActiveCpus,
    maxScoreContainers, maxScheduledScoreCpus,
    unusedCpuCapacity: request.maxActiveCpus - maxScheduledScoreCpus,
    scoreMemoryMiBPerContainer: GOLDFISH_MODAL_SCORE_MEMORY_MIB,
    reducerCores: GOLDFISH_MODAL_REDUCER_CORES, reducerMemoryMiB: GOLDFISH_MODAL_REDUCE_MEMORY_MIB,
    maxConcurrentReducers };
}

function modalComputeCost(cpu: number, memoryMiB: number, seconds: number): number {
  return seconds * (cpu * GOLDFISH_MODAL_CPU_USD_PER_CORE_SECOND
    + memoryMiB / 1024 * GOLDFISH_MODAL_MEMORY_USD_PER_GIB_SECOND);
}

export function worstCaseGoldfishModalComputeUsd(input: {
  request: GoldfishModalRequest; taskCounts: GoldfishModalTaskCounts;
}): number {
  const scoreTasks = input.taskCounts.scoreOne + input.taskCounts.scoreTwo;
  const score = scoreTasks * GOLDFISH_MODAL_ATTEMPTS * modalComputeCost(input.request.workerCores,
    GOLDFISH_MODAL_SCORE_MEMORY_MIB, GOLDFISH_MODAL_SCORE_TIMEOUT_SECONDS + 30);
  const reduceOne = input.taskCounts.reduceOne * GOLDFISH_MODAL_ATTEMPTS
    * modalComputeCost(GOLDFISH_MODAL_REDUCER_CORES, GOLDFISH_MODAL_REDUCE_MEMORY_MIB,
      GOLDFISH_MODAL_REDUCE_ONE_TIMEOUT_SECONDS + 30);
  const reduceTwo = input.taskCounts.reduceTwo * GOLDFISH_MODAL_ATTEMPTS
    * modalComputeCost(GOLDFISH_MODAL_REDUCER_CORES, GOLDFISH_MODAL_REDUCE_MEMORY_MIB,
      GOLDFISH_MODAL_REDUCE_TWO_TIMEOUT_SECONDS + 30);
  const controller = modalComputeCost(1, 2048, input.request.maxWallSeconds + 60);
  const publisher = modalComputeCost(1, 8192, input.request.maxWallSeconds);
  const readiness = modalComputeCost(1, 2048, 180);
  const canary = modalComputeCost(1, 4096, 120);
  const boundedControl = modalComputeCost(0.25, 512, input.request.maxWallSeconds + 90);
  return Number((score + reduceOne + reduceTwo + controller + publisher
    + readiness + canary + boundedControl).toFixed(6));
}

function partitionsFor(kingdoms: readonly KingdomEvidenceIdentity[], workerCores: number): Record<string, StagePartition> {
  const onePerTask = candidatesPerScoreTask(workerCores, 1);
  const twoPerTask = candidatesPerScoreTask(workerCores, GOLDFISH_STAGE_TWO_SEED_COUNT);
  return Object.fromEntries(kingdoms.flatMap((kingdom) => {
    const one = createStagePartition({ evidenceId: kingdom.evidenceId, stage: 'goldfish-one',
      total: kingdom.goldfish.candidateCount, candidatesPerJob: onePerTask });
    const two = createStagePartition({ evidenceId: kingdom.evidenceId, stage: 'goldfish-two',
      total: kingdom.goldfish.retainedCount, candidatesPerJob: twoPerTask });
    return [[`${kingdom.evidenceId}:goldfish-one`, one], [`${kingdom.evidenceId}:goldfish-two`, two]];
  }));
}

function countTasks(partitions: Readonly<Record<string, StagePartition>>, kingdomCount: number): GoldfishModalTaskCounts {
  const scoreOne = Object.values(partitions).filter((entry) => entry.stage === 'goldfish-one')
    .reduce((sum, entry) => sum + entry.jobs.length, 0);
  const scoreTwo = Object.values(partitions).filter((entry) => entry.stage === 'goldfish-two')
    .reduce((sum, entry) => sum + entry.jobs.length, 0);
  return { scoreOne, reduceOne: kingdomCount, scoreTwo, reduceTwo: kingdomCount,
    total: scoreOne + scoreTwo + kingdomCount * 2 };
}

export function deriveGoldfishModalRequest(input: {
  request: unknown; sourceImage: SourceImageIdentity;
}): ParsedGoldfishModalRequest {
  const request = parseGoldfishModalRequest(input.request);
  const scientific = deriveStrategySearch({ request: {
    kingdomIds: request.kingdomIds, maxActiveCpus: request.maxActiveCpus
  }, sourceImage: input.sourceImage });
  const partitions = partitionsFor(scientific.kingdoms, request.workerCores);
  const taskCounts = countTasks(partitions, scientific.kingdoms.length);
  const shape = resourceShape(request);
  const worstCaseModalComputeUsd = worstCaseGoldfishModalComputeUsd({ request, taskCounts });
  if (worstCaseModalComputeUsd > request.maxCostUsd) {
    throw new Error(`Worst-case Modal compute cost $${worstCaseModalComputeUsd.toFixed(6)} exceeds request limit $${request.maxCostUsd.toFixed(6)}.`);
  }
  const costGuard: GoldfishModalCostGuard = {
    cpuUsdPerCoreSecond: GOLDFISH_MODAL_CPU_USD_PER_CORE_SECOND,
    memoryUsdPerGibSecond: GOLDFISH_MODAL_MEMORY_USD_PER_GIB_SECOND,
    attemptCount: GOLDFISH_MODAL_ATTEMPTS,
    hardMaximumCostUsd: GOLDFISH_MODAL_HARD_COST_CAP_USD,
    requestedMaximumCostUsd: request.maxCostUsd,
    worstCaseModalComputeUsd, taskCounts
  };
  const executionPlan = { route: GOLDFISH_MODAL_ROUTE, request,
    deploymentDigest: input.sourceImage.digest,
    orderedEvidenceIds: scientific.kingdoms.map((entry) => entry.evidenceId),
    partitions, resourceShape: shape, costGuard };
  const executionPlanHash = sha256(canonicalStrategySearchJson(executionPlan));
  const campaignExecutionId = sha256(canonicalStrategySearchJson({
    route: GOLDFISH_MODAL_ROUTE, executionPlanHash
  }));
  const authorizationToken = `${GOLDFISH_MODAL_ROUTE}.${sha256(canonicalStrategySearchJson({
    request, sourceDigest: input.sourceImage.digest,
    orderedEvidenceIds: scientific.kingdoms.map((entry) => entry.evidenceId),
    campaignExecutionId, executionPlanHash, costGuard
  }))}`;
  return { request, sourceImage: structuredClone(input.sourceImage), kingdoms: scientific.kingdoms,
    partitions, taskCounts, resourceShape: shape, costGuard, executionPlanHash,
    campaignExecutionId, authorizationToken,
    downloadRoot: `.data/strategy-search-goldfish/${campaignExecutionId}` };
}

export function validateGoldfishModalAuthorizationToken(token: string,
  parsed: ParsedGoldfishModalRequest): boolean {
  const left = Buffer.from(token), right = Buffer.from(parsed.authorizationToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface GoldfishModalTaskConfiguration {
  taskId: string;
  kingdomId: string;
  evidenceId: string;
  stage: RuntimeJob['stage'];
  range: CandidateRange | null;
  cpu: number;
  memoryMiB: number;
  timeoutSeconds: number;
  dependencyTaskIds: string[];
  artifactPath: string;
}

export interface GoldfishModalLaunchBundle {
  schemaVersion: 3;
  campaignExecutionId: string;
  executionRoot: string;
  request: GoldfishModalRequest;
  sourceImage: SourceImageIdentity;
  partitions: Record<string, StagePartition>;
  jobs: RuntimeJob[];
  tasks: GoldfishModalTaskConfiguration[];
  controller: {
    route: typeof GOLDFISH_MODAL_ROUTE;
    maxActiveCpus: number;
    timeoutSeconds: number;
    maxWallSeconds: number;
    pollIntervalSeconds: 1;
    volumeName: 'hexdeck-native-strategy-results';
    readyWindowWaves: 2;
    maxReducerMemoryMiB: number;
    goldfishWorkerCores: number;
    goldfishScoreMemoryMiB: typeof GOLDFISH_MODAL_SCORE_MEMORY_MIB;
    goldfishScoreTimeoutSeconds: typeof GOLDFISH_MODAL_SCORE_TIMEOUT_SECONDS;
    goldfishReducerCores: typeof GOLDFISH_MODAL_REDUCER_CORES;
    goldfishReduceMemoryMiB: typeof GOLDFISH_MODAL_REDUCE_MEMORY_MIB;
    goldfishReduceOneTimeoutSeconds: typeof GOLDFISH_MODAL_REDUCE_ONE_TIMEOUT_SECONDS;
    goldfishReduceTwoTimeoutSeconds: typeof GOLDFISH_MODAL_REDUCE_TWO_TIMEOUT_SECONDS;
    executionPlanHash: string;
    costGuard: GoldfishModalCostGuard;
  };
}

function initialJob(kingdom: KingdomEvidenceIdentity, range: CandidateRange): RuntimeJob {
  return { taskId: taskIdentity(kingdom.evidenceId, 'goldfish-one', range),
    evidenceId: kingdom.evidenceId, kingdomId: kingdom.kingdomId, stage: 'goldfish-one', range,
    cpus: 0, status: 'ready', dependencyTaskIds: [], launchIntentId: null, callId: null,
    leaseUntilMs: null, attemptCount: 0 };
}

function scoreArtifactPath(evidenceId: string, stage: 'goldfish-one' | 'goldfish-two', range: CandidateRange): string {
  return `${kingdomArtifactRoot(evidenceId)}/tasks/${stage}/${range.start}-${range.end}.hgs`;
}

export function createGoldfishModalLaunchBundle(parsed: ParsedGoldfishModalRequest): GoldfishModalLaunchBundle {
  const jobs: RuntimeJob[] = [], tasks: GoldfishModalTaskConfiguration[] = [];
  for (const kingdom of parsed.kingdoms) {
    const partition = parsed.partitions[`${kingdom.evidenceId}:goldfish-one`];
    const range = partition?.jobs[0];
    if (!range) throw new Error(`Goldfish stage-one partition is missing for ${kingdom.kingdomId}.`);
    const job = initialJob(kingdom, range);
    job.cpus = parsed.request.workerCores;
    jobs.push(job);
    tasks.push({ taskId: job.taskId, kingdomId: job.kingdomId, evidenceId: job.evidenceId,
      stage: job.stage, range, cpu: parsed.request.workerCores,
      memoryMiB: GOLDFISH_MODAL_SCORE_MEMORY_MIB,
      timeoutSeconds: GOLDFISH_MODAL_SCORE_TIMEOUT_SECONDS, dependencyTaskIds: [],
      artifactPath: scoreArtifactPath(job.evidenceId, 'goldfish-one', range) });
  }
  return { schemaVersion: 3, campaignExecutionId: parsed.campaignExecutionId,
    executionRoot: campaignExecutionRoot(parsed.campaignExecutionId), request: structuredClone(parsed.request),
    sourceImage: structuredClone(parsed.sourceImage), partitions: structuredClone(parsed.partitions), jobs, tasks,
    controller: { route: GOLDFISH_MODAL_ROUTE, maxActiveCpus: parsed.request.maxActiveCpus,
      timeoutSeconds: parsed.request.maxWallSeconds, maxWallSeconds: parsed.request.maxWallSeconds,
      pollIntervalSeconds: 1, volumeName: 'hexdeck-native-strategy-results', readyWindowWaves: 2,
      maxReducerMemoryMiB: parsed.resourceShape.maxConcurrentReducers * GOLDFISH_MODAL_REDUCE_MEMORY_MIB,
      goldfishWorkerCores: parsed.request.workerCores,
      goldfishScoreMemoryMiB: GOLDFISH_MODAL_SCORE_MEMORY_MIB,
      goldfishScoreTimeoutSeconds: GOLDFISH_MODAL_SCORE_TIMEOUT_SECONDS,
      goldfishReducerCores: GOLDFISH_MODAL_REDUCER_CORES,
      goldfishReduceMemoryMiB: GOLDFISH_MODAL_REDUCE_MEMORY_MIB,
      goldfishReduceOneTimeoutSeconds: GOLDFISH_MODAL_REDUCE_ONE_TIMEOUT_SECONDS,
      goldfishReduceTwoTimeoutSeconds: GOLDFISH_MODAL_REDUCE_TWO_TIMEOUT_SECONDS,
      executionPlanHash: parsed.executionPlanHash, costGuard: structuredClone(parsed.costGuard) } };
}

export interface GoldfishModalPlanSummary {
  schemaVersion: 1;
  route: typeof GOLDFISH_MODAL_ROUTE;
  paidExecution: false;
  campaignExecutionId: string;
  orderedEvidenceIds: string[];
  kingdomCount: number;
  taskCount: number;
  taskCounts: GoldfishModalTaskCounts;
  resourceShape: GoldfishModalResourceShape;
  timeouts: {
    maximumScientificWallSeconds: number;
    scoreTaskSeconds: typeof GOLDFISH_MODAL_SCORE_TIMEOUT_SECONDS;
    reduceOneTaskSeconds: typeof GOLDFISH_MODAL_REDUCE_ONE_TIMEOUT_SECONDS;
    reduceTwoTaskSeconds: typeof GOLDFISH_MODAL_REDUCE_TWO_TIMEOUT_SECONDS;
  };
  worstCaseModalComputeUsd: number;
  maximumAuthorizedCostUsd: number;
  hardMaximumCostUsd: typeof GOLDFISH_MODAL_HARD_COST_CAP_USD;
  authorizationToken: string;
}

export function createGoldfishModalPlanSummary(parsed: ParsedGoldfishModalRequest): GoldfishModalPlanSummary {
  return { schemaVersion: 1, route: GOLDFISH_MODAL_ROUTE, paidExecution: false,
    campaignExecutionId: parsed.campaignExecutionId,
    orderedEvidenceIds: parsed.kingdoms.map((entry) => entry.evidenceId),
    kingdomCount: parsed.kingdoms.length, taskCount: parsed.taskCounts.total,
    taskCounts: structuredClone(parsed.taskCounts), resourceShape: structuredClone(parsed.resourceShape),
    timeouts: { maximumScientificWallSeconds: parsed.request.maxWallSeconds,
      scoreTaskSeconds: GOLDFISH_MODAL_SCORE_TIMEOUT_SECONDS,
      reduceOneTaskSeconds: GOLDFISH_MODAL_REDUCE_ONE_TIMEOUT_SECONDS,
      reduceTwoTaskSeconds: GOLDFISH_MODAL_REDUCE_TWO_TIMEOUT_SECONDS },
    worstCaseModalComputeUsd: parsed.costGuard.worstCaseModalComputeUsd,
    maximumAuthorizedCostUsd: parsed.request.maxCostUsd,
    hardMaximumCostUsd: GOLDFISH_MODAL_HARD_COST_CAP_USD,
    authorizationToken: parsed.authorizationToken };
}
