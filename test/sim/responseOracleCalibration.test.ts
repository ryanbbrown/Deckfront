import { beforeAll, describe, expect, it } from 'vitest';
import {
  RESPONSE_ORACLE_CALIBRATION_TARGETS, RESPONSE_ORACLE_CANDIDATE_COUNT,
  RESPONSE_ORACLE_FIXED_DEPTHS, RESPONSE_ORACLE_HALVING_DEPTHS, crossFitCalibrationMetrics,
  createCalibrationScoreChunk, createResponseOracleCalibrationManifest,
  createSuccessiveHalvingArtifact, fixedScreenResults, nextSuccessiveHalvingRound,
  replayStandardSuccessiveHalving, reusedSuccessiveHalvingTopupCost, successiveHalvingCost,
  validateCalibrationScoreChunk, validateResponseOracleCalibrationManifest,
  validateSuccessiveHalvingArtifact
} from '../../src/sim/responseOracleCalibration';
import type {
  CalibrationCandidateIdentity, CalibrationMethodOutput, CalibrationScoreRow,
  CalibrationSourceIdentity, ResponseOracleCalibrationManifest
} from '../../src/sim/responseOracleCalibration';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

function strategy(group: string, index: number): Strategy {
  return identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: `${group}-${index}`, desiredCount: 1 }
  ]) });
}

const source: CalibrationSourceIdentity = {
  kingdomId: 'deep-beam-tuning-001', rankedPath: '/source/ranked.json',
  reservoirPath: '/source/reservoir.json', p75ManifestPath: '/source/manifest.json',
  p75ReportPath: '/source/report.json', rankedSha256: '1'.repeat(64),
  reservoirSha256: '4357b70bd6d114a4eb744b0096040a2f01f8dd9d24573fbb3811e2cd0241e9a8',
  p75ManifestSha256: '724c8831ae96de289b25785a74692c8f2a2622380946fbf736ff4666a3cdc5a9',
  p75ReportSha256: '732cdd4e42fd367606f88dacace27c0201307128121b6363b1af1ba2d08968d4',
  p75ManifestHash: 'da5e59c8e3c56d61c55ca242de3db5aca9227e75b3df29c232525359fef25263',
  reservoirRunId: 'native-541cb83d1e13-568cb4cd8181f5088168',
  reservoirVersion: 'fixture-version', rulesFingerprint: 'fixture-rules'
};
const p75Strategies = Array.from({ length: 50 }, (_unused, index) => strategy('p75', index));
const p75Weights = Object.fromEntries(p75Strategies.map((entry, index) => [entry.id, index === 0 ? 1 : 0]));
const candidateStrategies = Array.from({ length: RESPONSE_ORACLE_CANDIDATE_COUNT },
  (_unused, index) => strategy('candidate', index));
let manifest: ResponseOracleCalibrationManifest;

beforeAll(() => {
  manifest = createResponseOracleCalibrationManifest({ source, p75Strategies, p75Weights,
    candidates: candidateStrategies.map((entry, index) => ({ goldfishRank: index + 51, strategy: entry })) });
});

function identity(index: number): CalibrationCandidateIdentity {
  return { goldfishRank: index + 51, strategyId: `candidate-${index}`, canonicalStrategy: `canonical-${index}` };
}

function row(index: number, first: number, second = first): CalibrationScoreRow {
  return { ...identity(index), blockScores: [...Array<number>(50).fill(first), ...Array<number>(50).fill(second)],
    candidateSeedEvaluations: 100, games: 200 };
}

