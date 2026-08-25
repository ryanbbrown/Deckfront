import { nativeRuleFingerprint } from './nativeGoldfishProtocol';
import {
  FIXED_RESERVOIR_CONFIG, FIXED_RESERVOIR_VERSION, reservoirHash,
  validateFixedReservoirPool
} from './fixedReservoirPsro';
import type {
  FixedReservoirPoolArtifact, FixedReservoirProtocol, ReservoirConfirmedCandidate, ReservoirEntry
} from './fixedReservoirPsro';
import {
  ORDERED_PRODUCT_KINGDOM, ORDERED_PRODUCT_SCHEMA_VERSION, ORDERED_PRODUCT_SEEDS,
  ORDERED_PRODUCT_SPACE_COUNT, ORDERED_PRODUCT_VERSION, validateOrderedProductRankedRecord
} from './orderedGoldfishProduct';
import type {
  OrderedProductRankedRecord, OrderedProductReservoirArtifact,
  OrderedProductShardProvenance
} from './orderedGoldfishProduct';
import type { BootstrapInterval } from './mixtureEvaluation';
import { percentileBootstrapMean } from './mixtureEvaluation';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';

export const ORDERED_RESERVOIR_CHALLENGE_VERSION = 'ordered-reservoir-challenge-v1';
export const ORDERED_RESERVOIR_RUN_ID = 'native-e760135dba6f-5625a0ff0bf6048653f9';
export const ORDERED_RESERVOIR_SOURCE = `.experiments/ordered-goldfish-product/${ORDERED_RESERVOIR_RUN_ID}`;
export const ORDERED_RESERVOIR_OUTPUT = `.experiments/ordered-reservoir-challenge/${ORDERED_RESERVOIR_CHALLENGE_VERSION}`;
export const ORDERED_RESERVOIR_HISTORICAL_ROOT =
  '.experiments/fixed-reservoir-psro-five-run/fixed-reservoir-five-run-v1/deep-beam-tuning-009';
export const ORDERED_RESERVOIR_EVALUATION_SEED = 9_100_009;
export const ORDERED_RESERVOIR_COMPARISON_SEED = 9_200_009;
export const ORDERED_RESERVOIR_CROSS_PLAY_BLOCKS = 200;
export const ORDERED_RESERVOIR_HISTORICAL_SEEDS = [1, 2, 3, 4, 5] as const;

export const ORDERED_RESERVOIR_ONE_ROUND_PROTOCOL: Readonly<FixedReservoirProtocol> = Object.freeze({
  ...FIXED_RESERVOIR_CONFIG,
  generatedCount: ORDERED_PRODUCT_SPACE_COUNT,
  goldfishCount: 20_000,
  randomCount: 0,
  safetyCap: 1
});

export interface OrderedRankedManifestHeader {
  schemaVersion: number;
  version: string;
  runId: string;
  buildVersion: string;
  ruleFingerprint: string;
  scorerVersion: string;
  config: {
    kingdomId: string;
    candidateCount: number;
    retainedCount: number;
    reservoirCount: number;
    seeds: number[];
    profiles: string[];
    turnLimit: number;
    actionCapPerTurn: number;
    collisionAllowance: number;
  };
  candidateSpace: { provenanceDigest: string };
  stageOneShards: OrderedProductShardProvenance[];
  recordCount: number;
}

export interface ValidatedOrderedReservoirInput {
  manifest: OrderedRankedManifestHeader;
  reservoir: OrderedProductReservoirArtifact;
  rankedSha256: string;
  reservoirSha256: string;
}

export interface OrderedChallengePoolArtifact extends FixedReservoirPoolArtifact {
  source: {
    validation: 'goldfish:ordered-product validate-reservoir';
    runId: string;
    rankedSha256: string;
    reservoirSha256: string;
    buildVersion: string;
    ruleFingerprint: string;
  };
}

function validSha256(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }

function adaptedScore(entry: OrderedProductRankedRecord): ReservoirEntry['score'] {
  return {
    worstCompletions: entry.combined.worstCompletions,
    totalCompletions: entry.combined.totalCompletions,
    worstPenalizedTurnsTo50: entry.combined.worstPenalizedTurnsTo50,
    totalPenalizedTurnsTo50: entry.combined.totalPenalizedTurnsTo50,
    worstDamageArea: entry.combined.worstDamageArea,
    totalDamageArea: entry.combined.totalDamageArea
  };
}

