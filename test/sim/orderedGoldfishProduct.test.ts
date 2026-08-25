import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { scoreMovementAwareGoldfishStrategyLean } from '../../src/sim/goldfish';
import {
  ORDERED_PRODUCT_COLLISION_ALLOWANCE, ORDERED_PRODUCT_PROFILES, ORDERED_PRODUCT_SEEDS,
  ORDERED_PRODUCT_SPACE_COUNT, ORDERED_PRODUCT_VERSION, buildOrderedProductReservoir,
  candidateSpaceProvenanceDigest, combineScoreEvidence, compactProfileEvidence,
  compareRankedRecords, fixedJson, provenanceDigest, rankingKey, retainOrderedProductRecords,
  sha256Bytes, validateOrderedProductArtifact,
  validateOrderedProductReservoir
} from '../../src/sim/orderedGoldfishProduct';
import type {
  OrderedProductRankedArtifact, OrderedProductRankedRecord, OrderedProductShardProvenance,
  OrderedProductStageOneRecord
} from '../../src/sim/orderedGoldfishProduct';
import {
  coprimeTraversalConfig, createOrderedCandidateSpace, orderedGoldfishCardIds,
  representativeCandidateIndices
} from '../../src/sim/orderedGoldfishBenchmark';
import { nativeRuleFingerprint } from '../../src/sim/nativeGoldfishProtocol';
import { canonicalStrategy, stableHash } from '../../src/sim/strategy';

const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;

beforeAll(() => registerKingdom(kingdom));

function shard(
  shardId: number, startPosition: number, endPosition: number, retainedCount: number
): OrderedProductShardProvenance {
  return { shardId, startPosition, endPosition, completeCount: endPosition - startPosition,
    retainedCount, candidateDigest: stableHash(`candidate-${shardId}`),
    scoreDigest: stableHash(`score-${shardId}`), contentDigest: stableHash(`content-${shardId}`) };
}
function fixture(): OrderedProductRankedArtifact {
  const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
  const strategies = [...representativeCandidateIndices(space.candidateCount, 8)]
    .map((index) => space.candidateAt(index));
  const first = strategies.map((strategy) => compactProfileEvidence(scoreMovementAwareGoldfishStrategyLean(
    strategy, { kingdomId: kingdom.id, seeds: [101], turnLimit: 8, actionCapPerTurn: 40 }, 'full')));
  const additional = strategies.map((strategy) => compactProfileEvidence(scoreMovementAwareGoldfishStrategyLean(
    strategy, { kingdomId: kingdom.id, seeds: [102, 103, 104], turnLimit: 8,
      actionCapPerTurn: 40 }, 'full')));
  const stageOrder = strategies.map((strategy, index): OrderedProductStageOneRecord => ({
    traversalPosition: index, displayId: strategy.id, canonicalStrategy: canonicalStrategy(strategy),
    strategy, stageOne: first[index]!, stageOneRankingKey: rankingKey(first[index]!)
  })).sort((left, right) => retainOrderedProductRecords([left, right], 2, 0)[0] === left ? -1 : 1);
  const stageRank = new Map(stageOrder.map((entry, index) => [entry.canonicalStrategy, index + 1]));
  const records = strategies.map((strategy, index): OrderedProductRankedRecord => ({
    traversalPosition: index, displayId: strategy.id, canonicalStrategy: canonicalStrategy(strategy),
    strategy, stageOne: first[index]!, stageOneRankingKey: rankingKey(first[index]!),
    additional: additional[index]!,
    combined: combineScoreEvidence(first[index]!, additional[index]!),
    combinedRankingKey: rankingKey(combineScoreEvidence(first[index]!, additional[index]!)),
    stageOneRank: stageRank.get(canonicalStrategy(strategy))!, rank: 0
  })).sort(compareRankedRecords).map((entry, index) => ({ ...entry, rank: index + 1 }));
  const stageOneShards = [shard(0, 0, ORDERED_PRODUCT_SPACE_COUNT, records.length)];
  const stageTwoShards = [shard(0, 0, records.length, records.length)];
  const traversal = coprimeTraversalConfig(space.candidateCount);
  const candidateSpace = { generator: 'ordered-typescript-five-rung-v1',
    traversal: 'coprime-position-v1', cardIds: [...space.cardIds],
    quantityVectors: space.quantityVectors.map((entry) => [...entry]), skeletonCount: space.skeletonCount,
    candidateCount: space.candidateCount, ...traversal, provenanceDigest: '' };
  candidateSpace.provenanceDigest = candidateSpaceProvenanceDigest(candidateSpace);
  return { schemaVersion: 1, version: ORDERED_PRODUCT_VERSION, runId: 'fixture', buildVersion: 'fixture',
    ruleFingerprint: nativeRuleFingerprint(kingdom.id, 30, 200), scorerVersion: 'native-goldfish-v1',
    config: { kingdomId: kingdom.id, candidateCount: ORDERED_PRODUCT_SPACE_COUNT,
      retainedCount: records.length, reservoirCount: 3, seeds: [...ORDERED_PRODUCT_SEEDS],
      profiles: [...ORDERED_PRODUCT_PROFILES], turnLimit: 30, actionCapPerTurn: 200,
      collisionAllowance: ORDERED_PRODUCT_COLLISION_ALLOWANCE },
    candidateSpace,
    stageOneShards, stageTwoShards, stageOneProvenanceDigest: provenanceDigest(stageOneShards),
    stageTwoProvenanceDigest: provenanceDigest(stageTwoShards), records };
}

