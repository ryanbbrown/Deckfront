import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import {
  validateInitialMatrixManifest, validateOrderedCalibrationSource
} from '../src/sim/initialMatrixCalibration';
import type { InitialMatrixManifest } from '../src/sim/initialMatrixCalibration';
import { evaluateCandidates } from '../src/sim/mixtureEvaluation';
import type { MixtureSchedule } from '../src/sim/mixtureEvaluation';
import type { OrderedProductReservoirArtifact } from '../src/sim/orderedGoldfishProduct';
import { GAMES_PER_SEED } from '../src/sim/pairing';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import {
  RESPONSE_ORACLE_CALIBRATION_VERSION, RESPONSE_ORACLE_CHUNK_SIZE,
  RESPONSE_ORACLE_HALVING_DEPTHS,
  calibrationChunkBounds, calibrationChunkCount, createCalibrationScoreChunk,
  createResponseOracleCalibrationManifest, createResponseOracleCalibrationReport,
  createSuccessiveHalvingArtifact, nextSuccessiveHalvingRound,
  validateCalibrationScoreChunk, validateResponseOracleCalibrationManifest,
  validateResponseOracleCalibrationReport, validateSuccessiveHalvingArtifact
} from '../src/sim/responseOracleCalibration';
import type {
  CalibrationLane, CalibrationScoreChunk, CalibrationSourceIdentity,
  ResponseOracleCalibrationManifest, ResponseOracleCalibrationReport,
  SuccessiveHalvingArtifact
} from '../src/sim/responseOracleCalibration';
import type { EquilibriumResult } from '../src/sim/equilibrium';
import type { Strategy } from '../src/sim/strategy';

interface RunOptions {
  mode: 'run';
  kingdomId: string;
  rankedFile: string;
  reservoirFile: string;
  p75ManifestFile: string;
  p75ReportFile: string;
  outputRoot: string;
  workers: number;
}
interface ReadOptions { mode: 'status' | 'report'; outputRoot: string }
type Options = RunOptions | ReadOptions;

export interface ValidatedResponseOracleCalibrationBundle {
  manifest: ResponseOracleCalibrationManifest;
  searchAChunks: CalibrationScoreChunk[];
  searchBChunks: CalibrationScoreChunk[];
  referenceChunks: CalibrationScoreChunk[];
  searchAHalving: SuccessiveHalvingArtifact;
  searchBHalving: SuccessiveHalvingArtifact;
  report: ResponseOracleCalibrationReport;
}

interface P75Report {
  schemaVersion: 2;
  experiment: 'initial-matrix-calibration-report';
  version: string;
  manifestHash: string;
  source: unknown;
  protocol: unknown;
  analysis: { prefixes: Array<{ seedRange: { startOrdinal: number; endOrdinal: number; count: number };
    equilibrium: EquilibriumResult }> };
}

function option(args: readonly string[], name: string, fallback?: string): string {
  const index = args.indexOf(`--${name}`);
  if (index < 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`--${name} is required.`);
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

export function parseCalibrationOptions(args: readonly string[]): Options {
  const modes = ['--run', '--status', '--report'].filter((flag) => args.includes(flag));
  if (modes.length !== 1) throw new Error('Use exactly one of --run, --status, or --report.');
  const mode = modes[0]!.slice(2) as Options['mode'];
  const valueFlags = mode === 'run'
    ? ['--kingdom', '--ranked', '--reservoir', '--p75-manifest', '--p75-report', '--out', '--workers']
    : ['--out'];
  const known = new Set([...valueFlags, ...modes]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith('--')) continue;
    if (!known.has(arg)) throw new Error(`Unknown option ${arg}.`);
    if (valueFlags.includes(arg)) index += 1;
  }
  const outputRoot = path.resolve(option(args, 'out'));
  if (mode !== 'run') return { mode, outputRoot };
  const workers = Number(option(args, 'workers', '4'));
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 192) {
    throw new Error('--workers must be from 1 to 192.');
  }
  return { mode, kingdomId: option(args, 'kingdom'), rankedFile: path.resolve(option(args, 'ranked')),
    reservoirFile: path.resolve(option(args, 'reservoir')),
    p75ManifestFile: path.resolve(option(args, 'p75-manifest')),
    p75ReportFile: path.resolve(option(args, 'p75-report')), outputRoot, workers };
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function scoreChunkFile(root: string, phase: CalibrationScoreChunk['phase'], chunk: number): string {
  return path.join(root, phase, `chunk-${String(chunk).padStart(3, '0')}.json`);
}

