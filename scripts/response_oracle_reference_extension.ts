import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { evaluateCandidates } from '../src/sim/mixtureEvaluation';
import type { OrderedProductReservoirArtifact } from '../src/sim/orderedGoldfishProduct';
import { GAMES_PER_SEED } from '../src/sim/pairing';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { calibrationChunkBounds, calibrationChunkCount } from '../src/sim/responseOracleCalibration';
import {
  RESPONSE_ORACLE_EXTENSION_GAMES, RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION,
  createResponseOracleReferenceExtensionChunk, createResponseOracleReferenceExtensionManifest,
  createResponseOracleReferenceExtensionReport, validateResponseOracleReferenceExtensionChunk,
  validateResponseOracleReferenceExtensionManifest, validateResponseOracleReferenceExtensionReport
} from '../src/sim/responseOracleReferenceExtension';
import type {
  ResponseOracleReferenceExtensionChunk, ResponseOracleReferenceExtensionManifest,
  ResponseOracleReferenceExtensionReport
} from '../src/sim/responseOracleReferenceExtension';
import { canonicalStrategy } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import {
  loadValidatedResponseOracleCalibration
} from './response_oracle_calibration';
import type { ValidatedResponseOracleCalibrationBundle } from './response_oracle_calibration';

interface ExtensionOptions {
  mode: 'run' | 'status' | 'report';
  baseRoot: string;
  outputRoot: string;
  workers?: number;
}

function option(args: readonly string[], name: string): string {
  const index = args.indexOf(`--${name}`);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}

