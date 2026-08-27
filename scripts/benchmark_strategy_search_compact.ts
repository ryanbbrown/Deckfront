import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  COMPACT_GOLDFISH_HEADER_BYTES, COMPACT_GOLDFISH_MAGIC, COMPACT_GOLDFISH_RECORD_BYTES,
  compareCompactScoreRecords, decodeCompactScoreRecord, encodeCompactScoreRecord
} from '../src/sim/strategySearchCompact';
import { ORDERED_PRODUCT_SPACE_COUNT } from '../src/sim/orderedGoldfishProduct';

const countIndex = process.argv.indexOf('--count');
const recordCount = countIndex < 0 ? ORDERED_PRODUCT_SPACE_COUNT : Number(process.argv[countIndex + 1]);
if (!Number.isSafeInteger(recordCount) || recordCount < 1) throw new Error('--count must be positive.');
const outputIndex = process.argv.indexOf('--out');
const output = outputIndex < 0 ? undefined : path.resolve(process.argv[outputIndex + 1]!);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-compact-benchmark-')), file = path.join(root, 'synthetic.hgs');
const descriptor = fs.openSync(file, 'w'), payloadHash = createHash('sha256');
const profile = (name: string, position: number) => ({ profile: name, trials: 1,
  completions: 1, penalizedTurnsTo50: 30,
  damageArea: recordCount - position, moneySpent: recordCount - position });
const encodeStarted = performance.now();
try {
  fs.writeSync(descriptor, Buffer.alloc(COMPACT_GOLDFISH_HEADER_BYTES));
  const batch: Buffer[] = [];
  for (let position = 0; position < recordCount; position += 1) {
    const encoded = encodeCompactScoreRecord({ traversalPosition: position,
      displayId: `sg-${position.toString(16).padStart(10, '0').slice(-10)}`,
      profiles: [profile('stationary', position), profile('chaser', position), profile('kiter', position)] });
    batch.push(encoded); payloadHash.update(encoded);
    if (batch.length === 4096) { fs.writeSync(descriptor, Buffer.concat(batch)); batch.length = 0; }
  }
  if (batch.length) fs.writeSync(descriptor, Buffer.concat(batch));
  const header = Buffer.from(JSON.stringify({ schemaVersion: 1, magic: COMPACT_GOLDFISH_MAGIC,
    stage: 'stage-one', evidenceId: 'a'.repeat(64), semanticStart: 0, semanticEnd: recordCount,
    recordCount, recordBytes: COMPACT_GOLDFISH_RECORD_BYTES, payloadSha256: payloadHash.copy().digest('hex') }));
  if (header.length > COMPACT_GOLDFISH_HEADER_BYTES - 8) throw new Error('Synthetic header exceeds its bound.');
  const fixedHeader = Buffer.alloc(COMPACT_GOLDFISH_HEADER_BYTES); fixedHeader.write(COMPACT_GOLDFISH_MAGIC);
  fixedHeader.writeUInt32BE(header.length, 4); header.copy(fixedHeader, 8);
  fs.writeSync(descriptor, fixedHeader, 0, fixedHeader.length, 0); fs.fsyncSync(descriptor);
} finally { fs.closeSync(descriptor); }
const encodeMs = performance.now() - encodeStarted, payloadBytes = recordCount * COMPACT_GOLDFISH_RECORD_BYTES;
const decodeStarted = performance.now(), read = fs.openSync(file, 'r'), buffer = Buffer.alloc(COMPACT_GOLDFISH_RECORD_BYTES),
  decodeHash = createHash('sha256');
let decoded = 0, reducerReadBytes = 0, topWrites = 0;
let previous: ReturnType<typeof decodeCompactScoreRecord> | undefined;
try {
  const fixedHeader = Buffer.alloc(COMPACT_GOLDFISH_HEADER_BYTES);
  reducerReadBytes += fs.readSync(read, fixedHeader, 0, fixedHeader.length, 0);
  for (let position = 0; position < recordCount; position += 1) {
    const bytes = fs.readSync(read, buffer, 0, buffer.length,
      COMPACT_GOLDFISH_HEADER_BYTES + position * buffer.length);
    reducerReadBytes += bytes;
    if (bytes !== buffer.length) throw new Error('Synthetic compact read is truncated.');
    const record = decodeCompactScoreRecord(buffer);
    if (record.traversalPosition !== position || previous && compareCompactScoreRecords(previous, record) > 0) {
      throw new Error('Synthetic reduction order differs.');
    }
    if (topWrites < Math.min(500_000, recordCount)) topWrites += 1;
    previous = record; decodeHash.update(buffer); decoded += 1;
  }
} finally { fs.closeSync(read); }
const decodeMs = performance.now() - decodeStarted;
if (decoded !== recordCount || decodeHash.digest('hex') !== payloadHash.digest('hex')) throw new Error('Synthetic compact checksum differs.');
const result = { schemaVersion: 1, recordCount, bytesPerRecord: COMPACT_GOLDFISH_RECORD_BYTES,
  headerBytes: COMPACT_GOLDFISH_HEADER_BYTES, totalStageOneIntermediateBytes: payloadBytes + COMPACT_GOLDFISH_HEADER_BYTES,
  encodeMs, decodeMs, encodeRecordsPerSecond: recordCount / (encodeMs / 1000),
  decodeRecordsPerSecond: recordCount / (decodeMs / 1000), reducerReadBytes,
  reducerReadsPerRecord: 1, growingSetRewriteBytes: 0,
  retainedRecordWrites: { top500000: topWrites, reservoir: Math.min(20_000, topWrites) } };
if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`); }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); fs.rmSync(root, { recursive: true, force: true });
