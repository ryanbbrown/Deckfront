import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import {
  analyzeInitialMatrix, createInitialMatrixChunk, createInitialMatrixManifest,
  seedRecordFromOutcome, validateInitialMatrixChunk, validateInitialMatrixManifest
} from '../../src/sim/initialMatrixCalibration';
import type {
  InitialMatrixPairSeries, InitialMatrixSeedRecord, InitialMatrixSourceIdentity
} from '../../src/sim/initialMatrixCalibration';
import { nativeRuleFingerprint } from '../../src/sim/nativeGoldfishProtocol';
import { emptyAggregate } from '../../src/sim/pairing';
import { fixedBuyPlan } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

const kingdomId = 'deep-beam-tuning-001';

beforeAll(() => registerKingdom(deepBeamSuite.kingdoms.find((kingdom) => kingdom.id === kingdomId)!));

function strategy(id: string, cardId: string, desiredCount = 1): Strategy {
  return { id, startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'buy', cardId, desiredCount }]) };
}
function telemetry(left: Strategy, right: Strategy, leftCard: string, rightCard: string) {
  const value = emptyAggregate();
  value.acquisitionsByStrategy[left.id] = { [leftCard]: 2 };
  value.acquisitionsByStrategy[right.id] = { [rightCard]: 2 };
  value.planPositionPurchasesByStrategy![left.id] = { 0: 1 };
  value.planPositionPurchasesByStrategy![right.id] = { 0: 1 };
  value.byOrientation.firstOchre.normal = { played: 1, wins: 0, draws: 1, losses: 0, aborted: 0 };
  value.byOrientation.firstIndigo.normal = { played: 1, wins: 0, draws: 1, losses: 0, aborted: 0 };
  return value;
}
function record(seed: number, score: number, left: Strategy, right: Strategy,
  leftCard: string, rightCard: string): InitialMatrixSeedRecord {
  return { seed, score, played: 2, aborted: 0, matches: 2,
    telemetry: telemetry(left, right, leftCard, rightCard) };
}
function source(reservoirSha256 = 'b'.repeat(64)): InitialMatrixSourceIdentity {
  return { kingdomId, rankedSha256: 'a'.repeat(64), reservoirSha256, runId: 'fixture',
    productVersion: 'k001-ordered-product-calibration-v1', buildVersion: 'fixture',
    scorerVersion: 'native-goldfish-v1', ruleFingerprint: nativeRuleFingerprint(kingdomId, 30, 200),
    candidateProvenanceDigest: '8a4759823fa' };
}

function fiftyStrategies(): Strategy[] {
  return Array.from({ length: 50 }, (_unused, index) => strategy(`strategy-${String(index).padStart(2, '0')}`,
    index % 2 ? 'volley' : 'drive', index + 1));
}

