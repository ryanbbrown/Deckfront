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
  it('keeps score-only outcomes equal while dropping report telemetry', async () => {
    const runner = new InlinePairingRunner();
    const full = await runner.run(jobs(1));
    const scoreOnlyJobs = jobs(1).map((job) => ({ ...job, scoreOnly: true }));
    const compact = await runner.run(scoreOnlyJobs);
    const withoutTelemetry = (value: typeof full.outcomes[number] | undefined) => value
      ? { ...value, telemetry: undefined }
      : value;
    expect(withoutTelemetry(compact.outcomes[0])).toEqual(withoutTelemetry(full.outcomes[0]));
    expect(compact.outcomes[0]?.telemetry.acquisitionsByStrategy).toEqual({});
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
