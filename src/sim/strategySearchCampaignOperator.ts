import { createHash } from 'node:crypto';
import {
  createCampaignState, parseCampaignSelectionManifest, runtimeCeilings
} from './strategySearchCampaign';
import type {
  ParsedCampaignManifest, ParsedCampaignSelectionManifest, StrategySearchCampaignManifest
} from './strategySearchCampaign';
import {
  createCampaignSchedulerCheckpoint
} from './strategySearchScheduler';
import type {
  CampaignSchedulerCheckpoint, CampaignSchedulerTask
} from './strategySearchScheduler';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const relativeStage = (kingdomId: string, stage: 'goldfish' | 'matrix' | 'psro'): string =>
  `kingdoms/${kingdomId}/${stage}`;
const checkpointName = (shardId: number): string => `shard-${String(shardId).padStart(6, '0')}.json`;

export interface CampaignTaskConfiguration {
  task_id: string;
  kingdom_id: string;
  stage: 'goldfish' | 'matrix' | 'psro';
  cpu: number;
  memory_mib: number;
  timeout_seconds: number;
  stage_terminal: boolean;
  config: Record<string, unknown>;
  validation: Record<string, unknown>;
}
export interface CampaignLaunchBundle {
  schemaVersion: 1;
  campaignRoot: string;
  evidenceHash: string;
  runtimeHash: string;
  state: ReturnType<typeof createCampaignState>;
  scheduler: CampaignSchedulerCheckpoint;
  tasks: CampaignTaskConfiguration[];
  files: Record<string, unknown>;
  controller: {
    campaign_root: string;
    claim: { expectedRevision: number; ownerId: '__OWNER__'; leaseMs: number;
      requestedCeilings: ReturnType<typeof runtimeCeilings>; runtimeHash: string;
      taskResources: Record<string, { containers: number; cpus: number }>;
      authorization?: { token: string; ceilings: ReturnType<typeof runtimeCeilings> } };
    evidence_hash: string;
    tasks: CampaignTaskConfiguration[];
    limits: { maxActiveContainers: number; maxActiveCpus: number };
    source_image: StrategySearchCampaignManifest['evidence']['sourceImage'];
    lease_renew_interval_seconds: number;
    controller_timeout_seconds: number;
    shutdown_margin_seconds: number;
    poll_interval_seconds: number;
    dispatch_batch_size: number;
    retry_backoff_seconds: number;
    retry_backoff_max_seconds: number;
  };
}

export function validateCampaignSelection(input: ParsedCampaignManifest,
  selection: ParsedCampaignSelectionManifest): void {
  if (selection.sha256 !== input.manifest.evidence.selectionManifest.sha256
    || selection.digest !== input.manifest.evidence.selectionManifest.digest
    || JSON.stringify(selection.kingdomIds) !== JSON.stringify(input.manifest.evidence.kingdomIds)) {
    throw new Error('Campaign manifest does not match the exact supplied selection manifest.');
  }
}

function orderedBase(manifest: StrategySearchCampaignManifest, campaignRoot: string,
  kingdomId: string, stageId: string): Record<string, unknown> {
  const runtime = manifest.runtime.stages.goldfish, evidence = manifest.evidence;
  return { campaign_root: campaignRoot, run_id: `${campaignRoot}/${relativeStage(kingdomId, 'goldfish')}`,
    stage_key: `${kingdomId}:goldfish`, stage_id: stageId, schema_version: 2, kingdom: kingdomId,
    build_version: evidence.sourceImage.gitVersion,
    rule_fingerprint: evidence.kingdoms[kingdomId]!.ruleFingerprint,
    shuffle_seeds: evidence.kingdoms[kingdomId]!.goldfishSeeds,
    retained_count: evidence.orderedProduct.retainedCount,
    reservoir_count: evidence.orderedProduct.reservoirCount,
    cpu: runtime.cpu, threads: runtime.threads, timeout_seconds: runtime.timeoutSeconds };
}
function schedulerTask(input: Pick<CampaignSchedulerTask, 'taskId' | 'kingdomId' | 'stage' | 'shardId'
  | 'dependencyTaskIds' | 'status' | 'cpus'>): CampaignSchedulerTask {
  return { ...input, readySinceMs: 0, containers: 1, launchIntentId: null, callId: null,
    controllerFence: null, reason: null, artifactPaths: [], artifactHashes: {}, attemptCount: 0,
    retryNotBeforeMs: 0 };
}

