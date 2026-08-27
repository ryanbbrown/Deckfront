import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import {
  INITIAL_MATRIX_MAX_SEEDS, analyzeInitialMatrix, assertInitialMatrixOutputJsonFiles,
  createInitialMatrixChunk, createInitialMatrixManifest, expectedInitialMatrixChunkRelativePaths,
  initialMatrixChunkRelativePath, seedRecordFromOutcome, validateInitialMatrixChunk,
  validateInitialMatrixManifest, validateOrderedCalibrationSource
} from '../src/sim/initialMatrixCalibration';
import type {
  InitialMatrixCellSeries, InitialMatrixChunk, InitialMatrixManifest
} from '../src/sim/initialMatrixCalibration';
import { ORDERED_PRODUCT_SEEDS, orderedProductTarget } from '../src/sim/orderedGoldfishProduct';
import { GAMES_PER_SEED } from '../src/sim/pairing';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { PairingJob } from '../src/sim/pairingRunner';

interface Options {
  kingdomId: string;
  rankedFile: string;
  reservoirFile: string;
  outputRoot: string;
  maxSeedCount: number;
  chunkSize: number;
  prefixes: number[];
  heldOutStartSeedIndex: number;
  workers: number;
  shuffleSeeds: string | undefined;
}

function option(args: readonly string[], name: string, fallback?: string): string {
  const flag = `--${name}`, index = args.indexOf(flag);
  if (index < 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${flag} is required.`);
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
  return value;
}
function integer(args: readonly string[], name: string, fallback?: number): number {
  const raw = option(args, name, fallback === undefined ? undefined : String(fallback));
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer.`);
  return value;
}
function parseOptions(args: readonly string[]): Options {
  const known = new Set(['--kingdom', '--ranked', '--reservoir', '--out', '--max-seeds', '--chunk-size',
    '--prefixes', '--held-out-start', '--workers', '--seeds']);
  for (let index = 0; index < args.length; index += 2) {
    if (!known.has(args[index]!)) throw new Error(`Unknown option ${args[index]}.`);
    if (index + 1 >= args.length) throw new Error(`${args[index]} needs a value.`);
  }
  const maxSeedCount = integer(args, 'max-seeds');
  const prefixes = option(args, 'prefixes').split(',').map((value) => Number(value));
  const heldOutStartSeedIndex = integer(args, 'held-out-start');
  if (maxSeedCount > INITIAL_MATRIX_MAX_SEEDS) {
    throw new Error(`--max-seeds must be from 2 to ${INITIAL_MATRIX_MAX_SEEDS}.`);
  }
  if (!prefixes.length || prefixes.some((value) => !Number.isSafeInteger(value) || value < 1)
    || new Set(prefixes).size !== prefixes.length || prefixes.some((value) => value > heldOutStartSeedIndex)
    || heldOutStartSeedIndex >= maxSeedCount) {
    throw new Error('--prefixes and --held-out-start must define disjoint training prefixes and a nonempty suffix.');
  }
  const chunkSize = integer(args, 'chunk-size', 5), workers = integer(args, 'workers', 4);
  if (chunkSize > 25) throw new Error('--chunk-size must be from 1 to 25.');
  if (workers > 192) throw new Error('--workers must be from 1 to 192.');
  return { kingdomId: option(args, 'kingdom'), rankedFile: path.resolve(option(args, 'ranked')),
    reservoirFile: path.resolve(option(args, 'reservoir')), outputRoot: path.resolve(option(args, 'out')),
    maxSeedCount, chunkSize, prefixes, heldOutStartSeedIndex, workers,
    shuffleSeeds: args.includes('--seeds') ? option(args, 'seeds') : undefined };
}
function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function validateOrderedArtifacts(options: Options): void {
  for (const file of [options.rankedFile, `${options.rankedFile}.sha256`, options.reservoirFile,
    `${options.reservoirFile}.sha256`]) {
    if (!fs.existsSync(file)) throw new Error(`Missing ordered artifact input ${file}.`);
  }
  const seedArgs = options.shuffleSeeds ? ['--seeds', options.shuffleSeeds] : [];
  const result = spawnSync('npm', ['run', 'goldfish:ordered-product', '--', 'validate-reservoir',
    '--kingdom', options.kingdomId, ...seedArgs, '--artifact', options.rankedFile,
    '--reservoir', options.reservoirFile], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Ordered ranked/reservoir validation failed.');
}
function chunkFile(root: string, row: number, column: number, start: number): string {
  return path.join(root, initialMatrixChunkRelativePath(row, column, start));
}
function existingJsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.json')) result.push(path.relative(root, file));
    }
  };
  visit(root);
  return result;
}
function loadChunks(root: string, manifest: InitialMatrixManifest): Map<string, InitialMatrixChunk> {
  assertInitialMatrixOutputJsonFiles(existingJsonFiles(root), true, manifest);
  const chunks = new Map<string, InitialMatrixChunk>();
  for (const relative of expectedInitialMatrixChunkRelativePaths(manifest)) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const match = /^chunks\/cell-(\d+)-(\d+)\/chunk-(\d+)\.json$/.exec(relative);
    if (!match) throw new Error(`Invalid initial-matrix chunk path ${relative}.`);
    const row = Number(match[1]), column = Number(match[2]), start = Number(match[3]);
    const count = Math.min(manifest.protocol.chunkSize, manifest.protocol.maxSeedCount - start);
    const value = readJson<unknown>(file);
    if (!validateInitialMatrixChunk(value, manifest, row, column, start, count)) {
      throw new Error(`Invalid or corrupt initial-matrix chunk ${file}.`);
    }
    chunks.set(file, value);
  }
  return chunks;
}

