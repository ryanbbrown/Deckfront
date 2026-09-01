import { expect, it } from 'vitest';
import { nativeSeatBiasScoreRequest } from '../../src/sim/nativeCompetitiveProtocol';
import { aggregateSeatBias, buildSeatBiasReport, createSeatBiasSchedule, serializeSeatBiasReport,
  summarizeSeatBiasPenalty } from '../../src/sim/seatBias';
import type { SeatBiasKingdomDiagnostic, SeatBiasSchedule } from '../../src/sim/seatBias';

function schedule(pairCount: number): SeatBiasSchedule {
  return {
    kingdomId: 'fixture',
    samplingSeed: 1,
    blocks: Array.from({ length: pairCount }, (_unused, index) => ({
      candidateIndex: 0, opponentIndex: 0, seed: index + 1, uncertaintyBlockIndex: 0
    })),
    ochreStrategyCounts: [pairCount],
    indigoStrategyCounts: [pairCount]
  };
}

function kingdom(kingdomId: string, outcomes: number[]): SeatBiasKingdomDiagnostic {
  const heldSchedule = schedule(outcomes.length / 2);
  const penalty = summarizeSeatBiasPenalty(heldSchedule, 1, {
    penalty: 3, outcomes: Uint8Array.from(outcomes), aborts: []
  });
  return {
    kingdomId,
    kingdomName: kingdomId,
    startingHealth: 50,
    ruleFingerprint: `rules-${kingdomId}`,
    catalogPlanCount: 1,
    positiveWeightPlanCount: 1,
    samplingSeed: heldSchedule.samplingSeed,
    matchedPairCount: heldSchedule.blocks.length,
    ochreStrategyCounts: heldSchedule.ochreStrategyCounts,
    indigoStrategyCounts: heldSchedule.indigoStrategyCounts,
    penalties: [penalty]
  };
}

it('accounts for the winner by first-player orientation and keeps draws and aborts distinct', () => {
  const result = summarizeSeatBiasPenalty(schedule(2), 1, {
    penalty: 3,
    outcomes: Uint8Array.from([0, 0, 2, 3]),
    aborts: [{ blockIndex: 1, orientationIndex: 1, reason: 'actionSearchOverflow' }]
  });
  expect(result).toMatchObject({
    firstPlayerWins: 1,
    secondPlayerWins: 1,
    draws: 1,
    aborts: 1,
    playedGames: 3,
    firstPlayerScore: 0.5,
    abortReasons: { actionSearchOverflow: 1 }
  });
});

it('draws both equilibrium players independently from a deterministic 53-bit kingdom-local stream', () => {
  const input = {
    kingdomId: 'independent', globalSeed: 16, blocksPerKingdom: 2,
    gamesPerKingdom: 8, weights: [0.5, 0.5]
  };
  const first = createSeatBiasSchedule(input);
  expect(first).toEqual(createSeatBiasSchedule(input));
  expect(first.samplingSeed).toBe(293895605);
  expect(first.blocks).toEqual([
    { candidateIndex: 0, opponentIndex: 1, seed: 1815984068, uncertaintyBlockIndex: 0 },
    { candidateIndex: 0, opponentIndex: 1, seed: 1502791479, uncertaintyBlockIndex: 0 },
    { candidateIndex: 1, opponentIndex: 0, seed: 2570419198, uncertaintyBlockIndex: 1 },
    { candidateIndex: 0, opponentIndex: 0, seed: 728096841, uncertaintyBlockIndex: 1 }
  ]);
});

it('gives equal weight to kingdoms with unequal game counts and serializes deterministically', () => {
  const small = kingdom('small', [0, 1]);
  const large = kingdom('large', [1, 0, 1, 0, 1, 0]);
  const aggregate = aggregateSeatBias([small, large], [3]);
  expect(aggregate[0]).toMatchObject({
    firstPlayerWins: 2,
    secondPlayerWins: 6,
    playedGames: 8,
    firstPlayerScore: 0.5,
    crossKingdomStandardDeviation: 0.5
  });

  const identity = {
    protocol: { seatBias: 'seat-bias-v1', competitiveVersion: 1, competitiveScorer: 'native-competitive-v1' },
    catalog: { schemaVersion: 1, sha256: 'catalog', kingdomCount: 2, planCount: 2,
      positiveWeightPlanCount: 2 },
    kernel: { scorerVersion: 'native-goldfish-v1', sha256: 'kernel' }
  };
  const config = { blocksPerKingdom: 1, gamesPerKingdom: 2, penalties: [3], seed: 7, threads: 1 };
  const first = serializeSeatBiasReport(buildSeatBiasReport(identity, config, [small, large]));
  const second = serializeSeatBiasReport(buildSeatBiasReport(identity, config, [small, large]));
  expect(first).toBe(second);
  expect(first).not.toContain('timestamp');
});

it('plumbs every requested comparison penalty into one native operation', () => {
  expect(nativeSeatBiasScoreRequest('load-1', [{ candidateIndex: 2, opponentIndex: 4, seed: 9 }], [2, 3, 4]))
    .toEqual({ type: 'score_seat_bias', payload: {
      protocolVersion: 'seat-bias-v1',
      loadId: 'load-1',
      blocks: [{ candidateIndex: 2, opponentIndex: 4, seed: 9 }],
      penalties: [2, 3, 4]
    } });
});
