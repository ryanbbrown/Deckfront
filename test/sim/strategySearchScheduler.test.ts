import { describe, expect, it } from 'vitest';
import {
  applyCampaignSchedulerUpdates, createCampaignSchedulerCheckpoint,
  planCampaignSchedulerTick, validateCampaignSchedulerCheckpoint
} from '../../src/sim/strategySearchScheduler';
import type { CampaignSchedulerTask } from '../../src/sim/strategySearchScheduler';

function task(input: Partial<CampaignSchedulerTask> & Pick<CampaignSchedulerTask,
  'taskId' | 'kingdomId' | 'stage'>): CampaignSchedulerTask {
  return { taskId: input.taskId, kingdomId: input.kingdomId, stage: input.stage,
    shardId: input.stage === 'goldfish' ? input.shardId ?? 'shard-0' : null,
    dependencyTaskIds: input.dependencyTaskIds ?? [], status: input.status ?? 'ready',
    readySinceMs: input.readySinceMs ?? 1,
    containers: input.containers ?? 1, cpus: input.cpus ?? 4,
    callId: input.status === 'active' ? input.callId ?? `call-${input.taskId}` : null,
    controllerFence: input.status === 'active' ? input.controllerFence ?? 3 : null };
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
      { kind: 'incomplete', taskId: 'failed', callId: 'call-failed', reason: 'worker process failed' },
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
      { kind: 'completed', taskId: 'goldfish', callId: 'call-goldfish' }
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
      { kind: 'terminal-incomplete', taskId: 'psro', callId: 'call-psro' }
    ]);
    expect(updated[0]?.status).toBe('terminal-incomplete');
    expect(planCampaignSchedulerTick({ tasks: updated, observations: [],
      limits: { maxActiveContainers: 1, maxActiveCpus: 4 }, controllerFence: 3,
      stopLaunching: false })).toEqual([]);
  });

  it('fails closed when the runtime cannot fit the smallest eligible stage', () => {
    expect(() => planCampaignSchedulerTick({ tasks: [task({ taskId: 'psro', kingdomId: 'k', stage: 'psro',
      containers: 2, cpus: 8 })], observations: [], limits: { maxActiveContainers: 1, maxActiveCpus: 4 },
    controllerFence: 1, stopLaunching: false })).toThrow('smallest eligible');
  });
});
