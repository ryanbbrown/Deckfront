import type { PairingRunner } from './pairingRunner';
import {
  FIXED_RESERVOIR_VERSION, reservoirHash, runFixedReservoirPsro,
  validateFixedReservoirPsroArtifact
} from './fixedReservoirPsro';
import type {
  FixedReservoirPoolArtifact, FixedReservoirProtocol, FixedReservoirPsroArtifact, ReservoirEntry
} from './fixedReservoirPsro';
import {
  GOLDFISH_MOVEMENT_PROFILES, compareMovementAwareGoldfishScores, mergeMovementAwareGoldfishScores
} from './goldfish';
import type { MovementAwareGoldfishScore } from './goldfish';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export const STAGED_GOLDFISH_VERSION = 'staged-goldfish-ab-v2';

export type ReservoirScoreSummary = Pick<MovementAwareGoldfishScore,
  'worstCompletions' | 'totalCompletions' | 'worstPenalizedTurnsTo50' |
  'totalPenalizedTurnsTo50' | 'worstDamageArea' | 'totalDamageArea'>;

export interface StagedGoldfishReservoirEntry {
  strategy: Strategy;
  source: 'goldfish';
  stageOneGoldfishRank: number;
  fourSeedGoldfishRank: number;
  scoreProvenance: 'combined-four-seed';
  score: ReservoirScoreSummary;
}

export interface StagedRandomReservoirEntry {
  strategy: Strategy;
  source: 'random';
  randomTailRank: number;
  stageOneGoldfishRank: number | null;
  scoreProvenance: 'stage-one-only';
  stageOneScore: ReservoirScoreSummary;
}

export type StagedReservoirEntry = StagedGoldfishReservoirEntry | StagedRandomReservoirEntry;

export interface StagedFixedReservoirPoolArtifact {
  schemaVersion: 2;
  experiment: 'staged-fixed-reservoir-pool';
  version: typeof STAGED_GOLDFISH_VERSION;
  kingdomId: string;
  poolSeed: number;
  goldfishSeeds: number[];
  generatedCount: number;
  generatedHash: string;
  canonicalProvenanceDigest: string;
  duplicateCanonicalCount: number;
  displayIdCollisionCount: number;
  scoringProtocol: string;
  shardProvenance: Array<{ shardId: string; startPosition: number; endPosition: number;
    candidateDigest: string; scoreDigest: string }>;
  prefilterCount: number;
  scoring: {
    profiles: string[];
    combination: 'disjoint-seed-sum-v1';
    stageOne: { seeds: number[]; scoredCount: number; elapsedMs: number };
    rescore: { seeds: number[]; scoredCount: number; elapsedMs: number };
  };
  reservoirHash: string;
  reservoir: StagedReservoirEntry[];
  elapsedMs: number;
}

export interface StagedFixedReservoirPsroArtifact extends Omit<FixedReservoirPsroArtifact,
  'experiment' | 'version' | 'reservoir'> {
  experiment: 'staged-fixed-reservoir-psro';
  version: typeof STAGED_GOLDFISH_VERSION;
  reservoir: StagedReservoirEntry[];
  poolScoring: StagedFixedReservoirPoolArtifact['scoring'];
}

function scoreSummary(score: MovementAwareGoldfishScore): ReservoirScoreSummary {
  return { worstCompletions: score.worstCompletions, totalCompletions: score.totalCompletions,
    worstPenalizedTurnsTo50: score.worstPenalizedTurnsTo50,
    totalPenalizedTurnsTo50: score.totalPenalizedTurnsTo50,
    worstDamageArea: score.worstDamageArea, totalDamageArea: score.totalDamageArea };
}

function tailRank(id: string, seed: number): number {
  return Number.parseInt(stableHash(`reservoir-tail:${seed}:${id}`).slice(0, 8), 16) >>> 0;
}

export interface StageOneRankedScore {
  score: MovementAwareGoldfishScore;
  stageOneGoldfishRank: number | null;
}

