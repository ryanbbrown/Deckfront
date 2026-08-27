import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { anytimeConfidenceBounds } from './anytimeMeanEvidence';
import { InlineConfidenceRunner } from './confidenceRunner';
import type { ConfidenceBounds, ConfidenceRunner } from './confidenceRunner';
import { evaluateCandidates } from './mixtureEvaluation';
import type { CandidateEvaluation, MixtureSchedule } from './mixtureEvaluation';
import { GAMES_PER_SEED, emptyAggregate, mergeAggregate } from './pairing';
import type { PairingRunner } from './pairingRunner';
import type { CalibrationCandidateIdentity } from './responseOracleCalibration';
import { stableHash } from './strategy';
import type { Strategy } from './strategy';
import type { TelemetryAggregate } from './types';
import { compareUtf16 } from './utf16';

export const THRESHOLD_RACING_PSRO_VERSION = 'threshold-racing-psro-v2' as const;
export const SCREEN_DEPTHS = Object.freeze([8, 16, 32, 64, 128, 256, 512] as const);
export const CONFIRMATION_LOOKS = Object.freeze([400, 800, 1_600, 3_200, 6_400] as const);
export const RESPONSE_THRESHOLD = 0.51;
export const SCREEN_ALPHA = 0.05;
export const CONFIRMATION_FAMILY_ALPHA = 0.05;
export const PSRO_MATRIX_BLOCKS = 75;
export const DEFAULT_PSRO_EVALUATION_CHUNK = 250;

export type ThresholdStatus = 'below' | 'above' | 'unresolved';
export type ConfirmationStatus = 'rejected' | 'confirmed' | 'unresolved';
export interface ThresholdRacingProtocol {
  experimentName: string; protocolVersion: string; runId: string; kingdomId: string;
  reservoirCount: number; sourceIdentityHash: string; checkpointNamespace: string;
  threshold: number; screenDepths: readonly number[]; screenAlpha: number;
  confirmationLooks: readonly number[]; confirmationFamilyAlpha: number; matrixBlocks: number; cleanScans: number;
}
const PROTOCOL_KEYS = ['experimentName', 'protocolVersion', 'runId', 'kingdomId', 'reservoirCount',
  'sourceIdentityHash', 'checkpointNamespace', 'threshold', 'screenDepths', 'screenAlpha',
  'confirmationLooks', 'confirmationFamilyAlpha', 'matrixBlocks', 'cleanScans'] as const;
const exactKeys = (value: object, keys: readonly string[]): boolean => JSON.stringify(Object.keys(value).sort())
  === JSON.stringify([...keys].sort());
const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export function validateThresholdRacingProtocol(value: unknown): value is ThresholdRacingProtocol {
  if (!value || typeof value !== 'object' || !exactKeys(value, PROTOCOL_KEYS)) return false;
  const held = value as ThresholdRacingProtocol;
  return Boolean(held.experimentName && held.protocolVersion && held.runId && held.kingdomId
    && held.checkpointNamespace && positiveInteger(held.reservoirCount) && sha(held.sourceIdentityHash)
    && held.threshold === RESPONSE_THRESHOLD && held.screenAlpha === SCREEN_ALPHA
    && held.confirmationFamilyAlpha === CONFIRMATION_FAMILY_ALPHA && held.matrixBlocks === PSRO_MATRIX_BLOCKS
    && held.cleanScans === 2 && Array.isArray(held.screenDepths) && held.screenDepths.length > 0
    && held.screenDepths[0] === 8 && held.screenDepths.every((depth, index) => positiveInteger(depth)
      && (!index || depth === held.screenDepths[index - 1]! * 2))
    && Array.isArray(held.confirmationLooks) && held.confirmationLooks.length > 0
    && held.confirmationLooks.every((look, index) => positiveInteger(look)
      && (!index || look > held.confirmationLooks[index - 1]!)));
}
export function createThresholdRacingProtocol(input: {
  experimentName: string; protocolVersion?: string; runId: string; kingdomId: string;
  reservoirCount: number; sourceIdentityHash: string; checkpointNamespace: string;
  screenDepths?: readonly number[]; confirmationLooks?: readonly number[];
}): ThresholdRacingProtocol {
  const protocol = { experimentName: input.experimentName,
    protocolVersion: input.protocolVersion ?? THRESHOLD_RACING_PSRO_VERSION, runId: input.runId,
    kingdomId: input.kingdomId, reservoirCount: input.reservoirCount,
    sourceIdentityHash: input.sourceIdentityHash, checkpointNamespace: input.checkpointNamespace,
    threshold: RESPONSE_THRESHOLD, screenDepths: [...(input.screenDepths ?? SCREEN_DEPTHS)],
    screenAlpha: SCREEN_ALPHA, confirmationLooks: [...(input.confirmationLooks ?? CONFIRMATION_LOOKS)],
    confirmationFamilyAlpha: CONFIRMATION_FAMILY_ALPHA, matrixBlocks: PSRO_MATRIX_BLOCKS, cleanScans: 2 };
  if (!validateThresholdRacingProtocol(protocol)) {
    throw new Error('Threshold-racing PSRO protocol input is invalid.');
  }
  return protocol;
}
export function thresholdRacingProtocolHash(protocol: ThresholdRacingProtocol): string {
  if (!validateThresholdRacingProtocol(protocol)) throw new Error('Threshold-racing PSRO protocol is invalid.');
  return createHash('sha256').update(JSON.stringify(protocol)).digest('hex');
}

