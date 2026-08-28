import fs from 'node:fs';
import { crc32 } from 'node:zlib';
import { createOrderedCandidateSpace, orderedGoldfishCardIds } from './orderedGoldfishBenchmark';
import { combineScoreEvidence, compareEvidence, deriveScoreEvidence } from './orderedGoldfishProduct';
import type { OrderedProductProfileEvidence, OrderedProductScoreEvidence } from './orderedGoldfishProduct';
import { nativeRuleFingerprint } from './nativeGoldfishProtocol';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';
import { strategySearchKingdom } from './strategySearchKingdoms';

export const GOLDFISH_HEADER_BYTES = 64;
export const GOLDFISH_RESULT_ROW_BYTES = 64;
export const GOLDFISH_RESERVOIR_ROW_BYTES = 124;
export const GOLDFISH_CANDIDATE_COUNT = 12_972_960;
export const GOLDFISH_RETAINED_COUNT = 500_000;
export const GOLDFISH_RESERVOIR_COUNT = 20_000;
export const GOLDFISH_SEEDS = [4_100_000, 4_100_001, 4_100_002, 4_100_003] as const;
const PROFILES = ['stationary', 'chaser', 'kiter'] as const;

export type GoldfishFileKind = 'stage-one' | 'stage-two' | 'top' | 'reservoir';
export interface GoldfishHeader {
  kind: GoldfishFileKind;
  rowBytes: number;
  rangeStart: number;
  rangeEnd: number;
  rowCount: number;
  checksum: number;
  sourceChecksum: number;
  seeds: number[];
  ruleFingerprint: string;
}
export interface GoldfishRecord {
  rank: number;
  strategyNumber: number;
  strategy: Strategy;
  displayId: string;
  canonicalStrategy: string;
  stageOne: OrderedProductScoreEvidence;
  additional: OrderedProductScoreEvidence;
  combined: OrderedProductScoreEvidence;
  stageOneRank?: number;
}
export interface GoldfishReadOptions {
  start?: number;
  end?: number;
  keep?: number;
  top?: string;
  topKeep?: number;
}
export interface GoldfishFile<T> { header: GoldfishHeader; records: T[] }