describe('ordered goldfish product correction', () => {
  it('has identical ranked bytes for one process and uneven bounded shards, including a tie and empty shard', () => {
    const artifact = fixture();
    const records = artifact.records.map((entry) => ({ ...entry, stageOne: entry.stageOne }));
    records[1] = { ...records[1]!, stageOne: records[0]!.stageOne };
    const one = retainOrderedProductRecords(records, 5, 0);
    const pieces = [records.slice(0, 3), records.slice(3, 7), records.slice(7), []]
      .flatMap((entries) => retainOrderedProductRecords(entries, 5, 0));
    const uneven = retainOrderedProductRecords(pieces, 5, 0);
    expect(fixedJson(uneven)).toBe(fixedJson(one));
    expect(uneven.map((entry) => [entry.traversalPosition, entry.displayId,
      entry.canonicalStrategy, entry.stageOne])).toEqual(one.map((entry) => [entry.traversalPosition,
      entry.displayId, entry.canonicalStrategy, entry.stageOne]));
  });

  it('validates deterministic ranked bytes and reconstructs exactly the ranked prefix reservoir', () => {
    const artifact = fixture(), text = fixedJson(artifact), sha = sha256Bytes(text);
    expect(validateOrderedProductArtifact(artifact)).toBe(true);
    expect(fixedJson(JSON.parse(text))).toBe(text);
    const reservoir = buildOrderedProductReservoir(artifact, sha);
    expect(validateOrderedProductReservoir(reservoir, artifact, sha)).toBe(true);
    expect(reservoir.entries).toEqual(artifact.records.slice(0, 3));
  });

  it('rejects changed strategy, evidence, rank, membership, configuration, and provenance', () => {
    const artifact = fixture();
    const mutations: OrderedProductRankedArtifact[] = [];
    const strategy = structuredClone(artifact);
    strategy.records[0]!.strategy.startingBuild.push('copper'); mutations.push(strategy);
    const evidence = structuredClone(artifact);
    evidence.records[0]!.combined.totalDamageArea += 1; mutations.push(evidence);
    const rank = structuredClone(artifact); rank.records[0]!.rank = 2; mutations.push(rank);
    const membership = structuredClone(artifact); membership.records[1] = membership.records[0]!; mutations.push(membership);
    const configuration = structuredClone(artifact); configuration.config.seeds[0] = 9; mutations.push(configuration);
    const provenance = structuredClone(artifact); provenance.stageOneShards[0]!.candidateDigest = 'abcdefabc'; mutations.push(provenance);
    for (const mutation of mutations) expect(validateOrderedProductArtifact(mutation)).toBe(false);
  });
});
