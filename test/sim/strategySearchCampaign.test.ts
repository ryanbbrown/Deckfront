import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { nativeRuleFingerprint } from '../../src/sim/nativeGoldfishProtocol';
import { deriveCurrentOrderedProductIdentity } from '../../src/sim/orderedGoldfishProduct';
import {
  claimCampaignController, contentIndexDestination, createCampaignContentIndex, createCampaignState,
  deriveLaunchAuthorizationToken, deriveSourceImageIdentity, mutateCampaignState,
  parseStrategySearchCampaignManifest, runtimeCeilings, runtimeFitsAuthorizedCeilings,
  transitionCampaignStage, validateCampaignContentIndex, validateCampaignState, verifySourceImageFiles
} from '../../src/sim/strategySearchCampaign';

const kingdoms = ['deep-beam-tuning-002', 'deep-beam-tuning-007'];
beforeAll(() => kingdoms.forEach((id) => registerKingdom(deepBeamSuite.kingdoms.find((entry) => entry.id === id)!)));

function fixture() {
  const sourceImage = deriveSourceImageIdentity({ gitVersion: 'dc9dffa', files: [
    { path: 'package.json', content: '{}' }, { path: 'src/sim/example.ts', content: 'export {}\n' }
  ] });
  return { schemaVersion: 1 as const, deployment: { volumeName: 'campaign-fixture-volume' }, evidence: {
    campaignId: 'campaign-fixture', kingdomIds: [...kingdoms], sourceImage,
    kingdoms: Object.fromEntries(kingdoms.map((id, index) => [id, {
      ruleFingerprint: nativeRuleFingerprint(id, 30, 200),
      goldfishSeeds: [index * 10 + 1, index * 10 + 2, index * 10 + 3, index * 10 + 4]
    }])), orderedProduct: { generator: 'ordered-typescript-five-rung-v1', traversal: 'coprime-position-v1',
      scorerVersion: 'native-goldfish-v1', candidateCount: 12_972_960, retainedCount: 500_000,
      reservoirCount: 20_000, canonicalShards: [{ id: 'shard-000', start: 0, end: 12_972_960 }] },
    matrix: { schemaVersion: 3 as const, strategyCount: 50 as const, maxSeedCount: 125 as const,
      chunkSize: 25 as const, trainingPrefixes: [75, 100] as [75, 100], heldOutStartOrdinal: 101 as const },
    psro: { schemaVersion: 2 as const, protocolVersion: 'threshold-racing-psro-v2', threshold: 0.51 as const,
      screenDepths: [8, 16, 32, 64, 128, 256, 512] as [8, 16, 32, 64, 128, 256, 512],
      screenAlpha: 0.05 as const, confirmationLooks: [400, 800, 1600, 3200, 6400] as [400, 800, 1600, 3200, 6400],
      confirmationFamilyAlpha: 0.05 as const, matrixSeedCount: 75 as const, cleanScans: 2 as const,
      screenSeedNamespace: 'screen-v1', confirmationSeedNamespace: 'confirmation-v1',
      queueRetestSeedNamespace: 'retest-v1', matrixSeedNamespace: 'matrix-v1' },
    simulatorVersion: 'strategy-search-simulator-v1' as const, artifactSchemaVersion: 1 as const
  }, runtime: { executionMode: 'local-fixture' as const, downloadRoot: '.data/campaign',
    controllerTimeoutSeconds: 1000, maxActiveContainers: 10, maxActiveCpus: 80, dispatchBatchSize: 5,
    stages: { goldfish: { cpu: 4, memoryMiB: 4096, threads: 4, workerBatchSize: 2,
      timeoutSeconds: 600, checkpointIntervalSeconds: 10 },
    matrix: { cpu: 8, memoryMiB: 8192, threads: 8, workerBatchSize: 4,
      timeoutSeconds: 600, checkpointIntervalSeconds: 10 },
    psro: { cpu: 8, memoryMiB: 8192, threads: 8, workerBatchSize: 4,
      timeoutSeconds: 600, checkpointIntervalSeconds: 10 } } } };
}

