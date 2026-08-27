import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { nativeRuleFingerprint } from '../../src/sim/nativeGoldfishProtocol';
import { deriveCurrentOrderedProductIdentity } from '../../src/sim/orderedGoldfishProduct';
import { strategySearchKingdom } from '../../src/sim/strategySearchKingdoms';
import {
  claimCampaignController, contentIndexDestination, createCampaignContentIndex, createCampaignState,
  bindCampaignStageCall, campaignEvidenceComplete, deriveLaunchAuthorizationToken,
  deriveSourceImageIdentity, mutateCampaignState, parseCampaignSelectionManifest,
  parseStrategySearchCampaignManifest, recordCampaignStageLaunchIntent, recordCampaignStageOutcome,
  recoverCampaignStageLaunchIntent, repairCampaignCompletedStage, runtimeCeilings,
  runtimeFitsAuthorizedCeilings, transitionCampaignStage, validateCampaignContentIndex,
  validateCampaignState, verifySourceImageFiles
} from '../../src/sim/strategySearchCampaign';

const kingdoms = ['deep-beam-tuning-002', 'deep-beam-tuning-007'];
beforeAll(() => kingdoms.forEach((id) => registerKingdom(deepBeamSuite.kingdoms.find((entry) => entry.id === id)!)));

function fixture() {
  const sourceImage = deriveSourceImageIdentity({ gitVersion: 'dc9dffa', files: [
    { path: 'package.json', content: '{}' }, { path: 'src/sim/example.ts', content: 'export {}\n' }
  ] });
  return { schemaVersion: 1 as const, deployment: { volumeName: 'hexdeck-native-strategy-results' }, evidence: {
    campaignId: 'campaign-fixture', selectionManifest: { sha256: 'a'.repeat(64), digest: 'b'.repeat(64) },
    kingdomIds: [...kingdoms], sourceImage,
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
    retryBackoffSeconds: 5, retryBackoffMaxSeconds: 60,
    stages: { goldfish: { cpu: 4, memoryMiB: 4096, threads: 4, workerBatchSize: 2,
      timeoutSeconds: 600, checkpointIntervalSeconds: 10 },
    matrix: { cpu: 8, memoryMiB: 8192, threads: 8, workerBatchSize: 4,
      timeoutSeconds: 600, checkpointIntervalSeconds: 10 },
    psro: { cpu: 8, memoryMiB: 8192, threads: 8, workerBatchSize: 4,
      timeoutSeconds: 600, checkpointIntervalSeconds: 10 } } } };
}