export function createCampaignLaunchBundle(input: ParsedCampaignManifest,
  authorizationToken?: string): CampaignLaunchBundle {
  const manifest = input.manifest, campaignId = manifest.evidence.campaignId;
  const campaignRoot = `campaigns/${campaignId}/${input.evidenceHash}`;
  const tasks: CampaignSchedulerTask[] = [], configs: CampaignTaskConfiguration[] = [];
  const files: Record<string, unknown> = {};
  const add = (task: CampaignSchedulerTask, config: CampaignTaskConfiguration): void => {
    tasks.push(task); configs.push(config);
  };
  for (const kingdomId of manifest.evidence.kingdomIds) {
    const ids = input.stageIds[kingdomId]!, goldfish = relativeStage(kingdomId, 'goldfish');
    const matrix = relativeStage(kingdomId, 'matrix'), psro = relativeStage(kingdomId, 'psro');
    const base = orderedBase(manifest, campaignRoot, kingdomId, ids.goldfish);
    const stageOneIds: string[] = [];
    manifest.evidence.orderedProduct.canonicalShards.forEach((shard, shardId) => {
      const taskId = `${kingdomId}:goldfish:stage-one:${shard.id}`, checkpointPath =
        `${goldfish}/stage-one/${checkpointName(shardId)}`;
      stageOneIds.push(taskId);
      const spec = { shard_id: shardId, start_position: shard.start, end_position: shard.end };
      add(schedulerTask({ taskId, kingdomId, stage: 'goldfish', shardId: `stage-one:${shard.id}`,
        dependencyTaskIds: [], status: 'ready', cpus: manifest.runtime.stages.goldfish.cpu }), {
        task_id: taskId, kingdom_id: kingdomId, stage: 'goldfish', cpu: manifest.runtime.stages.goldfish.cpu,
        memory_mib: manifest.runtime.stages.goldfish.memoryMiB,
        timeout_seconds: manifest.runtime.stages.goldfish.timeoutSeconds, stage_terminal: false,
        config: { ...base, ...spec, ordered_stage: 'stage-one' }, validation: {
          kind: 'ordered-checkpoint', checkpoint_path: checkpointPath, ordered_stage: 'stage-one', spec } });
    });
    const mergeId = `${kingdomId}:goldfish:merge-stage-one`;
    add(schedulerTask({ taskId: mergeId, kingdomId, stage: 'goldfish', shardId: 'merge-stage-one',
      dependencyTaskIds: stageOneIds, status: 'blocked', cpus: manifest.runtime.stages.goldfish.cpu }), {
      task_id: mergeId, kingdom_id: kingdomId, stage: 'goldfish', cpu: manifest.runtime.stages.goldfish.cpu,
      memory_mib: manifest.runtime.stages.goldfish.memoryMiB,
      timeout_seconds: manifest.runtime.stages.goldfish.timeoutSeconds, stage_terminal: false,
      config: { ...base, ordered_stage: 'merge-stage-one', stage_path: goldfish,
        checkpoint_paths: manifest.evidence.orderedProduct.canonicalShards.map((_shard, shardId) =>
          `${goldfish}/stage-one/${checkpointName(shardId)}`) },
      validation: { kind: 'goldfish-cohort', cohort_path: `${goldfish}/stage-one-cohort.json` } });
    const shardSize = manifest.evidence.orderedProduct.canonicalShards[0]!.end
      - manifest.evidence.orderedProduct.canonicalShards[0]!.start;
    const stageTwoIds: string[] = [];
    for (let start = 0, shardId = 0; start < manifest.evidence.orderedProduct.retainedCount;
      start += shardSize, shardId += 1) {
      const end = Math.min(start + shardSize, manifest.evidence.orderedProduct.retainedCount);
      const taskId = `${kingdomId}:goldfish:stage-two:${shardId}`, spec = {
        shard_id: shardId, start_position: start, end_position: end };
      stageTwoIds.push(taskId);
      add(schedulerTask({ taskId, kingdomId, stage: 'goldfish', shardId: `stage-two:${shardId}`,
        dependencyTaskIds: [mergeId], status: 'blocked', cpus: manifest.runtime.stages.goldfish.cpu }), {
        task_id: taskId, kingdom_id: kingdomId, stage: 'goldfish', cpu: manifest.runtime.stages.goldfish.cpu,
        memory_mib: manifest.runtime.stages.goldfish.memoryMiB,
        timeout_seconds: manifest.runtime.stages.goldfish.timeoutSeconds, stage_terminal: false,
        config: { ...base, ...spec, ordered_stage: 'stage-two' }, validation: {
          kind: 'ordered-checkpoint', checkpoint_path: `${goldfish}/stage-two/${checkpointName(shardId)}`,
          ordered_stage: 'stage-two', spec } });
    }
    const finalizeId = `${kingdomId}:goldfish:finalize`;
    add(schedulerTask({ taskId: finalizeId, kingdomId, stage: 'goldfish', shardId: 'finalize',
      dependencyTaskIds: stageTwoIds, status: 'blocked', cpus: manifest.runtime.stages.goldfish.cpu }), {
      task_id: finalizeId, kingdom_id: kingdomId, stage: 'goldfish', cpu: manifest.runtime.stages.goldfish.cpu,
      memory_mib: manifest.runtime.stages.goldfish.memoryMiB,
      timeout_seconds: manifest.runtime.stages.goldfish.timeoutSeconds, stage_terminal: true,
      config: { ...base, ordered_stage: 'finalize', stage_path: goldfish,
        checkpoint_paths: stageTwoIds.map((_taskId, shardId) => `${goldfish}/stage-two/${checkpointName(shardId)}`),
        matrix_manifest_path: `${matrix}/output/manifest.json`, matrix_stage_id: ids.matrix,
        matrix_seed_namespace: manifest.evidence.psro.matrixSeedNamespace },
      validation: { kind: 'stage', stage_root: goldfish } });
    const matrixId = `${kingdomId}:matrix`;
    add(schedulerTask({ taskId: matrixId, kingdomId, stage: 'matrix', shardId: null,
      dependencyTaskIds: [finalizeId], status: 'blocked', cpus: manifest.runtime.stages.matrix.cpu }), {
      task_id: matrixId, kingdom_id: kingdomId, stage: 'matrix', cpu: manifest.runtime.stages.matrix.cpu,
      memory_mib: manifest.runtime.stages.matrix.memoryMiB,
      timeout_seconds: manifest.runtime.stages.matrix.timeoutSeconds, stage_terminal: true,
      config: { campaign_root: campaignRoot, stage: 'matrix', stage_key: `${kingdomId}:matrix`,
        stage_id: ids.matrix, manifest_path: `${matrix}/output/manifest.json`, output_path: `${matrix}/output`,
        control_path: `${matrix}/control`, threads: manifest.runtime.stages.matrix.threads,
        worker_batch_size: manifest.runtime.stages.matrix.workerBatchSize,
        timeout_seconds: manifest.runtime.stages.matrix.timeoutSeconds,
        shutdown_margin_seconds: Math.max(1, Math.min(60,
          Math.floor(manifest.runtime.stages.matrix.timeoutSeconds / 10))) },
      validation: { kind: 'stage', stage_root: matrix } });
    const psroConfigPath = `${psro}/stage-config.json`;
    files[psroConfigPath] = { stageId: ids.psro, kingdomId, runId: 'main',
      rankedPath: `/results/${campaignRoot}/${goldfish}/output/ranked.json`,
      reservoirPath: `/results/${campaignRoot}/${goldfish}/output/reservoir.json`,
      matrixRoot: `/results/${campaignRoot}/${matrix}/output`,
      outputRoot: `/results/${campaignRoot}/${psro}/output`,
      controlRoot: `/results/${campaignRoot}/${psro}/control`, workers: manifest.runtime.stages.psro.threads,
      protocolInput: { experimentName: `strategy-search-campaign-${campaignId}-${kingdomId}`,
        protocolVersion: manifest.evidence.psro.protocolVersion, checkpointNamespace: `campaign:${ids.psro}`,
        screenDepths: manifest.evidence.psro.screenDepths,
        confirmationLooks: manifest.evidence.psro.confirmationLooks,
        matrixSeedNamespace: manifest.evidence.psro.matrixSeedNamespace,
        screenSeedNamespace: manifest.evidence.psro.screenSeedNamespace,
        confirmationSeedNamespace: manifest.evidence.psro.confirmationSeedNamespace,
        queueRetestSeedNamespace: manifest.evidence.psro.queueRetestSeedNamespace }, execution: 'local' };
    const psroId = `${kingdomId}:psro`;
    add(schedulerTask({ taskId: psroId, kingdomId, stage: 'psro', shardId: null,
      dependencyTaskIds: [matrixId], status: 'blocked', cpus: manifest.runtime.stages.psro.cpu }), {
      task_id: psroId, kingdom_id: kingdomId, stage: 'psro', cpu: manifest.runtime.stages.psro.cpu,
      memory_mib: manifest.runtime.stages.psro.memoryMiB,
      timeout_seconds: manifest.runtime.stages.psro.timeoutSeconds, stage_terminal: true,
      config: { campaign_root: campaignRoot, stage: 'psro', stage_key: `${kingdomId}:psro`,
        stage_id: ids.psro, stage_config_path: psroConfigPath,
        control_path: `${psro}/control`, timeout_seconds: manifest.runtime.stages.psro.timeoutSeconds,
        shutdown_margin_seconds: Math.max(1, Math.min(60,
          Math.floor(manifest.runtime.stages.psro.timeoutSeconds / 10))) },
      validation: { kind: 'stage', stage_root: psro } });
  }
  const state = createCampaignState({ campaignId, evidenceHash: input.evidenceHash,
    runtimeHash: input.runtimeHash, stageIds: input.stageIds });
  const scheduler = createCampaignSchedulerCheckpoint({ evidenceHash: input.evidenceHash,
    controllerFence: 1, revision: 0, tasks });
  const ceilings = runtimeCeilings(manifest.runtime);
  const claim: CampaignLaunchBundle['controller']['claim'] = { expectedRevision: 0, ownerId: '__OWNER__',
    leaseMs: 60_000, requestedCeilings: ceilings, runtimeHash: input.runtimeHash,
    taskResources: Object.fromEntries(tasks.map((task) => [task.taskId,
      { containers: task.containers, cpus: task.cpus }])),
    ...(authorizationToken ? { authorization: { token: authorizationToken, ceilings } } : {}) };
  const controller = { campaign_root: campaignRoot, claim, evidence_hash: input.evidenceHash, tasks: configs,
    limits: { maxActiveContainers: manifest.runtime.maxActiveContainers,
      maxActiveCpus: manifest.runtime.maxActiveCpus }, source_image: manifest.evidence.sourceImage,
    lease_renew_interval_seconds: 20, controller_timeout_seconds: manifest.runtime.controllerTimeoutSeconds,
    shutdown_margin_seconds: Math.max(1, Math.min(60, Math.floor(manifest.runtime.controllerTimeoutSeconds / 10))),
    poll_interval_seconds: 2, dispatch_batch_size: manifest.runtime.dispatchBatchSize,
    retry_backoff_seconds: manifest.runtime.retryBackoffSeconds,
    retry_backoff_max_seconds: manifest.runtime.retryBackoffMaxSeconds };
  return { schemaVersion: 1, campaignRoot, evidenceHash: input.evidenceHash, runtimeHash: input.runtimeHash,
    state, scheduler, tasks: configs, files, controller };
}

