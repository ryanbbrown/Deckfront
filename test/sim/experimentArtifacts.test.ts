import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runExperiment } from '../../src/sim/experiment';
import type { ExperimentOptions } from '../../src/sim/experimentConfig';
import type { runPsro } from '../../src/sim/psro';

const options: ExperimentOptions = {
  kingdomId: 'current-duel', mode: 'smoke', seed: 1, restarts: 1, initialStrategies: 2,
  candidates: 2, iterations: 1, nicheAdditions: 1, seeds: 1, unionIterations: 1,
  deadlineMinutes: 1, stateLimit: 20000, workers: 1
};

describe('PSRO experiment failure artifacts', () => {
  it('reserves 30% for union work and keeps completed events without final weights', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-error-'));
    let deadlines: [number | undefined, number | undefined] = [undefined, undefined];
    const fail = (async (config: Parameters<typeof runPsro>[0]) => {
      deadlines = [config.searchDeadline, config.finalDeadline];
      config.onEvent?.({ restart: 0, attempt: 0, matrixSize: 2, mixtureBefore: { a: 1 },
        response: null, admittedStrategyId: null, elapsedMs: 0 });
      throw new Error('forced abort');
    }) as typeof runPsro;
    const summary = await runExperiment(options, directory, { now: () => 1000, runPsro: fail });
    expect(deadlines).toEqual([43_000, 61_000]);
    expect(summary.valid).toBe(false);
    expect(summary.iterations).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'matrix.json'), 'utf8'))).toEqual({
      complete: false, equilibrium: null
    });
    expect(fs.readFileSync(path.join(directory, 'iterations.jsonl'), 'utf8').trim()).not.toBe('');
    const run = JSON.parse(fs.readFileSync(path.join(directory, 'run.json'), 'utf8'));
    expect(run.valid).toBe(false);
    expect(run.error).toContain('forced abort');
  });
});
