import { createHash } from 'node:crypto';
import { mixtureSchedule } from './mixtureEvaluation';
import type { MixtureSchedule } from './mixtureEvaluation';
import { GAMES_PER_SEED } from './pairing';
import {
  RESPONSE_ORACLE_CALIBRATION_VERSION, RESPONSE_ORACLE_CANDIDATE_COUNT,
  RESPONSE_ORACLE_CANDIDATE_START_RANK,
  calibrationChunkBounds, calibrationChunkCount, calibrationSeed,
  crossFitCalibrationMetricsForFolds, validateCalibrationScoreChunk,
  validateResponseOracleCalibrationManifest
} from './responseOracleCalibration';
import type {
  CalibrationMethodOutput, CalibrationScoreChunk, CalibrationScoreRow, CrossFitMetric,
  LaneAgreementDiagnostic, ResponseOracleCalibrationManifest, ResponseOracleCalibrationReport
} from './responseOracleCalibration';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export const RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION =
  'response-oracle-reference-extension-200-v1' as const;
export const RESPONSE_ORACLE_EXTENSION_REFERENCE_SEEDS = 100;
export const RESPONSE_ORACLE_EXTENSION_CANDIDATE_SEED_EVALUATIONS = 1_995_000;
export const RESPONSE_ORACLE_EXTENSION_GAMES = 3_990_000;

export interface ResponseOracleReferenceExtensionManifest {
  schemaVersion: 1;
  experiment: 'response-oracle-reference-extension-manifest';
  version: typeof RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION;
  base: {
    root: string;
    kingdomId: string;
    calibrationVersion: typeof RESPONSE_ORACLE_CALIBRATION_VERSION;
    manifestHash: string;
    reportHash: string;
    reportSourceArtifactHashes: string[];
  };
  protocol: {
    candidateRankRange: { start: 51; end: 20_000; count: 19_950 };
    originalReferenceOrdinals: { start: 1; end: 100; count: 100 };
    extensionReferenceOrdinals: { start: 101; end: 200; count: 100 };
    combinedFolds: [
      { fold: 1; startOrdinal: 1; endOrdinal: 100; count: 100 },
      { fold: 2; startOrdinal: 101; endOrdinal: 200; count: 100 }
    ];
    chunkSize: 250;
    gamesPerSeedEvaluation: typeof GAMES_PER_SEED;
    startingDraftEnabled: false;
    turnLimitPerPlayer: 30;
    actionCapPerTurn: 200;
    scoreOnly: true;
    searchReruns: false;
    admissions: false;
    closure: false;
    toleranceApplied: false;
    automaticFurtherExtension: false;
  };
  continuationSeedPlan: {
    label: 'reference:game';
    startIndex: 100;
    endIndexExclusive: 200;
    gameSeeds: number[];
    opponentSamplingSeed: number;
  };
  originalScheduleHash: string;
  combinedScheduleHash: string;
  extensionSchedule: MixtureSchedule;
  evidenceHash: string;
}

export interface ResponseOracleReferenceExtensionChunk {
  schemaVersion: 1;
  experiment: 'response-oracle-reference-extension-chunk';
  version: typeof RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION;
  extensionManifestHash: string;
  baseManifestHash: string;
  phase: 'reference-101-200';
  chunk: number;
  startRank: number;
  endRank: number;
  schedule: MixtureSchedule;
  rows: Array<{
    goldfishRank: number;
    strategyId: string;
    canonicalStrategy: string;
    blockScores: number[];
    candidateSeedEvaluations: 100;
    games: 200;
  }>;
  candidateSeedEvaluations: number;
  games: number;
  elapsedMs: number;
  evidenceHash: string;
}

export interface ParetoPoint {
  methodKey: string;
  gamesPerLane: number;
  worstRawRegret: number;
}

