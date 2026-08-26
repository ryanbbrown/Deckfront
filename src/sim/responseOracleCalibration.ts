import { createHash } from 'node:crypto';
import { mixtureSchedule } from './mixtureEvaluation';
import type { MixtureSchedule } from './mixtureEvaluation';
import { GAMES_PER_SEED } from './pairing';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export const RESPONSE_ORACLE_CALIBRATION_VERSION = 'response-oracle-calibration-v1' as const;
export const RESPONSE_ORACLE_CANDIDATE_START_RANK = 51;
export const RESPONSE_ORACLE_CANDIDATE_END_RANK = 20_000;
export const RESPONSE_ORACLE_CANDIDATE_COUNT = 19_950;
export const RESPONSE_ORACLE_CHUNK_SIZE = 250;
export const RESPONSE_ORACLE_FIXED_DEPTHS = [8, 16, 25, 32, 50] as const;
export const RESPONSE_ORACLE_HALVING_DEPTHS = [1, 2, 4, 8, 16, 32, 64, 128,
  256, 512, 1_024, 2_048, 4_096, 8_192, 16_384] as const;
export const RESPONSE_ORACLE_REFERENCE_SEEDS = 100;
export type CalibrationLane = 'a' | 'b';
export type ReferenceFold = 1 | 2;

export const RESPONSE_ORACLE_CALIBRATION_TARGETS = Object.freeze({
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
} as const);

export interface CalibrationSourceIdentity {
  kingdomId: string;
  rankedPath: string;
  reservoirPath: string;
  p75ManifestPath: string;
  p75ReportPath: string;
  rankedSha256: string;
  reservoirSha256: string;
  p75ManifestSha256: string;
  p75ReportSha256: string;
  p75ManifestHash: string;
  reservoirRunId: string;
  reservoirVersion: string;
  rulesFingerprint: string;
}

export interface CalibrationCandidateIdentity {
  goldfishRank: number;
  strategyId: string;
  canonicalStrategy: string;
}

export interface ResponseOracleCalibrationProtocol {
  version: typeof RESPONSE_ORACLE_CALIBRATION_VERSION;
  candidateRankRange: { start: 51; end: 20_000; count: 19_950 };
  fixedDepths: readonly [8, 16, 25, 32, 50];
  successiveHalvingDepths: readonly number[];
  successiveHalvingRetention: 'ceil-half-cumulative-mean';
  referenceSeeds: 100;
  referenceFolds: readonly [{ start: 0; end: 50 }, { start: 50; end: 100 }];
  chunkSize: 250;
  gamesPerSeedEvaluation: typeof GAMES_PER_SEED;
  startingDraftEnabled: false;
  turnLimitPerPlayer: 30;
  actionCapPerTurn: 200;
  scoreOnly: true;
  admissions: false;
  closure: false;
  automaticReferenceExtension: false;
}

export interface CalibrationSeedPlan {
  searchA: { gameSeeds: number[]; opponentSamplingSeed: number };
  searchB: { gameSeeds: number[]; opponentSamplingSeed: number };
  reference: { gameSeeds: number[]; opponentSamplingSeed: number };
}

export interface ResponseOracleCalibrationManifest {
  schemaVersion: 1;
  experiment: 'response-oracle-calibration-manifest';
  version: typeof RESPONSE_ORACLE_CALIBRATION_VERSION;
  source: CalibrationSourceIdentity;
  p75Strategies: Strategy[];
  p75Weights: Record<string, number>;
  candidates: CalibrationCandidateIdentity[];
  protocol: ResponseOracleCalibrationProtocol;
  seedPlan: CalibrationSeedPlan;
  schedules: { searchA: MixtureSchedule; searchB: MixtureSchedule; reference: MixtureSchedule };
  evidenceHash: string;
}

export interface CalibrationScoreRow extends CalibrationCandidateIdentity {
  blockScores: number[];
  candidateSeedEvaluations: number;
  games: number;
}

export interface CalibrationScoreChunk {
  schemaVersion: 1;
  experiment: 'response-oracle-calibration-score-chunk';
  version: typeof RESPONSE_ORACLE_CALIBRATION_VERSION;
  manifestHash: string;
  phase: 'search-a' | 'search-b' | 'reference';
  chunk: number;
  startRank: number;
  endRank: number;
  schedule: MixtureSchedule;
  rows: CalibrationScoreRow[];
  candidateSeedEvaluations: number;
  games: number;
  elapsedMs: number;
  evidenceHash: string;
}

export interface RankedCalibrationCandidate extends CalibrationCandidateIdentity {
  mean: number;
}

export interface FixedDepthResult {
  depth: number;
  selectedId: string;
  topFourIds: string[];
  topScore: number;
  topScoreTieIds: string[];
}

export interface SuccessiveHalvingRound {
  round: number;
  depth: number;
  scoreStart: number;
  activeIds: string[];
  rows: Array<{ strategyId: string; addedScores: number[]; cumulativeMean: number }>;
  topScore: number;
  topScoreTieIds: string[];
  boundaryScore: number;
  boundaryTieIds: string[];
  survivors: string[];
  candidateSeedEvaluations: number;
  games: number;
  elapsedMs: number;
}

export interface SuccessiveHalvingArtifact {
  schemaVersion: 1;
  experiment: 'response-oracle-calibration-successive-halving';
  version: typeof RESPONSE_ORACLE_CALIBRATION_VERSION;
  manifestHash: string;
  lane: CalibrationLane;
  fixedDepth: 50;
  complete: boolean;
  rounds: SuccessiveHalvingRound[];
  selectedId: string | null;
  finalFourIds: string[];
  candidateSeedEvaluations: number;
  games: number;
  standaloneCandidateSeedEvaluations: number;
  standaloneGames: number;
  elapsedMs: number;
  evidenceHash: string;
}

export interface CalibrationMethodOutput {
  key: string;
  lane: CalibrationLane;
  method: 'fixed' | 'successive-halving';
  depth: number | null;
  selectedId: string;
  selectedGoldfishRank: number;
  topFourIds: string[];
  topFourGoldfishRanks: number[];
  topScoreTieIds: string[];
  candidateSeedEvaluations: number;
  games: number;
  gamesSavedAgainstFixed50: number;
}

export interface CrossFitMetric {
  methodKey: string;
  lane: CalibrationLane;
  selectionFold: ReferenceFold;
  evaluationFold: ReferenceFold;
  referenceLeaderId: string;
  referenceLeaderTieIds: string[];
  referenceHeldOutScore: number;
  responseId: string;
  responseHeldOutScore: number;
  heldOutRegret: number;
  topFourIds: string[];
  heldOutBestOfFourIds: string[];
  heldOutBestOfFourScore: number;
  heldOutBestOfFourRegret: number;
}