function halvingFile(root: string, lane: CalibrationLane): string {
  return path.join(root, `search-${lane}`, 'successive-halving.json');
}

function allowedFiles(root: string): Set<string> {
  const allowed = new Set(['manifest.json', 'report.json']);
  for (const phase of ['search-a', 'search-b', 'reference'] as const) {
    for (let chunk = 0; chunk < calibrationChunkCount(); chunk += 1) {
      allowed.add(path.relative(root, scoreChunkFile(root, phase, chunk)));
    }
  }
  allowed.add(path.relative(root, halvingFile(root, 'a')));
  allowed.add(path.relative(root, halvingFile(root, 'b')));
  return allowed;
}

function existingFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else files.push(path.relative(root, file));
    }
  };
  visit(root);
  return files;
}

function assertOutputFiles(root: string): void {
  const allowed = allowedFiles(root);
  for (const file of existingFiles(root)) if (!allowed.has(file)) {
    throw new Error(`Unexpected response-oracle calibration artifact ${file}.`);
  }
}

function validateOrderedArtifacts(options: RunOptions): void {
  for (const file of [options.rankedFile, `${options.rankedFile}.sha256`, options.reservoirFile,
    `${options.reservoirFile}.sha256`, options.p75ManifestFile, options.p75ReportFile]) {
    if (!fs.existsSync(file)) throw new Error(`Missing calibration source ${file}.`);
  }
  const result = spawnSync('npm', ['run', 'goldfish:ordered-product', '--', 'validate-reservoir',
    '--kingdom', options.kingdomId, '--artifact', options.rankedFile, '--reservoir', options.reservoirFile],
  { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Ordered ranked/reservoir validation failed.');
}

export function loadCalibrationSources(options: RunOptions): {
  manifest: ResponseOracleCalibrationManifest;
  reservoir: OrderedProductReservoirArtifact;
} {
  validateOrderedArtifacts(options);
  const ranked = readJson<unknown>(options.rankedFile);
  const reservoir = readJson<OrderedProductReservoirArtifact>(options.reservoirFile);
  const p75ManifestValue = readJson<unknown>(options.p75ManifestFile);
  if (!validateInitialMatrixManifest(p75ManifestValue)) throw new Error('P75 initial-matrix manifest is invalid.');
  const p75Manifest = p75ManifestValue as InitialMatrixManifest;
  const p75Report = readJson<P75Report>(options.p75ReportFile);
  const rankedSha256 = sha256File(options.rankedFile), reservoirSha256 = sha256File(options.reservoirFile);
  const validated = validateOrderedCalibrationSource({ kingdomId: options.kingdomId, ranked, reservoir,
    rankedSha256, reservoirSha256 });
  if (p75Manifest.protocol.kingdomId !== options.kingdomId
    || !exact(p75Manifest.protocol.source, validated.source)
    || !exact(p75Manifest.strategies, validated.strategies)
    || p75Report.schemaVersion !== 2 || p75Report.experiment !== 'initial-matrix-calibration-report'
    || p75Report.version !== p75Manifest.protocol.version || p75Report.manifestHash !== p75Manifest.evidenceHash
    || !exact(p75Report.source, p75Manifest.protocol.source) || !exact(p75Report.protocol, p75Manifest.protocol)) {
    throw new Error('P75 report does not match the validated ordered source and initial-matrix manifest.');
  }
  const p75 = p75Report.analysis?.prefixes?.find((entry) => entry.seedRange.startOrdinal === 1
    && entry.seedRange.endOrdinal === 75 && entry.seedRange.count === 75);
  const ids = p75Manifest.strategies.map((strategy) => strategy.id);
  if (!p75 || !exact([...p75.equilibrium.strategyIds].sort(), [...ids].sort())
    || !exact(Object.keys(p75.equilibrium.weights).sort(), [...ids].sort())) {
    throw new Error('P75 report does not contain the complete 50-strategy P75 lottery.');
  }
  const source: CalibrationSourceIdentity = {
    kingdomId: options.kingdomId, rankedPath: options.rankedFile, reservoirPath: options.reservoirFile,
    p75ManifestPath: options.p75ManifestFile, p75ReportPath: options.p75ReportFile,
    rankedSha256, reservoirSha256, p75ManifestSha256: sha256File(options.p75ManifestFile),
    p75ReportSha256: sha256File(options.p75ReportFile), p75ManifestHash: p75Manifest.evidenceHash,
    reservoirRunId: validated.source.runId, reservoirVersion: validated.source.productVersion,
    rulesFingerprint: validated.source.ruleFingerprint
  };
  return { manifest: createResponseOracleCalibrationManifest({ source,
    p75Strategies: p75Manifest.strategies, p75Weights: p75.equilibrium.weights,
    candidates: reservoir.entries.slice(50).map((entry) => ({ goldfishRank: entry.rank, strategy: entry.strategy })) }),
  reservoir };
}

function loadManifest(file: string, expected?: ResponseOracleCalibrationManifest): ResponseOracleCalibrationManifest {
  const value = readJson<unknown>(file);
  if (!validateResponseOracleCalibrationManifest(value, expected)) {
    throw new Error('Saved response-oracle calibration manifest is stale or corrupt.');
  }
  return value;
}

function assertManifestSourceFiles(manifest: ResponseOracleCalibrationManifest): void {
  const sources = [[manifest.source.rankedPath, manifest.source.rankedSha256],
    [manifest.source.reservoirPath, manifest.source.reservoirSha256],
    [manifest.source.p75ManifestPath, manifest.source.p75ManifestSha256],
    [manifest.source.p75ReportPath, manifest.source.p75ReportSha256]] as const;
  for (const [file, expectedHash] of sources) {
    if (!fs.existsSync(file) || sha256File(file) !== expectedHash) {
      throw new Error(`Calibration source bytes are missing or changed: ${file}`);
    }
  }
  const p75Manifest = readJson<unknown>(manifest.source.p75ManifestPath);
  if (!validateInitialMatrixManifest(p75Manifest)
    || p75Manifest.evidenceHash !== manifest.source.p75ManifestHash) {
    throw new Error('Calibration P75 manifest hash is stale or corrupt.');
  }
}

function scheduleSlice(schedule: MixtureSchedule, start: number, end: number): MixtureSchedule {
  const blocks = schedule.blocks.slice(start, end);
  const ids = Object.keys(schedule.targetWeights);
  const realizedOpponentCounts = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const block of blocks) {
    realizedOpponentCounts[block.opponentId] = (realizedOpponentCounts[block.opponentId] ?? 0) + 1;
  }
  return { targetWeights: structuredClone(schedule.targetWeights), blocks, realizedOpponentCounts,
    unsampledPositiveWeightStrategies: ids.filter((id) => realizedOpponentCounts[id] === 0) };
}

async function fillScoreChunks(input: {
  root: string;
  phase: CalibrationScoreChunk['phase'];
  manifest: ResponseOracleCalibrationManifest;
  strategies: readonly Strategy[];
  runner: WorkerPairingRunner;
}): Promise<CalibrationScoreChunk[]> {
  const schedule = input.phase === 'search-a' ? scheduleSlice(input.manifest.schedules.searchA, 0, 50)
    : input.phase === 'search-b' ? scheduleSlice(input.manifest.schedules.searchB, 0, 50)
      : input.manifest.schedules.reference;
  const chunks: CalibrationScoreChunk[] = [];
  for (let chunk = 0; chunk < calibrationChunkCount(); chunk += 1) {
    const file = scoreChunkFile(input.root, input.phase, chunk);
    if (fs.existsSync(file)) {
      const held = readJson<unknown>(file);
      if (!validateCalibrationScoreChunk(held, input.manifest, input.phase, chunk)) {
        throw new Error(`Saved calibration chunk is corrupt: ${file}`);
      }
      chunks.push(held); continue;
    }
    const bounds = calibrationChunkBounds(chunk);
    const start = bounds.startRank - 51, end = bounds.endRank - 50;
    const candidates = input.strategies.slice(start, end);
    const started = performance.now();
    const evaluations = await evaluateCandidates(candidates,
      new Map(input.manifest.p75Strategies.map((strategy) => [strategy.id, strategy])), schedule, input.runner, {
        kingdomId: input.manifest.source.kingdomId, turnLimitPerPlayer: 30, actionCapPerTurn: 200,
        startingDraftEnabled: false, scoreOnly: true
      });
    const artifact = createCalibrationScoreChunk({ manifest: input.manifest, phase: input.phase, chunk,
      rows: evaluations.map((entry) => ({ strategy: entry.strategy, blockScores: entry.blockScores,
        matches: entry.matches })), elapsedMs: performance.now() - started });
    writeAtomic(file, artifact); chunks.push(artifact);
    console.log(`${input.phase} chunk ${chunk + 1}/${calibrationChunkCount()} ranks ${bounds.startRank}-${bounds.endRank}`);
  }
  return chunks;
}

async function runHalving(input: {
  root: string;
  lane: CalibrationLane;
  manifest: ResponseOracleCalibrationManifest;
  strategies: readonly Strategy[];
  fixedRows: readonly CalibrationScoreChunk['rows'][number][];
  runner: WorkerPairingRunner;
}): Promise<SuccessiveHalvingArtifact> {
  const file = halvingFile(input.root, input.lane);
  let artifact: SuccessiveHalvingArtifact;
  if (fs.existsSync(file)) {
    const held = readJson<unknown>(file);
    if (!validateSuccessiveHalvingArtifact(held, input.manifest, input.lane, input.fixedRows)) {
      throw new Error(`Saved Successive Halving artifact is corrupt: ${file}`);
    }
    artifact = held;
  } else {
    artifact = createSuccessiveHalvingArtifact({ manifest: input.manifest, lane: input.lane,
      fixedRows: input.fixedRows });
    writeAtomic(file, artifact);
  }
  const strategies = new Map(input.strategies.map((strategy) => [strategy.id, strategy]));
  const opponents = new Map(input.manifest.p75Strategies.map((strategy) => [strategy.id, strategy]));
  const schedule = input.lane === 'a' ? input.manifest.schedules.searchA : input.manifest.schedules.searchB;
  while (!artifact.complete) {
    const roundIndex = artifact.rounds.length, depth = RESPONSE_ORACLE_HALVING_DEPTHS[roundIndex]!;
    const previousDepth = roundIndex ? RESPONSE_ORACLE_HALVING_DEPTHS[roundIndex - 1]! : 0;
    const scoreStart = Math.min(depth, Math.max(50, previousDepth));
    const activeIds = roundIndex ? artifact.rounds.at(-1)!.survivors
      : input.manifest.candidates.map((entry) => entry.strategyId);
    const addedScores: Record<string, number[]> = Object.fromEntries(activeIds.map((id) => [id, []]));
    let elapsedMs = 0;
    if (depth > scoreStart) {
      const topupSchedule = scheduleSlice(schedule, scoreStart, depth);
      for (let start = 0; start < activeIds.length; start += RESPONSE_ORACLE_CHUNK_SIZE) {
        const ids = activeIds.slice(start, start + RESPONSE_ORACLE_CHUNK_SIZE);
        const candidates = ids.map((id) => {
          const strategy = strategies.get(id);
          if (!strategy) throw new Error(`Successive Halving candidate ${id} is missing.`);
          return strategy;
        });
        const started = performance.now();
        const evaluations = await evaluateCandidates(candidates, opponents, topupSchedule, input.runner, {
          kingdomId: input.manifest.source.kingdomId, turnLimitPerPlayer: 30, actionCapPerTurn: 200,
          startingDraftEnabled: false, scoreOnly: true
        });
        elapsedMs += performance.now() - started;
        for (const evaluation of evaluations) {
          if (evaluation.matches !== topupSchedule.blocks.length * GAMES_PER_SEED) {
            throw new Error('Successive Halving returned incorrect game accounting.');
          }
          addedScores[evaluation.strategy.id] = evaluation.blockScores;
        }
      }
    }
    artifact = nextSuccessiveHalvingRound({ manifest: input.manifest, lane: input.lane,
      fixedRows: input.fixedRows, artifact, addedScores, elapsedMs });
    writeAtomic(file, artifact);
    console.log(`search-${input.lane} Successive Halving depth ${depth}: ${activeIds.length} active, `
      + `${artifact.rounds.at(-1)!.survivors.length} retained`);
  }
  return artifact;
}

function loadScoreChunks(root: string, phase: CalibrationScoreChunk['phase'],
  manifest: ResponseOracleCalibrationManifest): CalibrationScoreChunk[] {
  return Array.from({ length: calibrationChunkCount() }, (_unused, chunk) => {
    const file = scoreChunkFile(root, phase, chunk), value = fs.existsSync(file) ? readJson<unknown>(file) : null;
    if (!validateCalibrationScoreChunk(value, manifest, phase, chunk)) {
      throw new Error(`Calibration evidence is missing or corrupt: ${file}`);
    }
    return value;
  });
}

async function run(options: RunOptions): Promise<ResponseOracleCalibrationReport> {
  const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === options.kingdomId);
  if (!kingdom) throw new Error(`Unknown calibration kingdom ${options.kingdomId}.`);
  registerKingdom(kingdom);
  const sources = loadCalibrationSources(options);
  const manifestFile = path.join(options.outputRoot, 'manifest.json');
  assertOutputFiles(options.outputRoot);
  let manifest = sources.manifest;
  if (fs.existsSync(manifestFile)) manifest = loadManifest(manifestFile, sources.manifest);
  else { fs.mkdirSync(options.outputRoot, { recursive: true }); writeAtomic(manifestFile, manifest); }
  assertOutputFiles(options.outputRoot);
  const strategies = sources.reservoir.entries.slice(50).map((entry) => entry.strategy);
  const runner = new WorkerPairingRunner(options.workers, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  try {
    const searchAChunks = await fillScoreChunks({ root: options.outputRoot, phase: 'search-a', manifest,
      strategies, runner });
    const searchBChunks = await fillScoreChunks({ root: options.outputRoot, phase: 'search-b', manifest,
      strategies, runner });
    const searchA = searchAChunks.flatMap((chunk) => chunk.rows);
    const searchB = searchBChunks.flatMap((chunk) => chunk.rows);
    const searchAHalving = await runHalving({ root: options.outputRoot, lane: 'a', manifest,
      strategies, fixedRows: searchA, runner });
    const searchBHalving = await runHalving({ root: options.outputRoot, lane: 'b', manifest,
      strategies, fixedRows: searchB, runner });
    const referenceChunks = await fillScoreChunks({ root: options.outputRoot, phase: 'reference', manifest,
      strategies, runner });
    const report = createResponseOracleCalibrationReport({ manifest, searchAChunks, searchBChunks,
      referenceChunks, searchAHalving, searchBHalving });
    const reportFile = path.join(options.outputRoot, 'report.json');
    if (fs.existsSync(reportFile)) {
      const held = readJson<unknown>(reportFile);
      if (!validateResponseOracleCalibrationReport(held, { manifest, searchAChunks, searchBChunks,
        referenceChunks, searchAHalving, searchBHalving })) throw new Error('Saved calibration report is corrupt.');
      return held;
    }
    writeAtomic(reportFile, report);
    return report;
  } finally { await runner.close(); }
}

function status(root: string): void {
  const result = { version: RESPONSE_ORACLE_CALIBRATION_VERSION, root,
    manifest: fs.existsSync(path.join(root, 'manifest.json')),
    searchAChunks: 0, searchBChunks: 0, referenceChunks: 0,
    searchAHalving: fs.existsSync(halvingFile(root, 'a')),
    searchBHalving: fs.existsSync(halvingFile(root, 'b')),
    report: fs.existsSync(path.join(root, 'report.json')), unexpectedFiles: [] as string[] };
  for (let chunk = 0; chunk < calibrationChunkCount(); chunk += 1) {
    result.searchAChunks += Number(fs.existsSync(scoreChunkFile(root, 'search-a', chunk)));
    result.searchBChunks += Number(fs.existsSync(scoreChunkFile(root, 'search-b', chunk)));
    result.referenceChunks += Number(fs.existsSync(scoreChunkFile(root, 'reference', chunk)));
  }
  const allowed = allowedFiles(root);
  result.unexpectedFiles = existingFiles(root).filter((file) => !allowed.has(file));
  console.log(JSON.stringify(result, null, 2));
}

export function loadValidatedResponseOracleCalibration(
  root: string
): ValidatedResponseOracleCalibrationBundle {
  const resolvedRoot = path.resolve(root);
  assertOutputFiles(resolvedRoot);
  const manifest = loadManifest(path.join(resolvedRoot, 'manifest.json'));
  assertManifestSourceFiles(manifest);
  const searchAChunks = loadScoreChunks(resolvedRoot, 'search-a', manifest);
  const searchBChunks = loadScoreChunks(resolvedRoot, 'search-b', manifest);
  const referenceChunks = loadScoreChunks(resolvedRoot, 'reference', manifest);
  const searchA = searchAChunks.flatMap((chunk) => chunk.rows);
  const searchB = searchBChunks.flatMap((chunk) => chunk.rows);
  const searchAHalvingValue = readJson<unknown>(halvingFile(resolvedRoot, 'a'));
  const searchBHalvingValue = readJson<unknown>(halvingFile(resolvedRoot, 'b'));
  if (!validateSuccessiveHalvingArtifact(searchAHalvingValue, manifest, 'a', searchA)
    || !validateSuccessiveHalvingArtifact(searchBHalvingValue, manifest, 'b', searchB)
    || !searchAHalvingValue.complete || !searchBHalvingValue.complete) {
    throw new Error('Saved calibration halving evidence is missing, incomplete, or corrupt.');
  }
  const reportInput = { manifest, searchAChunks, searchBChunks, referenceChunks,
    searchAHalving: searchAHalvingValue, searchBHalving: searchBHalvingValue };
  const reportValue = readJson<unknown>(path.join(resolvedRoot, 'report.json'));
  if (!validateResponseOracleCalibrationReport(reportValue, reportInput)) {
    throw new Error('Saved calibration report is corrupt.');
  }
  return { ...reportInput, report: reportValue };
}

function printReport(root: string): void {
  console.log(JSON.stringify(loadValidatedResponseOracleCalibration(root).report, null, 2));
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseCalibrationOptions(args);
  if (options.mode === 'status') { status(options.outputRoot); return; }
  if (options.mode === 'report') { printReport(options.outputRoot); return; }
  const report = await run(options as RunOptions);
  console.log(JSON.stringify({ report: path.join(options.outputRoot, 'report.json'), status: report.status,
    games: report.accounting.total.games, elapsedMs: report.accounting.total.elapsedMs }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