async function fillMissingChunks(options: Options, manifest: InitialMatrixManifest,
  chunks: Map<string, InitialMatrixChunk>, kingdom: (typeof deepBeamSuite.kingdoms)[number]): Promise<void> {
  const missing: Array<{ row: number; column: number; start: number; count: number; file: string }> = [];
  for (let row = 0; row < manifest.strategies.length; row += 1) {
    for (let column = row; column < manifest.strategies.length; column += 1) {
      for (let start = 0; start < manifest.protocol.maxSeedCount; start += manifest.protocol.chunkSize) {
        const file = chunkFile(options.outputRoot, row, column, start);
        if (!chunks.has(file)) missing.push({ row, column, start,
          count: Math.min(manifest.protocol.chunkSize, manifest.protocol.maxSeedCount - start), file });
      }
    }
  }
  if (!missing.length) return;
  const runner = new WorkerPairingRunner(options.workers, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  try {
    for (let index = 0; index < missing.length; index += 1) {
      const item = missing[index]!, row = manifest.strategies[item.row]!, column = manifest.strategies[item.column]!;
      const seeds = manifest.protocol.seeds.slice(item.start, item.start + item.count);
      const jobs: PairingJob[] = seeds.map((seed) => ({ candidate: row, opponent: column,
        options: { kingdomId: manifest.protocol.kingdomId, seeds: [seed], turnLimitPerPlayer: 30,
          actionCapPerTurn: 200, startingDraftEnabled: false, allowEarlyStop: false } }));
      const started = performance.now();
      const outcomes = (await runner.run(jobs)).outcomes;
      const simulationMs = performance.now() - started;
      const purpose = item.row === item.column
        ? manifest.protocol.diagonalPurpose : manifest.protocol.offDiagonalPurpose;
      const records = outcomes.map((outcome, outcomeIndex) => {
        if (!outcome || outcome.record.aborted !== 0 || outcome.stopReason !== 'maximum'
          || outcome.seedsEvaluated !== 1 || outcome.matches !== GAMES_PER_SEED
          || outcome.blocks.length !== 1 || outcome.blocks[0]!.seed !== seeds[outcomeIndex]) {
          throw new Error(`Cell ${item.row}:${item.column} seed ${seeds[outcomeIndex]} returned invalid evidence.`);
        }
        return seedRecordFromOutcome(outcome.blocks[0]!, outcome.telemetry, outcome.matches, purpose);
      });
      const chunk = createInitialMatrixChunk({ manifest, rowIndex: item.row, columnIndex: item.column,
        startSeedIndex: item.start, records, simulationMs });
      writeAtomic(item.file, chunk);
      chunks.set(item.file, chunk);
      console.log(`initial matrix cell ${index + 1}/${missing.length}: ${item.row}:${item.column} seeds ${item.start + 1}-${item.start + item.count}`);
    }
  } finally { await runner.close(); }
}
function cellSeries(root: string, manifest: InitialMatrixManifest,
  chunks: ReadonlyMap<string, InitialMatrixChunk>): InitialMatrixCellSeries[] {
  const result: InitialMatrixCellSeries[] = [];
  for (let row = 0; row < manifest.strategies.length; row += 1) {
    for (let column = row; column < manifest.strategies.length; column += 1) {
      const records = [] as InitialMatrixChunk['records'];
      let purpose: InitialMatrixChunk['purpose'] | undefined;
      for (let start = 0; start < manifest.protocol.maxSeedCount; start += manifest.protocol.chunkSize) {
        const held = chunks.get(chunkFile(root, row, column, start));
        if (!held) throw new Error(`Initial matrix is incomplete at cell ${row}:${column}, seed index ${start}.`);
        purpose ??= held.purpose;
        records.push(...held.records);
      }
      result.push({ purpose: purpose!, rowIndex: row, columnIndex: column, records });
    }
  }
  return result;
}

const options = parseOptions(process.argv.slice(2));
orderedProductTarget(options.kingdomId);
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === options.kingdomId);
if (!kingdom) throw new Error(`Supported ordered kingdom is not registered: ${options.kingdomId}.`);
registerKingdom(kingdom);
validateOrderedArtifacts(options);
const rankedSha256 = sha256File(options.rankedFile), reservoirSha256 = sha256File(options.reservoirFile);
const expectedSeeds = options.shuffleSeeds
  ? options.shuffleSeeds.split(',').map((seed) => Number(seed)) : ORDERED_PRODUCT_SEEDS;