function outputIsInsideBase(baseRoot: string, outputRoot: string): boolean {
  const relative = path.relative(baseRoot, outputRoot);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function parseResponseOracleReferenceExtensionOptions(args: readonly string[]): ExtensionOptions {
  const modeFlags = ['--run', '--status', '--report'].filter((flag) => args.includes(flag));
  if (modeFlags.length !== 1) throw new Error('Use exactly one of --run, --status, or --report.');
  const mode = modeFlags[0]!.slice(2) as ExtensionOptions['mode'];
  const valueFlags = mode === 'run' ? ['--base', '--out', '--workers'] : ['--base', '--out'];
  const known = new Set([...modeFlags, ...valueFlags]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith('--') || !known.has(arg)) throw new Error(`Unknown option ${arg}.`);
    if (valueFlags.includes(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value.`);
      index += 1;
    }
  }
  const baseRoot = path.resolve(option(args, 'base'));
  const outputRoot = path.resolve(option(args, 'out'));
  if (outputIsInsideBase(baseRoot, outputRoot)) {
    throw new Error('The extension output root must be separate from and outside the base root.');
  }
  if (mode !== 'run') return { mode, baseRoot, outputRoot };
  const workersIndex = args.indexOf('--workers');
  const workers = Number(workersIndex < 0 ? '4' : args[workersIndex + 1]);
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 192) {
    throw new Error('--workers must be from 1 to 192.');
  }
  return { mode, baseRoot, outputRoot, workers };
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function extensionChunkFile(root: string, chunk: number): string {
  return path.join(root, 'reference-101-200', `chunk-${String(chunk).padStart(3, '0')}.json`);
}

function allowedExtensionFiles(root: string): Set<string> {
  const allowed = new Set(['manifest.json', 'report.json']);
  for (let chunk = 0; chunk < calibrationChunkCount(); chunk += 1) {
    allowed.add(path.relative(root, extensionChunkFile(root, chunk)));
  }
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

export function assertResponseOracleReferenceExtensionFiles(root: string): void {
  const allowed = allowedExtensionFiles(root);
  for (const file of existingFiles(root)) if (!allowed.has(file)) {
    throw new Error(`Unexpected response-oracle reference extension artifact ${file}.`);
  }
}

function expectedExtensionManifest(baseRoot: string,
  bundle: ValidatedResponseOracleCalibrationBundle): ResponseOracleReferenceExtensionManifest {
  return createResponseOracleReferenceExtensionManifest({ baseRoot, manifest: bundle.manifest,
    report: bundle.report });
}

function loadExtensionManifest(outputRoot: string, baseRoot: string,
  bundle: ValidatedResponseOracleCalibrationBundle): ResponseOracleReferenceExtensionManifest {
  const file = path.join(outputRoot, 'manifest.json');
  const value = readJson<unknown>(file);
  if (!validateResponseOracleReferenceExtensionManifest(value,
    { baseRoot, manifest: bundle.manifest, report: bundle.report })) {
    throw new Error('Saved response-oracle reference extension manifest is stale or corrupt.');
  }
  return value;
}

function loadExistingExtensionChunks(outputRoot: string, extensionManifest: ResponseOracleReferenceExtensionManifest,
  bundle: ValidatedResponseOracleCalibrationBundle): Array<ResponseOracleReferenceExtensionChunk | null> {
  return Array.from({ length: calibrationChunkCount() }, (_unused, chunk) => {
    const file = extensionChunkFile(outputRoot, chunk);
    if (!fs.existsSync(file)) return null;
    const value = readJson<unknown>(file);
    if (!validateResponseOracleReferenceExtensionChunk(value, extensionManifest, bundle.manifest, chunk)) {
      throw new Error(`Saved response-oracle reference extension chunk is corrupt: ${file}`);
    }
    return value;
  });
}

function completeChunks(chunks: readonly (ResponseOracleReferenceExtensionChunk | null)[]
): ResponseOracleReferenceExtensionChunk[] {
  if (chunks.some((chunk) => !chunk)) throw new Error('Response-oracle reference extension chunks are incomplete.');
  return chunks as ResponseOracleReferenceExtensionChunk[];
}

function validateSavedReport(outputRoot: string, extensionManifest: ResponseOracleReferenceExtensionManifest,
  bundle: ValidatedResponseOracleCalibrationBundle, chunks: readonly ResponseOracleReferenceExtensionChunk[]
): ResponseOracleReferenceExtensionReport | null {
  const file = path.join(outputRoot, 'report.json');
  if (!fs.existsSync(file)) return null;
  const value = readJson<unknown>(file);
  const input = { extensionManifest, baseManifest: bundle.manifest, baseReport: bundle.report,
    originalReferenceChunks: bundle.referenceChunks, extensionChunks: chunks };
  if (!validateResponseOracleReferenceExtensionReport(value, input)) {
    throw new Error('Saved response-oracle reference extension report is stale or corrupt.');
  }
  return value;
}

function loadCandidateStrategies(bundle: ValidatedResponseOracleCalibrationBundle): Strategy[] {
  const reservoir = readJson<OrderedProductReservoirArtifact>(bundle.manifest.source.reservoirPath);
  const entries = reservoir.entries?.slice(50);
  if (!entries || entries.length !== bundle.manifest.candidates.length) {
    throw new Error('Pinned response-oracle reservoir candidate count changed.');
  }
  return entries.map((entry, index) => {
    const expected = bundle.manifest.candidates[index]!;
    if (entry.rank !== expected.goldfishRank || entry.strategy.id !== expected.strategyId
      || canonicalStrategy(entry.strategy) !== expected.canonicalStrategy) {
      throw new Error(`Pinned response-oracle reservoir candidate rank ${expected.goldfishRank} changed.`);
    }
    return entry.strategy;
  });
}

async function fillExtensionChunks(input: {
  outputRoot: string;
  extensionManifest: ResponseOracleReferenceExtensionManifest;
  bundle: ValidatedResponseOracleCalibrationBundle;
  strategies: readonly Strategy[];
  runner: WorkerPairingRunner;
  existing: readonly (ResponseOracleReferenceExtensionChunk | null)[];
}): Promise<ResponseOracleReferenceExtensionChunk[]> {
  const chunks: ResponseOracleReferenceExtensionChunk[] = [];
  const opponents = new Map(input.bundle.manifest.p75Strategies.map((strategy) => [strategy.id, strategy]));
  if (input.extensionManifest.extensionSchedule.blocks.length !== 100) {
    throw new Error('The reference extension schedule must contain 100 blocks.');
  }
  for (let chunk = 0; chunk < calibrationChunkCount(); chunk += 1) {
    const held = input.existing[chunk];
    if (held) { chunks.push(held); continue; }
    const bounds = calibrationChunkBounds(chunk);
    if (bounds.startRank < 51 || bounds.endRank > 20_000) throw new Error('Extension rank bounds are invalid.');
    const candidates = input.strategies.slice(bounds.startRank - 51, bounds.endRank - 50);
    const started = performance.now();
    const evaluations = await evaluateCandidates(candidates, opponents,
      input.extensionManifest.extensionSchedule, input.runner, {
        kingdomId: input.bundle.manifest.source.kingdomId,
        turnLimitPerPlayer: input.extensionManifest.protocol.turnLimitPerPlayer,
        actionCapPerTurn: input.extensionManifest.protocol.actionCapPerTurn,
        startingDraftEnabled: input.extensionManifest.protocol.startingDraftEnabled,
        scoreOnly: input.extensionManifest.protocol.scoreOnly
      });
    if (evaluations.some((entry) => entry.blockScores.length !== 100
      || entry.matches !== 100 * GAMES_PER_SEED)) {
      throw new Error('Reference extension evaluation returned incorrect game accounting.');
    }
    const artifact = createResponseOracleReferenceExtensionChunk({
      extensionManifest: input.extensionManifest, baseManifest: input.bundle.manifest, chunk,
      rows: evaluations.map((entry) => ({ strategy: entry.strategy, blockScores: entry.blockScores,
        matches: entry.matches })), elapsedMs: performance.now() - started
    });
    const file = extensionChunkFile(input.outputRoot, chunk);
    if (fs.existsSync(file)) throw new Error(`Reference extension chunk appeared during evaluation: ${file}`);
    writeAtomic(file, artifact);
    chunks.push(artifact);
    console.log(`reference-101-200 chunk ${chunk + 1}/${calibrationChunkCount()} `
      + `ranks ${bounds.startRank}-${bounds.endRank}`);
  }
  return chunks;
}

function createOrLoadReport(outputRoot: string, extensionManifest: ResponseOracleReferenceExtensionManifest,
  bundle: ValidatedResponseOracleCalibrationBundle, chunks: readonly ResponseOracleReferenceExtensionChunk[]
): ResponseOracleReferenceExtensionReport {
  const existing = validateSavedReport(outputRoot, extensionManifest, bundle, chunks);
  if (existing) return existing;
  const report = createResponseOracleReferenceExtensionReport({ extensionManifest,
    baseManifest: bundle.manifest, baseReport: bundle.report,
    originalReferenceChunks: bundle.referenceChunks, extensionChunks: chunks });
  writeAtomic(path.join(outputRoot, 'report.json'), report);
  return report;
}

async function run(options: ExtensionOptions): Promise<ResponseOracleReferenceExtensionReport> {
  const bundle = loadValidatedResponseOracleCalibration(options.baseRoot);
  assertResponseOracleReferenceExtensionFiles(options.outputRoot);
  const manifestFile = path.join(options.outputRoot, 'manifest.json');
  let extensionManifest: ResponseOracleReferenceExtensionManifest;
  if (fs.existsSync(manifestFile)) {
    extensionManifest = loadExtensionManifest(options.outputRoot, options.baseRoot, bundle);
  } else {
    if (existingFiles(options.outputRoot).length) {
      throw new Error('Extension artifacts exist without a manifest.');
    }
    extensionManifest = expectedExtensionManifest(options.baseRoot, bundle);
    writeAtomic(manifestFile, extensionManifest);
  }
  assertResponseOracleReferenceExtensionFiles(options.outputRoot);
  const existing = loadExistingExtensionChunks(options.outputRoot, extensionManifest, bundle);
  if (fs.existsSync(path.join(options.outputRoot, 'report.json'))) {
    validateSavedReport(options.outputRoot, extensionManifest, bundle, completeChunks(existing));
  }
  const strategies = loadCandidateStrategies(bundle);
  const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === bundle.manifest.source.kingdomId);
  if (!kingdom) throw new Error(`Unknown response-oracle extension kingdom ${bundle.manifest.source.kingdomId}.`);
  registerKingdom(kingdom);
  const runner = new WorkerPairingRunner(options.workers!, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  let chunks: ResponseOracleReferenceExtensionChunk[];
  try {
    chunks = await fillExtensionChunks({ outputRoot: options.outputRoot, extensionManifest, bundle,
      strategies, runner, existing });
  } finally { await runner.close(); }
  const report = createOrLoadReport(options.outputRoot, extensionManifest, bundle, chunks);
  if (report.accounting.addedGames !== RESPONSE_ORACLE_EXTENSION_GAMES) {
    throw new Error('Reference extension report has incorrect added-game accounting.');
  }
  return report;
}

function status(options: ExtensionOptions): void {
  const bundle = loadValidatedResponseOracleCalibration(options.baseRoot);
  assertResponseOracleReferenceExtensionFiles(options.outputRoot);
  const files = existingFiles(options.outputRoot);
  const manifestFile = path.join(options.outputRoot, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    if (files.length) throw new Error('Extension artifacts exist without a manifest.');
    console.log(JSON.stringify({ version: RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION,
      base: options.baseRoot, root: options.outputRoot, manifest: false, referenceChunks: 0,
      report: false, candidateSeedEvaluations: 0, games: 0 }, null, 2));
    return;
  }
  const extensionManifest = loadExtensionManifest(options.outputRoot, options.baseRoot, bundle);
  const chunks = loadExistingExtensionChunks(options.outputRoot, extensionManifest, bundle);
  const present = chunks.filter((chunk): chunk is ResponseOracleReferenceExtensionChunk => Boolean(chunk));
  const reportFile = path.join(options.outputRoot, 'report.json');
  if (fs.existsSync(reportFile)) validateSavedReport(options.outputRoot, extensionManifest, bundle,
    completeChunks(chunks));
  console.log(JSON.stringify({ version: RESPONSE_ORACLE_REFERENCE_EXTENSION_VERSION,
    base: options.baseRoot, root: options.outputRoot, manifest: true, referenceChunks: present.length,
    report: fs.existsSync(reportFile),
    candidateSeedEvaluations: present.reduce((sum, chunk) => sum + chunk.candidateSeedEvaluations, 0),
    games: present.reduce((sum, chunk) => sum + chunk.games, 0) }, null, 2));
}

function report(options: ExtensionOptions): void {
  const bundle = loadValidatedResponseOracleCalibration(options.baseRoot);
  assertResponseOracleReferenceExtensionFiles(options.outputRoot);
  const extensionManifest = loadExtensionManifest(options.outputRoot, options.baseRoot, bundle);
  const chunks = completeChunks(loadExistingExtensionChunks(options.outputRoot, extensionManifest, bundle));
  console.log(JSON.stringify(createOrLoadReport(options.outputRoot, extensionManifest, bundle, chunks), null, 2));
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseResponseOracleReferenceExtensionOptions(args);
  if (options.mode === 'status') { status(options); return; }
  if (options.mode === 'report') { report(options); return; }
  const result = await run(options);
  console.log(JSON.stringify({ report: path.join(options.outputRoot, 'report.json'), status: result.status,
    addedGames: result.accounting.addedGames,
    elapsedMs: result.accounting.extensionReference.elapsedMs }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
