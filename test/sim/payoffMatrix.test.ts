import { describe, expect, it } from 'vitest';
import { diagnosticStrategies } from '../../src/sim/baselines';
import { emptyAggregate } from '../../src/sim/pairing';
import {
  createMatrixCellCache, InvalidEvaluationError, PayoffMatrix, matrixProtocol
} from '../../src/sim/payoffMatrix';
import type { PairingJob, PairingRunner } from '../../src/sim/pairingRunner';
import {
  MATRIX_PROTOCOL_VERSION, SIMULATION_KERNEL_PROTOCOL_VERSION, TACTICAL_PILOT_PROTOCOL_VERSION
} from '../../src/sim/protocolVersions';

class RecordingRunner implements PairingRunner {
  jobs: PairingJob[] = [];
  batches: number[] = [];
  constructor(private readonly abort = false) {}
  async run(jobs: readonly PairingJob[]) {
    this.batches.push(jobs.length);
    this.jobs.push(...jobs);
    return { submitted: jobs.length, outcomes: jobs.map((job) => ({
      record: { played: this.abort ? 0 : job.options.seeds.length * 2, wins: this.abort ? 0 : job.options.seeds.length * 2,
        draws: 0, losses: 0, aborted: this.abort ? 1 : 0 },
      candidateScore: this.abort ? 0 : job.options.seeds.length * 2, opponentScore: 0,
      candidateMean: this.abort ? null : 1, opponentMean: this.abort ? null : 0,
      telemetry: emptyAggregate(), matches: job.options.seeds.length * 2,
      seedsEvaluated: job.options.seeds.length, stopReason: 'maximum' as const,
      blocks: job.options.seeds.map((seed) => ({ seed, score: this.abort ? 0 : 1,
        played: this.abort ? 0 : 2, aborted: this.abort ? 1 : 0 })),
      aborts: this.abort ? [{ seed: job.options.seeds[0]!, orientationIndex: 0,
        reason: 'actionSearchOverflow' as const }] : []
    })) };
  }
  async close() {}
}

describe('protocol-keyed payoff matrix', () => {
  const protocol = () => matrixProtocol('current-duel', [1, 2], 30, 200);

  it('uses the final balance-source protocol identities', () => {
    expect([
      MATRIX_PROTOCOL_VERSION, SIMULATION_KERNEL_PROTOCOL_VERSION, TACTICAL_PILOT_PROTOCOL_VERSION
    ]).toEqual(['two-games-shared-seed-v1', 'persistent-mana-cap2-v11', 'first-attack-v9']);
  });

  it('runs each unordered pair once, mirrors it, and adds only a new row and column', async () => {
    const runner = new RecordingRunner();
    const [a, b, d] = diagnosticStrategies('current-duel');
    const matrix = new PayoffMatrix(protocol(), runner);
    matrix.addStrategy(a!); matrix.addStrategy(b!);
    await matrix.fillAll(false);
    expect(runner.jobs).toHaveLength(1);
    const before = matrix.snapshot().cells[0]!.key;
    await matrix.addRow(d!, false);
    expect(runner.jobs).toHaveLength(3);
    const snapshot = matrix.snapshot();
    expect(snapshot.complete).toBe(true);
    expect(snapshot.centeredPayoffs[0]![1]!).toBe(-snapshot.centeredPayoffs[1]![0]!);
    expect(snapshot.cells.find((cell) => cell.key === before)?.blocks).toHaveLength(2);
    expect(runner.jobs.every((job) => job.options.allowEarlyStop === false)).toBe(true);
  });

  it('submits every missing matrix pair as one worker-pool batch', async () => {
    const runner = new RecordingRunner();
    const strategies = diagnosticStrategies('current-duel').slice(0, 3);
    const matrix = new PayoffMatrix(protocol(), runner);
    for (const strategy of strategies) matrix.addStrategy(strategy);

    await matrix.fillAll(false);

    expect(runner.batches).toEqual([3]);
    expect(matrix.snapshot().complete).toBe(true);
  });

  it('invalidates a complete cell when any game aborts', async () => {
    const runner = new RecordingRunner(true);
    const [a, b] = diagnosticStrategies('current-duel');
    const matrix = new PayoffMatrix(protocol(), runner);
    await expect(matrix.fillPair(a!, b!, false)).rejects.toBeInstanceOf(InvalidEvaluationError);
    expect(matrix.snapshot().complete).toBe(false);
  });

  it('produces the same protocol keys and bytes independent of entrant order', async () => {
    const strategies = diagnosticStrategies('current-duel').slice(0, 3);
    const build = async (order: readonly typeof strategies[number][]) => {
      const matrix = new PayoffMatrix(protocol(), new RecordingRunner());
      for (const strategy of order) matrix.addStrategy(strategy);
      await matrix.fillAll(false);
      return JSON.stringify(matrix.snapshot());
    };
    expect(await build(strategies)).toBe(await build([...strategies].reverse()));
  });

  it('reuses cells only when the complete protocol is identical', async () => {
    const runner = new RecordingRunner();
    const cache = createMatrixCellCache();
    const [a, b] = diagnosticStrategies('current-duel');
    const fill = async (value: ReturnType<typeof protocol>) => {
      const matrix = new PayoffMatrix(value, runner, cache);
      await matrix.fillPair(a!, b!, false);
      return matrix.snapshot();
    };
    await fill(protocol());
    await fill(protocol());
    expect(runner.jobs).toHaveLength(1);
    const base = protocol();
    const variants = [
      { ...base, seeds: [1, 3] },
      { ...base, turnLimitPerPlayer: 31 },
      { ...base, actionCapPerTurn: 201 },
      matrixProtocol('current-duel', [1, 2], 30, 200, false),
      { ...base, cards: [...base.cards as unknown[], { id: 'changed-card' }] },
      { ...base, orientationProtocol: 'two-games-shared-seed-v2' }
    ];
    for (const variant of variants) await fill(variant);
    expect(runner.jobs).toHaveLength(1 + variants.length);
    expect(base.orientationProtocol).toBe('two-games-shared-seed-v1');
    expect(runner.jobs.find((job) => job.options.startingDraftEnabled === false)).toBeDefined();
    expect(matrixProtocol('current-duel', [1, 2], 30, 200, false).rulesFingerprint)
      .not.toBe(base.rulesFingerprint);
  });
});
