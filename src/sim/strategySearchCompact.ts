import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  combineScoreEvidence, compareRankedRecords, compareStageOneRecords, deriveScoreEvidence, rankingKey
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
export const COMPACT_GOLDFISH_BUFFER_BYTES = 1024 * 1024;
export const GOLDFISH_ARTIFACT_SCHEMA_VERSION = 4 as const;
export const GOLDFISH_ARTIFACT_MAX_FRAME_BYTES = 4096;
export type CompactGoldfishStage = 'stage-one' | 'stage-two';
const METRICS_PER_PROFILE = 5;
const PROFILE_COUNT = 3;
const METRIC_COUNT = METRICS_PER_PROFILE * PROFILE_COUNT;
const PROFILES = ['stationary', 'chaser', 'kiter'] as const;

type RankingTuple = [number, number, number, number, number, number, number];
export interface CompactScoreRecord {
  traversalPosition: number;
  displayId: string;
  profiles: OrderedProductProfileEvidence[];
}
interface PreparedCompactScoreRecord extends CompactScoreRecord { ranking: RankingTuple }
export interface CompactScoreHeader {
  schemaVersion: 1; magic: typeof COMPACT_GOLDFISH_MAGIC; stage: CompactGoldfishStage;
  evidenceId: string; semanticStart: number; semanticEnd: number; recordCount: number;
  recordBytes: typeof COMPACT_GOLDFISH_RECORD_BYTES; payloadSha256: string;
}
export interface RankedCompactRecord {
  traversalPosition: number;
  stageOneProfiles: OrderedProductProfileEvidence[];
  additionalProfiles: OrderedProductProfileEvidence[];
}
function uint32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`Compact ${label} is outside uint32.`);
  }
}
function profileMetrics(record: Pick<CompactScoreRecord, 'profiles'>): number[] {
  if (record.profiles.length !== PROFILE_COUNT) throw new Error('Compact record needs three profiles.');
  return record.profiles.flatMap((profile, index) => {
    if (profile.profile !== PROFILES[index]) throw new Error('Compact profile order differs.');
    const values = [profile.trials, profile.completions, profile.penalizedTurnsTo50,
      profile.damageArea, profile.moneySpent];
    values.forEach((value) => uint32(value, 'profile metric'));
    return values;
  });
}
function profilesFromMetrics(metrics: readonly number[]): OrderedProductProfileEvidence[] {
  if (metrics.length !== METRIC_COUNT) throw new Error('Goldfish profile metric count differs.');
  return PROFILES.map((profile, index): OrderedProductProfileEvidence => ({ profile,
    trials: metrics[index * METRICS_PER_PROFILE]!, completions: metrics[index * METRICS_PER_PROFILE + 1]!,
    penalizedTurnsTo50: metrics[index * METRICS_PER_PROFILE + 2]!,
    damageArea: metrics[index * METRICS_PER_PROFILE + 3]!, moneySpent: metrics[index * METRICS_PER_PROFILE + 4]! }));
}
function rankingTuple(profiles: readonly OrderedProductProfileEvidence[]): RankingTuple {
  const evidence = deriveScoreEvidence(profiles);
  return [-evidence.worstCompletions, -evidence.totalCompletions, evidence.worstPenalizedTurnsTo50,
    evidence.totalPenalizedTurnsTo50, -evidence.worstDamageArea, -evidence.totalDamageArea,
    -evidence.totalMoneySpent];
}
function compareTuple(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference) return difference;
  }
  return 0;
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
  const codeUnits = Array.from({ length: COMPACT_DISPLAY_ID_CODE_UNITS }, (_unused, index) =>
    held.readUInt16BE(64 + index * 2));
  const padding = codeUnits.indexOf(0);
  if (padding === 0 || padding >= 0 && codeUnits.slice(padding).some((value) => value !== 0)) {
    throw new Error('Compact display ID padding differs.');
  }
  const record = { traversalPosition: held.readUInt32BE(0),
    displayId: String.fromCharCode(...(padding < 0 ? codeUnits : codeUnits.slice(0, padding))),
    profiles: profilesFromMetrics(metrics) };
  profileMetrics(record);
  return record;
}
function prepare(record: CompactScoreRecord): PreparedCompactScoreRecord {
  return { ...record, ranking: rankingTuple(record.profiles) };
}
export function compactScoreEvidence(record: CompactScoreRecord): OrderedProductScoreEvidence {
  return deriveScoreEvidence(record.profiles);
}
function comparePrepared(left: PreparedCompactScoreRecord, right: PreparedCompactScoreRecord,
  canonicalAt?: (position: number) => string): number {
  const evidence = compareTuple(left.ranking, right.ranking);
  if (evidence) return evidence;
  const display = compareUtf16(left.displayId, right.displayId);
  if (display) return display;
  if (canonicalAt) {
    const canonical = compareUtf16(canonicalAt(left.traversalPosition), canonicalAt(right.traversalPosition));
    if (canonical) return canonical;
  }
  return left.traversalPosition - right.traversalPosition;
}
export function compareCompactScoreRecords(left: CompactScoreRecord, right: CompactScoreRecord,
  canonicalAt?: (position: number) => string): number {
  return comparePrepared(prepare(left), prepare(right), canonicalAt);
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
function writeAll(descriptor: number, chunks: Buffer[]): void {
  if (!chunks.length) return;
  fs.writeSync(descriptor, Buffer.concat(chunks)); chunks.length = 0;
}
export function writeCompactScoreFile(input: { file: string; evidenceId: string; stage: CompactGoldfishStage;
  semanticStart: number; semanticEnd: number; records: readonly CompactScoreRecord[];
  canonicalAt?: (position: number) => string }): CompactScoreHeader {
  if (!/^[0-9a-f]{64}$/.test(input.evidenceId) || input.records.length !== input.semanticEnd - input.semanticStart) {
    throw new Error('Compact score file identity or coverage differs.');
  }
  const ordered = input.records.map(prepare).sort((left, right) => comparePrepared(left, right, input.canonicalAt));
  const positions = new Uint8Array(input.records.length), payloadHash = createHash('sha256');
  const temporary = `${input.file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(input.file), { recursive: true });
  const descriptor = fs.openSync(temporary, 'w');
  try {
    fs.writeSync(descriptor, Buffer.alloc(COMPACT_GOLDFISH_HEADER_BYTES));
    const chunks: Buffer[] = []; let bufferedBytes = 0;
    for (const record of ordered) {
      const offset = record.traversalPosition - input.semanticStart;
      if (offset < 0 || offset >= positions.length || positions[offset]) throw new Error('Compact score positions overlap or escape the range.');
      positions[offset] = 1;
      const encoded = encodeCompactScoreRecord(record); chunks.push(encoded); bufferedBytes += encoded.length;
      payloadHash.update(encoded);
      if (bufferedBytes >= COMPACT_GOLDFISH_BUFFER_BYTES) { writeAll(descriptor, chunks); bufferedBytes = 0; }
    }
    writeAll(descriptor, chunks);
    if (positions.some((value) => value !== 1)) throw new Error('Compact score positions do not cover the range.');
    const header: CompactScoreHeader = { schemaVersion: 1, magic: COMPACT_GOLDFISH_MAGIC, stage: input.stage,
      evidenceId: input.evidenceId, semanticStart: input.semanticStart, semanticEnd: input.semanticEnd,
      recordCount: input.records.length, recordBytes: COMPACT_GOLDFISH_RECORD_BYTES,
      payloadSha256: payloadHash.digest('hex') };
    fs.writeSync(descriptor, encodeHeader(header), 0, COMPACT_GOLDFISH_HEADER_BYTES, 0); fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); fs.renameSync(temporary, input.file); return header;
  } catch (error) { try { fs.closeSync(descriptor); } catch { /* already closed */ } fs.rmSync(temporary, { force: true }); throw error; }
}

interface CompactCursor {
  descriptor: number; header: CompactScoreHeader; index: number; hash: ReturnType<typeof createHash>;
  positions: Uint8Array; previous?: PreparedCompactScoreRecord; buffer: Buffer; bufferStart: number; bufferLength: number;
}
interface HeapEntry { record: PreparedCompactScoreRecord; source: number }
function openCompactCursor(file: string, evidenceId: string, stage: CompactGoldfishStage): CompactCursor {
  const descriptor = fs.openSync(file, 'r'), bytes = Buffer.alloc(COMPACT_GOLDFISH_HEADER_BYTES);
  if (fs.readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error('Compact cursor header is truncated.');
  const header = decodeHeader(bytes);
  if (header.evidenceId !== evidenceId || header.stage !== stage
    || fs.fstatSync(descriptor).size !== COMPACT_GOLDFISH_HEADER_BYTES
      + header.recordCount * COMPACT_GOLDFISH_RECORD_BYTES) throw new Error('Compact cursor identity or length differs.');
  const recordsPerBuffer = Math.max(1, Math.floor(COMPACT_GOLDFISH_BUFFER_BYTES / COMPACT_GOLDFISH_RECORD_BYTES));
  return { descriptor, header, index: 0, hash: createHash('sha256'), positions: new Uint8Array(header.recordCount),
    buffer: Buffer.allocUnsafe(recordsPerBuffer * COMPACT_GOLDFISH_RECORD_BYTES), bufferStart: 0, bufferLength: 0 };
}
function finishCursor(cursor: CompactCursor): void {
  if (cursor.positions.some((value) => value !== 1) || cursor.hash.digest('hex') !== cursor.header.payloadSha256) {
    throw new Error('Compact cursor coverage or checksum differs.');
  }
}
function cursorNext(cursor: CompactCursor, canonicalAt?: (position: number) => string): PreparedCompactScoreRecord | undefined {
  if (cursor.index === cursor.header.recordCount) { finishCursor(cursor); return undefined; }
  if (cursor.index < cursor.bufferStart || cursor.index >= cursor.bufferStart + cursor.bufferLength) {
    cursor.bufferStart = cursor.index;
    const remaining = cursor.header.recordCount - cursor.index;
    cursor.bufferLength = Math.min(remaining, cursor.buffer.length / COMPACT_GOLDFISH_RECORD_BYTES);
    const bytes = cursor.bufferLength * COMPACT_GOLDFISH_RECORD_BYTES;
    if (fs.readSync(cursor.descriptor, cursor.buffer, 0, bytes,
      COMPACT_GOLDFISH_HEADER_BYTES + cursor.index * COMPACT_GOLDFISH_RECORD_BYTES) !== bytes) {
      throw new Error('Compact cursor payload is truncated.');
    }
  }
  const offsetInBuffer = (cursor.index - cursor.bufferStart) * COMPACT_GOLDFISH_RECORD_BYTES;
  const bytes = cursor.buffer.subarray(offsetInBuffer, offsetInBuffer + COMPACT_GOLDFISH_RECORD_BYTES);
  cursor.hash.update(bytes); cursor.index += 1;
  const record = prepare(decodeCompactScoreRecord(bytes)), offset = record.traversalPosition - cursor.header.semanticStart;
  if (offset < 0 || offset >= cursor.positions.length || cursor.positions[offset]) throw new Error('Compact cursor positions overlap.');
  cursor.positions[offset] = 1;
  if (cursor.previous && comparePrepared(cursor.previous, record, canonicalAt) > 0) {
    throw new Error('Compact cursor records are not sorted.');
  }
  cursor.previous = record; return record;
}
function drainCursor(cursor: CompactCursor, canonicalAt?: (position: number) => string): void {
  while (cursorNext(cursor, canonicalAt)) { /* Single-pass checksum and coverage validation. */ }
}
export function readCompactScoreFile(file: string, input?: { evidenceId?: string; stage?: CompactGoldfishStage;
  canonicalAt?: (position: number) => string }): { header: CompactScoreHeader; records: CompactScoreRecord[] } {
  const probe = fs.openSync(file, 'r'), headerBytes = Buffer.alloc(COMPACT_GOLDFISH_HEADER_BYTES);
  try {
    if (fs.readSync(probe, headerBytes, 0, headerBytes.length, 0) !== headerBytes.length) throw new Error('Compact score header is truncated.');
  } finally { fs.closeSync(probe); }
  const header = decodeHeader(headerBytes);
  if (input?.evidenceId && header.evidenceId !== input.evidenceId || input?.stage && header.stage !== input.stage) {
    throw new Error('Compact score semantic identity differs.');
  }
  const cursor = openCompactCursor(file, header.evidenceId, header.stage), records: CompactScoreRecord[] = [];
  try { for (;;) { const record = cursorNext(cursor, input?.canonicalAt); if (!record) break;
    records.push({ traversalPosition: record.traversalPosition, displayId: record.displayId, profiles: record.profiles }); }
  } finally { fs.closeSync(cursor.descriptor); }
  return { header, records };
}

export function reduceCompactStageOne(input: { files: readonly string[]; evidenceId: string; total: number;
  retainCount: number; collisionAllowance: number; strategyAt: (position: number) => Strategy;
  onIntermediateReadMs?: (milliseconds: number) => void }): CompactScoreRecord[] {
  const cursors = input.files.map((file) => openCompactCursor(file, input.evidenceId, 'stage-one'));
  const byStart = [...cursors].sort((left, right) => left.header.semanticStart - right.header.semanticStart);
  let coverage = 0;
  for (const stream of byStart) { if (stream.header.semanticStart !== coverage) throw new Error('Compact reducer coverage has a gap or overlap.');
    coverage = stream.header.semanticEnd; }
  if (coverage !== input.total) throw new Error('Compact reducer coverage is incomplete.');
  const canonicalAt = (position: number): string => canonicalStrategy(input.strategyAt(position));
  const compare = (left: HeapEntry, right: HeapEntry): number => comparePrepared(left.record, right.record, canonicalAt);
  const heap: HeapEntry[] = [];
  const push = (entry: HeapEntry): void => { heap.push(entry); let index = heap.length - 1;
    while (index > 0) { const parent = Math.floor((index - 1) / 2); if (compare(heap[index]!, heap[parent]!) >= 0) break;
      [heap[index], heap[parent]] = [heap[parent]!, heap[index]!]; index = parent; } };
  const pop = (): HeapEntry => { const first = heap[0]!, last = heap.pop()!;
    if (heap.length) { heap[0] = last; let index = 0; for (;;) { const left = index * 2 + 1, right = left + 1; let best = index;
      if (left < heap.length && compare(heap[left]!, heap[best]!) < 0) best = left;
      if (right < heap.length && compare(heap[right]!, heap[best]!) < 0) best = right;
      if (best === index) break; [heap[index], heap[best]] = [heap[best]!, heap[index]!]; index = best; } }
    return first; };
  const retained: CompactScoreRecord[] = [], seenDisplay = new Set<string>(), seenCanonical = new Set<string>();
  let collisionDrops = 0, readMs = 0;
  const readNext = (cursor: CompactCursor): PreparedCompactScoreRecord | undefined => {
    const started = performance.now(), record = cursorNext(cursor, canonicalAt); readMs += performance.now() - started; return record; };
  cursors.forEach((cursor, source) => { const record = readNext(cursor); if (record) push({ record, source }); });
  try {
    while (heap.length && retained.length < input.retainCount) {
      const entry = pop(), compact = entry.record;
      const strategy = input.strategyAt(compact.traversalPosition), canonical = canonicalStrategy(strategy);
      if (strategy.id !== compact.displayId) throw new Error('Compact display ID differs from reconstructed strategy.');
      if (seenDisplay.has(compact.displayId) || seenCanonical.has(canonical)) {
        collisionDrops += 1;
        if (collisionDrops > input.collisionAllowance) throw new Error('Compact collision allowance is exhausted.');
      } else {
        seenDisplay.add(compact.displayId); seenCanonical.add(canonical);
        retained.push({ traversalPosition: compact.traversalPosition, displayId: compact.displayId,
          profiles: compact.profiles });
      }
      const next = readNext(cursors[entry.source]!); if (next) push({ record: next, source: entry.source });
    }
    const drain = (cursor: CompactCursor): void => { const started = performance.now();
      drainCursor(cursor, canonicalAt); readMs += performance.now() - started; };
    for (const entry of heap) drain(cursors[entry.source]!);
    const sourcesInHeap = new Set(heap.map((entry) => entry.source));
    cursors.forEach((cursor, source) => { if (!sourcesInHeap.has(source) && cursor.index < cursor.header.recordCount) drain(cursor); });
  } finally { cursors.forEach((cursor) => fs.closeSync(cursor.descriptor)); input.onIntermediateReadMs?.(readMs); }
  if (retained.length !== input.retainCount) throw new Error('Compact stage one retained set is incomplete.');
  return retained;
}
export function readCompactStageTwoFiles(input: { files: readonly string[]; evidenceId: string;
  total: number }): CompactScoreRecord[] {
  const streams = input.files.map((file) => readCompactScoreFile(file, { evidenceId: input.evidenceId, stage: 'stage-two' }));
  const ordered = [...streams].sort((left, right) => left.header.semanticStart - right.header.semanticStart);
  let covered = 0;
  for (const stream of ordered) { if (stream.header.semanticStart !== covered) throw new Error('Compact stage-two coverage has a gap or overlap.');
    covered = stream.header.semanticEnd; }
  if (covered !== input.total) throw new Error('Compact stage-two coverage is incomplete.');
  return ordered.flatMap((stream) => stream.records);
}
export function reduceCompactStageTwo(input: { stageOne: readonly CompactScoreRecord[];
  additional: readonly CompactScoreRecord[]; reservoirCount: number }): RankedCompactRecord[] {
  if (input.additional.length !== input.stageOne.length) throw new Error('Compact stage two membership differs from stage one.');
  const seenOrdinals = new Set<number>();
  const records = input.additional.map((additional): RankedCompactRecord & { ranking: RankingTuple; displayId: string } => {
    if (seenOrdinals.has(additional.traversalPosition)) throw new Error('Compact stage two repeats an ordinal.');
    seenOrdinals.add(additional.traversalPosition);
    const first = input.stageOne[additional.traversalPosition];
    if (!first || additional.displayId !== first.displayId) throw new Error('Compact stage two identity differs.');
    return { traversalPosition: first.traversalPosition, stageOneProfiles: first.profiles,
      additionalProfiles: additional.profiles,
      ranking: rankingTuple(combineScoreEvidence(deriveScoreEvidence(first.profiles), deriveScoreEvidence(additional.profiles)).profiles),
      displayId: first.displayId };
  });
  records.sort((left, right) => compareTuple(left.ranking, right.ranking)
    || compareUtf16(left.displayId, right.displayId) || left.traversalPosition - right.traversalPosition);
  if (input.reservoirCount < 1 || input.reservoirCount > records.length) throw new Error('Reservoir count is invalid.');
  return records.slice(0, input.reservoirCount).map(({ traversalPosition, stageOneProfiles, additionalProfiles }) =>
    ({ traversalPosition, stageOneProfiles, additionalProfiles }));
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

type GoldfishArtifactKind = 'top-500000' | 'reservoir';
export const GOLDFISH_ARTIFACT_HEADER_BYTES = 1024;
export const GOLDFISH_ARTIFACT_TRAILER_BYTES = 128;
export const GOLDFISH_TOP_RECORD_BYTES = 64;
export const GOLDFISH_RESERVOIR_RECORD_BYTES = 124;
const GOLDFISH_ARTIFACT_MAGIC = 'HGF4';
export interface GoldfishArtifactHeaderV4 {
  schemaVersion: 4; experiment: 'strategy-search-goldfish'; artifactKind: GoldfishArtifactKind;
  evidenceId: string; kingdomId: string; candidateCount: number; seeds: number[];
  retainedCount: number; reservoirCount: number; sourceArtifactHash: string | null;
  recordEncoding: 'traversal-position-profile-metrics-v1'; recordBytes: number;
}
export interface GoldfishArtifactV4<T> { header: GoldfishArtifactHeaderV4; records: T[]; artifactHash: string }
function fixedJsonFrame(value: unknown, bytes: number, magic?: string): Buffer {
  const json = Buffer.from(JSON.stringify(value));
  const offset = magic ? 8 : 4;
  if (json.length > bytes - offset) throw new Error('Goldfish artifact frame exceeds its bound.');
  const frame = Buffer.alloc(bytes);
  if (magic) frame.write(magic, 0, 'ascii');
  frame.writeUInt32BE(json.length, magic ? 4 : 0); json.copy(frame, offset); return frame;
}
function readJsonFrame<T>(frame: Buffer, magic?: string): T {
  const offset = magic ? 8 : 4;
  if (magic && frame.subarray(0, 4).toString('ascii') !== magic) throw new Error('Goldfish artifact magic differs.');
  const length = frame.readUInt32BE(magic ? 4 : 0);
  if (length < 2 || length > frame.length - offset || frame.subarray(offset + length).some((value) => value !== 0)) {
    throw new Error('Goldfish artifact frame padding differs.');
  }
  return JSON.parse(frame.subarray(offset, offset + length).toString('utf8')) as T;
}
function encodeMetricsRecord(position: number, profiles: readonly OrderedProductProfileEvidence[]): Buffer {
  uint32(position, 'artifact traversal position'); const record = Buffer.alloc(GOLDFISH_TOP_RECORD_BYTES);
  record.writeUInt32BE(position, 0);
  profileMetrics({ profiles: [...profiles] }).forEach((metric, index) => record.writeUInt32BE(metric, 4 + index * 4));
  return record;
}
function decodeMetricsRecord(record: Buffer): { traversalPosition: number; profiles: OrderedProductProfileEvidence[] } {
  if (record.length !== GOLDFISH_TOP_RECORD_BYTES) throw new Error('Goldfish top record width differs.');
  return { traversalPosition: record.readUInt32BE(0), profiles: profilesFromMetrics(
    Array.from({ length: METRIC_COUNT }, (_unused, index) => record.readUInt32BE(4 + index * 4))) };
}
function encodeReservoirRecord(record: RankedCompactRecord): Buffer {
  const first = encodeMetricsRecord(record.traversalPosition, record.stageOneProfiles);
  const bytes = Buffer.alloc(GOLDFISH_RESERVOIR_RECORD_BYTES); first.copy(bytes);
  profileMetrics({ profiles: record.additionalProfiles }).forEach((metric, index) =>
    bytes.writeUInt32BE(metric, GOLDFISH_TOP_RECORD_BYTES + index * 4));
  return bytes;
}
function decodeReservoirRecord(record: Buffer): RankedCompactRecord {
  if (record.length !== GOLDFISH_RESERVOIR_RECORD_BYTES) throw new Error('Goldfish reservoir record width differs.');
  const first = decodeMetricsRecord(record.subarray(0, GOLDFISH_TOP_RECORD_BYTES));
  return { traversalPosition: first.traversalPosition, stageOneProfiles: first.profiles,
    additionalProfiles: profilesFromMetrics(Array.from({ length: METRIC_COUNT }, (_unused, index) =>
      record.readUInt32BE(GOLDFISH_TOP_RECORD_BYTES + index * 4))) };
}
function writeGoldfishArtifact<T>(file: string, header: GoldfishArtifactHeaderV4, records: readonly T[],
  encode: (record: T) => Buffer): { artifactHash: string; bytesWritten: number } {
  const temporary = `${file}.tmp-${process.pid}`, hash = createHash('sha256');
  fs.mkdirSync(path.dirname(file), { recursive: true }); const descriptor = fs.openSync(temporary, 'w');
  try {
    const headerBytes = fixedJsonFrame(header, GOLDFISH_ARTIFACT_HEADER_BYTES, GOLDFISH_ARTIFACT_MAGIC);
    fs.writeSync(descriptor, headerBytes); hash.update(headerBytes);
    const chunks: Buffer[] = []; let buffered = 0;
    for (const record of records) {
      const bytes = encode(record); chunks.push(bytes); buffered += bytes.length; hash.update(bytes);
      if (buffered >= COMPACT_GOLDFISH_BUFFER_BYTES) { writeAll(descriptor, chunks); buffered = 0; }
    }
    writeAll(descriptor, chunks);
    const artifactHash = hash.digest('hex');
    fs.writeSync(descriptor, fixedJsonFrame({ artifactHash, recordCount: records.length }, GOLDFISH_ARTIFACT_TRAILER_BYTES));
    fs.fsyncSync(descriptor); fs.closeSync(descriptor); fs.renameSync(temporary, file);
    return { artifactHash, bytesWritten: GOLDFISH_ARTIFACT_HEADER_BYTES + records.length * header.recordBytes
      + GOLDFISH_ARTIFACT_TRAILER_BYTES };
  } catch (error) { try { fs.closeSync(descriptor); } catch { /* already closed */ }
    fs.rmSync(temporary, { force: true }); throw error; }
}
function topHeader(input: { evidenceId: string; kingdomId: string; candidateCount: number; seeds: readonly number[];
  retainedCount: number; reservoirCount: number }): GoldfishArtifactHeaderV4 {
  return { schemaVersion: 4, experiment: 'strategy-search-goldfish', artifactKind: 'top-500000',
    evidenceId: input.evidenceId, kingdomId: input.kingdomId, candidateCount: input.candidateCount,
    seeds: [...input.seeds], retainedCount: input.retainedCount, reservoirCount: input.reservoirCount,
    sourceArtifactHash: null, recordEncoding: 'traversal-position-profile-metrics-v1',
    recordBytes: GOLDFISH_TOP_RECORD_BYTES };
}
export function writeGoldfishArtifactV4(file: string, input: { evidenceId: string; kingdomId: string;
  candidateCount: number; seeds: readonly number[]; reservoirCount: number;
  records: readonly CompactScoreRecord[] }): { artifactHash: string; bytesWritten: number } {
  return writeGoldfishArtifact(file, topHeader({ ...input, retainedCount: input.records.length }), input.records,
    (record) => encodeMetricsRecord(record.traversalPosition, record.profiles));
}
export function writeGoldfishReservoirV4(file: string, input: { evidenceId: string; kingdomId: string;
  candidateCount: number; seeds: readonly number[]; retainedCount: number; sourceArtifactHash: string;
  records: readonly RankedCompactRecord[] }): { artifactHash: string; bytesWritten: number } {
  const header: GoldfishArtifactHeaderV4 = { schemaVersion: 4, experiment: 'strategy-search-goldfish',
    artifactKind: 'reservoir', evidenceId: input.evidenceId, kingdomId: input.kingdomId,
    candidateCount: input.candidateCount, seeds: [...input.seeds], retainedCount: input.retainedCount,
    reservoirCount: input.records.length, sourceArtifactHash: input.sourceArtifactHash,
    recordEncoding: 'traversal-position-profile-metrics-v1', recordBytes: GOLDFISH_RESERVOIR_RECORD_BYTES };
  return writeGoldfishArtifact(file, header, input.records, encodeReservoirRecord);
}
function validHeader(header: GoldfishArtifactHeaderV4, kind: GoldfishArtifactKind): boolean {
  const recordBytes = kind === 'top-500000' ? GOLDFISH_TOP_RECORD_BYTES : GOLDFISH_RESERVOIR_RECORD_BYTES;
  return header && header.schemaVersion === 4 && header.experiment === 'strategy-search-goldfish'
    && header.artifactKind === kind && /^[0-9a-f]{64}$/.test(header.evidenceId) && Boolean(header.kingdomId)
    && Number.isSafeInteger(header.candidateCount) && header.candidateCount > 0
    && Array.isArray(header.seeds) && header.seeds.length > 0 && new Set(header.seeds).size === header.seeds.length
    && header.seeds.every((seed) => Number.isSafeInteger(seed) && seed >= 0)
    && Number.isSafeInteger(header.retainedCount) && header.retainedCount > 0
    && Number.isSafeInteger(header.reservoirCount) && header.reservoirCount > 0
    && header.reservoirCount <= header.retainedCount && header.recordBytes === recordBytes
    && header.recordEncoding === 'traversal-position-profile-metrics-v1'
    && (kind === 'top-500000' ? header.sourceArtifactHash === null
      : typeof header.sourceArtifactHash === 'string' && /^[0-9a-f]{64}$/.test(header.sourceArtifactHash));
}
function openArtifact(file: string, kind: GoldfishArtifactKind): { descriptor: number; header: GoldfishArtifactHeaderV4;
  recordCount: number; artifactHash: string } {
  const descriptor = fs.openSync(file, 'r'), headerFrame = Buffer.alloc(GOLDFISH_ARTIFACT_HEADER_BYTES);
  try {
    if (fs.readSync(descriptor, headerFrame, 0, headerFrame.length, 0) !== headerFrame.length) throw new Error('Goldfish artifact header is truncated.');
    const header = readJsonFrame<GoldfishArtifactHeaderV4>(headerFrame, GOLDFISH_ARTIFACT_MAGIC);
    if (!validHeader(header, kind)) throw new Error('Goldfish artifact header differs.');
    const recordCount = kind === 'top-500000' ? header.retainedCount : header.reservoirCount;
    const expectedBytes = GOLDFISH_ARTIFACT_HEADER_BYTES + recordCount * header.recordBytes + GOLDFISH_ARTIFACT_TRAILER_BYTES;
    if (fs.fstatSync(descriptor).size !== expectedBytes) throw new Error('Goldfish artifact byte length differs.');
    const trailer = Buffer.alloc(GOLDFISH_ARTIFACT_TRAILER_BYTES);
    if (fs.readSync(descriptor, trailer, 0, trailer.length, expectedBytes - trailer.length) !== trailer.length) {
      throw new Error('Goldfish artifact trailer is truncated.');
    }
    const decoded = readJsonFrame<{ artifactHash: string; recordCount: number }>(trailer);
    if (decoded.recordCount !== recordCount || !/^[0-9a-f]{64}$/.test(decoded.artifactHash)) {
      throw new Error('Goldfish artifact trailer differs.');
    }
    return { descriptor, header, recordCount, artifactHash: decoded.artifactHash };
  } catch (error) { fs.closeSync(descriptor); throw error; }
}
function verifyArtifactHash(file: string, artifactHash: string): void {
  const descriptor = fs.openSync(file, 'r'), hash = createHash('sha256');
  try {
    const size = fs.fstatSync(descriptor).size - GOLDFISH_ARTIFACT_TRAILER_BYTES;
    const buffer = Buffer.allocUnsafe(COMPACT_GOLDFISH_BUFFER_BYTES); let position = 0;
    while (position < size) { const count = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, size - position), position);
      if (!count) throw new Error('Goldfish artifact hash input is truncated.'); hash.update(buffer.subarray(0, count)); position += count; }
    if (hash.digest('hex') !== artifactHash) throw new Error('Goldfish artifact checksum differs.');
  } finally { fs.closeSync(descriptor); }
}
function ordinaryStageOne(record: CompactScoreRecord, rank: number,
  strategyAt: (position: number) => Strategy): OrderedProductStageOneRecord & { stageOneRank: number } {
  const strategy = strategyAt(record.traversalPosition), stageOne = deriveScoreEvidence(record.profiles);
  return { traversalPosition: record.traversalPosition, displayId: strategy.id,
    canonicalStrategy: canonicalStrategy(strategy), strategy, stageOne,
    stageOneRankingKey: rankingKey(stageOne), stageOneRank: rank };
}
function readTopRange(file: string, start: number, end: number, validateHash: boolean): {
  header: GoldfishArtifactHeaderV4; records: CompactScoreRecord[]; artifactHash: string } {
  const opened = openArtifact(file, 'top-500000');
  try {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > opened.recordCount) {
      throw new Error('Goldfish artifact range differs.');
    }
    const records: CompactScoreRecord[] = [], bytes = Buffer.alloc((end - start) * GOLDFISH_TOP_RECORD_BYTES);
    const offset = GOLDFISH_ARTIFACT_HEADER_BYTES + start * GOLDFISH_TOP_RECORD_BYTES;
    if (fs.readSync(opened.descriptor, bytes, 0, bytes.length, offset) !== bytes.length) throw new Error('Goldfish artifact range is truncated.');
    for (let index = 0; index < end - start; index += 1) {
      const decoded = decodeMetricsRecord(bytes.subarray(index * GOLDFISH_TOP_RECORD_BYTES, (index + 1) * GOLDFISH_TOP_RECORD_BYTES));
      records.push({ ...decoded, displayId: '' });
    }
    if (validateHash) verifyArtifactHash(file, opened.artifactHash);
    return { header: opened.header, records, artifactHash: opened.artifactHash };
  } finally { fs.closeSync(opened.descriptor); }
}
export function readGoldfishCompactArtifactV4(file: string,
  strategyAt: (position: number) => Strategy): GoldfishArtifactV4<CompactScoreRecord> {
  const opened = openArtifact(file, 'top-500000'); fs.closeSync(opened.descriptor);
  const parsed = readTopRange(file, 0, opened.recordCount, true);
  const records = parsed.records.map((record) => ({ ...record, displayId: strategyAt(record.traversalPosition).id }));
  return { header: parsed.header, records, artifactHash: parsed.artifactHash };
}
export function readGoldfishArtifactV4(file: string,
  strategyAt: (position: number) => Strategy): GoldfishArtifactV4<OrderedProductStageOneRecord & { stageOneRank: number }> {
  const parsed = readGoldfishCompactArtifactV4(file, strategyAt);
  const positions = new Set<number>(), displays = new Set<string>(), canonicals = new Set<string>();
  const records = parsed.records.map((record, index) => ordinaryStageOne(record, index + 1, strategyAt));
  for (let index = 0; index < records.length; index += 1) { const record = records[index]!;
    if (positions.has(record.traversalPosition) || displays.has(record.displayId) || canonicals.has(record.canonicalStrategy)
      || index && compareStageOneRecords(records[index - 1]!, record) >= 0) throw new Error('Goldfish top artifact order or identity differs.');
    positions.add(record.traversalPosition); displays.add(record.displayId); canonicals.add(record.canonicalStrategy); }
  return { header: parsed.header, records, artifactHash: parsed.artifactHash };
}
export function readGoldfishArtifactRangeV4(file: string, start: number, end: number,
  strategyAt: (position: number) => Strategy): GoldfishArtifactV4<OrderedProductStageOneRecord & { stageOneRank: number }> {
  const parsed = readTopRange(file, start, end, false);
  return { header: parsed.header, artifactHash: parsed.artifactHash,
    records: parsed.records.map((record, index) => ordinaryStageOne(record, start + index + 1, strategyAt)) };
}
export function readGoldfishReservoirV4(file: string, strategyAt: (position: number) => Strategy,
  input?: { expectedSourceHash?: string; topFile?: string; stageRanks?: ReadonlyMap<number, number> }):
  GoldfishArtifactV4<OrderedProductRankedRecord> {
  const opened = openArtifact(file, 'reservoir');
  try {
    if (input?.expectedSourceHash && opened.header.sourceArtifactHash !== input.expectedSourceHash) {
      throw new Error('Goldfish reservoir source hash differs.');
    }
    const bytes = Buffer.alloc(opened.recordCount * GOLDFISH_RESERVOIR_RECORD_BYTES);
    if (fs.readSync(opened.descriptor, bytes, 0, bytes.length, GOLDFISH_ARTIFACT_HEADER_BYTES) !== bytes.length) {
      throw new Error('Goldfish reservoir is truncated.');
    }
    verifyArtifactHash(file, opened.artifactHash);
    if (input?.topFile && input.stageRanks) throw new Error('Goldfish reservoir received two stage-rank sources.');
    const stageRanks = new Map(input?.stageRanks ?? []);
    if (input?.topFile) readGoldfishArtifactV4(input.topFile, strategyAt).records
      .forEach((record) => stageRanks.set(record.traversalPosition, record.stageOneRank));
    const records = Array.from({ length: opened.recordCount }, (_unused, index): OrderedProductRankedRecord => {
      const compact = decodeReservoirRecord(bytes.subarray(index * GOLDFISH_RESERVOIR_RECORD_BYTES,
        (index + 1) * GOLDFISH_RESERVOIR_RECORD_BYTES));
      const strategy = strategyAt(compact.traversalPosition), stageOne = deriveScoreEvidence(compact.stageOneProfiles),
        additional = deriveScoreEvidence(compact.additionalProfiles), combined = combineScoreEvidence(stageOne, additional);
      return { traversalPosition: compact.traversalPosition, displayId: strategy.id,
        canonicalStrategy: canonicalStrategy(strategy), strategy, stageOne, stageOneRankingKey: rankingKey(stageOne),
        additional, combined, combinedRankingKey: rankingKey(combined),
        stageOneRank: stageRanks.get(compact.traversalPosition) ?? 0, rank: index + 1 };
    });
    const positions = new Set<number>(), displays = new Set<string>(), canonicals = new Set<string>();
    for (let index = 0; index < records.length; index += 1) { const record = records[index]!;
      if (positions.has(record.traversalPosition) || displays.has(record.displayId) || canonicals.has(record.canonicalStrategy)
        || index && compareRankedRecords(records[index - 1]!, record) >= 0
        || (input?.topFile || input?.stageRanks) && !record.stageOneRank) {
        throw new Error('Goldfish reservoir order or identity differs.');
      }
      positions.add(record.traversalPosition); displays.add(record.displayId); canonicals.add(record.canonicalStrategy); }
    return { header: opened.header, records, artifactHash: opened.artifactHash };
  } finally { fs.closeSync(opened.descriptor); }
}
export function goldfishFinalBytes(file: string): Buffer { return fs.readFileSync(file); }