export interface CandidateRef { identity: CalibrationCandidateIdentity; strategy: Strategy }
export interface ThresholdDecision extends CalibrationCandidateIdentity {
  blocks: number; mean: number; interval: { lower: number; upper: number }; status: ThresholdStatus;
}
export interface ConfirmationDecision extends CalibrationCandidateIdentity {
  blocks: number; mean: number; interval: { lower: number; upper: number }; status: ConfirmationStatus;
}
export interface LookReport {
  blocks: number; entered: number; below?: number; above?: number; rejected?: number; confirmed?: number;
  unresolved: number; games: number; elapsedMs: number; rawLook?: RawPsroLookArtifact;
}
export interface ThresholdRaceResult {
  schedule: MixtureSchedule; looks: LookReport[]; below: ThresholdDecision[];
  provisional: ThresholdDecision[]; unresolved: ThresholdDecision[]; games: number; elapsedMs: number;
  telemetry: TelemetryAggregate;
}
export interface QueueOrder {
  orderedStrategyIds: string[]; strongestStrategyId: string | null; strongestTieIds: string[];
  strongestOverlapIds: string[];
}
export interface ConfirmationRaceResult {
  schedule: MixtureSchedule; familySize: number; alphaPerCandidate: number; looks: LookReport[];
  rejected: ConfirmationDecision[]; confirmed: ConfirmationDecision[]; unresolved: ConfirmationDecision[];
  order: QueueOrder; games: number; elapsedMs: number; telemetry: TelemetryAggregate;
}
export interface RawPsroScoreChunk {
  schemaVersion: 1; experiment: 'threshold-racing-raw-score-chunk'; protocolHash: string; sourceHash: string;
  raceKind: 'screen' | 'confirmation' | 'queue-retest'; lookId: string; lookDepth: number;
  familySize: number; alpha: number; threshold: number; candidateStart: number; candidateEnd: number;
  candidateIds: string[]; candidateCanonicals: string[]; fullSchedule: MixtureSchedule; suffixSchedule: MixtureSchedule;
  scheduleStart: number; scheduleEnd: number; scoreBytes: number[]; played: number[];
  dimensions: { candidates: number; blocks: number; scoreBytes: number; played: number };
  artifactHash: string;
}
export interface RawPsroLookArtifact {
  schemaVersion: 1; experiment: 'threshold-racing-raw-score-look'; protocolHash: string; sourceHash: string;
  raceKind: RawPsroScoreChunk['raceKind']; lookId: string; lookDepth: number; familySize: number;
  alpha: number; threshold: number; candidateIds: string[]; candidateCanonicals: string[];
  scheduleStart: number; scheduleEnd: number;
  chunks: Array<{ candidateStart: number; candidateEnd: number; artifactHash: string }>;
  artifactHash: string;
}
export interface RawPsroCheckpointEvent {
  type: 'strategy-search-checkpoint'; stage: 'psro'; protocolHash: string; sourceHash: string;
  lookId: string; lookHash: string; chunkHashes: string[]; eventHash: string;
}
export interface RawPsroArtifactStore {
  protocol: ThresholdRacingProtocol;
  raceKind: RawPsroScoreChunk['raceKind'];
  loadChunk?: (identity: { lookId: string; candidateStart: number; candidateEnd: number }) =>
    RawPsroScoreChunk | undefined | Promise<RawPsroScoreChunk | undefined>;
  sealChunk: (chunk: RawPsroScoreChunk) => void | Promise<void>;
  sealLook: (look: RawPsroLookArtifact, event: RawPsroCheckpointEvent) => void | Promise<void>;
}
interface EvaluationOptions {
  kingdomId: string; turnLimitPerPlayer: number; actionCapPerTurn: number;
  startingDraftEnabled: boolean; scoreOnly: true; lookId: string;
}
type Evaluate = (candidates: readonly Strategy[], opponents: ReadonlyMap<string, Strategy>,
  schedule: MixtureSchedule, runner: PairingRunner, options: EvaluationOptions) => Promise<CandidateEvaluation[]>;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const RAW_CHUNK_KEYS = ['schemaVersion', 'experiment', 'protocolHash', 'sourceHash', 'raceKind', 'lookId',
  'lookDepth', 'familySize', 'alpha', 'threshold', 'candidateStart', 'candidateEnd', 'candidateIds',
  'candidateCanonicals', 'fullSchedule', 'suffixSchedule', 'scheduleStart', 'scheduleEnd', 'scoreBytes',
  'played', 'dimensions', 'artifactHash'] as const;
const RAW_LOOK_KEYS = ['schemaVersion', 'experiment', 'protocolHash', 'sourceHash', 'raceKind', 'lookId',
  'lookDepth', 'familySize', 'alpha', 'threshold', 'candidateIds', 'candidateCanonicals', 'scheduleStart',
  'scheduleEnd', 'chunks', 'artifactHash'] as const;
const SCHEDULE_KEYS = ['targetWeights', 'blocks', 'realizedOpponentCounts',
  'unsampledPositiveWeightStrategies'] as const;
