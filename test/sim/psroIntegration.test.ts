import { describe, expect, it } from 'vitest';
import type { runFinalSearch } from '../../src/sim/finalSearch';
import { mixtureSchedule } from '../../src/sim/mixtureEvaluation';
import { emptyAggregate } from '../../src/sim/pairing';
import { InlinePairingRunner } from '../../src/sim/pairingRunner';
import { runPsro } from '../../src/sim/psro';
import { canonicalStrategy } from '../../src/sim/strategy';

const noFinalStrategy: typeof runFinalSearch = async (options) => ({
  candidate: null,
  result: {
    objective: 'final',
    sources: { requested: 3_000, requestedLocal: 0, requestedRandom: 3_000,
      actual: 3_000, local: 0, random: 3_000, duplicateRejections: 0,
      localShortfall: 0, randomShortfall: 0 },
    screenSchedule: mixtureSchedule(options.targetWeights, options.seeds.screen,
      options.seeds.screenSampling[0]!),
    confirmSchedule: mixtureSchedule(options.targetWeights, options.seeds.confirmation,
      options.seeds.confirmationSampling[0]!),
    bestTrainingMean: 0.5, candidateId: null, heldOutMean: 0.5,
    interval: { lower: 0.4, upper: 0.6 }, admitted: false, matches: 0,
    telemetry: emptyAggregate(), screenTelemetry: emptyAggregate(),
    confirmationTelemetry: emptyAggregate(), failureReason: null
  }
});

describe('PSRO restart union', () => {
  it('fills every cross-restart cell before the final solve', { timeout: 30_000 }, async () => {
    const runner = new InlinePairingRunner();
    const result = await runPsro({
      kingdomId: 'current-duel', seed: 77, restarts: 2, initialStrategies: 2,
      candidates: 1, iterations: 1, seeds: 1, unionIterations: 1,
      turnLimitPerPlayer: 30, actionCapPerTurn: 200, finalSearch: noFinalStrategy
    }, runner, () => 1000);
    await runner.close();
    expect(result.restarts).toHaveLength(2);
    expect(result.restartAgreement).toHaveLength(1);
    expect(result.matrix.complete).toBe(true);
    expect(result.matrix.cells).toHaveLength(result.strategies.length * (result.strategies.length - 1) / 2);
    expect(result.matrix.cells.every((cell) => cell.complete && cell.blocks.length === 1)).toBe(true);
    expect(new Set(result.strategies.map(canonicalStrategy)).size).toBe(result.strategies.length);
    expect(result.equilibrium).not.toBeNull();
  });
});
