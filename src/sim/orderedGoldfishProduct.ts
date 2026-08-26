import { createHash } from 'node:crypto';
import { compareUtf16 } from './utf16';
import { canonicalStrategy, identify, stableHash } from './strategy';
import type { Strategy } from './strategy';

export const ORDERED_PRODUCT_SCHEMA_VERSION = 1;
export const ORDERED_PRODUCT_KINGDOM = 'deep-beam-tuning-009';
export const ORDERED_PRODUCT_SPACE_COUNT = 12_972_960;
export const ORDERED_PRODUCT_SEEDS = [4_100_000, 4_100_001, 4_100_002, 4_100_003] as const;
export const ORDERED_PRODUCT_PROFILES = ['stationary', 'chaser', 'kiter'] as const;
export const ORDERED_PRODUCT_COLLISION_ALLOWANCE = 1_024;

export interface OrderedProductTarget {
  kingdomId: string;
  version: string;
  authorization: string;
  candidateProvenanceDigest: string;
}

const ORDERED_PRODUCT_TARGETS: Readonly<Record<string, OrderedProductTarget>> = Object.freeze({
  'deep-beam-tuning-001': Object.freeze({ kingdomId: 'deep-beam-tuning-001',
    version: 'k001-ordered-product-calibration-v1', authorization: 'k001-ordered-product-calibration-v1',
    candidateProvenanceDigest: '8a4759823fa' }),
  'deep-beam-tuning-007': Object.freeze({ kingdomId: 'deep-beam-tuning-007',
    version: 'k007-ordered-product-calibration-v1', authorization: 'k007-ordered-product-calibration-v1',
    candidateProvenanceDigest: '1573ad7d3fa' }),
  'deep-beam-tuning-008': Object.freeze({ kingdomId: 'deep-beam-tuning-008',
    version: 'k008-ordered-product-calibration-v1', authorization: 'k008-ordered-product-calibration-v1',
    candidateProvenanceDigest: '6561f88940b' }),
  [ORDERED_PRODUCT_KINGDOM]: Object.freeze({ kingdomId: ORDERED_PRODUCT_KINGDOM,
    version: 'k009-ordered-product-correction-v1', authorization: 'k009-ordered-product-correction-v1',
    candidateProvenanceDigest: '5ce8adb2409' })
});

export const ORDERED_PRODUCT_SUPPORTED_KINGDOMS = Object.freeze(Object.keys(ORDERED_PRODUCT_TARGETS));
export const ORDERED_PRODUCT_VERSION = ORDERED_PRODUCT_TARGETS[ORDERED_PRODUCT_KINGDOM]!.version;
export const ORDERED_PRODUCT_CANDIDATE_PROVENANCE_DIGEST =
  ORDERED_PRODUCT_TARGETS[ORDERED_PRODUCT_KINGDOM]!.candidateProvenanceDigest;

export function orderedProductTarget(kingdomId: string): OrderedProductTarget {
  const target = ORDERED_PRODUCT_TARGETS[kingdomId];
  if (!target) throw new Error(`Unsupported ordered product kingdom: ${kingdomId}`);
  return target;
}

