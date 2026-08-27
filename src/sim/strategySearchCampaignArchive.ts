import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  contentIndexDestination, normalizedRelativePath, validateCampaignContentIndex
} from './strategySearchCampaign';
import type {
  CampaignContentIndex, CampaignContentIndexEntry
} from './strategySearchCampaign';

const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const exact = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: object, keys: readonly string[]): boolean =>
  exact(Object.keys(value).sort(), [...keys].sort());
const canonical = (value: unknown): string => JSON.stringify(sort(value));
function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (object(value)) return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, held]) => [key, sort(held)]));
  return value;
}
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const fileDigest = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export interface CampaignArchiveEntry {
  path: string; bytes: number; sha256: string; stageId: string;
  completeness: 'complete' | 'incomplete' | 'terminal-incomplete'; members: string[];
}
export interface CampaignArchiveManifest {
  schemaVersion: 1; indexHash: string; archives: CampaignArchiveEntry[]; manifestHash: string;
}
const ARCHIVE_KEYS = ['path', 'bytes', 'sha256', 'stageId', 'completeness', 'members'] as const;
export function createCampaignArchiveManifest(index: CampaignContentIndex,
  archives: readonly CampaignArchiveEntry[]): CampaignArchiveManifest {
  if (!validateCampaignContentIndex(index) || !archives.length) throw new Error('Campaign archive input is invalid.');
  const indexed = new Map(index.entries.map((entry) => [entry.path, entry])), used = new Set<string>();
  const held = archives.map((archive) => {
    if (!object(archive) || !exactKeys(archive, ARCHIVE_KEYS) || !Number.isSafeInteger(archive.bytes)
      || archive.bytes < 1 || !sha(archive.sha256) || !sha(archive.stageId)
      || !['complete', 'incomplete', 'terminal-incomplete'].includes(archive.completeness)
      || !Array.isArray(archive.members) || !archive.members.length) throw new Error('Campaign archive entry is invalid.');
    const archivePath = normalizedRelativePath(archive.path);
    const members = archive.members.map(normalizedRelativePath);
    if (new Set(members).size !== members.length || members.some((member) => !indexed.has(member)
      || used.has(member))) throw new Error('Campaign archive members collide or are not indexed.');
    members.forEach((member) => used.add(member));
    const evidence = members.map((member) => indexed.get(member)!);
    if (evidence.some((entry) => entry.stageId !== archive.stageId
      || entry.completeness !== archive.completeness)) throw new Error('Campaign archive stage identity differs.');
    return { ...archive, path: archivePath, members: [...members].sort() };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (used.size !== indexed.size || new Set(held.map((entry) => entry.path.toLocaleLowerCase('en-US'))).size
    !== held.length) throw new Error('Campaign archives do not cover the exact content index.');
  const base = { schemaVersion: 1 as const, indexHash: index.indexHash, archives: held, manifestHash: '' };
  return { ...base, manifestHash: digest(base) };
}
export function validateCampaignArchiveManifest(value: unknown, index: CampaignContentIndex):
  value is CampaignArchiveManifest {
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'indexHash', 'archives', 'manifestHash'])) return false;
  try {
    const held = value as unknown as CampaignArchiveManifest;
    return exact(held, createCampaignArchiveManifest(index, held.archives));
  } catch { return false; }
}

