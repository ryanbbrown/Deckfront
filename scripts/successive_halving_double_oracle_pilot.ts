import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { solveEquilibrium } from '../src/sim/equilibrium';
import type { EquilibriumResult } from '../src/sim/equilibrium';
import { reconstructMatrixCache } from '../src/sim/fixedReservoirConsistency';
import { validateInitialMatrixChunk } from '../src/sim/initialMatrixCalibration';
import type { InitialMatrixChunk, InitialMatrixManifest } from '../src/sim/initialMatrixCalibration';
import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean } from '../src/sim/mixtureEvaluation';
import type { OrderedProductReservoirArtifact } from '../src/sim/orderedGoldfishProduct';
import { matrixProtocol, payoffMatrixPairKey, PayoffMatrix } from '../src/sim/payoffMatrix';
import type { MatrixCell, MatrixSnapshot } from '../src/sim/payoffMatrix';
import { GAMES_PER_SEED, emptyAggregate, mergeAggregate } from '../src/sim/pairing';
import type { PairingRunner } from '../src/sim/pairingRunner';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import {
  RESPONSE_ORACLE_HALVING_DEPTHS, rankCalibrationCandidates
} from '../src/sim/responseOracleCalibration';
import type {
  CalibrationCandidateIdentity, ResponseOracleCalibrationManifest
} from '../src/sim/responseOracleCalibration';
import { canonicalStrategy, stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import { loadCalibrationSources } from './response_oracle_calibration';

export const PILOT_VERSION = 'successive-halving-double-oracle-pilot-v1' as const;
export const PILOT_KINGDOMS = ['deep-beam-tuning-001', 'deep-beam-tuning-007',
  'deep-beam-tuning-008'] as const;
const MATRIX_BLOCKS = 75;
const CONFIRMATION_BLOCKS = 400;
const MAX_CYCLES = 100;

type KingdomId = typeof PILOT_KINGDOMS[number];
interface InputEntry { kingdomId: KingdomId; ranked: string; reservoir: string; p75Root: string }
interface Inputs { schemaVersion: 1; kingdoms: InputEntry[] }
interface Source {
  entry: InputEntry;
  calibration: ResponseOracleCalibrationManifest;
  reservoir: OrderedProductReservoirArtifact;
  initialMatrix: MatrixSnapshot;
  seeds: CycleSeeds[];
}
interface CycleSeeds {
  halving: number[]; halvingOpponent: number; tie: number;
  confirmation: number[]; confirmationOpponent: number; bootstrap: number;
}
interface HalvingResult {
  selected: Strategy;
  selectedMean: number;
  rounds: Array<{ depth: number; entered: number; survivors: number }>;
  candidateSeedEvaluations: number;
  games: number;
  elapsedMs: number;
}
interface CycleReport {
  cycle: number;
  matrixSizeBefore: number;
  matrixSizeAfter: number;
  inactiveCandidates: number;
  selectedStrategyId: string;
  selectedCanonicalStrategy: string;
  selectedGoldfishRank: number;
  selectedHalvingMean: number;
  confirmationMean: number;
  confirmationInterval95: { lower: number; upper: number };
  admitted: boolean;
  stopReason: 'running' | 'selected-response-not-admitted' | 'cycle-safety-cap';
  safetyCapReached: boolean;
  games: { halving: number; confirmation: number; matrix: number; total: number };
  elapsedMs: { halving: number; confirmation: number; matrix: number; total: number };
}
interface Checkpoint {
  schemaVersion: 1;
  experiment: 'successive-halving-double-oracle-pilot';
  version: typeof PILOT_VERSION;
  runId?: number;
  status: 'running' | 'complete';
  exploratory: true;
  formalClosure: false;
  kingdomId: KingdomId;
  source: { reservoirSha256: string; p75ManifestHash: string; p75ManifestSha256: string; p75ReportSha256: string };
  cycles: CycleReport[];
  matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult;
  stopReason: CycleReport['stopReason'];
  safetyCapReached: boolean;
  games: number;
  elapsedMs: number;
  evidenceHash: string;
}

function exact(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function withHash<T extends object>(base: T): T & { evidenceHash: string } {
  return { ...base, evidenceHash: hash(base) };
}
function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function validHash(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('evidenceHash' in value)
    || typeof value.evidenceHash !== 'string') return false;
  const copy = structuredClone(value) as Record<string, unknown>, held = copy.evidenceHash;
  delete copy.evidenceHash; return held === hash(copy);
}
function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function pilotSeedPlan(manifest: ResponseOracleCalibrationManifest, runId = 1): CycleSeeds[] {
  const countPerCycle = RESPONSE_ORACLE_HALVING_DEPTHS.at(-1)! + CONFIRMATION_BLOCKS + 5;
  const total = countPerCycle * MAX_CYCLES;
  const reserved = new Set(manifest.seedPlan.searchA.gameSeeds.slice(0, 0));
  const matrixManifest = readJson<InitialMatrixManifest>(manifest.source.p75ManifestPath);
  matrixManifest.protocol.seeds.slice(0, MATRIX_BLOCKS).forEach((seed) => reserved.add(seed));
  const runNamespace = runId === 1 ? '' : `:replicate:${runId}`;
  let root = Number.parseInt(stableHash(`${PILOT_VERSION}:${manifest.source.kingdomId}:`
    + `${manifest.source.reservoirSha256}:${manifest.source.p75ManifestHash}${runNamespace}`).slice(0, 8), 16) >>> 0;
  const collides = (start: number) => {
    for (const seed of reserved) {
      const distance = (seed - start) >>> 0;
      if (distance < total) return true;
    }
    return false;
  };
  while (collides(root)) root = (root + total) >>> 0;
  const value = (offset: number) => (root + offset) >>> 0;
  return Array.from({ length: MAX_CYCLES }, (_unused, index) => {
    let offset = index * countPerCycle;
    const halving = Array.from({ length: RESPONSE_ORACLE_HALVING_DEPTHS.at(-1)! }, () => value(offset++));
    const halvingOpponent = value(offset++), tie = value(offset++);
    const confirmation = Array.from({ length: CONFIRMATION_BLOCKS }, () => value(offset++));
    const confirmationOpponent = value(offset++), bootstrap = value(offset++);
    return { halving, halvingOpponent, tie, confirmation, confirmationOpponent, bootstrap };
  });
}

function loadP75Matrix(manifest: ResponseOracleCalibrationManifest): MatrixSnapshot {
  const source = readJson<InitialMatrixManifest>(manifest.source.p75ManifestPath);
  const protocol = matrixProtocol(source.protocol.kingdomId, source.protocol.seeds.slice(0, MATRIX_BLOCKS), 30, 200, false);
  const centeredPayoffs = source.strategies.map(() => source.strategies.map(() => 0));
  const cells: MatrixCell[] = [];
  for (let rowIndex = 0; rowIndex < 50; rowIndex += 1) for (let columnIndex = rowIndex + 1;
    columnIndex < 50; columnIndex += 1) {
    const records: InitialMatrixChunk['records'] = [];
    for (let start = 0; start < MATRIX_BLOCKS; start += source.protocol.chunkSize) {
      const file = path.join(path.dirname(manifest.source.p75ManifestPath), 'chunks',
        `cell-${String(rowIndex).padStart(2, '0')}-${String(columnIndex).padStart(2, '0')}`,
        `chunk-${String(start).padStart(6, '0')}.json`);
      const value = readJson<unknown>(file);
      if (!validateInitialMatrixChunk(value, source, rowIndex, columnIndex, start,
        Math.min(source.protocol.chunkSize, MATRIX_BLOCKS - start))) throw new Error(`Invalid P75 matrix chunk ${file}.`);
      records.push(...value.records);
    }
    const row = source.strategies[rowIndex]!, column = source.strategies[columnIndex]!;
    const originalScores = records.map((record) => record.payoffScore!);
    const centered = 2 * mean(originalScores) - 1;
    centeredPayoffs[rowIndex]![columnIndex] = centered;
    centeredPayoffs[columnIndex]![rowIndex] = -centered;
    const [first, second, scores] = row.id < column.id
      ? [row, column, originalScores] : [column, row, originalScores.map((score) => 1 - score)];
    const telemetry = emptyAggregate(); records.forEach((record) => mergeAggregate(telemetry, record.telemetry));
    cells.push({ rowId: first.id, columnId: second.id, key: payoffMatrixPairKey(protocol, first, second),
      blocks: scores.map((score, index) => ({ seed: protocol.seeds[index]!, score,
        played: GAMES_PER_SEED, aborted: 0 })), complete: true,
      centeredPayoff: 2 * mean(scores) - 1, matches: MATRIX_BLOCKS * GAMES_PER_SEED, telemetry });
  }
  cells.sort((left, right) => left.rowId.localeCompare(right.rowId)
    || left.columnId.localeCompare(right.columnId));
  const snapshot = { protocol, strategies: source.strategies, cells, complete: true, centeredPayoffs };
  const equilibrium = solveEquilibrium(source.strategies.map((strategy) => strategy.id), centeredPayoffs);
  const ids = source.strategies.map((strategy) => strategy.id);
  if (!exact(equilibrium.strategyIds, [...ids].sort())
    || ids.some((id) => Math.abs((equilibrium.weights[id] ?? 0) - (manifest.p75Weights[id] ?? 0)) > 1e-7)) {
    throw new Error('Rebuilt P75 matrix does not reproduce the approved P75 lottery.');
  }
  reconstructMatrixCache(snapshot);
  return snapshot;
}

async function loadSources(inputsFile: string, runId = 1): Promise<Source[]> {
  const inputs = readJson<Inputs>(inputsFile);
  if (inputs.schemaVersion !== 1 || inputs.kingdoms.length !== 3
    || inputs.kingdoms.some((entry, index) => entry.kingdomId !== PILOT_KINGDOMS[index])) {
    throw new Error('Pilot inputs must contain K001, K007, and K008 in order.');
  }
  const base = path.dirname(inputsFile), result: Source[] = [];
  for (const held of inputs.kingdoms) {
    const entry = { ...held, ranked: path.resolve(base, held.ranked), reservoir: path.resolve(base, held.reservoir),
      p75Root: path.resolve(base, held.p75Root) };
    const kingdom = deepBeamSuite.kingdoms.find((candidate) => candidate.id === entry.kingdomId);
    if (!kingdom) throw new Error(`Unknown pilot kingdom ${entry.kingdomId}.`);
    registerKingdom(kingdom);
    const loaded = loadCalibrationSources({ mode: 'run', kingdomId: entry.kingdomId,
      rankedFile: entry.ranked, reservoirFile: entry.reservoir,
      p75ManifestFile: path.join(entry.p75Root, 'manifest.json'),
      p75ReportFile: path.join(entry.p75Root, 'report.json'), outputRoot: path.join(entry.p75Root, '.unused'), workers: 1 });
    const initialMatrix = loadP75Matrix(loaded.manifest);
    result.push({ entry, calibration: loaded.manifest, reservoir: loaded.reservoir,
      initialMatrix, seeds: pilotSeedPlan(loaded.manifest, runId) });
  }
  return result;
}

export async function runStandardHalving(input: {
  candidates: readonly { identity: CalibrationCandidateIdentity; strategy: Strategy }[];
  opponents: ReadonlyMap<string, Strategy>;
  weights: Readonly<Record<string, number>>;
  seeds: CycleSeeds;
  kingdomId: string;
  runner: PairingRunner;
  depths?: readonly number[];
  evaluate?: typeof evaluateCandidates;
}): Promise<HalvingResult> {
  const depths = input.depths ?? RESPONSE_ORACLE_HALVING_DEPTHS;
  const evaluate = input.evaluate ?? evaluateCandidates;
  const schedule = mixtureSchedule(input.weights, input.seeds.halving, input.seeds.halvingOpponent);
  const byId = new Map(input.candidates.map((candidate) => [candidate.strategy.id, candidate]));
  const accumulated = new Map(input.candidates.map((candidate) => [candidate.strategy.id, [] as number[]]));
  let active = input.candidates.map((candidate) => candidate.strategy.id), previous = 0;
  let games = 0, elapsedMs = 0, selectedMean = 0;
  const rounds: HalvingResult['rounds'] = [];
  for (const depth of depths) {
    const slice = { ...schedule, blocks: schedule.blocks.slice(previous, depth) };
    const started = performance.now();
    const evaluated = await evaluate(active.map((id) => byId.get(id)!.strategy), input.opponents,
      slice, input.runner, { kingdomId: input.kingdomId, turnLimitPerPlayer: 30,
        actionCapPerTurn: 200, startingDraftEnabled: false, scoreOnly: true });
    elapsedMs += performance.now() - started;
    for (const result of evaluated) { accumulated.get(result.strategy.id)!.push(...result.blockScores); games += result.matches; }
    const ranked = rankCalibrationCandidates(active.map((id) => ({ identity: byId.get(id)!.identity,
      blockScores: accumulated.get(id)! })), depth, input.seeds.tie);
    const keep = active.length <= 2 ? 1 : Math.ceil(active.length / 2);
    rounds.push({ depth, entered: active.length, survivors: keep });
    active = ranked.slice(0, keep).map((candidate) => candidate.strategyId);
    selectedMean = ranked[0]!.mean;
    previous = depth;
    if (keep === 1) break;
  }
  if (active.length !== 1) throw new Error('Standard SH depths did not select one response.');
  return { selected: byId.get(active[0]!)!.strategy, selectedMean, rounds,
    candidateSeedEvaluations: games / GAMES_PER_SEED, games, elapsedMs };
}

function checkpointFile(root: string, kingdomId: string): string { return path.join(root, kingdomId, 'checkpoint.json'); }
function reportFile(root: string, kingdomId: string): string { return path.join(root, kingdomId, 'report.json'); }
function validCheckpoint(value: unknown, source: Source, runId: number): value is Checkpoint {
  try {
    if (!validHash(value)) return false;
    const held = value as Checkpoint;
    const solved = solveEquilibrium(held.matrix.strategies.map((strategy) => strategy.id), held.matrix.centeredPayoffs);
    return held.schemaVersion === 1 && held.experiment === 'successive-halving-double-oracle-pilot'
      && held.version === PILOT_VERSION && (held.runId ?? 1) === runId
      && held.exploratory && held.formalClosure === false && held.kingdomId === source.entry.kingdomId
      && held.source.reservoirSha256 === source.calibration.source.reservoirSha256
      && held.source.p75ManifestHash === source.calibration.source.p75ManifestHash
      && held.matrix.complete && held.matrix.strategies.length === 50 + held.cycles.filter((cycle) => cycle.admitted).length
      && exact(held.equilibrium.weights, solved.weights)
      && held.games === held.cycles.reduce((sum, cycle) => sum + cycle.games.total, 0)
      && held.elapsedMs === held.cycles.reduce((sum, cycle) => sum + cycle.elapsedMs.total, 0);
  } catch { return false; }
}

function saveCheckpoint(root: string, checkpoint: Checkpoint): void {
  writeAtomic(checkpointFile(root, checkpoint.kingdomId), checkpoint);
  writeAtomic(reportFile(root, checkpoint.kingdomId), checkpoint);
}

async function runKingdom(root: string, source: Source, workers: number, runId: number): Promise<Checkpoint> {
  registerKingdom(deepBeamSuite.kingdoms.find((kingdom) => kingdom.id === source.entry.kingdomId)!);
  const savedFile = checkpointFile(root, source.entry.kingdomId);
  let saved: Checkpoint | null = null;
  if (fs.existsSync(savedFile)) {
    const value = readJson<unknown>(savedFile);
    if (!validCheckpoint(value, source, runId)) throw new Error(`Invalid pilot checkpoint ${savedFile}.`);
    saved = value;
  }
  if (saved?.status === 'complete') return saved;
  const cycles: CycleReport[] = [...(saved?.cycles ?? [])];
  const snapshot: MatrixSnapshot = saved?.matrix ?? source.initialMatrix;
  const cache = reconstructMatrixCache(snapshot);
  const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom: deepBeamSuite.kingdoms.find((kingdom) => kingdom.id === source.entry.kingdomId)! }, ['--import', 'tsx']);
  const matrix = new PayoffMatrix(snapshot.protocol, runner, cache);
  snapshot.strategies.forEach((strategy) => matrix.addStrategy(strategy));
  try {
    for (let cycle = cycles.length + 1; cycle <= MAX_CYCLES; cycle += 1) {
      const before = matrix.snapshot();
      const equilibrium = solveEquilibrium(before.strategies.map((strategy) => strategy.id), before.centeredPayoffs);
      const active = new Set(before.strategies.map((strategy) => strategy.id));
      const candidates = source.reservoir.entries.filter((entry) => !active.has(entry.strategy.id)).map((entry) => ({
        identity: { goldfishRank: entry.rank, strategyId: entry.strategy.id,
          canonicalStrategy: entry.canonicalStrategy }, strategy: entry.strategy }));
      const opponents = new Map(before.strategies.map((strategy) => [strategy.id, strategy]));
      const seeds = source.seeds[cycle - 1]!;
      const halving = await runStandardHalving({ candidates, opponents, weights: equilibrium.weights,
        seeds, kingdomId: source.entry.kingdomId, runner });
      const confirmationSchedule = mixtureSchedule(equilibrium.weights, seeds.confirmation,
        seeds.confirmationOpponent);
      const confirmationStarted = performance.now();
      const confirmation = (await evaluateCandidates([halving.selected], opponents, confirmationSchedule, runner,
        { kingdomId: source.entry.kingdomId, turnLimitPerPlayer: 30, actionCapPerTurn: 200,
          startingDraftEnabled: false, scoreOnly: true }))[0]!;
      const confirmationElapsed = performance.now() - confirmationStarted;
      const interval = percentileBootstrapMean(confirmation.blockScores, seeds.bootstrap, 2_000);
      const admitted = interval.lower > 0.5;
      const matrixStarted = performance.now();
      if (admitted) await matrix.addRow(halving.selected, false);
      const matrixElapsed = admitted ? performance.now() - matrixStarted : 0;
      const after = matrix.snapshot(), safetyCapReached = cycle === MAX_CYCLES;
      const stopReason = !admitted ? 'selected-response-not-admitted' as const
        : safetyCapReached ? 'cycle-safety-cap' as const : 'running' as const;
      const matrixGames = admitted ? before.strategies.length * MATRIX_BLOCKS * GAMES_PER_SEED : 0;
      const report: CycleReport = { cycle, matrixSizeBefore: before.strategies.length,
        matrixSizeAfter: after.strategies.length, inactiveCandidates: candidates.length,
        selectedStrategyId: halving.selected.id,
        selectedCanonicalStrategy: canonicalStrategy(halving.selected),
        selectedGoldfishRank: candidates.find((candidate) => candidate.strategy.id === halving.selected.id)!.identity.goldfishRank,
        selectedHalvingMean: halving.selectedMean, confirmationMean: confirmation.mean,
        confirmationInterval95: interval, admitted, stopReason, safetyCapReached,
        games: { halving: halving.games, confirmation: confirmation.matches, matrix: matrixGames,
          total: halving.games + confirmation.matches + matrixGames },
        elapsedMs: { halving: halving.elapsedMs, confirmation: confirmationElapsed, matrix: matrixElapsed,
          total: halving.elapsedMs + confirmationElapsed + matrixElapsed } };
      cycles.push(report);
      const current = withHash({ schemaVersion: 1 as const,
        experiment: 'successive-halving-double-oracle-pilot' as const, version: PILOT_VERSION, runId,
        status: stopReason === 'running' ? 'running' as const : 'complete' as const,
        exploratory: true as const, formalClosure: false as const, kingdomId: source.entry.kingdomId,
        source: { reservoirSha256: source.calibration.source.reservoirSha256,
          p75ManifestHash: source.calibration.source.p75ManifestHash,
          p75ManifestSha256: source.calibration.source.p75ManifestSha256,
          p75ReportSha256: source.calibration.source.p75ReportSha256 }, cycles,
        matrix: after, equilibrium: solveEquilibrium(after.strategies.map((strategy) => strategy.id), after.centeredPayoffs),
        stopReason, safetyCapReached, games: cycles.reduce((sum, held) => sum + held.games.total, 0),
        elapsedMs: cycles.reduce((sum, held) => sum + held.elapsedMs.total, 0) });
      saveCheckpoint(root, current);
      if (current.status === 'complete') return current;
    }
  } finally { await runner.close(); }
  throw new Error('Pilot did not reach a terminal state.');
}

