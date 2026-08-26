import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import type { EquilibriumResult } from '../../src/sim/equilibrium';
import {
  DIAGONAL_PURPOSE, OFF_DIAGONAL_PURPOSE, analyzeInitialMatrix,
  assertInitialMatrixOutputJsonFiles, createInitialMatrixChunk, createInitialMatrixManifest,
  initialMatrixGameCosts, seedRecordFromOutcome, summarizeInitialMatrixAcquisitions,
  validateInitialMatrixChunk, validateInitialMatrixManifest
} from '../../src/sim/initialMatrixCalibration';
import type {
  InitialMatrixCellSeries, InitialMatrixSeedRecord, InitialMatrixSourceIdentity
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
function telemetry(strategies: readonly Strategy[], acquisitions: Readonly<Record<string, Record<string, number>>>) {
  const value = emptyAggregate();
  for (const held of new Map(strategies.map((entry) => [entry.id, entry])).values()) {
    value.acquisitionsByStrategy[held.id] = { ...(acquisitions[held.id] ?? {}) };
    value.planPositionPurchasesByStrategy![held.id] = {};
  }
  value.byOrientation.firstOchre.normal = { played: 1, wins: 0, draws: 1, losses: 0, aborted: 0 };
  value.byOrientation.firstIndigo.normal = { played: 1, wins: 0, draws: 1, losses: 0, aborted: 0 };
  return value;
}
function record(seed: number, row: Strategy, column: Strategy,
  acquisitions: Readonly<Record<string, Record<string, number>>>, payoffScore = 0.5): InitialMatrixSeedRecord {
  return { seed, payoffScore: row.id === column.id ? null : payoffScore,
    played: 2, aborted: 0, matches: 2, telemetry: telemetry([row, column], acquisitions) };
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
function completeCells(strategies: readonly Strategy[], seeds: readonly number[]): InitialMatrixCellSeries[] {
  const cells: InitialMatrixCellSeries[] = [];
  for (let row = 0; row < strategies.length; row += 1) for (let column = row; column < strategies.length; column += 1) {
    const rowStrategy = strategies[row]!, columnStrategy = strategies[column]!;
    const acquisitions = row === column
      ? { [rowStrategy.id]: { drive: 4 } }
      : { [rowStrategy.id]: { drive: 2 }, [columnStrategy.id]: { drive: 2 } };
    cells.push({ purpose: row === column ? DIAGONAL_PURPOSE : OFF_DIAGONAL_PURPOSE,
      rowIndex: row, columnIndex: column,
      records: seeds.map((seed) => record(seed, rowStrategy, columnStrategy, acquisitions)) });
  }
  return cells;
}
function selectedLottery(weights: Record<string, number>): EquilibriumResult {
  const strategyIds = Object.keys(weights).sort();
  return { strategyIds, weights, maximumEquilibriumWeight: { ...weights }, value: 0,
    maximumKnownAdvantage: 0, residuals: { nonnegative: 0, totalWeight: 0, value: 0, payoff: 0 } };
}

describe('initial-matrix calibration v2 evidence', () => {
  it('requires every diagonal cell and keeps diagonal observed scores out of payoffs', () => {
    const a = strategy('a', 'drive'), b = strategy('b', 'volley'), c = strategy('c', 'fireball');
    const cells = completeCells([a, b, c], [1, 2]);
    expect(() => analyzeInitialMatrix({ strategies: [a, b, c], cells: cells.slice(0, -1), seedCount: 2,
      requestedPrefixes: [1], heldOutStartSeedIndex: 1,
      measuredChunkWallMs: { offDiagonal: 8, diagonalTelemetry: 3 } })).toThrow('cell series is incomplete');

    const diagonalTelemetry = telemetry([a], { a: { drive: 4 } });
    const diagonalRecord = seedRecordFromOutcome({ seed: 1, score: 1, played: 2, aborted: 0 },
      diagonalTelemetry, 2, DIAGONAL_PURPOSE);
    expect(diagonalRecord.payoffScore).toBeNull();
    expect(() => seedRecordFromOutcome({ seed: 1, score: 1, played: 2, aborted: 0 },
      diagonalTelemetry, 4, DIAGONAL_PURPOSE)).toThrow('seed outcome is invalid');
    const withObservedDiagonalWin = cells.map((cell) => cell.rowIndex === 0 && cell.columnIndex === 0
      ? { ...cell, records: [diagonalRecord, cell.records[1]!] } : cell);
    const report = analyzeInitialMatrix({ strategies: [a, b, c], cells: withObservedDiagonalWin, seedCount: 2,
      requestedPrefixes: [1], heldOutStartSeedIndex: 1,
      measuredChunkWallMs: { offDiagonal: 8, diagonalTelemetry: 3 } });
    expect(report.prefixes[0]!.equilibrium.maximumKnownAdvantage).toBe(0);
    expect(report.evidenceCosts.total.measuredChunkWallMs).toBe(11);
  });

  it('weights opponent-dependent acquisitions by the selected lottery and includes self-play', () => {
    const a = strategy('a', 'drive'), b = strategy('b', 'volley'), c = strategy('c', 'fireball');
    const strategies = [a, b, c];
    const cells: InitialMatrixCellSeries[] = [
      { purpose: DIAGONAL_PURPOSE, rowIndex: 0, columnIndex: 0,
        records: [record(1, a, a, { a: { drive: 8 } })] },
      { purpose: OFF_DIAGONAL_PURPOSE, rowIndex: 0, columnIndex: 1,
        records: [record(1, a, b, { a: { volley: 2 }, b: { volley: 4 } })] },
      { purpose: OFF_DIAGONAL_PURPOSE, rowIndex: 0, columnIndex: 2,
        records: [record(1, a, c, { a: { fireball: 100 }, c: { fireball: 4 } })] },
      { purpose: DIAGONAL_PURPOSE, rowIndex: 1, columnIndex: 1,
        records: [record(1, b, b, { b: { volley: 8 } })] },
      { purpose: OFF_DIAGONAL_PURPOSE, rowIndex: 1, columnIndex: 2,
        records: [record(1, b, c, { b: { volley: 4 }, c: { fireball: 4 } })] },
      { purpose: DIAGONAL_PURPOSE, rowIndex: 2, columnIndex: 2,
        records: [record(1, c, c, { c: { fireball: 8 } })] }
    ];
    const equilibrium = selectedLottery({ a: 0.75, b: 0.25, c: 0 });
    const summary = summarizeInitialMatrixAcquisitions({ strategies, cells, seedCount: 1, equilibrium,
      centeredPayoffs: strategies.map(() => strategies.map(() => 0)) });

    expect(summary.strategyAcquisitionRates.a).toEqual({ drive: 1.5, volley: 0.25, fireball: 0 });
    expect(summary.strategyAcquisitionRates.a!.drive).not.toBeCloseTo(8 / 12);
    expect(summary.strategyLabels.a).toBe('Melee');
    expect(summary.selectedArchetypeShares).toMatchObject({ Melee: 0.75, Ranged: 0.25, Mage: 0 });
    expect(summary.expectedCopiesPerPlayerGame.drive).toBe(1.125);
    expect(summary.feasibleArchetypeRanges.Melee).toEqual({ minimum: 0, maximum: 1 });
    expect(summary.feasibleArchetypeRanges.Melee!.minimum)
      .toBeLessThanOrEqual(summary.selectedArchetypeShares.Melee!);
    expect(summary.feasibleArchetypeRanges.Melee!.maximum)
      .toBeGreaterThanOrEqual(summary.selectedArchetypeShares.Melee!);
  });

  it('reports the exact max-125 prefix and held-out game costs', () => {
    expect(initialMatrixGameCosts(50, 125)).toEqual({
      offDiagonalGames: 306_250, diagonalTelemetryGames: 12_500, totalGames: 318_750
    });
    expect(initialMatrixGameCosts(50, 100)).toEqual({
      offDiagonalGames: 245_000, diagonalTelemetryGames: 10_000, totalGames: 255_000
    });
    expect(initialMatrixGameCosts(50, 75)).toEqual({
      offDiagonalGames: 183_750, diagonalTelemetryGames: 7_500, totalGames: 191_250
    });
    expect(initialMatrixGameCosts(50, 25)).toEqual({
      offDiagonalGames: 61_250, diagonalTelemetryGames: 2_500, totalGames: 63_750
    });
    expect(createInitialMatrixManifest({ source: source(), strategies: fiftyStrategies(),
      maxSeedCount: 125, chunkSize: 5 }).protocol.seeds).toHaveLength(125);
    expect(() => createInitialMatrixManifest({ source: source(), strategies: fiftyStrategies(),
      maxSeedCount: 126, chunkSize: 5 })).toThrow('manifest input is invalid');

    const small = [strategy('a', 'drive'), strategy('b', 'volley')];
    const report = analyzeInitialMatrix({ strategies: small,
      cells: completeCells(small, Array.from({ length: 125 }, (_unused, index) => index + 1)),
      seedCount: 125, requestedPrefixes: [75, 100], heldOutStartSeedIndex: 100,
      measuredChunkWallMs: { offDiagonal: 2, diagonalTelemetry: 1 } });
    expect(report.prefixes.map((entry) => entry.seedRange)).toEqual([
      { startOrdinal: 1, endOrdinal: 75, count: 75 },
      { startOrdinal: 1, endOrdinal: 100, count: 100 }
    ]);
    expect(report.heldOut.seedRange).toEqual({ startOrdinal: 101, endOrdinal: 125, count: 25 });
  });

  it('compares every prefix with the same held-out acquisition cells', () => {
    const a = strategy('a', 'drive'), b = strategy('b', 'volley');
    const seeds = Array.from({ length: 125 }, (_unused, index) => index + 1);
    const heldOut = (seed: number) => seed > 100;
    const cells: InitialMatrixCellSeries[] = [
      { purpose: DIAGONAL_PURPOSE, rowIndex: 0, columnIndex: 0,
        records: seeds.map((seed) => record(seed, a, a,
          { a: heldOut(seed) ? { volley: 4 } : { drive: 4 } })) },
      { purpose: OFF_DIAGONAL_PURPOSE, rowIndex: 0, columnIndex: 1,
        records: seeds.map((seed) => record(seed, a, b, heldOut(seed)
          ? { a: { volley: 2 }, b: { fireball: 2 } }
          : { a: { drive: 2 }, b: { drive: 2 } }, seed <= 75 ? 2 / 3 : seed <= 100 ? 0 : 0.5)) },
      { purpose: DIAGONAL_PURPOSE, rowIndex: 1, columnIndex: 1,
        records: seeds.map((seed) => record(seed, b, b,
          { b: heldOut(seed) ? { fireball: 4 } : { drive: 4 } })) }
    ];
    const report = analyzeInitialMatrix({ strategies: [a, b], cells, seedCount: 125,
      requestedPrefixes: [75, 100], heldOutStartSeedIndex: 100,
      measuredChunkWallMs: { offDiagonal: 2, diagonalTelemetry: 1 } });
    const evaluations = report.prefixes.map((prefix) => prefix.heldOutAcquisitionEvaluation);

    expect(evaluations.map((evaluation) => evaluation.seedRange)).toEqual([
      { startOrdinal: 101, endOrdinal: 125, count: 25 },
      { startOrdinal: 101, endOrdinal: 125, count: 25 }
    ]);
    expect(report.prefixes[0]!.equilibrium.weights).toMatchObject({ a: 1, b: 0 });
    expect(report.prefixes[1]!.equilibrium.weights).toMatchObject({ a: 0.5, b: 0.5 });
    for (const evaluation of evaluations) {
      expect(evaluation.acquisitions.strategyAcquisitionRates.a).toEqual({ volley: 1 });
      expect(evaluation.acquisitions.strategyAcquisitionRates.b).toEqual({ fireball: 1 });
      expect(evaluation.acquisitions.strategyLabels).toMatchObject({ a: 'Ranged', b: 'Mage' });
    }
    expect(evaluations[0]!.acquisitions.selectedArchetypeShares).toMatchObject({ Ranged: 1, Mage: 0 });
    expect(evaluations[0]!.acquisitions.expectedCopiesPerPlayerGame).toEqual({ volley: 1, fireball: 0 });
    expect(evaluations[1]!.acquisitions.selectedArchetypeShares).toMatchObject({ Ranged: 0.5, Mage: 0.5 });
    expect(evaluations[1]!.acquisitions.expectedCopiesPerPlayerGame).toEqual({ volley: 0.5, fireball: 0.5 });
  });

  it('rejects v1, stale, corrupt, mistyped, duplicate, and unexpected resume evidence', () => {
    const strategies = fiftyStrategies();
    const manifest = createInitialMatrixManifest({ source: source(), strategies, maxSeedCount: 4, chunkSize: 2 });
    const records = manifest.protocol.seeds.slice(0, 2).map((seed) => record(seed,
      strategies[0]!, strategies[1]!, { [strategies[0]!.id]: { drive: 2 },
        [strategies[1]!.id]: { volley: 2 } }));
    const chunk = createInitialMatrixChunk({ manifest, rowIndex: 0, columnIndex: 1,
      startSeedIndex: 0, records, simulationMs: 3 });
    expect(validateInitialMatrixChunk(chunk, manifest, 0, 1, 0, 2)).toBe(true);

    const changedTelemetry = structuredClone(chunk);
    changedTelemetry.records[0]!.telemetry.acquisitionsByStrategy[strategies[0]!.id]!.drive = 3;
    expect(validateInitialMatrixChunk(changedTelemetry, manifest, 0, 1, 0, 2)).toBe(false);
    const changedTiming = structuredClone(chunk); changedTiming.simulationMs = 4;
    expect(validateInitialMatrixChunk(changedTiming, manifest, 0, 1, 0, 2)).toBe(false);
    const wrongSeed = structuredClone(chunk); wrongSeed.records[0]!.seed += 1;
    expect(validateInitialMatrixChunk(wrongSeed, manifest, 0, 1, 0, 2)).toBe(false);
    const wrongPurpose = structuredClone(chunk); wrongPurpose.purpose = DIAGONAL_PURPOSE;
    expect(validateInitialMatrixChunk(wrongPurpose, manifest, 0, 1, 0, 2)).toBe(false);
    const extraTelemetryKey = structuredClone(chunk);
    extraTelemetryKey.records[0]!.telemetry.acquisitionsByStrategy.unexpected = {};
    expect(validateInitialMatrixChunk(extraTelemetryKey, manifest, 0, 1, 0, 2)).toBe(false);

    const v1 = { ...structuredClone(manifest), schemaVersion: 1,
      protocol: { ...manifest.protocol, version: 'initial-matrix-calibration-v1' } };
    expect(validateInitialMatrixManifest(v1)).toBe(false);
    const changedSource = createInitialMatrixManifest({ source: source('c'.repeat(64)), strategies,
      maxSeedCount: 4, chunkSize: 2 });
    expect(validateInitialMatrixManifest(manifest, changedSource)).toBe(false);
    expect(validateInitialMatrixChunk(chunk, changedSource, 0, 1, 0, 2)).toBe(false);
    const staleRules = { ...source(), ruleFingerprint: 'stale-rules' };
    expect(() => createInitialMatrixManifest({ source: staleRules, strategies,
      maxSeedCount: 4, chunkSize: 2 })).toThrow('rule fingerprint is stale');

    expect(() => assertInitialMatrixOutputJsonFiles(['chunks/pair-00-01/chunk-000000.json'], true, manifest))
      .toThrow('Unexpected initial-matrix JSON file');
    expect(() => assertInitialMatrixOutputJsonFiles(['report.json'], false))
      .toThrow('evidence without a manifest');

    const small = [strategy('a', 'drive'), strategy('b', 'volley')];
    const duplicated = completeCells(small, [1]); duplicated[2] = structuredClone(duplicated[1]!);
    expect(() => summarizeInitialMatrixAcquisitions({ strategies: small, cells: duplicated, seedCount: 1,
      equilibrium: selectedLottery({ a: 0.5, b: 0.5 }), centeredPayoffs: [[0, 0], [0, 0]] }))
      .toThrow('cell series is invalid');
  });
});