const validated = validateOrderedCalibrationSource({ kingdomId: options.kingdomId,
  ranked: readJson<unknown>(options.rankedFile), reservoir: readJson<unknown>(options.reservoirFile),
  rankedSha256, reservoirSha256, expectedSeeds });
const expectedManifest = createInitialMatrixManifest({ source: validated.source, strategies: validated.strategies,
  maxSeedCount: options.maxSeedCount, chunkSize: options.chunkSize });
const manifestFile = path.join(options.outputRoot, 'manifest.json');
let manifest = expectedManifest;
if (fs.existsSync(manifestFile)) {
  const held = readJson<unknown>(manifestFile);
  if (!validateInitialMatrixManifest(held, expectedManifest)) {
    throw new Error('Saved initial-matrix manifest has stale rules, protocol, source, or strategies.');
  }
  manifest = held;
  assertInitialMatrixOutputJsonFiles(existingJsonFiles(options.outputRoot), true, manifest);
} else {
  assertInitialMatrixOutputJsonFiles(existingJsonFiles(options.outputRoot), false);
  fs.mkdirSync(options.outputRoot, { recursive: true });
  writeAtomic(manifestFile, manifest);
}
const chunks = loadChunks(options.outputRoot, manifest);
await fillMissingChunks(options, manifest, chunks, kingdom);
const completed = loadChunks(options.outputRoot, manifest);
const measuredChunkWallMs = [...completed.values()].reduce((sum, chunk) => {
  if (chunk.purpose === manifest.protocol.diagonalPurpose) sum.diagonalTelemetry += chunk.simulationMs;
  else sum.offDiagonal += chunk.simulationMs;
  return sum;
}, { offDiagonal: 0, diagonalTelemetry: 0 });
const analysis = analyzeInitialMatrix({ strategies: manifest.strategies,
  cells: cellSeries(options.outputRoot, manifest, completed), seedCount: manifest.protocol.maxSeedCount,
  requestedPrefixes: options.prefixes, heldOutStartSeedIndex: options.heldOutStartSeedIndex,
  measuredChunkWallMs });
const report = { schemaVersion: 2, experiment: 'initial-matrix-calibration-report',
  version: manifest.protocol.version, manifestHash: manifest.evidenceHash, source: manifest.protocol.source,
  protocol: manifest.protocol, analysis };
writeAtomic(path.join(options.outputRoot, 'report.json'), report);
console.log(JSON.stringify({ report: path.join(options.outputRoot, 'report.json'),
  evidenceCosts: analysis.evidenceCosts, prefixes: analysis.requestedPrefixes,
  heldOutSeedRange: analysis.heldOut.seedRange,
  acquisitionBasis: analysis.heldOut.acquisitions.basis,
  feasibleRangeBasis: analysis.heldOut.acquisitions.feasibleRangeBasis }, null, 2));
