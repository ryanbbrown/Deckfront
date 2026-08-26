import { describe, expect, it } from 'vitest';
import { InlineConfidenceRunner, WorkerConfidenceRunner } from '../../src/sim/confidenceRunner';

const workerUrl = new URL('../../src/server/confidenceWorker.ts', import.meta.url);
const jobs = Array.from({ length: 137 }, (_unused, index) => ({
  values: Array.from({ length: (index % 17) + 1 }, (_held, scoreIndex) =>
    ((index * 3 + scoreIndex * 5) % 5) / 4),
  alpha: index % 3 === 0 ? 0.05 / 137 : 0.05
}));

describe('the confidence worker pool', () => {
  it('returns byte-equal serial bounds in submission order', async () => {
    const serial = new InlineConfidenceRunner();
    const parallel = new WorkerConfidenceRunner(3, workerUrl, ['--import', 'tsx']);
    try {
      const expected = await serial.run(jobs);
      const actual = await parallel.run(jobs);
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
    } finally {
      await Promise.all([serial.close(), parallel.close()]);
    }
  });

  it('cannot run after close', async () => {
    const runner = new WorkerConfidenceRunner(1, workerUrl, ['--import', 'tsx']);
    await runner.close();
    await expect(runner.run(jobs.slice(0, 1))).rejects.toThrow('closed');
  });
});