function headerKind(value: number): GoldfishFileKind {
  const kind = ({ 1: 'stage-one', 2: 'stage-two', 3: 'top', 4: 'reservoir' } as const)[value as 1 | 2 | 3 | 4];
  if (!kind) throw new Error(`Unknown Goldfish file kind ${value}.`);
  return kind;
}
function expectedSeeds(kind: GoldfishFileKind): number[] {
  if (kind === 'stage-one' || kind === 'top') return [GOLDFISH_SEEDS[0], 0, 0, 0];
  if (kind === 'stage-two') return [GOLDFISH_SEEDS[1], GOLDFISH_SEEDS[2], GOLDFISH_SEEDS[3], 0];
  return [...GOLDFISH_SEEDS];
}
export function decodeGoldfishHeader(bytes: Buffer): GoldfishHeader {
  if (bytes.length < GOLDFISH_HEADER_BYTES || bytes.subarray(0, 4).toString('ascii') !== 'HGR1') {
    throw new Error('Goldfish file header is missing or invalid.');
  }
  const kind = headerKind(bytes.readUInt32LE(4));
  const fingerprintBytes = bytes.subarray(48, 64), nul = fingerprintBytes.indexOf(0);
  const end = nul < 0 ? fingerprintBytes.length : nul;
  if (nul >= 0 && fingerprintBytes.subarray(nul).some((byte) => byte !== 0)) {
    throw new Error('Goldfish rule fingerprint padding is invalid.');
  }
  const ruleFingerprint = fingerprintBytes.subarray(0, end).toString('ascii');
  return { kind, rowBytes: bytes.readUInt32LE(8), rangeStart: bytes.readUInt32LE(12),
    rangeEnd: bytes.readUInt32LE(16), rowCount: bytes.readUInt32LE(20), checksum: bytes.readUInt32LE(24),
    sourceChecksum: bytes.readUInt32LE(28), seeds: [32, 36, 40, 44].map((offset) => bytes.readUInt32LE(offset)),
    ruleFingerprint };
}
function readFile(file: string, kingdomId: string, kind: GoldfishFileKind): { header: GoldfishHeader; rows: Buffer } {
  strategySearchKingdom(kingdomId);
  const bytes = fs.readFileSync(file), header = decodeGoldfishHeader(bytes);
  const expectedRowBytes = kind === 'reservoir' ? GOLDFISH_RESERVOIR_ROW_BYTES : GOLDFISH_RESULT_ROW_BYTES;
  if (header.kind !== kind || header.rowBytes !== expectedRowBytes
    || JSON.stringify(header.seeds) !== JSON.stringify(expectedSeeds(kind))
    || header.ruleFingerprint !== nativeRuleFingerprint(kingdomId, 30, 200)
    || ((kind === 'stage-one' || kind === 'top') && header.sourceChecksum !== 0)) {
    throw new Error(`Goldfish ${kind} header differs from the kingdom protocol.`);
  }
  const expectedBytes = GOLDFISH_HEADER_BYTES + header.rowCount * header.rowBytes;
  if (bytes.length !== expectedBytes) throw new Error(`Goldfish ${kind} file length differs from its header.`);
  const rows = bytes.subarray(GOLDFISH_HEADER_BYTES);
  if ((crc32(rows) >>> 0) !== header.checksum) throw new Error(`Goldfish ${kind} row CRC-32 differs.`);
  return { header, rows };
}
function decodeEvidence(bytes: Buffer, offset: number): OrderedProductScoreEvidence {
  const profiles = PROFILES.map((profile, profileIndex): OrderedProductProfileEvidence => {
    const start = offset + 4 + profileIndex * 20;
    return { profile, trials: bytes.readUInt32LE(start), completions: bytes.readUInt32LE(start + 4),
      penalizedTurnsTo50: bytes.readUInt32LE(start + 8), damageArea: bytes.readUInt32LE(start + 12),
      moneySpent: bytes.readUInt32LE(start + 16) };
  });
  return deriveScoreEvidence(profiles);
}
function emptyEvidence(): OrderedProductScoreEvidence {
  return { profiles: PROFILES.map((profile) => ({ profile, trials: 0, completions: 0,
    penalizedTurnsTo50: 0, damageArea: 0, moneySpent: 0 })), worstCompletions: 0,
    totalCompletions: 0, worstPenalizedTurnsTo50: 0, totalPenalizedTurnsTo50: 0,
    worstDamageArea: 0, totalDamageArea: 0, totalMoneySpent: 0 };
}
function strategyRecord(space: ReturnType<typeof createOrderedCandidateSpace>, number: number): Pick<GoldfishRecord,
  'strategyNumber' | 'strategy' | 'displayId' | 'canonicalStrategy'> {
  const candidate = space.candidateAt(number);
  const strategy: Strategy = { ...candidate, id: `gf-${number}` };
  return { strategyNumber: number, strategy, displayId: strategy.id, canonicalStrategy: canonicalStrategy(strategy) };
}
function compareRecords(left: GoldfishRecord, right: GoldfishRecord): number {
  return compareEvidence(left.combined, right.combined) || left.strategyNumber - right.strategyNumber;
}
function validateOrder(records: readonly GoldfishRecord[], start: number, end: number): void {
  const numbers = new Set<number>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.strategyNumber < start || record.strategyNumber >= end || numbers.has(record.strategyNumber)
      || index > 0 && compareRecords(records[index - 1]!, record) >= 0) {
      throw new Error('Goldfish strategy numbers or best-first order differ.');
    }
    numbers.add(record.strategyNumber);
  }
}
export function readGoldfishTop(file: string, kingdomId: string,
  options: GoldfishReadOptions = {}): GoldfishFile<GoldfishRecord> {
  const expectedStart = options.start ?? 0, expectedEnd = options.end ?? GOLDFISH_CANDIDATE_COUNT;
  const expectedKeep = options.keep ?? GOLDFISH_RETAINED_COUNT;
  const { header, rows } = readFile(file, kingdomId, 'top');
  if (header.rangeStart !== expectedStart || header.rangeEnd !== expectedEnd || header.rowCount !== expectedKeep) {
    throw new Error('Goldfish top range or retained count differs.');
  }
  const additional = emptyEvidence();
  const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
  const records = Array.from({ length: header.rowCount }, (_unused, index): GoldfishRecord => {
    const offset = index * GOLDFISH_RESULT_ROW_BYTES, strategyNumber = rows.readUInt32LE(offset);
    const stageOne = decodeEvidence(rows, offset);
    return { rank: index + 1, ...strategyRecord(space, strategyNumber), stageOne, additional,
      combined: stageOne, stageOneRank: index + 1 };
  });
  validateOrder(records, expectedStart, expectedEnd);
  return { header, records };
}
export function readGoldfishReservoir(file: string, kingdomId: string,
  options: GoldfishReadOptions = {}): GoldfishFile<GoldfishRecord> {
  const expectedTopCount = options.topKeep ?? GOLDFISH_RETAINED_COUNT;
  const expectedKeep = options.keep ?? GOLDFISH_RESERVOIR_COUNT;
  const { header, rows } = readFile(file, kingdomId, 'reservoir');
  if (header.rangeStart !== 0 || header.rangeEnd !== expectedTopCount || header.rowCount !== expectedKeep) {
    throw new Error('Goldfish reservoir range or retained count differs.');
  }
  const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
  const records = Array.from({ length: header.rowCount }, (_unused, index): GoldfishRecord => {
    const offset = index * GOLDFISH_RESERVOIR_ROW_BYTES, strategyNumber = rows.readUInt32LE(offset);
    const stageOne = decodeEvidence(rows, offset), additional = decodeEvidence(rows, offset + 60);
    return { rank: index + 1, ...strategyRecord(space, strategyNumber), stageOne, additional,
      combined: combineScoreEvidence(stageOne, additional) };
  });
  validateOrder(records, options.start ?? 0, options.end ?? GOLDFISH_CANDIDATE_COUNT);
  if (options.top) {
    const top = readGoldfishTop(options.top, kingdomId, { keep: expectedTopCount,
      ...(options.start === undefined ? {} : { start: options.start }),
      ...(options.end === undefined ? {} : { end: options.end }) });
    if (header.sourceChecksum !== top.header.checksum) throw new Error('Goldfish reservoir source checksum differs.');
    const byNumber = new Map(top.records.map((record) => [record.strategyNumber, record]));
    for (const record of records) {
      const source = byNumber.get(record.strategyNumber);
      if (!source || JSON.stringify(source.stageOne.profiles) !== JSON.stringify(record.stageOne.profiles)) {
        throw new Error('Goldfish reservoir shuffle-1 evidence differs from the top file.');
      }
      record.stageOneRank = source.rank;
    }
  }
  return { header, records };
}
