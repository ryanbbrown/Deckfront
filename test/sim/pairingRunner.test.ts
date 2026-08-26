import { describe, expect, it } from 'vitest';
import { InlinePairingRunner, WorkerPairingRunner } from '../../src/sim/pairingRunner';
import type { PairingJob } from '../../src/sim/pairingRunner';
import { strategy } from './fixtures';

const workerUrl = new URL('./fixtures/pairing-worker.mjs', import.meta.url);

function jobs(count: number, failAt = -1): PairingJob[] {
  return Array.from({ length: count }, (_, index) => ({
    candidate: strategy({ id: index === failAt ? 'fail' : `job-${index}` }),
    opponent: strategy({ id: 'opponent' }),
    options: {
      kingdomId: 'current-duel', seeds: [1], turnLimitPerPlayer: 30, actionCapPerTurn: 200
    }
  }));
}

describe('the worker pairing runner', () => {
  it('returns exact score bytes without full outcomes or telemetry', async () => {
    const runner = new InlinePairingRunner();
    const full = await runner.run(jobs(1));
    const compact = await runner.runScoreOnly(jobs(1));
    expect(compact.outcomes[0]).toEqual({
      scoreBytes: new Uint8Array([full.outcomes[0]!.blocks[0]!.score * 4]),
      played: new Uint8Array([full.outcomes[0]!.blocks[0]!.played]),
      matches: full.outcomes[0]!.matches,
      aborts: full.outcomes[0]!.aborts
    });
    expect(Object.keys(compact.outcomes[0]!).sort()).toEqual(['aborts', 'matches', 'played', 'scoreBytes']);
  });

  it('sends one candidate complete opponent schedule as one compact worker unit', async () => {
    const runner = new WorkerPairingRunner(2, workerUrl);
    const candidate = strategy({ id: 'one-candidate' });
    const schedule = jobs(5).map((job, index) => ({ ...job, candidate,
      opponent: strategy({ id: `opponent-${index}` }) }));
    try {
      const result = await runner.run(schedule);
      expect(result.submitted).toBe(5);
      expect(result.outcomes.map((outcome) => outcome?.seedsEvaluated)).toEqual([5, 5, 5, 5, 5]);
    } finally { await runner.close(); }
  });

  it('folds one-worker and reverse-completing two-worker results in submission order', async () => {
    const one = new WorkerPairingRunner(1, workerUrl);
    const two = new WorkerPairingRunner(2, workerUrl);
    try {
      const oneResult = await one.run(jobs(4));
      const twoResult = await two.run(jobs(4));
      expect(oneResult.outcomes.map((outcome) => outcome?.matches)).toEqual([0, 1, 2, 3]);
      expect(twoResult).toEqual(oneResult);
    } finally {
      await one.close();
      await two.close();
    }
  });

  it('checks the deadline each time a worker becomes free and leaves queued jobs unsubmitted', async () => {
    const runner = new WorkerPairingRunner(2, workerUrl);
    const readings = [0, 0, 100, 100, 100];
    try {
      const result = await runner.run(jobs(5), { deadline: 50, now: () => readings.shift() ?? 100 });
      expect(result.submitted).toBe(2);
      expect(result.outcomes.map((outcome) => outcome?.matches ?? null)).toEqual([0, 1, null, null, null]);
    } finally {
      await runner.close();
    }
  });

  it('rejects with the worker error, closes the pool, and leaves no reusable worker', async () => {
    const runner = new WorkerPairingRunner(2, workerUrl);
    await expect(runner.run(jobs(4, 1))).rejects.toThrow('worker exploded');
    await expect(runner.run(jobs(1))).rejects.toThrow('closed');
    await expect(runner.close()).resolves.toBeUndefined();
  });

  it('closes every worker after success', async () => {
    const runner = new WorkerPairingRunner(2, workerUrl);
    await runner.run(jobs(1));
    await runner.close();
    await expect(runner.run(jobs(1))).rejects.toThrow('closed');
  });
});
