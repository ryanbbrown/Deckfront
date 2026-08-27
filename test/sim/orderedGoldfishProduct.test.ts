import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { scoreMovementAwareGoldfishStrategyLean } from '../../src/sim/goldfish';
import {
  CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION, CURRENT_ORDERED_PRODUCT_VERSION,
  K007_ORDERED_PRODUCT_REPLICATION_SEED_SETS, ORDERED_PRODUCT_CANDIDATE_PROVENANCE_DIGEST,
  ORDERED_PRODUCT_COLLISION_ALLOWANCE, ORDERED_PRODUCT_KINGDOM, ORDERED_PRODUCT_PROFILES,
  ORDERED_PRODUCT_SEEDS,
  ORDERED_PRODUCT_SPACE_COUNT, ORDERED_PRODUCT_SUPPORTED_KINGDOMS, ORDERED_PRODUCT_VERSION,
  buildOrderedProductReservoir, candidateSpaceProvenanceDigest, combineScoreEvidence,
  compactProfileEvidence, compareRankedRecords, deriveCurrentOrderedProductIdentity, fixedJson,
  orderedProductTarget, provenanceDigest,
  rankingKey, retainOrderedProductRecords,
  sha256Bytes, validateCurrentOrderedProductArtifact, validateOrderedProductArtifact,
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

const kingdom009 = deepBeamSuite.kingdoms.find((entry) => entry.id === ORDERED_PRODUCT_KINGDOM)!;

beforeAll(() => registerKingdom(kingdom009));

function shard(
  shardId: number, startPosition: number, endPosition: number, retainedCount: number
): OrderedProductShardProvenance {
  return { shardId, startPosition, endPosition, completeCount: endPosition - startPosition,
    retainedCount, candidateDigest: stableHash(`candidate-${shardId}`),
    scoreDigest: stableHash(`score-${shardId}`), contentDigest: stableHash(`content-${shardId}`) };
}
function fixture(
  kingdomId = ORDERED_PRODUCT_KINGDOM, seeds: readonly number[] = ORDERED_PRODUCT_SEEDS
): OrderedProductRankedArtifact {
  const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === kingdomId)!;
  registerKingdom(kingdom);
  const target = orderedProductTarget(kingdomId);
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
  return { schemaVersion: 1, version: target.version, runId: 'fixture', buildVersion: 'fixture',
    ruleFingerprint: nativeRuleFingerprint(kingdom.id, 30, 200), scorerVersion: 'native-goldfish-v1',
    config: { kingdomId: kingdom.id, candidateCount: ORDERED_PRODUCT_SPACE_COUNT,
      retainedCount: records.length, reservoirCount: 3, seeds: [...seeds],
      profiles: [...ORDERED_PRODUCT_PROFILES], turnLimit: 30, actionCapPerTurn: 200,
      collisionAllowance: ORDERED_PRODUCT_COLLISION_ALLOWANCE },
    candidateSpace,
    stageOneShards, stageTwoShards, stageOneProvenanceDigest: provenanceDigest(stageOneShards),
    stageTwoProvenanceDigest: provenanceDigest(stageTwoShards), records };
}