export function selectionManifestFromBytes(content: string | Uint8Array): ParsedCampaignSelectionManifest {
  return parseCampaignSelectionManifest(content);
}

export interface CampaignPlanSummary {
  evidenceHash: string; runtimeHash: string; authorizationToken: string; kingdomCount: number;
  taskCount: number; stageCounts: { goldfish: number; matrix: number; psro: number };
  requestedCapacity: { containers: number; cpus: number };
  estimates: { label: 'estimate-only-not-a-code-gate'; maximumContainerSeconds: number;
    estimatedModalComputeUsd: number; matrixChunkFiles: number; downloadFiles: number;
    knownArtifactDownloadLowerBoundBytes: number;
    downloadSizeBasis: 'existing-k009-ranked-and-k008-25-seed-matrix-excludes-checkpoints-and-psro' };
  campaignCostGate: 'none'; workspaceBudget: 'operator-managed-not-verified';
}
export function createCampaignPlanSummary(input: ParsedCampaignManifest,
  authorizationToken: string): CampaignPlanSummary {
  const bundle = createCampaignLaunchBundle(input), manifest = input.manifest;
  const stageCounts = { goldfish: bundle.tasks.filter((entry) => entry.stage === 'goldfish').length,
    matrix: bundle.tasks.filter((entry) => entry.stage === 'matrix').length,
    psro: bundle.tasks.filter((entry) => entry.stage === 'psro').length };
  const maximumContainerSeconds = bundle.tasks.reduce((sum, entry) => sum + entry.timeout_seconds, 0)
    + manifest.runtime.controllerTimeoutSeconds;
  const matrixChunkFiles = manifest.evidence.kingdomIds.length * 50 * 51 / 2 * 5;
  const existingRankedBytes = 1_261_128 * 1024, existingMatrixChunkBytes = 53_220;
  const knownArtifactDownloadLowerBoundBytes = manifest.evidence.kingdomIds.length * existingRankedBytes
    + matrixChunkFiles * existingMatrixChunkBytes;
  const estimatedModalComputeUsd = bundle.tasks.reduce((sum, entry) => sum + entry.timeout_seconds / 3600
    * (entry.cpu * 0.0473 + entry.memory_mib / 1024 * 0.008), 0)
    + manifest.runtime.controllerTimeoutSeconds / 3600 * (0.0473 + 2 * 0.008);
  return { evidenceHash: input.evidenceHash, runtimeHash: input.runtimeHash, authorizationToken,
    kingdomCount: manifest.evidence.kingdomIds.length, taskCount: bundle.tasks.length, stageCounts,
    requestedCapacity: { containers: manifest.runtime.maxActiveContainers, cpus: manifest.runtime.maxActiveCpus },
    estimates: { label: 'estimate-only-not-a-code-gate', maximumContainerSeconds,
      estimatedModalComputeUsd, matrixChunkFiles, downloadFiles: matrixChunkFiles + bundle.tasks.length * 3,
      knownArtifactDownloadLowerBoundBytes,
      downloadSizeBasis: 'existing-k009-ranked-and-k008-25-seed-matrix-excludes-checkpoints-and-psro' },
    campaignCostGate: 'none',
    workspaceBudget: 'operator-managed-not-verified' };
}

export const campaignLaunchBundleHash = (bundle: CampaignLaunchBundle): string => hash(bundle);