function candidateIdentitiesValid(ids: readonly string[], canonicals: readonly string[]): boolean {
  return ids.length > 0 && ids.length === canonicals.length && new Set(ids).size === ids.length
    && new Set(canonicals).size === canonicals.length && ids.every((id, index) => typeof id === 'string'
      && typeof canonicals[index] === 'string' && canonicals[index]!.length > 0
      && id === `sg-${stableHash(canonicals[index]!)}`);
}
export function validateMixtureSchedule(value: unknown): value is MixtureSchedule {
  if (!value || typeof value !== 'object' || !exactKeys(value, SCHEDULE_KEYS)) return false;
  const held = value as MixtureSchedule, ids = Object.keys(held.targetWeights ?? {});
  if (!ids.length || JSON.stringify(ids) !== JSON.stringify([...ids].sort(compareUtf16))
    || ids.some((id) => !id || !Number.isFinite(held.targetWeights[id]) || held.targetWeights[id]! <= 0)
    || Math.abs(ids.reduce((sum, id) => sum + held.targetWeights[id]!, 0) - 1) > 1e-12
    || !Array.isArray(held.blocks) || !held.blocks.length
    || held.blocks.some((block) => !block || !exactKeys(block, ['seed', 'opponentId'])
      || !Number.isSafeInteger(block.seed) || block.seed < 0 || block.seed > 0xffff_ffff
      || !ids.includes(block.opponentId))
    || new Set(held.blocks.map((block) => block.seed)).size !== held.blocks.length
    || !held.realizedOpponentCounts || typeof held.realizedOpponentCounts !== 'object'
    || JSON.stringify(Object.keys(held.realizedOpponentCounts)) !== JSON.stringify(ids)
    || !Array.isArray(held.unsampledPositiveWeightStrategies)) return false;
  const counts = Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>;
  held.blocks.forEach((block) => { counts[block.opponentId] = counts[block.opponentId]! + 1; });
  return JSON.stringify(counts) === JSON.stringify(held.realizedOpponentCounts)
    && JSON.stringify(ids.filter((id) => counts[id] === 0))
      === JSON.stringify(held.unsampledPositiveWeightStrategies);
}
function expectedAlpha(kind: RawPsroScoreChunk['raceKind'], familySize: number,
  protocol?: ThresholdRacingProtocol): number {
  if (kind === 'screen') return protocol?.screenAlpha ?? SCREEN_ALPHA;
  return (protocol?.confirmationFamilyAlpha ?? CONFIRMATION_FAMILY_ALPHA) / familySize;
}
function protocolLookDepthValid(kind: RawPsroScoreChunk['raceKind'], depth: number,
  protocol?: ThresholdRacingProtocol): boolean {
  if (!protocol) return positiveInteger(depth);
  return (kind === 'screen' ? protocol.screenDepths : protocol.confirmationLooks).includes(depth);
}

/** Largest deficit assigns each next block to the most under-served positive-weight opponent. */
export function weightedFairSchedule(weights: Readonly<Record<string, number>>, seeds: readonly number[]): MixtureSchedule {
  if (!seeds.length || new Set(seeds).size !== seeds.length
    || seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff)) {
    throw new Error('Weighted-fair schedule needs unique uint32 seeds.');
  }
  const entries = Object.entries(weights).filter((entry) => entry[1] > 0)
    .sort(([left], [right]) => compareUtf16(left, right));
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  if (!entries.length || !(total > 0) || entries.some((entry) => !Number.isFinite(entry[1]))) {
    throw new Error('Weighted-fair schedule needs finite positive weight.');
  }
  const targetWeights = Object.fromEntries(entries.map(([id, weight]) => [id, weight / total]));
  const realizedOpponentCounts = Object.fromEntries(entries.map(([id]) => [id, 0])) as Record<string, number>;
  const blocks = seeds.map((seed, index) => {
    let selected = entries[0]![0], largest = Number.NEGATIVE_INFINITY;
    for (const [id] of entries) {
      const deficit = targetWeights[id]! * (index + 1) - realizedOpponentCounts[id]!;
      if (deficit > largest) { largest = deficit; selected = id; }
    }
    realizedOpponentCounts[selected] = realizedOpponentCounts[selected]! + 1;
    return { seed, opponentId: selected };
  });
  const schedule = { targetWeights, blocks, realizedOpponentCounts,
    unsampledPositiveWeightStrategies: entries.map(([id]) => id).filter((id) => !realizedOpponentCounts[id]) };
  if (!validateMixtureSchedule(schedule)) throw new Error('Weighted-fair schedule is invalid.');
  return schedule;
}
export function scheduleSlice(schedule: MixtureSchedule, start: number, end: number): MixtureSchedule {
  const blocks = schedule.blocks.slice(start, end), ids = Object.keys(schedule.targetWeights);
  const realizedOpponentCounts = Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>;
  blocks.forEach((block) => { realizedOpponentCounts[block.opponentId] = realizedOpponentCounts[block.opponentId]! + 1; });
  return { targetWeights: { ...schedule.targetWeights }, blocks, realizedOpponentCounts,
    unsampledPositiveWeightStrategies: ids.filter((id) => !realizedOpponentCounts[id]) };
}
function thresholdDecision(input: CalibrationCandidateIdentity, scores: readonly number[],
  interval: ConfidenceBounds): ThresholdDecision {
  const status: ThresholdStatus = interval.upper <= RESPONSE_THRESHOLD ? 'below'
    : interval.lower > RESPONSE_THRESHOLD ? 'above' : 'unresolved';
  return { ...input, blocks: scores.length, mean: mean(scores), interval, status };
}
export function classifyThreshold(input: CalibrationCandidateIdentity, scores: readonly number[],
  alpha = SCREEN_ALPHA): ThresholdDecision {
  return thresholdDecision(input, scores, anytimeConfidenceBounds(scores, alpha));
}
function confirmationDecision(input: CalibrationCandidateIdentity, scores: readonly number[],
  interval: ConfidenceBounds): ConfirmationDecision {
  const status: ConfirmationStatus = interval.lower > RESPONSE_THRESHOLD ? 'confirmed'
    : interval.upper <= RESPONSE_THRESHOLD ? 'rejected' : 'unresolved';
  return { ...input, blocks: scores.length, mean: mean(scores), interval, status };
}
export function orderConfirmedQueue(rows: readonly ConfirmationDecision[]): QueueOrder {
  const ordered = [...rows].sort((left, right) => right.interval.lower - left.interval.lower
    || right.mean - left.mean || right.interval.upper - left.interval.upper
    || left.goldfishRank - right.goldfishRank || compareUtf16(left.strategyId, right.strategyId)
    || compareUtf16(left.canonicalStrategy, right.canonicalStrategy));
  const strongest = ordered[0];
  if (!strongest) return { orderedStrategyIds: [], strongestStrategyId: null,
    strongestTieIds: [], strongestOverlapIds: [] };
  return { orderedStrategyIds: ordered.map((entry) => entry.strategyId), strongestStrategyId: strongest.strategyId,
    strongestTieIds: ordered.filter((entry) => entry.strategyId !== strongest.strategyId
      && entry.interval.lower === strongest.interval.lower && entry.interval.upper === strongest.interval.upper
      && entry.mean === strongest.mean).map((entry) => entry.strategyId),
    strongestOverlapIds: ordered.filter((entry) => entry.strategyId !== strongest.strategyId
      && entry.interval.lower <= strongest.interval.upper && strongest.interval.lower <= entry.interval.upper)
      .map((entry) => entry.strategyId) };
}

