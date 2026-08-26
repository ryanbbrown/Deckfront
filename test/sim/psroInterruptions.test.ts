import { describe, expect, it } from 'vitest';
import { emptyAggregate } from '../../src/sim/pairing';
import { mixtureSchedule } from '../../src/sim/mixtureEvaluation';
import type { PairingJob, PairingRunner } from '../../src/sim/pairingRunner';
import { DeadlineInterruptionError } from '../../src/sim/payoffMatrix';
import { runPsro } from '../../src/sim/psro';
import { runResponseSearch } from '../../src/sim/responseOracle';
import type { ResponseResult } from '../../src/sim/responseOracle';
import { diagnosticStrategies } from '../../src/sim/baselines';
import type { runFinalSearch } from '../../src/sim/finalSearch';
import { assertDisjointSeedNamespaces } from '../../src/sim/seedNamespaces';

class ControlledRunner implements PairingRunner {
  calls = 0;
  allowEarlyStop: (boolean | undefined)[] = [];
  constructor(private readonly interruptAt = 0, private readonly abortAt = 0,
    private readonly shortPreliminary = false) {}
  async run(jobs: readonly PairingJob[]) {
    this.calls += 1;
    this.allowEarlyStop.push(...jobs.map((job) => job.options.allowEarlyStop));
    if (this.calls === this.interruptAt) return { submitted: 0, outcomes: jobs.map(() => null) };
    const abort = this.calls === this.abortAt;
    return { submitted: jobs.length, outcomes: jobs.map((job) => {
      const seeds = this.shortPreliminary && job.options.allowEarlyStop
        ? job.options.seeds.slice(0, 1) : job.options.seeds;
      return ({
      record: { played: abort ? 0 : seeds.length * 2, wins: 0,
        draws: abort ? 0 : seeds.length * 2, losses: 0, aborted: abort ? 1 : 0 },
      candidateScore: abort ? 0 : seeds.length * 2,
      opponentScore: abort ? 0 : seeds.length * 2,
      candidateMean: abort ? null : 0.5, opponentMean: abort ? null : 0.5,
      telemetry: emptyAggregate(), matches: abort ? 1 : seeds.length * 2,
      seedsEvaluated: abort ? 1 : seeds.length, stopReason: 'maximum' as const,
      blocks: seeds.map((seed) => ({ seed, score: 0.5, played: abort ? 0 : 2,
        aborted: abort ? 1 : 0 })),
      aborts: abort ? [{ seed: job.options.seeds[0]!, orientationIndex: 0,
        reason: 'actionSearchOverflow' as const }] : []
    }); }) };
  }
  async close() {}
}

const config = {
  kingdomId: 'current-duel', seed: 71, restarts: 2, initialStrategies: 2,
  candidates: 1, iterations: 1, seeds: 1, unionIterations: 1,
  turnLimitPerPlayer: 30, actionCapPerTurn: 200
};

const emptySearch: typeof runResponseSearch = async (options) => runResponseSearch({
  ...options,
  batchFactory: (request) => ({ candidates: [], sources: {
    requested: request.count, requestedLocal: Math.floor(request.count * 0.7),
    requestedRandom: request.count - Math.floor(request.count * 0.7), actual: 0,
    local: 0, random: 0, duplicateRejections: 0,
    localShortfall: Math.floor(request.count * 0.7),
    randomShortfall: request.count - Math.floor(request.count * 0.7)
  } })
});

function finalResult(options: Parameters<typeof runFinalSearch>[0], admitted: boolean,
  candidate = diagnosticStrategies('current-duel')[2]!): ResponseResult {
  const screenSchedule = mixtureSchedule(options.targetWeights, options.seeds.screen,
    options.seeds.screenSampling[0]!);
  const confirmSchedule = mixtureSchedule(options.targetWeights, options.seeds.confirmation,
    options.seeds.confirmationSampling[0]!);
  return {
    objective: 'final', sources: { requested: 3_000, requestedLocal: 0,
      requestedRandom: 3_000, actual: 3_000, local: 0, random: 3_000, duplicateRejections: 0,
      localShortfall: 0, randomShortfall: 0 }, screenSchedule, confirmSchedule,
    bestTrainingMean: admitted ? 0.7 : 0.5, candidateId: candidate.id,
    heldOutMean: admitted ? 0.7 : 0.5,
    interval: admitted ? { lower: 0.6, upper: 0.8 } : { lower: 0.4, upper: 0.6 }, rounds: [],
    admitted, matches: 0, telemetry: emptyAggregate(),
    screenTelemetry: emptyAggregate(), confirmationTelemetry: emptyAggregate(), failureReason: null
  };
}

const emptyFinalSearch: typeof runFinalSearch = async (options) => ({
  candidate: null, result: finalResult(options, false)
});

