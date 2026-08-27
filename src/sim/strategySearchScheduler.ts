import { createHash } from 'node:crypto';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value);
const exact = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const exactKeys = (value: object, keys: readonly string[]): boolean =>
  exact(Object.keys(value).sort(), [...keys].sort());

export type CampaignSchedulerStage = 'goldfish' | 'matrix' | 'psro';
export type CampaignSchedulerTaskStatus = 'blocked' | 'ready' | 'launching' | 'active' | 'incomplete'
  | 'terminal-incomplete' | 'complete';
export interface CampaignSchedulerTask {
  taskId: string; kingdomId: string; stage: CampaignSchedulerStage; shardId: string | null;
  dependencyTaskIds: string[]; status: CampaignSchedulerTaskStatus; readySinceMs: number;
  containers: number; cpus: number; launchIntentId: string | null; callId: string | null;
  controllerFence: number | null; reason: string | null; artifactPaths: string[];
  artifactHashes: Record<string, string>; attemptCount: number; retryNotBeforeMs: number;
}
export interface CampaignSchedulerLimits { maxActiveContainers: number; maxActiveCpus: number }
export interface CampaignSchedulerObservation {
  callId: string; state: 'running' | 'succeeded' | 'failed';
  artifactStatus?: 'complete' | 'incomplete' | 'terminal-incomplete'; reason?: string;
  artifactPaths?: string[]; artifactHashes?: Record<string, string>;
}
export type CampaignSchedulerAction =
  | { kind: 'reattach'; taskId: string; callId: string }
  | { kind: 'ambiguous-launch'; taskId: string; launchIntentId: string; reason: string }
  | { kind: 'complete'; taskId: string; callId: string; artifactPaths: string[];
    artifactHashes: Record<string, string> }
  | { kind: 'incomplete' | 'terminal-incomplete'; taskId: string; callId: string; reason: string;
    artifactPaths: string[]; artifactHashes: Record<string, string> }
  | { kind: 'launch'; taskId: string; stage: CampaignSchedulerStage; kingdomId: string;
    shardId: string | null; containers: number; cpus: number; controllerFence: number };

const TASK_KEYS = ['taskId', 'kingdomId', 'stage', 'shardId', 'dependencyTaskIds', 'status',
  'readySinceMs', 'containers', 'cpus', 'launchIntentId', 'callId', 'controllerFence', 'reason',
  'artifactPaths', 'artifactHashes', 'attemptCount', 'retryNotBeforeMs'] as const;
function validArtifacts(task: CampaignSchedulerTask): boolean {
  return Array.isArray(task.artifactPaths) && new Set(task.artifactPaths).size === task.artifactPaths.length
    && task.artifactPaths.every((entry) => typeof entry === 'string' && entry.length > 0)
    && object(task.artifactHashes) && Object.values(task.artifactHashes).every(sha);
}
function validTask(task: unknown): task is CampaignSchedulerTask {
  if (!object(task) || !exactKeys(task, TASK_KEYS)) return false;
  const held = task as unknown as CampaignSchedulerTask;
  const inactiveIdentity = held.launchIntentId === null && held.callId === null && held.controllerFence === null;
  const emptyOutcome = held.reason === null && held.artifactPaths.length === 0
    && Object.keys(held.artifactHashes).length === 0;
  return typeof held.taskId === 'string' && held.taskId.length > 0
    && typeof held.kingdomId === 'string' && held.kingdomId.length > 0
    && ['goldfish', 'matrix', 'psro'].includes(held.stage)
    && (held.stage === 'goldfish' ? typeof held.shardId === 'string' && held.shardId.length > 0 : held.shardId === null)
    && Array.isArray(held.dependencyTaskIds)
    && held.dependencyTaskIds.every((id) => typeof id === 'string' && id.length > 0)
    && new Set(held.dependencyTaskIds).size === held.dependencyTaskIds.length
    && ['blocked', 'ready', 'launching', 'active', 'incomplete', 'terminal-incomplete', 'complete']
      .includes(held.status)
    && (held.status === 'blocked' ? held.dependencyTaskIds.length > 0 : true)
    && Number.isSafeInteger(held.readySinceMs) && held.readySinceMs >= 0
    && Number.isSafeInteger(held.containers) && held.containers > 0
    && Number.isSafeInteger(held.cpus) && held.cpus > 0 && validArtifacts(held)
    && Number.isSafeInteger(held.attemptCount) && held.attemptCount >= 0
    && Number.isSafeInteger(held.retryNotBeforeMs) && held.retryNotBeforeMs >= 0
    && (held.status === 'launching'
      ? Boolean(held.launchIntentId) && held.callId === null && Number.isSafeInteger(held.controllerFence)
        && held.controllerFence! >= 1 && emptyOutcome
      : held.status === 'active'
        ? Boolean(held.launchIntentId) && Boolean(held.callId) && Number.isSafeInteger(held.controllerFence)
          && held.controllerFence! >= 1 && emptyOutcome
        : held.status === 'complete'
          ? inactiveIdentity && held.reason === null && Object.keys(held.artifactHashes).length > 0
          : held.status === 'incomplete' || held.status === 'terminal-incomplete'
            ? inactiveIdentity && Boolean(held.reason)
            : inactiveIdentity && emptyOutcome);
}
function stagePriority(stage: CampaignSchedulerStage): number {
  return stage === 'psro' ? 0 : stage === 'matrix' ? 1 : 2;
}
function taskOrder(left: CampaignSchedulerTask, right: CampaignSchedulerTask): number {
  const stage = stagePriority(left.stage) - stagePriority(right.stage);
  if (stage) return stage;
  const ready = left.readySinceMs - right.readySinceMs;
  if (ready) return ready;
  if (left.stage === 'goldfish' && right.stage === 'goldfish') {
    const shard = left.shardId! < right.shardId! ? -1 : left.shardId! > right.shardId! ? 1 : 0;
    if (shard) return shard;
  }
  return (left.kingdomId < right.kingdomId ? -1 : left.kingdomId > right.kingdomId ? 1 : 0)
    || (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0);
}
function activeStageKey(task: CampaignSchedulerTask): string {
  return task.stage === 'goldfish' ? `goldfish:${task.taskId}` : `${task.kingdomId}:${task.stage}`;
}