export interface ResponseOracleReferenceExtensionReport {
  schemaVersion: 1;
  experiment: 'response-oracle-reference-extension-report';
  version: typeof RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION;
  extensionManifestHash: string;
  base: { manifestHash: string; reportHash: string };
  status: 'raw-metrics-require-user-tolerance';
  searchReruns: false;
  admissions: false;
  closure: false;
  toleranceApplied: false;
  outputs: CalibrationMethodOutput[];
  referenceLeaders: ResponseOracleCalibrationReport['referenceLeaders'];
  crossFitMetrics: CrossFitMetric[];
  laneAgreement: LaneAgreementDiagnostic[];
  rawSummary: Array<{
    methodKey: string;
    topOneRegret: { worst: number; median: number };
    topFourRegret: { worst: number; median: number };
    topOneScore: { worst: number; median: number };
    topFourScore: { worst: number; median: number };
  }>;
  pareto: {
    topOneFrontier: ParetoPoint[];
    topFourFrontier: ParetoPoint[];
    dominated: Array<{
      methodKey: string;
      topOneDominatedBy: string[];
      topFourDominatedBy: string[];
      jointlyDominatedBy: string[];
    }>;
  };
  accounting: {
    originalReference: { candidateSeedEvaluations: 1_995_000; games: 3_990_000 };
    extensionReference: { candidateSeedEvaluations: 1_995_000; games: 3_990_000; elapsedMs: number };
    combinedReference: { candidateSeedEvaluations: 3_990_000; games: 7_980_000 };
    addedGames: 3_990_000;
  };
  sourceArtifactHashes: string[];
  evidenceHash: string;
}

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function unsignedHash<T extends { evidenceHash: string }>(value: T): string {
  const copy = structuredClone(value) as Partial<T>;
  delete copy.evidenceHash;
  return sha256(copy);
}

function scheduleSlice(schedule: MixtureSchedule, start: number, end: number): MixtureSchedule {
  const blocks = schedule.blocks.slice(start, end);
  const ids = Object.keys(schedule.targetWeights);
  const realizedOpponentCounts = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const block of blocks) realizedOpponentCounts[block.opponentId] = realizedOpponentCounts[block.opponentId]! + 1;
  return { targetWeights: structuredClone(schedule.targetWeights), blocks, realizedOpponentCounts,
    unsampledPositiveWeightStrategies: ids.filter((id) => realizedOpponentCounts[id] === 0) };
}

export function createResponseOracleContinuationSchedule(
  manifest: ResponseOracleCalibrationManifest
): { gameSeeds: number[]; combinedSchedule: MixtureSchedule; extensionSchedule: MixtureSchedule } {
  if (!validateResponseOracleCalibrationManifest(manifest)) throw new Error('Base calibration manifest is invalid.');
  const gameSeeds = Array.from({ length: RESPONSE_ORACLE_EXTENSION_REFERENCE_SEEDS }, (_unused, offset) =>
    calibrationSeed(manifest.source, 'reference:game', 100 + offset));
  const combinedSeeds = [...manifest.seedPlan.reference.gameSeeds, ...gameSeeds];
  const combinedSchedule = mixtureSchedule(manifest.p75Weights, combinedSeeds,
    manifest.seedPlan.reference.opponentSamplingSeed);
  if (!exact(combinedSchedule.blocks.slice(0, 100), manifest.schedules.reference.blocks)) {
    throw new Error('The saved original reference schedule is not the prefix of the 200-seed schedule.');
  }
  const originalSeeds = [...manifest.seedPlan.searchA.gameSeeds, manifest.seedPlan.searchA.opponentSamplingSeed,
    ...manifest.seedPlan.searchB.gameSeeds, manifest.seedPlan.searchB.opponentSamplingSeed,
    ...manifest.seedPlan.reference.gameSeeds, manifest.seedPlan.reference.opponentSamplingSeed];
  if (new Set([...originalSeeds, ...gameSeeds]).size !== originalSeeds.length + gameSeeds.length) {
    throw new Error('Response-oracle reference extension seed collision.');
  }
  return { gameSeeds, combinedSchedule, extensionSchedule: scheduleSlice(combinedSchedule, 100, 200) };
}

