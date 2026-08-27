import { createHash } from 'node:crypto';
import type { ParsedStrategySearchRequest } from './strategySearchCampaign';
import { campaignExecutionRoot, kingdomArtifactRoot } from './strategySearchCampaign';
import {
  createStagePartition, deriveExecutionPolicy, taskIdentity
} from './strategySearchScheduler';
import type { RuntimeJob, StagePartition } from './strategySearchScheduler';

export interface StrategySearchTaskConfiguration {
  taskId: string; kingdomId: string; evidenceId: string; stage: RuntimeJob['stage'];
  range: RuntimeJob['range']; cpu: number; memoryMiB: number; timeoutSeconds: number;
  dependencyTaskIds: string[]; artifactPath: string;
}
export interface StrategySearchLaunchBundle {
  schemaVersion: 2; campaignExecutionId: string; executionRoot: string; request: ParsedStrategySearchRequest['request'];
  sourceImage: ParsedStrategySearchRequest['sourceImage']; partitions: Record<string, StagePartition>;
  jobs: RuntimeJob[]; tasks: StrategySearchTaskConfiguration[];
  controller: { maxActiveCpus: number; timeoutSeconds: number; shutdownMarginSeconds: number;
    pollIntervalSeconds: number; volumeName: 'hexdeck-native-strategy-results' };
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
  if (stage === 'goldfish-one-reduce') return `${root}/goldfish/top-500000.json`;
  if (stage === 'goldfish-two-reduce') return `${root}/goldfish/reservoir.json`;
  return `${root}/${stage}/evidence.json`;
}
export function createStrategySearchLaunchBundle(parsed: ParsedStrategySearchRequest): StrategySearchLaunchBundle {
  const policy = deriveExecutionPolicy({ maxActiveCpus: parsed.request.maxActiveCpus });
  const jobs: RuntimeJob[] = [], tasks: StrategySearchTaskConfiguration[] = [];
  const partitions: Record<string, StagePartition> = {};
  const add = (held: RuntimeJob, memoryMiB: number, timeoutSeconds: number): void => {
    jobs.push(held); tasks.push({ taskId: held.taskId, kingdomId: held.kingdomId,
      evidenceId: held.evidenceId, stage: held.stage, range: held.range, cpu: held.cpus,
      memoryMiB, timeoutSeconds, dependencyTaskIds: [...held.dependencyTaskIds],
      artifactPath: taskPath(held.evidenceId, held.stage, held.range) });
  };
  for (const kingdom of parsed.kingdoms) {
    const one = createStagePartition({ evidenceId: kingdom.evidenceId, stage: 'goldfish-one',
      total: kingdom.orderedProduct.candidateCount, candidatesPerJob: policy.candidatesPerJob });
    const two = createStagePartition({ evidenceId: kingdom.evidenceId, stage: 'goldfish-two',
      total: kingdom.orderedProduct.retainedCount, candidatesPerJob: policy.stageTwoCandidatesPerJob });
    partitions[`${kingdom.evidenceId}:goldfish-one`] = one;
    partitions[`${kingdom.evidenceId}:goldfish-two`] = two;
    const oneIds = one.jobs.map((range) => taskIdentity(kingdom.evidenceId, 'goldfish-one', range));
    one.jobs.forEach((range, index) => add(job({ taskId: oneIds[index]!, evidenceId: kingdom.evidenceId,
      kingdomId: kingdom.kingdomId, stage: 'goldfish-one', range, cpus: policy.goldfishJobCpus,
      dependencyTaskIds: [] }), 4096, 90));
    const reduceOneId = taskIdentity(kingdom.evidenceId, 'goldfish-one-reduce', null);
    add(job({ taskId: reduceOneId, evidenceId: kingdom.evidenceId, kingdomId: kingdom.kingdomId,
      stage: 'goldfish-one-reduce', range: null, cpus: policy.goldfishJobCpus,
      dependencyTaskIds: oneIds }), 8192, 120);
    const twoIds = two.jobs.map((range) => taskIdentity(kingdom.evidenceId, 'goldfish-two', range));
    two.jobs.forEach((range, index) => add(job({ taskId: twoIds[index]!, evidenceId: kingdom.evidenceId,
      kingdomId: kingdom.kingdomId, stage: 'goldfish-two', range, cpus: policy.goldfishStageTwoCpus,
      dependencyTaskIds: [reduceOneId] }), 8192, 90));
    const reduceTwoId = taskIdentity(kingdom.evidenceId, 'goldfish-two-reduce', null);
    add(job({ taskId: reduceTwoId, evidenceId: kingdom.evidenceId, kingdomId: kingdom.kingdomId,
      stage: 'goldfish-two-reduce', range: null, cpus: policy.goldfishJobCpus,
      dependencyTaskIds: twoIds }), 8192, 120);
    const matrixId = taskIdentity(kingdom.evidenceId, 'matrix', null);
    add(job({ taskId: matrixId, evidenceId: kingdom.evidenceId, kingdomId: kingdom.kingdomId,
      stage: 'matrix', range: null, cpus: policy.matrixCpus, dependencyTaskIds: [reduceTwoId] }), 8192, 300);
    add(job({ taskId: taskIdentity(kingdom.evidenceId, 'psro', null), evidenceId: kingdom.evidenceId,
      kingdomId: kingdom.kingdomId, stage: 'psro', range: null, cpus: policy.psroCpus,
      dependencyTaskIds: [matrixId] }), 8192, 420);
  }
  return { schemaVersion: 2, campaignExecutionId: parsed.campaignExecutionId,
    executionRoot: campaignExecutionRoot(parsed.campaignExecutionId), request: structuredClone(parsed.request),
    sourceImage: structuredClone(parsed.sourceImage), partitions, jobs, tasks,
    controller: { maxActiveCpus: parsed.request.maxActiveCpus, timeoutSeconds: 1_140,
      shutdownMarginSeconds: 30, pollIntervalSeconds: 1,
      volumeName: 'hexdeck-native-strategy-results' } };
}
export interface StrategySearchPlanSummary {
  schemaVersion: 2; campaignExecutionId: string; orderedEvidenceIds: string[]; kingdomCount: number;
  maxActiveCpus: number; authorizationToken: string; taskCount: number;
  estimatedModalComputeUsd: number; estimateOnly: true; workspaceBudgetVerification: 'not-performed';
}
export function createStrategySearchPlanSummary(parsed: ParsedStrategySearchRequest): StrategySearchPlanSummary {
  const bundle = createStrategySearchLaunchBundle(parsed);
  const estimatedModalComputeUsd = bundle.tasks.reduce((sum, task) => sum + task.timeoutSeconds / 3600
    * (task.cpu * 0.0473 + task.memoryMiB / 1024 * 0.008), 0);
  return { schemaVersion: 2, campaignExecutionId: parsed.campaignExecutionId,
    orderedEvidenceIds: parsed.kingdoms.map((entry) => entry.evidenceId), kingdomCount: parsed.kingdoms.length,
    maxActiveCpus: parsed.request.maxActiveCpus, authorizationToken: parsed.authorizationToken,
    taskCount: bundle.tasks.length, estimatedModalComputeUsd, estimateOnly: true,
    workspaceBudgetVerification: 'not-performed' };
}
export const strategySearchLaunchBundleHash = (bundle: StrategySearchLaunchBundle): string =>
  createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
