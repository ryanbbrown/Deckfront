import { describe, expect, it } from 'vitest';
import { diagnosticStrategies } from '../../src/sim/baselines';
import type { CandidateEvaluation } from '../../src/sim/mixtureEvaluation';
import { emptyAggregate } from '../../src/sim/pairing';
import { canonicalStrategy } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import {
  assembleRawPsroLook, createThresholdRacingProtocol, fixedProtocolTerminalReason, rawScoreRows,
  runConfirmationRace,
  runThresholdRace, thresholdRacingProtocolHash, validateRawPsroScoreChunk, weightedFairSchedule
} from '../../src/sim/thresholdRacingPsro';
import type {
  RawPsroCheckpointEvent, RawPsroLookArtifact, RawPsroScoreChunk
} from '../../src/sim/thresholdRacingPsro';

function candidates(count = 3) {
  return diagnosticStrategies('current-duel').slice(0, count).map((strategy, index) => ({ strategy, identity: {
    goldfishRank: index + 51, strategyId: strategy.id, canonicalStrategy: canonicalStrategy(strategy)
  } }));
}
const runner = { async run() { throw new Error('the injected evaluator owns this test'); }, async close() {} };
function protocol() {
  return createThresholdRacingProtocol({ experimentName: 'campaign-psro-fixture', runId: 'kingdom-run',
    kingdomId: 'current-duel', reservoirCount: 20_000, sourceIdentityHash: 'a'.repeat(64),
    checkpointNamespace: 'fixture-checkpoints', screenDepths: [8, 16], confirmationLooks: [4, 8] });
}
function evaluator(score: (strategy: Strategy) => number, calls: string[]) {
  return async (field: readonly Strategy[], _opponents: unknown,
    schedule: { blocks: Array<{ seed: number; opponentId: string }> }): Promise<CandidateEvaluation[]> => {
    calls.push(`${field.map((strategy) => strategy.id).join(',')}:${schedule.blocks.map((block) => block.seed).join(',')}`);
    return field.map((strategy) => ({ strategy, mean: score(strategy), interval: null,
      blockScores: schedule.blocks.map(() => score(strategy)), matches: schedule.blocks.length * 2,
      telemetry: emptyAggregate() }));
  };
}

describe('kingdom-independent threshold-racing raw evidence', () => {
  it('seals candidate-major 0..4 score chunks before each look decision and reconstructs prefixes', async () => {
    const field = candidates(), chunks: RawPsroScoreChunk[] = [], looks: RawPsroLookArtifact[] = [],
      events: RawPsroCheckpointEvent[] = [], calls: string[] = [];
    const scores = new Map([[field[0]!.strategy.id, 0], [field[1]!.strategy.id, 1],
      [field[2]!.strategy.id, 0.5]]);
    const heldProtocol = protocol();
    const result = await runThresholdRace({ candidates: field, opponents: new Map(),
      schedule: weightedFairSchedule({ opponent: 1 }, Array.from({ length: 16 }, (_unused, index) => 100 + index)),
      kingdomId: 'current-duel', runner, depths: [8, 16], chunkSize: 2,
      evaluate: evaluator((strategy) => scores.get(strategy.id)!, calls) as never,
      raw: { protocol: heldProtocol, raceKind: 'screen', sealChunk(chunk) { chunks.push(chunk); },
        sealLook(look, event) { looks.push(look); events.push(event); } } });

    expect(result.below.map((row) => row.strategyId)).toEqual([field[0]!.strategy.id]);
    expect(result.provisional.map((row) => row.strategyId)).toEqual([field[1]!.strategy.id]);
    expect(result.unresolved.map((row) => row.strategyId)).toEqual([field[2]!.strategy.id]);
    expect(chunks).toHaveLength(4);
    expect(chunks.every((chunk) => validateRawPsroScoreChunk(chunk, heldProtocol))).toBe(true);
    expect(chunks[0]!.candidateIds).toEqual([field[0]!.strategy.id, field[1]!.strategy.id]);
    expect(chunks[0]!.scoreBytes).toEqual([...Array(8).fill(0), ...Array(8).fill(4)]);
    expect(rawScoreRows(chunks[0]!)).toEqual([Array(8).fill(0), Array(8).fill(1)]);
    expect(chunks[2]!.scheduleStart).toBe(8);
    expect(chunks[2]!.fullSchedule.blocks).toHaveLength(16);
    expect(chunks[2]!.suffixSchedule.blocks).toHaveLength(8);
    expect(looks.map((look) => look.lookDepth)).toEqual([8, 16]);
    expect(assembleRawPsroLook(looks[0]!, chunks.slice(0, 2), heldProtocol)).toEqual({
      [field[0]!.strategy.id]: Array(8).fill(0), [field[1]!.strategy.id]: Array(8).fill(1),
      [field[2]!.strategy.id]: Array(8).fill(0.5)
    });
    expect(events.map((event) => event.lookHash)).toEqual(looks.map((look) => look.artifactHash));
    expect(calls).toHaveLength(4);
    expect(thresholdRacingProtocolHash(heldProtocol)).toMatch(/^[0-9a-f]{64}$/);
    expect(fixedProtocolTerminalReason(result)).toBe('fixed-protocol-look-cap-unresolved');
  });

  it('reuses every validated chunk and does not replay a completed range', async () => {
    const field = candidates(2), saved = new Map<string, RawPsroScoreChunk>(), firstCalls: string[] = [];
    const heldProtocol = protocol(), schedule = weightedFairSchedule({ opponent: 1 },
      Array.from({ length: 8 }, (_unused, index) => 200 + index));
    const key = (lookId: string, start: number, end: number) => `${lookId}:${start}:${end}`;
    const store = { protocol: heldProtocol, raceKind: 'confirmation' as const,
      loadChunk(identity: { lookId: string; candidateStart: number; candidateEnd: number }) {
        return saved.get(key(identity.lookId, identity.candidateStart, identity.candidateEnd));
      }, sealChunk(chunk: RawPsroScoreChunk) {
        saved.set(key(chunk.lookId, chunk.candidateStart, chunk.candidateEnd), chunk);
      }, sealLook() {} };
    const first = await runConfirmationRace({ candidates: field, opponents: new Map(), schedule,
      kingdomId: 'current-duel', runner, looks: [4, 8], chunkSize: 1,
      evaluate: evaluator((strategy) => strategy.id === field[0]!.strategy.id ? 1 : 0.5, firstCalls) as never,
      raw: store });
    const replayCalls: string[] = [];
    const replay = await runConfirmationRace({ candidates: field, opponents: new Map(), schedule,
      kingdomId: 'current-duel', runner, looks: [4, 8], chunkSize: 1,
      evaluate: evaluator(() => { throw new Error('completed raw range was replayed'); }, replayCalls) as never,
      raw: store });
    expect(replayCalls).toEqual([]);
    expect(replay.confirmed).toEqual(first.confirmed);
    expect(replay.unresolved).toEqual(first.unresolved);
    expect(saved.size).toBe(firstCalls.length);
  });

  it('changes protocol identity for a fixed-look extension so old terminal evidence cannot mix', () => {
    const base = protocol();
    const extended = createThresholdRacingProtocol({ ...base, protocolVersion: 'threshold-racing-psro-v3',
      confirmationLooks: [4, 8, 16] });
    expect(thresholdRacingProtocolHash(extended)).not.toBe(thresholdRacingProtocolHash(base));
  });
});