function createRawChunk(input: { store: RawPsroArtifactStore; lookId: string; lookDepth: number;
  familySize: number; alpha: number; candidates: readonly CandidateRef[]; candidateStart: number;
  fullSchedule: MixtureSchedule; suffixSchedule: MixtureSchedule; scheduleStart: number;
  rows: readonly CandidateEvaluation[] }): RawPsroScoreChunk {
  const scoreBytes = input.rows.flatMap((row) => row.blockScores.map((score) => score * 4));
  if (scoreBytes.some((score) => !Number.isSafeInteger(score) || score < 0 || score > 4)) {
    throw new Error('PSRO raw score is not an exact 0..4 byte.');
  }
  const candidateEnd = input.candidateStart + input.candidates.length;
  const base = { schemaVersion: 1 as const, experiment: 'threshold-racing-raw-score-chunk' as const,
    protocolHash: thresholdRacingProtocolHash(input.store.protocol),
    sourceHash: input.store.protocol.sourceIdentityHash, raceKind: input.store.raceKind,
    lookId: input.lookId, lookDepth: input.lookDepth, familySize: input.familySize, alpha: input.alpha,
    threshold: RESPONSE_THRESHOLD, candidateStart: input.candidateStart, candidateEnd,
    candidateIds: input.candidates.map((entry) => entry.identity.strategyId),
    candidateCanonicals: input.candidates.map((entry) => entry.identity.canonicalStrategy),
    fullSchedule: structuredClone(input.fullSchedule), suffixSchedule: structuredClone(input.suffixSchedule),
    scheduleStart: input.scheduleStart, scheduleEnd: input.scheduleStart + input.suffixSchedule.blocks.length,
    scoreBytes, played: input.rows.flatMap(() => input.suffixSchedule.blocks.map(() => GAMES_PER_SEED)),
    dimensions: { candidates: input.candidates.length, blocks: input.suffixSchedule.blocks.length,
      scoreBytes: scoreBytes.length, played: scoreBytes.length }, artifactHash: '' };
  return { ...base, artifactHash: hash(base) };
}
export function validateRawPsroScoreChunk(value: unknown, protocol?: ThresholdRacingProtocol): value is RawPsroScoreChunk {
  if (protocol && !validateThresholdRacingProtocol(protocol)) return false;
  if (!value || typeof value !== 'object' || !exactKeys(value, RAW_CHUNK_KEYS)) return false;
  const held = value as RawPsroScoreChunk;
  if (!held.dimensions || !exactKeys(held.dimensions, ['candidates', 'blocks', 'scoreBytes', 'played'])) return false;
  const copy = structuredClone(held); copy.artifactHash = '';
  const expectedSize = held.dimensions.candidates * held.dimensions.blocks;
  const fullScheduleValid = validateMixtureSchedule(held.fullSchedule);
  const suffixScheduleValid = validateMixtureSchedule(held.suffixSchedule);
  const expectedSuffix = fullScheduleValid && Number.isSafeInteger(held.scheduleStart)
    && Number.isSafeInteger(held.scheduleEnd) && held.scheduleStart >= 0
    && held.scheduleEnd > held.scheduleStart && held.scheduleEnd <= held.fullSchedule.blocks.length
    ? scheduleSlice(held.fullSchedule, held.scheduleStart, held.scheduleEnd) : null;
  return held.schemaVersion === 1 && held.experiment === 'threshold-racing-raw-score-chunk'
    && sha(held.protocolHash) && sha(held.sourceHash) && sha(held.artifactHash)
    && (!protocol || held.protocolHash === thresholdRacingProtocolHash(protocol))
    && held.sourceHash === (protocol?.sourceIdentityHash ?? held.sourceHash)
    && ['screen', 'confirmation', 'queue-retest'].includes(held.raceKind) && Boolean(held.lookId)
    && positiveInteger(held.lookDepth) && held.lookDepth === held.scheduleEnd
    && protocolLookDepthValid(held.raceKind, held.lookDepth, protocol)
    && positiveInteger(held.familySize) && Number.isFinite(held.alpha) && held.alpha > 0 && held.alpha <= 1
    && held.alpha === expectedAlpha(held.raceKind, held.familySize, protocol)
    && held.threshold === (protocol?.threshold ?? RESPONSE_THRESHOLD)
    && Number.isSafeInteger(held.candidateStart) && held.candidateStart >= 0
    && Number.isSafeInteger(held.candidateEnd) && held.candidateEnd > held.candidateStart
    && held.candidateEnd <= held.familySize
    && candidateIdentitiesValid(held.candidateIds, held.candidateCanonicals)
    && held.candidateEnd - held.candidateStart === held.dimensions.candidates
    && positiveInteger(held.dimensions.candidates) && positiveInteger(held.dimensions.blocks)
    && held.dimensions.blocks === held.scheduleEnd - held.scheduleStart
    && held.dimensions.scoreBytes === expectedSize && held.dimensions.played === expectedSize
    && fullScheduleValid && suffixScheduleValid
    && expectedSuffix !== null && JSON.stringify(held.suffixSchedule) === JSON.stringify(expectedSuffix)
    && held.scoreBytes?.length === expectedSize && held.played?.length === expectedSize
    && held.scoreBytes.every((score) => Number.isSafeInteger(score) && score >= 0 && score <= 4)
    && held.played.every((played) => Number.isSafeInteger(played) && played === GAMES_PER_SEED)
    && held.artifactHash === hash(copy);
}
export function rawScoreRows(chunk: RawPsroScoreChunk): number[][] {
  if (!validateRawPsroScoreChunk(chunk)) throw new Error('PSRO raw score chunk is invalid.');
  return Array.from({ length: chunk.dimensions.candidates }, (_unused, index) => chunk.scoreBytes
    .slice(index * chunk.dimensions.blocks, (index + 1) * chunk.dimensions.blocks).map((score) => score / 4));
}
export function validateRawPsroLookArtifact(value: unknown,
  protocol?: ThresholdRacingProtocol): value is RawPsroLookArtifact {
  if (protocol && !validateThresholdRacingProtocol(protocol)) return false;
  if (!value || typeof value !== 'object' || !exactKeys(value, RAW_LOOK_KEYS)) return false;
  const held = value as RawPsroLookArtifact, copy = structuredClone(held); copy.artifactHash = '';
  if (held.schemaVersion !== 1 || held.experiment !== 'threshold-racing-raw-score-look'
    || !sha(held.protocolHash) || !sha(held.sourceHash) || !sha(held.artifactHash)
    || (protocol && held.protocolHash !== thresholdRacingProtocolHash(protocol))
    || held.sourceHash !== (protocol?.sourceIdentityHash ?? held.sourceHash)
    || !['screen', 'confirmation', 'queue-retest'].includes(held.raceKind) || !held.lookId
    || !positiveInteger(held.lookDepth) || held.lookDepth !== held.scheduleEnd
    || !protocolLookDepthValid(held.raceKind, held.lookDepth, protocol)
    || !positiveInteger(held.familySize) || !candidateIdentitiesValid(held.candidateIds, held.candidateCanonicals)
    || held.candidateIds.length > held.familySize || !Number.isFinite(held.alpha) || held.alpha <= 0 || held.alpha > 1
    || held.alpha !== expectedAlpha(held.raceKind, held.familySize, protocol)
    || held.threshold !== (protocol?.threshold ?? RESPONSE_THRESHOLD)
    || !Number.isSafeInteger(held.scheduleStart) || held.scheduleStart < 0
    || !Number.isSafeInteger(held.scheduleEnd) || held.scheduleEnd <= held.scheduleStart
    || !Array.isArray(held.chunks) || !held.chunks.length || held.artifactHash !== hash(copy)) return false;
  let cursor = 0; const hashes = new Set<string>();
  for (const reference of held.chunks) {
    if (!reference || !exactKeys(reference, ['candidateStart', 'candidateEnd', 'artifactHash'])
      || !Number.isSafeInteger(reference.candidateStart) || reference.candidateStart !== cursor
      || !Number.isSafeInteger(reference.candidateEnd) || reference.candidateEnd <= reference.candidateStart
      || reference.candidateEnd > held.candidateIds.length || !sha(reference.artifactHash)
      || hashes.has(reference.artifactHash)) return false;
    cursor = reference.candidateEnd; hashes.add(reference.artifactHash);
  }
  return cursor === held.candidateIds.length;
}
export function assembleRawPsroLook(look: RawPsroLookArtifact,
  chunks: readonly RawPsroScoreChunk[], protocol?: ThresholdRacingProtocol): Record<string, number[]> {
  if (!validateRawPsroLookArtifact(look, protocol) || chunks.length !== look.chunks.length) {
    throw new Error('PSRO raw look is stale or corrupt.');
  }
  const result: Record<string, number[]> = {}; let cursor = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!, reference = look.chunks[index]!;
    if (!validateRawPsroScoreChunk(chunk, protocol) || chunk.artifactHash !== reference.artifactHash
      || chunk.candidateStart !== reference.candidateStart || chunk.candidateEnd !== reference.candidateEnd
      || chunk.candidateStart !== cursor || chunk.lookId !== look.lookId || chunk.lookDepth !== look.lookDepth
      || chunk.raceKind !== look.raceKind || chunk.protocolHash !== look.protocolHash
      || chunk.sourceHash !== look.sourceHash || chunk.familySize !== look.familySize
      || chunk.alpha !== look.alpha || chunk.threshold !== look.threshold
      || chunk.scheduleStart !== look.scheduleStart || chunk.scheduleEnd !== look.scheduleEnd
      || (index > 0 && (JSON.stringify(chunk.fullSchedule) !== JSON.stringify(chunks[0]!.fullSchedule)
        || JSON.stringify(chunk.suffixSchedule) !== JSON.stringify(chunks[0]!.suffixSchedule)))) {
      throw new Error('PSRO raw look chunk coverage is stale, corrupt, overlapping, or incomplete.');
    }
    const rows = rawScoreRows(chunk);
    chunk.candidateIds.forEach((id, row) => {
      if (look.candidateIds[cursor + row] !== id
        || look.candidateCanonicals[cursor + row] !== chunk.candidateCanonicals[row] || result[id]) {
        throw new Error('PSRO raw look candidate order is invalid.');
      }
      result[id] = rows[row]!;
    });
    cursor = chunk.candidateEnd;
  }
  if (cursor !== look.candidateIds.length) throw new Error('PSRO raw look candidate coverage is incomplete.');
  return result;
}

