import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createStrategySearchContext } from '../src/sim/strategySearchContext';
import { nativeScoreBatchRequest } from '../src/sim/nativeGoldfishProtocol';
import { NATIVE_SCORE_STREAM_MAX_LINE_BYTES, readNativeScoreStreams } from '../src/sim/nativeScoreStream';
import {
  compactProfileEvidence, ORDERED_PRODUCT_COLLISION_ALLOWANCE, ORDERED_PRODUCT_SEEDS,
  ORDERED_PRODUCT_SPACE_COUNT
} from '../src/sim/orderedGoldfishProduct';
import {
  readCompactStageTwoFiles, readGoldfishArtifactRangeV4, readGoldfishCompactArtifactV4,
  reduceCompactStageOne, reduceCompactStageTwo, writeCompactScoreFile, writeGoldfishArtifactV4,
  writeGoldfishReservoirV4
} from '../src/sim/strategySearchCompact';
import type { CompactScoreRecord } from '../src/sim/strategySearchCompact';
import type { MonotonicPhases } from '../src/sim/strategySearchScheduler';
import type { Strategy } from '../src/sim/strategy';
import { canonicalStrategy } from '../src/sim/strategy';

const SCORE_REQUEST_BATCH = 4_096;
function option(name: string, fallback?: string): string { const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? fallback : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} is required.`); return value; }
function integer(name: string, fallback?: number): number { const value = Number(option(name,
  fallback === undefined ? undefined : String(fallback)));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a nonnegative integer.`); return value; }
function writeAtomic(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  fs.renameSync(temporary, file); }
function manifestFiles(): string[] { const value = JSON.parse(fs.readFileSync(option('manifest'), 'utf8')) as unknown;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error('Manifest must list files.');
  return value; }
