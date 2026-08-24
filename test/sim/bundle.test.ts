import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { diagnosticStrategies } from '../../src/sim/baselines';
import { runExperiment } from '../../src/sim/experiment';
import { InlinePairingRunner } from '../../src/sim/pairingRunner';
import type { ExperimentOptions } from '../../src/sim/experimentConfig';
import { balanceSuite } from '../../src/sim/balanceSuite';
import { randomUniqueStrategies } from '../../src/sim/randomStrategy';
import { resetKingdoms } from '../../src/game';

const root = path.resolve(import.meta.dirname, '../..');
const bundle = path.join(root, 'dist-sim', 'experiment.mjs');
const execFileAsync = promisify(execFile);
beforeAll(() => { execFileSync('npm', ['run', 'build:sim'], { cwd: root, stdio: 'pipe' }); });

describe('compiled PSRO bundle', () => {
  it('renders byte-identical artifacts when time is injected', async () => {
    const rootOut = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-determinism-'));
    const options: ExperimentOptions = { kingdomId: 'current-duel', mode: 'smoke', seed: 3,
      restarts: 1, initialStrategies: 2, candidates: 2, iterations: 1,
      seeds: 1, unionIterations: 1, deadlineMinutes: 1, workers: 1 };
    await runExperiment(options, path.join(rootOut, 'a'), { now: () => 1000,
      pairingRunner: new InlinePairingRunner() });
    await runExperiment(options, path.join(rootOut, 'b'), { now: () => 1000,
      pairingRunner: new InlinePairingRunner() });
    for (const file of ['iterations.jsonl', 'matrix.json', 'report.md', 'run.json', 'strategies.json', 'telemetry.json']) {
      expect(fs.readFileSync(path.join(rootOut, 'a', file), 'utf8'), file)
        .toBe(fs.readFileSync(path.join(rootOut, 'b', file), 'utf8'));
    }
  });

  it('runs a minimal pooled experiment and writes only the PSRO artifact contract', { timeout: 180_000 }, async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-bundle-'));
    await execFileAsync(process.execPath, [bundle, '--kingdom', 'current-duel', '--mode', 'smoke',
      '--initial-strategies', '2', '--candidates', '2', '--iterations', '1',
      '--seeds', '1', '--union-iterations', '1', '--restarts', '1', '--workers', '2', '--deadline-minutes', '2'],
    { cwd, encoding: 'utf8', timeout: 170_000 });
    const directory = path.join(cwd, '.experiments/current-duel/smoke');
    expect(fs.readdirSync(directory).sort()).toEqual([
      'iterations.jsonl', 'matrix.json', 'report.md', 'run.json', 'strategies.json', 'telemetry.json'
    ]);
    const matrix = JSON.parse(fs.readFileSync(path.join(directory, 'matrix.json'), 'utf8'));
    const run = JSON.parse(fs.readFileSync(path.join(directory, 'run.json'), 'utf8'));
    expect(matrix.complete).toBe(true);
    expect(matrix.equilibrium).not.toBeNull();
    expect(run.seedNamespaces).toHaveProperty('final:0:candidate');
    expect(run.seedNamespaces).toHaveProperty('final:0:confirmation');
    const usedSeeds = Object.values(run.seedNamespaces).flat() as number[];
    expect(new Set(usedSeeds).size).toBe(usedSeeds.length);
  });

  it('runs a generated kingdom through the compiled simulator entry point', { timeout: 180_000 }, async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-balance-suite-bundle-'));
    const kingdomId = balanceSuite.manifest.kingdoms[0]!.id;
    await execFileAsync(process.execPath, [bundle, '--kingdom', kingdomId, '--mode', 'smoke',
      '--initial-strategies', '2', '--candidates', '2', '--iterations', '1',
      '--seeds', '1', '--union-iterations', '1', '--restarts', '1', '--workers', '2', '--deadline-minutes', '2'],
    { cwd, encoding: 'utf8', timeout: 170_000 });
    const run = JSON.parse(fs.readFileSync(path.join(cwd, '.experiments', kingdomId, 'smoke', 'run.json'), 'utf8'));
    expect(run).toMatchObject({ schemaVersion: 5, valid: true, kingdomId });
  });

  it('runs only pairing jobs in worker mode', async () => {
    const [candidate, opponent] = diagnosticStrategies('current-duel');
    const worker = new Worker(bundle, { workerData: { kind: 'pairing-worker' } });
    const response = await new Promise<{ kind: string; outcome: { matches: number } }>((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
      worker.postMessage({ kind: 'pairing-batch', items: [{ id: 0, job: { candidate, opponent,
        options: { kingdomId: 'current-duel', seeds: [1], turnLimitPerPlayer: 30,
          actionCapPerTurn: 200, allowEarlyStop: false } } }] });
    });
    expect(response).toMatchObject({ kind: 'pairing-results', outcomes: [{ id: 0, outcome: { matches: 4 } }] });
    await worker.terminate();
  });

  it('registers the committed balance-suite manifest in a compiled pairing worker', async () => {
    balanceSuite.register();
    const kingdomId = balanceSuite.manifest.kingdoms[0]!.id;
    const [candidate, opponent] = randomUniqueStrategies(kingdomId, 7, 2).strategies;
    const worker = new Worker(bundle, { workerData: { kind: 'pairing-worker' } });
    const response = await new Promise<{ kind: string; outcome: { matches: number } }>((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
      worker.postMessage({ kind: 'pairing-batch', items: [{ id: 0, job: { candidate, opponent,
        options: { kingdomId, seeds: [1], turnLimitPerPlayer: 30,
          actionCapPerTurn: 200, allowEarlyStop: false } } }] });
    });
    expect(response).toMatchObject({ kind: 'pairing-results', outcomes: [{ id: 0, outcome: { matches: 4 } }] });
    await worker.terminate();
    resetKingdoms();
  });
});
