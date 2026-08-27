import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  createCampaignArchiveManifest, installCampaignArchives
} from '../../src/sim/strategySearchCampaignArchive';
import {
  createCampaignLaunchBundle
} from '../../src/sim/strategySearchCampaignOperator';
import {
  deriveTrackedCampaignSourceImage, executeCampaignOperation
} from '../../scripts/strategy_search_campaign';
import type { CampaignOperatorAdapter } from '../../scripts/strategy_search_campaign';

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
    members: [...contents.keys()] }]);
  fs.writeFileSync(path.join(stagingRoot, 'content-index.json'), `${JSON.stringify(index, null, 2)}\n`);
  fs.writeFileSync(path.join(stagingRoot, 'archives.json'), `${JSON.stringify(archives, null, 2)}\n`);
}

describe('campaign operator flow', () => {
  it('plans without a remote call and status uses only the bounded status seam', () => {
    const fixture = fixtureRoot(); let statusCalls = 0, runCalls = 0;
    const adapter: CampaignOperatorAdapter = { status() { statusCalls += 1; return { state: null,
      scheduler: null, contentIndex: null, archives: null, controllerCall: null }; },
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

  it('requires first-launch authorization and returns nonzero semantics for validated incomplete evidence', () => {
    const fixture = fixtureRoot(); let runCalls = 0;
    try {
      const manifest = parseStrategySearchCampaignManifest(JSON.parse(fs.readFileSync(fixture.manifestFile, 'utf8')));
      const adapter: CampaignOperatorAdapter = { status() { return { state: null, scheduler: null,
        contentIndex: null, archives: null, controllerCall: null }; }, run({ bundle, stagingRoot }) {
        runCalls += 1; writeIncompleteDownload(stagingRoot, bundle); return { status: 'incomplete' }; } };
      expect(() => executeCampaignOperation({ operation: 'run', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, root: fixture.root, adapter }))
        .toThrow('First campaign launch requires');
      const token = deriveLaunchAuthorizationToken(manifest.evidenceHash, runtimeCeilings(manifest.manifest.runtime));
      expect(() => executeCampaignOperation({ operation: 'run', manifestFile: fixture.manifestFile,
        selectionFile: fixture.selectionFile, authorizationToken: token, root: fixture.root, adapter }))
        .toThrow('Campaign remains incomplete');
      expect(runCalls).toBe(1);
      expect(fs.existsSync(path.join(fixture.root, 'download', 'operator-fixture', manifest.evidenceHash,
        'state.json'))).toBe(true);
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  });
});

describe('campaign archive installation', () => {
  it('validates archive/member hashes, resumes matching files, and preserves prior files on corruption', () => {
    const root = fs.mkdtempSync(path.join(temporaryRoot(), 'hexdeck-campaign-archive-'));
    const staging = path.join(root, 'staging'), destination = path.join(root, 'destination');
    fs.mkdirSync(path.join(staging, 'archives'), { recursive: true });
    try {
      const content = Buffer.from('saved evidence\n'), entry = { path: 'kingdoms/k/matrix/output/chunk.json',
        bytes: content.length, sha256: sha(content), stageId: 'a'.repeat(64), completeness: 'complete' as const };
      const index = createCampaignContentIndex([entry]), bytes = tar([{ path: entry.path, content }]);
      const archive = { path: 'archives/matrix.tar', bytes: bytes.length, sha256: sha(bytes),
        stageId: entry.stageId, completeness: entry.completeness, members: [entry.path] };
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
        stageId: entry.stageId, completeness: entry.completeness, members: [entry.path] };
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