function parseOctal(buffer: Buffer, start: number, length: number): number {
  const text = buffer.subarray(start, start + length).toString('ascii').replaceAll('\0', '').trim();
  if (!/^[0-7]+$/.test(text)) throw new Error('Campaign archive has an invalid octal field.');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Campaign archive octal field exceeds limits.');
  return value;
}
function tarName(header: Buffer): string {
  const field = (start: number, length: number): string => header.subarray(start, start + length)
    .toString('utf8').replace(/\0.*$/s, '');
  const name = field(0, 100), prefix = field(345, 155);
  return normalizedRelativePath(prefix ? `${prefix}/${name}` : name);
}
function assertNoSymlinkComponents(target: string): void {
  const absolute = path.resolve(target), parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Campaign path contains a symlink: ${cursor}`);
    }
  }
}
function assertNoSymlinkPath(root: string, destination: string): void {
  const resolvedRoot = path.resolve(root), relative = path.relative(resolvedRoot, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Campaign destination escapes its root.');
  let cursor = resolvedRoot;
  if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Campaign destination root is a symlink.');
  for (const component of relative.split(path.sep).slice(0, -1)) {
    cursor = path.join(cursor, component);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Campaign destination contains a symlink: ${cursor}`);
    }
  }
}
function sameLocalFile(file: string, entry: CampaignContentIndexEntry): boolean {
  return fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink()
    && fs.statSync(file).size === entry.bytes && fileDigest(file) === entry.sha256;
}
function extractArchive(input: { archiveFile: string; archive: CampaignArchiveEntry;
  entries: Map<string, CampaignContentIndexEntry>; destinationRoot: string }): void {
  const descriptor = fs.openSync(input.archiveFile, 'r'); let offset = 0, zeroBlocks = 0;
  const seen = new Set<string>(), expectedMembers = new Set(input.archive.members);
  try {
    const archiveBytes = fs.fstatSync(descriptor).size;
    while (offset + 512 <= archiveBytes) {
      const header = Buffer.alloc(512); fs.readSync(descriptor, header, 0, 512, offset); offset += 512;
      if (header.every((byte) => byte === 0)) { zeroBlocks += 1; if (zeroBlocks === 2) break; continue; }
      if (zeroBlocks) throw new Error('Campaign archive has data after an end block.');
      const heldChecksum = parseOctal(header, 148, 8), checksumHeader = Buffer.from(header);
      checksumHeader.fill(0x20, 148, 156);
      if (checksumHeader.reduce((sum, byte) => sum + byte, 0) !== heldChecksum) {
        throw new Error('Campaign archive header checksum differs.');
      }
      const type = header[156];
      if (type !== 0 && type !== 0x30) throw new Error('Campaign archive contains a link or non-file member.');
      const member = tarName(header), size = parseOctal(header, 124, 12), entry = input.entries.get(member);
      if (!entry || !expectedMembers.has(member) || seen.has(member) || size !== entry.bytes) {
        throw new Error(`Campaign archive member is unexpected, duplicated, or has a wrong size: ${member}`);
      }
      seen.add(member);
      const destination = contentIndexDestination(input.destinationRoot, member);
      assertNoSymlinkPath(input.destinationRoot, destination);
      const keep = sameLocalFile(destination, entry), temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const output = keep ? null : fs.openSync(temporary, 'wx', 0o600), memberHash = createHash('sha256');
      try {
        try {
          let remaining = size;
          while (remaining) {
            const length = Math.min(1024 * 1024, remaining), chunk = Buffer.alloc(length);
            const read = fs.readSync(descriptor, chunk, 0, length, offset);
            if (read !== length) throw new Error(`Campaign archive member is truncated: ${member}`);
            memberHash.update(chunk); if (output !== null) fs.writeSync(output, chunk); offset += length; remaining -= length;
          }
          if (output !== null) fs.fsyncSync(output);
        } finally { if (output !== null) fs.closeSync(output); }
        if (memberHash.digest('hex') !== entry.sha256) {
          throw new Error(`Campaign archive member hash differs: ${member}`);
        }
        if (output !== null) fs.renameSync(temporary, destination);
      } catch (error) {
        if (output !== null) fs.rmSync(temporary, { force: true });
        throw error;
      }
      const padding = (512 - size % 512) % 512;
      if (offset + padding > archiveBytes) throw new Error('Campaign archive padding is truncated.');
      offset += padding;
    }
    if (zeroBlocks !== 2 || !exact([...seen].sort(), [...input.archive.members].sort())) {
      throw new Error('Campaign archive coverage is incomplete.');
    }
    const tail = Buffer.alloc(Math.max(0, fs.fstatSync(descriptor).size - offset));
    if (tail.length) fs.readSync(descriptor, tail, 0, tail.length, offset);
    if (tail.some((byte) => byte !== 0)) throw new Error('Campaign archive has nonzero trailing bytes.');
  } finally { fs.closeSync(descriptor); }
}

export function installCampaignArchives(input: { stagingRoot: string; destinationRoot: string;
  index: CampaignContentIndex; archiveManifest: CampaignArchiveManifest }): void {
  if (!validateCampaignContentIndex(input.index)
    || !validateCampaignArchiveManifest(input.archiveManifest, input.index)) {
    throw new Error('Campaign download index or archive manifest is invalid.');
  }
  assertNoSymlinkComponents(input.destinationRoot);
  fs.mkdirSync(input.destinationRoot, { recursive: true });
  if (fs.lstatSync(input.destinationRoot).isSymbolicLink()) throw new Error('Campaign download root is a symlink.');
  const entries = new Map(input.index.entries.map((entry) => [entry.path, entry]));
  for (const archive of input.archiveManifest.archives) {
    const archiveFile = contentIndexDestination(input.stagingRoot, archive.path);
    assertNoSymlinkPath(input.stagingRoot, archiveFile);
    if (!fs.existsSync(archiveFile)) {
      const complete = archive.members.every((member) => {
        const entry = entries.get(member)!;
        const destination = contentIndexDestination(input.destinationRoot, member);
        assertNoSymlinkPath(input.destinationRoot, destination);
        return sameLocalFile(destination, entry);
      });
      if (complete) continue;
      throw new Error(`Campaign archive is missing for incomplete local members: ${archive.path}`);
    }
    if (fs.lstatSync(archiveFile).isSymbolicLink() || fs.statSync(archiveFile).size !== archive.bytes
      || fileDigest(archiveFile) !== archive.sha256) throw new Error(`Campaign archive bytes differ: ${archive.path}`);
    extractArchive({ archiveFile, archive, entries, destinationRoot: input.destinationRoot });
  }
  for (const entry of input.index.entries) {
    const file = contentIndexDestination(input.destinationRoot, entry.path);
    assertNoSymlinkPath(input.destinationRoot, file);
    if (!sameLocalFile(file, entry)) throw new Error(`Installed campaign content differs: ${entry.path}`);
  }
}
