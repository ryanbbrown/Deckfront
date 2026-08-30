import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  canonicalStrategySearchJson, campaignExecutionRoot, deriveStrategySearch, kingdomArtifactRoot
} from './strategySearchCampaign';
import type { KingdomEvidenceIdentity, SourceImageIdentity } from './strategySearchCampaign';

export interface CandidateRange { start: number; end: number }
export interface RuntimeJob {
  taskId: string;
  evidenceId: string;
  kingdomId: string;
  stage: 'goldfish-one-reduce' | 'goldfish-two-reduce';
  range: CandidateRange | null;
  cpus: number;
  status: 'blocked' | 'ready' | 'launching' | 'active' | 'retry-backoff' | 'complete' | 'terminal-incomplete';
  dependencyTaskIds: string[];
  launchIntentId: string | null;
  callId: string | null;
  leaseUntilMs: number | null;
  attemptCount: number;
}
export interface StagePartition {
  evidenceId: string;
  stage: 'goldfish-one-reduce' | 'goldfish-two-reduce';
  jobs: CandidateRange[];
}

export function taskIdentity(evidenceId: string, stage: RuntimeJob['stage'], range: CandidateRange | null): string {
  return createHash('sha256').update(JSON.stringify({ evidenceId, stage, range })).digest('hex');
}

export const GOLDFISH_MODAL_ROUTE = 'goldfish-only-v2' as const;
export const GOLDFISH_MODAL_CPU_USD_PER_CORE_SECOND = 0.0000131;
export const GOLDFISH_MODAL_MEMORY_USD_PER_GIB_SECOND = 0.00000222;
export const GOLDFISH_MODAL_HARD_COST_CAP_USD = 100;
export const GOLDFISH_MODAL_MIN_WORKER_CORES = 16;
export const GOLDFISH_MODAL_MAX_WORKER_CORES = 64;
export const GOLDFISH_MODAL_MIN_WALL_SECONDS = 300;
export const GOLDFISH_MODAL_MAX_WALL_SECONDS = 21_600;
export const GOLDFISH_MODAL_KINGDOM_MEMORY_MIB = 8192;
export const GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS = 300;
export const GOLDFISH_MODAL_ATTEMPTS = 3;

export function goldfishKingdomOneTimeoutSeconds(workerCores: number): number {
  return 300 + Math.floor((13_000 + workerCores - 1) / workerCores);
}

const identifier = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const goldfishModalRequestSchema = z.object({
  kingdomIds: z.array(identifier).min(1),
  workerCores: z.number().int().safe().min(GOLDFISH_MODAL_MIN_WORKER_CORES)
    .max(GOLDFISH_MODAL_MAX_WORKER_CORES),
  maxActiveCpus: z.number().int().safe().min(GOLDFISH_MODAL_MIN_WORKER_CORES),
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

export interface GoldfishModalTaskCounts {
  kingdomOne: number;
  kingdomTwo: number;
  total: number;
}

export interface GoldfishModalResourceShape {
  workerCoresPerContainer: number;
  maxActiveCpus: number;
  maxKingdomContainers: number;
  maxScheduledCpus: number;
  unusedCpuCapacity: number;
  kingdomMemoryMiB: typeof GOLDFISH_MODAL_KINGDOM_MEMORY_MIB;
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
  taskCounts: GoldfishModalTaskCounts;
  resourceShape: GoldfishModalResourceShape;
  costGuard: GoldfishModalCostGuard;
  executionPlanHash: string;
  campaignExecutionId: string;
  authorizationToken: string;
  downloadRoot: string;
}

function resourceShape(request: GoldfishModalRequest): GoldfishModalResourceShape {
  const maxKingdomContainers = Math.floor(request.maxActiveCpus / request.workerCores);
  const maxScheduledCpus = maxKingdomContainers * request.workerCores;
  return { workerCoresPerContainer: request.workerCores, maxActiveCpus: request.maxActiveCpus,
    maxKingdomContainers, maxScheduledCpus,
    unusedCpuCapacity: request.maxActiveCpus - maxScheduledCpus,
    kingdomMemoryMiB: GOLDFISH_MODAL_KINGDOM_MEMORY_MIB };
}

function modalComputeCost(cpu: number, memoryMiB: number, seconds: number): number {
  return seconds * (cpu * GOLDFISH_MODAL_CPU_USD_PER_CORE_SECOND
    + memoryMiB / 1024 * GOLDFISH_MODAL_MEMORY_USD_PER_GIB_SECOND);
}

export function worstCaseGoldfishModalComputeUsd(input: {
  request: GoldfishModalRequest; taskCounts: GoldfishModalTaskCounts;
}): number {
  const timeoutOne = goldfishKingdomOneTimeoutSeconds(input.request.workerCores);
  const kingdoms = input.taskCounts.kingdomOne;
  const scientific = kingdoms * GOLDFISH_MODAL_ATTEMPTS * (
    modalComputeCost(input.request.workerCores, GOLDFISH_MODAL_KINGDOM_MEMORY_MIB, timeoutOne + 30)
    + modalComputeCost(input.request.workerCores, GOLDFISH_MODAL_KINGDOM_MEMORY_MIB,
      GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS + 30));
  const controller = modalComputeCost(1, 2048, input.request.maxWallSeconds + 60);
  const publisher = modalComputeCost(1, 8192, input.request.maxWallSeconds);
  const readiness = modalComputeCost(1, 2048, 180);
  const canary = modalComputeCost(1, 4096, 120);
  const boundedControl = modalComputeCost(0.25, 512, input.request.maxWallSeconds + 90);
  return Number((scientific + controller + publisher + readiness + canary + boundedControl).toFixed(6));
}

export function deriveGoldfishModalRequest(input: {
  request: unknown; sourceImage: SourceImageIdentity;
}): ParsedGoldfishModalRequest {
  const request = parseGoldfishModalRequest(input.request);
  const scientific = deriveStrategySearch({ request: {
    kingdomIds: request.kingdomIds, maxActiveCpus: request.maxActiveCpus
  }, sourceImage: input.sourceImage });
  const taskCounts = { kingdomOne: scientific.kingdoms.length,
    kingdomTwo: scientific.kingdoms.length, total: scientific.kingdoms.length * 2 };
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
    resourceShape: shape, costGuard };
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
    taskCounts, resourceShape: shape, costGuard, executionPlanHash,
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
  partitions: Record<string, never>;
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
    goldfishKingdomMemoryMiB: typeof GOLDFISH_MODAL_KINGDOM_MEMORY_MIB;
    goldfishKingdomOneTimeoutSeconds: number;
    goldfishKingdomTwoTimeoutSeconds: typeof GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS;
    executionPlanHash: string;
    costGuard: GoldfishModalCostGuard;
  };
}