function parse(args: readonly string[]) {
  const modes = ['--run', '--validate-inputs', '--status', '--report'].filter((flag) => args.includes(flag));
  if (modes.length !== 1) throw new Error('Use exactly one pilot mode.');
  const mode = modes[0]!;
  const get = (name: string) => { const index = args.indexOf(name), value = args[index + 1];
    if (index < 0 || !value || value.startsWith('--')) throw new Error(`${name} needs a value.`); return value; };
  const allowed = new Set([mode, ...(mode === '--run' ? ['--inputs', '--out', '--workers', '--run-id']
    : mode === '--validate-inputs' ? ['--inputs'] : ['--out'])]);
  for (let index = 0; index < args.length; index += 1) {
    if (!allowed.has(args[index]!)) throw new Error(`Unknown pilot option ${args[index]}.`);
    if (args[index] !== mode) index += 1;
  }
  const workers = mode === '--run' && args.includes('--workers') ? Number(get('--workers')) : 4;
  const runId = mode === '--run' && args.includes('--run-id') ? Number(get('--run-id')) : 1;
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 192) throw new Error('Invalid worker count.');
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('Invalid run ID.');
  return { mode, inputs: mode === '--run' || mode === '--validate-inputs' ? path.resolve(get('--inputs')) : null,
    out: mode !== '--validate-inputs' ? path.resolve(get('--out')) : null, workers, runId };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parse(args);
  if (options.mode === '--validate-inputs') {
    const sources = await loadSources(options.inputs!, options.runId);
    console.log(JSON.stringify({ kingdoms: sources.map((source) => source.entry.kingdomId), gamesPlayed: 0 }, null, 2));
    return;
  }
  if (options.mode === '--status') {
    console.log(JSON.stringify({ kingdoms: PILOT_KINGDOMS.map((kingdomId) => ({ kingdomId,
      checkpoint: fs.existsSync(checkpointFile(options.out!, kingdomId)),
      report: fs.existsSync(reportFile(options.out!, kingdomId)) })) }, null, 2)); return;
  }
  if (options.mode === '--report') {
    console.log(JSON.stringify(PILOT_KINGDOMS.map((kingdomId) => readJson<unknown>(reportFile(options.out!, kingdomId))), null, 2)); return;
  }
  const sources = await loadSources(options.inputs!, options.runId);
  const reports: Checkpoint[] = [];
  for (const source of sources) reports.push(await runKingdom(options.out!, source, options.workers, options.runId));
  console.log(JSON.stringify(reports.map((report) => ({ kingdomId: report.kingdomId,
    cycles: report.cycles.length, matrixSize: report.matrix.strategies.length,
    stopReason: report.stopReason, safetyCapReached: report.safetyCapReached,
    games: report.games, formalClosure: false })), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