describe('strategy-search campaign identity and state', () => {
  it('consumes an exact supplied selection manifest without selecting kingdoms itself', () => {
    const unsigned = { schemaVersion: 1, suiteVersion: 'fixture-selection-v1',
      sourceSuiteVersion: 'fixture-source-v1', sourceManifestDigest: 'c'.repeat(64), selectedCount: 2,
      selectedKingdomIds: [...kingdoms], selection: { source: 'fixture' } };
    const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, held]) => [key, sorted(held)])) : value;
    const digest = createHash('sha256').update(JSON.stringify(sorted(unsigned))).digest('hex');
    const content = `${JSON.stringify({ ...unsigned, digest }, null, 2)}\n`;
    const parsed = parseCampaignSelectionManifest(content);
    expect(parsed.kingdomIds).toEqual(kingdoms);
    expect(parsed.sha256).toBe(createHash('sha256').update(content).digest('hex'));
    expect(() => parseCampaignSelectionManifest(JSON.stringify({ ...unsigned, digest: 'd'.repeat(64) })))
      .toThrow('digest differs');
  });

  it('derives K002 ordered identity from registered data without candidates or games', () => {
    const identity = deriveCurrentOrderedProductIdentity({ kingdomId: 'deep-beam-tuning-002',
      seeds: [1, 2, 3, 4], scorerVersion: 'native-goldfish-v1', buildVersion: 'dc9dffa' });
    expect(identity).toMatchObject({ kingdomId: 'deep-beam-tuning-002', candidateCount: 12_972_960,
      skeletonCount: 240_240, schemaVersion: 2 });
    expect(identity.cardIds).toHaveLength(14);
    expect(identity.identityHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts an explicitly supplied registered balance-suite kingdom without hard-coded IDs', () => {
    const kingdomId = 'balance-tuning-005'; strategySearchKingdom(kingdomId);
    const value = fixture(); value.evidence.kingdomIds = [kingdomId];
    value.evidence.kingdoms = { [kingdomId]: { ruleFingerprint: nativeRuleFingerprint(kingdomId, 30, 200),
      goldfishSeeds: [101, 102, 103, 104] } };
    const parsed = parseStrategySearchCampaignManifest(value);
    expect(parsed.manifest.evidence.kingdomIds).toEqual([kingdomId]);
    expect(parsed.stageIds[kingdomId]?.goldfish).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails before paid work for dirty or mismatched source-image bytes', () => {
    expect(() => deriveSourceImageIdentity({ gitVersion: 'dc9dffa', files: [{ path: 'src/a.ts', content: 'a' }],
      dirtyTrackedPaths: ['src/a.ts'] })).toThrow('dirty tracked paths');
    for (const excluded of ['.env', '.ENV', 'Node_Modules/package.json', 'DIST/output.js']) {
      expect(() => deriveSourceImageIdentity({ gitVersion: 'dc9dffa',
        files: [{ path: excluded, content: 'SECRET=x' }] })).toThrow('excluded');
    }
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
    const duplicateNamespace = fixture();
    duplicateNamespace.evidence.psro.queueRetestSeedNamespace = duplicateNamespace.evidence.psro.screenSeedNamespace;
    expect(() => parseStrategySearchCampaignManifest(duplicateNamespace)).toThrow('namespaces must be distinct');
    for (const field of ['generator', 'traversal', 'scorerVersion'] as const) {
      const changed = fixture(); changed.evidence.orderedProduct[field] = `changed-${field}`;
      expect(() => parseStrategySearchCampaignManifest(changed)).toThrow('implementation identity');
    }
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

  it('binds every paid capacity ceiling and records later authorized increases', () => {
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
    reduced.runtime.stages.matrix.memoryMiB = 4096; reduced.runtime.stages.goldfish.threads = 2;
    reduced.runtime.stages.psro.workerBatchSize = 2; reduced.runtime.stages.matrix.timeoutSeconds = 500;
    expect(runtimeFitsAuthorizedCeilings(reduced.runtime, ceilings)).toBe(true);
    const increases = [
      (value: ReturnType<typeof fixture>) => { value.runtime.maxActiveContainers += 1; },
      (value: ReturnType<typeof fixture>) => { value.runtime.maxActiveCpus += 1; },
      (value: ReturnType<typeof fixture>) => { value.runtime.controllerTimeoutSeconds += 1; },
      (value: ReturnType<typeof fixture>) => { value.runtime.stages.goldfish.cpu += 1; },
      (value: ReturnType<typeof fixture>) => { value.runtime.stages.matrix.memoryMiB += 1; },
      (value: ReturnType<typeof fixture>) => { value.runtime.stages.psro.threads += 1; },
      (value: ReturnType<typeof fixture>) => { value.runtime.stages.goldfish.workerBatchSize += 1; },
      (value: ReturnType<typeof fixture>) => { value.runtime.stages.matrix.timeoutSeconds += 1; }
    ];
    for (const increase of increases) {
      const increased = fixture(); increase(increased);
      expect(runtimeFitsAuthorizedCeilings(increased.runtime, ceilings)).toBe(false);
    }
    const increased = fixture(); increased.runtime.stages.matrix.memoryMiB += 1024;
    const increasedCeilings = runtimeCeilings(increased.runtime);
    const updated = claimCampaignController({ state: claimed, expectedRevision: claimed.revision,
      ownerId: 'first', nowMs: 2, leaseMs: 100, authorization: {
        token: deriveLaunchAuthorizationToken(parsed.evidenceHash, increasedCeilings), ceilings: increasedCeilings } });
    expect(updated.authorizedCeilings!.stages.matrix.memoryMiB).toBe(increased.runtime.stages.matrix.memoryMiB);
    expect(updated.authorizedCeilings!.stages.psro.cpu).toBe(ceilings.stages.psro.cpu);
    expect(() => claimCampaignController({ state: claimed, expectedRevision: claimed.revision,
      ownerId: 'first', nowMs: 2, leaseMs: 100, requestedCeilings: increasedCeilings }))
      .toThrow('runtime increase is not authorized');
    const runtimeHash = 'f'.repeat(64);
    const attached = claimCampaignController({ state: updated, expectedRevision: updated.revision,
      ownerId: 'first', nowMs: 3, leaseMs: 100, requestedCeilings: ceilings, runtimeHash });
    expect(attached.authorizedCeilings).toEqual(updated.authorizedCeilings);
    expect(attached.runtimeHistory).toContain(runtimeHash);
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
    const corrupt = structuredClone(takeover) as typeof takeover & { unexpected?: boolean };
    corrupt.unexpected = true;
    expect(validateCampaignState(corrupt)).toBe(false);

    const protectedMutations: Array<(draft: typeof takeover) => void> = [
      (draft) => { draft.revision += 1; },
      (draft) => { draft.runtimeHistory.push('f'.repeat(64)); },
      (draft) => { draft.authorizedCeilings!.maxActiveCpus += 1; },
      (draft) => { draft.controller!.leaseUntilMs += 1; },
      (draft) => { draft.stages[Object.keys(draft.stages)[0]!]!.id = 'e'.repeat(64); },
      (draft) => { (draft as typeof takeover & { unexpected?: boolean }).unexpected = true; }
    ];
    for (const mutation of protectedMutations) {
      expect(() => mutateCampaignState({ state: takeover, expectedRevision: takeover.revision,
        ownerId: 'second', fencingToken: 2, mutate: mutation })).toThrow();
    }
    const readyKey = Object.keys(takeover.stages).find((key) => key.endsWith(':goldfish'))!;
    expect(() => mutateCampaignState({ state: takeover, expectedRevision: takeover.revision,
      ownerId: 'second', fencingToken: 2,
      mutate(draft) { draft.stages[readyKey] = { id: draft.stages[readyKey]!.id,
        status: 'complete', artifactHashes: { output: 'a'.repeat(64) } }; } }))
      .toThrow('Illegal campaign stage transition');
    const active = mutateCampaignState({ state: takeover, expectedRevision: takeover.revision,
      ownerId: 'second', fencingToken: 2, mutate(draft) {
        draft.stages[readyKey] = transitionCampaignStage(draft.stages[readyKey]!, 'active', {
          callId: 'call-1', controllerFence: 2, heartbeatMs: 21, resources: { containers: 1, cpus: 4 }
        });
      } });
    expect(active.stages[readyKey]).toMatchObject({ status: 'active', callId: 'call-1' });
  });

  it('durably records launch intent, binding, takeover, and deep stage completion in state', () => {
    const parsed = parseStrategySearchCampaignManifest(fixture()), kingdomId = kingdoms[0]!;
    const stageIds = { [kingdomId]: parsed.stageIds[kingdomId]! }, ceilings = runtimeCeilings(parsed.manifest.runtime);
    const initial = createCampaignState({ campaignId: parsed.manifest.evidence.campaignId,
      evidenceHash: parsed.evidenceHash, runtimeHash: parsed.runtimeHash, stageIds });
    const claimed = claimCampaignController({ state: initial, expectedRevision: 0, ownerId: 'first',
      nowMs: 1, leaseMs: 10, authorization: {
        token: deriveLaunchAuthorizationToken(parsed.evidenceHash, ceilings), ceilings } });
    const goldfishKey = `${kingdomId}:goldfish`;
    const intent = recordCampaignStageLaunchIntent({ state: claimed, expectedRevision: claimed.revision,
      ownerId: 'first', fencingToken: 1, stageKey: goldfishKey, launchIntentId: 'a'.repeat(64),
      nowMs: 2, resources: { containers: 1, cpus: 4 } });
    expect(intent.stages[goldfishKey]).toMatchObject({ status: 'active', callId: 'a'.repeat(64) });
    const bound = bindCampaignStageCall({ state: intent, expectedRevision: intent.revision,
      ownerId: 'first', fencingToken: 1, stageKey: goldfishKey, launchIntentId: 'a'.repeat(64),
      callId: 'fc-saved', nowMs: 3 });
    const takeover = claimCampaignController({ state: bound, expectedRevision: bound.revision,
      ownerId: 'second', nowMs: 20, leaseMs: 10 });
    expect(takeover.stages[goldfishKey]).toMatchObject({ callId: 'fc-saved', controllerFence: 2 });
    expect(() => bindCampaignStageCall({ state: takeover, expectedRevision: takeover.revision,
      ownerId: 'first', fencingToken: 1, stageKey: goldfishKey, launchIntentId: 'a'.repeat(64),
      callId: 'fc-old', nowMs: 21 })).toThrow('fenced out');
    let state = recordCampaignStageOutcome({ state: takeover, expectedRevision: takeover.revision,
      ownerId: 'second', fencingToken: 2, stageKey: goldfishKey, status: 'complete',
      artifactPaths: ['output/ranked.json'], artifactHashes: { 'output/ranked.json': 'b'.repeat(64) } });
    expect(state.stages[`${kingdomId}:matrix`]?.status).toBe('ready');
    for (const stage of ['matrix', 'psro'] as const) {
      const key = `${kingdomId}:${stage}`;
      state = recordCampaignStageLaunchIntent({ state, expectedRevision: state.revision, ownerId: 'second',
        fencingToken: 2, stageKey: key, launchIntentId: 'c'.repeat(64), nowMs: 22,
        resources: { containers: 1, cpus: 4 } });
      state = recordCampaignStageOutcome({ state, expectedRevision: state.revision, ownerId: 'second',
        fencingToken: 2, stageKey: key, status: 'complete', artifactPaths: [`output/${stage}.json`],
        artifactHashes: { [`output/${stage}.json`]: 'd'.repeat(64) } });
    }
    expect(campaignEvidenceComplete(state)).toBe(true);
    expect(validateCampaignState(state)).toBe(true);
    const repaired = repairCampaignCompletedStage({ state, expectedRevision: state.revision,
      ownerId: 'second', fencingToken: 2, stageKey: goldfishKey, reason: 'ranked hash differs',
      artifactPaths: ['output/ranked.json'], artifactHashes: { 'output/ranked.json': 'b'.repeat(64) } });
    expect(repaired.stages[goldfishKey]).toMatchObject({ status: 'incomplete', reason: 'ranked hash differs' });
    expect(repaired.stages[`${kingdomId}:matrix`]?.status).toBe('pending');
    expect(repaired.stages[`${kingdomId}:psro`]?.status).toBe('pending');
  });

  it('recovers an ambiguous stage intent only under the current explicit operator fence', () => {
    const parsed = parseStrategySearchCampaignManifest(fixture()), kingdomId = kingdoms[0]!;
    const initial = createCampaignState({ campaignId: parsed.manifest.evidence.campaignId,
      evidenceHash: parsed.evidenceHash, runtimeHash: parsed.runtimeHash,
      stageIds: { [kingdomId]: parsed.stageIds[kingdomId]! } });
    const ceilings = runtimeCeilings(parsed.manifest.runtime);
    const claimed = claimCampaignController({ state: initial, expectedRevision: 0, ownerId: 'operator',
      nowMs: 1, leaseMs: 10, authorization: {
        token: deriveLaunchAuthorizationToken(parsed.evidenceHash, ceilings), ceilings } });
    const key = `${kingdomId}:goldfish`;
    const intent = recordCampaignStageLaunchIntent({ state: claimed, expectedRevision: claimed.revision,
      ownerId: 'operator', fencingToken: 1, stageKey: key, launchIntentId: 'a'.repeat(64), nowMs: 2,
      resources: { containers: 1, cpus: 4 } });
    expect(recoverCampaignStageLaunchIntent({ state: intent, expectedRevision: intent.revision,
      ownerId: 'operator', fencingToken: 1, stageKey: key }).stages[key]?.status).toBe('ready');
    expect(() => recoverCampaignStageLaunchIntent({ state: intent, expectedRevision: intent.revision,
      ownerId: 'stale', fencingToken: 1, stageKey: key })).toThrow('fenced out');
  });
});

describe('campaign content index', () => {
  it('normalizes, seals, and rejects unsafe or colliding paths', () => {
    const entry = { bytes: 3, sha256: 'a'.repeat(64), stageId: 'b'.repeat(64),
      completeness: 'complete' as const };
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
    expect(validateCampaignContentIndex({ ...index, extra: true })).toBe(false);
    expect(validateCampaignContentIndex({ ...index,
      entries: [{ ...index.entries[0]!, extra: true }] })).toBe(false);
    expect(validateCampaignContentIndex({ ...index,
      entries: [{ ...index.entries[0]!, stageId: 'stage' }] })).toBe(false);
    expect(validateCampaignContentIndex({ ...index,
      entries: [{ ...index.entries[0]!, completeness: 'partial' }] })).toBe(false);
    expect(() => createCampaignContentIndex([{ ...entry, path: 'x', stageId: 'stage' }])).toThrow();
    expect(() => createCampaignContentIndex([{ ...entry, path: 'x', completeness: 'partial' as never }])).toThrow();
  });
});