async function evaluateField(input: { candidates: readonly CandidateRef[]; opponents: ReadonlyMap<string, Strategy>;
  fullSchedule: MixtureSchedule; suffixSchedule: MixtureSchedule; scheduleStart: number; kingdomId: string;
  runner: PairingRunner; evaluate: Evaluate; chunkSize: number; lookId: string; lookDepth: number;
  familySize: number; alpha: number; raw?: RawPsroArtifactStore }): Promise<{
    rows: CandidateEvaluation[]; games: number; elapsedMs: number; telemetry: TelemetryAggregate;
    rawChunks: RawPsroScoreChunk[] }> {
  const rows: CandidateEvaluation[] = [], telemetry = emptyAggregate(), rawChunks: RawPsroScoreChunk[] = [];
  let games = 0, elapsedMs = 0;
  for (let start = 0; start < input.candidates.length; start += input.chunkSize) {
    const field = input.candidates.slice(start, start + input.chunkSize);
    const loaded = input.raw ? await input.raw.loadChunk?.({ lookId: input.lookId,
      candidateStart: start, candidateEnd: start + field.length }) : undefined;
    if (loaded) {
      if (!validateRawPsroScoreChunk(loaded, input.raw!.protocol)
        || loaded.raceKind !== input.raw!.raceKind || loaded.lookId !== input.lookId
        || loaded.lookDepth !== input.lookDepth || loaded.familySize !== input.familySize
        || loaded.alpha !== input.alpha || loaded.threshold !== RESPONSE_THRESHOLD
        || loaded.candidateStart !== start || loaded.candidateEnd !== start + field.length
        || loaded.scheduleStart !== input.scheduleStart
        || loaded.scheduleEnd !== input.scheduleStart + input.suffixSchedule.blocks.length
        || JSON.stringify(loaded.fullSchedule) !== JSON.stringify(input.fullSchedule)
        || JSON.stringify(loaded.suffixSchedule) !== JSON.stringify(input.suffixSchedule)
        || !loaded.candidateIds.every((id, index) => id === field[index]!.identity.strategyId)
        || !loaded.candidateCanonicals.every((canonical, index) =>
          canonical === field[index]!.identity.canonicalStrategy)) {
        throw new Error('Saved PSRO raw score chunk is stale or corrupt.');
      }
      rawChunks.push(loaded);
      const scores = rawScoreRows(loaded);
      rows.push(...field.map((entry, index) => ({ strategy: entry.strategy,
        mean: mean(scores[index]!), blockScores: scores[index]!, interval: null,
        matches: scores[index]!.length * GAMES_PER_SEED, telemetry: emptyAggregate() })));
      games += loaded.played.reduce((sum, played) => sum + played, 0);
      continue;
    }
    const started = performance.now();
    const evaluated = await input.evaluate(field.map((entry) => entry.strategy), input.opponents,
      input.suffixSchedule, input.runner, { kingdomId: input.kingdomId, turnLimitPerPlayer: 30,
        actionCapPerTurn: 200, startingDraftEnabled: false, scoreOnly: true, lookId: input.lookId });
    elapsedMs += performance.now() - started;
    if (evaluated.length !== field.length) throw new Error('Candidate evaluation returned an incomplete field.');
    for (let index = 0; index < evaluated.length; index += 1) {
      const row = evaluated[index]!;
      if (row.strategy.id !== field[index]!.strategy.id || row.blockScores.length !== input.suffixSchedule.blocks.length
        || row.matches !== input.suffixSchedule.blocks.length * GAMES_PER_SEED) {
        throw new Error('Candidate evaluation returned invalid shared-schedule evidence.');
      }
      rows.push(row); games += row.matches; mergeAggregate(telemetry, row.telemetry);
    }
    if (input.raw) {
      const chunk = createRawChunk({ store: input.raw, lookId: input.lookId, lookDepth: input.lookDepth,
        familySize: input.familySize, alpha: input.alpha, candidates: field, candidateStart: start,
        fullSchedule: input.fullSchedule, suffixSchedule: input.suffixSchedule,
        scheduleStart: input.scheduleStart, rows: evaluated });
      await input.raw.sealChunk(chunk); rawChunks.push(chunk);
    }
  }
  return { rows, games, elapsedMs, telemetry, rawChunks };
}
async function sealLook(raw: RawPsroArtifactStore | undefined, input: { lookId: string; lookDepth: number;
  familySize: number; alpha: number; candidates: readonly CandidateRef[]; scheduleStart: number;
  scheduleEnd: number; chunks: readonly RawPsroScoreChunk[] }): Promise<RawPsroLookArtifact | undefined> {
  if (!raw) return undefined;
  const base = { schemaVersion: 1 as const, experiment: 'threshold-racing-raw-score-look' as const,
    protocolHash: thresholdRacingProtocolHash(raw.protocol), sourceHash: raw.protocol.sourceIdentityHash,
    raceKind: raw.raceKind, lookId: input.lookId, lookDepth: input.lookDepth, familySize: input.familySize,
    alpha: input.alpha, threshold: RESPONSE_THRESHOLD,
    candidateIds: input.candidates.map((entry) => entry.identity.strategyId),
    candidateCanonicals: input.candidates.map((entry) => entry.identity.canonicalStrategy),
    scheduleStart: input.scheduleStart, scheduleEnd: input.scheduleEnd,
    chunks: input.chunks.map((chunk) => ({ candidateStart: chunk.candidateStart,
      candidateEnd: chunk.candidateEnd, artifactHash: chunk.artifactHash })), artifactHash: '' };
  const look = { ...base, artifactHash: hash(base) };
  const eventBase = { type: 'strategy-search-checkpoint' as const, stage: 'psro' as const,
    protocolHash: look.protocolHash, sourceHash: look.sourceHash, lookId: look.lookId,
    lookHash: look.artifactHash, chunkHashes: look.chunks.map((chunk) => chunk.artifactHash) };
  await raw.sealLook(look, { ...eventBase, eventHash: hash(eventBase) }); return look;
}