export function validateCampaignSchedulerTasks(tasks: readonly unknown[]): tasks is readonly CampaignSchedulerTask[] {
  const ids = new Set<string>(), goldfish = new Set<string>();
  for (const task of tasks) {
    if (!validTask(task) || ids.has(task.taskId)) return false;
    ids.add(task.taskId);
    if (task.stage === 'goldfish') {
      const key = `${task.kingdomId}:${task.shardId}`;
      if (goldfish.has(key)) return false;
      goldfish.add(key);
    }
  }
  const held = tasks as readonly CampaignSchedulerTask[];
  const byId = new Map(held.map((task) => [task.taskId, task]));
  return held.every((task) => task.dependencyTaskIds.every((id) => ids.has(id) && id !== task.taskId)
    && (task.status === 'blocked' || task.dependencyTaskIds.every((id) => byId.get(id)?.status === 'complete')));
}

export function planCampaignSchedulerTick(input: {
  tasks: readonly CampaignSchedulerTask[]; observations: readonly CampaignSchedulerObservation[];
  limits: CampaignSchedulerLimits; controllerFence: number; stopLaunching: boolean;
}): CampaignSchedulerAction[] {
  if (!validateCampaignSchedulerTasks(input.tasks) || !Number.isSafeInteger(input.controllerFence)
    || input.controllerFence < 1 || !Number.isSafeInteger(input.limits.maxActiveContainers)
    || input.limits.maxActiveContainers < 1 || !Number.isSafeInteger(input.limits.maxActiveCpus)
    || input.limits.maxActiveCpus < 1) throw new Error('Campaign scheduler input is invalid.');
  const observationByCall = new Map(input.observations.map((entry) => [entry.callId, entry]));
  if (observationByCall.size !== input.observations.length) throw new Error('Campaign scheduler observations collide.');
  const actions: CampaignSchedulerAction[] = [];
  let containers = 0, cpus = 0;
  const occupied = new Set<string>();
  for (const task of input.tasks.filter((entry) => entry.status === 'launching' || entry.status === 'active')
    .sort(taskOrder)) {
    containers += task.containers; cpus += task.cpus; occupied.add(activeStageKey(task));
    if (task.status === 'launching') {
      actions.push({ kind: 'ambiguous-launch', taskId: task.taskId, launchIntentId: task.launchIntentId!,
        reason: 'durable launch intent has no bound Modal call ID; automatic relaunch is unsafe' });
      continue;
    }
    const observation = observationByCall.get(task.callId!);
    if (!observation || observation.state === 'running') {
      actions.push({ kind: 'reattach', taskId: task.taskId, callId: task.callId! });
    } else if (observation.state === 'succeeded' && observation.artifactStatus === 'complete') {
      actions.push({ kind: 'complete', taskId: task.taskId, callId: task.callId!,
        artifactPaths: observation.artifactPaths ?? [], artifactHashes: observation.artifactHashes ?? {} });
      containers -= task.containers; cpus -= task.cpus; occupied.delete(activeStageKey(task));
    } else if (observation.state === 'succeeded' && observation.artifactStatus === 'terminal-incomplete') {
      actions.push({ kind: 'terminal-incomplete', taskId: task.taskId, callId: task.callId!,
        reason: observation.reason || 'fixed protocol ended without an evidence decision',
        artifactPaths: observation.artifactPaths ?? [], artifactHashes: observation.artifactHashes ?? {} });
      containers -= task.containers; cpus -= task.cpus; occupied.delete(activeStageKey(task));
    } else {
      actions.push({ kind: 'incomplete', taskId: task.taskId, callId: task.callId!,
        reason: observation.reason || (observation.state === 'succeeded'
          ? 'completed call produced incomplete or invalid stage evidence' : 'saved Modal call failed'),
        artifactPaths: observation.artifactPaths ?? [], artifactHashes: observation.artifactHashes ?? {} });
      containers -= task.containers; cpus -= task.cpus; occupied.delete(activeStageKey(task));
    }
  }
  if (containers > input.limits.maxActiveContainers || cpus > input.limits.maxActiveCpus) {
    throw new Error('Saved campaign calls or launch intents exceed current runtime limits.');
  }
  if (input.stopLaunching || actions.some((action) => action.kind === 'ambiguous-launch')) return actions;
  const ready = input.tasks.filter((task) => task.status === 'ready').sort(taskOrder);
  const smallest = ready.reduce<{ containers: number; cpus: number } | null>((held, task) => !held
    || task.containers < held.containers || task.containers === held.containers && task.cpus < held.cpus
    ? { containers: task.containers, cpus: task.cpus } : held, null);
  if (smallest && (smallest.containers > input.limits.maxActiveContainers
    || smallest.cpus > input.limits.maxActiveCpus)) {
    throw new Error('Runtime profile cannot fit its smallest eligible campaign stage.');
  }
  let waitingWholeStage = false;
  for (const task of ready) {
    if (task.stage === 'goldfish' && waitingWholeStage) continue;
    if (occupied.has(activeStageKey(task))
      || containers + task.containers > input.limits.maxActiveContainers
      || cpus + task.cpus > input.limits.maxActiveCpus) {
      if (task.stage !== 'goldfish') waitingWholeStage = true;
      continue;
    }
    actions.push({ kind: 'launch', taskId: task.taskId, stage: task.stage, kingdomId: task.kingdomId,
      shardId: task.shardId, containers: task.containers, cpus: task.cpus,
      controllerFence: input.controllerFence });
    containers += task.containers; cpus += task.cpus; occupied.add(activeStageKey(task));
  }
  return actions;
}

