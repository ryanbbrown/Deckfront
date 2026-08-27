import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativeRuleFingerprint } from '../../src/sim/nativeGoldfishProtocol';
import { strategySearchKingdom } from '../../src/sim/strategySearchKingdoms';
import {
  createCampaignContentIndex, deriveLaunchAuthorizationToken, parseStrategySearchCampaignManifest,
  runtimeCeilings
} from '../../src/sim/strategySearchCampaign';
import {
  campaignArchiveMemberHash, createCampaignArchiveManifest, installCampaignArchives,
  validateCampaignArchiveManifest
} from '../../src/sim/strategySearchCampaignArchive';
import {
  createCampaignLaunchBundle, validateCampaignSourceRepair
} from '../../src/sim/strategySearchCampaignOperator';
import {
  applyCampaignSchedulerUpdates, createCampaignSchedulerCheckpoint
} from '../../src/sim/strategySearchScheduler';
import { createCampaignStageControlMarker } from '../../src/sim/strategySearchStages';
import {
  deriveTrackedCampaignSourceImage, executeCampaignOperation
} from '../../scripts/strategy_search_campaign';
import type { CampaignOperatorAdapter } from '../../scripts/strategy_search_campaign';
import type { CampaignLaunchBundle } from '../../src/sim/strategySearchCampaignOperator';

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, held]) => [key, sorted(held)]));
  return value;
}
const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const temporaryRoot = (): string => fs.realpathSync(os.tmpdir());
function tarOctal(value: number, length: number): Buffer {
  return Buffer.from(`${value.toString(8).padStart(length - 1, '0')}\0`, 'ascii');
}
function tar(entries: Array<{ path: string; content: Buffer; type?: number }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512), name = Buffer.from(entry.path);
    if (name.length > 100) throw new Error('test tar path too long');
    name.copy(header, 0); tarOctal(0o600, 8).copy(header, 100); tarOctal(0, 8).copy(header, 108);
    tarOctal(0, 8).copy(header, 116); tarOctal(entry.content.length, 12).copy(header, 124);
    tarOctal(0, 12).copy(header, 136); header.fill(0x20, 148, 156); header[156] = entry.type ?? 0x30;
    Buffer.from('ustar\0', 'ascii').copy(header, 257); Buffer.from('00', 'ascii').copy(header, 263);
    tarOctal(header.reduce((sum, byte) => sum + byte, 0), 8).copy(header, 148);
    blocks.push(header, entry.content, Buffer.alloc((512 - entry.content.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024)); return Buffer.concat(blocks);
}
function fixtureRoot(): { root: string; manifestFile: string; selectionFile: string } {
  const root = fs.mkdtempSync(path.join(temporaryRoot(), 'hexdeck-campaign-operator-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  const kingdomId = 'deep-beam-tuning-002', sourceImage = deriveTrackedCampaignSourceImage(root);
  strategySearchKingdom(kingdomId);
  const selectionUnsigned = { schemaVersion: 1, suiteVersion: 'fixture-selection-v1',
    sourceSuiteVersion: 'fixture-source-v1', sourceManifestDigest: 'a'.repeat(64), selectedCount: 1,
    selectedKingdomIds: [kingdomId], selection: { source: 'fixture' } };
  const selectionDigest = sha(JSON.stringify(sorted(selectionUnsigned)));
  const selectionText = `${JSON.stringify({ ...selectionUnsigned, digest: selectionDigest }, null, 2)}\n`;
  const selectionFile = path.join(root, 'selection.json'); fs.writeFileSync(selectionFile, selectionText);
  const manifest = { schemaVersion: 1, deployment: { volumeName: 'hexdeck-native-strategy-results' }, evidence: {
    campaignId: 'operator-fixture', selectionManifest: { sha256: sha(selectionText), digest: selectionDigest },
    kingdomIds: [kingdomId], sourceImage, kingdoms: { [kingdomId]: {
      ruleFingerprint: nativeRuleFingerprint(kingdomId, 30, 200), goldfishSeeds: [1, 2, 3, 4] } },
    orderedProduct: { generator: 'ordered-typescript-five-rung-v1', traversal: 'coprime-position-v1',
      scorerVersion: 'native-goldfish-v1', candidateCount: 12_972_960, retainedCount: 500_000,
      reservoirCount: 20_000, canonicalShards: [{ id: 'shard-000', start: 0, end: 12_972_960 }] },
    matrix: { schemaVersion: 3, strategyCount: 50, maxSeedCount: 125, chunkSize: 25,
      trainingPrefixes: [75, 100], heldOutStartOrdinal: 101 },
    psro: { schemaVersion: 2, protocolVersion: 'threshold-racing-psro-v2', threshold: 0.51,
      screenDepths: [8, 16, 32, 64, 128, 256, 512], screenAlpha: 0.05,
      confirmationLooks: [400, 800, 1600, 3200, 6400], confirmationFamilyAlpha: 0.05,
      matrixSeedCount: 75, cleanScans: 2, screenSeedNamespace: 'screen-v1',
      confirmationSeedNamespace: 'confirmation-v1', queueRetestSeedNamespace: 'retest-v1',
      matrixSeedNamespace: 'matrix-v1' }, simulatorVersion: 'strategy-search-simulator-v1',
    artifactSchemaVersion: 1 }, runtime: { executionMode: 'local-fixture', downloadRoot: 'download',
      controllerTimeoutSeconds: 600, maxActiveContainers: 2, maxActiveCpus: 8, dispatchBatchSize: 2,
      retryBackoffSeconds: 5, retryBackoffMaxSeconds: 60,
      stages: { goldfish: { cpu: 2, memoryMiB: 4096, threads: 2, workerBatchSize: 2,
        timeoutSeconds: 300, checkpointIntervalSeconds: 10 },
      matrix: { cpu: 4, memoryMiB: 8192, threads: 4, workerBatchSize: 4,
        timeoutSeconds: 300, checkpointIntervalSeconds: 10 },
      psro: { cpu: 4, memoryMiB: 8192, threads: 4, workerBatchSize: 4,
        timeoutSeconds: 300, checkpointIntervalSeconds: 10 } } } };
  const manifestFile = path.join(root, 'campaign.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifestFile, selectionFile };
}
function writeIncompleteDownload(stagingRoot: string, bundle: ReturnType<typeof createCampaignLaunchBundle>): void {
  const contents = new Map([['state.json', Buffer.from(`${JSON.stringify(bundle.state, null, 2)}\n`)],
    ['scheduler.json', Buffer.from(`${JSON.stringify(bundle.scheduler, null, 2)}\n`)]]);
  const index = createCampaignContentIndex([...contents].map(([entryPath, content]) => ({ path: entryPath,
    bytes: content.length, sha256: sha(content), stageId: bundle.evidenceHash,
    completeness: 'incomplete' as const })));
  const archiveBytes = tar([...contents].map(([entryPath, content]) => ({ path: entryPath, content })));
  const archivePath = 'archives/campaign.tar'; fs.mkdirSync(path.join(stagingRoot, 'archives'), { recursive: true });
  fs.writeFileSync(path.join(stagingRoot, archivePath), archiveBytes);
  const archives = createCampaignArchiveManifest(index, [{ path: archivePath, bytes: archiveBytes.length,
    sha256: sha(archiveBytes), stageId: bundle.evidenceHash, completeness: 'incomplete',
    memberCount: index.entries.length, memberHash: campaignArchiveMemberHash(index.entries) }]);
  fs.writeFileSync(path.join(stagingRoot, 'content-index.json'), `${JSON.stringify(index, null, 2)}\n`);
  fs.writeFileSync(path.join(stagingRoot, 'archives.json'), `${JSON.stringify(archives, null, 2)}\n`);
}

describe('campaign operator flow', () => {
  it('plans without a remote call and status uses only the bounded status seam', () => {
    const fixture = fixtureRoot(); let statusCalls = 0, runCalls = 0;
    const adapter: CampaignOperatorAdapter = { status() { statusCalls += 1; return { state: null,
      scheduler: null, download: null, controllerCall: null }; },
    run() { runCalls += 1; throw new Error('must not run'); } };
    try {
      const plan = executeCampaignOperation({ operation: 'plan', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, root: fixture.root, adapter });
      expect(plan).toMatchObject({ kingdomCount: 1, campaignCostGate: 'none',
        workspaceBudget: 'operator-managed-not-verified' });
      expect(String(plan.authorizationToken)).toMatch(/^campaign-v1\.[0-9a-f]{64}$/);
      expect(statusCalls).toBe(0); expect(runCalls).toBe(0);
      const status = executeCampaignOperation({ operation: 'status', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, root: fixture.root, adapter });
      expect(status).toMatchObject({ remoteExists: false, paidEvidenceComplete: false,
        localDownloadComplete: false });
      expect(statusCalls).toBe(1); expect(runCalls).toBe(0);
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it('reports active resources and call IDs from scheduler tasks instead of coarse stage state', () => {
    const fixture = fixtureRoot();
    try {
      const parsed = parseStrategySearchCampaignManifest(JSON.parse(
        fs.readFileSync(fixture.manifestFile, 'utf8')) as unknown);
      const bundle = createCampaignLaunchBundle(parsed), first = bundle.scheduler.tasks.find((task) => task.status === 'ready')!;
      const finalize = bundle.tasks.find((task) => task.config.ordered_stage === 'finalize')!;
      const psro = bundle.files[Object.keys(bundle.files).find((file) => file.endsWith('/stage-config.json'))!] as {
        protocolInput: Record<string, string> };
      expect(finalize.config.matrix_seed_namespace).toBe('matrix-v1');
      expect(psro.protocolInput).toMatchObject({ matrixSeedNamespace: 'matrix-v1', screenSeedNamespace: 'screen-v1',
        confirmationSeedNamespace: 'confirmation-v1', queueRetestSeedNamespace: 'retest-v1' });
      let tasks = applyCampaignSchedulerUpdates(bundle.scheduler.tasks, [{ kind: 'intent', taskId: first.taskId,
        launchIntentId: 'e'.repeat(64), controllerFence: 1 }]);
      tasks = applyCampaignSchedulerUpdates(tasks, [{ kind: 'bind', taskId: first.taskId,
        launchIntentId: 'e'.repeat(64), callId: 'fc-shard', controllerFence: 1 }]);
      const scheduler = createCampaignSchedulerCheckpoint({ evidenceHash: bundle.evidenceHash,
        controllerFence: 1, revision: 2, tasks });
      const adapter: CampaignOperatorAdapter = { status() { return { state: bundle.state, scheduler,
        download: null, controllerCall: null }; }, run() { throw new Error('must not run'); } };
      const status = executeCampaignOperation({ operation: 'status', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, root: fixture.root, adapter });
      expect(status).toMatchObject({ activeContainers: 1, activeCpus: first.cpus,
        activeCallIds: ['fc-shard'] });
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it('uses a separate explicit recovery seam and never turns status into recovery', () => {
    const fixture = fixtureRoot(); let recovered = '';
    const adapter: CampaignOperatorAdapter = { status() { return { state: null, scheduler: null,
      download: null, controllerCall: null }; }, run() { throw new Error('must not run'); },
    recover(input) { recovered = input.target; return { status: 'recovered' }; } };
    try {
      expect(() => executeCampaignOperation({ operation: 'recover', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, root: fixture.root, adapter })).toThrow('explicit ambiguous');
      const result = executeCampaignOperation({ operation: 'recover', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, recoveryTarget: 'controller', root: fixture.root, adapter });
      expect(recovered).toBe('controller'); expect(result.outcome).toEqual({ status: 'recovered' });
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it('records an authorized execution-source repair while retaining prior evidence and completed-work identity', () => {
    const fixture = fixtureRoot();
    try {
      const parsed = parseStrategySearchCampaignManifest(JSON.parse(
        fs.readFileSync(fixture.manifestFile, 'utf8')) as unknown);
      const priorBundle = createCampaignLaunchBundle(parsed);
      fs.writeFileSync(path.join(fixture.root, 'repair-source.txt'), 'bounded response ingestion\n');
      execFileSync('git', ['add', 'repair-source.txt'], { cwd: fixture.root });
      execFileSync('git', ['commit', '-qm', 'repair source'], { cwd: fixture.root });
      const plan = executeCampaignOperation({ operation: 'resume-plan', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, root: fixture.root });
      expect(plan).toMatchObject({ campaignEvidenceHash: parsed.evidenceHash,
        artifactBuildVersion: parsed.manifest.evidence.sourceImage.gitVersion,
        repairId: 'bounded-stage-two-response-ingestion-v1', campaignCostGate: 'none' });
      expect(String(plan.sourceRepairToken)).toMatch(/^campaign-source-repair-v1\.[0-9a-f]{64}$/);
      let launched: CampaignLaunchBundle | undefined;
      const adapter: CampaignOperatorAdapter = { status() { return { state: priorBundle.state,
        scheduler: priorBundle.scheduler, download: null, controllerCall: null }; },
      run({ bundle, stagingRoot }) { launched = bundle; writeIncompleteDownload(stagingRoot, bundle);
        return { status: 'incomplete' }; } };
      expect(() => executeCampaignOperation({ operation: 'resume', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, root: fixture.root, adapter })).toThrow('exact resume-plan');
      const runtimeToken = deriveLaunchAuthorizationToken(parsed.evidenceHash,
        runtimeCeilings(parsed.manifest.runtime));
      expect(() => executeCampaignOperation({ operation: 'resume', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, sourceRepairToken: String(plan.sourceRepairToken),
        authorizationToken: runtimeToken, root: fixture.root, adapter })).toThrow('remains incomplete');
      expect(launched).toBeDefined();
      expect(launched!.evidenceHash).toBe(parsed.evidenceHash);
      expect(launched!.controller.source_image.gitVersion).toBe(plan.executionSourceVersion);
      expect(launched!.tasks[0]!.config.build_version)
        .toBe(parsed.manifest.evidence.sourceImage.gitVersion);
      expect(launched!.sourceRepair).toMatchObject({ campaignEvidenceHash: parsed.evidenceHash,
        artifactBuildVersion: parsed.manifest.evidence.sourceImage.gitVersion,
        executionSourceImage: { gitVersion: plan.executionSourceVersion } });
      expect(launched!.files[`control/source-repairs/${launched!.sourceRepair!.lineageHash}.json`])
        .toEqual(launched!.sourceRepair);
      expect(validateCampaignSourceRepair(JSON.parse(JSON.stringify(sorted(launched!.sourceRepair)))))
        .toBe(true);
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it('requires first-launch authorization and returns nonzero semantics for validated incomplete evidence', () => {
    const fixture = fixtureRoot(); let runCalls = 0;
    try {
      const manifest = parseStrategySearchCampaignManifest(JSON.parse(fs.readFileSync(fixture.manifestFile, 'utf8')));
      const adapter: CampaignOperatorAdapter = { status() { return { state: null, scheduler: null,
        download: null, controllerCall: null }; }, run({ bundle, stagingRoot }) {
        runCalls += 1; writeIncompleteDownload(stagingRoot, bundle); return { status: 'incomplete' }; } };
      expect(() => executeCampaignOperation({ operation: 'run', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, root: fixture.root, adapter }))
        .toThrow('First campaign launch requires');
      const token = deriveLaunchAuthorizationToken(manifest.evidenceHash, runtimeCeilings(manifest.manifest.runtime));
      expect(() => executeCampaignOperation({ operation: 'run', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, authorizationToken: token, root: fixture.root, adapter }))
        .toThrow('Campaign remains incomplete');
      expect(runCalls).toBe(1);
      const destination = path.join(fixture.root, 'download', 'operator-fixture', manifest.evidenceHash);
      expect(fs.existsSync(path.join(destination, 'state.json'))).toBe(true);
      fs.writeFileSync(path.join(destination, 'content-index.json'), 'must not be parsed by status');
      expect(executeCampaignOperation({ operation: 'status', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, root: fixture.root, adapter }))
        .toMatchObject({ localDownloadComplete: false });
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  });
});

describe('campaign local validation scale', () => {
  it('returns a compact result after validating a 6,375-chunk marker', () => {
    const root = fs.mkdtempSync(path.join(temporaryRoot(), 'hexdeck-campaign-validator-scale-'));
    try {
      const stageId = 'a'.repeat(64), stageRoot = path.join(root, 'kingdoms', 'k', 'matrix');
      const hashes: Record<string, string> = {}, content = Buffer.from('{}\n'), digest = sha(content);
      for (let index = 0; index < 6_375; index += 1) {
        const relative = `output/chunks/chunk-${String(index).padStart(6, '0')}.json`;
        const file = path.join(stageRoot, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content); hashes[relative] = digest;
      }
      const marker = createCampaignStageControlMarker({ stage: 'matrix', stageId, status: 'incomplete',
        reason: 'fixture interruption', artifactHashes: hashes });
      fs.mkdirSync(path.join(stageRoot, 'control'), { recursive: true });
      fs.writeFileSync(path.join(stageRoot, 'control', 'incomplete.json'), `${JSON.stringify(marker)}\n`);
      const result = spawnSync('npx', ['tsx', 'scripts/strategy_search_campaign_validate_stage.ts'], {
        cwd: process.cwd(), input: JSON.stringify({ campaignRoot: root, stage: 'matrix', stageId,
          stageRoot: 'kingdoms/k/matrix', expectedStatus: 'incomplete' }), encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      expect(Buffer.byteLength(result.stdout)).toBeLessThan(1_024);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'incomplete', artifactCount: 6_375 });
      expect(JSON.parse(result.stdout)).not.toHaveProperty('artifactHashes');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 30_000);
});

describe('campaign archive installation', () => {
  it('keeps 191,250 exact members behind one compact index-derived membership hash', () => {
    const stageId = 'f'.repeat(64);
    const entries = Array.from({ length: 191_250 }, (_unused, index) => ({
      path: `chunks/${String(index).padStart(6, '0')}.json`, bytes: index % 17,
      sha256: createHash('sha256').update(String(index)).digest('hex'), stageId,
      completeness: 'complete' as const }));
    const index = createCampaignContentIndex(entries), archive = { path: 'archives/matrix.tar', bytes: 1,
      sha256: 'a'.repeat(64), stageId, completeness: 'complete' as const,
      memberCount: entries.length, memberHash: campaignArchiveMemberHash(index.entries) };
    const manifest = createCampaignArchiveManifest(index, [archive]);
    expect(JSON.stringify(manifest).length).toBeLessThan(2_000);
    expect(manifest.archives[0]).not.toHaveProperty('members');
    expect(validateCampaignArchiveManifest(manifest, index)).toBe(true);
    expect(validateCampaignArchiveManifest({ ...manifest, schemaVersion: 1 }, index)).toBe(false);
    expect(validateCampaignArchiveManifest({ ...manifest,
      archives: [{ ...manifest.archives[0]!, unexpected: true }] }, index)).toBe(false);
    expect(() => createCampaignArchiveManifest(index, [{ ...archive, memberHash: 'b'.repeat(64) }]))
      .toThrow('compact membership differs');
  }, 30_000);

  it('validates archive/member hashes, resumes matching files, and preserves prior files on corruption', () => {
    const root = fs.mkdtempSync(path.join(temporaryRoot(), 'hexdeck-campaign-archive-'));
    const staging = path.join(root, 'staging'), destination = path.join(root, 'destination');
    fs.mkdirSync(path.join(staging, 'archives'), { recursive: true });
    try {
      const content = Buffer.from('saved evidence\n'), entry = { path: 'kingdoms/k/matrix/output/chunk.json',
        bytes: content.length, sha256: sha(content), stageId: 'a'.repeat(64), completeness: 'complete' as const };
      const index = createCampaignContentIndex([entry]), bytes = tar([{ path: entry.path, content }]);
      const archive = { path: 'archives/matrix.tar', bytes: bytes.length, sha256: sha(bytes),
        stageId: entry.stageId, completeness: entry.completeness, memberCount: 1,
        memberHash: campaignArchiveMemberHash([entry]) };
      const manifest = createCampaignArchiveManifest(index, [archive]);
      fs.writeFileSync(path.join(staging, archive.path), bytes);
      installCampaignArchives({ stagingRoot: staging, destinationRoot: destination, index,
        archiveManifest: manifest });
      const installed = path.join(destination, ...entry.path.split('/'));
      expect(fs.readFileSync(installed, 'utf8')).toBe('saved evidence\n');
      fs.rmSync(path.join(staging, archive.path));
      installCampaignArchives({ stagingRoot: staging, destinationRoot: destination, index,
        archiveManifest: manifest });
      fs.writeFileSync(path.join(staging, archive.path), Buffer.from('corrupt archive'));
      expect(() => installCampaignArchives({ stagingRoot: staging, destinationRoot: destination, index,
        archiveManifest: manifest })).toThrow('archive bytes differ');
      expect(fs.readFileSync(installed, 'utf8')).toBe('saved evidence\n');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects link members and local symlink traversal', () => {
    const root = fs.mkdtempSync(path.join(temporaryRoot(), 'hexdeck-campaign-link-'));
    const staging = path.join(root, 'staging'), destination = path.join(root, 'destination');
    fs.mkdirSync(path.join(staging, 'archives'), { recursive: true }); fs.mkdirSync(destination);
    try {
      const content = Buffer.from('x'), entry = { path: 'a/file.json', bytes: 1, sha256: sha(content),
        stageId: 'a'.repeat(64), completeness: 'incomplete' as const };
      const index = createCampaignContentIndex([entry]), bytes = tar([{ path: entry.path, content, type: 0x32 }]);
      const archive = { path: 'archives/link.tar', bytes: bytes.length, sha256: sha(bytes),
        stageId: entry.stageId, completeness: entry.completeness, memberCount: 1,
        memberHash: campaignArchiveMemberHash([entry]) };
      const manifest = createCampaignArchiveManifest(index, [archive]); fs.writeFileSync(path.join(staging, archive.path), bytes);
      expect(() => installCampaignArchives({ stagingRoot: staging, destinationRoot: destination, index,
        archiveManifest: manifest })).toThrow('link or non-file');
      fs.rmSync(path.join(staging, archive.path));
      const regular = tar([{ path: entry.path, content }]); fs.writeFileSync(path.join(staging, archive.path), regular);
      const regularManifest = createCampaignArchiveManifest(index, [{ ...archive, bytes: regular.length, sha256: sha(regular) }]);
      fs.symlinkSync(root, path.join(destination, 'a'));
      expect(() => installCampaignArchives({ stagingRoot: staging, destinationRoot: destination, index,
        archiveManifest: regularManifest })).toThrow('symlink');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