export function selectStagedReservoirFromMergedEvidence(
  prefilter: readonly StageOneRankedScore[],
  combinedLeaders: readonly MovementAwareGoldfishScore[],
  tailCandidates: readonly StageOneRankedScore[],
  goldfishCount: number,
  randomCount: number
): StagedReservoirEntry[] {
  if (goldfishCount < 1 || randomCount < 1 || prefilter.length < goldfishCount
    || combinedLeaders.length !== goldfishCount || tailCandidates.length < goldfishCount + randomCount) {
    throw new Error('Staged reservoir cohort sizes are invalid.');
  }
  const stageOneRank = new Map(prefilter.map((entry) => [entry.score.strategy.id, entry.stageOneGoldfishRank]));
  if (stageOneRank.size !== prefilter.length || [...stageOneRank.values()].some((rank) => rank === null)
    || combinedLeaders.some((entry) => !stageOneRank.has(entry.strategy.id))) {
    throw new Error('Merged leaders must be unique prefilter survivors with exact stage-one ranks.');
  }
  const orderedLeaders = [...combinedLeaders].sort(compareMovementAwareGoldfishScores);
  if (orderedLeaders.some((entry, index) => entry.strategy.id !== combinedLeaders[index]!.strategy.id)) {
    throw new Error('Merged leaders are not in global score order.');
  }
  const goldfish: StagedGoldfishReservoirEntry[] = combinedLeaders.map((entry, index) => ({
    strategy: entry.strategy, source: 'goldfish',
    stageOneGoldfishRank: stageOneRank.get(entry.strategy.id) as number,
    fourSeedGoldfishRank: index + 1, scoreProvenance: 'combined-four-seed', score: scoreSummary(entry)
  }));
  const goldfishIds = new Set(goldfish.map((entry) => entry.strategy.id));
  const tail = tailCandidates.filter((entry) => !goldfishIds.has(entry.score.strategy.id)).slice(0, randomCount);
  if (tail.length !== randomCount || new Set(tail.map((entry) => entry.score.strategy.id)).size !== tail.length) {
    throw new Error('Stage-one tail evidence cannot fill the random cohort.');
  }
  const random = tail.map((entry, index): StagedRandomReservoirEntry => ({ strategy: entry.score.strategy,
    source: 'random', randomTailRank: index + 1, stageOneGoldfishRank: entry.stageOneGoldfishRank,
    scoreProvenance: 'stage-one-only', stageOneScore: scoreSummary(entry.score) }));
  return [...goldfish, ...random];
}

export function selectStagedReservoirFromEvidence(
  prefilter: readonly StageOneRankedScore[],
  remainingSeedScores: readonly MovementAwareGoldfishScore[],
  tailCandidates: readonly StageOneRankedScore[],
  goldfishCount: number,
  randomCount: number
): StagedReservoirEntry[] {
  const prefilterIds = new Set(prefilter.map((entry) => entry.score.strategy.id));
  const rescoreById = new Map(remainingSeedScores.map((entry) => [entry.strategy.id, entry]));
  if (prefilterIds.size !== prefilter.length || rescoreById.size !== remainingSeedScores.length
    || remainingSeedScores.length !== prefilter.length
    || remainingSeedScores.some((entry) => !prefilterIds.has(entry.strategy.id))) {
    throw new Error('Rescore evidence must contain exactly the prefilter survivors.');
  }
  const combined = prefilter.map((entry) => mergeMovementAwareGoldfishScores([
    entry.score, rescoreById.get(entry.score.strategy.id)!
  ])).sort(compareMovementAwareGoldfishScores).slice(0, goldfishCount);
  return selectStagedReservoirFromMergedEvidence(prefilter, combined, tailCandidates,
    goldfishCount, randomCount);
}

export function selectStagedReservoir(
  stageOneScores: readonly MovementAwareGoldfishScore[],
  remainingSeedScores: readonly MovementAwareGoldfishScore[],
  prefilterCount: number,
  goldfishCount: number,
  randomCount: number,
  tailSeed: number
): StagedReservoirEntry[] {
  if (stageOneScores.length < prefilterCount + randomCount) {
    throw new Error('Staged reservoir cohort sizes are invalid.');
  }
  const heldIds = new Set<string>();
  const rankedStageOne = [...stageOneScores].sort(compareMovementAwareGoldfishScores).filter((entry) => {
    if (heldIds.has(entry.strategy.id)) return false;
    heldIds.add(entry.strategy.id); return true;
  });
  if (rankedStageOne.length < prefilterCount + randomCount) {
    throw new Error('Display-ID collisions exhausted the staged reservoir.');
  }
  const stageOneRank = new Map(rankedStageOne.map((entry, index) => [entry.strategy.id, index + 1]));
  const ranked = (score: MovementAwareGoldfishScore): StageOneRankedScore => ({
    score, stageOneGoldfishRank: stageOneRank.get(score.strategy.id) ?? null
  });
  const tailCandidates = [...rankedStageOne].sort((left, right) =>
    tailRank(left.strategy.id, tailSeed) - tailRank(right.strategy.id, tailSeed)
      || compareUtf16(left.strategy.id, right.strategy.id)
      || compareUtf16(canonicalStrategy(left.strategy), canonicalStrategy(right.strategy)))
    .slice(0, goldfishCount + randomCount).map(ranked);
  return selectStagedReservoirFromEvidence(rankedStageOne.slice(0, prefilterCount).map(ranked),
    remainingSeedScores, tailCandidates, goldfishCount, randomCount);
}