describe('response-oracle calibration schedules and accounting', () => {
  it('derives deterministic independent lanes and shares one complete lane schedule across a chunk', () => {
    const repeated = createResponseOracleCalibrationManifest({ source, p75Strategies, p75Weights,
      candidates: candidateStrategies.map((entry, index) => ({ goldfishRank: index + 51, strategy: entry })) });
    expect(repeated).toEqual(manifest);
    expect(manifest.schedules.searchA.blocks).toHaveLength(16_384);
    expect(manifest.schedules.searchB.blocks).toHaveLength(16_384);
    expect(manifest.schedules.reference.blocks).toHaveLength(100);
    expect(manifest.schedules.searchA.blocks).not.toEqual(manifest.schedules.searchB.blocks);
    const allSeeds = [...manifest.seedPlan.searchA.gameSeeds, manifest.seedPlan.searchA.opponentSamplingSeed,
      ...manifest.seedPlan.searchB.gameSeeds, manifest.seedPlan.searchB.opponentSamplingSeed,
      ...manifest.seedPlan.reference.gameSeeds, manifest.seedPlan.reference.opponentSamplingSeed];
    expect(new Set(allSeeds).size).toBe(allSeeds.length);

    const chunk = createCalibrationScoreChunk({ manifest, phase: 'search-a', chunk: 0,
      rows: candidateStrategies.slice(0, 250).map((entry) => ({ strategy: entry,
        blockScores: Array<number>(50).fill(0.5), matches: 100 })), elapsedMs: 12.5 });
    expect(chunk.schedule.blocks).toEqual(manifest.schedules.searchA.blocks.slice(0, 50));
    expect(chunk.rows.every((entry) => entry.candidateSeedEvaluations === 50 && entry.games === 100)).toBe(true);
    expect(validateCalibrationScoreChunk(chunk, manifest, 'search-a', 0)).toBe(true);
  });

  it('pins exact fixed, halving, reused-prefix, reference, and suite costs', () => {
    const fixed = RESPONSE_ORACLE_CANDIDATE_COUNT * 50;
    const halving = successiveHalvingCost(RESPONSE_ORACLE_CANDIDATE_COUNT);
    const topups = reusedSuccessiveHalvingTopupCost(RESPONSE_ORACLE_CANDIDATE_COUNT, 50);
    const reference = RESPONSE_ORACLE_CANDIDATE_COUNT * 100;
    expect(halving).toBe(169_165);
    expect(topups).toBe(93_712);
    expect(fixed + topups).toBe(1_091_212);
    expect((fixed + topups) * 2).toBe(2_182_424);
    expect(reference * 2).toBe(3_990_000);
    expect(((fixed + topups) * 2 * 2 + reference * 2) * 3).toBe(25_064_544);
    expect(RESPONSE_ORACLE_FIXED_DEPTHS).toEqual([8, 16, 25, 32, 50]);
    expect(RESPONSE_ORACLE_HALVING_DEPTHS.at(-1)).toBe(16_384);
  });
});

describe('standard Successive Halving and fixed-screen ties', () => {
  it('ranks cumulative means, retains ceil-half fields, and resolves a final tie by stable hash', () => {
    const candidates = [
      { identity: identity(0), blockScores: [1, 0, 0, 0] },
      { identity: identity(1), blockScores: [0.8, 0.8, 0.8, 0.8] },
      { identity: identity(2), blockScores: [0.8, 0.8, 0.8, 0.8] },
      { identity: identity(3), blockScores: [0.6, 0.6, 0.6, 0.6] },
      { identity: identity(4), blockScores: [0.5, 0.5, 0.5, 0.5] },
      { identity: identity(5), blockScores: [0.4, 0.4, 0.4, 0.4] }
    ];
    const first = replayStandardSuccessiveHalving(candidates, [1, 2, 4], 91);
    const repeated = replayStandardSuccessiveHalving(candidates, [1, 2, 4], 91);
    expect(first).toEqual(repeated);
    expect(first.rounds.map((round) => [round.activeIds.length, round.survivors.length]))
      .toEqual([[6, 3], [3, 2], [2, 1]]);
    expect(first.rounds[1]!.rankedIds.at(-1)).toBe(identity(0).strategyId);
    expect(first.rounds[2]!.topScoreTieIds).toHaveLength(2);
    expect(first.finalFourIds).toHaveLength(4);
  });

  it('keeps the complete empirical top tie while naming one and four deterministic outputs', () => {
    const rows = Array.from({ length: 6 }, (_unused, index): CalibrationScoreRow => ({ ...identity(index),
      blockScores: Array<number>(50).fill(index < 5 ? 0.75 : 0.5), candidateSeedEvaluations: 50, games: 100 }));
    const result = fixedScreenResults(rows, 7, [50])[0]!;
    expect(result.topScoreTieIds).toHaveLength(5);
    expect(result.topFourIds).toHaveLength(4);
    expect(result.topScoreTieIds).toContain(result.selectedId);
  });
});