export function createResponseOracleReferenceExtensionManifest(input: {
  baseRoot: string;
  manifest: ResponseOracleCalibrationManifest;
  report: ResponseOracleCalibrationReport;
}): ResponseOracleReferenceExtensionManifest {
  if (!validateResponseOracleCalibrationManifest(input.manifest)
    || input.report.manifestHash !== input.manifest.evidenceHash
    || input.report.version !== RESPONSE_ORACLE_CALIBRATION_VERSION) {
    throw new Error('Validated base calibration evidence is required.');
  }
  const continuation = createResponseOracleContinuationSchedule(input.manifest);
  const base = {
    schemaVersion: 1 as const, experiment: 'response-oracle-reference-extension-manifest' as const,
    version: RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION,
    base: { root: input.baseRoot, kingdomId: input.manifest.source.kingdomId,
      calibrationVersion: RESPONSE_ORACLE_CALIBRATION_VERSION, manifestHash: input.manifest.evidenceHash,
      reportHash: input.report.evidenceHash,
      reportSourceArtifactHashes: [...input.report.sourceArtifactHashes] },
    protocol: {
      candidateRankRange: { start: 51 as const, end: 20_000 as const, count: 19_950 as const },
      originalReferenceOrdinals: { start: 1 as const, end: 100 as const, count: 100 as const },
      extensionReferenceOrdinals: { start: 101 as const, end: 200 as const, count: 100 as const },
      combinedFolds: [
        { fold: 1 as const, startOrdinal: 1 as const, endOrdinal: 100 as const, count: 100 as const },
        { fold: 2 as const, startOrdinal: 101 as const, endOrdinal: 200 as const, count: 100 as const }
      ] as ResponseOracleReferenceExtensionManifest['protocol']['combinedFolds'],
      chunkSize: 250 as const, gamesPerSeedEvaluation: GAMES_PER_SEED,
      startingDraftEnabled: false as const, turnLimitPerPlayer: 30 as const, actionCapPerTurn: 200 as const,
      scoreOnly: true as const, searchReruns: false as const, admissions: false as const, closure: false as const,
      toleranceApplied: false as const, automaticFurtherExtension: false as const
    },
    continuationSeedPlan: { label: 'reference:game' as const, startIndex: 100 as const,
      endIndexExclusive: 200 as const, gameSeeds: continuation.gameSeeds,
      opponentSamplingSeed: input.manifest.seedPlan.reference.opponentSamplingSeed },
    originalScheduleHash: sha256(input.manifest.schedules.reference),
    combinedScheduleHash: sha256(continuation.combinedSchedule),
    extensionSchedule: continuation.extensionSchedule
  };
  return { ...base, evidenceHash: sha256(base) };
}

export function validateResponseOracleReferenceExtensionManifest(value: unknown, input: Parameters<
  typeof createResponseOracleReferenceExtensionManifest>[0]): value is ResponseOracleReferenceExtensionManifest {
  try { return exact(value, createResponseOracleReferenceExtensionManifest(input)); } catch { return false; }
}

export function createResponseOracleReferenceExtensionChunk(input: {
  extensionManifest: ResponseOracleReferenceExtensionManifest;
  baseManifest: ResponseOracleCalibrationManifest;
  chunk: number;
  rows: ReadonlyArray<{ strategy: Strategy; blockScores: readonly number[]; matches: number }>;
  elapsedMs: number;
}): ResponseOracleReferenceExtensionChunk {
  const bounds = calibrationChunkBounds(input.chunk);
  const expected = input.baseManifest.candidates.slice(bounds.startRank - RESPONSE_ORACLE_CANDIDATE_START_RANK,
    bounds.endRank - RESPONSE_ORACLE_CANDIDATE_START_RANK + 1);
  if (input.extensionManifest.base.manifestHash !== input.baseManifest.evidenceHash
    || input.rows.length !== expected.length || !Number.isFinite(input.elapsedMs) || input.elapsedMs < 0) {
    throw new Error('Reference extension chunk rows or timing are invalid.');
  }
  const rows = input.rows.map((row, index) => ({ ...expected[index]!, blockScores: [...row.blockScores],
    candidateSeedEvaluations: 100 as const, games: 200 as const }));
  for (let index = 0; index < rows.length; index += 1) {
    if (input.rows[index]!.strategy.id !== expected[index]!.strategyId
      || canonicalStrategy(input.rows[index]!.strategy) !== expected[index]!.canonicalStrategy
      || rows[index]!.blockScores.length !== 100 || input.rows[index]!.matches !== 200
      || rows[index]!.blockScores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
      throw new Error(`Reference extension candidate ${index} is invalid.`);
    }
  }
  const candidateSeedEvaluations = rows.length * 100;
  const base = {
    schemaVersion: 1 as const, experiment: 'response-oracle-reference-extension-chunk' as const,
    version: RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION,
    extensionManifestHash: input.extensionManifest.evidenceHash,
    baseManifestHash: input.baseManifest.evidenceHash, phase: 'reference-101-200' as const,
    chunk: input.chunk, ...bounds, schedule: structuredClone(input.extensionManifest.extensionSchedule), rows,
    candidateSeedEvaluations, games: candidateSeedEvaluations * GAMES_PER_SEED, elapsedMs: input.elapsedMs
  };
  return { ...base, evidenceHash: sha256(base) };
}

