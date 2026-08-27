import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  COMPACT_GOLDFISH_HEADER_BYTES, COMPACT_GOLDFISH_RECORD_BYTES, reduceCompactStageOne,
  writeCompactScoreFile, writeGoldfishArtifactV4
} from '../src/sim/strategySearchCompact';
import { ORDERED_PRODUCT_SPACE_COUNT } from '../src/sim/orderedGoldfishProduct';
import { fixedBuyPlan } from '../src/sim/strategy';

function numberOption(name: string, fallback: number): number { const index = process.argv.indexOf(`--${name}`),
  value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be positive.`); return value; }
const recordCount = numberOption('count', ORDERED_PRODUCT_SPACE_COUNT), candidatesPerStream = numberOption('stream-size', 53_828);
const outputIndex = process.argv.indexOf('--out'), output = outputIndex < 0 ? undefined : path.resolve(process.argv[outputIndex + 1]!);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-compact-fanin-')), evidenceId = 'a'.repeat(64), files: string[] = [];
const profile = (name: string, position: number) => ({ profile: name, trials: 1,
  completions: 1, penalizedTurnsTo50: 30, damageArea: recordCount - position, moneySpent: recordCount - position });
const encodeStarted = performance.now();
for (let start = 0; start < recordCount; start += candidatesPerStream) {
  const end = Math.min(recordCount, start + candidatesPerStream), file = path.join(root, `${start}-${end}.hgs`);
  const records = Array.from({ length: end - start }, (_unused, index) => { const position = start + index;
    return { traversalPosition: position, displayId: `sg-${position.toString(16).padStart(10, '0').slice(-10)}`,
      profiles: [profile('stationary', position), profile('chaser', position), profile('kiter', position)] }; });
  writeCompactScoreFile({ file, evidenceId, stage: 'stage-one', semanticStart: start, semanticEnd: end, records });
  files.push(file);
}
const encodeMs = performance.now() - encodeStarted, reduceStarted = performance.now(); let intermediateReadMs = 0;
const strategyAt = (position: number) => ({ id: `sg-${position.toString(16).padStart(10, '0').slice(-10)}`,
  startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'buy' as const, cardId: 'drive', desiredCount: position + 1 }]) });
const retained = reduceCompactStageOne({ files, evidenceId, total: recordCount,
  retainCount: Math.min(500_000, recordCount), collisionAllowance: 1_024, strategyAt,
  onIntermediateReadMs(milliseconds) { intermediateReadMs = milliseconds; } });
const reduceMs = performance.now() - reduceStarted, finalFile = path.join(root, 'top-500000.hgf'), finalStarted = performance.now();
const final = writeGoldfishArtifactV4(finalFile, { evidenceId, kingdomId: 'synthetic', candidateCount: recordCount,
  seeds: [4_100_000], reservoirCount: Math.min(20_000, retained.length), records: retained });
const finalWriteMs = performance.now() - finalStarted;
const intermediateBytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0),
  reducerReadBytes = intermediateBytes, maxRssBytes = process.resourceUsage().maxRSS * 1024;
const result = { schemaVersion: 2, benchmark: 'strategy-search-production-fanin', recordCount,
  streamCount: files.length, candidatesPerStream, bytesPerRecord: COMPACT_GOLDFISH_RECORD_BYTES,
  headerBytesPerStream: COMPACT_GOLDFISH_HEADER_BYTES, totalStageOneIntermediateBytes: intermediateBytes,
  encodeMs, encodeRecordsPerSecond: recordCount / (encodeMs / 1000), reduceMs, intermediateReadMs,
  reduceRecordsPerSecond: recordCount / (reduceMs / 1000), reducerReadBytes, reducerReadsPerRecord: 1,
  finalOutputBytes: final.bytesWritten, finalWriteMs, maxRssBytes, growingSetRewriteBytes: 0,
  retainedRecordWrites: { top500000: retained.length, reservoir: Math.min(20_000, retained.length) } };
if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`); }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); fs.rmSync(root, { recursive: true, force: true });