/** Adapts bytes only after the ordered-product CLI has validated the ranked artifact and its prefix. */
export function adaptValidatedOrderedReservoir(input: ValidatedOrderedReservoirInput): OrderedChallengePoolArtifact {
  const { manifest, reservoir } = input;
  if (!validSha256(input.rankedSha256) || !validSha256(input.reservoirSha256)
    || manifest.schemaVersion !== ORDERED_PRODUCT_SCHEMA_VERSION
    || manifest.version !== ORDERED_PRODUCT_VERSION
    || manifest.runId !== ORDERED_RESERVOIR_RUN_ID
    || manifest.config.kingdomId !== ORDERED_PRODUCT_KINGDOM
    || manifest.config.candidateCount !== ORDERED_PRODUCT_SPACE_COUNT
    || manifest.recordCount !== manifest.config.retainedCount
    || manifest.config.reservoirCount !== 20_000
    || JSON.stringify(manifest.config.seeds) !== JSON.stringify(ORDERED_PRODUCT_SEEDS)
    || manifest.config.turnLimit !== 30 || manifest.config.actionCapPerTurn !== 200
    || manifest.ruleFingerprint !== nativeRuleFingerprint(ORDERED_PRODUCT_KINGDOM, 30, 200)
    || reservoir.schemaVersion !== ORDERED_PRODUCT_SCHEMA_VERSION
    || reservoir.version !== ORDERED_PRODUCT_VERSION
    || reservoir.runId !== manifest.runId
    || reservoir.sourceArtifactSha256 !== input.rankedSha256
    || reservoir.reservoirCount !== 20_000 || reservoir.entries.length !== 20_000
    || !manifest.stageOneShards.length) {
    throw new Error('Validated ordered reservoir metadata does not match the final Kingdom 009 product.');
  }
  const entries = adaptOrderedReservoirEntries(reservoir.entries);
  const artifact: OrderedChallengePoolArtifact = {
    schemaVersion: 2,
    experiment: 'fixed-reservoir-pool',
    version: FIXED_RESERVOIR_VERSION,
    kingdomId: ORDERED_PRODUCT_KINGDOM,
    poolSeed: 0,
    goldfishSeeds: [...ORDERED_PRODUCT_SEEDS],
    generatedCount: ORDERED_PRODUCT_SPACE_COUNT,
    generatedHash: stableHash(`${input.rankedSha256}:${input.reservoirSha256}`),
    canonicalProvenanceDigest: manifest.candidateSpace.provenanceDigest,
    duplicateCanonicalCount: 0,
    displayIdCollisionCount: 0,
    scoringProtocol: 'native-ordered-four-seed-ranked-prefix-v1',
    shardProvenance: manifest.stageOneShards.map((shard) => ({
      shardId: String(shard.shardId), startPosition: shard.startPosition,
      endPosition: shard.endPosition, candidateDigest: shard.candidateDigest, scoreDigest: shard.scoreDigest
    })),
    reservoirHash: reservoirHash(entries),
    reservoir: entries,
    elapsedMs: 0,
    source: {
      validation: 'goldfish:ordered-product validate-reservoir',
      runId: manifest.runId,
      rankedSha256: input.rankedSha256,
      reservoirSha256: input.reservoirSha256,
      buildVersion: manifest.buildVersion,
      ruleFingerprint: manifest.ruleFingerprint
    }
  };
  if (!validateOrderedChallengePool(artifact)) throw new Error('Ordered reservoir adaptation is invalid.');
  return artifact;
}

export function adaptOrderedReservoirEntries(
  records: readonly OrderedProductRankedRecord[]
): ReservoirEntry[] {
  const canonical = new Set<string>();
  const ids = new Set<string>();
  return records.map((entry, index): ReservoirEntry => {
    if (!validateOrderedProductRankedRecord(entry) || entry.rank !== index + 1
      || ids.has(entry.strategy.id) || canonical.has(entry.canonicalStrategy)) {
      throw new Error(`Ordered reservoir entry ${index + 1} is invalid, duplicated, or out of rank order.`);
    }
    ids.add(entry.strategy.id); canonical.add(entry.canonicalStrategy);
    return { strategy: entry.strategy, source: 'goldfish', goldfishRank: index + 1, score: adaptedScore(entry) };
  });
}

export function validateOrderedChallengePool(value: unknown): value is OrderedChallengePoolArtifact {
  if (!validateFixedReservoirPool(value, {
    kingdomId: ORDERED_PRODUCT_KINGDOM,
    poolSeed: 0,
    generatedCount: ORDERED_PRODUCT_SPACE_COUNT,
    goldfishCount: 20_000,
    randomCount: 0,
    goldfishSeeds: ORDERED_PRODUCT_SEEDS
  })) return false;
  const pool = value as OrderedChallengePoolArtifact;
  return pool.source?.validation === 'goldfish:ordered-product validate-reservoir'
    && pool.source.runId === ORDERED_RESERVOIR_RUN_ID
    && validSha256(pool.source.rankedSha256) && validSha256(pool.source.reservoirSha256)
    && pool.generatedHash === stableHash(`${pool.source.rankedSha256}:${pool.source.reservoirSha256}`)
    && pool.reservoir.every((entry, index) => entry.source === 'goldfish' && entry.goldfishRank === index + 1);
}

export interface OneRoundAssessment {
  status: 'one-round-clear' | 'incomplete-admissions';
  complete: false;
  admittedStrategyIds: string[];
  message: string;
}

