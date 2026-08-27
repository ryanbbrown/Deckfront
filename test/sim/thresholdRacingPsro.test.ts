import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { diagnosticStrategies } from '../../src/sim/baselines';
import type { CandidateEvaluation } from '../../src/sim/mixtureEvaluation';
import { emptyAggregate } from '../../src/sim/pairing';
import { canonicalStrategy } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import {
  assembleRawPsroLook, createThresholdRacingProtocol, fixedProtocolTerminalReason, rawScoreRows,
  runConfirmationRace,
  runThresholdRace, thresholdRacingProtocolHash, thresholdRacingSeedLabel, validateRawPsroLookArtifact,
  validateRawPsroScoreChunk, validateThresholdRacingProtocol, weightedFairSchedule
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
function reseal<T extends { artifactHash: string }>(value: T): T {
  const copy = structuredClone(value); copy.artifactHash = '';
  return { ...copy, artifactHash: createHash('sha256').update(JSON.stringify(copy)).digest('hex') };
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
    expect(looks.every((look) => validateRawPsroLookArtifact(look, heldProtocol))).toBe(true);
    expect(assembleRawPsroLook(looks[0]!, chunks.slice(0, 2), heldProtocol)).toEqual({
      [field[0]!.strategy.id]: Array(8).fill(0), [field[1]!.strategy.id]: Array(8).fill(1),
      [field[2]!.strategy.id]: Array(8).fill(0.5)
    });
    expect(events.map((event) => event.lookHash)).toEqual(looks.map((look) => look.artifactHash));
    expect(calls).toHaveLength(4);
    expect(thresholdRacingProtocolHash(heldProtocol)).toMatch(/^[0-9a-f]{64}$/);
    expect(fixedProtocolTerminalReason(result)).toBe('fixed-protocol-look-cap-unresolved');
  });

  it('rejects rehashed schedule, canonical, range, protocol, and look corruption', async () => {
    const field = candidates(), chunks: RawPsroScoreChunk[] = [], looks: RawPsroLookArtifact[] = [];
    const heldProtocol = protocol();
    await runThresholdRace({ candidates: field, opponents: new Map(),
      schedule: weightedFairSchedule({ opponent: 1 }, Array.from({ length: 8 }, (_unused, index) => 300 + index)),
      kingdomId: 'current-duel', runner, depths: [8], chunkSize: 2,
      evaluate: evaluator(() => 0.5, []) as never,
      raw: { protocol: heldProtocol, raceKind: 'screen', sealChunk(chunk) { chunks.push(chunk); },
        sealLook(look) { looks.push(look); } } });
    const schedule = structuredClone(chunks[0]!);
    schedule.suffixSchedule.blocks[0]!.seed += 10_000;
    expect(validateRawPsroScoreChunk(reseal(schedule), heldProtocol)).toBe(false);
    const canonical = structuredClone(chunks[0]!);
    canonical.candidateCanonicals[0] = `${canonical.candidateCanonicals[0]}-changed`;
    expect(validateRawPsroScoreChunk(reseal(canonical), heldProtocol)).toBe(false);
    const telemetry = structuredClone(chunks[0]!);
    telemetry.telemetryByCandidate[0]!.byOrientation.firstOchre.normal.played = 1;
    expect(validateRawPsroScoreChunk(reseal(telemetry), heldProtocol)).toBe(false);
    const protocolChanged = structuredClone(chunks[0]!); protocolChanged.protocolHash = 'b'.repeat(64);
    expect(validateRawPsroScoreChunk(reseal(protocolChanged), heldProtocol)).toBe(false);
    const sourceChanged = structuredClone(chunks[0]!); sourceChanged.sourceHash = 'short';
    expect(validateRawPsroScoreChunk(reseal(sourceChanged), heldProtocol)).toBe(false);
    const extraChunk = { ...structuredClone(chunks[0]!), unexpected: true };
    expect(validateRawPsroScoreChunk(reseal(extraChunk), heldProtocol)).toBe(false);
    const range = structuredClone(chunks[0]!); range.candidateStart = 1; range.candidateEnd = 3;
    expect(() => assembleRawPsroLook(looks[0]!, [reseal(range), chunks[1]!], heldProtocol)).toThrow();
    const lookMetadata = structuredClone(looks[0]!); lookMetadata.alpha = 0.1;
    expect(validateRawPsroLookArtifact(reseal(lookMetadata), heldProtocol)).toBe(false);
    const lookCanonical = structuredClone(looks[0]!);
    lookCanonical.candidateCanonicals[0] = `${lookCanonical.candidateCanonicals[0]}-changed`;
    expect(validateRawPsroLookArtifact(reseal(lookCanonical), heldProtocol)).toBe(false);
    const lookRange = structuredClone(looks[0]!); lookRange.chunks[0]!.candidateStart = 1;
    expect(validateRawPsroLookArtifact(reseal(lookRange), heldProtocol)).toBe(false);
    const lookProtocol = structuredClone(looks[0]!); lookProtocol.protocolHash = 'b'.repeat(64);
    expect(validateRawPsroLookArtifact(reseal(lookProtocol), heldProtocol)).toBe(false);
    const extraLook = { ...structuredClone(looks[0]!), unexpected: true };
    expect(validateRawPsroLookArtifact(reseal(extraLook), heldProtocol)).toBe(false);
  });

  it('reuses every validated chunk and does not replay a completed range', async () => {
    const field = candidates(2), saved = new Map<string, RawPsroScoreChunk>(), firstCalls: string[] = [];
    const heldProtocol = protocol(), schedule = weightedFairSchedule({ opponent: 1 },
      Array.from({ length: 8 }, (_unused, index) => 200 + index));
    const telemetryEvaluator = async (strategies: readonly Strategy[], _opponents: unknown,
      heldSchedule: { blocks: Array<{ seed: number; opponentId: string }> }): Promise<CandidateEvaluation[]> => {
      firstCalls.push(strategies.map((strategy) => strategy.id).join(','));
      return strategies.map((strategy) => {
        const telemetry = emptyAggregate(), count = heldSchedule.blocks.length;
        telemetry.damageByCard.volley = count;
        telemetry.byOrientation.firstOchre.normal = { played: count, wins: count, draws: 0, losses: 0, aborted: 0 };
        telemetry.byOrientation.firstIndigo.normal = { played: count, wins: 0, draws: 0, losses: count, aborted: 0 };
        return { strategy, mean: 0.5, interval: null, blockScores: Array(count).fill(0.5),
          matches: count * 2, telemetry };
      });
    };
    const key = (lookId: string, start: number, end: number) => `${lookId}:${start}:${end}`;
    const store = { protocol: heldProtocol, raceKind: 'confirmation' as const,
      loadChunk(identity: { lookId: string; candidateStart: number; candidateEnd: number }) {
        return saved.get(key(identity.lookId, identity.candidateStart, identity.candidateEnd));
      }, sealChunk(chunk: RawPsroScoreChunk) {
        saved.set(key(chunk.lookId, chunk.candidateStart, chunk.candidateEnd), chunk);
      }, sealLook() {} };
    const first = await runConfirmationRace({ candidates: field, opponents: new Map(), schedule,
      kingdomId: 'current-duel', runner, looks: [4, 8], chunkSize: 1,
      evaluate: telemetryEvaluator as never, raw: store });
    const replayCalls: string[] = [];
    const replay = await runConfirmationRace({ candidates: field, opponents: new Map(), schedule,
      kingdomId: 'current-duel', runner, looks: [4, 8], chunkSize: 1,
      evaluate: evaluator(() => { throw new Error('completed raw range was replayed'); }, replayCalls) as never,
      raw: store });
    expect(replayCalls).toEqual([]);
    expect(replay.confirmed).toEqual(first.confirmed);
    expect(replay.unresolved).toEqual(first.unresolved);
    expect(replay.telemetry).toEqual(first.telemetry);
    expect(replay.telemetry.damageByCard.volley).toBeGreaterThan(0);
    expect(saved.size).toBe(firstCalls.length);
  });

  it('records four isolated seed namespaces and changes protocol identity when any namespace changes', () => {
    const held = createThresholdRacingProtocol({ experimentName: 'campaign-psro-fixture', runId: 'run',
      kingdomId: 'current-duel', reservoirCount: 20_000, sourceIdentityHash: 'a'.repeat(64),
      checkpointNamespace: 'checkpoints', matrixSeedNamespace: 'matrix-v4', screenSeedNamespace: 'screen-v4',
      confirmationSeedNamespace: 'confirmation-v4', queueRetestSeedNamespace: 'retest-v4' });
    expect(held).toMatchObject({ matrixSeedNamespace: 'matrix-v4', screenSeedNamespace: 'screen-v4',
      confirmationSeedNamespace: 'confirmation-v4', queueRetestSeedNamespace: 'retest-v4' });
    const changed = createThresholdRacingProtocol({ ...held, screenSeedNamespace: 'screen-v5' });
    expect(thresholdRacingProtocolHash(changed)).not.toBe(thresholdRacingProtocolHash(held));
    expect(validateThresholdRacingProtocol({ ...held, queueRetestSeedNamespace: 'screen-v4' })).toBe(false);
    expect(thresholdRacingSeedLabel(held, 'screen', 'scan:1')).toBe('screen-v4:scan:1');
    expect(thresholdRacingSeedLabel(held, 'confirmation', 'scan:1')).toBe('confirmation-v4:scan:1');
    expect(thresholdRacingSeedLabel(held, 'queue-retest', 'queue:1')).toBe('retest-v4:queue:1');
    expect(thresholdRacingSeedLabel(undefined, 'screen', 'scan:1')).toBe('scan:1');
  });

  it('changes protocol identity for a fixed-look extension and rejects malformed protocol fields', () => {
    const base = protocol();
    expect(validateThresholdRacingProtocol(base)).toBe(true);
    expect(validateThresholdRacingProtocol({ ...base, extra: true })).toBe(false);
    expect(validateThresholdRacingProtocol({ ...base, sourceIdentityHash: 'short' })).toBe(false);
    expect(validateThresholdRacingProtocol({ ...base, screenDepths: [8, 15] })).toBe(false);
    const extended = createThresholdRacingProtocol({ ...base, protocolVersion: 'threshold-racing-psro-v3',
      confirmationLooks: [4, 8, 16] });
    expect(thresholdRacingProtocolHash(extended)).not.toBe(thresholdRacingProtocolHash(base));
  });
});