export interface LaneAgreementDiagnostic {
  method: string;
  evaluationFold: ReferenceFold;
  laneAId: string;
  laneBId: string;
  exactIdAgreement: boolean;
  laneAScore: number;
  laneBScore: number;
  scoreDifference: number;
}

export interface CalibrationAccounting {
  candidateSeedEvaluations: number;
  games: number;
  elapsedMs: number;
}

export interface ResponseOracleCalibrationReport {
  schemaVersion: 1;
  experiment: 'response-oracle-calibration-report';
  version: typeof RESPONSE_ORACLE_CALIBRATION_VERSION;
  manifestHash: string;
  status: 'raw-metrics-require-user-tolerance';
  outputs: CalibrationMethodOutput[];
  referenceLeaders: Array<{
    selectionFold: ReferenceFold;
    evaluationFold: ReferenceFold;
    selectedId: string;
    topScoreTieIds: string[];
    heldOutScore: number;
  }>;
  crossFitMetrics: CrossFitMetric[];
  laneAgreement: LaneAgreementDiagnostic[];
  rawRegretSummary: Array<{
    methodKey: string;
    topOne: { worst: number; median: number };
    topFour: { worst: number; median: number };
  }>;
  accounting: {
    searchA: CalibrationAccounting & { fixed: CalibrationAccounting;
      successiveHalvingStandalone: Omit<CalibrationAccounting, 'elapsedMs'>;
      successiveHalvingTopups: CalibrationAccounting; gamesSavedByStandaloneHalvingAgainstFixed50: number };
    searchB: CalibrationAccounting & { fixed: CalibrationAccounting;
      successiveHalvingStandalone: Omit<CalibrationAccounting, 'elapsedMs'>;
      successiveHalvingTopups: CalibrationAccounting; gamesSavedByStandaloneHalvingAgainstFixed50: number };
    reference: CalibrationAccounting;
    total: CalibrationAccounting;
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

function validSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function validateSourceIdentity(source: CalibrationSourceIdentity): void {
  const target = RESPONSE_ORACLE_CALIBRATION_TARGETS[
    source.kingdomId as keyof typeof RESPONSE_ORACLE_CALIBRATION_TARGETS];
  if (!target || source.reservoirRunId !== target.runId
    || source.reservoirSha256 !== target.reservoirSha256
    || source.p75ManifestSha256 !== target.p75ManifestSha256
    || source.p75ReportSha256 !== target.p75ReportSha256
    || source.p75ManifestHash !== target.p75ManifestHash
    || !source.rankedPath || !source.reservoirPath || !source.p75ManifestPath || !source.p75ReportPath
    || !validSha256(source.rankedSha256) || !validSha256(source.reservoirSha256)
    || !validSha256(source.p75ManifestSha256) || !validSha256(source.p75ReportSha256)
    || !validSha256(source.p75ManifestHash) || !source.reservoirVersion || !source.rulesFingerprint) {
    throw new Error('Calibration source identity is not one of the three approved P75 targets.');
  }
}

function calibrationProtocol(): ResponseOracleCalibrationProtocol {
  return {
    version: RESPONSE_ORACLE_CALIBRATION_VERSION,
    candidateRankRange: { start: RESPONSE_ORACLE_CANDIDATE_START_RANK,
      end: RESPONSE_ORACLE_CANDIDATE_END_RANK, count: RESPONSE_ORACLE_CANDIDATE_COUNT },
    fixedDepths: [...RESPONSE_ORACLE_FIXED_DEPTHS],
    successiveHalvingDepths: [...RESPONSE_ORACLE_HALVING_DEPTHS],
    successiveHalvingRetention: 'ceil-half-cumulative-mean',
    referenceSeeds: RESPONSE_ORACLE_REFERENCE_SEEDS,
    referenceFolds: [{ start: 0, end: 50 }, { start: 50, end: 100 }],
    chunkSize: RESPONSE_ORACLE_CHUNK_SIZE, gamesPerSeedEvaluation: GAMES_PER_SEED,
    startingDraftEnabled: false, turnLimitPerPlayer: 30, actionCapPerTurn: 200,
    scoreOnly: true, admissions: false, closure: false, automaticReferenceExtension: false
  };
}

function calibrationSeed(source: CalibrationSourceIdentity, label: string, index: number): number {
  const text = `${RESPONSE_ORACLE_CALIBRATION_VERSION}:${source.kingdomId}:${source.reservoirSha256}:`
    + `${source.p75ManifestHash}:${label}:${index}`;
  return Number.parseInt(stableHash(text).slice(0, 8), 16) >>> 0;
}

export function createCalibrationSeedPlan(source: CalibrationSourceIdentity): CalibrationSeedPlan {
  const search = (lane: CalibrationLane) => ({
    gameSeeds: Array.from({ length: RESPONSE_ORACLE_HALVING_DEPTHS.at(-1)! }, (_unused, index) =>
      calibrationSeed(source, `search-${lane}:game`, index)),
    opponentSamplingSeed: calibrationSeed(source, `search-${lane}:opponent`, 0)
  });
  const plan = {
    searchA: search('a'), searchB: search('b'), reference: {
      gameSeeds: Array.from({ length: RESPONSE_ORACLE_REFERENCE_SEEDS }, (_unused, index) =>
        calibrationSeed(source, 'reference:game', index)),
      opponentSamplingSeed: calibrationSeed(source, 'reference:opponent', 0)
    }
  };
  const seeds = [...plan.searchA.gameSeeds, plan.searchA.opponentSamplingSeed,
    ...plan.searchB.gameSeeds, plan.searchB.opponentSamplingSeed,
    ...plan.reference.gameSeeds, plan.reference.opponentSamplingSeed];
  if (new Set(seeds).size !== seeds.length) throw new Error('Response-oracle calibration seed collision.');
  return plan;
}

function validateWeights(strategies: readonly Strategy[], weights: Readonly<Record<string, number>>): void {
  const ids = strategies.map((strategy) => strategy.id);
  if (strategies.length !== 50 || new Set(ids).size !== 50
    || new Set(strategies.map(canonicalStrategy)).size !== 50
    || !exact(Object.keys(weights).sort(compareUtf16), [...ids].sort(compareUtf16))) {
    throw new Error('P75 needs one complete weight for each of its 50 strategies.');
  }
  const values = ids.map((id) => weights[id]!);
  if (values.some((weight) => !Number.isFinite(weight) || weight < 0)
    || Math.abs(values.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-7
    || !values.some((weight) => weight > 0)) throw new Error('P75 weights are invalid.');
}

export function createResponseOracleCalibrationManifest(input: {
  source: CalibrationSourceIdentity;
  p75Strategies: readonly Strategy[];
  p75Weights: Readonly<Record<string, number>>;
  candidates: ReadonlyArray<{ goldfishRank: number; strategy: Strategy }>;
}): ResponseOracleCalibrationManifest {
  validateSourceIdentity(input.source);
  validateWeights(input.p75Strategies, input.p75Weights);
  if (input.p75Strategies.some((strategy) => strategy.id !== `sg-${stableHash(canonicalStrategy(strategy))}`)) {
    throw new Error('P75 strategy identity is invalid.');
  }
  if (input.candidates.length !== RESPONSE_ORACLE_CANDIDATE_COUNT) {
    throw new Error(`Calibration needs ${RESPONSE_ORACLE_CANDIDATE_COUNT} candidates.`);
  }
  const candidates = input.candidates.map((entry, index): CalibrationCandidateIdentity => {
    const expectedRank = RESPONSE_ORACLE_CANDIDATE_START_RANK + index;
    if (entry.goldfishRank !== expectedRank) throw new Error(`Calibration candidate rank ${expectedRank} is missing.`);
    return { goldfishRank: entry.goldfishRank, strategyId: entry.strategy.id,
      canonicalStrategy: canonicalStrategy(entry.strategy) };
  });
  if (new Set(candidates.map((entry) => entry.strategyId)).size !== candidates.length
    || new Set(candidates.map((entry) => entry.canonicalStrategy)).size !== candidates.length
    || candidates.some((entry) => entry.strategyId !== `sg-${stableHash(entry.canonicalStrategy)}`)) {
    throw new Error('Calibration candidates contain duplicate identities.');
  }
  const seedPlan = createCalibrationSeedPlan(input.source);
  const schedules = {
    searchA: mixtureSchedule(input.p75Weights, seedPlan.searchA.gameSeeds, seedPlan.searchA.opponentSamplingSeed),
    searchB: mixtureSchedule(input.p75Weights, seedPlan.searchB.gameSeeds, seedPlan.searchB.opponentSamplingSeed),
    reference: mixtureSchedule(input.p75Weights, seedPlan.reference.gameSeeds, seedPlan.reference.opponentSamplingSeed)
  };
  const base = {
    schemaVersion: 1 as const, experiment: 'response-oracle-calibration-manifest' as const,
    version: RESPONSE_ORACLE_CALIBRATION_VERSION, source: structuredClone(input.source),
    p75Strategies: input.p75Strategies.map((strategy) => structuredClone(strategy)),
    p75Weights: Object.fromEntries(input.p75Strategies.map((strategy) => [strategy.id, input.p75Weights[strategy.id]!])),
    candidates, protocol: calibrationProtocol(), seedPlan, schedules
  };
  return { ...base, evidenceHash: sha256(base) };
}

export function validateResponseOracleCalibrationManifest(
  value: unknown, expected?: ResponseOracleCalibrationManifest
): value is ResponseOracleCalibrationManifest {
  try {
    if (!value || typeof value !== 'object') return false;
    const held = value as ResponseOracleCalibrationManifest;
    if (held.schemaVersion !== 1 || held.experiment !== 'response-oracle-calibration-manifest'
      || held.version !== RESPONSE_ORACLE_CALIBRATION_VERSION || held.evidenceHash !== unsignedHash(held)
      || !exact(held.protocol, calibrationProtocol()) || !exact(held.seedPlan, createCalibrationSeedPlan(held.source))) return false;
    validateSourceIdentity(held.source);
    validateWeights(held.p75Strategies, held.p75Weights);
    if (held.p75Strategies.some((strategy) => strategy.id !== `sg-${stableHash(canonicalStrategy(strategy))}`)
      || held.candidates.length !== RESPONSE_ORACLE_CANDIDATE_COUNT
      || held.candidates.some((entry, index) => entry.goldfishRank !== RESPONSE_ORACLE_CANDIDATE_START_RANK + index)
      || new Set(held.candidates.map((entry) => entry.strategyId)).size !== held.candidates.length
      || new Set(held.candidates.map((entry) => entry.canonicalStrategy)).size !== held.candidates.length
      || held.candidates.some((entry) => entry.strategyId !== `sg-${stableHash(entry.canonicalStrategy)}`)) return false;
    const schedules = {
      searchA: mixtureSchedule(held.p75Weights, held.seedPlan.searchA.gameSeeds,
        held.seedPlan.searchA.opponentSamplingSeed),
      searchB: mixtureSchedule(held.p75Weights, held.seedPlan.searchB.gameSeeds,
        held.seedPlan.searchB.opponentSamplingSeed),
      reference: mixtureSchedule(held.p75Weights, held.seedPlan.reference.gameSeeds,
        held.seedPlan.reference.opponentSamplingSeed)
    };
    return exact(held.schedules, schedules) && (!expected || exact(held, expected));
  } catch { return false; }
}

export function calibrationChunkCount(): number {
  return Math.ceil(RESPONSE_ORACLE_CANDIDATE_COUNT / RESPONSE_ORACLE_CHUNK_SIZE);
}

export function calibrationChunkBounds(chunk: number): { startRank: number; endRank: number } {
  const startRank = RESPONSE_ORACLE_CANDIDATE_START_RANK + chunk * RESPONSE_ORACLE_CHUNK_SIZE;
  const endRank = Math.min(RESPONSE_ORACLE_CANDIDATE_END_RANK, startRank + RESPONSE_ORACLE_CHUNK_SIZE - 1);
  if (!Number.isSafeInteger(chunk) || chunk < 0 || startRank > RESPONSE_ORACLE_CANDIDATE_END_RANK) {
    throw new Error(`Calibration chunk ${chunk} is out of range.`);
  }
  return { startRank, endRank };
}

function phaseSchedule(manifest: ResponseOracleCalibrationManifest,
  phase: CalibrationScoreChunk['phase']): MixtureSchedule {
  const full = phase === 'search-a' ? manifest.schedules.searchA
    : phase === 'search-b' ? manifest.schedules.searchB : manifest.schedules.reference;
  const count = phase === 'reference' ? RESPONSE_ORACLE_REFERENCE_SEEDS : RESPONSE_ORACLE_FIXED_DEPTHS.at(-1)!;
  return mixtureSchedule(full.targetWeights, full.blocks.slice(0, count).map((block) => block.seed),
    phase === 'search-a' ? manifest.seedPlan.searchA.opponentSamplingSeed
      : phase === 'search-b' ? manifest.seedPlan.searchB.opponentSamplingSeed
        : manifest.seedPlan.reference.opponentSamplingSeed);
}

export function createCalibrationScoreChunk(input: {
  manifest: ResponseOracleCalibrationManifest;
  phase: CalibrationScoreChunk['phase'];
  chunk: number;
  rows: ReadonlyArray<{ strategy: Strategy; blockScores: readonly number[]; matches: number }>;
  elapsedMs: number;
}): CalibrationScoreChunk {
  if (!validateResponseOracleCalibrationManifest(input.manifest)) throw new Error('Calibration manifest is invalid.');
  const bounds = calibrationChunkBounds(input.chunk);
  const expected = input.manifest.candidates.slice(bounds.startRank - RESPONSE_ORACLE_CANDIDATE_START_RANK,
    bounds.endRank - RESPONSE_ORACLE_CANDIDATE_START_RANK + 1);
  const depth = input.phase === 'reference' ? RESPONSE_ORACLE_REFERENCE_SEEDS : RESPONSE_ORACLE_FIXED_DEPTHS.at(-1)!;
  if (input.rows.length !== expected.length || !Number.isFinite(input.elapsedMs) || input.elapsedMs < 0) {
    throw new Error('Calibration chunk rows or timing are invalid.');
  }
  const rows = input.rows.map((row, index): CalibrationScoreRow => ({
    ...expected[index]!, blockScores: [...row.blockScores], candidateSeedEvaluations: depth,
    games: depth * GAMES_PER_SEED
  }));
  for (let index = 0; index < rows.length; index += 1) {
    if (input.rows[index]!.strategy.id !== expected[index]!.strategyId
      || canonicalStrategy(input.rows[index]!.strategy) !== expected[index]!.canonicalStrategy
      || rows[index]!.blockScores.length !== depth || input.rows[index]!.matches !== depth * GAMES_PER_SEED
      || rows[index]!.blockScores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
      throw new Error(`Calibration chunk candidate ${index} is invalid.`);
    }
  }
  const candidateSeedEvaluations = rows.length * depth;
  const base = {
    schemaVersion: 1 as const, experiment: 'response-oracle-calibration-score-chunk' as const,
    version: RESPONSE_ORACLE_CALIBRATION_VERSION, manifestHash: input.manifest.evidenceHash,
    phase: input.phase, chunk: input.chunk, ...bounds, schedule: phaseSchedule(input.manifest, input.phase),
    rows, candidateSeedEvaluations, games: candidateSeedEvaluations * GAMES_PER_SEED, elapsedMs: input.elapsedMs
  };
  return { ...base, evidenceHash: sha256(base) };
}

export function validateCalibrationScoreChunk(value: unknown, manifest: ResponseOracleCalibrationManifest,
  phase: CalibrationScoreChunk['phase'], chunk: number): value is CalibrationScoreChunk {
  try {
    if (!value || typeof value !== 'object') return false;
    const held = value as CalibrationScoreChunk;
    const bounds = calibrationChunkBounds(chunk);
    const expected = manifest.candidates.slice(bounds.startRank - RESPONSE_ORACLE_CANDIDATE_START_RANK,
      bounds.endRank - RESPONSE_ORACLE_CANDIDATE_START_RANK + 1);
    const depth = phase === 'reference' ? RESPONSE_ORACLE_REFERENCE_SEEDS : RESPONSE_ORACLE_FIXED_DEPTHS.at(-1)!;
    if (held.schemaVersion !== 1 || held.experiment !== 'response-oracle-calibration-score-chunk'
      || held.version !== RESPONSE_ORACLE_CALIBRATION_VERSION || held.manifestHash !== manifest.evidenceHash
      || held.phase !== phase || held.chunk !== chunk || held.startRank !== bounds.startRank
      || held.endRank !== bounds.endRank || !exact(held.schedule, phaseSchedule(manifest, phase))
      || held.rows?.length !== expected.length || held.candidateSeedEvaluations !== expected.length * depth
      || held.games !== held.candidateSeedEvaluations * GAMES_PER_SEED
      || !Number.isFinite(held.elapsedMs) || held.elapsedMs < 0 || held.evidenceHash !== unsignedHash(held)) return false;
    return held.rows.every((row, index) => exact({ goldfishRank: row.goldfishRank, strategyId: row.strategyId,
      canonicalStrategy: row.canonicalStrategy }, expected[index])
      && row.blockScores.length === depth
      && row.blockScores.every((score) => Number.isFinite(score) && score >= 0 && score <= 1)
      && row.candidateSeedEvaluations === depth && row.games === depth * GAMES_PER_SEED);
  } catch { return false; }
}

function mean(values: readonly number[]): number {
  if (!values.length) throw new Error('A score mean needs evidence.');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function tieHash(seed: number, candidate: CalibrationCandidateIdentity): string {
  return stableHash(`${seed}:${candidate.strategyId}:${candidate.canonicalStrategy}`);
}

export function rankCalibrationCandidates(input: ReadonlyArray<{
  identity: CalibrationCandidateIdentity; blockScores: readonly number[];
}>, depth: number, tieSeed: number): RankedCalibrationCandidate[] {
  if (!Number.isSafeInteger(depth) || depth < 1
    || input.some((entry) => entry.blockScores.length < depth)) throw new Error('Calibration ranking depth is invalid.');
  return input.map((entry) => ({ ...entry.identity, mean: mean(entry.blockScores.slice(0, depth)) }))
    .sort((left, right) => right.mean - left.mean
      || compareUtf16(tieHash(tieSeed, left), tieHash(tieSeed, right))
      || compareUtf16(left.strategyId, right.strategyId)
      || compareUtf16(left.canonicalStrategy, right.canonicalStrategy));
}

export function fixedScreenResults(rows: readonly CalibrationScoreRow[], tieSeed: number,
  depths: readonly number[] = RESPONSE_ORACLE_FIXED_DEPTHS): FixedDepthResult[] {
  const input = rows.map((row) => ({ identity: { goldfishRank: row.goldfishRank,
    strategyId: row.strategyId, canonicalStrategy: row.canonicalStrategy }, blockScores: row.blockScores }));
  return depths.map((depth) => {
    const ranked = rankCalibrationCandidates(input, depth, tieSeed), topScore = ranked[0]!.mean;
    return { depth, selectedId: ranked[0]!.strategyId, topFourIds: ranked.slice(0, 4).map((entry) => entry.strategyId),
      topScore, topScoreTieIds: ranked.filter((entry) => entry.mean === topScore).map((entry) => entry.strategyId) };
  });
}

export interface ReplayedHalvingRound {
  depth: number;
  activeIds: string[];
  rankedIds: string[];
  topScoreTieIds: string[];
  boundaryTieIds: string[];
  survivors: string[];
}

export function replayStandardSuccessiveHalving(input: ReadonlyArray<{
  identity: CalibrationCandidateIdentity; blockScores: readonly number[];
}>, depths: readonly number[], tieSeed: number): { rounds: ReplayedHalvingRound[]; selectedId: string;
  finalFourIds: string[] } {
  if (input.length < 2 || !depths.length) throw new Error('Successive Halving replay needs candidates and depths.');
  const byId = new Map(input.map((entry) => [entry.identity.strategyId, entry]));
  if (byId.size !== input.length) throw new Error('Successive Halving replay candidate IDs must be unique.');
  let activeIds = input.map((entry) => entry.identity.strategyId), finalFourIds: string[] = [];
  const rounds: ReplayedHalvingRound[] = [];
  for (const depth of depths) {
    const ranked = rankCalibrationCandidates(activeIds.map((id) => byId.get(id)!), depth, tieSeed);
    const keep = activeIds.length <= 2 ? 1 : Math.ceil(activeIds.length / 2);
    const topScore = ranked[0]!.mean, boundaryScore = ranked[keep - 1]!.mean;
    if (ranked.length >= 4) finalFourIds = ranked.slice(0, 4).map((entry) => entry.strategyId);
    const survivors = ranked.slice(0, keep).map((entry) => entry.strategyId);
    rounds.push({ depth, activeIds: [...activeIds], rankedIds: ranked.map((entry) => entry.strategyId),
      topScoreTieIds: ranked.filter((entry) => entry.mean === topScore).map((entry) => entry.strategyId),
      boundaryTieIds: ranked.filter((entry) => entry.mean === boundaryScore).map((entry) => entry.strategyId),
      survivors });
    if (activeIds.length <= 2) return { rounds, selectedId: survivors[0]!, finalFourIds };
    activeIds = survivors;
  }
  throw new Error('Successive Halving replay depths do not reach the two-candidate round.');
}

export function successiveHalvingCost(candidateCount: number,
  depths: readonly number[] = RESPONSE_ORACLE_HALVING_DEPTHS): number {
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 2 || !depths.length) {
    throw new Error('Successive Halving cost input is invalid.');
  }
  let active = candidateCount, previous = 0, cost = 0;
  for (const depth of depths) {
    if (!Number.isSafeInteger(depth) || depth <= previous) throw new Error('Successive Halving depths must increase.');
    cost += active * (depth - previous);
    if (active <= 2) return cost;
    active = Math.ceil(active / 2); previous = depth;
  }
  throw new Error('Successive Halving depths do not reach the two-candidate round.');
}

export function reusedSuccessiveHalvingTopupCost(candidateCount: number, fixedDepth: number,
  depths: readonly number[] = RESPONSE_ORACLE_HALVING_DEPTHS): number {
  if (!Number.isSafeInteger(fixedDepth) || fixedDepth < 1) throw new Error('Fixed depth is invalid.');
  let active = candidateCount, available = fixedDepth, cost = 0;
  for (const depth of depths) {
    if (depth > available) { cost += active * (depth - available); available = depth; }
    if (active <= 2) return cost;
    active = Math.ceil(active / 2);
  }
  throw new Error('Successive Halving depths do not reach the two-candidate round.');
}

function expectedRoundActiveCount(round: number, candidateCount: number): number {
  let active = candidateCount;
  for (let index = 0; index < round; index += 1) active = Math.ceil(active / 2);
  return active;
}

function halvingBase(manifestHash: string, lane: CalibrationLane, rounds: SuccessiveHalvingRound[],
  finalFourIds: string[]): Omit<SuccessiveHalvingArtifact, 'evidenceHash'> {
  const complete = rounds.length === RESPONSE_ORACLE_HALVING_DEPTHS.length;
  const candidateSeedEvaluations = rounds.reduce((sum, round) => sum + round.candidateSeedEvaluations, 0);
  return {
    schemaVersion: 1, experiment: 'response-oracle-calibration-successive-halving',
    version: RESPONSE_ORACLE_CALIBRATION_VERSION, manifestHash, lane, fixedDepth: 50, complete, rounds,
    selectedId: complete ? rounds.at(-1)!.survivors[0]! : null, finalFourIds,
    candidateSeedEvaluations, games: candidateSeedEvaluations * GAMES_PER_SEED,
    standaloneCandidateSeedEvaluations: successiveHalvingCost(RESPONSE_ORACLE_CANDIDATE_COUNT),
    standaloneGames: successiveHalvingCost(RESPONSE_ORACLE_CANDIDATE_COUNT) * GAMES_PER_SEED,
    elapsedMs: rounds.reduce((sum, round) => sum + round.elapsedMs, 0)
  };
}

export function createSuccessiveHalvingArtifact(input: {
  manifest: ResponseOracleCalibrationManifest;
  lane: CalibrationLane;
  fixedRows: readonly CalibrationScoreRow[];
  completedRounds?: readonly SuccessiveHalvingRound[];
}): SuccessiveHalvingArtifact {
  const rounds = (input.completedRounds ?? []).map((round) => structuredClone(round));
  let finalFourIds: string[] = [];
  const identities = new Map(input.manifest.candidates.map((entry) => [entry.strategyId, entry]));
  const tieSeed = input.lane === 'a' ? input.manifest.seedPlan.searchA.opponentSamplingSeed
    : input.manifest.seedPlan.searchB.opponentSamplingSeed;
  for (const round of rounds) if (round.activeIds.length >= 4) {
    finalFourIds = round.rows.slice().sort((left, right) => right.cumulativeMean - left.cumulativeMean
      || compareUtf16(tieHash(tieSeed, identities.get(left.strategyId)!),
        tieHash(tieSeed, identities.get(right.strategyId)!))
      || compareUtf16(left.strategyId, right.strategyId)
      || compareUtf16(identities.get(left.strategyId)!.canonicalStrategy,
        identities.get(right.strategyId)!.canonicalStrategy))
      .slice(0, 4).map((entry) => entry.strategyId);
  }
  const base = halvingBase(input.manifest.evidenceHash, input.lane, rounds, finalFourIds);
  const artifact = { ...base, evidenceHash: sha256(base) };
  if (!validateSuccessiveHalvingArtifact(artifact, input.manifest, input.lane, input.fixedRows)) {
    throw new Error('Successive Halving evidence is invalid.');
  }
  return artifact;
}

export function validateSuccessiveHalvingArtifact(value: unknown,
  manifest: ResponseOracleCalibrationManifest, lane: CalibrationLane,
  fixedRows: readonly CalibrationScoreRow[]): value is SuccessiveHalvingArtifact {
  try {
    if (!value || typeof value !== 'object' || fixedRows.length !== manifest.candidates.length) return false;
    const held = value as SuccessiveHalvingArtifact;
    if (held.schemaVersion !== 1 || held.experiment !== 'response-oracle-calibration-successive-halving'
      || held.version !== RESPONSE_ORACLE_CALIBRATION_VERSION || held.manifestHash !== manifest.evidenceHash
      || held.lane !== lane || held.fixedDepth !== 50 || held.rounds.length > RESPONSE_ORACLE_HALVING_DEPTHS.length
      || held.evidenceHash !== unsignedHash(held)) return false;
    const fixed = new Map(fixedRows.map((row) => [row.strategyId, row.blockScores]));
    const identities = new Map(manifest.candidates.map((entry) => [entry.strategyId, entry]));
    const accumulated = new Map<string, number[]>();
    let activeIds = manifest.candidates.map((entry) => entry.strategyId);
    let finalFourIds: string[] = [];
    const tieSeed = lane === 'a' ? manifest.seedPlan.searchA.opponentSamplingSeed
      : manifest.seedPlan.searchB.opponentSamplingSeed;
    for (let roundIndex = 0; roundIndex < held.rounds.length; roundIndex += 1) {
      const round = held.rounds[roundIndex]!, depth = RESPONSE_ORACLE_HALVING_DEPTHS[roundIndex]!;
      const scoreStart = depth <= 50 ? depth : roundIndex === 0 ? 50
        : Math.max(50, RESPONSE_ORACLE_HALVING_DEPTHS[roundIndex - 1]!);
      const added = Math.max(0, depth - scoreStart);
      if (round.round !== roundIndex || round.depth !== depth || round.scoreStart !== scoreStart
        || !exact(round.activeIds, activeIds) || round.activeIds.length !== expectedRoundActiveCount(roundIndex, manifest.candidates.length)
        || round.rows.length !== activeIds.length || round.candidateSeedEvaluations !== activeIds.length * added
        || round.games !== round.candidateSeedEvaluations * GAMES_PER_SEED
        || !Number.isFinite(round.elapsedMs) || round.elapsedMs < 0) return false;
      const rankedInput = round.rows.map((row, index) => {
        const id = activeIds[index]!, identity = identities.get(id), prefix = fixed.get(id);
        if (!identity || !prefix || row.strategyId !== id || row.addedScores.length !== added
          || row.addedScores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) throw new Error('bad row');
        const previous = accumulated.get(id) ?? prefix.slice(0, Math.min(depth, 50));
        const scores = depth <= 50 ? prefix.slice(0, depth) : [...previous, ...row.addedScores];
        if (scores.length !== depth || row.cumulativeMean !== mean(scores)) throw new Error('bad cumulative mean');
        accumulated.set(id, scores);
        return { identity, blockScores: scores };
      });
      const ranked = rankCalibrationCandidates(rankedInput, depth, tieSeed);
      const keep = activeIds.length <= 2 ? 1 : Math.ceil(activeIds.length / 2);
      const survivors = ranked.slice(0, keep).map((entry) => entry.strategyId);
      const topScore = ranked[0]!.mean, boundaryScore = ranked[keep - 1]!.mean;
      if (round.topScore !== topScore
        || !exact(round.topScoreTieIds, ranked.filter((entry) => entry.mean === topScore).map((entry) => entry.strategyId))
        || round.boundaryScore !== boundaryScore
        || !exact(round.boundaryTieIds, ranked.filter((entry) => entry.mean === boundaryScore).map((entry) => entry.strategyId))
        || !exact(round.survivors, survivors)) return false;
      if (ranked.length >= 4) finalFourIds = ranked.slice(0, 4).map((entry) => entry.strategyId);
      activeIds = survivors;
    }
    const rebuilt = halvingBase(manifest.evidenceHash, lane, held.rounds, finalFourIds);
    return exact({ ...rebuilt, evidenceHash: held.evidenceHash }, held);
  } catch { return false; }
}

export function nextSuccessiveHalvingRound(input: {
  manifest: ResponseOracleCalibrationManifest;
  lane: CalibrationLane;
  fixedRows: readonly CalibrationScoreRow[];
  artifact: SuccessiveHalvingArtifact;
  addedScores: Readonly<Record<string, readonly number[]>>;
  elapsedMs: number;
}): SuccessiveHalvingArtifact {
  if (!validateSuccessiveHalvingArtifact(input.artifact, input.manifest, input.lane, input.fixedRows)
    || input.artifact.complete) throw new Error('Cannot add a round to this Successive Halving artifact.');
  const roundIndex = input.artifact.rounds.length, depth = RESPONSE_ORACLE_HALVING_DEPTHS[roundIndex]!;
  const scoreStart = depth <= 50 ? depth : roundIndex === 0 ? 50
    : Math.max(50, RESPONSE_ORACLE_HALVING_DEPTHS[roundIndex - 1]!);
  const added = Math.max(0, depth - scoreStart);
  const activeIds = roundIndex === 0 ? input.manifest.candidates.map((entry) => entry.strategyId)
    : input.artifact.rounds.at(-1)!.survivors;
  const fixed = new Map(input.fixedRows.map((row) => [row.strategyId, row.blockScores]));
  const previousScores = new Map<string, number[]>();
  for (const id of activeIds) previousScores.set(id, fixed.get(id)!.slice(0, Math.min(depth, 50)));
  for (const held of input.artifact.rounds) for (const row of held.rows) {
    if (previousScores.has(row.strategyId) && row.addedScores.length) {
      previousScores.set(row.strategyId, [...previousScores.get(row.strategyId)!, ...row.addedScores]);
    }
  }
  const rows = activeIds.map((strategyId) => {
    const scores = [...(input.addedScores[strategyId] ?? [])];
    if (scores.length !== added || scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
      throw new Error(`Successive Halving top-up for ${strategyId} is invalid.`);
    }
    const cumulative = [...previousScores.get(strategyId)!, ...scores];
    if (cumulative.length !== depth) throw new Error(`Successive Halving depth ${depth} is incomplete.`);
    return { strategyId, addedScores: scores, cumulativeMean: mean(cumulative), cumulative };
  });
  const identities = new Map(input.manifest.candidates.map((entry) => [entry.strategyId, entry]));
  const tieSeed = input.lane === 'a' ? input.manifest.seedPlan.searchA.opponentSamplingSeed
    : input.manifest.seedPlan.searchB.opponentSamplingSeed;
  const ranked = rankCalibrationCandidates(rows.map((row) => ({ identity: identities.get(row.strategyId)!,
    blockScores: row.cumulative })), depth, tieSeed);
  const keep = activeIds.length <= 2 ? 1 : Math.ceil(activeIds.length / 2);
  const topScore = ranked[0]!.mean, boundaryScore = ranked[keep - 1]!.mean;
  const round: SuccessiveHalvingRound = {
    round: roundIndex, depth, scoreStart, activeIds: [...activeIds],
    rows: rows.map(({ strategyId, addedScores, cumulativeMean }) => ({ strategyId, addedScores, cumulativeMean })),
    topScore, topScoreTieIds: ranked.filter((entry) => entry.mean === topScore).map((entry) => entry.strategyId),
    boundaryScore, boundaryTieIds: ranked.filter((entry) => entry.mean === boundaryScore).map((entry) => entry.strategyId),
    survivors: ranked.slice(0, keep).map((entry) => entry.strategyId),
    candidateSeedEvaluations: activeIds.length * added, games: activeIds.length * added * GAMES_PER_SEED,
    elapsedMs: input.elapsedMs
  };
  return createSuccessiveHalvingArtifact({ manifest: input.manifest, lane: input.lane, fixedRows: input.fixedRows,
    completedRounds: [...input.artifact.rounds, round] });
}

function foldRange(fold: ReferenceFold): { start: number; end: number } {
  return fold === 1 ? { start: 0, end: 50 } : { start: 50, end: 100 };
}

function scoreOnFold(row: CalibrationScoreRow, fold: ReferenceFold): number {
  const range = foldRange(fold);
  return mean(row.blockScores.slice(range.start, range.end));
}

export function crossFitCalibrationMetrics(reference: readonly CalibrationScoreRow[],
  outputs: readonly CalibrationMethodOutput[], referenceTieSeed: number): {
    referenceLeaders: ResponseOracleCalibrationReport['referenceLeaders'];
    crossFitMetrics: CrossFitMetric[];
    laneAgreement: LaneAgreementDiagnostic[];
  } {
  const referenceById = new Map(reference.map((row) => [row.strategyId, row]));
  if (referenceById.size !== reference.length || reference.some((row) => row.blockScores.length !== 100)) {
    throw new Error('Cross-fit reference evidence is invalid.');
  }
  const referenceLeaders = ([1, 2] as const).map((selectionFold) => {
    const evaluationFold = selectionFold === 1 ? 2 as const : 1 as const;
    const ranked = reference.map((row) => ({ row, score: scoreOnFold(row, selectionFold) }))
      .sort((left, right) => right.score - left.score
        || compareUtf16(tieHash(referenceTieSeed, left.row), tieHash(referenceTieSeed, right.row))
        || compareUtf16(left.row.strategyId, right.row.strategyId));
    const topScore = ranked[0]!.score, selected = ranked[0]!.row;
    return { selectionFold, evaluationFold, selectedId: selected.strategyId,
      topScoreTieIds: ranked.filter((entry) => entry.score === topScore).map((entry) => entry.row.strategyId),
      heldOutScore: scoreOnFold(selected, evaluationFold) };
  });
  const crossFitMetrics = outputs.flatMap((output) => referenceLeaders.map((leader): CrossFitMetric => {
    const response = referenceById.get(output.selectedId);
    const topFour = output.topFourIds.map((id) => referenceById.get(id));
    if (!response || topFour.some((row) => !row)) throw new Error('Reference evidence is missing an oracle output.');
    const scores = topFour.map((row) => ({ id: row!.strategyId, score: scoreOnFold(row!, leader.evaluationFold) }));
    const bestScore = Math.max(...scores.map((entry) => entry.score));
    const responseScore = scoreOnFold(response, leader.evaluationFold);
    return { methodKey: output.key, lane: output.lane, selectionFold: leader.selectionFold,
      evaluationFold: leader.evaluationFold, referenceLeaderId: leader.selectedId,
      referenceLeaderTieIds: leader.topScoreTieIds, referenceHeldOutScore: leader.heldOutScore,
      responseId: output.selectedId, responseHeldOutScore: responseScore,
      heldOutRegret: leader.heldOutScore - responseScore, topFourIds: output.topFourIds,
      heldOutBestOfFourIds: scores.filter((entry) => entry.score === bestScore).map((entry) => entry.id),
      heldOutBestOfFourScore: bestScore, heldOutBestOfFourRegret: leader.heldOutScore - bestScore };
  }));
  const laneAgreement = [...new Set(outputs.map((output) => output.key))].flatMap((method) =>
    ([1, 2] as const).map((evaluationFold): LaneAgreementDiagnostic => {
      const a = outputs.find((output) => output.key === method && output.lane === 'a');
      const b = outputs.find((output) => output.key === method && output.lane === 'b');
      if (!a || !b) throw new Error(`Cross-fit output ${method} needs lanes A and B.`);
      const laneAScore = scoreOnFold(referenceById.get(a.selectedId)!, evaluationFold);
      const laneBScore = scoreOnFold(referenceById.get(b.selectedId)!, evaluationFold);
      return { method, evaluationFold, laneAId: a.selectedId, laneBId: b.selectedId,
        exactIdAgreement: a.selectedId === b.selectedId, laneAScore, laneBScore,
        scoreDifference: laneAScore - laneBScore };
    }));
  return { referenceLeaders, crossFitMetrics, laneAgreement };
}

function regretSummary(values: readonly number[]): { worst: number; median: number } {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Raw regret summary needs finite values.');
  }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
  return { worst: ordered.at(-1)!, median };
}

export function createResponseOracleCalibrationReport(input: {
  manifest: ResponseOracleCalibrationManifest;
  searchAChunks: readonly CalibrationScoreChunk[];
  searchBChunks: readonly CalibrationScoreChunk[];
  referenceChunks: readonly CalibrationScoreChunk[];
  searchAHalving: SuccessiveHalvingArtifact;
  searchBHalving: SuccessiveHalvingArtifact;
}): ResponseOracleCalibrationReport {
  const collect = (chunks: readonly CalibrationScoreChunk[], phase: CalibrationScoreChunk['phase']) => {
    if (chunks.length !== calibrationChunkCount()) throw new Error(`Calibration ${phase} chunks are incomplete.`);
    return [...chunks].sort((left, right) => left.chunk - right.chunk).flatMap((chunk, index) => {
      if (!validateCalibrationScoreChunk(chunk, input.manifest, phase, index)) throw new Error(`Calibration ${phase} chunk is invalid.`);
      return chunk.rows;
    });
  };
  const searchA = collect(input.searchAChunks, 'search-a'), searchB = collect(input.searchBChunks, 'search-b');
  const reference = collect(input.referenceChunks, 'reference');
  if (!validateSuccessiveHalvingArtifact(input.searchAHalving, input.manifest, 'a', searchA)
    || !validateSuccessiveHalvingArtifact(input.searchBHalving, input.manifest, 'b', searchB)
    || !input.searchAHalving.complete || !input.searchBHalving.complete) throw new Error('Calibration halving evidence is incomplete.');
  const tieSeeds = { a: input.manifest.seedPlan.searchA.opponentSamplingSeed,
    b: input.manifest.seedPlan.searchB.opponentSamplingSeed };
  const fixedA = fixedScreenResults(searchA, tieSeeds.a), fixedB = fixedScreenResults(searchB, tieSeeds.b);
  const ranks = new Map(input.manifest.candidates.map((entry) => [entry.strategyId, entry.goldfishRank]));
  const fixed50Games = RESPONSE_ORACLE_CANDIDATE_COUNT * 50 * GAMES_PER_SEED;
  const fixedOutput = (result: FixedDepthResult, lane: CalibrationLane): CalibrationMethodOutput => {
    const candidateSeedEvaluations = RESPONSE_ORACLE_CANDIDATE_COUNT * result.depth;
    return { key: `fixed-${result.depth}`, lane, method: 'fixed', depth: result.depth,
      selectedId: result.selectedId, selectedGoldfishRank: ranks.get(result.selectedId)!,
      topFourIds: result.topFourIds, topFourGoldfishRanks: result.topFourIds.map((id) => ranks.get(id)!),
      topScoreTieIds: result.topScoreTieIds, candidateSeedEvaluations,
      games: candidateSeedEvaluations * GAMES_PER_SEED,
      gamesSavedAgainstFixed50: fixed50Games - candidateSeedEvaluations * GAMES_PER_SEED };
  };
  const halvingOutput = (artifact: SuccessiveHalvingArtifact, lane: CalibrationLane): CalibrationMethodOutput => ({
    key: 'successive-halving', lane, method: 'successive-halving', depth: null,
    selectedId: artifact.selectedId!, selectedGoldfishRank: ranks.get(artifact.selectedId!)!,
    topFourIds: artifact.finalFourIds, topFourGoldfishRanks: artifact.finalFourIds.map((id) => ranks.get(id)!),
    topScoreTieIds: artifact.rounds.at(-1)!.topScoreTieIds,
    candidateSeedEvaluations: artifact.standaloneCandidateSeedEvaluations, games: artifact.standaloneGames,
    gamesSavedAgainstFixed50: fixed50Games - artifact.standaloneGames
  });
  const outputs: CalibrationMethodOutput[] = [...fixedA.map((result) => fixedOutput(result, 'a')),
    ...fixedB.map((result) => fixedOutput(result, 'b')), halvingOutput(input.searchAHalving, 'a'),
    halvingOutput(input.searchBHalving, 'b')];
  const { referenceLeaders, crossFitMetrics, laneAgreement } = crossFitCalibrationMetrics(reference,
    outputs, input.manifest.seedPlan.reference.opponentSamplingSeed);
  const fixedCost = RESPONSE_ORACLE_CANDIDATE_COUNT * 50;
  const standaloneHalving = successiveHalvingCost(RESPONSE_ORACLE_CANDIDATE_COUNT);
  const laneAccounting = (chunks: readonly CalibrationScoreChunk[], halving: SuccessiveHalvingArtifact) => {
    const fixed: CalibrationAccounting = {
      candidateSeedEvaluations: chunks.reduce((sum, chunk) => sum + chunk.candidateSeedEvaluations, 0),
      games: chunks.reduce((sum, chunk) => sum + chunk.games, 0),
      elapsedMs: chunks.reduce((sum, chunk) => sum + chunk.elapsedMs, 0)
    };
    const successiveHalvingTopups: CalibrationAccounting = { candidateSeedEvaluations: halving.candidateSeedEvaluations,
      games: halving.games, elapsedMs: halving.elapsedMs };
    return { candidateSeedEvaluations: fixed.candidateSeedEvaluations + halving.candidateSeedEvaluations,
      games: fixed.games + halving.games, elapsedMs: fixed.elapsedMs + halving.elapsedMs, fixed,
      successiveHalvingStandalone: { candidateSeedEvaluations: standaloneHalving,
        games: standaloneHalving * GAMES_PER_SEED },
      successiveHalvingTopups,
      gamesSavedByStandaloneHalvingAgainstFixed50: (fixedCost - standaloneHalving) * GAMES_PER_SEED };
  };
  const accountingA = laneAccounting(input.searchAChunks, input.searchAHalving);
  const accountingB = laneAccounting(input.searchBChunks, input.searchBHalving);
  const referenceAccounting: CalibrationAccounting = {
    candidateSeedEvaluations: input.referenceChunks.reduce((sum, chunk) => sum + chunk.candidateSeedEvaluations, 0),
    games: input.referenceChunks.reduce((sum, chunk) => sum + chunk.games, 0),
    elapsedMs: input.referenceChunks.reduce((sum, chunk) => sum + chunk.elapsedMs, 0)
  };
  const base = {
    schemaVersion: 1 as const, experiment: 'response-oracle-calibration-report' as const,
    version: RESPONSE_ORACLE_CALIBRATION_VERSION, manifestHash: input.manifest.evidenceHash,
    status: 'raw-metrics-require-user-tolerance' as const, outputs, referenceLeaders, crossFitMetrics,
    laneAgreement, rawRegretSummary: [...new Set(crossFitMetrics.map((entry) => entry.methodKey))]
      .map((methodKey) => {
        const rows = crossFitMetrics.filter((entry) => entry.methodKey === methodKey);
        return { methodKey, topOne: regretSummary(rows.map((entry) => entry.heldOutRegret)),
          topFour: regretSummary(rows.map((entry) => entry.heldOutBestOfFourRegret)) };
      }), accounting: { searchA: accountingA, searchB: accountingB, reference: referenceAccounting,
      total: { candidateSeedEvaluations: accountingA.candidateSeedEvaluations + accountingB.candidateSeedEvaluations
          + referenceAccounting.candidateSeedEvaluations,
        games: accountingA.games + accountingB.games + referenceAccounting.games,
        elapsedMs: accountingA.elapsedMs + accountingB.elapsedMs + referenceAccounting.elapsedMs } },
    sourceArtifactHashes: [input.manifest.source.rankedSha256, input.manifest.source.reservoirSha256,
      input.manifest.source.p75ManifestSha256, input.manifest.source.p75ReportSha256,
      input.manifest.evidenceHash, ...input.searchAChunks.map((chunk) => chunk.evidenceHash),
      input.searchAHalving.evidenceHash, ...input.searchBChunks.map((chunk) => chunk.evidenceHash),
      input.searchBHalving.evidenceHash, ...input.referenceChunks.map((chunk) => chunk.evidenceHash)]
  };
  return { ...base, evidenceHash: sha256(base) };
}

export function validateResponseOracleCalibrationReport(value: unknown, input: Parameters<
  typeof createResponseOracleCalibrationReport>[0]): value is ResponseOracleCalibrationReport {
  try { return exact(value, createResponseOracleCalibrationReport(input)); } catch { return false; }
}