async function score(input: { strategies: readonly Strategy[]; seeds: readonly number[]; threads: number; cpu: number }): Promise<{
  file: string; scoringMs: number; requestWriteMs: number }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-goldfish-score-')),
    requestFile = path.join(directory, 'request.jsonl'), responseFile = path.join(directory, 'response.ndjson');
  const requestStarted = performance.now(), request = fs.openSync(requestFile, 'w');
  try {
    for (let start = 0; start < input.strategies.length; start += SCORE_REQUEST_BATCH) {
      const line = Buffer.from(`${JSON.stringify(nativeScoreBatchRequest(kingdom,
        input.strategies.slice(start, start + SCORE_REQUEST_BATCH),
        { kingdomId, seeds: input.seeds, turnLimit: 30, actionCapPerTurn: 200 }, input.threads, 'full'))}\n`);
      if (line.length > NATIVE_SCORE_STREAM_MAX_LINE_BYTES) throw new Error('Native scorer request frame exceeds its bound.');
      fs.writeSync(request, line);
    }
  } finally { fs.closeSync(request); }
  const requestWriteMs = performance.now() - requestStarted;
  const executable = process.env.HEXDECK_GOLDFISH_BIN ?? path.resolve('rust/target/release/hexdeck-goldfish');
  const started = performance.now();
  await new Promise<void>((resolve, reject) => { const source = fs.openSync(requestFile, 'r'), output = fs.openSync(responseFile, 'w');
    const child = spawn(executable, ['--threads', String(input.threads), '--cpu-request', String(input.cpu),
      '--stream-score-batch'], { stdio: [source, output, 'pipe'] }); let stderr = '';
    child.stderr!.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-64 * 1024); });
    child.on('error', reject); child.on('close', (code) => { fs.closeSync(source); fs.closeSync(output);
      if (code === 0) resolve(); else reject(new Error(`Native Goldfish scorer failed: ${stderr}`)); }); });
  return { file: responseFile, scoringMs: performance.now() - started, requestWriteMs };
}
function phases(input: Partial<MonotonicPhases>, elapsedMs: number): MonotonicPhases {
  const value: MonotonicPhases = { generationMs: 0, scoringMs: 0, intermediateSerializationAndReadMs: 0,
    temporaryVolumeWriteCommitMs: 0, publisherWaitMs: 0, publicationCommitMs: 0, reductionComputeMs: 0,
    finalTop500000WriteMs: 0, finalTop20000WriteMs: 0, orchestrationQueueMs: 0, elapsedMs, ...input };
  const sum = Object.entries(value).filter(([key]) => key !== 'elapsedMs').reduce((total, [, held]) => total + held, 0);
  value.orchestrationQueueMs += Math.max(0, elapsedMs - sum); return value;
}
async function collectScores(scored: { file: string }, input: { start: number; displayIds: readonly string[] }): Promise<{
  records: CompactScoreRecord[]; readMs: number }> {
  const started = performance.now(), records: CompactScoreRecord[] = []; let index = 0;
  for await (const raw of readNativeScoreStreams(scored.file)) { const evidence = compactProfileEvidence(raw);
    const displayId = input.displayIds[index]; if (!displayId) throw new Error('Native scorer returned too many records.');
    records.push({ traversalPosition: input.start + index, displayId, profiles: evidence.profiles }); index += 1; }
  if (index !== input.displayIds.length) throw new Error('Native scorer count differs.');
  return { records, readMs: performance.now() - started };
}
const mode = process.argv[2];
const evidenceId = option('evidence-id'), kingdomId = option('kingdom');
if (!/^[0-9a-f]{64}$/.test(evidenceId)) throw new Error('Goldfish evidence ID is invalid.');
const { kingdom, candidateSpace, strategyAt } = createStrategySearchContext(kingdomId);
if (candidateSpace.candidateCount !== ORDERED_PRODUCT_SPACE_COUNT) throw new Error('Goldfish candidate count differs.');
if (mode === 'readiness') {
  const probe = strategyAt(0);
  if (!probe.id || canonicalStrategy(probe).length < 1) throw new Error('Goldfish readiness strategy is invalid.');
  process.stdout.write(`${JSON.stringify({ ready: true, kingdomId, candidateCount: candidateSpace.candidateCount })}\n`);
} else if (mode === 'score-one') {
  const started = performance.now(), start = integer('start'), end = integer('end'), cpu = integer('cpu'), threads = integer('threads');
  if (end <= start || end > candidateSpace.candidateCount || cpu < 1 || threads < 1 || threads > cpu) throw new Error('Stage-one range is invalid.');
  const generationStarted = performance.now(), strategies = Array.from({ length: end - start }, (_unused, index) =>
    strategyAt(start + index)), generationMs = performance.now() - generationStarted;
  const scored = await score({ strategies, seeds: [ORDERED_PRODUCT_SEEDS[0]], threads, cpu });
  const collected = await collectScores(scored, { start, displayIds: strategies.map((entry) => entry.id) });
  const serializationStarted = performance.now();
  writeCompactScoreFile({ file: path.resolve(option('out')), evidenceId, stage: 'stage-one', semanticStart: start,
    semanticEnd: end, records: collected.records, canonicalAt: (position) => canonicalStrategy(strategyAt(position)) });
  const elapsedMs = performance.now() - started;
  writeAtomic(path.resolve(option('phases')), phases({ generationMs, scoringMs: scored.scoringMs,
    intermediateSerializationAndReadMs: scored.requestWriteMs + collected.readMs
      + performance.now() - serializationStarted }, elapsedMs));
} else if (mode === 'reduce-one') {
  const started = performance.now(), reduceStarted = performance.now(); let intermediateReadMs = 0;
  const records = reduceCompactStageOne({ files: manifestFiles(), evidenceId, total: candidateSpace.candidateCount,
    retainCount: integer('retained-count', 500_000), collisionAllowance: ORDERED_PRODUCT_COLLISION_ALLOWANCE,
    strategyAt, onIntermediateReadMs: (milliseconds) => { intermediateReadMs = milliseconds; } });
  const reductionComputeMs = performance.now() - reduceStarted - intermediateReadMs, writing = performance.now();
  writeGoldfishArtifactV4(path.resolve(option('out')), { evidenceId, kingdomId,
    candidateCount: candidateSpace.candidateCount, seeds: [ORDERED_PRODUCT_SEEDS[0]],
    reservoirCount: integer('reservoir-count', 20_000), records });
  const elapsedMs = performance.now() - started;
  writeAtomic(path.resolve(option('phases')), phases({ intermediateSerializationAndReadMs: intermediateReadMs,
    reductionComputeMs, finalTop500000WriteMs: performance.now() - writing }, elapsedMs));
} else if (mode === 'score-two') {
  const started = performance.now(), start = integer('start'), end = integer('end'), cpu = integer('cpu'), threads = integer('threads'),
    readStarted = performance.now(), artifact = readGoldfishArtifactRangeV4(path.resolve(option('top')), start, end, strategyAt),
    intermediateReadMs = performance.now() - readStarted;
  if (artifact.header.evidenceId !== evidenceId) throw new Error('Stage-two source identity differs.');
  const generationStarted = performance.now(), selected = artifact.records, generationMs = performance.now() - generationStarted;
  const scored = await score({ strategies: selected.map((entry) => entry.strategy), seeds: ORDERED_PRODUCT_SEEDS.slice(1), threads, cpu });
  const collected = await collectScores(scored, { start, displayIds: selected.map((entry) => entry.displayId) });
  const serializationStarted = performance.now();
  writeCompactScoreFile({ file: path.resolve(option('out')), evidenceId, stage: 'stage-two', semanticStart: start,
    semanticEnd: end, records: collected.records }); const elapsedMs = performance.now() - started;
  writeAtomic(path.resolve(option('phases')), phases({ generationMs, scoringMs: scored.scoringMs,
    intermediateSerializationAndReadMs: intermediateReadMs + scored.requestWriteMs + collected.readMs
      + performance.now() - serializationStarted }, elapsedMs));
} else if (mode === 'reduce-two') {
  const started = performance.now(), readStarted = performance.now(), top = readGoldfishCompactArtifactV4(
    path.resolve(option('top')), strategyAt);
  if (top.header.evidenceId !== evidenceId) throw new Error('Stage-two source differs.');
  const additional = readCompactStageTwoFiles({ files: manifestFiles(), evidenceId, total: top.records.length }),
    intermediateReadMs = performance.now() - readStarted;
  const reductionStarted = performance.now(), ranked = reduceCompactStageTwo({ stageOne: top.records, additional,
    reservoirCount: integer('reservoir-count', 20_000) }), reductionComputeMs = performance.now() - reductionStarted,
    writing = performance.now();
  writeGoldfishReservoirV4(path.resolve(option('out')), { evidenceId, kingdomId,
    candidateCount: top.header.candidateCount, seeds: ORDERED_PRODUCT_SEEDS, retainedCount: top.records.length,
    sourceArtifactHash: top.artifactHash, records: ranked });
  const elapsedMs = performance.now() - started;
  writeAtomic(path.resolve(option('phases')), phases({ intermediateSerializationAndReadMs: intermediateReadMs,
    reductionComputeMs, finalTop20000WriteMs: performance.now() - writing }, elapsedMs));
} else throw new Error('Use readiness, score-one, reduce-one, score-two, or reduce-two.');
