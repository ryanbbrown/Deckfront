import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCampaignContentIndex } from '../src/sim/strategySearchCampaign';
import {
  campaignArchiveMemberHash, createCampaignArchiveManifest, installCampaignArchives
} from '../src/sim/strategySearchCampaignArchive';

const sha = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
function octal(value: number, length: number): Buffer {
  return Buffer.from(`${value.toString(8).padStart(length - 1, '0')}\0`, 'ascii');
}
function tar(files: readonly { path: string; content: Buffer }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(512), name = Buffer.from(file.path);
    if (name.length > 100) throw new Error(`Smoke archive path is too long: ${file.path}`);
    name.copy(header); octal(0o600, 8).copy(header, 100); octal(0, 8).copy(header, 108);
    octal(0, 8).copy(header, 116); octal(file.content.length, 12).copy(header, 124);
    octal(0, 12).copy(header, 136); header.fill(0x20, 148, 156); header[156] = 0x30;
    Buffer.from('ustar\0').copy(header, 257); Buffer.from('00').copy(header, 263);
    octal(header.reduce((sum, byte) => sum + byte, 0), 8).copy(header, 148);
    blocks.push(header, file.content, Buffer.alloc((512 - file.content.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024)); return Buffer.concat(blocks);
}

const count = 2_000, root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),
  'hexdeck-campaign-download-smoke-'));
const staging = path.join(root, 'staging'), destination = path.join(root, 'destination');
const started = performance.now();
try {
  fs.mkdirSync(path.join(staging, 'archives'), { recursive: true });
  const files = Array.from({ length: count }, (_unused, index) => ({
    path: `chunks/chunk-${String(index).padStart(4, '0')}.json`, content: Buffer.from(`${index}\n`) }));
  const stageId = 'e'.repeat(64), index = createCampaignContentIndex(files.map((file) => ({
    path: file.path, bytes: file.content.length, sha256: sha(file.content), stageId,
    completeness: 'complete' as const })));
  const bytes = tar(files), archive = { path: 'archives/chunks.tar', bytes: bytes.length,
    sha256: sha(bytes), stageId, completeness: 'complete' as const };
  const manifest = createCampaignArchiveManifest(index, [{ ...archive, memberCount: files.length,
    memberHash: campaignArchiveMemberHash(index.entries) }]);
  fs.writeFileSync(path.join(staging, archive.path), bytes);
  installCampaignArchives({ stagingRoot: staging, destinationRoot: destination, index,
    archiveManifest: manifest });
  if (fs.readFileSync(path.join(destination, 'chunks', 'chunk-1999.json'), 'utf8') !== '1999\n') {
    throw new Error('Campaign download smoke installed incorrect bytes.');
  }
  process.stdout.write(`${JSON.stringify({ files: count, archiveBytes: bytes.length,
    elapsedMs: performance.now() - started })}\n`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
