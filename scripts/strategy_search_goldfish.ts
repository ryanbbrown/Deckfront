import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';
import { nativeScoreBatchRequest } from '../src/sim/nativeGoldfishProtocol';
import { readNativeScoreStream } from '../src/sim/nativeScoreStream';
import {
  candidateIndexAt, createOrderedCandidateSpace, orderedGoldfishCardIds
} from '../src/sim/orderedGoldfishBenchmark';
import {
  compactProfileEvidence, ORDERED_PRODUCT_COLLISION_ALLOWANCE, ORDERED_PRODUCT_SEEDS,
  ORDERED_PRODUCT_SPACE_COUNT
} from '../src/sim/orderedGoldfishProduct';
import {
  createGoldfishArtifactV3, createGoldfishReservoirV3, readCompactStageTwoFiles,
  reduceCompactStageOne, reduceCompactStageTwo, writeCompactScoreFile
} from '../src/sim/strategySearchCompact';
import type { CompactScoreRecord, GoldfishArtifactV3 } from '../src/sim/strategySearchCompact';
import type { MonotonicPhases } from '../src/sim/strategySearchScheduler';
import { canonicalStrategy } from '../src/sim/strategy';

function option(name: string, fallback?: string): string { const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? fallback : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} is required.`); return value; }
function integer(name: string, fallback?: number): number { const value = Number(option(name,
  fallback === undefined ? undefined : String(fallback)));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a nonnegative integer.`); return value; }
function writeAtomic(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file); }
function manifestFiles(): string[] { const value = JSON.parse(fs.readFileSync(option('manifest'), 'utf8')) as unknown;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error('Manifest must list files.');
  return value; }
