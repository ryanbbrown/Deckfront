import { describe, expect, it } from 'vitest';
import {
  applyCampaignSchedulerUpdates, createCampaignSchedulerCheckpoint, planCampaignSchedulerTick,
  recoverCampaignAmbiguousLaunch, reconfigureCampaignSchedulerTasks, refenceCampaignSchedulerCheckpoint,
  repairCampaignSchedulerTask, validateCampaignSchedulerCheckpoint
} from '../../src/sim/strategySearchScheduler';
import type { CampaignSchedulerTask } from '../../src/sim/strategySearchScheduler';

function task(input: Partial<CampaignSchedulerTask> & Pick<CampaignSchedulerTask,
  'taskId' | 'kingdomId' | 'stage'>): CampaignSchedulerTask {
  return { taskId: input.taskId, kingdomId: input.kingdomId, stage: input.stage,
    shardId: input.stage === 'goldfish' ? input.shardId ?? 'shard-0' : null,
    dependencyTaskIds: input.dependencyTaskIds ?? [], status: input.status ?? 'ready',
    readySinceMs: input.readySinceMs ?? 1,
    containers: input.containers ?? 1, cpus: input.cpus ?? 4,
    launchIntentId: input.status === 'active' || input.status === 'launching'
      ? input.launchIntentId ?? 'd'.repeat(64) : null,
    callId: input.status === 'active' ? input.callId ?? `call-${input.taskId}` : null,
    controllerFence: input.status === 'active' || input.status === 'launching'
      ? input.controllerFence ?? 3 : null,
    reason: input.reason ?? null, artifactPaths: input.artifactPaths ?? [],
    artifactHashes: input.artifactHashes ?? {}, attemptCount: input.attemptCount ?? 0,
    retryNotBeforeMs: input.retryNotBeforeMs ?? 0 };
}