export function validateResponseOracleReferenceExtensionChunk(value: unknown,
  extensionManifest: ResponseOracleReferenceExtensionManifest,
  baseManifest: ResponseOracleCalibrationManifest, chunk: number
): value is ResponseOracleReferenceExtensionChunk {
  try {
    if (!value || typeof value !== 'object') return false;
    const held = value as ResponseOracleReferenceExtensionChunk;
    const bounds = calibrationChunkBounds(chunk);
    const expected = baseManifest.candidates.slice(bounds.startRank - RESPONSE_ORACLE_CANDIDATE_START_RANK,
      bounds.endRank - RESPONSE_ORACLE_CANDIDATE_START_RANK + 1);
    return held.schemaVersion === 1 && held.experiment === 'response-oracle-reference-extension-chunk'
      && held.version === RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION
      && held.extensionManifestHash === extensionManifest.evidenceHash
      && held.baseManifestHash === baseManifest.evidenceHash && held.phase === 'reference-101-200'
      && held.chunk === chunk && held.startRank === bounds.startRank && held.endRank === bounds.endRank
      && exact(held.schedule, extensionManifest.extensionSchedule) && held.rows?.length === expected.length
      && held.candidateSeedEvaluations === expected.length * 100
      && held.games === held.candidateSeedEvaluations * GAMES_PER_SEED
      && Number.isFinite(held.elapsedMs) && held.elapsedMs >= 0 && held.evidenceHash === unsignedHash(held)
      && held.rows.every((row, index) => exact({ goldfishRank: row.goldfishRank,
        strategyId: row.strategyId, canonicalStrategy: row.canonicalStrategy }, expected[index])
        && row.blockScores.length === 100
        && row.blockScores.every((score) => Number.isFinite(score) && score >= 0 && score <= 1)
        && row.candidateSeedEvaluations === 100 && row.games === 200);
  } catch { return false; }
}

function summary(values: readonly number[], worst: 'max' | 'min'): { worst: number; median: number } {
  if (!values.length || values.some((value) => !Number.isFinite(value))) throw new Error('Raw summary is invalid.');
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
  return { worst: worst === 'max' ? ordered.at(-1)! : ordered[0]!, median };
}

function dominatesCostAndRegret(left: ParetoPoint, right: ParetoPoint): boolean {
  return left.gamesPerLane <= right.gamesPerLane && left.worstRawRegret <= right.worstRawRegret
    && (left.gamesPerLane < right.gamesPerLane || left.worstRawRegret < right.worstRawRegret);
}

export function responseOracleParetoAnalysis(input: ReadonlyArray<{
  methodKey: string; gamesPerLane: number; worstTopOneRegret: number; worstTopFourRegret: number;
}>): ResponseOracleReferenceExtensionReport['pareto'] {
  if (!input.length || new Set(input.map((entry) => entry.methodKey)).size !== input.length
    || input.some((entry) => !Number.isFinite(entry.gamesPerLane) || entry.gamesPerLane < 0
      || !Number.isFinite(entry.worstTopOneRegret) || !Number.isFinite(entry.worstTopFourRegret))) {
    throw new Error('Pareto inputs are invalid.');
  }
  const topOne = input.map((entry): ParetoPoint => ({ methodKey: entry.methodKey,
    gamesPerLane: entry.gamesPerLane, worstRawRegret: entry.worstTopOneRegret }));
  const topFour = input.map((entry): ParetoPoint => ({ methodKey: entry.methodKey,
    gamesPerLane: entry.gamesPerLane, worstRawRegret: entry.worstTopFourRegret }));
  const dominators = (points: readonly ParetoPoint[], point: ParetoPoint) => points
    .filter((candidate) => candidate.methodKey !== point.methodKey && dominatesCostAndRegret(candidate, point))
    .map((candidate) => candidate.methodKey);
  const order = (left: ParetoPoint, right: ParetoPoint) => left.gamesPerLane - right.gamesPerLane
    || left.worstRawRegret - right.worstRawRegret || compareUtf16(left.methodKey, right.methodKey);
  return {
    topOneFrontier: topOne.filter((point) => !dominators(topOne, point).length).sort(order),
    topFourFrontier: topFour.filter((point) => !dominators(topFour, point).length).sort(order),
    dominated: input.map((entry) => {
      const one = topOne.find((point) => point.methodKey === entry.methodKey)!;
      const four = topFour.find((point) => point.methodKey === entry.methodKey)!;
      const jointlyDominatedBy = input.filter((candidate) => candidate.methodKey !== entry.methodKey
        && candidate.gamesPerLane <= entry.gamesPerLane
        && candidate.worstTopOneRegret <= entry.worstTopOneRegret
        && candidate.worstTopFourRegret <= entry.worstTopFourRegret
        && (candidate.gamesPerLane < entry.gamesPerLane
          || candidate.worstTopOneRegret < entry.worstTopOneRegret
          || candidate.worstTopFourRegret < entry.worstTopFourRegret))
        .map((candidate) => candidate.methodKey);
      return { methodKey: entry.methodKey, topOneDominatedBy: dominators(topOne, one),
        topFourDominatedBy: dominators(topFour, four), jointlyDominatedBy };
    })
  };
}

