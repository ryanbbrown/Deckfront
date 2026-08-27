import { createHash } from 'node:crypto';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value);
const exact = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const exactKeys = (value: object, keys: readonly string[]): boolean =>
  exact(Object.keys(value).sort(), [...keys].sort());

export type CampaignSchedulerStage = 'goldfish' | 'matrix' | 'psro';
export type CampaignSchedulerTaskStatus = 'blocked' | 'ready' | 'active' | 'incomplete'
  | 'terminal-incomplete' | 'complete';
export interface CampaignSchedulerTask {
  taskId: string; kingdomId: string; stage: CampaignSchedulerStage; shardId: string | null;
  dependencyTaskIds: string[]; status: CampaignSchedulerTaskStatus; readySinceMs: number;
  containers: number; cpus: number;
  callId: string | null; controllerFence: number | null;
}
export interface CampaignSchedulerLimits { maxActiveContainers: number; maxActiveCpus: number }
export interface CampaignSchedulerObservation {
  callId: string; state: 'running' | 'succeeded' | 'failed';
  artifactStatus?: 'complete' | 'incomplete' | 'terminal-incomplete'; reason?: string;
}
export type CampaignSchedulerAction =
  | { kind: 'reattach'; taskId: string; callId: string }
  | { kind: 'complete'; taskId: string; callId: string }
  | { kind: 'incomplete' | 'terminal-incomplete'; taskId: string; callId: string; reason: string }
  | { kind: 'launch'; taskId: string; stage: CampaignSchedulerStage; kingdomId: string;
    shardId: string | null; containers: number; cpus: number; controllerFence: number };

const TASK_KEYS = ['taskId', 'kingdomId', 'stage', 'shardId', 'dependencyTaskIds', 'status',
  'readySinceMs', 'containers', 'cpus', 'callId', 'controllerFence'] as const;
function validTask(task: unknown): task is CampaignSchedulerTask {
  if (!object(task) || !exactKeys(task, TASK_KEYS)) return false;
  return typeof task.taskId === 'string' && task.taskId.length > 0
    && typeof task.kingdomId === 'string' && task.kingdomId.length > 0
    && ['goldfish', 'matrix', 'psro'].includes(String(task.stage))
    && (task.stage === 'goldfish' ? typeof task.shardId === 'string' && task.shardId.length > 0 : task.shardId === null)
    && Array.isArray(task.dependencyTaskIds)
    && task.dependencyTaskIds.every((id) => typeof id === 'string' && id.length > 0)
    && new Set(task.dependencyTaskIds).size === task.dependencyTaskIds.length
    && ['blocked', 'ready', 'active', 'incomplete', 'terminal-incomplete', 'complete'].includes(String(task.status))
    && (task.status === 'blocked' ? task.dependencyTaskIds.length > 0 : true)
    && Number.isSafeInteger(task.readySinceMs) && Number(task.readySinceMs) >= 0
    && Number.isSafeInteger(task.containers) && Number(task.containers) > 0
    && Number.isSafeInteger(task.cpus) && Number(task.cpus) > 0
    && (task.status === 'active'
      ? typeof task.callId === 'string' && task.callId.length > 0
        && Number.isSafeInteger(task.controllerFence) && Number(task.controllerFence) >= 1
      : task.callId === null && task.controllerFence === null);
}
function stagePriority(stage: CampaignSchedulerStage): number {
  return stage === 'psro' ? 0 : stage === 'matrix' ? 1 : 2;
}
function taskOrder(left: CampaignSchedulerTask, right: CampaignSchedulerTask): number {
  return stagePriority(left.stage) - stagePriority(right.stage)
    || left.readySinceMs - right.readySinceMs
    || left.kingdomId.localeCompare(right.kingdomId)
    || left.taskId.localeCompare(right.taskId);
}
function activeStageKey(task: CampaignSchedulerTask): string { return `${task.kingdomId}:${task.stage}`; }

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
  const byId = new Map((tasks as readonly CampaignSchedulerTask[]).map((task) => [task.taskId, task]));
  return (tasks as readonly CampaignSchedulerTask[]).every((task) => task.dependencyTaskIds.every((id) =>
    ids.has(id) && id !== task.taskId) && (task.status === 'blocked'
    || task.dependencyTaskIds.every((id) => byId.get(id)?.status === 'complete')));
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
  for (const task of input.tasks.filter((entry) => entry.status === 'active').sort(taskOrder)) {
    const observation = observationByCall.get(task.callId!);
    if (!observation || observation.state === 'running') {
      actions.push({ kind: 'reattach', taskId: task.taskId, callId: task.callId! });
      containers += task.containers; cpus += task.cpus; occupied.add(activeStageKey(task));
    } else if (observation.state === 'succeeded' && observation.artifactStatus === 'complete') {
      actions.push({ kind: 'complete', taskId: task.taskId, callId: task.callId! });
    } else if (observation.state === 'succeeded' && observation.artifactStatus === 'terminal-incomplete') {
      actions.push({ kind: 'terminal-incomplete', taskId: task.taskId, callId: task.callId!,
        reason: observation.reason || 'fixed protocol ended without an evidence decision' });
    } else {
      actions.push({ kind: 'incomplete', taskId: task.taskId, callId: task.callId!,
        reason: observation.reason || (observation.state === 'succeeded'
          ? 'completed call produced incomplete or invalid stage evidence' : 'saved Modal call failed') });
    }
  }
  if (containers > input.limits.maxActiveContainers || cpus > input.limits.maxActiveCpus) {
    throw new Error('Saved campaign calls exceed the current runtime limits.');
  }
  if (input.stopLaunching) return actions;
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
  | { kind: 'launched'; taskId: string; callId: string; controllerFence: number }
  | { kind: 'completed'; taskId: string; callId: string }
  | { kind: 'incomplete' | 'terminal-incomplete'; taskId: string; callId: string }
  | { kind: 'ready'; taskId: string };
export function applyCampaignSchedulerUpdates(tasks: readonly CampaignSchedulerTask[],
  updates: readonly CampaignSchedulerUpdate[]): CampaignSchedulerTask[] {
  if (!validateCampaignSchedulerTasks(tasks) || new Set(updates.map((entry) => entry.taskId)).size !== updates.length) {
    throw new Error('Campaign scheduler updates are invalid.');
  }
  const byId = new Map(tasks.map((task) => [task.taskId, structuredClone(task)]));
  for (const update of updates) {
    const task = byId.get(update.taskId);
    if (!task) throw new Error(`Unknown campaign scheduler task ${update.taskId}.`);
    if (update.kind === 'launched') {
      if (task.status !== 'ready' || !update.callId || !Number.isSafeInteger(update.controllerFence)
        || update.controllerFence < 1) throw new Error('Campaign scheduler launch update is stale.');
      task.status = 'active'; task.callId = update.callId; task.controllerFence = update.controllerFence;
    } else if (update.kind === 'completed' || update.kind === 'incomplete'
      || update.kind === 'terminal-incomplete') {
      if (task.status !== 'active' || task.callId !== update.callId) {
        throw new Error('Campaign scheduler call result update is stale.');
      }
      task.status = update.kind === 'completed' ? 'complete' : update.kind;
      task.callId = null; task.controllerFence = null;
    } else {
      if (task.status !== 'incomplete') throw new Error('Only incomplete campaign work can become ready.');
      task.status = 'ready'; task.callId = null; task.controllerFence = null;
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
      left.taskId.localeCompare(right.taskId)), checkpointHash: '' };
  return { ...base, checkpointHash: hash(base) };
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