export type CampaignSchedulerUpdate =
  | { kind: 'intent'; taskId: string; launchIntentId: string; controllerFence: number }
  | { kind: 'bind'; taskId: string; launchIntentId: string; callId: string; controllerFence: number }
  | { kind: 'completed'; taskId: string; callId: string; artifactPaths: string[];
    artifactHashes: Record<string, string> }
  | { kind: 'incomplete' | 'terminal-incomplete'; taskId: string; callId: string; reason: string;
    artifactPaths: string[]; artifactHashes: Record<string, string>; retryNotBeforeMs?: number }
  | { kind: 'ready'; taskId: string; nowMs?: number };
function clearCall(task: CampaignSchedulerTask): void {
  task.launchIntentId = null; task.callId = null; task.controllerFence = null;
}
export function applyCampaignSchedulerUpdates(tasks: readonly CampaignSchedulerTask[],
  updates: readonly CampaignSchedulerUpdate[]): CampaignSchedulerTask[] {
  if (!validateCampaignSchedulerTasks(tasks) || new Set(updates.map((entry) => entry.taskId)).size !== updates.length) {
    throw new Error('Campaign scheduler updates are invalid.');
  }
  const byId = new Map(tasks.map((task) => [task.taskId, structuredClone(task)]));
  for (const update of updates) {
    const task = byId.get(update.taskId);
    if (!task) throw new Error(`Unknown campaign scheduler task ${update.taskId}.`);
    if (update.kind === 'intent') {
      if (task.status !== 'ready' || !sha(update.launchIntentId) || !Number.isSafeInteger(update.controllerFence)
        || update.controllerFence < 1) throw new Error('Campaign scheduler launch intent is stale.');
      task.status = 'launching'; task.launchIntentId = update.launchIntentId;
      task.controllerFence = update.controllerFence; task.attemptCount += 1; task.retryNotBeforeMs = 0;
    } else if (update.kind === 'bind') {
      if (task.status !== 'launching' || task.launchIntentId !== update.launchIntentId
        || task.controllerFence !== update.controllerFence || !update.callId) {
        throw new Error('Campaign scheduler call binding is stale or ambiguous.');
      }
      task.status = 'active'; task.callId = update.callId;
    } else if (update.kind === 'completed' || update.kind === 'incomplete'
      || update.kind === 'terminal-incomplete') {
      if (task.status !== 'active' || task.callId !== update.callId) {
        throw new Error('Campaign scheduler call result update is stale.');
      }
      task.status = update.kind === 'completed' ? 'complete' : update.kind;
      task.reason = update.kind === 'completed' ? null : update.reason;
      task.artifactPaths = [...update.artifactPaths]; task.artifactHashes = { ...update.artifactHashes };
      task.retryNotBeforeMs = update.kind === 'incomplete' ? update.retryNotBeforeMs ?? 0 : 0;
      if (!Number.isSafeInteger(task.retryNotBeforeMs) || task.retryNotBeforeMs < 0) {
        throw new Error('Campaign scheduler retry time is invalid.');
      }
      clearCall(task);
    } else {
      if (update.kind !== 'ready') throw new Error('Unknown campaign scheduler update.');
      if (task.status !== 'incomplete' || (update.nowMs ?? task.retryNotBeforeMs) < task.retryNotBeforeMs) {
        throw new Error('Only due incomplete campaign work can become ready.');
      }
      task.status = 'ready'; task.reason = null; task.artifactPaths = []; task.artifactHashes = {};
      task.readySinceMs = update.nowMs ?? task.retryNotBeforeMs; task.retryNotBeforeMs = 0;
      clearCall(task);
    }
  }
  const result = [...byId.values()];
  for (const task of result) {
    if (task.status === 'blocked' && task.dependencyTaskIds.every((id) => byId.get(id)?.status === 'complete')) {
      task.status = 'ready';
    }
  }
  if (!validateCampaignSchedulerTasks(result)) throw new Error('Campaign scheduler updates produced invalid tasks.');
  return result;
}