function kingdomJob(kingdom: KingdomEvidenceIdentity, stage: 'goldfish-one-reduce' | 'goldfish-two-reduce',
  cpus: number, status: RuntimeJob['status'], dependencyTaskIds: string[]): RuntimeJob {
  return { taskId: taskIdentity(kingdom.evidenceId, stage, null), evidenceId: kingdom.evidenceId,
    kingdomId: kingdom.kingdomId, stage, range: null, cpus, status, dependencyTaskIds,
    launchIntentId: null, callId: null, leaseUntilMs: null, attemptCount: 0 };
}

export function createGoldfishModalLaunchBundle(parsed: ParsedGoldfishModalRequest): GoldfishModalLaunchBundle {
  const jobs: RuntimeJob[] = [], tasks: GoldfishModalTaskConfiguration[] = [];
  const timeoutOne = goldfishKingdomOneTimeoutSeconds(parsed.request.workerCores);
  for (const kingdom of parsed.kingdoms) {
    const one = kingdomJob(kingdom, 'goldfish-one-reduce', parsed.request.workerCores, 'ready', []);
    const two = kingdomJob(kingdom, 'goldfish-two-reduce', parsed.request.workerCores, 'blocked', [one.taskId]);
    jobs.push(one, two);
    tasks.push({ taskId: one.taskId, kingdomId: one.kingdomId, evidenceId: one.evidenceId,
      stage: one.stage, range: null, cpu: parsed.request.workerCores,
      memoryMiB: GOLDFISH_MODAL_KINGDOM_MEMORY_MIB, timeoutSeconds: timeoutOne,
      dependencyTaskIds: [], artifactPath: `${kingdomArtifactRoot(one.evidenceId)}/goldfish/top-500000.hgf` },
    { taskId: two.taskId, kingdomId: two.kingdomId, evidenceId: two.evidenceId,
      stage: two.stage, range: null, cpu: parsed.request.workerCores,
      memoryMiB: GOLDFISH_MODAL_KINGDOM_MEMORY_MIB,
      timeoutSeconds: GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS,
      dependencyTaskIds: [one.taskId],
      artifactPath: `${kingdomArtifactRoot(two.evidenceId)}/goldfish/reservoir.hgf` });
  }
  return { schemaVersion: 3, campaignExecutionId: parsed.campaignExecutionId,
    executionRoot: campaignExecutionRoot(parsed.campaignExecutionId), request: structuredClone(parsed.request),
    sourceImage: structuredClone(parsed.sourceImage), partitions: {}, jobs, tasks,
    controller: { route: GOLDFISH_MODAL_ROUTE, maxActiveCpus: parsed.request.maxActiveCpus,
      timeoutSeconds: parsed.request.maxWallSeconds, maxWallSeconds: parsed.request.maxWallSeconds,
      pollIntervalSeconds: 1, volumeName: 'hexdeck-native-strategy-results', readyWindowWaves: 2,
      maxReducerMemoryMiB: parsed.resourceShape.maxKingdomContainers * GOLDFISH_MODAL_KINGDOM_MEMORY_MIB,
      goldfishWorkerCores: parsed.request.workerCores,
      goldfishKingdomMemoryMiB: GOLDFISH_MODAL_KINGDOM_MEMORY_MIB,
      goldfishKingdomOneTimeoutSeconds: timeoutOne,
      goldfishKingdomTwoTimeoutSeconds: GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS,
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
    kingdomOneTaskSeconds: number;
    kingdomTwoTaskSeconds: typeof GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS;
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
      kingdomOneTaskSeconds: goldfishKingdomOneTimeoutSeconds(parsed.request.workerCores),
      kingdomTwoTaskSeconds: GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS },
    worstCaseModalComputeUsd: parsed.costGuard.worstCaseModalComputeUsd,
    maximumAuthorizedCostUsd: parsed.request.maxCostUsd,
    hardMaximumCostUsd: GOLDFISH_MODAL_HARD_COST_CAP_USD,
    authorizationToken: parsed.authorizationToken };
}
