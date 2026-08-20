import { describe, expect, it } from 'vitest';
import { diagnosticStrategies } from '../../src/sim/baselines';
import { solveEquilibrium } from '../../src/sim/equilibrium';
import { emptyAggregate } from '../../src/sim/pairing';
import { matrixProtocol } from '../../src/sim/payoffMatrix';
import { renderReport } from '../../src/sim/report';
import type { RunSummary } from '../../src/sim/report';
import { rulesFingerprint } from '../../src/sim/rulesFingerprint';
import type { IterationEvent } from '../../src/sim/psro';
import type { ResponseResult } from '../../src/sim/responseOracle';

const strategies = diagnosticStrategies('current-duel').slice(0, 2);
const schedule = { targetWeights: { [strategies[0]!.id]: 1 },
  blocks: [{ seed: 1, opponentId: strategies[0]!.id }, { seed: 2, opponentId: strategies[0]!.id }],
  realizedOpponentCounts: { [strategies[0]!.id]: 2 }, unsampledPositiveWeightStrategies: [] };

function response(objective: 'global' | 'niche', admitted: boolean): ResponseResult {
  return { objective, focalStrategyId: objective === 'niche' ? strategies[0]!.id : null,
    sources: { requested: 10, requestedLocal: 7, requestedRandom: 3, actual: 8,
      local: 5, random: 3, duplicateRejections: 4, localShortfall: 2, randomShortfall: 0 },
    screenSchedule: schedule, confirmSchedule: schedule, bestTrainingMean: 0.7,
    candidateId: strategies[1]!.id, heldOutMean: 0.56,
    interval: objective === 'niche' ? { lower: 0.01, upper: 0.09 } : { lower: 0.51, upper: 0.61 },
    improvement: objective === 'niche' ? 0.04 : null, admitted, matches: 16,
    telemetry: emptyAggregate(), screenTelemetry: emptyAggregate(), confirmationTelemetry: emptyAggregate(),
    failureReason: null };
}

function event(restart: number | 'union', attempt: number, result: ResponseResult): IterationEvent {
  return { restart, attempt, matrixSize: 2, mixtureBefore: { [strategies[0]!.id]: 0.5,
    [strategies[1]!.id]: 0.5 }, response: result,
  admittedStrategyId: result.admitted ? result.candidateId : null, elapsedMs: 1 };
}

function summary(iterations: IterationEvent[]): RunSummary {
  const equilibrium = solveEquilibrium(strategies.map((strategy) => strategy.id), [[0, 0], [0, 0]]);
  return { schemaVersion: 4, rulesFingerprint: rulesFingerprint('current-duel'),
    valid: true, kingdomId: 'current-duel', kingdomName: 'Current Duel',
    mode: 'smoke', seed: 1, limits: { gameBoundBeforeDiagnostics: 100 },
    startedAt: '', finishedAt: '', elapsedMs: 1000, stopReason: 'response-exhausted', error: null,
    matches: 32, aborted: 0, matrix: { protocol: matrixProtocol('current-duel', [1], 30, 200),
      strategies, cells: [], complete: true, centeredPayoffs: [[0, 0], [0, 0]] },
    equilibrium, strategies, iterations, restartAgreement: [{ left: 0, right: 1,
      totalVariation: 0.2, supportOverlap: 0.5, leftWorstCounter: 0.1, rightWorstCounter: 0.2 }],
    telemetry: emptyAggregate(), weightIntervals: {}, warnings: [], restartStatuses: [
      { restart: 0, state: 'completed', stopReason: 'response-exhausted', matrixSize: 2 },
      { restart: 1, state: 'skipped', stopReason: 'search-deadline', matrixSize: 0 }
    ], restartMixtures: [], finalFailures: [] };
}

describe('PSRO report semantics', () => {
  it('separates niche absolute and paired values and resets gap evidence after admission', () => {
    const report = renderReport(summary([
      event(0, 0, response('niche', false)), event('union', 0, response('global', false)),
      event('union', 1, response('global', true)), event('union', 2, response('global', false))
    ]));
    expect(report).toContain('Absolute mean | Paired improvement | Interval type');
    expect(report).toContain('paired improvement');
    expect(report).toContain('Final observed oracle gap: 0.060 from 1 held-out search(es)');
    expect(report).toContain('block count(s) 2');
    expect(report).toContain('Requested 2; started 1; completed 1; skipped 1.');
    expect(report).toContain('Restart mixtures can use preliminary early-stopped cells');
    expect(report).not.toContain('Rigged');
    expect(report).not.toMatch(/generation|leader rank|Copper/iu);
  });

  it('reports a true trailing two-failure stop and names absent union evidence', () => {
    const two = renderReport(summary([
      event('union', 0, response('global', false)), event('union', 1, response('global', false))
    ]));
    expect(two).toContain('from 2 held-out search(es)');
    expect(renderReport(summary([]))).toContain('No union response search ran');
  });
});
