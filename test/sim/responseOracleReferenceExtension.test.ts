import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mixtureSchedule } from '../../src/sim/mixtureEvaluation';
import {
  RESPONSE_ORACLE_CALIBRATION_TARGETS, RESPONSE_ORACLE_CANDIDATE_COUNT,
  calibrationChunkBounds, calibrationChunkCount, calibrationSeed,
  createResponseOracleCalibrationManifest, crossFitCalibrationMetricsForFolds
} from '../../src/sim/responseOracleCalibration';
import type {
  CalibrationMethodOutput, CalibrationScoreRow, CalibrationSourceIdentity,
  ResponseOracleCalibrationManifest, ResponseOracleCalibrationReport
} from '../../src/sim/responseOracleCalibration';
import {
  RESPONSE_ORACLE_EXTENSION_CANDIDATE_SEED_EVALUATIONS, RESPONSE_ORACLE_EXTENSION_GAMES,
  createResponseOracleContinuationSchedule, createResponseOracleReferenceExtensionChunk,
  createResponseOracleReferenceExtensionManifest, responseOracleParetoAnalysis,
  validateResponseOracleReferenceExtensionChunk, validateResponseOracleReferenceExtensionManifest
} from '../../src/sim/responseOracleReferenceExtension';
import type { ResponseOracleReferenceExtensionManifest } from '../../src/sim/responseOracleReferenceExtension';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import {
  assertResponseOracleReferenceExtensionFiles, parseResponseOracleReferenceExtensionOptions
} from '../../scripts/response_oracle_reference_extension';

function strategy(group: string, index: number): Strategy {
  return identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: `${group}-${index}`, desiredCount: 1 }
  ]) });
}

const target = RESPONSE_ORACLE_CALIBRATION_TARGETS['deep-beam-tuning-001'];
const source: CalibrationSourceIdentity = {
  kingdomId: 'deep-beam-tuning-001', rankedPath: '/source/ranked.json',
  reservoirPath: '/source/reservoir.json', p75ManifestPath: '/source/manifest.json',
  p75ReportPath: '/source/report.json', rankedSha256: '1'.repeat(64),
  reservoirSha256: target.reservoirSha256, p75ManifestSha256: target.p75ManifestSha256,
  p75ReportSha256: target.p75ReportSha256, p75ManifestHash: target.p75ManifestHash,
  reservoirRunId: target.runId, reservoirVersion: 'fixture-version', rulesFingerprint: 'fixture-rules'
};
const p75Strategies = Array.from({ length: 50 }, (_unused, index) => strategy('p75-extension', index));
const p75Weights = Object.fromEntries(p75Strategies.map((entry, index) =>
  [entry.id, index < 2 ? 0.5 : 0]));
const candidateStrategies = Array.from({ length: RESPONSE_ORACLE_CANDIDATE_COUNT },
  (_unused, index) => strategy('extension-candidate', index));
let manifest: ResponseOracleCalibrationManifest;
let extensionManifest: ResponseOracleReferenceExtensionManifest;
let baseReport: ResponseOracleCalibrationReport;

beforeAll(() => {
  manifest = createResponseOracleCalibrationManifest({ source, p75Strategies, p75Weights,
    candidates: candidateStrategies.map((entry, index) => ({ goldfishRank: index + 51, strategy: entry })) });
  baseReport = {
    version: 'response-oracle-calibration-v1', manifestHash: manifest.evidenceHash,
    evidenceHash: '2'.repeat(64), sourceArtifactHashes: ['3'.repeat(64)]
  } as ResponseOracleCalibrationReport;
  extensionManifest = createResponseOracleReferenceExtensionManifest({
    baseRoot: '/evidence/response-oracle-calibration/deep-beam-tuning-001', manifest, report: baseReport
  });
});