describe('ordered goldfish product correction', () => {
  it('pins the supported target contracts while preserving Kingdom 009 aliases', () => {
    expect(ORDERED_PRODUCT_SUPPORTED_KINGDOMS).toEqual([
      'deep-beam-tuning-001', 'deep-beam-tuning-007', 'deep-beam-tuning-008', 'deep-beam-tuning-009'
    ]);
    expect(ORDERED_PRODUCT_SUPPORTED_KINGDOMS.map((kingdomId) => orderedProductTarget(kingdomId)))
      .toEqual([
        { kingdomId: 'deep-beam-tuning-001', version: 'k001-ordered-product-calibration-v1',
          authorization: 'k001-ordered-product-calibration-v2', candidateProvenanceDigest: '8a4759823fa' },
        { kingdomId: 'deep-beam-tuning-007', version: 'k007-ordered-product-calibration-v1',
          authorization: 'k007-ordered-product-calibration-v2', candidateProvenanceDigest: '1573ad7d3fa' },
        { kingdomId: 'deep-beam-tuning-008', version: 'k008-ordered-product-calibration-v1',
          authorization: 'k008-ordered-product-calibration-v2', candidateProvenanceDigest: '6561f88940b' },
        { kingdomId: ORDERED_PRODUCT_KINGDOM, version: ORDERED_PRODUCT_VERSION,
          authorization: ORDERED_PRODUCT_VERSION,
          candidateProvenanceDigest: ORDERED_PRODUCT_CANDIDATE_PROVENANCE_DIGEST }
      ]);
    expect(() => orderedProductTarget('deep-beam-tuning-002')).toThrow('Unsupported ordered product kingdom');
  });

  it.each(ORDERED_PRODUCT_SUPPORTED_KINGDOMS)(
    'validates the pinned ordered grammar and staged artifact for %s', (kingdomId) => {
      const artifact = fixture(kingdomId);
      expect(artifact.candidateSpace.cardIds).toHaveLength(14);
      expect(artifact.candidateSpace.candidateCount).toBe(12_972_960);
      expect(artifact.candidateSpace.provenanceDigest)
        .toBe(orderedProductTarget(kingdomId).candidateProvenanceDigest);
      expect(validateOrderedProductArtifact(artifact)).toBe(true);
    }
  );

  it('derives current targets without a kingdom allowlist and fails closed on changed identity', () => {
    const kingdomId = 'deep-beam-tuning-002';
    registerKingdom(deepBeamSuite.kingdoms.find((entry) => entry.id === kingdomId)!);
    const identity = deriveCurrentOrderedProductIdentity({ kingdomId, seeds: [11, 12, 13, 14],
      scorerVersion: 'native-goldfish-v1', buildVersion: 'fixture' });
    const artifact = fixture();
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
    const traversal = coprimeTraversalConfig(space.candidateCount);
    artifact.schemaVersion = CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION;
    artifact.version = CURRENT_ORDERED_PRODUCT_VERSION;
    artifact.productIdentity = identity;
    artifact.buildVersion = identity.buildVersion;
    artifact.scorerVersion = identity.scorerVersion;
    artifact.ruleFingerprint = identity.rulesFingerprint;
    artifact.config.kingdomId = kingdomId;
    artifact.config.seeds = [...identity.seeds];
    artifact.candidateSpace = { generator: 'ordered-typescript-five-rung-v1', traversal: 'coprime-position-v1',
      cardIds: [...space.cardIds], quantityVectors: space.quantityVectors.map((entry) => [...entry]),
      skeletonCount: space.skeletonCount, candidateCount: space.candidateCount, ...traversal,
      provenanceDigest: identity.candidateProvenanceDigest };
    expect(validateCurrentOrderedProductArtifact(artifact)).toBe(true);
    expect(validateOrderedProductArtifact(artifact)).toBe(true);
    const stale = structuredClone(artifact);
    stale.productIdentity!.seeds[0] = stale.productIdentity!.seeds[0]! + 1;
    expect(validateCurrentOrderedProductArtifact(stale)).toBe(false);
  });

  it('accepts only the original seeds or one exact K007 replication set', () => {
    for (const seeds of K007_ORDERED_PRODUCT_REPLICATION_SEED_SETS) {
      expect(validateOrderedProductArtifact(fixture('deep-beam-tuning-007', seeds))).toBe(true);
      expect(validateOrderedProductArtifact(fixture('deep-beam-tuning-008', seeds))).toBe(false);
    }
    expect(validateOrderedProductArtifact(fixture('deep-beam-tuning-007',
      [5_100_000, 5_100_001, 5_100_002, 7_100_003]))).toBe(false);
    expect(validateOrderedProductArtifact(fixture('deep-beam-tuning-007',
      [...K007_ORDERED_PRODUCT_REPLICATION_SEED_SETS[0]].reverse()))).toBe(false);
  });

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