describe('initial-matrix calibration evidence', () => {
  it('requires exactly two games in every seed record and counts all unordered pairs', () => {
    const a = strategy('a', 'drive'), b = strategy('b', 'volley');
    const validTelemetry = telemetry(a, b, 'drive', 'volley');
    expect(seedRecordFromOutcome({ seed: 7, score: 0.5, played: 2, aborted: 0 }, validTelemetry, 2))
      .toMatchObject({ seed: 7, played: 2, matches: 2, aborted: 0 });
    expect(() => seedRecordFromOutcome({ seed: 7, score: 0.5, played: 2, aborted: 0 },
      validTelemetry, 4)).toThrow('seed outcome is invalid');

    const c = strategy('c', 'fireball');
    const pairs: InitialMatrixPairSeries[] = [
      { rowIndex: 0, columnIndex: 1, records: [record(1, 1, a, b, 'drive', 'volley'),
        record(2, 0, a, b, 'drive', 'volley')] },
      { rowIndex: 0, columnIndex: 2, records: [record(1, 0.5, a, c, 'drive', 'fireball'),
        record(2, 0.5, a, c, 'drive', 'fireball')] },
      { rowIndex: 1, columnIndex: 2, records: [record(1, 0, b, c, 'volley', 'fireball'),
        record(2, 1, b, c, 'volley', 'fireball')] }
    ];
    const report = analyzeInitialMatrix({ strategies: [a, b, c], pairs, seedCount: 2,
      requestedPrefixes: [1], heldOutStartSeedIndex: 1, simulationMs: 12 });
    expect(report.exactGameCount).toBe(12);
    expect(report.prefixes[0]!.games).toBe(6);
    expect(report.heldOut.games).toBe(6);
    expect(report.telemetryAvailability.diagonalSelfPlay).toContain('unavailable');
  });

  it('reuses exact nested seed prefixes for payoffs and actual acquisitions', () => {
    const a = strategy('a', 'drive'), b = strategy('b', 'volley'), c = strategy('c', 'fireball');
    const cards = [['drive', 'volley'], ['drive', 'fireball'], ['volley', 'fireball']] as const;
    const scores = [[1, 0, 1, 0], [0.5, 0.5, 0, 1], [0, 1, 1, 0]];
    const indexes = [[0, 1], [0, 2], [1, 2]] as const;
    const strategies = [a, b, c];
    const pairs = indexes.map(([rowIndex, columnIndex], pairIndex): InitialMatrixPairSeries => ({
      rowIndex, columnIndex, records: scores[pairIndex]!.map((score, seedIndex) => record(seedIndex + 1,
        score, strategies[rowIndex]!, strategies[columnIndex]!, cards[pairIndex]![0], cards[pairIndex]![1]))
    }));
    const report = analyzeInitialMatrix({ strategies, pairs, seedCount: 4,
      requestedPrefixes: [1, 2, 3], heldOutStartSeedIndex: 3, simulationMs: 25 });
    expect(report.prefixes.map((entry) => entry.games)).toEqual([6, 12, 18]);
    expect(report.prefixes[0]!.acquisitions.strategyAcquisitionRates.a).toEqual({ drive: 1 });
    expect(report.prefixes[1]!.acquisitions.strategyAcquisitionRates.a).toEqual({ drive: 1 });
    expect(report.prefixes[2]!.equilibrium.strategyIds).toEqual(['a', 'b', 'c']);
    expect(report.prefixes.every((entry) => Number.isFinite(
      entry.heldOutRestrictedExploitability.score))).toBe(true);
    expect(report.prefixes.every((entry) => Number.isFinite(entry.heldOutDirectStrength.score))).toBe(true);
  });

  it('rejects corrupt chunks and a resume manifest from different source bytes', () => {
    const strategies = fiftyStrategies();
    const manifest = createInitialMatrixManifest({ source: source(), strategies, maxSeedCount: 4, chunkSize: 2 });
    const records = manifest.protocol.seeds.slice(0, 2).map((seed) => record(seed, 0.5,
      strategies[0]!, strategies[1]!, 'drive', 'volley'));
    const chunk = createInitialMatrixChunk({ manifest, rowIndex: 0, columnIndex: 1,
      startSeedIndex: 0, records, simulationMs: 3 });
    expect(validateInitialMatrixChunk(chunk, manifest, 0, 1, 0, 2)).toBe(true);
    const corrupt = structuredClone(chunk);
    corrupt.records[0]!.score = 1;
    expect(validateInitialMatrixChunk(corrupt, manifest, 0, 1, 0, 2)).toBe(false);

    const changedSource = createInitialMatrixManifest({ source: source('c'.repeat(64)), strategies,
      maxSeedCount: 4, chunkSize: 2 });
    expect(validateInitialMatrixManifest(manifest, changedSource)).toBe(false);
    expect(validateInitialMatrixChunk(chunk, changedSource, 0, 1, 0, 2)).toBe(false);
  });

  it('fails closed when current rules differ from ordered source rules', () => {
    const stale = { ...source(), ruleFingerprint: 'stale-rules' };
    expect(() => createInitialMatrixManifest({ source: stale, strategies: fiftyStrategies(),
      maxSeedCount: 4, chunkSize: 2 })).toThrow('rule fingerprint is stale');
  });
});