export function recoverCampaignAmbiguousLaunch(tasks: readonly CampaignSchedulerTask[], input: {
  taskId: string; nowMs: number }): CampaignSchedulerTask[] {
  if (!validateCampaignSchedulerTasks(tasks)) throw new Error('Campaign scheduler recovery input is invalid.');
  const recovered = tasks.map((task) => structuredClone(task)),
    target = recovered.find((task) => task.taskId === input.taskId);
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0 || !target || target.status !== 'launching' || target.callId !== null || !target.launchIntentId) {
    throw new Error('Campaign task has no ambiguous unbound launch intent.');
  }
  target.status = 'ready'; target.readySinceMs = input.nowMs; target.reason = null;
  target.artifactPaths = []; target.artifactHashes = {}; target.retryNotBeforeMs = 0; clearCall(target);
  if (!validateCampaignSchedulerTasks(recovered)) throw new Error('Campaign scheduler recovery produced invalid tasks.');
  return recovered;
}

export function repairCampaignSchedulerTask(tasks: readonly CampaignSchedulerTask[], input: {
  taskId: string; reason: string; artifactPaths: string[]; artifactHashes: Record<string, string>
}): CampaignSchedulerTask[] {
  if (!validateCampaignSchedulerTasks(tasks) || !input.reason || !Array.isArray(input.artifactPaths)
    || !object(input.artifactHashes) || Object.values(input.artifactHashes).some((value) => !sha(value))) {
    throw new Error('Campaign scheduler repair input is invalid.');
  }
  const byId = new Map(tasks.map((task) => [task.taskId, structuredClone(task)]));
  const target = byId.get(input.taskId);
  if (!target || target.status !== 'complete') throw new Error('Only completed campaign work can be repaired.');
  const affected = new Set([target.taskId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of byId.values()) if (!affected.has(task.taskId)
      && task.dependencyTaskIds.some((id) => affected.has(id))) {
      if (task.status === 'active' || task.status === 'launching') {
        throw new Error('Campaign repair waits for active dependent work to stop.');
      }
      affected.add(task.taskId); changed = true;
    }
  }
  target.status = 'incomplete'; target.reason = input.reason;
  target.artifactPaths = [...input.artifactPaths]; target.artifactHashes = { ...input.artifactHashes };
  target.retryNotBeforeMs = 0; clearCall(target);
  for (const taskId of affected) {
    if (taskId === target.taskId) continue;
    const task = byId.get(taskId)!;
    task.status = 'blocked'; task.reason = null; task.artifactPaths = []; task.artifactHashes = {};
    task.retryNotBeforeMs = 0; clearCall(task);
  }
  const result = [...byId.values()];
  if (!validateCampaignSchedulerTasks(result)) throw new Error('Campaign scheduler repair produced invalid tasks.');
  return result;
}