describe('strategy-search campaign identity and state', () => {
  it('derives K002 ordered identity from registered data without candidates or games', () => {
    const identity = deriveCurrentOrderedProductIdentity({ kingdomId: 'deep-beam-tuning-002',
      seeds: [1, 2, 3, 4], scorerVersion: 'native-goldfish-v1', buildVersion: 'dc9dffa' });
    expect(identity).toMatchObject({ kingdomId: 'deep-beam-tuning-002', candidateCount: 12_972_960,
      skeletonCount: 240_240, schemaVersion: 2 });
    expect(identity.cardIds).toHaveLength(14);
    expect(identity.identityHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails before paid work for dirty or mismatched source-image bytes', () => {
    expect(() => deriveSourceImageIdentity({ gitVersion: 'dc9dffa', files: [{ path: 'src/a.ts', content: 'a' }],
      dirtyTrackedPaths: ['src/a.ts'] })).toThrow('dirty tracked paths');
    expect(() => deriveSourceImageIdentity({ gitVersion: 'dc9dffa',
      files: [{ path: '.env', content: 'SECRET=x' }] })).toThrow('secret-bearing');
    const identity = fixture().evidence.sourceImage;
    expect(verifySourceImageFiles(identity, [
      { path: 'package.json', content: '{}' }, { path: 'src/sim/example.ts', content: 'export {}\n' }
    ])).toBe(true);
    expect(verifySourceImageFiles(identity, [
      { path: 'package.json', content: '{"changed":true}' }, { path: 'src/sim/example.ts', content: 'export {}\n' }
    ])).toBe(false);
  });

  it('rejects missing, duplicate, unknown, implicit, and stale kingdom evidence', () => {
    const duplicate = fixture(); duplicate.evidence.kingdomIds = [kingdoms[0]!, kingdoms[0]!];
    expect(() => parseStrategySearchCampaignManifest(duplicate)).toThrow('must be unique');
    const unknown = fixture(); unknown.evidence.kingdomIds[0] = 'not-registered';
    expect(() => parseStrategySearchCampaignManifest(unknown)).toThrow('exactly four Goldfish seeds');
    const implicit = fixture(); delete implicit.evidence.kingdoms[kingdoms[0]!];
    expect(() => parseStrategySearchCampaignManifest(implicit)).toThrow('exactly four Goldfish seeds');
    const stale = fixture(); stale.evidence.kingdoms[kingdoms[0]!]!.ruleFingerprint = 'stale';
    expect(() => parseStrategySearchCampaignManifest(stale)).toThrow('Rule fingerprint differs');
    const empty = fixture(); empty.evidence.kingdomIds = [];
    expect(() => parseStrategySearchCampaignManifest(empty)).toThrow();
  });

  it('keeps evidence and stage IDs stable across runtime edits but changes them for evidence edits', () => {
    const first = parseStrategySearchCampaignManifest(fixture());
    const runtimeEdit = fixture(); runtimeEdit.runtime.maxActiveContainers = 5;
    const second = parseStrategySearchCampaignManifest(runtimeEdit);
    expect(second.evidenceHash).toBe(first.evidenceHash);
    expect(second.stageIds).toEqual(first.stageIds);
    expect(second.runtimeHash).not.toBe(first.runtimeHash);
    const evidenceEdit = fixture(); evidenceEdit.evidence.kingdoms[kingdoms[0]!]!.goldfishSeeds = [101, 102, 103, 104];
    const third = parseStrategySearchCampaignManifest(evidenceEdit);
    expect(third.evidenceHash).not.toBe(first.evidenceHash);
    expect(third.stageIds).not.toEqual(first.stageIds);
  });

  it('binds launch authorization to evidence and ceilings and permits only runtime reductions', () => {
    const parsed = parseStrategySearchCampaignManifest(fixture());
    const ceilings = runtimeCeilings(parsed.manifest.runtime);
    const token = deriveLaunchAuthorizationToken(parsed.evidenceHash, ceilings);
    const state = createCampaignState({ campaignId: parsed.manifest.evidence.campaignId,
      evidenceHash: parsed.evidenceHash, runtimeHash: parsed.runtimeHash, stageIds: parsed.stageIds });
    expect(() => claimCampaignController({ state, expectedRevision: 0, ownerId: 'first', nowMs: 1,
      leaseMs: 100 })).toThrow('not authorized');
    const claimed = claimCampaignController({ state, expectedRevision: 0, ownerId: 'first', nowMs: 1,
      leaseMs: 100, authorization: { token, ceilings } });
    expect(claimed.controller?.fencingToken).toBe(1);
    const reduced = fixture(); reduced.runtime.maxActiveContainers = 4; reduced.runtime.stages.psro.cpu = 4;
    expect(runtimeFitsAuthorizedCeilings(reduced.runtime, ceilings)).toBe(true);
    const increased = fixture(); increased.runtime.maxActiveCpus = 81;
    expect(runtimeFitsAuthorizedCeilings(increased.runtime, ceilings)).toBe(false);
  });

  it('fences stale owners and fails closed on illegal or unproved stage transitions', () => {
    const parsed = parseStrategySearchCampaignManifest(fixture()), ceilings = runtimeCeilings(parsed.manifest.runtime);
    const state = createCampaignState({ campaignId: parsed.manifest.evidence.campaignId,
      evidenceHash: parsed.evidenceHash, runtimeHash: parsed.runtimeHash, stageIds: parsed.stageIds });
    const first = claimCampaignController({ state, expectedRevision: 0, ownerId: 'first', nowMs: 1,
      leaseMs: 10, authorization: { token: deriveLaunchAuthorizationToken(parsed.evidenceHash, ceilings), ceilings } });
    expect(() => claimCampaignController({ state: first, expectedRevision: first.revision,
      ownerId: 'second', nowMs: 5, leaseMs: 10 })).toThrow('lease is active');
    const takeover = claimCampaignController({ state: first, expectedRevision: first.revision,
      ownerId: 'second', nowMs: 20, leaseMs: 10 });
    expect(takeover.fencingToken).toBe(2);
    expect(() => mutateCampaignState({ state: takeover, expectedRevision: takeover.revision,
      ownerId: 'first', fencingToken: 1, mutate() {} })).toThrow('fenced out');
    expect(() => transitionCampaignStage({ id: 'x', status: 'ready' }, 'complete'))
      .toThrow('Illegal campaign stage transition');
    expect(() => transitionCampaignStage({ id: 'x', status: 'active' }, 'complete'))
      .toThrow('validated artifact hashes');
    expect(validateCampaignState(takeover)).toBe(true);
    const corrupt = structuredClone(takeover); corrupt.revision += 1;
    expect(validateCampaignState(corrupt)).toBe(false);
  });
});

describe('campaign content index', () => {
  it('normalizes, seals, and rejects unsafe or colliding paths', () => {
    const entry = { bytes: 3, sha256: 'a'.repeat(64), stageId: 'stage', completeness: 'complete' as const };
    const index = createCampaignContentIndex([{ path: 'matrix/chunk.json', ...entry }]);
    expect(validateCampaignContentIndex(index)).toBe(true);
    expect(contentIndexDestination('/tmp/campaign', 'matrix/chunk.json'))
      .toBe('/tmp/campaign/matrix/chunk.json');
    for (const unsafe of ['/absolute', '../parent', 'a//b', 'a\\b', 'a/./b']) {
      expect(() => createCampaignContentIndex([{ path: unsafe, ...entry }])).toThrow();
    }
    expect(() => createCampaignContentIndex([{ path: 'A/file', ...entry }, { path: 'a/file', ...entry }]))
      .toThrow('collides');
    expect(() => createCampaignContentIndex([{ path: 'caf\u00e9/file', ...entry },
      { path: 'cafe\u0301/file', ...entry }])).toThrow();
    const corrupt = structuredClone(index); corrupt.entries[0]!.bytes = 4;
    expect(validateCampaignContentIndex(corrupt)).toBe(false);
  });
});