export async function runThresholdRace(input: { candidates: readonly CandidateRef[];
  opponents: ReadonlyMap<string, Strategy>; schedule: MixtureSchedule; kingdomId: string; runner: PairingRunner;
  depths?: readonly number[]; evaluate?: Evaluate; confidence?: ConfidenceRunner; chunkSize?: number;
  lookIdPrefix?: string; raw?: RawPsroArtifactStore }): Promise<ThresholdRaceResult> {
  const depths = input.depths ?? SCREEN_DEPTHS;
  if (!depths.length || depths[0] !== 8 || depths.some((depth, index) => index > 0
    && depth !== depths[index - 1]! * 2) || input.schedule.blocks.length < depths.at(-1)!) {
    throw new Error('Threshold screen depths are invalid.');
  }
  const evaluate = input.evaluate ?? evaluateCandidates, confidence = input.confidence ?? new InlineConfidenceRunner();
  const byId = new Map(input.candidates.map((entry) => [entry.strategy.id, entry]));
  const scores = new Map(input.candidates.map((entry) => [entry.strategy.id, [] as number[]]));
  const below: ThresholdDecision[] = [], provisional: ThresholdDecision[] = [], telemetry = emptyAggregate();
  const looks: LookReport[] = [], latest = new Map<string, ThresholdDecision>();
  let active = [...input.candidates], previous = 0, games = 0, elapsedMs = 0;
  for (const depth of depths) {
    if (!active.length) break;
    const lookId = `${input.lookIdPrefix ?? 'threshold'}.blocks-${depth}`;
    const evaluated = await evaluateField({ candidates: active, opponents: input.opponents,
      fullSchedule: input.schedule, suffixSchedule: scheduleSlice(input.schedule, previous, depth),
      scheduleStart: previous, kingdomId: input.kingdomId, runner: input.runner, evaluate,
      chunkSize: input.chunkSize ?? DEFAULT_PSRO_EVALUATION_CHUNK, lookId, lookDepth: depth,
      familySize: input.candidates.length, alpha: SCREEN_ALPHA, ...(input.raw && { raw: input.raw }) });
    games += evaluated.games; elapsedMs += evaluated.elapsedMs; mergeAggregate(telemetry, evaluated.telemetry);
    for (const row of evaluated.rows) scores.get(row.strategy.id)!.push(...row.blockScores);
    const rawLook = await sealLook(input.raw, { lookId, lookDepth: depth, familySize: input.candidates.length,
      alpha: SCREEN_ALPHA, candidates: active, scheduleStart: previous, scheduleEnd: depth,
      chunks: evaluated.rawChunks });
    const intervals = await confidence.run(evaluated.rows.map((row) => ({ values: scores.get(row.strategy.id)!,
      alpha: SCREEN_ALPHA })));
    const decisions = evaluated.rows.map((row, index) => thresholdDecision(byId.get(row.strategy.id)!.identity,
      scores.get(row.strategy.id)!, intervals[index]!));
    decisions.forEach((decision) => latest.set(decision.strategyId, decision));
    const low = decisions.filter((entry) => entry.status === 'below'),
      high = decisions.filter((entry) => entry.status === 'above'),
      unresolved = decisions.filter((entry) => entry.status === 'unresolved');
    below.push(...low); provisional.push(...high);
    looks.push({ blocks: depth, entered: active.length, below: low.length, above: high.length,
      unresolved: unresolved.length, games: evaluated.games, elapsedMs: evaluated.elapsedMs, ...(rawLook && { rawLook }) });
    active = unresolved.map((entry) => byId.get(entry.strategyId)!); previous = depth;
  }
  return { schedule: input.schedule, looks, below, provisional,
    unresolved: active.map((entry) => latest.get(entry.strategy.id)!), games, elapsedMs, telemetry };
}