export interface StagedPoolExpectation {
  kingdomId?: string;
  poolSeed?: number;
  generatedCount?: number;
  prefilterCount?: number;
  goldfishCount?: number;
  randomCount?: number;
  goldfishSeeds?: readonly number[];
}

function validSummary(value: unknown): value is ReservoirScoreSummary {
  if (!value || typeof value !== 'object') return false;
  return ['worstCompletions', 'totalCompletions', 'worstPenalizedTurnsTo50',
    'totalPenalizedTurnsTo50', 'worstDamageArea', 'totalDamageArea']
    .every((key) => Number.isFinite((value as Record<string, unknown>)[key]));
}

export function stagedReservoirHash(entries: readonly StagedReservoirEntry[]): string {
  return stableHash(entries.map((entry) => `${entry.source}:${canonicalStrategy(entry.strategy)}`).join('\n'));
}

function validateStagedFixedReservoirPoolUnchecked(
  value: unknown, expected: StagedPoolExpectation
): value is StagedFixedReservoirPoolArtifact {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<StagedFixedReservoirPoolArtifact>;
  if (artifact.schemaVersion !== 2 || artifact.experiment !== 'staged-fixed-reservoir-pool'
    || artifact.version !== STAGED_GOLDFISH_VERSION
    || !Array.isArray(artifact.goldfishSeeds) || !Array.isArray(artifact.reservoir)
    || !Array.isArray(artifact.shardProvenance) || !artifact.scoring
    || !Number.isSafeInteger(artifact.generatedCount) || artifact.generatedCount! < artifact.reservoir.length
    || typeof artifact.generatedHash !== 'string' || !/^[0-9a-f]{9,}$/.test(artifact.generatedHash)
    || typeof artifact.canonicalProvenanceDigest !== 'string'
      || !/^[0-9a-f]{9,}$/.test(artifact.canonicalProvenanceDigest)
    || !Number.isSafeInteger(artifact.duplicateCanonicalCount) || artifact.duplicateCanonicalCount! < 0
    || !Number.isSafeInteger(artifact.displayIdCollisionCount) || artifact.displayIdCollisionCount! < 0
    || typeof artifact.scoringProtocol !== 'string' || artifact.scoringProtocol.length === 0
    || stagedReservoirHash(artifact.reservoir) !== artifact.reservoirHash
    || artifact.scoring.profiles.join('|') !== GOLDFISH_MOVEMENT_PROFILES.join('|')
    || artifact.scoring.combination !== 'disjoint-seed-sum-v1'
    || artifact.scoring.stageOne.seeds.length !== 1
    || artifact.scoring.stageOne.scoredCount !== artifact.generatedCount
    || artifact.scoring.rescore.scoredCount !== artifact.prefilterCount
    || [...artifact.scoring.stageOne.seeds, ...artifact.scoring.rescore.seeds].join('|')
      !== artifact.goldfishSeeds.join('|')) return false;
  if (expected.kingdomId !== undefined && artifact.kingdomId !== expected.kingdomId) return false;
  if (expected.poolSeed !== undefined && artifact.poolSeed !== expected.poolSeed) return false;
  if (expected.generatedCount !== undefined && artifact.generatedCount !== expected.generatedCount) return false;
  if (expected.prefilterCount !== undefined && artifact.prefilterCount !== expected.prefilterCount) return false;
  if (expected.goldfishSeeds !== undefined && artifact.goldfishSeeds.join('|') !== expected.goldfishSeeds.join('|')) return false;
  const reservoirIds = artifact.reservoir.map((entry) => entry.strategy.id);
  if (new Set(reservoirIds).size !== reservoirIds.length) return false;
  const canonical = artifact.reservoir.map((entry) => canonicalStrategy(entry.strategy));
  if (new Set(canonical).size !== canonical.length) return false;
  const shards = [...artifact.shardProvenance].sort((left, right) => left.startPosition - right.startPosition);
  if ((artifact.generatedCount! > 0 && shards.length === 0)
    || (shards.length && (shards[0]!.startPosition !== 0
    || shards.at(-1)!.endPosition !== artifact.generatedCount
    || shards.some((entry, index) => entry.endPosition < entry.startPosition
      || (index > 0 && shards[index - 1]!.endPosition !== entry.startPosition)
      || !/^[0-9a-f]{9,}$/.test(entry.candidateDigest)
      || !/^[0-9a-f]{9,}$/.test(entry.scoreDigest))))) return false;
  const goldfish = artifact.reservoir.filter((entry): entry is StagedGoldfishReservoirEntry => entry.source === 'goldfish');
  const random = artifact.reservoir.filter((entry): entry is StagedRandomReservoirEntry => entry.source === 'random');
  if (expected.goldfishCount !== undefined && goldfish.length !== expected.goldfishCount) return false;
  if (expected.randomCount !== undefined && random.length !== expected.randomCount) return false;
  if (goldfish.some((entry, index) => entry.fourSeedGoldfishRank !== index + 1
    || entry.stageOneGoldfishRank < 1 || entry.stageOneGoldfishRank > artifact.prefilterCount!
    || entry.scoreProvenance !== 'combined-four-seed' || !validSummary(entry.score))) return false;
  if (random.some((entry, index) => entry.randomTailRank !== index + 1
    || (entry.stageOneGoldfishRank !== null && (entry.stageOneGoldfishRank < 1
      || entry.stageOneGoldfishRank > artifact.generatedCount!))
    || entry.scoreProvenance !== 'stage-one-only' || !validSummary(entry.stageOneScore))) return false;
  const orderedTail = random.every((entry, index) => index === 0 || (() => {
    const previous = random[index - 1]!;
    const rankDifference = tailRank(previous.strategy.id, artifact.poolSeed!)
      - tailRank(entry.strategy.id, artifact.poolSeed!);
    return rankDifference < 0 || (rankDifference === 0
      && (compareUtf16(previous.strategy.id, entry.strategy.id) < 0
        || (previous.strategy.id === entry.strategy.id
          && compareUtf16(canonicalStrategy(previous.strategy), canonicalStrategy(entry.strategy)) <= 0)));
  })());
  return orderedTail && random.every((entry, index) => entry.randomTailRank === index + 1)
    && artifact.reservoir.every((entry) => canonicalStrategy(entry.strategy).length > 0);
}