function collectOriginalReference(chunks: readonly CalibrationScoreChunk[],
  manifest: ResponseOracleCalibrationManifest): CalibrationScoreRow[] {
  if (chunks.length !== calibrationChunkCount()) throw new Error('Original reference chunks are incomplete.');
  return [...chunks].sort((left, right) => left.chunk - right.chunk).flatMap((chunk, index) => {
    if (!validateCalibrationScoreChunk(chunk, manifest, 'reference', index)) {
      throw new Error(`Original reference chunk ${index} is invalid.`);
    }
    return chunk.rows;
  });
}

function collectExtensionReference(chunks: readonly ResponseOracleReferenceExtensionChunk[],
  extensionManifest: ResponseOracleReferenceExtensionManifest,
  baseManifest: ResponseOracleCalibrationManifest): ResponseOracleReferenceExtensionChunk['rows'] {
  if (chunks.length !== calibrationChunkCount()) throw new Error('Extension reference chunks are incomplete.');
  return [...chunks].sort((left, right) => left.chunk - right.chunk).flatMap((chunk, index) => {
    if (!validateResponseOracleReferenceExtensionChunk(chunk, extensionManifest, baseManifest, index)) {
      throw new Error(`Extension reference chunk ${index} is invalid.`);
    }
    return chunk.rows;
  });
}

