import {
  compareMovementAwareGoldfishScores
} from './goldfish';
import type { MovementAwareRankingScore } from './goldfish';
import { StableHashAccumulator, canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export const NATIVE_SEARCH_PROTOCOL_VERSION = 'native-strategy-search-v1';

export interface GeneratedProvenance {
  generatedCount: number;
  generatedIdDigest: string;
  canonicalProvenanceDigest: string;
  duplicateCanonicalCount: number;
  displayIdCollisionCount: number;
}

export function generatedProvenance(
  strategies: readonly Strategy[], duplicateCanonicalCount = 0, displayIdCollisionCount = 0
): GeneratedProvenance {
  const id = new StableHashAccumulator();
  const canonical = new StableHashAccumulator();
  strategies.forEach((strategy, index) => {
    if (index) { id.update('\n'); canonical.update('\n'); }
    id.update(strategy.id);
    canonical.update(canonicalStrategy(strategy));
  });
  return { generatedCount: strategies.length, generatedIdDigest: id.digest(),
    canonicalProvenanceDigest: canonical.digest(), duplicateCanonicalCount, displayIdCollisionCount };
}

export interface GeneratedChunk {
  startPosition: number;
  endPosition: number;
  strategies: Strategy[];
}

export interface StreamedGeneration {
  chunks: GeneratedChunk[];
  provenance: GeneratedProvenance;
  collisionIds: string[];
}

/** One coordinator consumes the stateful generator and preserves accepted-candidate order. */
export function streamUniqueStrategies(source: Iterable<Strategy>, acceptedCount: number, chunkSize: number): StreamedGeneration {
  if (!Number.isSafeInteger(acceptedCount) || acceptedCount < 0
    || !Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new Error('Invalid streaming generation bounds.');
  if (acceptedCount === 0) return { chunks: [], provenance: { generatedCount: 0,
    generatedIdDigest: new StableHashAccumulator().digest(),
    canonicalProvenanceDigest: new StableHashAccumulator().digest(),
    duplicateCanonicalCount: 0, displayIdCollisionCount: 0 }, collisionIds: [] };
  const canonicalSeen = new Set<string>();
  const displayIdentity = new Map<string, string>();
  const collisionIds = new Set<string>();
  const idDigest = new StableHashAccumulator();
  const provenanceDigest = new StableHashAccumulator();
  const chunks: GeneratedChunk[] = [];
  let duplicateCanonicalCount = 0;
  let displayIdCollisionCount = 0;
  let chunk: Strategy[] = [];
  for (const strategy of source) {
    const canonical = canonicalStrategy(strategy);
    if (canonicalSeen.has(canonical)) { duplicateCanonicalCount += 1; continue; }
    canonicalSeen.add(canonical);
    const held = displayIdentity.get(strategy.id);
    if (held === undefined) displayIdentity.set(strategy.id, canonical);
    else if (held !== canonical) {
      displayIdCollisionCount += 1;
      collisionIds.add(strategy.id);
    }
    const position = canonicalSeen.size - 1;
    if (position > 0) { idDigest.update('\n'); provenanceDigest.update('\n'); }
    idDigest.update(strategy.id);
    provenanceDigest.update(canonical);
    chunk.push(strategy);
    if (chunk.length === chunkSize) {
      chunks.push({ startPosition: position + 1 - chunk.length, endPosition: position + 1, strategies: chunk });
      chunk = [];
    }
    if (canonicalSeen.size === acceptedCount) break;
  }
  if (canonicalSeen.size !== acceptedCount) throw new Error('Strategy source ended before the accepted count.');
  if (chunk.length) chunks.push({ startPosition: acceptedCount - chunk.length,
    endPosition: acceptedCount, strategies: chunk });
  return { chunks, provenance: { generatedCount: acceptedCount, generatedIdDigest: idDigest.digest(),
    canonicalProvenanceDigest: provenanceDigest.digest(), duplicateCanonicalCount, displayIdCollisionCount },
    collisionIds: [...collisionIds].sort(compareUtf16) };
}

export interface TraversalScoreRecord {
  traversalPosition: number;
  displayId: string;
  canonicalStrategy: string;
  score: MovementAwareRankingScore;
}

export function compareTraversalScoreRecords(left: TraversalScoreRecord, right: TraversalScoreRecord): number {
  return compareMovementAwareGoldfishScores(left.score, right.score)
    || compareUtf16(left.displayId, right.displayId)
    || compareUtf16(left.canonicalStrategy, right.canonicalStrategy)
    || left.traversalPosition - right.traversalPosition;
}

export function seededTailRank(record: TraversalScoreRecord, seed: number): number {
  return Number.parseInt(stableHash(`reservoir-tail:${seed}:${record.displayId}`).slice(0, 8), 16) >>> 0;
}

export function compareTailRecords(seed: number) {
  return (left: TraversalScoreRecord, right: TraversalScoreRecord): number =>
    seededTailRank(left, seed) - seededTailRank(right, seed)
    || compareUtf16(left.displayId, right.displayId)
    || compareUtf16(left.canonicalStrategy, right.canonicalStrategy)
    || left.traversalPosition - right.traversalPosition;
}

/** Canonical duplicates keep the first traversal occurrence; display-ID collisions keep the best ranked form. */
export function applyCollisionPolicy(records: readonly TraversalScoreRecord[]): TraversalScoreRecord[] {
  const traversal = [...records].sort((left, right) => left.traversalPosition - right.traversalPosition);
  const canonicalSeen = new Set<string>();
  const uniqueCanonical = traversal.filter((entry) => {
    if (canonicalSeen.has(entry.canonicalStrategy)) return false;
    canonicalSeen.add(entry.canonicalStrategy);
    return true;
  });
  const displaySeen = new Set<string>();
  return uniqueCanonical.sort(compareTraversalScoreRecords).filter((entry) => {
    if (displaySeen.has(entry.displayId)) return false;
    displaySeen.add(entry.displayId);
    return true;
  });
}

export interface ShardRetention {
  shardId: number;
  startPosition: number;
  endPosition: number;
  completeCount: number;
  candidateDigest: string;
  scoreDigest: string;
  leaders: TraversalScoreRecord[];
  tail: TraversalScoreRecord[];
}

export function retainShard(
  shardId: number, startPosition: number, endPosition: number,
  records: readonly TraversalScoreRecord[], leaderBound: number, tailBound: number, tailSeed: number
): ShardRetention {
  if (endPosition - startPosition !== records.length) throw new Error('Shard range and score count differ.');
  const ordered = [...records].sort((left, right) => left.traversalPosition - right.traversalPosition);
  const fold = (select: (entry: TraversalScoreRecord) => string): string => {
    const hash = new StableHashAccumulator();
    ordered.forEach((entry, index) => { if (index) hash.update('\n'); hash.update(select(entry)); });
    return hash.digest();
  };
  return { shardId, startPosition, endPosition, completeCount: records.length,
    candidateDigest: fold((entry) => entry.canonicalStrategy),
    scoreDigest: fold((entry) => [entry.score.worstCompletions, entry.score.totalCompletions,
      entry.score.worstPenalizedTurnsTo50, entry.score.totalPenalizedTurnsTo50,
      entry.score.worstDamageArea, entry.score.totalDamageArea, entry.score.totalMoneySpent,
      entry.displayId, entry.canonicalStrategy].join('\t')),
    leaders: [...ordered].sort(compareTraversalScoreRecords).slice(0, leaderBound),
    tail: [...ordered].sort(compareTailRecords(tailSeed)).slice(0, tailBound) };
}

export function mergeShardRetention(
  shards: readonly ShardRetention[], leaderCount: number, tailCount: number, tailSeed: number
): { leaders: TraversalScoreRecord[]; tail: TraversalScoreRecord[] } {
  const orderedShards = [...shards].sort((left, right) => left.startPosition - right.startPosition);
  for (let index = 1; index < orderedShards.length; index += 1) {
    if (orderedShards[index - 1]!.endPosition !== orderedShards[index]!.startPosition) {
      throw new Error('Shard ranges are not contiguous.');
    }
  }
  const leaders = applyCollisionPolicy(orderedShards.flatMap((shard) => shard.leaders)).slice(0, leaderCount);
  const leaderCanonicals = new Set(leaders.map((entry) => entry.canonicalStrategy));
  const tail = applyCollisionPolicy(orderedShards.flatMap((shard) => shard.tail))
    .filter((entry) => !leaderCanonicals.has(entry.canonicalStrategy))
    .sort(compareTailRecords(tailSeed)).slice(0, tailCount);
  return { leaders, tail };
}