export function validateStagedFixedReservoirPool(
  value: unknown, expected: StagedPoolExpectation = {}
): value is StagedFixedReservoirPoolArtifact {
  try { return validateStagedFixedReservoirPoolUnchecked(value, expected); }
  catch { return false; }
}

function normalizedPool(pool: StagedFixedReservoirPoolArtifact): FixedReservoirPoolArtifact {
  const reservoir: ReservoirEntry[] = pool.reservoir.map((entry): ReservoirEntry => entry.source === 'goldfish'
    ? { strategy: entry.strategy, source: 'goldfish', goldfishRank: entry.fourSeedGoldfishRank, score: entry.score }
    : { strategy: entry.strategy, source: 'random', goldfishRank: entry.stageOneGoldfishRank ?? 0,
      score: entry.stageOneScore });
  return { schemaVersion: 2, experiment: 'fixed-reservoir-pool', version: FIXED_RESERVOIR_VERSION,
    kingdomId: pool.kingdomId, poolSeed: pool.poolSeed, goldfishSeeds: pool.goldfishSeeds,
    generatedCount: pool.generatedCount, generatedHash: pool.generatedHash,
    canonicalProvenanceDigest: pool.canonicalProvenanceDigest,
    duplicateCanonicalCount: pool.duplicateCanonicalCount,
    displayIdCollisionCount: pool.displayIdCollisionCount, scoringProtocol: pool.scoringProtocol,
    shardProvenance: pool.shardProvenance,
    reservoirHash: reservoirHash(reservoir), reservoir, elapsedMs: pool.elapsedMs };
}

export async function runStagedFixedReservoirPsro(
  pool: StagedFixedReservoirPoolArtifact, runner: PairingRunner,
  options: { evaluationSeed?: number; protocol?: FixedReservoirProtocol } = {}, now = Date.now
): Promise<StagedFixedReservoirPsroArtifact> {
  if (!validateStagedFixedReservoirPool(pool)) throw new Error('Staged fixed reservoir pool is invalid.');
  const base = await runFixedReservoirPsro(normalizedPool(pool), runner, options, now);
  return { ...base, experiment: 'staged-fixed-reservoir-psro', version: STAGED_GOLDFISH_VERSION,
    reservoir: pool.reservoir, poolScoring: pool.scoring };
}

export function validateStagedFixedReservoirPsroArtifact(
  value: unknown, pool: StagedFixedReservoirPoolArtifact,
  options: { evaluationSeed?: number; protocol?: FixedReservoirProtocol } = {}
): value is StagedFixedReservoirPsroArtifact {
  if (!validateStagedFixedReservoirPool(pool) || !value || typeof value !== 'object') return false;
  const artifact = value as Partial<StagedFixedReservoirPsroArtifact>;
  if (artifact.experiment !== 'staged-fixed-reservoir-psro' || artifact.version !== STAGED_GOLDFISH_VERSION
    || JSON.stringify(artifact.poolScoring) !== JSON.stringify(pool.scoring)) return false;
  const normalized = normalizedPool(pool);
  const fixedAlias = { ...artifact, experiment: 'fixed-reservoir-psro', version: FIXED_RESERVOIR_VERSION,
    reservoir: normalized.reservoir };
  return validateFixedReservoirPsroArtifact(fixedAlias, normalized, options);
}