export function createResponseOracleReferenceExtensionReport(input: {
  extensionManifest: ResponseOracleReferenceExtensionManifest;
  baseManifest: ResponseOracleCalibrationManifest;
  baseReport: ResponseOracleCalibrationReport;
  originalReferenceChunks: readonly CalibrationScoreChunk[];
  extensionChunks: readonly ResponseOracleReferenceExtensionChunk[];
}): ResponseOracleReferenceExtensionReport {
  if (!validateResponseOracleReferenceExtensionManifest(input.extensionManifest, {
    baseRoot: input.extensionManifest.base.root, manifest: input.baseManifest, report: input.baseReport
  }) || input.extensionManifest.base.manifestHash !== input.baseManifest.evidenceHash
    || input.extensionManifest.base.reportHash !== input.baseReport.evidenceHash
    || !exact(input.extensionManifest.base.reportSourceArtifactHashes, input.baseReport.sourceArtifactHashes)
    || input.baseReport.accounting.reference.candidateSeedEvaluations
      !== RESPONSE_ORACLE_EXTENSION_CANDIDATE_SEED_EVALUATIONS
    || input.baseReport.accounting.reference.games !== RESPONSE_ORACLE_EXTENSION_GAMES) {
    throw new Error('Base report does not match the reference extension manifest.');
  }
  const original = collectOriginalReference(input.originalReferenceChunks, input.baseManifest);
  const extension = collectExtensionReference(input.extensionChunks, input.extensionManifest, input.baseManifest);
  if (original.length !== RESPONSE_ORACLE_CANDIDATE_COUNT || extension.length !== original.length) {
    throw new Error('Combined reference evidence is incomplete.');
  }
  const combined = original.map((row, index): CalibrationScoreRow => {
    const added = extension[index]!;
    if (row.strategyId !== added.strategyId || row.canonicalStrategy !== added.canonicalStrategy
      || row.goldfishRank !== added.goldfishRank) throw new Error('Combined reference candidate identity changed.');
    return { goldfishRank: row.goldfishRank, strategyId: row.strategyId,
      canonicalStrategy: row.canonicalStrategy, blockScores: [...row.blockScores, ...added.blockScores],
      candidateSeedEvaluations: 200, games: 400 };
  });
  const metrics = crossFitCalibrationMetricsForFolds({ reference: combined, outputs: input.baseReport.outputs,
    referenceTieSeed: input.baseManifest.seedPlan.reference.opponentSamplingSeed,
    folds: [{ fold: 1, start: 0, end: 100 }, { fold: 2, start: 100, end: 200 }] });
  const methodKeys = [...new Set(input.baseReport.outputs.map((output) => output.key))];
  const rawSummary = methodKeys.map((methodKey) => {
    const rows = metrics.crossFitMetrics.filter((entry) => entry.methodKey === methodKey);
    return { methodKey, topOneRegret: summary(rows.map((entry) => entry.heldOutRegret), 'max'),
      topFourRegret: summary(rows.map((entry) => entry.heldOutBestOfFourRegret), 'max'),
      topOneScore: summary(rows.map((entry) => entry.responseHeldOutScore), 'min'),
      topFourScore: summary(rows.map((entry) => entry.heldOutBestOfFourScore), 'min') };
  });
  const paretoInput = rawSummary.map((entry) => {
    const outputs = input.baseReport.outputs.filter((output) => output.key === entry.methodKey);
    if (outputs.length !== 2 || outputs[0]!.games !== outputs[1]!.games) {
      throw new Error(`Method ${entry.methodKey} does not have equal A and B lane costs.`);
    }
    return { methodKey: entry.methodKey, gamesPerLane: outputs[0]!.games,
      worstTopOneRegret: entry.topOneRegret.worst, worstTopFourRegret: entry.topFourRegret.worst };
  });
  const elapsedMs = input.extensionChunks.reduce((sum, chunk) => sum + chunk.elapsedMs, 0);
  const extensionEvaluations = input.extensionChunks.reduce((sum, chunk) => sum + chunk.candidateSeedEvaluations, 0);
  const extensionGames = input.extensionChunks.reduce((sum, chunk) => sum + chunk.games, 0);
  if (extensionEvaluations !== RESPONSE_ORACLE_EXTENSION_CANDIDATE_SEED_EVALUATIONS
    || extensionGames !== RESPONSE_ORACLE_EXTENSION_GAMES) throw new Error('Extension accounting is invalid.');
  const base = {
    schemaVersion: 1 as const, experiment: 'response-oracle-reference-extension-report' as const,
    version: RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION,
    extensionManifestHash: input.extensionManifest.evidenceHash,
    base: { manifestHash: input.baseManifest.evidenceHash, reportHash: input.baseReport.evidenceHash },
    status: 'raw-metrics-require-user-tolerance' as const, searchReruns: false as const,
    admissions: false as const, closure: false as const, toleranceApplied: false as const,
    outputs: structuredClone(input.baseReport.outputs), referenceLeaders: metrics.referenceLeaders,
    crossFitMetrics: metrics.crossFitMetrics, laneAgreement: metrics.laneAgreement, rawSummary,
    pareto: responseOracleParetoAnalysis(paretoInput),
    accounting: {
      originalReference: { candidateSeedEvaluations: 1_995_000 as const, games: 3_990_000 as const },
      extensionReference: { candidateSeedEvaluations: 1_995_000 as const, games: 3_990_000 as const, elapsedMs },
      combinedReference: { candidateSeedEvaluations: 3_990_000 as const, games: 7_980_000 as const },
      addedGames: 3_990_000 as const
    },
    sourceArtifactHashes: [...input.baseReport.sourceArtifactHashes, input.baseReport.evidenceHash,
      input.extensionManifest.evidenceHash, ...input.extensionChunks.map((chunk) => chunk.evidenceHash)]
  };
  return { ...base, evidenceHash: sha256(base) };
}

export function validateResponseOracleReferenceExtensionReport(value: unknown, input: Parameters<
  typeof createResponseOracleReferenceExtensionReport>[0]): value is ResponseOracleReferenceExtensionReport {
  try { return exact(value, createResponseOracleReferenceExtensionReport(input)); } catch { return false; }
}