describe('response-oracle reference continuation schedule', () => {
  it('uses deterministic ordinals 101-200 and the second half of one 200-block schedule', () => {
    const first = createResponseOracleContinuationSchedule(manifest);
    const repeated = createResponseOracleContinuationSchedule(manifest);
    expect(first).toEqual(repeated);
    expect(manifest.seedPlan.reference.gameSeeds).toMatchObject({
      0: 1_433_235_575, 99: 3_308_387_887
    });
    expect(first.gameSeeds).toMatchObject({ 0: 3_982_176_612, 99: 1_785_838_714 });
    expect(first.gameSeeds).toEqual(Array.from({ length: 100 }, (_unused, index) =>
      calibrationSeed(source, 'reference:game', index + 100)));
    expect(first.combinedSchedule.blocks.slice(0, 100)).toEqual(manifest.schedules.reference.blocks);
    expect(first.extensionSchedule.blocks).toEqual(first.combinedSchedule.blocks.slice(100, 200));
    expect(new Set([...manifest.seedPlan.searchA.gameSeeds, manifest.seedPlan.searchA.opponentSamplingSeed,
      ...manifest.seedPlan.searchB.gameSeeds, manifest.seedPlan.searchB.opponentSamplingSeed,
      ...manifest.seedPlan.reference.gameSeeds, manifest.seedPlan.reference.opponentSamplingSeed,
      ...first.gameSeeds]).size).toBe(16_384 * 2 + 2 + 100 + 1 + 100);

    const restarted = mixtureSchedule(manifest.p75Weights, first.gameSeeds,
      manifest.seedPlan.reference.opponentSamplingSeed);
    expect(restarted.blocks).not.toEqual(first.extensionSchedule.blocks);
  });

  it('pins every deterministic manifest field and rejects any saved mutation', () => {
    const repeated = createResponseOracleReferenceExtensionManifest({
      baseRoot: extensionManifest.base.root, manifest, report: baseReport
    });
    expect(repeated).toEqual(extensionManifest);
    expect(extensionManifest.protocol).toMatchObject({ searchReruns: false, admissions: false,
      closure: false, toleranceApplied: false, automaticFurtherExtension: false });
    expect(extensionManifest.extensionSchedule.blocks).toHaveLength(100);
    expect(JSON.stringify(extensionManifest)).not.toContain('blockScores');
    for (const mutate of [
      (copy: ResponseOracleReferenceExtensionManifest) => { copy.protocol.combinedFolds[1].startOrdinal = 100 as 101; },
      (copy: ResponseOracleReferenceExtensionManifest) => { copy.continuationSeedPlan.gameSeeds[0]! += 1; },
      (copy: ResponseOracleReferenceExtensionManifest) => { copy.extensionSchedule.blocks[0]!.seed += 1; },
      (copy: ResponseOracleReferenceExtensionManifest) => { copy.base.reportHash = '4'.repeat(64); }
    ]) {
      const copy = structuredClone(extensionManifest);
      mutate(copy);
      expect(validateResponseOracleReferenceExtensionManifest(copy,
        { baseRoot: extensionManifest.base.root, manifest, report: baseReport })).toBe(false);
    }
  });
});

describe('response-oracle reference extension chunks and accounting', () => {
  it('validates first and final chunks and pins the complete added cost', () => {
    const makeChunk = (chunk: number) => {
      const bounds = calibrationChunkBounds(chunk);
      const candidates = candidateStrategies.slice(bounds.startRank - 51, bounds.endRank - 50);
      return createResponseOracleReferenceExtensionChunk({ extensionManifest, baseManifest: manifest, chunk,
        rows: candidates.map((entry) => ({ strategy: entry,
          blockScores: Array<number>(100).fill(0.5), matches: 200 })), elapsedMs: chunk + 0.25 });
    };
    const first = makeChunk(0), last = makeChunk(calibrationChunkCount() - 1);
    expect(first).toMatchObject({ startRank: 51, endRank: 300,
      candidateSeedEvaluations: 25_000, games: 50_000 });
    expect(last).toMatchObject({ startRank: 19_801, endRank: 20_000,
      candidateSeedEvaluations: 20_000, games: 40_000 });
    expect(validateResponseOracleReferenceExtensionChunk(first, extensionManifest, manifest, 0)).toBe(true);
    expect(validateResponseOracleReferenceExtensionChunk(last, extensionManifest, manifest, 79)).toBe(true);
    const evaluations = Array.from({ length: calibrationChunkCount() }, (_unused, chunk) => {
      const bounds = calibrationChunkBounds(chunk); return (bounds.endRank - bounds.startRank + 1) * 100;
    }).reduce((sum, value) => sum + value, 0);
    expect(evaluations).toBe(RESPONSE_ORACLE_EXTENSION_CANDIDATE_SEED_EVALUATIONS);
    expect(evaluations * 2).toBe(RESPONSE_ORACLE_EXTENSION_GAMES);

    for (const mutate of [
      (copy: typeof first) => { copy.rows[0]!.blockScores[0] = 2; },
      (copy: typeof first) => { copy.rows[0]!.strategyId = 'changed'; },
      (copy: typeof first) => { copy.elapsedMs += 1; },
      (copy: typeof first) => { copy.schedule.blocks[0]!.opponentId = 'changed'; }
    ]) {
      const copy = structuredClone(first); mutate(copy);
      expect(validateResponseOracleReferenceExtensionChunk(copy, extensionManifest, manifest, 0)).toBe(false);
    }
  });
});