describe('cross-fit reference diagnostics', () => {
  it('selects each fold leader, scores the opposite fold, and reports raw top-one and top-four regret', () => {
    const reference = [row(0, 1, 0.2), row(1, 0.8, 0.9), row(2, 0.7, 0.7), row(3, 0.6, 0.6)];
    const output = (lane: 'a' | 'b', selected: number, order: number[]): CalibrationMethodOutput => ({
      key: 'fixed-50', lane, method: 'fixed', depth: 50, selectedId: identity(selected).strategyId,
      selectedGoldfishRank: selected + 51, topFourIds: order.map((index) => identity(index).strategyId),
      topFourGoldfishRanks: order.map((index) => index + 51), topScoreTieIds: [identity(selected).strategyId],
      candidateSeedEvaluations: 200, games: 400, gamesSavedAgainstFixed50: 0
    });
    const outputs = [output('a', 2, [0, 1, 2, 3]), output('b', 1, [1, 2, 3, 0])];
    const metrics = crossFitCalibrationMetrics(reference, outputs, 11);
    expect(metrics.referenceLeaders.map((entry) => [entry.selectionFold, entry.selectedId]))
      .toEqual([[1, identity(0).strategyId], [2, identity(1).strategyId]]);
    expect(metrics.referenceLeaders[0]!.heldOutScore).toBeCloseTo(0.2);
    expect(metrics.referenceLeaders[1]!.heldOutScore).toBeCloseTo(0.8);
    const laneAFold2 = metrics.crossFitMetrics.find((entry) => entry.lane === 'a' && entry.evaluationFold === 1)!;
    expect(laneAFold2.responseHeldOutScore).toBeCloseTo(0.7);
    expect(laneAFold2.heldOutRegret).toBeCloseTo(0.1);
    expect(laneAFold2.heldOutBestOfFourScore).toBe(1);
    expect(laneAFold2.heldOutBestOfFourRegret).toBeCloseTo(-0.2);
    const agreement = metrics.laneAgreement.find((entry) => entry.evaluationFold === 1)!;
    expect(agreement).toMatchObject({ method: 'fixed-50', evaluationFold: 1, exactIdAgreement: false });
    expect(agreement.scoreDifference).toBeCloseTo(-0.1);
    expect(JSON.stringify(metrics)).not.toMatch(/recall|delta|0\.005/);
  });
});

