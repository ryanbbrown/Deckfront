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

function response(objective: 'global' | 'final', admitted: boolean): ResponseResult {
  return { objective,
    sources: { requested: 10, requestedLocal: 7, requestedRandom: 3, actual: 8,
      local: 5, random: 3, duplicateRejections: 4, localShortfall: 2, randomShortfall: 0 },
    screenSchedule: schedule, confirmSchedule: schedule, bestTrainingMean: 0.7,
    candidateId: strategies[1]!.id, heldOutMean: 0.56,
    interval: { lower: 0.51, upper: 0.61 }, admitted, matches: 16,
    telemetry: emptyAggregate(), screenTelemetry: emptyAggregate(), confirmationTelemetry: emptyAggregate(),
    failureReason: null };
}

function event(restart: number | 'union' | 'final', attempt: number, result: ResponseResult): IterationEvent {
  return { restart, attempt, matrixSize: 2, mixtureBefore: { [strategies[0]!.id]: 0.5,
    [strategies[1]!.id]: 0.5 }, response: result,
  admittedStrategyId: result.admitted ? result.candidateId : null, elapsedMs: 1 };
}

function summary(iterations: IterationEvent[]): RunSummary {
  const equilibrium = solveEquilibrium(strategies.map((strategy) => strategy.id), [[0, 0], [0, 0]]);
  return { schemaVersion: 5, rulesFingerprint: rulesFingerprint('current-duel'),
    valid: true, kingdomId: 'current-duel', kingdomName: 'Current Duel',
    mode: 'smoke', seed: 1, limits: {},
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
  it('reports the automatic final search and restart completion', () => {
    const report = renderReport(summary([
      event('union', 0, response('global', true)), event('final', 0, response('final', false))
    ]));
    expect(report).toContain('Candidate | Confirmed mean | 95% interval');
    expect(report).toContain('The final random search stopped with a confirmed score of 0.560');
    expect(report).toContain('Requested 2; started 1; completed 1; skipped 1.');
    expect(report).toContain('Restart mixtures can use preliminary early-stopped cells');
    expect(report).not.toContain('Rigged');
    expect(report).not.toMatch(/generation|leader rank|Copper/iu);
  });

  it('names absent final-search evidence', () => {
    expect(renderReport(summary([]))).toContain('did not complete a final random search');
  });
});