describe('200-seed folds and raw Pareto diagnostics', () => {
  const identity = (index: number) => ({ goldfishRank: index + 51,
    strategyId: `candidate-${index}`, canonicalStrategy: `canonical-${index}` });
  const row = (index: number, first: number, second: number): CalibrationScoreRow => ({ ...identity(index),
    blockScores: [...Array<number>(100).fill(first), ...Array<number>(100).fill(second)],
    candidateSeedEvaluations: 200, games: 400 });
  const output = (lane: 'a' | 'b', selected: number): CalibrationMethodOutput => ({
    key: 'fixed-50', lane, method: 'fixed', depth: 50, selectedId: identity(selected).strategyId,
    selectedGoldfishRank: selected + 51, topFourIds: [0, 1, 2, 3].map((index) => identity(index).strategyId),
    topFourGoldfishRanks: [51, 52, 53, 54], topScoreTieIds: [identity(selected).strategyId],
    candidateSeedEvaluations: 997_500, games: 1_995_000, gamesSavedAgainstFixed50: 0
  });

  it('selects a different leader on each 100-seed fold and scores the opposite fold', () => {
    const reference = [row(0, 1, 0.2), row(1, 0.8, 0.9), row(2, 0.7, 0.7), row(3, 0.6, 0.6)];
    const result = crossFitCalibrationMetricsForFolds({ reference,
      outputs: [output('a', 2), output('b', 1)], referenceTieSeed: 17,
      folds: [{ fold: 1, start: 0, end: 100 }, { fold: 2, start: 100, end: 200 }] });
    expect(result.referenceLeaders.map((entry) => [entry.selectionFold, entry.selectedId, entry.heldOutScore]))
      .toEqual([[1, identity(0).strategyId, 0.19999999999999962],
        [2, identity(1).strategyId, 0.7999999999999985]]);
    const foldOneEvaluation = result.crossFitMetrics.find((entry) => entry.lane === 'a'
      && entry.evaluationFold === 1)!;
    expect(foldOneEvaluation.heldOutRegret).toBeCloseTo(0.1);
    expect(foldOneEvaluation.heldOutBestOfFourScore).toBe(1);
    expect(result.laneAgreement.find((entry) => entry.evaluationFold === 2)!.scoreDifference)
      .toBeCloseTo(-0.2);
  });

  it('uses exact cost-and-regret domination and deterministic frontier order', () => {
    const pareto = responseOracleParetoAnalysis([
      { methodKey: 'cheap', gamesPerLane: 10, worstTopOneRegret: 0.2, worstTopFourRegret: 0.1 },
      { methodKey: 'better', gamesPerLane: 20, worstTopOneRegret: 0.1, worstTopFourRegret: 0.05 },
      { methodKey: 'dominated', gamesPerLane: 30, worstTopOneRegret: 0.2, worstTopFourRegret: 0.1 },
      { methodKey: 'tradeoff', gamesPerLane: 20, worstTopOneRegret: 0.05, worstTopFourRegret: 0.2 }
    ]);
    expect(pareto.topOneFrontier.map((entry) => entry.methodKey)).toEqual(['cheap', 'tradeoff']);
    expect(pareto.topFourFrontier.map((entry) => entry.methodKey)).toEqual(['cheap', 'better']);
    expect(pareto.dominated.find((entry) => entry.methodKey === 'dominated')).toMatchObject({
      topOneDominatedBy: ['cheap', 'better', 'tradeoff'],
      topFourDominatedBy: ['cheap', 'better'], jointlyDominatedBy: ['cheap', 'better']
    });
    expect(pareto.dominated.find((entry) => entry.methodKey === 'tradeoff')!.jointlyDominatedBy).toEqual([]);
  });
});

describe('extension CLI scope and output allowlist', () => {
  it('supports only run, status, and report with a sibling output root', () => {
    expect(parseResponseOracleReferenceExtensionOptions([
      '--run', '--base', '/base', '--out', '/extension', '--workers', '3'
    ])).toMatchObject({ mode: 'run', baseRoot: '/base', outputRoot: '/extension', workers: 3 });
    expect(() => parseResponseOracleReferenceExtensionOptions([
      '--pool', '--base', '/base', '--out', '/extension'
    ])).toThrow('exactly one');
    expect(() => parseResponseOracleReferenceExtensionOptions([
      '--status', '--base', '/base', '--out', '/base/extension'
    ])).toThrow('outside the base');
    expect(() => parseResponseOracleReferenceExtensionOptions([
      '--report', '--base', '/base', '--out', '/extension', '--workers', '2'
    ])).toThrow('Unknown option --workers');
  });

  it('rejects temporary and unexpected resume files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'response-oracle-extension-'));
    try {
      fs.writeFileSync(path.join(root, 'manifest.json'), '{}');
      fs.mkdirSync(path.join(root, 'reference-101-200'));
      fs.writeFileSync(path.join(root, 'reference-101-200', 'chunk-000.json'), '{}');
      expect(() => assertResponseOracleReferenceExtensionFiles(root)).not.toThrow();
      fs.writeFileSync(path.join(root, 'reference-101-200', 'chunk-001.json.tmp-42'), '{}');
      expect(() => assertResponseOracleReferenceExtensionFiles(root)).toThrow('Unexpected');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
