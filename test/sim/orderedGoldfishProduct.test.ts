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
  sha256Bytes, validateCurrentOrderedProductArtifact, validateCurrentOrderedProductRecordMembership,
  validateOrderedProductArtifact,
  validateOrderedProductReservoir
} from '../../src/sim/orderedGoldfishProduct';
import type {
  OrderedProductRankedArtifact, OrderedProductRankedRecord, OrderedProductShardProvenance,
  OrderedProductStageOneRecord
} from '../../src/sim/orderedGoldfishProduct';
import {
  candidateIndexAt, coprimeTraversalConfig, createOrderedCandidateSpace, orderedGoldfishCardIds,
  representativeCandidateIndices
} from '../../src/sim/orderedGoldfishBenchmark';
import { nativeRuleFingerprint } from '../../src/sim/nativeGoldfishProtocol';
import { validateOrderedCalibrationSourceForCounts } from '../../src/sim/initialMatrixCalibration';
import {
  createCampaignStageControlMarker, validateCampaignGoldfishStage
} from '../../src/sim/strategySearchStages';
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
  kingdomId = ORDERED_PRODUCT_KINGDOM, seeds: readonly number[] = ORDERED_PRODUCT_SEEDS,
  schemaVersion: 1 | 2 = 1
): OrderedProductRankedArtifact {
  const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === kingdomId)!;
  registerKingdom(kingdom);
  const productIdentity = schemaVersion === 2 ? deriveCurrentOrderedProductIdentity({ kingdomId, seeds,
    scorerVersion: 'native-goldfish-v1', buildVersion: 'fixture' }) : undefined;
  const targetVersion = productIdentity?.version ?? orderedProductTarget(kingdomId).version;
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
  return { schemaVersion, version: targetVersion, ...(productIdentity && { productIdentity }),
    runId: 'fixture', buildVersion: 'fixture',
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

  it('derives current targets and proves each record belongs to its traversal position', () => {
    const kingdomId = 'deep-beam-tuning-002', seeds = [11, 12, 13, 14] as const;
    registerKingdom(deepBeamSuite.kingdoms.find((entry) => entry.id === kingdomId)!);
    const artifact = fixture(kingdomId, seeds, CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION);
    expect(artifact.version).toBe(CURRENT_ORDERED_PRODUCT_VERSION);
    expect(validateCurrentOrderedProductArtifact(artifact)).toBe(true);
    expect(validateOrderedProductArtifact(artifact)).toBe(true);

    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
    const impossible = structuredClone(artifact), wrong = space.candidateAt(
      [...representativeCandidateIndices(space.candidateCount, 1, 8)][0]!);
    impossible.records[0]!.strategy = wrong;
    impossible.records[0]!.displayId = wrong.id;
    impossible.records[0]!.canonicalStrategy = canonicalStrategy(wrong);
    expect(validateCurrentOrderedProductRecordMembership(artifact.records[0]!, artifact.productIdentity!)).toBe(true);
    expect(validateCurrentOrderedProductRecordMembership(impossible.records[0]!, artifact.productIdentity!)).toBe(false);
    expect(validateCurrentOrderedProductArtifact(impossible)).toBe(false);

    const stale = structuredClone(artifact);
    stale.productIdentity!.seeds[0] = stale.productIdentity!.seeds[0]! + 1;
    expect(validateCurrentOrderedProductArtifact(stale)).toBe(false);
  });

  it('builds and validates one coherent v2 reservoir and calibration source', () => {
    const artifact = fixture('deep-beam-tuning-002', [11, 12, 13, 14], 2);
    const rankedSha256 = 'a'.repeat(64), reservoirSha256 = 'b'.repeat(64);
    const reservoir = buildOrderedProductReservoir(artifact, rankedSha256);
    expect(reservoir).toMatchObject({ schemaVersion: 2,
      productIdentityHash: artifact.productIdentity!.identityHash, reservoirCount: 3 });
    expect(validateOrderedProductReservoir(reservoir, artifact, rankedSha256)).toBe(true);
    const stageId = 'c'.repeat(64);
    const marker = createCampaignStageControlMarker({ stage: 'goldfish', stageId, status: 'complete',
      artifactHashes: { 'output/ranked.json': rankedSha256, 'output/reservoir.json': reservoirSha256 } });
    expect(validateCampaignGoldfishStage({ stageId, ranked: artifact, rankedSha256,
      reservoir, reservoirSha256, fileHashes: marker.artifactHashes, marker })).toBe(true);
    expect(validateCampaignGoldfishStage({ stageId, ranked: artifact, rankedSha256,
      reservoir, reservoirSha256, fileHashes: marker.artifactHashes,
      marker: { ...marker, extra: true } })).toBe(false);
    const validated = validateOrderedCalibrationSourceForCounts({ kingdomId: artifact.config.kingdomId,
      ranked: { ...artifact, recordCount: artifact.records.length }, reservoir,
      rankedSha256, reservoirSha256 }, { retainedCount: 8, reservoirCount: 3, strategyCount: 3 });
    expect(validated.strategies).toEqual(artifact.records.slice(0, 3).map((entry) => entry.strategy));
    const stale = structuredClone(reservoir); stale.productIdentityHash = 'c'.repeat(64);
    expect(() => validateOrderedCalibrationSourceForCounts({ kingdomId: artifact.config.kingdomId,
      ranked: { ...artifact, recordCount: artifact.records.length }, reservoir: stale,
      rankedSha256, reservoirSha256 }, { retainedCount: 8, reservoirCount: 3, strategyCount: 3 }))
      .toThrow('stale or invalid');
    const impossible = structuredClone(reservoir);
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(artifact.config.kingdomId));
    const wrong = space.candidateAt(candidateIndexAt(1, space.candidateCount));
    impossible.entries[0]!.strategy = wrong;
    impossible.entries[0]!.displayId = wrong.id;
    impossible.entries[0]!.canonicalStrategy = canonicalStrategy(wrong);
    expect(() => validateOrderedCalibrationSourceForCounts({ kingdomId: artifact.config.kingdomId,
      ranked: { ...artifact, recordCount: artifact.records.length }, reservoir: impossible,
      rankedSha256, reservoirSha256 }, { retainedCount: 8, reservoirCount: 3, strategyCount: 3 }))
      .toThrow('entry 1 is invalid');
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
