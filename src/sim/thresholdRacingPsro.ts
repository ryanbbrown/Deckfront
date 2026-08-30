import { createHash } from 'node:crypto';
import { anytimeConfidenceBounds } from './anytimeMeanEvidence';
import { canonicalStrategy, stableHash } from './strategy';
import type { ConfidenceBounds } from './confidenceRunner';
import type { MixtureSchedule } from './mixtureEvaluation';
import { compareUtf16 } from './utf16';
import { createOrderedCandidateSpace, orderedGoldfishCardIds } from './orderedGoldfishBenchmark';

export const THRESHOLD_RACING_PSRO_VERSION = 'threshold-racing-psro-v2' as const;
export const SCREEN_DEPTHS = Object.freeze([8, 16, 32, 64, 128, 256, 512] as const);
export const CONFIRMATION_LOOKS = Object.freeze([400, 800, 1_600, 3_200, 6_400] as const);
export const RESPONSE_THRESHOLD = 0.51;
export const SCREEN_ALPHA = 0.05;
export const CONFIRMATION_FAMILY_ALPHA = 0.05;
export const PSRO_MATRIX_BLOCKS = 75;
export const LEGACY_THRESHOLD_RACING_SEED_NAMESPACES = Object.freeze({
  matrix: 'legacy-k007-matrix-v1', screen: 'legacy-k007-screen-v1',
  confirmation: 'legacy-k007-confirmation-v1', queueRetest: 'legacy-k007-queue-retest-v1'
});

export type ThresholdStatus = 'below' | 'above' | 'unresolved';
export type ConfirmationStatus = 'rejected' | 'confirmed' | 'unresolved';
export interface ThresholdRacingProtocol {
  experimentName: string; protocolVersion: string; runId: string; kingdomId: string;
  reservoirCount: number; sourceIdentityHash: string; checkpointNamespace: string;
  threshold: number; screenDepths: readonly number[]; screenAlpha: number;
  confirmationLooks: readonly number[]; confirmationFamilyAlpha: number; matrixBlocks: number; cleanScans: number;
  matrixSeedNamespace: string; screenSeedNamespace: string; confirmationSeedNamespace: string;
  queueRetestSeedNamespace: string;
}
const PROTOCOL_KEYS = ['experimentName', 'protocolVersion', 'runId', 'kingdomId', 'reservoirCount',
  'sourceIdentityHash', 'checkpointNamespace', 'threshold', 'screenDepths', 'screenAlpha',
  'confirmationLooks', 'confirmationFamilyAlpha', 'matrixBlocks', 'cleanScans', 'matrixSeedNamespace',
  'screenSeedNamespace', 'confirmationSeedNamespace', 'queueRetestSeedNamespace'] as const;
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
    && held.cleanScans === 2
    && [held.matrixSeedNamespace, held.screenSeedNamespace, held.confirmationSeedNamespace,
      held.queueRetestSeedNamespace].every((namespace) => typeof namespace === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(namespace))
    && new Set([held.matrixSeedNamespace, held.screenSeedNamespace, held.confirmationSeedNamespace,
      held.queueRetestSeedNamespace]).size === 4
    && Array.isArray(held.screenDepths) && held.screenDepths.length > 0
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
  matrixSeedNamespace?: string; screenSeedNamespace?: string; confirmationSeedNamespace?: string;
  queueRetestSeedNamespace?: string;
}): ThresholdRacingProtocol {
  const protocol = { experimentName: input.experimentName,
    protocolVersion: input.protocolVersion ?? THRESHOLD_RACING_PSRO_VERSION, runId: input.runId,
    kingdomId: input.kingdomId, reservoirCount: input.reservoirCount,
    sourceIdentityHash: input.sourceIdentityHash, checkpointNamespace: input.checkpointNamespace,
    threshold: RESPONSE_THRESHOLD, screenDepths: [...(input.screenDepths ?? SCREEN_DEPTHS)],
    screenAlpha: SCREEN_ALPHA, confirmationLooks: [...(input.confirmationLooks ?? CONFIRMATION_LOOKS)],
    confirmationFamilyAlpha: CONFIRMATION_FAMILY_ALPHA, matrixBlocks: PSRO_MATRIX_BLOCKS, cleanScans: 2,
    matrixSeedNamespace: input.matrixSeedNamespace ?? LEGACY_THRESHOLD_RACING_SEED_NAMESPACES.matrix,
    screenSeedNamespace: input.screenSeedNamespace ?? LEGACY_THRESHOLD_RACING_SEED_NAMESPACES.screen,
    confirmationSeedNamespace: input.confirmationSeedNamespace
      ?? LEGACY_THRESHOLD_RACING_SEED_NAMESPACES.confirmation,
    queueRetestSeedNamespace: input.queueRetestSeedNamespace
      ?? LEGACY_THRESHOLD_RACING_SEED_NAMESPACES.queueRetest };
  if (!validateThresholdRacingProtocol(protocol)) {
    throw new Error('Threshold-racing PSRO protocol input is invalid.');
  }
  return protocol;
}
export function thresholdRacingSeedLabel(protocol: ThresholdRacingProtocol | undefined,
  kind: 'screen' | 'confirmation' | 'queue-retest', label: string): string {
  if (!label || protocol !== undefined && !validateThresholdRacingProtocol(protocol)) {
    throw new Error('Threshold-racing seed label input is invalid.');
  }
  if (!protocol) return label;
  const namespace = kind === 'screen' ? protocol.screenSeedNamespace
    : kind === 'confirmation' ? protocol.confirmationSeedNamespace : protocol.queueRetestSeedNamespace;
  return `${namespace}:${label}`;
}

