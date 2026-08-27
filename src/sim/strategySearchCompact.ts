import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  combineScoreEvidence, compareRankedRecords, compareStageOneRecords, deriveScoreEvidence,
  fixedJson, rankingKey, validateOrderedProductRankedRecord, validateOrderedProductStageOneRecord
} from './orderedGoldfishProduct';
import type {
  OrderedProductProfileEvidence, OrderedProductRankedRecord, OrderedProductScoreEvidence,
  OrderedProductStageOneRecord
} from './orderedGoldfishProduct';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export const COMPACT_GOLDFISH_SCHEMA_VERSION = 1 as const;
export const COMPACT_GOLDFISH_HEADER_BYTES = 512;
export const COMPACT_GOLDFISH_RECORD_BYTES = 96;
export const COMPACT_DISPLAY_ID_CODE_UNITS = 16;
export const COMPACT_GOLDFISH_MAGIC = 'HGS1' as const;
export type CompactGoldfishStage = 'stage-one' | 'stage-two';
const METRICS_PER_PROFILE = 5;
const PROFILE_COUNT = 3;
const METRIC_COUNT = METRICS_PER_PROFILE * PROFILE_COUNT;
const PROFILES = ['stationary', 'chaser', 'kiter'] as const;

export interface CompactScoreRecord {
  traversalPosition: number;
  displayId: string;
  profiles: OrderedProductProfileEvidence[];
}
export interface CompactScoreHeader {
  schemaVersion: 1; magic: typeof COMPACT_GOLDFISH_MAGIC; stage: CompactGoldfishStage;
  evidenceId: string; semanticStart: number; semanticEnd: number; recordCount: number;
  recordBytes: typeof COMPACT_GOLDFISH_RECORD_BYTES; payloadSha256: string;
}
function uint32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`Compact ${label} is outside uint32.`);
  }
}
function profileMetrics(record: CompactScoreRecord): number[] {
  if (record.profiles.length !== PROFILE_COUNT) throw new Error('Compact record needs three profiles.');
  return record.profiles.flatMap((profile, index) => {
    if (profile.profile !== PROFILES[index]) throw new Error('Compact profile order differs.');
    const values = [profile.trials, profile.completions, profile.penalizedTurnsTo50,
      profile.damageArea, profile.moneySpent];
    values.forEach((value) => uint32(value, 'profile metric'));
    return values;
  });
}
function validDisplayId(displayId: string): boolean {
  return displayId.length > 0 && displayId.length <= COMPACT_DISPLAY_ID_CODE_UNITS && !displayId.includes('\0')
    && [...displayId].every((character) => character.codePointAt(0)! <= 0xffff);
}
export function encodeCompactScoreRecord(record: CompactScoreRecord): Buffer {
  uint32(record.traversalPosition, 'traversal position');
  if (!validDisplayId(record.displayId)) throw new Error('Compact display ID exceeds its fixed UTF-16 field.');
  const buffer = Buffer.alloc(COMPACT_GOLDFISH_RECORD_BYTES);
  buffer.writeUInt32BE(record.traversalPosition, 0);
  profileMetrics(record).forEach((value, index) => buffer.writeUInt32BE(value, 4 + index * 4));
  for (let index = 0; index < COMPACT_DISPLAY_ID_CODE_UNITS; index += 1) {
    buffer.writeUInt16BE(index < record.displayId.length ? record.displayId.charCodeAt(index) : 0, 64 + index * 2);
  }
  return buffer;
}
export function decodeCompactScoreRecord(buffer: Uint8Array): CompactScoreRecord {
  if (buffer.byteLength !== COMPACT_GOLDFISH_RECORD_BYTES) throw new Error('Compact record byte length differs.');
  const held = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const metrics = Array.from({ length: METRIC_COUNT }, (_unused, index) => held.readUInt32BE(4 + index * 4));
  const profiles = PROFILES.map((profile, index): OrderedProductProfileEvidence => ({ profile,
    trials: metrics[index * METRICS_PER_PROFILE]!, completions: metrics[index * METRICS_PER_PROFILE + 1]!,
    penalizedTurnsTo50: metrics[index * METRICS_PER_PROFILE + 2]!,
    damageArea: metrics[index * METRICS_PER_PROFILE + 3]!, moneySpent: metrics[index * METRICS_PER_PROFILE + 4]! }));
  const codeUnits = Array.from({ length: COMPACT_DISPLAY_ID_CODE_UNITS }, (_unused, index) =>
    held.readUInt16BE(64 + index * 2));
  const padding = codeUnits.indexOf(0);
  if (padding === 0 || padding >= 0 && codeUnits.slice(padding).some((value) => value !== 0)) {
    throw new Error('Compact display ID padding differs.');
  }
  const displayId = String.fromCharCode(...(padding < 0 ? codeUnits : codeUnits.slice(0, padding)));
  const record = { traversalPosition: held.readUInt32BE(0), displayId, profiles };
  profileMetrics(record);
  return record;
}
export function compactScoreEvidence(record: CompactScoreRecord): OrderedProductScoreEvidence {
  return deriveScoreEvidence(record.profiles);
}
export function compareCompactScoreRecords(left: CompactScoreRecord, right: CompactScoreRecord,
  canonicalAt?: (position: number) => string): number {
  const leftEvidence = compactScoreEvidence(left), rightEvidence = compactScoreEvidence(right);
  const evidence = rightEvidence.worstCompletions - leftEvidence.worstCompletions
    || rightEvidence.totalCompletions - leftEvidence.totalCompletions
    || leftEvidence.worstPenalizedTurnsTo50 - rightEvidence.worstPenalizedTurnsTo50
    || leftEvidence.totalPenalizedTurnsTo50 - rightEvidence.totalPenalizedTurnsTo50
    || rightEvidence.worstDamageArea - leftEvidence.worstDamageArea
    || rightEvidence.totalDamageArea - leftEvidence.totalDamageArea
    || rightEvidence.totalMoneySpent - leftEvidence.totalMoneySpent;
  if (evidence) return evidence;
  const display = compareUtf16(left.displayId, right.displayId);
  if (display) return display;
  if (canonicalAt) {
    const canonical = compareUtf16(canonicalAt(left.traversalPosition), canonicalAt(right.traversalPosition));
    if (canonical) return canonical;
  }
  return left.traversalPosition - right.traversalPosition;
}
function encodeHeader(header: CompactScoreHeader): Buffer {
  const json = Buffer.from(JSON.stringify(header));
  if (json.length > COMPACT_GOLDFISH_HEADER_BYTES - 8) throw new Error('Compact header exceeds its fixed bound.');
  const bytes = Buffer.alloc(COMPACT_GOLDFISH_HEADER_BYTES);
  bytes.write(COMPACT_GOLDFISH_MAGIC, 0, 'ascii'); bytes.writeUInt32BE(json.length, 4); json.copy(bytes, 8);
  return bytes;
}
function decodeHeader(bytes: Buffer): CompactScoreHeader {
  if (bytes.length !== COMPACT_GOLDFISH_HEADER_BYTES || bytes.subarray(0, 4).toString('ascii') !== COMPACT_GOLDFISH_MAGIC) {
    throw new Error('Compact score header magic differs.');
  }
  const length = bytes.readUInt32BE(4);
  if (length < 2 || length > COMPACT_GOLDFISH_HEADER_BYTES - 8
    || bytes.subarray(8 + length).some((value) => value !== 0)) throw new Error('Compact score header padding differs.');
  const value = JSON.parse(bytes.subarray(8, 8 + length).toString('utf8')) as CompactScoreHeader;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['schemaVersion', 'magic', 'stage',
    'evidenceId', 'semanticStart', 'semanticEnd', 'recordCount', 'recordBytes', 'payloadSha256'].sort())
    || value.schemaVersion !== 1 || value.magic !== COMPACT_GOLDFISH_MAGIC
    || !['stage-one', 'stage-two'].includes(value.stage) || !/^[0-9a-f]{64}$/.test(value.evidenceId)
    || !Number.isSafeInteger(value.semanticStart) || value.semanticStart < 0
    || !Number.isSafeInteger(value.semanticEnd) || value.semanticEnd <= value.semanticStart
    || value.recordCount !== value.semanticEnd - value.semanticStart
    || value.recordBytes !== COMPACT_GOLDFISH_RECORD_BYTES || !/^[0-9a-f]{64}$/.test(value.payloadSha256)) {
    throw new Error('Compact score header is invalid.');
  }
  return value;
}
export function writeCompactScoreFile(input: { file: string; evidenceId: string; stage: CompactGoldfishStage;
  semanticStart: number; semanticEnd: number; records: readonly CompactScoreRecord[];
  canonicalAt?: (position: number) => string }): CompactScoreHeader {
  if (!/^[0-9a-f]{64}$/.test(input.evidenceId) || input.records.length !== input.semanticEnd - input.semanticStart) {
    throw new Error('Compact score file identity or coverage differs.');
  }
  const ordered = [...input.records].sort((left, right) => compareCompactScoreRecords(left, right, input.canonicalAt));
  const positions = new Uint8Array(input.records.length), payloadHash = createHash('sha256');
  const temporary = `${input.file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(input.file), { recursive: true });
  const descriptor = fs.openSync(temporary, 'w');
  try {
    fs.writeSync(descriptor, Buffer.alloc(COMPACT_GOLDFISH_HEADER_BYTES));
    for (const record of ordered) {
      const offset = record.traversalPosition - input.semanticStart;
      if (offset < 0 || offset >= positions.length || positions[offset]) throw new Error('Compact score positions overlap or escape the range.');
      positions[offset] = 1;
      const encoded = encodeCompactScoreRecord(record); fs.writeSync(descriptor, encoded); payloadHash.update(encoded);
    }
    if (positions.some((value) => value !== 1)) throw new Error('Compact score positions do not cover the range.');
    const header: CompactScoreHeader = { schemaVersion: 1, magic: COMPACT_GOLDFISH_MAGIC, stage: input.stage,
      evidenceId: input.evidenceId, semanticStart: input.semanticStart, semanticEnd: input.semanticEnd,
      recordCount: input.records.length, recordBytes: COMPACT_GOLDFISH_RECORD_BYTES,
      payloadSha256: payloadHash.digest('hex') };
    fs.writeSync(descriptor, encodeHeader(header), 0, COMPACT_GOLDFISH_HEADER_BYTES, 0); fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); fs.renameSync(temporary, input.file); return header;
  } catch (error) { try { fs.closeSync(descriptor); } catch { /* already closed */ } fs.rmSync(temporary, { force: true }); throw error; }
}
export function readCompactScoreFile(file: string, input?: { evidenceId?: string; stage?: CompactGoldfishStage;
  canonicalAt?: (position: number) => string }): { header: CompactScoreHeader; records: CompactScoreRecord[] } {
  const descriptor = fs.openSync(file, 'r');
  try {
    const headerBytes = Buffer.alloc(COMPACT_GOLDFISH_HEADER_BYTES);
    if (fs.readSync(descriptor, headerBytes, 0, headerBytes.length, 0) !== headerBytes.length) throw new Error('Compact score header is truncated.');
    const header = decodeHeader(headerBytes);
    if (input?.evidenceId && header.evidenceId !== input.evidenceId || input?.stage && header.stage !== input.stage) {
      throw new Error('Compact score semantic identity differs.');
    }
    const expectedBytes = COMPACT_GOLDFISH_HEADER_BYTES + header.recordCount * COMPACT_GOLDFISH_RECORD_BYTES;
    if (fs.fstatSync(descriptor).size !== expectedBytes) throw new Error('Compact score file byte length differs.');
    const hash = createHash('sha256'), records: CompactScoreRecord[] = [], positions = new Uint8Array(header.recordCount);
    for (let index = 0; index < header.recordCount; index += 1) {
      const bytes = Buffer.allocUnsafe(COMPACT_GOLDFISH_RECORD_BYTES);
      fs.readSync(descriptor, bytes, 0, bytes.length, COMPACT_GOLDFISH_HEADER_BYTES + index * bytes.length);
      hash.update(bytes); const record = decodeCompactScoreRecord(bytes), offset = record.traversalPosition - header.semanticStart;
      if (offset < 0 || offset >= positions.length || positions[offset]) throw new Error('Compact score positions overlap.');
      positions[offset] = 1;
      if (records.length && compareCompactScoreRecords(records.at(-1)!, record, input?.canonicalAt) > 0) {
        throw new Error('Compact score records are not sorted.');
      }
      records.push(record);
    }
    if (positions.some((value) => value !== 1) || hash.digest('hex') !== header.payloadSha256) {
      throw new Error('Compact score coverage or checksum differs.');
    }
    return { header, records };
  } finally { fs.closeSync(descriptor); }
}

interface CompactCursor {
  descriptor: number; header: CompactScoreHeader; index: number; hash: ReturnType<typeof createHash>;
  positions: Uint8Array; previous?: CompactScoreRecord;
}
interface HeapEntry { record: CompactScoreRecord; source: number }
function openCompactCursor(file: string, evidenceId: string, stage: CompactGoldfishStage): CompactCursor {
  const descriptor = fs.openSync(file, 'r'), bytes = Buffer.alloc(COMPACT_GOLDFISH_HEADER_BYTES);
  if (fs.readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error('Compact cursor header is truncated.');
  const header = decodeHeader(bytes);
  if (header.evidenceId !== evidenceId || header.stage !== stage
    || fs.fstatSync(descriptor).size !== COMPACT_GOLDFISH_HEADER_BYTES
      + header.recordCount * COMPACT_GOLDFISH_RECORD_BYTES) throw new Error('Compact cursor identity or length differs.');
  return { descriptor, header, index: 0, hash: createHash('sha256'), positions: new Uint8Array(header.recordCount) };
}
function cursorNext(cursor: CompactCursor, canonicalAt?: (position: number) => string): CompactScoreRecord | undefined {
  if (cursor.index === cursor.header.recordCount) {
    if (cursor.positions.some((value) => value !== 1) || cursor.hash.digest('hex') !== cursor.header.payloadSha256) {
      throw new Error('Compact cursor coverage or checksum differs.');
    }
    return undefined;
  }
  const bytes = Buffer.allocUnsafe(COMPACT_GOLDFISH_RECORD_BYTES);
  fs.readSync(cursor.descriptor, bytes, 0, bytes.length,
    COMPACT_GOLDFISH_HEADER_BYTES + cursor.index * COMPACT_GOLDFISH_RECORD_BYTES);
  cursor.hash.update(bytes); cursor.index += 1;
  const record = decodeCompactScoreRecord(bytes), offset = record.traversalPosition - cursor.header.semanticStart;
  if (offset < 0 || offset >= cursor.positions.length || cursor.positions[offset]) throw new Error('Compact cursor positions overlap.');
  cursor.positions[offset] = 1;
  if (cursor.previous && compareCompactScoreRecords(cursor.previous, record, canonicalAt) > 0) {
    throw new Error('Compact cursor records are not sorted.');
  }
  cursor.previous = record; return record;
}
export function reduceCompactStageOne(input: { files: readonly string[]; evidenceId: string; total: number;
  retainCount: number; collisionAllowance: number; strategyAt: (position: number) => Strategy;
  onIntermediateReadMs?: (milliseconds: number) => void }): OrderedProductStageOneRecord[] {
  const cursors = input.files.map((file) => openCompactCursor(file, input.evidenceId, 'stage-one'));
  const byStart = [...cursors].sort((left, right) => left.header.semanticStart - right.header.semanticStart);
  let coverage = 0;
  for (const stream of byStart) {
    if (stream.header.semanticStart !== coverage) throw new Error('Compact reducer coverage has a gap or overlap.');
    coverage = stream.header.semanticEnd;
  }
  if (coverage !== input.total) throw new Error('Compact reducer coverage is incomplete.');
  const canonicalAt = (position: number): string => canonicalStrategy(input.strategyAt(position));
  const compare = (left: HeapEntry, right: HeapEntry): number =>
    compareCompactScoreRecords(left.record, right.record, canonicalAt);
  const heap: HeapEntry[] = [];
  const push = (entry: HeapEntry): void => {
    heap.push(entry); let index = heap.length - 1;
    while (index > 0) { const parent = Math.floor((index - 1) / 2);
      if (compare(heap[index]!, heap[parent]!) >= 0) break;
      [heap[index], heap[parent]] = [heap[parent]!, heap[index]!]; index = parent; }
  };
  const pop = (): HeapEntry => {
    const first = heap[0]!, last = heap.pop()!;
    if (heap.length) { heap[0] = last; let index = 0;
      for (;;) { const left = index * 2 + 1, right = left + 1; let best = index;
        if (left < heap.length && compare(heap[left]!, heap[best]!) < 0) best = left;
        if (right < heap.length && compare(heap[right]!, heap[best]!) < 0) best = right;
        if (best === index) break;
        [heap[index], heap[best]] = [heap[best]!, heap[index]!]; index = best; }
    }
    return first;
  };
  const retained: OrderedProductStageOneRecord[] = [], seenDisplay = new Set<string>(), seenCanonical = new Set<string>();
  let collisionDrops = 0;
  let readMs = 0;
  const readNext = (cursor: CompactCursor): CompactScoreRecord | undefined => {
    const started = performance.now(), record = cursorNext(cursor, canonicalAt);
    readMs += performance.now() - started; return record;
  };
  heap.length = 0;
  cursors.forEach((cursor, source) => { const record = readNext(cursor);
    if (record) push({ record, source }); });
  try {
    while (heap.length) {
      const entry = pop(), compact = entry.record;
      if (retained.length < input.retainCount) {
        const strategy = input.strategyAt(compact.traversalPosition), canonical = canonicalStrategy(strategy);
        if (strategy.id !== compact.displayId) throw new Error('Compact display ID differs from reconstructed strategy.');
        if (seenDisplay.has(compact.displayId) || seenCanonical.has(canonical)) {
          collisionDrops += 1;
          if (collisionDrops > input.collisionAllowance) throw new Error('Compact collision allowance is exhausted.');
        } else {
          seenDisplay.add(compact.displayId); seenCanonical.add(canonical);
          const stageOne = compactScoreEvidence(compact);
          retained.push({ traversalPosition: compact.traversalPosition, displayId: compact.displayId,
            canonicalStrategy: canonical, strategy, stageOne, stageOneRankingKey: rankingKey(stageOne) });
        }
      }
      const next = readNext(cursors[entry.source]!);
      if (next) push({ record: next, source: entry.source });
    }
  } finally {
    cursors.forEach((cursor) => fs.closeSync(cursor.descriptor));
    input.onIntermediateReadMs?.(readMs);
  }
  if (retained.length !== input.retainCount) throw new Error('Compact stage one retained set is incomplete.');
  return retained;
}
export function readCompactStageTwoFiles(input: { files: readonly string[]; evidenceId: string;
  total: number }): CompactScoreRecord[] {
  const streams = input.files.map((file) => readCompactScoreFile(file,
    { evidenceId: input.evidenceId, stage: 'stage-two' }));
  const ordered = [...streams].sort((left, right) => left.header.semanticStart - right.header.semanticStart);
  let covered = 0;
  for (const stream of ordered) {
    if (stream.header.semanticStart !== covered) throw new Error('Compact stage-two coverage has a gap or overlap.');
    covered = stream.header.semanticEnd;
  }
  if (covered !== input.total) throw new Error('Compact stage-two coverage is incomplete.');
  return ordered.flatMap((stream) => stream.records);
}
export function reduceCompactStageTwo(input: { stageOne: readonly OrderedProductStageOneRecord[];
  additional: readonly CompactScoreRecord[]; reservoirCount: number }): OrderedProductRankedRecord[] {
  const firstByOrdinal = new Map(input.stageOne.map((record, index) => [index,
    { record, stageOneRank: index + 1 }]));
  if (firstByOrdinal.size !== input.stageOne.length || input.additional.length !== input.stageOne.length) {
    throw new Error('Compact stage two membership differs from stage one.');
  }
  const seenOrdinals = new Set<number>();
  const records = input.additional.map((compact): OrderedProductRankedRecord => {
    if (seenOrdinals.has(compact.traversalPosition)) throw new Error('Compact stage two repeats an ordinal.');
    seenOrdinals.add(compact.traversalPosition);
    const first = firstByOrdinal.get(compact.traversalPosition);
    if (!first || compact.displayId !== first.record.displayId) throw new Error('Compact stage two identity differs.');
    const additional = compactScoreEvidence(compact), combined = combineScoreEvidence(first.record.stageOne, additional);
    return { ...first.record, additional, combined, combinedRankingKey: rankingKey(combined),
      stageOneRank: first.stageOneRank, rank: 0 };
  }).sort(compareRankedRecords);
  const seenDisplay = new Set<string>(), seenCanonical = new Set<string>();
  for (const record of records) {
    if (seenDisplay.has(record.displayId) || seenCanonical.has(record.canonicalStrategy)) {
      throw new Error('Compact stage two contains duplicate scientific identity.');
    }
    seenDisplay.add(record.displayId); seenCanonical.add(record.canonicalStrategy);
  }
  records.forEach((record, index) => { record.rank = index + 1; });
  if (input.reservoirCount < 1 || input.reservoirCount > records.length) throw new Error('Reservoir count is invalid.');
  return records;
}
export function referenceGoldfishReduction(input: { stageOne: readonly OrderedProductStageOneRecord[];
  additionalByPosition: ReadonlyMap<number, OrderedProductScoreEvidence>; retainedCount: number;
  reservoirCount: number }): { stageOne: OrderedProductStageOneRecord[]; ranked: OrderedProductRankedRecord[];
  reservoir: OrderedProductRankedRecord[] } {
  const displays = new Set<string>(), canonicals = new Set<string>();
  const stageOne = [...input.stageOne].sort(compareStageOneRecords).filter((record) => {
    if (displays.has(record.displayId) || canonicals.has(record.canonicalStrategy)) return false;
    displays.add(record.displayId); canonicals.add(record.canonicalStrategy); return true;
  }).slice(0, input.retainedCount);
  const ranked = stageOne.map((record, index): OrderedProductRankedRecord => {
    const additional = input.additionalByPosition.get(record.traversalPosition);
    if (!additional) throw new Error('Reference reduction additional score is missing.');
    const combined = combineScoreEvidence(record.stageOne, additional);
    return { ...record, additional, combined, combinedRankingKey: rankingKey(combined),
      stageOneRank: index + 1, rank: 0 };
  }).sort(compareRankedRecords);
  ranked.forEach((record, index) => { record.rank = index + 1; });
  return { stageOne, ranked, reservoir: ranked.slice(0, input.reservoirCount) };
}
export interface GoldfishArtifactV3 {
  schemaVersion: 3; experiment: 'strategy-search-goldfish'; evidenceId: string; kingdomId: string;
  candidateCount: number; seeds: number[]; retainedCount: number; reservoirCount: number;
  records: Array<OrderedProductStageOneRecord & { stageOneRank: number }>; artifactHash: string;
}
export interface GoldfishReservoirV3 {
  schemaVersion: 3; experiment: 'strategy-search-goldfish-reservoir'; evidenceId: string;
  sourceArtifactHash: string; entries: OrderedProductRankedRecord[]; artifactHash: string;
}
function seal<T extends { artifactHash: string }>(value: T): string {
  const copy = structuredClone(value); copy.artifactHash = '';
  return createHash('sha256').update(fixedJson(copy)).digest('hex');
}
export function createGoldfishArtifactV3(input: Omit<GoldfishArtifactV3,
  'schemaVersion' | 'experiment' | 'artifactHash' | 'records'> & {
    records: readonly OrderedProductStageOneRecord[] }): GoldfishArtifactV3 {
  const base = { schemaVersion: 3 as const, experiment: 'strategy-search-goldfish' as const,
    ...structuredClone(input), records: input.records.map((record, index) => ({ ...structuredClone(record),
      stageOneRank: index + 1 })), artifactHash: '' };
  return { ...base, artifactHash: seal(base) };
}
export function createGoldfishReservoirV3(input: Omit<GoldfishReservoirV3,
  'schemaVersion' | 'experiment' | 'artifactHash'>): GoldfishReservoirV3 {
  const base = { schemaVersion: 3 as const, experiment: 'strategy-search-goldfish-reservoir' as const,
    ...structuredClone(input), artifactHash: '' };
  return { ...base, artifactHash: seal(base) };
}
export function validateGoldfishArtifactV3(value: unknown): value is GoldfishArtifactV3 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const held = value as GoldfishArtifactV3;
    if (JSON.stringify(Object.keys(held).sort()) !== JSON.stringify(['schemaVersion', 'experiment', 'evidenceId',
      'kingdomId', 'candidateCount', 'seeds', 'retainedCount', 'reservoirCount', 'records', 'artifactHash'].sort())
      || held.schemaVersion !== 3 || held.experiment !== 'strategy-search-goldfish'
      || !/^[0-9a-f]{64}$/.test(held.evidenceId) || !held.kingdomId
      || !Number.isSafeInteger(held.candidateCount) || held.candidateCount < 1
      || !Array.isArray(held.seeds) || !held.seeds.length || new Set(held.seeds).size !== held.seeds.length
      || held.seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)
      || held.retainedCount !== held.records.length || held.reservoirCount < 1
      || held.reservoirCount > held.retainedCount || seal(held) !== held.artifactHash) return false;
    const displays = new Set<string>(), canonicals = new Set<string>(), positions = new Set<number>();
    return held.records.every((record, index) => record.stageOneRank === index + 1
      && validateOrderedProductStageOneRecord(record)
      && (index === 0 || compareStageOneRecords(held.records[index - 1]!, record) < 0)
      && !displays.has(record.displayId) && !canonicals.has(record.canonicalStrategy)
      && !positions.has(record.traversalPosition)
      && Boolean(displays.add(record.displayId)) && Boolean(canonicals.add(record.canonicalStrategy))
      && Boolean(positions.add(record.traversalPosition)));
  } catch { return false; }
}
export function validateGoldfishReservoirV3(value: unknown,
  source?: GoldfishArtifactV3): value is GoldfishReservoirV3 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const held = value as GoldfishReservoirV3;
    if (JSON.stringify(Object.keys(held).sort()) !== JSON.stringify(['schemaVersion', 'experiment', 'evidenceId',
      'sourceArtifactHash', 'entries', 'artifactHash'].sort()) || held.schemaVersion !== 3
      || held.experiment !== 'strategy-search-goldfish-reservoir' || !/^[0-9a-f]{64}$/.test(held.evidenceId)
      || !/^[0-9a-f]{64}$/.test(held.sourceArtifactHash) || !held.entries.length || seal(held) !== held.artifactHash
      || source && (!validateGoldfishArtifactV3(source) || source.evidenceId !== held.evidenceId
        || source.artifactHash !== held.sourceArtifactHash || source.reservoirCount !== held.entries.length)) return false;
    const displays = new Set<string>(), canonicals = new Set<string>(), positions = new Set<number>();
    return held.entries.every((record, index) => record.rank === index + 1
      && validateOrderedProductRankedRecord(record)
      && (index === 0 || compareRankedRecords(held.entries[index - 1]!, record) < 0)
      && !displays.has(record.displayId) && !canonicals.has(record.canonicalStrategy)
      && !positions.has(record.traversalPosition)
      && Boolean(displays.add(record.displayId)) && Boolean(canonicals.add(record.canonicalStrategy))
      && Boolean(positions.add(record.traversalPosition)));
  } catch { return false; }
}
export function goldfishFinalBytes(value: GoldfishArtifactV3 | GoldfishReservoirV3): Buffer {
  return Buffer.from(fixedJson(value));
}