export function reconfigureCampaignSchedulerTasks(tasks: readonly CampaignSchedulerTask[],
  resources: Readonly<Record<string, { containers: number; cpus: number }>>): CampaignSchedulerTask[] {
  if (!validateCampaignSchedulerTasks(tasks) || !object(resources)
    || !exact(Object.keys(resources).sort(), tasks.map((task) => task.taskId).sort())) {
    throw new Error('Campaign scheduler runtime resources do not match its tasks.');
  }
  const configured = tasks.map((task) => {
    const resource = resources[task.taskId]!;
    if (!Number.isSafeInteger(resource.containers) || resource.containers < 1
      || !Number.isSafeInteger(resource.cpus) || resource.cpus < 1) {
      throw new Error(`Campaign scheduler runtime resource is invalid for ${task.taskId}.`);
    }
    return task.status === 'active' || task.status === 'launching' ? structuredClone(task)
      : { ...structuredClone(task), containers: resource.containers, cpus: resource.cpus };
  });
  if (!validateCampaignSchedulerTasks(configured)) throw new Error('Campaign scheduler runtime update is invalid.');
  return configured;
}

export interface CampaignSchedulerCheckpoint {
  schemaVersion: 1; experiment: 'strategy-search-campaign-scheduler'; evidenceHash: string;
  controllerFence: number; revision: number; tasks: CampaignSchedulerTask[]; checkpointHash: string;
}
export function createCampaignSchedulerCheckpoint(input: Omit<CampaignSchedulerCheckpoint,
  'schemaVersion' | 'experiment' | 'checkpointHash'>): CampaignSchedulerCheckpoint {
  if (!sha(input.evidenceHash) || !Number.isSafeInteger(input.controllerFence) || input.controllerFence < 1
    || !Number.isSafeInteger(input.revision) || input.revision < 0 || !validateCampaignSchedulerTasks(input.tasks)) {
    throw new Error('Campaign scheduler checkpoint input is invalid.');
  }
  const base = { schemaVersion: 1 as const, experiment: 'strategy-search-campaign-scheduler' as const,
    evidenceHash: input.evidenceHash, controllerFence: input.controllerFence, revision: input.revision,
    tasks: input.tasks.map((task) => structuredClone(task)).sort((left, right) =>
      left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0), checkpointHash: '' };
  return { ...base, checkpointHash: hash(base) };
}
export function refenceCampaignSchedulerCheckpoint(checkpoint: CampaignSchedulerCheckpoint,
  controllerFence: number): CampaignSchedulerCheckpoint {
  if (!validateCampaignSchedulerCheckpoint(checkpoint) || !Number.isSafeInteger(controllerFence)
    || controllerFence <= checkpoint.controllerFence) throw new Error('Campaign scheduler takeover fence is invalid.');
  const tasks = checkpoint.tasks.map((task) => ({ ...structuredClone(task),
    ...((task.status === 'active' || task.status === 'launching') ? { controllerFence } : {}) }));
  return createCampaignSchedulerCheckpoint({ evidenceHash: checkpoint.evidenceHash, controllerFence,
    revision: checkpoint.revision + 1, tasks });
}
export function validateCampaignSchedulerCheckpoint(value: unknown): value is CampaignSchedulerCheckpoint {
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'experiment', 'evidenceHash',
    'controllerFence', 'revision', 'tasks', 'checkpointHash'])) return false;
  try {
    const held = value as unknown as CampaignSchedulerCheckpoint;
    return exact(held, createCampaignSchedulerCheckpoint({ evidenceHash: held.evidenceHash,
      controllerFence: held.controllerFence, revision: held.revision, tasks: held.tasks }));
  } catch { return false; }
}