export function thresholdRacingProtocolHash(protocol: ThresholdRacingProtocol): string {
  if (!validateThresholdRacingProtocol(protocol)) throw new Error('Threshold-racing PSRO protocol is invalid.');
  return createHash('sha256').update(JSON.stringify(protocol)).digest('hex');
}

export interface CalibrationCandidateIdentity {
  goldfishRank: number;
  strategyId: string;
  canonicalStrategy: string;
}
export interface ThresholdDecision extends CalibrationCandidateIdentity {
  blocks: number; mean: number; interval: { lower: number; upper: number }; status: ThresholdStatus;
}
export interface ConfirmationDecision extends CalibrationCandidateIdentity {
  blocks: number; mean: number; interval: { lower: number; upper: number }; status: ConfirmationStatus;
}
export interface QueueOrder {
  orderedStrategyIds: string[]; strongestStrategyId: string | null; strongestTieIds: string[];
  strongestOverlapIds: string[];
}
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const SCHEDULE_KEYS = ['targetWeights', 'blocks', 'realizedOpponentCounts',
  'unsampledPositiveWeightStrategies'] as const;
export function candidateIdentitiesValid(ids: readonly string[], canonicals: readonly string[],
  kingdomId?: string): boolean {
  if (!ids.length || ids.length !== canonicals.length || new Set(ids).size !== ids.length
    || new Set(canonicals).size !== canonicals.length) return false;
  const space = kingdomId ? createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId)) : undefined;
  return ids.every((id, index) => {
    const canonical = canonicals[index];
    if (typeof id !== 'string' || typeof canonical !== 'string' || !canonical) return false;
    if (id === `sg-${stableHash(canonical)}`) return true;
    const match = /^gf-(\d+)$/.exec(id), number = match ? Number(match[1]) : Number.NaN;
    return Boolean(space && Number.isSafeInteger(number) && number >= 0 && number < space.candidateCount
      && canonicalStrategy(space.candidateAt(number)) === canonical);
  });
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
/** Largest deficit assigns each next block to the most under-served positive-weight opponent. */
export function weightedFairSchedule(weights: Readonly<Record<string, number>>, seeds: readonly number[],
  numericTieKeys?: Readonly<Record<string, number>>): MixtureSchedule {
  if (!seeds.length || new Set(seeds).size !== seeds.length
    || seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff)) {
    throw new Error('Weighted-fair schedule needs unique uint32 seeds.');
  }
  const positiveIds = Object.entries(weights).filter((entry) => entry[1] > 0).map(([id]) => id);
  if (numericTieKeys && (Object.keys(numericTieKeys).length !== positiveIds.length
    || positiveIds.some((id) => !Number.isSafeInteger(numericTieKeys[id]) || numericTieKeys[id]! < 0)
    || new Set(positiveIds.map((id) => numericTieKeys[id])).size !== positiveIds.length)) {
    throw new Error('Weighted-fair numeric tie keys must be unique nonnegative integers for each opponent.');
  }
  const entries = Object.entries(weights).filter((entry) => entry[1] > 0)
    .sort(([left], [right]) => numericTieKeys
      ? numericTieKeys[left]! - numericTieKeys[right]! : compareUtf16(left, right));
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  if (!entries.length || !(total > 0) || entries.some((entry) => !Number.isFinite(entry[1]))) {
    throw new Error('Weighted-fair schedule needs finite positive weight.');
  }
  const ids = entries.map(([id]) => id).sort(compareUtf16);
  const normalized = Object.fromEntries(entries.map(([id, weight]) => [id, weight / total]));
  const targetWeights = Object.fromEntries(ids.map((id) => [id, normalized[id]!]));
  const realizedOpponentCounts = Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>;
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
    unsampledPositiveWeightStrategies: ids.filter((id) => !realizedOpponentCounts[id]) };
  if (!validateMixtureSchedule(schedule)) throw new Error('Weighted-fair schedule is invalid.');
  return schedule;
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
export function classifyConfirmation(input: CalibrationCandidateIdentity, scores: readonly number[],
  alpha: number): ConfirmationDecision {
  return confirmationDecision(input, scores, anytimeConfidenceBounds(scores, alpha));
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