export async function runConfirmationRace(input: { candidates: readonly CandidateRef[];
  opponents: ReadonlyMap<string, Strategy>; schedule: MixtureSchedule; kingdomId: string; runner: PairingRunner;
  looks?: readonly number[]; evaluate?: Evaluate; confidence?: ConfidenceRunner; chunkSize?: number;
  lookIdPrefix?: string; raw?: RawPsroArtifactStore }): Promise<ConfirmationRaceResult> {
  if (!input.candidates.length) throw new Error('Confirmation needs a non-empty family.');
  const looksInput = input.looks ?? CONFIRMATION_LOOKS;
  if (!looksInput.length || input.schedule.blocks.length < looksInput.at(-1)!
    || looksInput.some((look, index) => index > 0 && look <= looksInput[index - 1]!)) {
    throw new Error('Confirmation looks are invalid.');
  }
  const familySize = input.candidates.length, alphaPerCandidate = CONFIRMATION_FAMILY_ALPHA / familySize;
  const evaluate = input.evaluate ?? evaluateCandidates, confidence = input.confidence ?? new InlineConfidenceRunner();
  const byId = new Map(input.candidates.map((entry) => [entry.strategy.id, entry]));
  const scores = new Map(input.candidates.map((entry) => [entry.strategy.id, [] as number[]]));
  const rejected: ConfirmationDecision[] = [], confirmed: ConfirmationDecision[] = [], telemetry = emptyAggregate();
  const looks: LookReport[] = [], latest = new Map<string, ConfirmationDecision>();
  let active = [...input.candidates], previous = 0, games = 0, elapsedMs = 0;
  for (const blocks of looksInput) {
    if (!active.length) break;
    const lookId = `${input.lookIdPrefix ?? 'confirmation'}.blocks-${blocks}`;
    const evaluated = await evaluateField({ candidates: active, opponents: input.opponents,
      fullSchedule: input.schedule, suffixSchedule: scheduleSlice(input.schedule, previous, blocks),
      scheduleStart: previous, kingdomId: input.kingdomId, runner: input.runner, evaluate,
      chunkSize: input.chunkSize ?? DEFAULT_PSRO_EVALUATION_CHUNK, lookId, lookDepth: blocks,
      familySize, alpha: alphaPerCandidate, ...(input.raw && { raw: input.raw }) });
    games += evaluated.games; elapsedMs += evaluated.elapsedMs; mergeAggregate(telemetry, evaluated.telemetry);
    for (const row of evaluated.rows) scores.get(row.strategy.id)!.push(...row.blockScores);
    const rawLook = await sealLook(input.raw, { lookId, lookDepth: blocks, familySize,
      alpha: alphaPerCandidate, candidates: active, scheduleStart: previous, scheduleEnd: blocks,
      chunks: evaluated.rawChunks });
    const intervals = await confidence.run(evaluated.rows.map((row) => ({ values: scores.get(row.strategy.id)!,
      alpha: alphaPerCandidate })));
    const decisions = evaluated.rows.map((row, index) => confirmationDecision(byId.get(row.strategy.id)!.identity,
      scores.get(row.strategy.id)!, intervals[index]!));
    decisions.forEach((decision) => latest.set(decision.strategyId, decision));
    const low = decisions.filter((entry) => entry.status === 'rejected'),
      high = decisions.filter((entry) => entry.status === 'confirmed'),
      unresolved = decisions.filter((entry) => entry.status === 'unresolved');
    rejected.push(...low); confirmed.push(...high);
    looks.push({ blocks, entered: active.length, rejected: low.length, confirmed: high.length,
      unresolved: unresolved.length, games: evaluated.games, elapsedMs: evaluated.elapsedMs, ...(rawLook && { rawLook }) });
    active = unresolved.map((entry) => byId.get(entry.strategyId)!); previous = blocks;
  }
  const unresolved = active.map((entry) => latest.get(entry.strategy.id)!);
  return { schedule: input.schedule, familySize, alphaPerCandidate, looks, rejected, confirmed, unresolved,
    order: orderConfirmedQueue(confirmed), games, elapsedMs, telemetry };
}
export function cleanScansAfter(current: number, admitted: boolean, clean: boolean): number {
  if (admitted) return 0; return clean ? current + 1 : current;
}
export function actionAfterScreen(screen: Pick<ThresholdRaceResult, 'provisional' | 'unresolved'>): 'clean' | 'confirm' {
  return screen.provisional.length ? 'confirm' : 'clean';
}
export function actionAfterConfirmation(confirmation: Pick<ConfirmationRaceResult,
  'confirmed' | 'unresolved'>): 'empty' | 'queued' {
  return confirmation.confirmed.length ? 'queued' : 'empty';
}
export function fixedProtocolTerminalReason(result: Pick<ThresholdRaceResult | ConfirmationRaceResult,
  'unresolved'>): 'fixed-protocol-look-cap-unresolved' | null {
  return result.unresolved.length ? 'fixed-protocol-look-cap-unresolved' : null;
}
