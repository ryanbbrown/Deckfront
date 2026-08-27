import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import rawSmokeManifest from '../../src/sim/balance-smoke-suite-manifest.json' with { type: 'json' };
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
function sortedObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0).map(([key, held]) => [key, sortedObjectKeys(held)]));
}
function productionLaunchTasks(): CampaignSchedulerTask[] {
  return rawSmokeManifest.selectedKingdomIds.flatMap((kingdomId) => {
    const prefix = `${kingdomId}:goldfish`, stageOne = `${prefix}:stage-one:shard-000`;
    const merge = `${prefix}:merge-stage-one`, stageTwo = `${prefix}:stage-two:0`;
    const finalize = `${prefix}:finalize`, matrix = `${kingdomId}:matrix`;
    return [
      task({ taskId: stageOne, kingdomId, stage: 'goldfish', shardId: 'stage-one:shard-000',
        readySinceMs: 0, cpus: 4 }),
      task({ taskId: merge, kingdomId, stage: 'goldfish', shardId: 'merge-stage-one',
        dependencyTaskIds: [stageOne], status: 'blocked', readySinceMs: 0, cpus: 4 }),
      task({ taskId: stageTwo, kingdomId, stage: 'goldfish', shardId: 'stage-two:0',
        dependencyTaskIds: [merge], status: 'blocked', readySinceMs: 0, cpus: 4 }),
      task({ taskId: finalize, kingdomId, stage: 'goldfish', shardId: 'finalize',
        dependencyTaskIds: [stageTwo], status: 'blocked', readySinceMs: 0, cpus: 4 }),
      task({ taskId: matrix, kingdomId, stage: 'matrix', dependencyTaskIds: [finalize],
        status: 'blocked', readySinceMs: 0, cpus: 8 }),
      task({ taskId: `${kingdomId}:psro`, kingdomId, stage: 'psro', dependencyTaskIds: [matrix],
        status: 'blocked', readySinceMs: 0, cpus: 8 })
    ];
  });
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

  it('resumes only missing work while retaining completed and currently bound Goldfish calls', () => {
    const stageOne = task({ taskId: 'k1-stage-one', kingdomId: 'k1', stage: 'goldfish',
      shardId: 'stage-one', status: 'complete', artifactPaths: ['stage-one.json'],
      artifactHashes: { 'stage-one.json': 'a'.repeat(64) } });
    const merge = task({ taskId: 'k1-merge', kingdomId: 'k1', stage: 'goldfish', shardId: 'merge',
      dependencyTaskIds: [stageOne.taskId], status: 'complete', artifactPaths: ['cohort.json'],
      artifactHashes: { 'cohort.json': 'b'.repeat(64) } });
    const stageTwo = task({ taskId: 'k1-stage-two', kingdomId: 'k1', stage: 'goldfish',
      shardId: 'stage-two', dependencyTaskIds: [merge.taskId], status: 'incomplete',
      reason: 'bounded response ingestion failed' });
    const current = task({ taskId: 'k2-stage-one', kingdomId: 'k2', stage: 'goldfish',
      shardId: 'stage-one', status: 'active', callId: 'fc-current' });
    const ready = applyCampaignSchedulerUpdates([stageOne, merge, stageTwo, current], [
      { kind: 'ready', taskId: stageTwo.taskId, nowMs: 10 }
    ]);
    const actions = planCampaignSchedulerTick({ tasks: ready, observations: [],
      limits: { maxActiveContainers: 2, maxActiveCpus: 8 }, controllerFence: 3, stopLaunching: false });
    expect(actions).toEqual([
      { kind: 'reattach', taskId: current.taskId, callId: 'fc-current' },
      { kind: 'launch', taskId: stageTwo.taskId, stage: 'goldfish', kingdomId: 'k1',
        shardId: 'stage-two', containers: 1, cpus: 4, controllerFence: 3 }
    ]);
    expect(actions.some((action) => action.taskId === stageOne.taskId || action.taskId === merge.taskId)).toBe(false);
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

  it('validates the exact persisted thirty-kingdom production scheduler bundle', () => {
    expect(rawSmokeManifest.selectedKingdomIds).toHaveLength(30);
    const tasks = productionLaunchTasks();
    expect(tasks).toHaveLength(180);
    expect(new Set(tasks.filter((entry) => entry.stage === 'goldfish').map((entry) => entry.cpus)))
      .toEqual(new Set([4]));
    expect(new Set(tasks.filter((entry) => entry.stage !== 'goldfish').map((entry) => entry.cpus)))
      .toEqual(new Set([8]));
    const checkpoint = createCampaignSchedulerCheckpoint({
      evidenceHash: '236025f8c1b7fe9bcd2353d6bc971106d390ea77c031d0c51ba023e324d773a8',
      controllerFence: 1, revision: 0, tasks });
    expect(checkpoint.checkpointHash)
      .toBe('a827369b58ab8f562eb34e4508eac68e610666da46b475beeae24bf872061912');
    const persisted = JSON.parse(JSON.stringify(sortedObjectKeys(checkpoint))) as unknown;
    expect(validateCampaignSchedulerCheckpoint(persisted)).toBe(true);
    const command = spawnSync('npx', ['tsx', 'scripts/strategy_search_campaign_scheduler.ts', 'validate'], {
      cwd: process.cwd(), input: JSON.stringify(persisted), encoding: 'utf8', timeout: 30_000 });
    expect(command.status, command.stderr).toBe(0);
    expect(validateCampaignSchedulerCheckpoint(JSON.parse(command.stdout))).toBe(true);
    const actions = planCampaignSchedulerTick({ tasks, observations: [],
      limits: { maxActiveContainers: 100, maxActiveCpus: 800 }, controllerFence: 1,
      stopLaunching: false });
    expect(actions).toHaveLength(30);
    expect(actions.every((entry) => entry.kind === 'launch' && entry.stage === 'goldfish'
      && entry.containers === 1 && entry.cpus === 4)).toBe(true);
  }, 30_000);

  it('fails closed when the runtime cannot fit the smallest eligible stage', () => {
    expect(() => planCampaignSchedulerTick({ tasks: [task({ taskId: 'psro', kingdomId: 'k', stage: 'psro',
      containers: 2, cpus: 8 })], observations: [], limits: { maxActiveContainers: 1, maxActiveCpus: 4 },
    controllerFence: 1, stopLaunching: false })).toThrow('smallest eligible');
  });
});