async function score(request: unknown, threads: number, cpu: number): Promise<{ file: string; scoringMs: number }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-goldfish-score-')),
    requestFile = path.join(directory, 'request.json'), responseFile = path.join(directory, 'response.ndjson');
  fs.writeFileSync(requestFile, `${JSON.stringify(request)}\n`); const executable = process.env.HEXDECK_GOLDFISH_BIN
    ?? path.resolve('rust/target/release/hexdeck-goldfish');
  const started = performance.now();
  await new Promise<void>((resolve, reject) => { const input = fs.openSync(requestFile, 'r'), output = fs.openSync(responseFile, 'w');
    const child = spawn(executable, ['--threads', String(threads), '--cpu-request', String(cpu), '--stream-score-batch'],
      { stdio: [input, output, 'pipe'] }); let stderr = '';
    child.stderr!.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-64 * 1024); });
    child.on('error', reject); child.on('close', (code) => { fs.closeSync(input); fs.closeSync(output);
      if (code === 0) resolve(); else reject(new Error(`Native Goldfish scorer failed: ${stderr}`)); }); });
  return { file: responseFile, scoringMs: performance.now() - started };
}
function phases(input: Partial<MonotonicPhases>, elapsedMs: number): MonotonicPhases {
  const value: MonotonicPhases = { generationMs: 0, scoringMs: 0, intermediateSerializationAndReadMs: 0,
    temporaryVolumeWriteCommitMs: 0, publisherWaitMs: 0, publicationCommitMs: 0, reductionComputeMs: 0,
    finalTop500000WriteMs: 0, finalTop20000WriteMs: 0, orchestrationQueueMs: 0, elapsedMs, ...input };
  const sum = Object.entries(value).filter(([key]) => key !== 'elapsedMs').reduce((total, [, held]) => total + held, 0);
  value.orchestrationQueueMs += Math.max(0, elapsedMs - sum); return value;
}
const mode = process.argv[2];
const evidenceId = option('evidence-id'), kingdomId = option('kingdom');
if (!/^[0-9a-f]{64}$/.test(evidenceId)) throw new Error('Goldfish evidence ID is invalid.');
const kingdom = strategySearchKingdom(kingdomId), space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
if (space.candidateCount !== ORDERED_PRODUCT_SPACE_COUNT) throw new Error('Goldfish candidate count differs.');
const strategyAt = (position: number) => space.candidateAt(candidateIndexAt(position, space.candidateCount));
if (mode === 'score-one') {
  const started = performance.now(), start = integer('start'), end = integer('end'), cpu = integer('cpu'),
    threads = integer('threads');
  if (end <= start || end > space.candidateCount || cpu < 1 || threads < 1 || threads > cpu) throw new Error('Stage-one range is invalid.');
  const generationStarted = performance.now(), strategies = Array.from({ length: end - start }, (_unused, index) =>
    strategyAt(start + index)), request = nativeScoreBatchRequest(kingdom, strategies,
      { kingdomId, seeds: [ORDERED_PRODUCT_SEEDS[0]], turnLimit: 30, actionCapPerTurn: 200 }, threads, 'full');
  const generationMs = performance.now() - generationStarted, scored = await score(request, threads, cpu), records: CompactScoreRecord[] = [];
  let index = 0;
  for await (const raw of readNativeScoreStream(scored.file)) { const evidence = compactProfileEvidence(raw);
    records.push({ traversalPosition: start + index, displayId: strategies[index]!.id, profiles: evidence.profiles }); index += 1; }
  if (index !== strategies.length) throw new Error('Stage-one scorer count differs.');
  const serializationStarted = performance.now();
  writeCompactScoreFile({ file: path.resolve(option('out')), evidenceId, stage: 'stage-one', semanticStart: start,
    semanticEnd: end, records, canonicalAt: (position) => canonicalStrategy(strategyAt(position)) });
  const elapsedMs = performance.now() - started;
  writeAtomic(path.resolve(option('phases')), phases({ generationMs, scoringMs: scored.scoringMs,
    intermediateSerializationAndReadMs: performance.now() - serializationStarted }, elapsedMs));
} else if (mode === 'reduce-one') {
  const started = performance.now(), reduceStarted = performance.now();
  let intermediateReadMs = 0;
  const records = reduceCompactStageOne({ files: manifestFiles(), evidenceId, total: space.candidateCount,
    retainCount: integer('retained-count', 500_000), collisionAllowance: ORDERED_PRODUCT_COLLISION_ALLOWANCE,
    strategyAt, onIntermediateReadMs: (milliseconds) => { intermediateReadMs = milliseconds; } });
  const reductionComputeMs = performance.now() - reduceStarted - intermediateReadMs, writing = performance.now();
  const artifact = createGoldfishArtifactV3({ evidenceId, kingdomId, candidateCount: space.candidateCount,
    seeds: [ORDERED_PRODUCT_SEEDS[0]], retainedCount: records.length,
    reservoirCount: integer('reservoir-count', 20_000), records });
  writeAtomic(path.resolve(option('out')), artifact); const elapsedMs = performance.now() - started;
  writeAtomic(path.resolve(option('phases')), phases({ intermediateSerializationAndReadMs: intermediateReadMs,
    reductionComputeMs,
    finalTop500000WriteMs: performance.now() - writing }, elapsedMs));
} else if (mode === 'score-two') {
  const started = performance.now(), start = integer('start'), end = integer('end'), cpu = integer('cpu'),
    threads = integer('threads'), readStarted = performance.now(),
    artifact = JSON.parse(fs.readFileSync(path.resolve(option('top')), 'utf8')) as GoldfishArtifactV3,
    intermediateReadMs = performance.now() - readStarted;
  if (artifact.schemaVersion !== 3 || artifact.evidenceId !== evidenceId || end <= start || end > artifact.records.length) {
    throw new Error('Stage-two source or range is invalid.');
  }
  const generationStarted = performance.now(), selected = artifact.records.slice(start, end),
    request = nativeScoreBatchRequest(kingdom, selected.map((entry) => entry.strategy),
      { kingdomId, seeds: ORDERED_PRODUCT_SEEDS.slice(1), turnLimit: 30, actionCapPerTurn: 200 }, threads, 'full');
  const generationMs = performance.now() - generationStarted, scored = await score(request, threads, cpu), records: CompactScoreRecord[] = [];
  let index = 0;
  for await (const raw of readNativeScoreStream(scored.file)) { const evidence = compactProfileEvidence(raw);
    records.push({ traversalPosition: start + index, displayId: selected[index]!.displayId, profiles: evidence.profiles }); index += 1; }
  if (index !== selected.length) throw new Error('Stage-two scorer count differs.');
  const serializationStarted = performance.now();
  writeCompactScoreFile({ file: path.resolve(option('out')), evidenceId, stage: 'stage-two', semanticStart: start,
    semanticEnd: end, records }); const elapsedMs = performance.now() - started;
  writeAtomic(path.resolve(option('phases')), phases({ generationMs, scoringMs: scored.scoringMs,
    intermediateSerializationAndReadMs: intermediateReadMs + performance.now() - serializationStarted }, elapsedMs));
} else if (mode === 'reduce-two') {
  const started = performance.now(), top = JSON.parse(fs.readFileSync(path.resolve(option('top')), 'utf8')) as GoldfishArtifactV3;
  if (top.schemaVersion !== 3 || top.evidenceId !== evidenceId) throw new Error('Stage-two source differs.');
  const files = manifestFiles(), readStarted = performance.now(), additional = readCompactStageTwoFiles({ files,
    evidenceId, total: top.records.length }), intermediateReadMs = performance.now() - readStarted;
  const reductionStarted = performance.now(), ranked = reduceCompactStageTwo({ stageOne: top.records, additional,
    reservoirCount: integer('reservoir-count', 20_000) });
  const reductionComputeMs = performance.now() - reductionStarted, writing = performance.now();
  const reservoir = createGoldfishReservoirV3({ evidenceId, sourceArtifactHash: top.artifactHash,
    entries: ranked.slice(0, integer('reservoir-count', 20_000)) });
  writeAtomic(path.resolve(option('out')), reservoir); const elapsedMs = performance.now() - started;
  writeAtomic(path.resolve(option('phases')), phases({ intermediateSerializationAndReadMs: intermediateReadMs,
    reductionComputeMs,
    finalTop20000WriteMs: performance.now() - writing }, elapsedMs));
} else throw new Error('Use score-one, reduce-one, score-two, or reduce-two.');