export function assessOneRound(result: {
  rounds: ReadonlyArray<{ round: number; admittedStrategyIds: readonly string[] }>;
}): OneRoundAssessment {
  if (result.rounds.length !== 1 || result.rounds[0]?.round !== 0) {
    throw new Error(`Ordered reservoir challenge must run exactly one response round, not ${result.rounds.length}.`);
  }
  const admittedStrategyIds = [...result.rounds[0].admittedStrategyIds];
  if (admittedStrategyIds.length) return {
    status: 'incomplete-admissions', complete: false, admittedStrategyIds,
    message: `${admittedStrategyIds.length} strategies were admitted. The one-round lottery is incomplete and is not a convergence result.`
  };
  return { status: 'one-round-clear', complete: false, admittedStrategyIds,
    message: 'The only response round admitted no strategy. This is a one-round screen, not a convergence result.' };
}

export interface WeightedBlockEvidence {
  strategyId: string;
  weight: number;
  blockScores: number[];
  matches: number;
}
export interface LotteryDirectionEvidence {
  score: number;
  interval95: BootstrapInterval;
  blockScores: number[];
  blocks: number;
  matches: number;
}

/** Combines complete row-strategy results into one whole-lottery score without sampling either support. */
export function wholeLotteryEvidence(
  rows: readonly WeightedBlockEvidence[], bootstrapSeed: number
): LotteryDirectionEvidence {
  const positive = rows.filter((entry) => entry.weight > 0);
  const totalWeight = positive.reduce((sum, entry) => sum + entry.weight, 0);
  const blocks = positive[0]?.blockScores.length ?? 0;
  if (!(totalWeight > 0) || blocks < 1
    || positive.some((entry) => entry.blockScores.length !== blocks
      || entry.blockScores.some((score) => !Number.isFinite(score) || score < 0 || score > 1))) {
    throw new Error('Whole-lottery evidence needs aligned finite block scores and positive row weight.');
  }
  const blockScores = Array.from({ length: blocks }, (_unused, index) => positive.reduce((sum, entry) =>
    sum + entry.blockScores[index]! * entry.weight / totalWeight, 0));
  return { score: blockScores.reduce((sum, score) => sum + score, 0) / blocks,
    interval95: percentileBootstrapMean(blockScores, bootstrapSeed), blockScores, blocks,
    matches: positive.reduce((sum, entry) => sum + entry.matches, 0) };
}

export interface AttackSummary {
  scannedCount: number;
  finalists: ReservoirConfirmedCandidate[];
  exploitStrategyIds: string[];
  best: ReservoirConfirmedCandidate | null;
}
export function summarizeAttack(
  scannedCount: number, finalists: readonly ReservoirConfirmedCandidate[], threshold = 0.5
): AttackSummary {
  const ordered = [...finalists].sort((left, right) => right.interval95.lower - left.interval95.lower
    || right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
  return { scannedCount, finalists: [...finalists],
    exploitStrategyIds: finalists.filter((entry) => entry.interval95.lower > threshold)
      .map((entry) => entry.strategy.id), best: ordered[0] ?? null };
}

export interface OrderedHistoricalComparison {
  historicalPoolSeed: number;
  orderedAsRow: LotteryDirectionEvidence;
  historicalAsRow: LotteryDirectionEvidence;
  orderedAttack: AttackSummary;
  historicalAttack: AttackSummary;
}
export interface AggregateComparison {
  orderedScores: number[];
  meanOrderedScore: number;
  minimumOrderedScore: number;
  maximumOrderedScore: number;
  orderedExploitCount: number;
  historicalExploitCount: number;
  assessment: 'ordered-stronger' | 'historical-stronger' | 'similar-or-unresolved';
}

export function aggregateComparisons(comparisons: readonly OrderedHistoricalComparison[]): AggregateComparison {
  if (!comparisons.length) throw new Error('At least one historical comparison is required.');
  const orderedScores = comparisons.flatMap((entry) => [entry.orderedAsRow.score, 1 - entry.historicalAsRow.score]);
  const orderedExploitCount = comparisons.reduce((sum, entry) => sum + entry.orderedAttack.exploitStrategyIds.length, 0);
  const historicalExploitCount = comparisons.reduce((sum, entry) => sum + entry.historicalAttack.exploitStrategyIds.length, 0);
  const orderedWins = comparisons.every((entry) => entry.orderedAsRow.interval95.lower > 0.5
    && entry.historicalAsRow.interval95.upper < 0.5);
  const historicalWins = comparisons.every((entry) => entry.orderedAsRow.interval95.upper < 0.5
    && entry.historicalAsRow.interval95.lower > 0.5);
  return { orderedScores,
    meanOrderedScore: orderedScores.reduce((sum, score) => sum + score, 0) / orderedScores.length,
    minimumOrderedScore: Math.min(...orderedScores), maximumOrderedScore: Math.max(...orderedScores),
    orderedExploitCount, historicalExploitCount,
    assessment: orderedWins ? 'ordered-stronger' : historicalWins ? 'historical-stronger' : 'similar-or-unresolved' };
}

export function canonicalOverlap(left: readonly Strategy[], right: readonly Strategy[]): number {
  const forms = new Set(left.map(canonicalStrategy));
  return right.reduce((sum, strategy) => sum + Number(forms.has(canonicalStrategy(strategy))), 0);
}

