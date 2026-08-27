import { createHash } from 'node:crypto';
import type { ParsedStrategySearchRequest } from './strategySearchCampaign';
import { campaignExecutionRoot, kingdomArtifactRoot } from './strategySearchCampaign';
import {
  createStagePartition, deriveExecutionPolicy, taskIdentity
} from './strategySearchScheduler';
import type { RuntimeJob, StagePartition } from './strategySearchScheduler';
import { STRATEGY_SEARCH_MATRIX_SCORE_TASK_COUNT } from './strategySearchMatrix';

export interface StrategySearchTaskConfiguration {
  taskId: string; kingdomId: string; evidenceId: string; stage: RuntimeJob['stage'];
  range: RuntimeJob['range']; cpu: number; memoryMiB: number; timeoutSeconds: number;
  dependencyTaskIds: string[]; artifactPath: string; metadata?: Record<string, unknown>;
}
export interface StrategySearchLaunchBundle {
  schemaVersion: 3; campaignExecutionId: string; executionRoot: string; request: ParsedStrategySearchRequest['request'];
  sourceImage: ParsedStrategySearchRequest['sourceImage']; partitions: Record<string, StagePartition>;
  jobs: RuntimeJob[]; tasks: StrategySearchTaskConfiguration[];
  controller: { maxActiveCpus: number; timeoutSeconds: number;
    pollIntervalSeconds: number; volumeName: 'hexdeck-native-strategy-results'; readyWindowWaves: 2;
    maxReducerMemoryMiB: number };
}
function job(input: Omit<RuntimeJob, 'status' | 'launchIntentId' | 'callId' | 'leaseUntilMs' | 'attemptCount'>
  & { status?: RuntimeJob['status'] }): RuntimeJob {
  return { ...input, status: input.status ?? (input.dependencyTaskIds.length ? 'blocked' : 'ready'),
    launchIntentId: null, callId: null, leaseUntilMs: null, attemptCount: 0 };
}
function taskPath(evidenceId: string, stage: RuntimeJob['stage'], range: RuntimeJob['range']): string {
  const root = kingdomArtifactRoot(evidenceId);
  if (stage === 'goldfish-one' || stage === 'goldfish-two') {
    return `${root}/tasks/${stage}/${range!.start}-${range!.end}.hgs`;
  }
  if (stage === 'goldfish-one-reduce') return `${root}/goldfish/top-500000.hgf`;
  if (stage === 'goldfish-two-reduce') return `${root}/goldfish/reservoir.hgf`;
  if (stage === 'matrix-manifest') return `${root}/matrix/manifest.json`;
  if (stage === 'matrix-score') return `${root}/matrix/runtime/task-${range!.start}.json`;
  if (stage === 'matrix-reduce') return `${root}/matrix/evidence.json`;
  if (stage === 'psro-reduce') return `${root}/psro/evidence.json`;
  return `${root}/psro/runtime/${stage}/${range?.start ?? 0}-${range?.end ?? 0}.json`;
}
export function createStrategySearchLaunchBundle(parsed: ParsedStrategySearchRequest): StrategySearchLaunchBundle {
  const policy = deriveExecutionPolicy({ maxActiveCpus: parsed.request.maxActiveCpus });
  const jobs: RuntimeJob[] = [], tasks: StrategySearchTaskConfiguration[] = [];
  const partitions: Record<string, StagePartition> = {};
  const initialGoldfishByKingdom: RuntimeJob[][] = [];
  const add = (held: RuntimeJob, memoryMiB: number, timeoutSeconds: number,
    metadata?: Record<string, unknown>): void => {
    jobs.push(held); tasks.push({ taskId: held.taskId, kingdomId: held.kingdomId,
      evidenceId: held.evidenceId, stage: held.stage, range: held.range, cpu: held.cpus,
      memoryMiB, timeoutSeconds, dependencyTaskIds: [...held.dependencyTaskIds],
      artifactPath: taskPath(held.evidenceId, held.stage, held.range), ...(metadata ? { metadata } : {}) });
  };
  for (const kingdom of parsed.kingdoms) {
    const one = createStagePartition({ evidenceId: kingdom.evidenceId, stage: 'goldfish-one',
      total: kingdom.orderedProduct.candidateCount, candidatesPerJob: policy.candidatesPerJob });
    const two = createStagePartition({ evidenceId: kingdom.evidenceId, stage: 'goldfish-two',
      total: kingdom.orderedProduct.retainedCount, candidatesPerJob: policy.stageTwoCandidatesPerJob });
    partitions[`${kingdom.evidenceId}:goldfish-one`] = one;
    partitions[`${kingdom.evidenceId}:goldfish-two`] = two;
    const oneIds = one.jobs.map((range) => taskIdentity(kingdom.evidenceId, 'goldfish-one', range));
    initialGoldfishByKingdom.push(one.jobs.map((range, index) => job({ taskId: oneIds[index]!,
      evidenceId: kingdom.evidenceId, kingdomId: kingdom.kingdomId, stage: 'goldfish-one', range,
      cpus: policy.goldfishJobCpus, dependencyTaskIds: [] })));
    const reduceTwoId = taskIdentity(kingdom.evidenceId, 'goldfish-two-reduce', null);
    const manifestId = taskIdentity(kingdom.evidenceId, 'matrix-manifest', null);
    add(job({ taskId: manifestId, evidenceId: kingdom.evidenceId, kingdomId: kingdom.kingdomId,
      stage: 'matrix-manifest', range: null, cpus: 1, dependencyTaskIds: [reduceTwoId] }), 2048, 120);
    const matrixTaskCount = Math.min(STRATEGY_SEARCH_MATRIX_SCORE_TASK_COUNT,
      Math.max(1, Math.floor(parsed.request.maxActiveCpus / 4)));
    const matrixScoreIds = Array.from({ length: matrixTaskCount }, (_unused, taskIndex) => {
      const range = { start: taskIndex, end: taskIndex + 1 }, taskId = taskIdentity(kingdom.evidenceId, 'matrix-score', range);
      add(job({ taskId, evidenceId: kingdom.evidenceId, kingdomId: kingdom.kingdomId,
        stage: 'matrix-score', range, cpus: 4, dependencyTaskIds: [manifestId] }), 8192, 180,
      { taskIndex, taskCount: matrixTaskCount }); return taskId;
    });
    const matrixReduceId = taskIdentity(kingdom.evidenceId, 'matrix-reduce', null);
    add(job({ taskId: matrixReduceId, evidenceId: kingdom.evidenceId, kingdomId: kingdom.kingdomId,
      stage: 'matrix-reduce', range: null, cpus: 4, dependencyTaskIds: matrixScoreIds }), 8192, 180);
    const psroInitId = taskIdentity(kingdom.evidenceId, 'psro-decision', { start: 0, end: 1 });
    add(job({ taskId: psroInitId, evidenceId: kingdom.evidenceId, kingdomId: kingdom.kingdomId,
      stage: 'psro-decision', range: { start: 0, end: 1 }, cpus: 1,
      dependencyTaskIds: [matrixReduceId] }), 8192, 180, { operation: 'init' });
  }
  const initialWindow = Math.floor(parsed.request.maxActiveCpus / policy.goldfishJobCpus) * 2;
  const cursors = initialGoldfishByKingdom.map(() => 0); let materialized = 0;
  while (materialized < initialWindow
    && initialGoldfishByKingdom.some((held, index) => cursors[index]! < held.length)) {
    for (let index = 0; index < initialGoldfishByKingdom.length && materialized < initialWindow; index += 1) {
      const held = initialGoldfishByKingdom[index]![cursors[index]!];
      if (!held) continue;
      cursors[index] = cursors[index]! + 1; materialized += 1;
      add(held, 4096, policy.goldfishTimeoutSeconds);
    }
  }
  return { schemaVersion: 3, campaignExecutionId: parsed.campaignExecutionId,
    executionRoot: campaignExecutionRoot(parsed.campaignExecutionId), request: structuredClone(parsed.request),
    sourceImage: structuredClone(parsed.sourceImage), partitions, jobs, tasks,
    controller: { maxActiveCpus: parsed.request.maxActiveCpus, timeoutSeconds: 86_340,
      pollIntervalSeconds: 1, volumeName: 'hexdeck-native-strategy-results',
      readyWindowWaves: 2, maxReducerMemoryMiB: 8192 } };
}
export interface StrategySearchPlanSummary {
  schemaVersion: 3; campaignExecutionId: string; orderedEvidenceIds: string[]; kingdomCount: number;
  maxActiveCpus: number; authorizationToken: string; taskCount: number;
  estimatedModalComputeUsd: number; estimateOnly: true; workspaceBudgetVerification: 'not-performed';
}
export function createStrategySearchPlanSummary(parsed: ParsedStrategySearchRequest): StrategySearchPlanSummary {
  const bundle = createStrategySearchLaunchBundle(parsed);
  const estimatedModalComputeUsd = bundle.tasks.reduce((sum, task) => sum + task.timeoutSeconds / 3600
    * (task.cpu * 0.0473 + task.memoryMiB / 1024 * 0.008), 0);
  return { schemaVersion: 3, campaignExecutionId: parsed.campaignExecutionId,
    orderedEvidenceIds: parsed.kingdoms.map((entry) => entry.evidenceId), kingdomCount: parsed.kingdoms.length,
    maxActiveCpus: parsed.request.maxActiveCpus, authorizationToken: parsed.authorizationToken,
    taskCount: bundle.tasks.length, estimatedModalComputeUsd, estimateOnly: true,
    workspaceBudgetVerification: 'not-performed' };
}
export const strategySearchLaunchBundleHash = (bundle: StrategySearchLaunchBundle): string =>
  createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
