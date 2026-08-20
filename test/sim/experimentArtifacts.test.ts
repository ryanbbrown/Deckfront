import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnosticStrategies } from '../../src/sim/baselines';
import { calculateWeightIntervals, runExperiment } from '../../src/sim/experiment';
import type { ExperimentOptions } from '../../src/sim/experimentConfig';
import { solveEquilibrium } from '../../src/sim/equilibrium';
import { emptyAggregate } from '../../src/sim/pairing';
import { matrixProtocol } from '../../src/sim/payoffMatrix';
import type { PsroResult, runPsro } from '../../src/sim/psro';

const options: ExperimentOptions = {
  kingdomId: 'current-duel', mode: 'smoke', seed: 1, restarts: 1, initialStrategies: 2,
  candidates: 2, iterations: 1, seeds: 1, unionIterations: 1,
  deadlineMinutes: 1, workers: 1
};

function completedResult(): PsroResult {
  const strategies = diagnosticStrategies('current-duel').slice(0, 2);
  const telemetry = emptyAggregate();
  const matrix = { protocol: matrixProtocol('current-duel', [1], 30, 200), strategies,
    cells: [{ rowId: strategies[0]!.id, columnId: strategies[1]!.id, key: 'fixture',
      blocks: [{ seed: 1, score: 0.5, played: 4, aborted: 0 }], complete: true,
      centeredPayoff: 0, matches: 4, telemetry }], complete: true,
    centeredPayoffs: [[0, 0], [0, 0]] };
  const equilibrium = solveEquilibrium(strategies.map((strategy) => strategy.id), matrix.centeredPayoffs);
  return { valid: true, restarts: [], strategies, matrix, equilibrium, events: [], finalFailures: [],
    restartAgreement: [], matches: 4, stopReason: 'limit', restartStatuses: [
      { restart: 0, state: 'completed', stopReason: 'iteration-limit', matrixSize: 2 }
    ], failure: null, seedNamespaces: { matrix: [1] } };
}

describe('PSRO experiment evidence artifacts', () => {
  it('keeps a valid result when weight diagnostics fail and shows the warning', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-warning-'));
    const result = completedResult();
    const execute = (async () => result) as typeof runPsro;
    const summary = await runExperiment(options, directory, { now: () => 1000, runPsro: execute,
      weightIntervals: () => ({ intervals: {}, samplesCompleted: 0,
        warnings: ['Weight-interval bootstrap stopped after a solver failure: forced.'] }) });
    expect(summary.valid).toBe(true);
    expect(summary.equilibrium).toEqual(result.equilibrium);
    const run = JSON.parse(fs.readFileSync(path.join(directory, 'run.json'), 'utf8'));
    const matrix = JSON.parse(fs.readFileSync(path.join(directory, 'matrix.json'), 'utf8'));
    expect(run).toMatchObject({ schemaVersion: 5, rulesFingerprint: { version: 1 } });
    expect(matrix.protocol.rulesFingerprint).toBe(run.rulesFingerprint.hash);
    expect(fs.readFileSync(path.join(directory, 'report.md'), 'utf8')).toContain('Diagnostic warning');
  });

  it('stops weight diagnostics at the deadline without changing the final result', () => {
    const result = completedResult();
    const diagnostic = calculateWeightIntervals(result, 2, { deadline: 10, now: () => 10 });
    expect(diagnostic).toMatchObject({ intervals: {}, samplesCompleted: 0 });
    expect(diagnostic.warnings[0]).toContain('deadline');
    expect(result).toMatchObject({ valid: true, stopReason: 'limit' });
  });

  it('preserves strategies and cells from a simulator abort and writes no final weights', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-abort-'));
    const partial = completedResult();
    partial.valid = false; partial.equilibrium = null; partial.stopReason = 'simulator-abort';
    partial.failure = { kind: 'simulator-abort', message: 'aborted pairing', detail: {
      seed: 17, orientation: 2, reason: 'actionSearchOverflow'
    } };
    const execute = (async (config: Parameters<typeof runPsro>[0]) => {
      expect([config.searchDeadline, config.finalDeadline]).toEqual([43_000, 61_000]);
      return partial;
    }) as typeof runPsro;
    const summary = await runExperiment(options, directory, { now: () => 1000, runPsro: execute });
    expect(summary).toMatchObject({ valid: false, stopReason: 'simulator-abort', equilibrium: null });
    const matrix = JSON.parse(fs.readFileSync(path.join(directory, 'matrix.json'), 'utf8'));
    const strategies = JSON.parse(fs.readFileSync(path.join(directory, 'strategies.json'), 'utf8'));
    expect(matrix.cells).toHaveLength(1);
    expect(matrix.equilibrium).toBeNull();
    expect(strategies.strategies).toHaveLength(2);
    expect(fs.readFileSync(path.join(directory, 'run.json'), 'utf8')).toContain('actionSearchOverflow');
  });
});