describe('strict source and resumable evidence validation', () => {
  it('pins every approved max-125 provenance value and rejects any source hash change', () => {
    expect(RESPONSE_ORACLE_CALIBRATION_TARGETS).toEqual({
      'deep-beam-tuning-001': {
        runId: 'native-541cb83d1e13-568cb4cd8181f5088168',
        reservoirSha256: '4357b70bd6d114a4eb744b0096040a2f01f8dd9d24573fbb3811e2cd0241e9a8',
        p75ManifestSha256: '724c8831ae96de289b25785a74692c8f2a2622380946fbf736ff4666a3cdc5a9',
        p75ReportSha256: '732cdd4e42fd367606f88dacace27c0201307128121b6363b1af1ba2d08968d4',
        p75ManifestHash: 'da5e59c8e3c56d61c55ca242de3db5aca9227e75b3df29c232525359fef25263'
      },
      'deep-beam-tuning-007': {
        runId: 'native-1552de33e3cb-ca0b9ed1a6ebdcd051e0',
        reservoirSha256: '17a1e34e0e4322940fa364543de96bfa44372797c2aa197cd2bb34ef97fa9ee9',
        p75ManifestSha256: '176601ec0de344dc4f4f8d6514cc862464d7dd4b589b9e484d90d3109f91bbaf',
        p75ReportSha256: 'b111bee25b8649abc13b28cbe092f14a12046a1af157b25002c1b81518df8c27',
        p75ManifestHash: '9dc4e7ef37fe795fff63d4cb98e88ed2f4d7aa7b4d1490915ab316f0c9edb8ff'
      },
      'deep-beam-tuning-008': {
        runId: 'native-1552de33e3cb-a9c81e98dcc9d46d5ce5',
        reservoirSha256: '56380c680b53f32c81e5128e538ea5b206901b5557bbf1452e2d9f590c8c816d',
        p75ManifestSha256: 'a9ade55c44860881a3c4f97ce0d9b175db779cbea7fb904ac042a59f42845536',
        p75ReportSha256: '9965631a602908cc03a151f34f5fb16b8e7f33357b75780aa2f5ecc7b2c62ffc',
        p75ManifestHash: 'c276da906da08dbbe1935498e9494700754be2c7be8ccaf2ea22a6e36add94a5'
      }
    });
    expect(validateResponseOracleCalibrationManifest(manifest)).toBe(true);
    for (const key of ['reservoirSha256', 'p75ManifestSha256', 'p75ReportSha256',
      'p75ManifestHash'] as const) {
      expect(() => createResponseOracleCalibrationManifest({ source: { ...source, [key]: '9'.repeat(64) },
        p75Strategies, p75Weights, candidates: candidateStrategies.map((entry, index) => ({
          goldfishRank: index + 51, strategy: entry })) })).toThrow('approved P75 targets');
    }
    expect(() => createResponseOracleCalibrationManifest({ source, p75Strategies,
      p75Weights: { [p75Strategies[0]!.id]: 1 }, candidates: candidateStrategies.map((entry, index) => ({
        goldfishRank: index + 51, strategy: entry })) })).toThrow('complete weight');
    expect(() => createResponseOracleCalibrationManifest({ source, p75Strategies, p75Weights,
      candidates: candidateStrategies.map((entry, index) => ({ goldfishRank: index + 52, strategy: entry })) }))
      .toThrow('rank 51');
    expect(() => createResponseOracleCalibrationManifest({ source: { ...source, rankedSha256: 'short' },
      p75Strategies, p75Weights, candidates: candidateStrategies.map((entry, index) => ({
        goldfishRank: index + 51, strategy: entry })) })).toThrow('approved P75 targets');
    const changed = structuredClone(manifest);
    changed.source.reservoirSha256 = '9'.repeat(64);
    expect(validateResponseOracleCalibrationManifest(changed)).toBe(false);
  });

  it('accepts complete chunks and partial round checkpoints but rejects corrupt resume evidence', () => {
    const fixedRows = manifest.candidates.map((entry): CalibrationScoreRow => ({ ...entry,
      blockScores: Array<number>(50).fill((entry.goldfishRank % 4) / 4), candidateSeedEvaluations: 50, games: 100 }));
    const chunk = createCalibrationScoreChunk({ manifest, phase: 'search-b', chunk: 0,
      rows: candidateStrategies.slice(0, 250).map((entry, index) => ({ strategy: entry,
        blockScores: fixedRows[index]!.blockScores, matches: 100 })), elapsedMs: 45 });
    expect(validateCalibrationScoreChunk(chunk, manifest, 'search-b', 0)).toBe(true);
    for (const mutate of [
      (copy: typeof chunk) => { copy.rows[0]!.blockScores[0] = 0.9; },
      (copy: typeof chunk) => { copy.elapsedMs += 1; },
      (copy: typeof chunk) => { copy.schedule.blocks[0]!.seed += 1; }
    ]) {
      const copy = structuredClone(chunk); mutate(copy);
      expect(validateCalibrationScoreChunk(copy, manifest, 'search-b', 0)).toBe(false);
    }

    const empty = createSuccessiveHalvingArtifact({ manifest, lane: 'b', fixedRows });
    const first = nextSuccessiveHalvingRound({ manifest, lane: 'b', fixedRows, artifact: empty,
      addedScores: Object.fromEntries(manifest.candidates.map((entry) => [entry.strategyId, []])), elapsedMs: 0 });
    expect(validateSuccessiveHalvingArtifact(first, manifest, 'b', fixedRows)).toBe(true);
    const corrupt = structuredClone(first);
    corrupt.rounds[0]!.survivors.reverse();
    expect(validateSuccessiveHalvingArtifact(corrupt, manifest, 'b', fixedRows)).toBe(false);
  }, 30_000);

  it('resumes after the fixed-score prefix and validates the first top-up round at depth 64', () => {
    const fixedRows = manifest.candidates.map((entry): CalibrationScoreRow => ({ ...entry,
      blockScores: Array.from({ length: 50 }, (_unused, index) => ((entry.goldfishRank + index) % 5) / 4),
      candidateSeedEvaluations: 50, games: 100 }));
    let artifact = createSuccessiveHalvingArtifact({ manifest, lane: 'a', fixedRows });
    for (let roundIndex = 0; roundIndex <= 6; roundIndex += 1) {
      const depth = RESPONSE_ORACLE_HALVING_DEPTHS[roundIndex]!;
      const scoreStart = depth <= 50 ? depth
        : Math.max(50, RESPONSE_ORACLE_HALVING_DEPTHS[roundIndex - 1]!);
      const added = depth - scoreStart;
      if (roundIndex === 6) {
        const resumed = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
        expect(validateSuccessiveHalvingArtifact(resumed, manifest, 'a', fixedRows)).toBe(true);
        artifact = resumed;
      }
      const activeIds = roundIndex === 0 ? manifest.candidates.map((entry) => entry.strategyId)
        : artifact.rounds.at(-1)!.survivors;
      artifact = nextSuccessiveHalvingRound({ manifest, lane: 'a', fixedRows, artifact,
        addedScores: Object.fromEntries(activeIds.map((id) => [id, Array<number>(added).fill(0.75)])),
        elapsedMs: roundIndex });
    }

    const resumedAtDepth64 = JSON.parse(JSON.stringify(artifact)) as unknown;
    expect(artifact.rounds.at(-1)).toMatchObject({ depth: 64, scoreStart: 50 });
    expect(validateSuccessiveHalvingArtifact(resumedAtDepth64, manifest, 'a', fixedRows)).toBe(true);
  }, 30_000);
});