describe('PSRO interruption evidence', () => {
  it('uses early-stopped preliminary cells and executes a full final top-up', async () => {
    const runner = new ControlledRunner(0, 0, true);
    const result = await runPsro({ ...config, restarts: 1, seeds: 2,
      responseSearch: emptySearch, finalSearch: emptyFinalSearch }, runner, () => 1);
    expect(result.valid).toBe(true);
    expect(runner.allowEarlyStop).toContain(true);
    expect(runner.allowEarlyStop).toContain(false);
    expect(result.matrix.cells.every((cell) => cell.complete && cell.blocks.length === 2)).toBe(true);
  });

  it('runs the final search after two combined-search failures', async () => {
    const result = await runPsro({ ...config, restarts: 1, unionIterations: 4,
      responseSearch: emptySearch, finalSearch: emptyFinalSearch }, new ControlledRunner(), () => 1);
    expect(result).toMatchObject({ valid: true, stopReason: 'final-search-passed' });
    expect(result.finalFailures).toHaveLength(1);
    expect(result.events.filter((event) => event.restart === 'union')).toHaveLength(2);
    expect(result.events.filter((event) => event.restart === 'final')).toHaveLength(1);
  });

  it('stops each independent search after four consecutive failures', async () => {
    const result = await runPsro({ ...config, restarts: 1, iterations: 12,
      responseSearch: emptySearch, finalSearch: emptyFinalSearch }, new ControlledRunner(), () => 1);
    expect(result.restarts[0]).toMatchObject({ stopReason: 'response-exhausted', globalFailures: 4 });
    expect(result.restarts[0]!.events).toHaveLength(4);
  });

  it('adds a final-search winner to the combined matrix and resets the combined search', async () => {
    let finalCalls = 0;
    const finalSearch: typeof runFinalSearch = async (options) => {
      const admitted = finalCalls++ === 0;
      return { candidate: admitted ? diagnosticStrategies('current-duel')[2]! : null,
        result: finalResult(options, admitted) };
    };
    const result = await runPsro({ ...config, restarts: 1, iterations: 1, unionIterations: 2,
      responseSearch: emptySearch, finalSearch }, new ControlledRunner(), () => 1);
    expect(result.valid).toBe(true);
    expect(result.events.filter((event) => event.restart === 'union')).toHaveLength(4);
    expect(result.events.filter((event) => event.restart === 'final')).toHaveLength(2);
    expect(result.events.find((event) => event.restart === 'final')?.admittedStrategyId)
      .toBe(diagnosticStrategies('current-duel')[2]!.id);
    expect(result.matrix.strategies.map((strategy) => strategy.id))
      .toContain(diagnosticStrategies('current-duel')[2]!.id);
    expect(result.matrix.complete).toBe(true);
    expect(result.seedNamespaces).toHaveProperty('global-race:union:3');
    expect(result.seedNamespaces).toHaveProperty('final:0:candidate');
    expect(result.seedNamespaces).toHaveProperty('final:1:confirmation');
    expect(() => assertDisjointSeedNamespaces(result.seedNamespaces)).not.toThrow();
  });

  it('enters the reserved union after a restart search interruption', async () => {
    const search: typeof runResponseSearch = async (options) => {
      if (options.restart === 0) throw new DeadlineInterruptionError('screen deadline', {});
      return emptySearch(options);
    };
    const result = await runPsro({ ...config, responseSearch: search,
      finalSearch: emptyFinalSearch }, new ControlledRunner(), () => 1);
    expect(result.valid).toBe(true);
    expect(result.restartStatuses).toEqual([
      expect.objectContaining({ restart: 0, state: 'interrupted', stopReason: 'search-deadline' }),
      expect.objectContaining({ restart: 1, state: 'skipped', stopReason: 'search-deadline' })
    ]);
    expect(result.matrix.cells.length).toBeGreaterThan(0);
    expect(result.events.some((event) => event.restart === 'union')).toBe(true);
  });

  it('returns a partial union without weights when final top-up is interrupted', async () => {
    const result = await runPsro({ ...config, responseSearch: emptySearch,
      finalSearch: emptyFinalSearch }, new ControlledRunner(3), () => 1);
    expect(result).toMatchObject({ valid: false, stopReason: 'partial-union', equilibrium: null });
    expect(result.strategies.length).toBeGreaterThan(0);
    expect(result.matrix.cells.length).toBeGreaterThan(0);
    expect(result.restarts.filter((restart) => restart.equilibrium).length).toBe(2);
  });

  it('returns a partial union without weights when its response is interrupted', async () => {
    const search: typeof runResponseSearch = async (options) => {
      if (options.restart === config.restarts) throw new DeadlineInterruptionError('union response deadline', {});
      return emptySearch(options);
    };
    const result = await runPsro({ ...config, responseSearch: search,
      finalSearch: emptyFinalSearch }, new ControlledRunner(), () => 1);
    expect(result).toMatchObject({ valid: false, stopReason: 'partial-union', equilibrium: null });
    expect(result.matrix.complete).toBe(true);
    expect(result.restarts).toHaveLength(2);
  });

  it('invalidates on the first abort but preserves completed restart evidence', async () => {
    const result = await runPsro({ ...config, responseSearch: emptySearch,
      finalSearch: emptyFinalSearch }, new ControlledRunner(3), () => 1);
    expect(result.failure?.kind).not.toBe('simulator-abort');
    const aborted = await runPsro({ ...config, responseSearch: emptySearch,
      finalSearch: emptyFinalSearch }, new ControlledRunner(0, 3), () => 1);
    expect(aborted).toMatchObject({ valid: false, stopReason: 'simulator-abort', equilibrium: null });
    expect(aborted.failure).toMatchObject({ kind: 'simulator-abort', detail: {
      orientation: 0, reason: 'actionSearchOverflow'
    } });
    expect(aborted.strategies.length).toBeGreaterThan(0);
    expect(aborted.matrix.cells.length).toBeGreaterThan(0);
  });
});