describe('fenced global campaign scheduler', () => {
  it('reattaches saved calls before launches and never relaunches a live task', () => {
    const tasks = [task({ taskId: 'active', kingdomId: 'k1', stage: 'matrix', status: 'active' }),
      task({ taskId: 'psro', kingdomId: 'k2', stage: 'psro' })];
    const actions = planCampaignSchedulerTick({ tasks, observations: [],
      limits: { maxActiveContainers: 2, maxActiveCpus: 8 }, controllerFence: 3, stopLaunching: false });
    expect(actions).toEqual([
      { kind: 'reattach', taskId: 'active', callId: 'call-active' },
      { kind: 'launch', taskId: 'psro', stage: 'psro', kingdomId: 'k2', shardId: null,
        containers: 1, cpus: 4, controllerFence: 3 }
    ]);
  });

  it('prioritizes PSRO then Matrix and globally pools kingdom Goldfish shards', () => {
    const tasks = [task({ taskId: 'g2', kingdomId: 'k2', stage: 'goldfish', readySinceMs: 1 }),
      task({ taskId: 'g1', kingdomId: 'k1', stage: 'goldfish', readySinceMs: 2 }),
      task({ taskId: 'matrix', kingdomId: 'k3', stage: 'matrix', readySinceMs: 3 }),
      task({ taskId: 'psro', kingdomId: 'k4', stage: 'psro', readySinceMs: 4 })];
    const actions = planCampaignSchedulerTick({ tasks, observations: [],
      limits: { maxActiveContainers: 4, maxActiveCpus: 16 }, controllerFence: 5, stopLaunching: false });
    expect(actions.filter((entry) => entry.kind === 'launch').map((entry) => entry.taskId))
      .toEqual(['psro', 'matrix', 'g2', 'g1']);
  });

  it('rotates same-stage Goldfish shards across kingdoms before taking a second shard', () => {
    const tasks = ['k1', 'k2', 'k3'].flatMap((kingdomId) => [0, 1].map((shard) => task({
      taskId: `${kingdomId}-${shard}`, kingdomId, stage: 'goldfish',
      shardId: `stage-one:shard-${String(shard).padStart(3, '0')}`, readySinceMs: 1 })));
    const actions = planCampaignSchedulerTick({ tasks, observations: [],
      limits: { maxActiveContainers: 3, maxActiveCpus: 12 }, controllerFence: 4, stopLaunching: false });
    expect(actions.filter((entry) => entry.kind === 'launch').map((entry) => entry.taskId))
      .toEqual(['k1-0', 'k2-0', 'k3-0']);
  });

  it('runs independent canonical shards from the same kingdom concurrently', () => {
    const tasks = [task({ taskId: 'g1', kingdomId: 'k', stage: 'goldfish', shardId: 'stage-one-1' }),
      task({ taskId: 'g2', kingdomId: 'k', stage: 'goldfish', shardId: 'stage-one-2' })];
    const actions = planCampaignSchedulerTick({ tasks, observations: [],
      limits: { maxActiveContainers: 2, maxActiveCpus: 8 }, controllerFence: 4, stopLaunching: false });
    expect(actions.filter((entry) => entry.kind === 'launch').map((entry) => entry.taskId))
      .toEqual(['g1', 'g2']);
  });

  it('never relaunches a durable but unbound launch intent after a crash', () => {
    const ready = task({ taskId: 'g', kingdomId: 'k', stage: 'goldfish' });
    const launching = applyCampaignSchedulerUpdates([ready], [{ kind: 'intent', taskId: 'g',
      launchIntentId: 'c'.repeat(64), controllerFence: 3 }]);
    const actions = planCampaignSchedulerTick({ tasks: launching, observations: [],
      limits: { maxActiveContainers: 2, maxActiveCpus: 8 }, controllerFence: 3, stopLaunching: false });
    expect(actions).toEqual([{ kind: 'ambiguous-launch', taskId: 'g', launchIntentId: 'c'.repeat(64),
      reason: 'durable launch intent has no bound Modal call ID; automatic relaunch is unsafe' }]);
  });

  it('re-fences takeover state while keeping saved active call IDs for reattachment', () => {
    const active = task({ taskId: 'matrix', kingdomId: 'k', stage: 'matrix', status: 'active',
      callId: 'fc-saved', controllerFence: 2 });
    const checkpoint = createCampaignSchedulerCheckpoint({ evidenceHash: 'a'.repeat(64),
      controllerFence: 2, revision: 4, tasks: [active] });
    const takeover = refenceCampaignSchedulerCheckpoint(checkpoint, 3);
    expect(takeover.tasks[0]).toMatchObject({ status: 'active', callId: 'fc-saved', controllerFence: 3 });
    expect(planCampaignSchedulerTick({ tasks: takeover.tasks, observations: [],
      limits: { maxActiveContainers: 1, maxActiveCpus: 4 }, controllerFence: 3,
      stopLaunching: false })).toEqual([{ kind: 'reattach', taskId: 'matrix', callId: 'fc-saved' }]);
  });

  it('reserves tight capacity for waiting whole stages and proves one-container progress', () => {
    const occupied = task({ taskId: 'occupied', kingdomId: 'k0', stage: 'goldfish', status: 'active', cpus: 2 });
    const waiting = task({ taskId: 'matrix', kingdomId: 'k1', stage: 'matrix', cpus: 5 });
    const shard = task({ taskId: 'shard', kingdomId: 'k2', stage: 'goldfish', cpus: 2 });
    const blocked = planCampaignSchedulerTick({ tasks: [occupied, waiting, shard], observations: [],
      limits: { maxActiveContainers: 2, maxActiveCpus: 6 }, controllerFence: 3, stopLaunching: false });
    expect(blocked.some((entry) => entry.kind === 'launch')).toBe(false);
    const progress = planCampaignSchedulerTick({ tasks: [waiting], observations: [],
      limits: { maxActiveContainers: 1, maxActiveCpus: 5 }, controllerFence: 3, stopLaunching: false });
    expect(progress).toHaveLength(1); expect(progress[0]).toMatchObject({ kind: 'launch', taskId: 'matrix' });
  });

  it('isolates one failed kingdom and rejects stale or malformed scheduler evidence', () => {
    const failed = task({ taskId: 'failed', kingdomId: 'k1', stage: 'psro', status: 'active' });
    const ready = task({ taskId: 'ready', kingdomId: 'k2', stage: 'matrix' });
    const actions = planCampaignSchedulerTick({ tasks: [failed, ready], observations: [
      { callId: 'call-failed', state: 'failed', reason: 'worker process failed' }
    ], limits: { maxActiveContainers: 1, maxActiveCpus: 4 }, controllerFence: 9, stopLaunching: false });
    expect(actions).toEqual([
      { kind: 'incomplete', taskId: 'failed', callId: 'call-failed', reason: 'worker process failed',
        artifactPaths: [], artifactHashes: {} },
      { kind: 'launch', taskId: 'ready', stage: 'matrix', kingdomId: 'k2', shardId: null,
        containers: 1, cpus: 4, controllerFence: 9 }
    ]);
    const checkpoint = createCampaignSchedulerCheckpoint({ evidenceHash: 'a'.repeat(64),
      controllerFence: 9, revision: 3, tasks: [ready, failed] });
    expect(validateCampaignSchedulerCheckpoint(checkpoint)).toBe(true);
    expect(validateCampaignSchedulerCheckpoint({ ...checkpoint, unexpected: true })).toBe(false);
    expect(validateCampaignSchedulerCheckpoint({ ...checkpoint, controllerFence: 8 })).toBe(false);
  });

  it('releases downstream work only after every declared dependency completes', () => {
    const goldfish = task({ taskId: 'goldfish', kingdomId: 'k', stage: 'goldfish',
      status: 'active', callId: 'call-goldfish' });
    const matrix = task({ taskId: 'matrix', kingdomId: 'k', stage: 'matrix', status: 'blocked',
      dependencyTaskIds: ['goldfish'] });
    const updated = applyCampaignSchedulerUpdates([goldfish, matrix], [
      { kind: 'completed', taskId: 'goldfish', callId: 'call-goldfish',
        artifactPaths: ['goldfish.json'], artifactHashes: { 'goldfish.json': 'a'.repeat(64) } }
    ]);
    expect(updated.find((entry) => entry.taskId === 'matrix')?.status).toBe('ready');
  });

  it('does not replay fixed-protocol terminal-incomplete work', () => {
    const active = task({ taskId: 'psro', kingdomId: 'k', stage: 'psro', status: 'active' });
    const actions = planCampaignSchedulerTick({ tasks: [active], observations: [
      { callId: 'call-psro', state: 'succeeded', artifactStatus: 'terminal-incomplete' }
    ], limits: { maxActiveContainers: 1, maxActiveCpus: 4 }, controllerFence: 3, stopLaunching: false });
    expect(actions[0]).toMatchObject({ kind: 'terminal-incomplete', taskId: 'psro' });
    const updated = applyCampaignSchedulerUpdates([active], [
      { kind: 'terminal-incomplete', taskId: 'psro', callId: 'call-psro', reason: 'look cap',
        artifactPaths: ['look.json'], artifactHashes: { 'look.json': 'b'.repeat(64) } }
    ]);
    expect(updated[0]?.status).toBe('terminal-incomplete');
    expect(planCampaignSchedulerTick({ tasks: updated, observations: [],
      limits: { maxActiveContainers: 1, maxActiveCpus: 4 }, controllerFence: 3,
      stopLaunching: false })).toEqual([]);
  });

  it('persists parameterized retry delay without imposing an attempt cap', () => {
    const active = task({ taskId: 'matrix', kingdomId: 'k', stage: 'matrix', status: 'active',
      attemptCount: 12 });
    const incomplete = applyCampaignSchedulerUpdates([active], [{ kind: 'incomplete', taskId: 'matrix',
      callId: 'call-matrix', reason: 'platform failure', artifactPaths: [], artifactHashes: {},
      retryNotBeforeMs: 20_000 }]);
    expect(incomplete[0]).toMatchObject({ status: 'incomplete', attemptCount: 12, retryNotBeforeMs: 20_000 });
    expect(() => applyCampaignSchedulerUpdates(incomplete,
      [{ kind: 'ready', taskId: 'matrix', nowMs: 19_999 }])).toThrow('due incomplete');
    const ready = applyCampaignSchedulerUpdates(incomplete, [{ kind: 'ready', taskId: 'matrix', nowMs: 20_000 }]);
    const relaunched = applyCampaignSchedulerUpdates(ready, [{ kind: 'intent', taskId: 'matrix',
      launchIntentId: 'e'.repeat(64), controllerFence: 4 }]);
    expect(relaunched[0]).toMatchObject({ status: 'launching', attemptCount: 13 });
  });

  it('repairs completed dependency closure and recovers only explicitly selected ambiguous launches', () => {
    const goldfish = task({ taskId: 'goldfish', kingdomId: 'k', stage: 'goldfish', status: 'complete',
      artifactPaths: ['ranked.json'], artifactHashes: { 'ranked.json': 'a'.repeat(64) } });
    const matrix = task({ taskId: 'matrix', kingdomId: 'k', stage: 'matrix', status: 'complete',
      dependencyTaskIds: ['goldfish'], artifactPaths: ['matrix.json'],
      artifactHashes: { 'matrix.json': 'b'.repeat(64) } });
    const repaired = repairCampaignSchedulerTask([goldfish, matrix], { taskId: 'goldfish',
      reason: 'ranked hash differs', artifactPaths: ['ranked.json'],
      artifactHashes: { 'ranked.json': 'a'.repeat(64) } });
    expect(repaired.map((entry) => [entry.taskId, entry.status])).toEqual([
      ['goldfish', 'incomplete'], ['matrix', 'blocked']]);
    const launching = task({ taskId: 'psro', kingdomId: 'k2', stage: 'psro', status: 'launching' });
    expect(recoverCampaignAmbiguousLaunch([launching], { taskId: 'psro', nowMs: 9 })[0])
      .toMatchObject({ status: 'ready', readySinceMs: 9, attemptCount: 0 });
    expect(() => recoverCampaignAmbiguousLaunch([task({ taskId: 'live', kingdomId: 'k', stage: 'matrix',
      status: 'active' })], { taskId: 'live', nowMs: 9 })).toThrow('no ambiguous');
  });

  it('updates pending runtime resources but preserves saved active allocations', () => {
    const active = task({ taskId: 'active', kingdomId: 'k1', stage: 'matrix', status: 'active', cpus: 4 });
    const ready = task({ taskId: 'ready', kingdomId: 'k2', stage: 'psro', cpus: 4 });
    const changed = reconfigureCampaignSchedulerTasks([active, ready], {
      active: { containers: 1, cpus: 8 }, ready: { containers: 1, cpus: 8 } });
    expect(changed.find((entry) => entry.taskId === 'active')?.cpus).toBe(4);
    expect(changed.find((entry) => entry.taskId === 'ready')?.cpus).toBe(8);
    expect(() => reconfigureCampaignSchedulerTasks([active, ready], {
      active: { containers: 1, cpus: 8 } })).toThrow('do not match');
  });

  it('fails closed when the runtime cannot fit the smallest eligible stage', () => {
    expect(() => planCampaignSchedulerTick({ tasks: [task({ taskId: 'psro', kingdomId: 'k', stage: 'psro',
      containers: 2, cpus: 8 })], observations: [], limits: { maxActiveContainers: 1, maxActiveCpus: 4 },
    controllerFence: 1, stopLaunching: false })).toThrow('smallest eligible');
  });
});