export interface OrderedProductProfileEvidence {
  profile: string;
  trials: number;
  completions: number;
  penalizedTurnsTo50: number;
  damageArea: number;
  moneySpent: number;
}
export interface OrderedProductScoreEvidence {
  profiles: OrderedProductProfileEvidence[];
  worstCompletions: number;
  totalCompletions: number;
  worstPenalizedTurnsTo50: number;
  totalPenalizedTurnsTo50: number;
  worstDamageArea: number;
  totalDamageArea: number;
  totalMoneySpent: number;
}
export interface OrderedProductStageOneRecord {
  traversalPosition: number;
  displayId: string;
  canonicalStrategy: string;
  strategy: Strategy;
  stageOne: OrderedProductScoreEvidence;
  stageOneRankingKey: number[];
}
export interface OrderedProductRankedRecord extends OrderedProductStageOneRecord {
  additional: OrderedProductScoreEvidence;
  combined: OrderedProductScoreEvidence;
  combinedRankingKey: number[];
  stageOneRank: number;
  rank: number;
}
export interface OrderedProductShardProvenance {
  shardId: number;
  startPosition: number;
  endPosition: number;
  completeCount: number;
  retainedCount: number;
  candidateDigest: string;
  scoreDigest: string;
  contentDigest: string;
}
export interface OrderedProductConfig {
  kingdomId: string;
  candidateCount: number;
  retainedCount: number;
  reservoirCount: number;
  seeds: number[];
  profiles: string[];
  turnLimit: number;
  actionCapPerTurn: number;
  collisionAllowance: number;
}
export interface OrderedProductRankedArtifact {
  schemaVersion: number;
  version: string;
  runId: string;
  buildVersion: string;
  ruleFingerprint: string;
  scorerVersion: string;
  config: OrderedProductConfig;
  candidateSpace: {
    generator: string;
    traversal: string;
    cardIds: string[];
    quantityVectors: number[][];
    skeletonCount: number;
    candidateCount: number;
    strideSeed: number;
    offsetSeed: number;
    stride: number;
    offset: number;
    provenanceDigest: string;
  };
  stageOneShards: OrderedProductShardProvenance[];
  stageTwoShards: OrderedProductShardProvenance[];
  stageOneProvenanceDigest: string;
  stageTwoProvenanceDigest: string;
  records: OrderedProductRankedRecord[];
}
export interface OrderedProductReservoirArtifact {
  schemaVersion: number;
  version: string;
  sourceArtifactSha256: string;
  runId: string;
  reservoirCount: number;
  entries: OrderedProductRankedRecord[];
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function fixedJson(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
export function sha256Bytes(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function compactProfileEvidence(raw: unknown): OrderedProductScoreEvidence {
  if (!object(raw) || !Array.isArray(raw.profiles) || raw.profiles.length !== 3) {
    throw new Error('Native score is missing three-profile evidence.');
  }
  const profiles = raw.profiles.map((entry): OrderedProductProfileEvidence => {
    if (!object(entry) || typeof entry.profile !== 'string' || !object(entry.score)) {
      throw new Error('Native profile evidence is invalid.');
    }
    const score = entry.score;
    const values = ['trials', 'completions', 'penalizedTurnsTo50', 'damageArea', 'moneySpent'] as const;
    if (values.some((key) => !integer(score[key]))) throw new Error('Native profile metric is invalid.');
    return { profile: entry.profile, trials: score.trials as number,
      completions: score.completions as number, penalizedTurnsTo50: score.penalizedTurnsTo50 as number,
      damageArea: score.damageArea as number, moneySpent: score.moneySpent as number };
  });
  return deriveScoreEvidence(profiles);
}

export function deriveScoreEvidence(
  profiles: readonly OrderedProductProfileEvidence[]
): OrderedProductScoreEvidence {
  if (profiles.length !== ORDERED_PRODUCT_PROFILES.length
    || profiles.some((entry, index) => entry.profile !== ORDERED_PRODUCT_PROFILES[index]
      || !integer(entry.trials) || entry.trials < 1 || !integer(entry.completions)
      || entry.completions > entry.trials || !integer(entry.penalizedTurnsTo50)
      || !integer(entry.damageArea) || !integer(entry.moneySpent))) {
    throw new Error('Profile score evidence is invalid or out of order.');
  }
  return { profiles: profiles.map((entry) => ({ ...entry })),
    worstCompletions: Math.min(...profiles.map((entry) => entry.completions)),
    totalCompletions: profiles.reduce((sum, entry) => sum + entry.completions, 0),
    worstPenalizedTurnsTo50: Math.max(...profiles.map((entry) => entry.penalizedTurnsTo50)),
    totalPenalizedTurnsTo50: profiles.reduce((sum, entry) => sum + entry.penalizedTurnsTo50, 0),
    worstDamageArea: Math.min(...profiles.map((entry) => entry.damageArea)),
    totalDamageArea: profiles.reduce((sum, entry) => sum + entry.damageArea, 0),
    totalMoneySpent: profiles.reduce((sum, entry) => sum + entry.moneySpent, 0) };
}

export function combineScoreEvidence(
  first: OrderedProductScoreEvidence, additional: OrderedProductScoreEvidence
): OrderedProductScoreEvidence {
  return deriveScoreEvidence(first.profiles.map((entry, index) => {
    const right = additional.profiles[index]!;
    if (entry.profile !== right.profile) throw new Error('Profile evidence does not align.');
    return { profile: entry.profile, trials: entry.trials + right.trials,
      completions: entry.completions + right.completions,
      penalizedTurnsTo50: entry.penalizedTurnsTo50 + right.penalizedTurnsTo50,
      damageArea: entry.damageArea + right.damageArea, moneySpent: entry.moneySpent + right.moneySpent };
  }));
}

export function rankingKey(evidence: OrderedProductScoreEvidence): number[] {
  return [evidence.worstCompletions, evidence.totalCompletions, evidence.worstPenalizedTurnsTo50,
    evidence.totalPenalizedTurnsTo50, evidence.worstDamageArea, evidence.totalDamageArea,
    evidence.totalMoneySpent];
}
export function compareEvidence(left: OrderedProductScoreEvidence, right: OrderedProductScoreEvidence): number {
  return right.worstCompletions - left.worstCompletions
    || right.totalCompletions - left.totalCompletions
    || left.worstPenalizedTurnsTo50 - right.worstPenalizedTurnsTo50
    || left.totalPenalizedTurnsTo50 - right.totalPenalizedTurnsTo50
    || right.worstDamageArea - left.worstDamageArea
    || right.totalDamageArea - left.totalDamageArea
    || right.totalMoneySpent - left.totalMoneySpent;
}
export function compareStageOneRecords(left: OrderedProductStageOneRecord, right: OrderedProductStageOneRecord): number {
  return compareEvidence(left.stageOne, right.stageOne) || compareUtf16(left.displayId, right.displayId)
    || compareUtf16(left.canonicalStrategy, right.canonicalStrategy)
    || left.traversalPosition - right.traversalPosition;
}
export function compareRankedRecords(left: OrderedProductRankedRecord, right: OrderedProductRankedRecord): number {
  return compareEvidence(left.combined, right.combined) || compareUtf16(left.displayId, right.displayId)
    || compareUtf16(left.canonicalStrategy, right.canonicalStrategy)
    || left.traversalPosition - right.traversalPosition;
}

function identityValid(record: OrderedProductStageOneRecord): boolean {
  return integer(record.traversalPosition) && record.displayId === record.strategy.id
    && canonicalStrategy(record.strategy) === record.canonicalStrategy
    && identify({ ...record.strategy, id: '' }).id === record.displayId;
}
function evidenceValid(evidence: OrderedProductScoreEvidence): boolean {
  try { return JSON.stringify(deriveScoreEvidence(evidence.profiles)) === JSON.stringify(evidence); }
  catch { return false; }
}
export function validateOrderedProductStageOneRecord(record: OrderedProductStageOneRecord): boolean {
  return identityValid(record) && evidenceValid(record.stageOne)
    && JSON.stringify(record.stageOneRankingKey) === JSON.stringify(rankingKey(record.stageOne));
}
export function validateOrderedProductRankedRecord(record: OrderedProductRankedRecord): boolean {
  return validateOrderedProductStageOneRecord(record) && evidenceValid(record.additional)
    && evidenceValid(record.combined)
    && JSON.stringify(combineScoreEvidence(record.stageOne, record.additional)) === JSON.stringify(record.combined)
    && JSON.stringify(record.combinedRankingKey) === JSON.stringify(rankingKey(record.combined));
}

export function candidateSpaceProvenanceDigest(space: OrderedProductRankedArtifact['candidateSpace']): string {
  return stableHash(JSON.stringify({ generator: space.generator, traversal: space.traversal,
    cardIds: space.cardIds, quantityVectors: space.quantityVectors, skeletonCount: space.skeletonCount,
    candidateCount: space.candidateCount, strideSeed: space.strideSeed, offsetSeed: space.offsetSeed,
    stride: space.stride, offset: space.offset }));
}

export function retainOrderedProductRecords(
  records: readonly OrderedProductStageOneRecord[], count: number, collisionAllowance: number
): OrderedProductStageOneRecord[] {
  if (!integer(count) || count < 1 || !integer(collisionAllowance)) throw new Error('Invalid retention bound.');
  const canonicalSeen = new Set<string>();
  const displaySeen = new Set<string>();
  return [...records].sort(compareStageOneRecords).filter((entry) => {
    if (canonicalSeen.has(entry.canonicalStrategy) || displaySeen.has(entry.displayId)) return false;
    canonicalSeen.add(entry.canonicalStrategy); displaySeen.add(entry.displayId); return true;
  }).slice(0, count + collisionAllowance);
}

export function provenanceDigest(shards: readonly OrderedProductShardProvenance[]): string {
  return stableHash(shards.map((entry) => [entry.shardId, entry.startPosition, entry.endPosition,
    entry.completeCount, entry.retainedCount, entry.candidateDigest, entry.scoreDigest,
    entry.contentDigest].join('\t')).join('\n'));
}

function validConfig(config: OrderedProductConfig, target: OrderedProductTarget): boolean {
  return config.kingdomId === target.kingdomId && config.candidateCount === ORDERED_PRODUCT_SPACE_COUNT
    && integer(config.retainedCount) && config.retainedCount >= 1
    && integer(config.reservoirCount) && config.reservoirCount >= 1
    && config.reservoirCount <= config.retainedCount
    && JSON.stringify(config.seeds) === JSON.stringify(ORDERED_PRODUCT_SEEDS)
    && JSON.stringify(config.profiles) === JSON.stringify(ORDERED_PRODUCT_PROFILES)
    && config.turnLimit === 30 && config.actionCapPerTurn === 200
    && config.collisionAllowance === ORDERED_PRODUCT_COLLISION_ALLOWANCE;
}
function validShards(shards: readonly OrderedProductShardProvenance[], total: number): boolean {
  if (!shards.length || shards[0]!.startPosition !== 0 || shards.at(-1)!.endPosition !== total) return false;
  return shards.every((entry, index) => entry.shardId === index && integer(entry.startPosition)
    && integer(entry.endPosition) && entry.endPosition >= entry.startPosition
    && entry.completeCount === entry.endPosition - entry.startPosition
    && integer(entry.retainedCount) && entry.retainedCount <= entry.completeCount
    && /^[0-9a-f]{9,}$/.test(entry.candidateDigest) && /^[0-9a-f]{9,}$/.test(entry.scoreDigest)
    && /^[0-9a-f]{9,}$/.test(entry.contentDigest)
    && (index === 0 || shards[index - 1]!.endPosition === entry.startPosition));
}

export function validateOrderedProductArtifact(value: unknown): value is OrderedProductRankedArtifact {
  if (!object(value)) return false;
  const artifact = value as unknown as OrderedProductRankedArtifact;
  let target: OrderedProductTarget;
  try { target = orderedProductTarget(artifact.config?.kingdomId); } catch { return false; }
  if (artifact.schemaVersion !== ORDERED_PRODUCT_SCHEMA_VERSION || artifact.version !== target.version
    || typeof artifact.runId !== 'string' || !artifact.runId || typeof artifact.buildVersion !== 'string'
    || typeof artifact.ruleFingerprint !== 'string' || typeof artifact.scorerVersion !== 'string'
    || !validConfig(artifact.config, target) || !object(artifact.candidateSpace)
    || artifact.candidateSpace.generator !== 'ordered-typescript-five-rung-v1'
    || artifact.candidateSpace.traversal !== 'coprime-position-v1'
    || artifact.candidateSpace.candidateCount !== ORDERED_PRODUCT_SPACE_COUNT
    || artifact.candidateSpace.provenanceDigest !== target.candidateProvenanceDigest
    || artifact.candidateSpace.provenanceDigest !== candidateSpaceProvenanceDigest(artifact.candidateSpace)
    || !Array.isArray(artifact.records) || artifact.records.length !== artifact.config.retainedCount
    || !Array.isArray(artifact.stageOneShards) || !Array.isArray(artifact.stageTwoShards)
    || !validShards(artifact.stageOneShards, ORDERED_PRODUCT_SPACE_COUNT)
    || !validShards(artifact.stageTwoShards, artifact.config.retainedCount)
    || provenanceDigest(artifact.stageOneShards) !== artifact.stageOneProvenanceDigest
    || provenanceDigest(artifact.stageTwoShards) !== artifact.stageTwoProvenanceDigest) return false;
  const stageOneOrder = [...artifact.records].sort(compareStageOneRecords);
  const stageOneRank = new Map(stageOneOrder.map((entry, index) => [entry.canonicalStrategy, index + 1]));
  const displayIds = new Set<string>();
  const canonicalStrategies = new Set<string>();
  for (let index = 0; index < artifact.records.length; index += 1) {
    const entry = artifact.records[index]!;
    if (!validateOrderedProductRankedRecord(entry)
      || entry.stageOneRank !== stageOneRank.get(entry.canonicalStrategy) || entry.rank !== index + 1
      || (index > 0 && compareRankedRecords(artifact.records[index - 1]!, entry) > 0)
      || displayIds.has(entry.displayId) || canonicalStrategies.has(entry.canonicalStrategy)) return false;
    displayIds.add(entry.displayId); canonicalStrategies.add(entry.canonicalStrategy);
  }
  return true;
}

export function buildOrderedProductReservoir(
  artifact: OrderedProductRankedArtifact, sourceArtifactSha256: string
): OrderedProductReservoirArtifact {
  if (!validateOrderedProductArtifact(artifact) || !/^[0-9a-f]{64}$/.test(sourceArtifactSha256)) {
    throw new Error('Ranked artifact is invalid.');
  }
  return { schemaVersion: ORDERED_PRODUCT_SCHEMA_VERSION, version: artifact.version,
    sourceArtifactSha256, runId: artifact.runId, reservoirCount: artifact.config.reservoirCount,
    entries: artifact.records.slice(0, artifact.config.reservoirCount) };
}
export function validateOrderedProductReservoir(
  value: unknown, artifact: OrderedProductRankedArtifact, sourceArtifactSha256: string
): value is OrderedProductReservoirArtifact {
  if (!object(value)) return false;
  const reservoir = value as unknown as OrderedProductReservoirArtifact;
  if (reservoir.schemaVersion !== ORDERED_PRODUCT_SCHEMA_VERSION || reservoir.version !== artifact.version
    || reservoir.runId !== artifact.runId || reservoir.sourceArtifactSha256 !== sourceArtifactSha256
    || reservoir.reservoirCount !== artifact.config.reservoirCount || !Array.isArray(reservoir.entries)
    || reservoir.entries.length !== artifact.config.reservoirCount) return false;
  return JSON.stringify(reservoir.entries) === JSON.stringify(artifact.records.slice(0, artifact.config.reservoirCount));
}
