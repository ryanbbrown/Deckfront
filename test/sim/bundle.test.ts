import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedStrategies } from '../../src/sim/seedPopulation';
import { runExperiment } from '../../src/sim/experiment';
import { InlinePairingRunner, WorkerPairingRunner } from '../../src/sim/pairingRunner';
import type { ExperimentOptions } from '../../src/sim/cli';

const root = path.resolve(import.meta.dirname, '../..');
const bundle = path.join(root, 'dist-sim', 'experiment.mjs');

beforeAll(() => {
  execFileSync('npm', ['run', 'build:sim'], { cwd: root, stdio: 'pipe' });
});

describe('the compiled simulation bundle', () => {
  it('produces identical deadline-free artifacts with inline and pooled pairings', async () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-determinism-'));
    const inlineDir = path.join(output, 'inline');
    const pooledDir = path.join(output, 'pooled');
    const options: ExperimentOptions = {
      kingdomId: 'current-duel', mode: 'smoke', seed: 5, candidates: 5, leaders: 1,
      generations: 1, sharedSeeds: 1, deadlineMinutes: 1, stateLimit: 20000, workers: 2
    };
    const now = () => 1_000;
    await runExperiment(options, inlineDir, { now, pairingRunner: new InlinePairingRunner() });
    await runExperiment(options, pooledDir, {
      now, pairingRunner: new WorkerPairingRunner(2, new URL(`file://${bundle}`))
    });
    for (const file of [
      'run.json', 'generations.jsonl', 'tournament.json', 'strategies.json', 'telemetry.json', 'report.md'
    ]) {
      expect(fs.readFileSync(path.join(pooledDir, file), 'utf8'), file)
        .toBe(fs.readFileSync(path.join(inlineDir, file), 'utf8'));
    }
  });

  it('runs a pooled CLI experiment from a clean temporary output directory', { timeout: 30_000 }, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-bundle-'));
    const result = spawnSync(process.execPath, [
      bundle, '--kingdom', 'current-duel', '--mode', 'smoke', '--candidates', '5', '--leaders', '1',
      '--generations', '1', '--seeds', '1', '--workers', '2', '--deadline-minutes', '1'
    ], { cwd, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('current-duel smoke: generations, 120 matches');
    expect(fs.existsSync(path.join(cwd, '.experiments/current-duel/smoke/run.json'))).toBe(true);
  });

  it('returns a non-zero CLI exit code for invalid input', () => {
    const result = spawnSync(process.execPath, [
      bundle, '--kingdom', 'current-duel', '--mode', 'smoke', '--workers', '17'
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--workers may be at most 16');
  });

  it('runs only pairing jobs in worker mode and rejects an unknown worker kind', async () => {
    const [candidate, opponent] = seedStrategies('current-duel');
    const worker = new Worker(bundle, { workerData: { kind: 'pairing-worker' } });
    const response = await new Promise<{ kind: string; outcome: { matches: number } }>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.postMessage({
        kind: 'pairing-job', id: 0,
        job: {
          candidate, opponent,
          options: { kingdomId: 'current-duel', seeds: [1], turnLimitPerPlayer: 30, actionCapPerTurn: 200 }
        }
      });
    });
    expect(response).toMatchObject({ kind: 'pairing-result', outcome: { matches: 4 } });
    await worker.terminate();

    const invalid = new Worker(bundle, { workerData: { kind: 'not-a-worker' } });
    const error = await new Promise<Error>((resolve) => invalid.once('error', resolve));
    expect(error.message).toContain('Unknown worker kind');
    await new Promise<void>((resolve) => invalid.once('exit', () => resolve()));
  });
});
