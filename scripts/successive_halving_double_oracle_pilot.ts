import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { InlineConfidenceRunner, WorkerConfidenceRunner } from '../src/sim/confidenceRunner';
import type { ConfidenceRunner } from '../src/sim/confidenceRunner';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';
import { solveEquilibrium } from '../src/sim/equilibrium';
import type { EquilibriumResult } from '../src/sim/equilibrium';
import { reconstructMatrixCache } from '../src/sim/fixedReservoirConsistency';
import {
  assertInitialMatrixOutputJsonFiles, expectedInitialMatrixChunkRelativePaths,
  initialMatrixChunkRelativePath, validateInitialMatrixChunk, validateInitialMatrixManifest,
  validateOrderedCalibrationSource
} from '../src/sim/initialMatrixCalibration';
import type {
  InitialMatrixChunk, InitialMatrixManifest, InitialMatrixSourceIdentity
} from '../src/sim/initialMatrixCalibration';
import type { CandidateEvaluation, MixtureSchedule } from '../src/sim/mixtureEvaluation';
import { ModalCompetitiveEvaluator } from '../src/sim/modalCompetitiveEvaluator';
import type { OrderedProductReservoirArtifact } from '../src/sim/orderedGoldfishProduct';
import { matrixProtocol, payoffMatrixPairKey, PayoffMatrix } from '../src/sim/payoffMatrix';
import type { MatrixCell, MatrixSnapshot } from '../src/sim/payoffMatrix';
import { GAMES_PER_SEED, emptyAggregate, mergeAggregate } from '../src/sim/pairing';
import type { PairingRunner } from '../src/sim/pairingRunner';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type {
  CalibrationCandidateIdentity, CalibrationSourceIdentity
} from '../src/sim/responseOracleCalibration';
import { RustCompetitiveEvaluator } from '../src/sim/rustCompetitiveEvaluator';
import { RustGoldfishScorer } from '../src/sim/rustGoldfishScorer';
import { stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import type { TelemetryAggregate } from '../src/sim/types';
import { compareUtf16 } from '../src/sim/utf16';
import * as thresholdRacing from '../src/sim/thresholdRacingPsro';

export const PILOT_VERSION = 'k007-threshold-racing-double-oracle-v1' as const;
export const PILOT_KINGDOM = 'deep-beam-tuning-007' as const;
export const SCREEN_DEPTHS = thresholdRacing.SCREEN_DEPTHS;
export const CONFIRMATION_LOOKS = thresholdRacing.CONFIRMATION_LOOKS;
export const RESPONSE_THRESHOLD = thresholdRacing.RESPONSE_THRESHOLD;
export const SCREEN_ALPHA = thresholdRacing.SCREEN_ALPHA;
export const CONFIRMATION_FAMILY_ALPHA = thresholdRacing.CONFIRMATION_FAMILY_ALPHA;
const MATRIX_BLOCKS = thresholdRacing.PSRO_MATRIX_BLOCKS;
const EVALUATION_CHUNK = thresholdRacing.DEFAULT_PSRO_EVALUATION_CHUNK;

type ThresholdStatus = 'below' | 'above' | 'unresolved';
type ConfirmationStatus = 'rejected' | 'confirmed' | 'unresolved';
type StopReason = 'running' | 'empirical-two-clean-scans' | 'screen-cap-unresolved'
  | 'fixed-protocol-look-cap-unresolved';

interface InputEntry { kingdomId: string; ranked: string; reservoir: string; p75Root: string }
interface Inputs { schemaVersion: 1; kingdoms: InputEntry[] }
export interface ThresholdRacingSource {
  entry: InputEntry;
  source: CalibrationSourceIdentity;
  reservoir: OrderedProductReservoirArtifact;
  initialMatrix: MatrixSnapshot;
  kingdomId: string;
  experimentName: string;
  protocolVersion: string;
  rawProtocol?: thresholdRacing.ThresholdRacingProtocol;
  onRawCheckpoint?: (event: thresholdRacing.RawPsroCheckpointEvent | {
    type: 'strategy-search-checkpoint'; stage: 'psro'; eventHash: string; protocolHash: string;
    sourceHash: string; lookId: string; chunkHash: string }) => void;
  deadlineMs?: number;
  terminalOnUnresolved?: boolean;
}
interface InitialMatrixReport {
  schemaVersion: 2;
  experiment: 'initial-matrix-calibration-report';
  version: string;
  manifestHash: string;
  source: unknown;
  protocol: unknown;
  analysis?: { prefixes?: Array<{
    seedRange: { startOrdinal: number; endOrdinal: number; count: number };
    equilibrium: EquilibriumResult;
  }> };
}
interface CandidateRef { identity: CalibrationCandidateIdentity; strategy: Strategy }
export interface ThresholdDecision extends CalibrationCandidateIdentity {
  blocks: number;
  mean: number;
  interval: { lower: number; upper: number };
  status: ThresholdStatus;
}
export interface ConfirmationDecision extends CalibrationCandidateIdentity {
  blocks: number;
  mean: number;
  interval: { lower: number; upper: number };
  status: ConfirmationStatus;
}
interface LookReport {
  blocks: number;
  entered: number;
  below?: number;
  above?: number;
  rejected?: number;
  confirmed?: number;
  unresolved: number;
  games: number;
  elapsedMs: number;
}
interface ThresholdRaceResult {
  schedule: MixtureSchedule;
  looks: LookReport[];
  below: ThresholdDecision[];
  provisional: ThresholdDecision[];
  unresolved: ThresholdDecision[];
  games: number;
  elapsedMs: number;
  telemetry: TelemetryAggregate;
}
interface QueueOrder {
  orderedStrategyIds: string[];
  strongestStrategyId: string | null;
  strongestTieIds: string[];
  strongestOverlapIds: string[];
}
interface ConfirmationRaceResult {
  schedule: MixtureSchedule;
  familySize: number;
  alphaPerCandidate: number;
  looks: LookReport[];
  rejected: ConfirmationDecision[];
  confirmed: ConfirmationDecision[];
  unresolved: ConfirmationDecision[];
  order: QueueOrder;
  games: number;
  elapsedMs: number;
  telemetry: TelemetryAggregate;
}
interface ScanBase {
  scan: number;
  cycle: number;
  matrixSize: number;
  inactiveCandidates: number;
  lotteryHash: string;
  screen: ThresholdRaceResult;
}
interface ScanReport extends ScanBase {
  confirmation: ConfirmationRaceResult | null;
  outcome: 'clean' | 'queued' | 'terminal-incomplete';
  games: { screening: number; confirmation: number; total: number };
  elapsedMs: { screening: number; confirmation: number; total: number };
}
interface QueueRetestReport {
  retest: number;
  cycle: number;
  matrixSize: number;
  lotteryHash: string;
  enteredStrategyIds: string[];
  confirmation: ConfirmationRaceResult;
  outcome: 'empty' | 'queued' | 'terminal-incomplete';
  games: number;
  elapsedMs: number;
}
interface AdmissionReport {
  admission: number;
  cycle: number;
  strategyId: string;
  goldfishRank: number;
  canonicalStrategy: string;
  queueOrder: QueueOrder;
  matrixSizeBefore: number;
  matrixSizeAfter: number;
  games: number;
  elapsedMs: number;
  equilibriumElapsedMs: number;
}
type Pending = { kind: 'screened'; base: ScanBase }
  | { kind: 'scan-confirmed'; base: ScanBase; confirmation: ConfirmationRaceResult }
  | { kind: 'queue-confirmed'; report: QueueRetestReport };
interface Checkpoint {
  schemaVersion: 1;
  experiment: string;
  version: string;
  runId: string | number;
  source: CalibrationSourceIdentity;
  protocol: {
    threshold: typeof RESPONSE_THRESHOLD;
    screenDepths: readonly number[];
    screenAlpha: typeof SCREEN_ALPHA;
    confirmationLooks: readonly number[];
    confirmationFamilyAlpha: typeof CONFIRMATION_FAMILY_ALPHA;
    familyControl: 'bonferroni';
    opponentSchedule: 'nested-proportional-largest-deficit';
    matrixBlocks: typeof MATRIX_BLOCKS;
    cappedUnresolvedPolicy?: 'leave-unresolved-at-look-cap';
    maxAdmissions?: number;
    maxScans?: number;
  };
  status: 'running' | 'complete' | 'unresolved';
  stopReason: StopReason;
  phase: 'ready' | 'screened' | 'confirmed' | 'terminal';
  exploratory: true;
  formalClosure: false;
  matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult;
  cleanScans: number;
  queue: ConfirmationDecision[];
  pending: Pending | null;
  scans: ScanReport[];
  queueRetests: QueueRetestReport[];
  admissions: AdmissionReport[];
  games: { screening: number; confirmation: number; matrix: number; total: number };
  elapsedMs: { screening: number; confirmation: number; matrix: number; equilibrium: number; total: number };
  telemetry: TelemetryAggregate;
  evidenceHash: string;
}
interface ParsedOptions {
  mode: '--run' | '--validate-inputs' | '--status' | '--report';
  inputs: string | null;
  out: string | null;
  workers: number;
  runId: 1 | 2 | 3 | null;
  execution: 'local' | 'modal';
}

interface EvaluationOptions {
  kingdomId: string;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  startingDraftEnabled: boolean;
  scoreOnly: true;
  lookId: string;
  deadline?: number;
}

type Evaluate = (
  candidates: readonly Strategy[], opponents: ReadonlyMap<string, Strategy>, schedule: MixtureSchedule,
  runner: PairingRunner, options: EvaluationOptions
) => Promise<CandidateEvaluation[]>;

function exact(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
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
function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function runRoot(root: string, runId: string | number): string { return path.join(root, `run-${runId}`); }
function checkpointFile(root: string, runId: string | number): string { return path.join(runRoot(root, runId), 'checkpoint.json'); }
function reportFile(root: string, runId: string | number): string { return path.join(runRoot(root, runId), 'report.json'); }
function sealed(checkpoint: Checkpoint): Checkpoint {
  const copy = structuredClone(checkpoint);
  copy.evidenceHash = '';
  return { ...copy, evidenceHash: hash(copy) };
}
function validHash(value: unknown): value is Checkpoint {
  if (!value || typeof value !== 'object' || !('evidenceHash' in value)
    || typeof value.evidenceHash !== 'string') return false;
  const copy = structuredClone(value) as Checkpoint;
  const held = copy.evidenceHash;
  copy.evidenceHash = '';
  return held === hash(copy);
}
function saveCheckpoint(root: string, checkpoint: Checkpoint): Checkpoint {
  const value = sealed(checkpoint);
  writeAtomic(checkpointFile(root, checkpoint.runId), value);
  writeAtomic(reportFile(root, checkpoint.runId), value);
  return value;
}

export const weightedFairSchedule = thresholdRacing.weightedFairSchedule;
export const classifyThreshold = thresholdRacing.classifyThreshold;
export const orderConfirmedQueue = thresholdRacing.orderConfirmedQueue;
export const runThresholdRace = thresholdRacing.runThresholdRace;
export const runConfirmationRace = thresholdRacing.runConfirmationRace;
export const cleanScansAfter = thresholdRacing.cleanScansAfter;
export const actionAfterScreen = thresholdRacing.actionAfterScreen;
export const actionAfterConfirmation = thresholdRacing.actionAfterConfirmation;

export function validatePilotInitialMatrixMetadata(input: {
  orderedSource: InitialMatrixSourceIdentity;
  topStrategies: readonly Strategy[];
  manifest: unknown;
  report: unknown;
}): { manifest: InitialMatrixManifest; p75Weights: Record<string, number> } {
  if (!validateInitialMatrixManifest(input.manifest)) {
    throw new Error('Pilot initial-matrix manifest is invalid.');
  }
  const manifest = input.manifest;
  const report = input.report as InitialMatrixReport;
  if (manifest.protocol.kingdomId !== PILOT_KINGDOM || manifest.protocol.maxSeedCount < MATRIX_BLOCKS
    || !exact(manifest.protocol.source, input.orderedSource)
    || !exact(manifest.strategies, input.topStrategies)) {
    throw new Error('Pilot initial matrix does not match the validated K007 ordered top 50.');
  }
  if (!report || report.schemaVersion !== 2 || report.experiment !== 'initial-matrix-calibration-report'
    || report.version !== manifest.protocol.version || report.manifestHash !== manifest.evidenceHash
    || !exact(report.source, manifest.protocol.source) || !exact(report.protocol, manifest.protocol)) {
    throw new Error('Pilot initial-matrix report does not match its manifest and ordered source.');
  }
  const p75 = report.analysis?.prefixes?.find((entry) => entry.seedRange.startOrdinal === 1
    && entry.seedRange.endOrdinal === MATRIX_BLOCKS && entry.seedRange.count === MATRIX_BLOCKS);
  const ids = manifest.strategies.map((strategy) => strategy.id);
  const weights = p75?.equilibrium.weights;
  if (!p75 || !exact([...p75.equilibrium.strategyIds].sort(), [...ids].sort()) || !weights
    || !exact(Object.keys(weights).sort(), [...ids].sort())
    || ids.some((id) => !Number.isFinite(weights[id]) || weights[id]! < 0)
    || Math.abs(ids.reduce((sum, id) => sum + weights[id]!, 0) - 1) > 1e-7) {
    throw new Error('Pilot initial-matrix report does not contain the complete P75 lottery.');
  }
  return { manifest, p75Weights: weights };
}

function initialMatrixJsonFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.json')) files.push(path.relative(root, file));
    }
  };
  visit(root);
  return files;
}

function loadInitialMatrixChunks(root: string, manifest: InitialMatrixManifest): Map<string, InitialMatrixChunk> {
  assertInitialMatrixOutputJsonFiles(initialMatrixJsonFiles(root), true, manifest);
  const chunks = new Map<string, InitialMatrixChunk>();
  for (const relative of expectedInitialMatrixChunkRelativePaths(manifest)) {
    const match = /^chunks\/cell-(\d+)-(\d+)\/chunk-(\d+)\.json$/.exec(relative);
    if (!match) throw new Error(`Invalid initial-matrix chunk path ${relative}.`);
    const row = Number(match[1]), column = Number(match[2]), start = Number(match[3]);
    const count = Math.min(manifest.protocol.chunkSize, manifest.protocol.maxSeedCount - start);
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) throw new Error(`Pilot initial-matrix chunk is missing: ${file}`);
    const value = readJson<unknown>(file);
    if (!validateInitialMatrixChunk(value, manifest, row, column, start, count)) {
      throw new Error(`Pilot initial-matrix chunk is invalid: ${file}`);
    }
    chunks.set(relative, value);
  }
  return chunks;
}

function loadP75Matrix(manifest: InitialMatrixManifest, p75Weights: Readonly<Record<string, number>>,
  chunks: ReadonlyMap<string, InitialMatrixChunk>): MatrixSnapshot {
  const protocol = matrixProtocol(manifest.protocol.kingdomId,
    manifest.protocol.seeds.slice(0, MATRIX_BLOCKS), 30, 200, false);
  const centeredPayoffs = manifest.strategies.map(() => manifest.strategies.map(() => 0));
  const cells: MatrixCell[] = [];
  for (let rowIndex = 0; rowIndex < 50; rowIndex += 1) for (let columnIndex = rowIndex + 1;
    columnIndex < 50; columnIndex += 1) {
    const records: InitialMatrixChunk['records'] = [];
    for (let start = 0; start < MATRIX_BLOCKS; start += manifest.protocol.chunkSize) {
      const relative = initialMatrixChunkRelativePath(rowIndex, columnIndex, start);
      const value = chunks.get(relative);
      if (!value) throw new Error(`Validated P75 matrix chunk is missing: ${relative}`);
      records.push(...value.records.slice(0, MATRIX_BLOCKS - start));
    }
    const row = manifest.strategies[rowIndex]!, column = manifest.strategies[columnIndex]!;
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
  cells.sort((left, right) => compareUtf16(left.rowId, right.rowId)
    || compareUtf16(left.columnId, right.columnId));
  const snapshot = { protocol, strategies: manifest.strategies, cells, complete: true, centeredPayoffs };
  const equilibrium = solveEquilibrium(manifest.strategies.map((strategy) => strategy.id), centeredPayoffs);
  if (!exact(equilibrium.strategyIds, [...manifest.strategies.map((strategy) => strategy.id)].sort())
    || manifest.strategies.some((strategy) => Math.abs((equilibrium.weights[strategy.id] ?? 0)
      - (p75Weights[strategy.id] ?? 0)) > 1e-7)) {
    throw new Error('Rebuilt K007 P75 matrix does not reproduce the validated lottery.');
  }
  reconstructMatrixCache(snapshot);
  return snapshot;
}

function validateOrderedArtifacts(entry: InputEntry): void {
  for (const file of [entry.ranked, `${entry.ranked}.sha256`, entry.reservoir, `${entry.reservoir}.sha256`]) {
    if (!fs.existsSync(file)) throw new Error(`Missing ordered pilot input ${file}.`);
  }
  const seeds = readJson<{ config?: { seeds?: unknown } }>(entry.ranked).config?.seeds;
  if (!Array.isArray(seeds) || seeds.some((seed) => !Number.isSafeInteger(seed) || Number(seed) < 0)) {
    throw new Error('Ordered pilot ranked seeds are invalid.');
  }
  execFileSync('npm', ['run', 'goldfish:ordered-product', '--', 'validate-reservoir',
    '--kingdom', PILOT_KINGDOM, '--artifact', entry.ranked, '--reservoir', entry.reservoir,
    '--seeds', seeds.join(',')], { stdio: 'inherit' });
}

async function loadSource(inputsFile: string): Promise<ThresholdRacingSource> {
  const inputs = readJson<Inputs>(inputsFile);
  const matches = inputs.schemaVersion === 1 && Array.isArray(inputs.kingdoms)
    ? inputs.kingdoms.filter((entry) => entry.kingdomId === PILOT_KINGDOM) : [];
  if (matches.length !== 1) throw new Error('Inputs need exactly one Kingdom 007 entry.');
  const base = path.dirname(inputsFile), held = matches[0]!;
  const entry = { ...held, ranked: path.resolve(base, held.ranked), reservoir: path.resolve(base, held.reservoir),
    p75Root: path.resolve(base, held.p75Root) };
  strategySearchKingdom(PILOT_KINGDOM);
  validateOrderedArtifacts(entry);
  const ranked = readJson<unknown>(entry.ranked);
  const reservoir = readJson<OrderedProductReservoirArtifact>(entry.reservoir);
  const rankedSha256 = sha256File(entry.ranked), reservoirSha256 = sha256File(entry.reservoir);
  const validated = validateOrderedCalibrationSource({ kingdomId: PILOT_KINGDOM, ranked, reservoir,
    rankedSha256, reservoirSha256 });
  const manifestFile = path.join(entry.p75Root, 'manifest.json');
  const reportFile = path.join(entry.p75Root, 'report.json');
  if (!fs.existsSync(manifestFile) || !fs.existsSync(reportFile)) {
    throw new Error('Pilot initial-matrix manifest or report is missing.');
  }
  const metadata = validatePilotInitialMatrixMetadata({ orderedSource: validated.source,
    topStrategies: validated.strategies, manifest: readJson<unknown>(manifestFile),
    report: readJson<unknown>(reportFile) });
  const chunks = loadInitialMatrixChunks(entry.p75Root, metadata.manifest);
  const source: CalibrationSourceIdentity = {
    kingdomId: PILOT_KINGDOM, rankedPath: entry.ranked, reservoirPath: entry.reservoir,
    p75ManifestPath: manifestFile, p75ReportPath: reportFile, rankedSha256, reservoirSha256,
    p75ManifestSha256: sha256File(manifestFile), p75ReportSha256: sha256File(reportFile),
    p75ManifestHash: metadata.manifest.evidenceHash, reservoirRunId: validated.source.runId,
    reservoirVersion: validated.source.productVersion, rulesFingerprint: validated.source.ruleFingerprint
  };
  return { entry, source, reservoir,
    initialMatrix: loadP75Matrix(metadata.manifest, metadata.p75Weights, chunks),
    kingdomId: PILOT_KINGDOM, experimentName: 'k007-threshold-racing-double-oracle',
    protocolVersion: PILOT_VERSION };
}

function rawArtifactStore(root: string, runId: string | number, source: ThresholdRacingSource,
  raceKind: 'screen' | 'confirmation' | 'queue-retest'): thresholdRacing.RawPsroArtifactStore | undefined {
  if (!source.rawProtocol) return undefined;
  const rawRoot = path.join(runRoot(root, runId), 'raw');
  const safeLook = (lookId: string): string => {
    if (!/^[A-Za-z0-9._-]+$/.test(lookId)) throw new Error(`Raw PSRO look ID is invalid: ${lookId}`);
    return lookId;
  };
  return { protocol: source.rawProtocol, raceKind,
    loadChunk(identity) {
      const file = path.join(rawRoot, 'chunks', safeLook(identity.lookId),
        `${identity.candidateStart}-${identity.candidateEnd}.json`);
      if (!fs.existsSync(file)) return undefined;
      try {
        const value = readJson<thresholdRacing.RawPsroScoreChunk>(file);
        if (thresholdRacing.validateRawPsroScoreChunk(value, source.rawProtocol)
          && value.lookId === identity.lookId && value.candidateStart === identity.candidateStart
          && value.candidateEnd === identity.candidateEnd) return value;
      } catch { /* Preserve malformed bytes below. */ }
      const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const destination = path.join(runRoot(root, runId), 'control', 'corrupt',
        `${safeLook(identity.lookId)}.${path.basename(file)}.${digest}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (fs.existsSync(destination)) fs.unlinkSync(file); else fs.renameSync(file, destination);
      return undefined;
    }, sealChunk(chunk) {
      writeAtomic(path.join(rawRoot, 'chunks', safeLook(chunk.lookId),
        `${chunk.candidateStart}-${chunk.candidateEnd}.json`), chunk);
      const eventBase = { type: 'strategy-search-checkpoint' as const, stage: 'psro' as const,
        protocolHash: chunk.protocolHash, sourceHash: chunk.sourceHash, lookId: chunk.lookId,
        chunkHash: chunk.artifactHash };
      source.onRawCheckpoint?.({ ...eventBase, eventHash: hash(eventBase) });
    }, sealLook(look, event) {
      const file = path.join(rawRoot, 'looks', `${safeLook(look.lookId)}.json`);
      if (fs.existsSync(file)) {
        let valid = false;
        try {
          const saved = readJson<thresholdRacing.RawPsroLookArtifact>(file);
          valid = thresholdRacing.validateRawPsroLookArtifact(saved, source.rawProtocol)
            && JSON.stringify(saved) === JSON.stringify(look);
        } catch { valid = false; }
        if (!valid) {
          const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
          const destination = path.join(runRoot(root, runId), 'control', 'corrupt',
            `${safeLook(look.lookId)}.${digest}.json`);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          if (fs.existsSync(destination)) fs.unlinkSync(file); else fs.renameSync(file, destination);
        }
      }
      writeAtomic(file, look); source.onRawCheckpoint?.(event);
    } };
}

function candidates(source: ThresholdRacingSource, ids?: readonly string[]): CandidateRef[] {
  const wanted = ids ? new Set(ids) : null;
  return source.reservoir.entries.filter((entry) => !wanted || wanted.has(entry.strategy.id)).map((entry) => ({
    strategy: entry.strategy, identity: { goldfishRank: entry.rank, strategyId: entry.strategy.id,
      canonicalStrategy: entry.canonicalStrategy }
  }));
}
function positiveLottery(snapshot: MatrixSnapshot, equilibrium: EquilibriumResult) {
  const opponents = new Map<string, Strategy>(), weights: Record<string, number> = {};
  snapshot.strategies.forEach((strategy) => {
    const weight = equilibrium.weights[strategy.id] ?? 0;
    if (weight > 0) { opponents.set(strategy.id, strategy); weights[strategy.id] = weight; }
  });
  if (!opponents.size) throw new Error('Equilibrium lottery has no positive support.');
  return { opponents, weights, lotteryHash: hash({ matrix: snapshot.centeredPayoffs, equilibrium }) };
}
function usedSeeds(checkpoint: Checkpoint): Set<number> {
  const used = new Set(checkpoint.matrix.protocol.seeds);
  const add = (schedule: MixtureSchedule) => schedule.blocks.forEach((block) => {
    if (used.has(block.seed)) throw new Error('Fresh schedule seed collision in checkpoint.');
    used.add(block.seed);
  });
  checkpoint.scans.forEach((scan) => { add(scan.screen.schedule); if (scan.confirmation) add(scan.confirmation.schedule); });
  checkpoint.queueRetests.forEach((retest) => add(retest.confirmation.schedule));
  if (checkpoint.pending?.kind === 'screened') add(checkpoint.pending.base.screen.schedule);
  if (checkpoint.pending?.kind === 'scan-confirmed') {
    add(checkpoint.pending.base.screen.schedule); add(checkpoint.pending.confirmation.schedule);
  }
  if (checkpoint.pending?.kind === 'queue-confirmed') add(checkpoint.pending.report.confirmation.schedule);
  return used;
}
function scheduleFor(checkpoint: Checkpoint, label: string, count: number,
  weights: Readonly<Record<string, number>>): MixtureSchedule {
  const used = usedSeeds(checkpoint);
  const seeds = Array.from({ length: count }, (_unused, index) => {
    let nonce = 0;
    for (;;) {
      const seed = Number.parseInt(stableHash(`${checkpoint.version}:${checkpoint.source.reservoirSha256}:run:`
        + `${checkpoint.runId}:${label}:${index}:nonce:${nonce}`).slice(0, 8), 16) >>> 0;
      if (!used.has(seed)) { used.add(seed); return seed; }
      nonce += 1;
    }
  });
  return weightedFairSchedule(weights, seeds);
}
function addPhase(checkpoint: Checkpoint, phase: 'screening' | 'confirmation' | 'matrix',
  games: number, elapsedMs: number, telemetry: TelemetryAggregate, equilibriumElapsedMs = 0): void {
  checkpoint.games[phase] += games;
  checkpoint.games.total += games;
  checkpoint.elapsedMs[phase] += elapsedMs;
  checkpoint.elapsedMs.equilibrium += equilibriumElapsedMs;
  checkpoint.elapsedMs.total += elapsedMs + equilibriumElapsedMs;
  mergeAggregate(checkpoint.telemetry, telemetry);
}
function terminal(checkpoint: Checkpoint, status: 'complete' | 'unresolved', reason: StopReason): void {
  checkpoint.status = status; checkpoint.stopReason = reason; checkpoint.phase = 'terminal'; checkpoint.pending = null;
}
export function validateThresholdRacingCheckpoint(value: unknown, source: ThresholdRacingSource,
  runId: string | number): value is Checkpoint {
  try {
    if (!validHash(value)) return false;
    const held = value;
    const solved = solveEquilibrium(held.matrix.strategies.map((strategy) => strategy.id), held.matrix.centeredPayoffs);
    const pendingScreen = held.pending?.kind === 'screened' || held.pending?.kind === 'scan-confirmed'
      ? held.pending.base.screen : null;
    const pendingConfirmation = held.pending?.kind === 'scan-confirmed' ? held.pending.confirmation
      : held.pending?.kind === 'queue-confirmed' ? held.pending.report.confirmation : null;
    const screeningGames = held.scans.reduce((sum, scan) => sum + scan.screen.games, 0)
      + (pendingScreen?.games ?? 0);
    const confirmationGames = held.scans.reduce((sum, scan) => sum + (scan.confirmation?.games ?? 0), 0)
      + held.queueRetests.reduce((sum, retest) => sum + retest.games, 0) + (pendingConfirmation?.games ?? 0);
    const matrixGames = held.admissions.reduce((sum, admission) => sum + admission.games, 0);
    const screeningMs = held.scans.reduce((sum, scan) => sum + scan.screen.elapsedMs, 0)
      + (pendingScreen?.elapsedMs ?? 0);
    const confirmationMs = held.scans.reduce((sum, scan) => sum + (scan.confirmation?.elapsedMs ?? 0), 0)
      + held.queueRetests.reduce((sum, retest) => sum + retest.elapsedMs, 0) + (pendingConfirmation?.elapsedMs ?? 0);
    const matrixMs = held.admissions.reduce((sum, admission) => sum + admission.elapsedMs, 0);
    const equilibriumMs = held.admissions.reduce((sum, admission) => sum + admission.equilibriumElapsedMs, 0);
    const telemetry = emptyAggregate();
    held.scans.forEach((scan) => {
      mergeAggregate(telemetry, scan.screen.telemetry);
      if (scan.confirmation) mergeAggregate(telemetry, scan.confirmation.telemetry);
    });
    held.queueRetests.forEach((retest) => mergeAggregate(telemetry, retest.confirmation.telemetry));
    if (pendingScreen) mergeAggregate(telemetry, pendingScreen.telemetry);
    if (pendingConfirmation) mergeAggregate(telemetry, pendingConfirmation.telemetry);
    const admittedIds = new Set(held.admissions.map((entry) => entry.strategyId));
    held.matrix.cells.filter((cell) => admittedIds.has(cell.rowId) || admittedIds.has(cell.columnId))
      .forEach((cell) => mergeAggregate(telemetry, cell.telemetry));
    return held.schemaVersion === 1 && held.version === source.protocolVersion
      && held.experiment === source.experimentName && held.runId === runId
      && held.source.reservoirSha256 === source.source.reservoirSha256
      && held.source.p75ManifestHash === source.source.p75ManifestHash && held.matrix.complete
      && held.matrix.strategies.length === 50 + held.admissions.length && exact(held.equilibrium.weights, solved.weights)
      && exact(held.games, { screening: screeningGames, confirmation: confirmationGames,
        matrix: matrixGames, total: screeningGames + confirmationGames + matrixGames })
      && Math.abs(held.elapsedMs.screening - screeningMs) < 1e-6
      && Math.abs(held.elapsedMs.confirmation - confirmationMs) < 1e-6
      && Math.abs(held.elapsedMs.matrix - matrixMs) < 1e-6
      && Math.abs(held.elapsedMs.equilibrium - equilibriumMs) < 1e-6
      && Math.abs(held.elapsedMs.total - screeningMs - confirmationMs - matrixMs - equilibriumMs) < 1e-6
      && exact(held.telemetry, telemetry);
  } catch { return false; }
}
export function createThresholdRacingInitialCheckpoint(source: ThresholdRacingSource,
  runId: string | number): Checkpoint {
  const equilibrium = solveEquilibrium(source.initialMatrix.strategies.map((strategy) => strategy.id),
    source.initialMatrix.centeredPayoffs);
  return sealed({ schemaVersion: 1, experiment: source.experimentName, version: source.protocolVersion, runId,
    source: source.source, protocol: { threshold: RESPONSE_THRESHOLD, screenDepths: [...SCREEN_DEPTHS],
      screenAlpha: SCREEN_ALPHA, confirmationLooks: [...CONFIRMATION_LOOKS],
      confirmationFamilyAlpha: CONFIRMATION_FAMILY_ALPHA, familyControl: 'bonferroni',
      opponentSchedule: 'nested-proportional-largest-deficit', matrixBlocks: MATRIX_BLOCKS,
      cappedUnresolvedPolicy: 'leave-unresolved-at-look-cap' }, status: 'running', stopReason: 'running',
    phase: 'ready', exploratory: true, formalClosure: false, matrix: source.initialMatrix, equilibrium,
    cleanScans: 0, queue: [], pending: null, scans: [], queueRetests: [], admissions: [],
    games: { screening: 0, confirmation: 0, matrix: 0, total: 0 },
    elapsedMs: { screening: 0, confirmation: 0, matrix: 0, equilibrium: 0, total: 0 },
    telemetry: emptyAggregate(), evidenceHash: '' });
}

function resumeLegacyScreenCap(checkpoint: Checkpoint): boolean {
  const changed = checkpoint.protocol.cappedUnresolvedPolicy !== 'leave-unresolved-at-look-cap'
    || checkpoint.protocol.maxAdmissions !== undefined || checkpoint.protocol.maxScans !== undefined;
  checkpoint.protocol.cappedUnresolvedPolicy = 'leave-unresolved-at-look-cap';
  delete checkpoint.protocol.maxAdmissions;
  delete checkpoint.protocol.maxScans;
  if (checkpoint.status !== 'unresolved' || checkpoint.stopReason !== 'screen-cap-unresolved') return changed;
  const report = checkpoint.scans.at(-1) as (Omit<ScanReport, 'outcome'> & { outcome: string }) | undefined;
  if (!report || report.outcome !== 'unresolved' || report.confirmation !== null) {
    throw new Error('Legacy screen-cap checkpoint cannot be resumed safely.');
  }
  checkpoint.scans.pop();
  const base: ScanBase = { scan: report.scan, cycle: report.cycle, matrixSize: report.matrixSize,
    inactiveCandidates: report.inactiveCandidates, lotteryHash: report.lotteryHash, screen: report.screen };
  checkpoint.status = 'running';
  checkpoint.stopReason = 'running';
  checkpoint.pending = null;
  if (actionAfterScreen(report.screen) === 'confirm') {
    checkpoint.phase = 'screened';
    checkpoint.pending = { kind: 'screened', base };
  } else {
    checkpoint.phase = 'ready';
    checkpoint.scans.push({ ...base, confirmation: null, outcome: 'clean', games: report.games,
      elapsedMs: report.elapsedMs });
    checkpoint.cleanScans = cleanScansAfter(checkpoint.cleanScans, false, true);
    if (checkpoint.cleanScans >= 2) terminal(checkpoint, 'complete', 'empirical-two-clean-scans');
  }
  return true;
}

async function admit(checkpoint: Checkpoint, source: ThresholdRacingSource, runner: PairingRunner,
  order: QueueOrder): Promise<void> {
  const selectedId = order.strongestStrategyId;
  const selected = selectedId ? candidates(source, [selectedId])[0] : null;
  if (!selected) throw new Error('Confirmed queue has no strongest response.');
  const before = checkpoint.matrix;
  const matrix = new PayoffMatrix(before.protocol, runner, reconstructMatrixCache(before));
  before.strategies.forEach((strategy) => matrix.addStrategy(strategy));
  const started = performance.now();
  await matrix.addRow(selected.strategy, false);
  const elapsedMs = performance.now() - started;
  const after = matrix.snapshot();
  const equilibriumStarted = performance.now();
  const equilibrium = solveEquilibrium(after.strategies.map((strategy) => strategy.id), after.centeredPayoffs);
  const equilibriumElapsedMs = performance.now() - equilibriumStarted;
  const games = matrix.matches;
  if (games !== before.strategies.length * MATRIX_BLOCKS * GAMES_PER_SEED) {
    throw new Error('Admitted PayoffMatrix row has incorrect game accounting.');
  }
  checkpoint.admissions.push({ admission: checkpoint.admissions.length + 1,
    cycle: checkpoint.admissions.length + 1, strategyId: selected.identity.strategyId,
    goldfishRank: selected.identity.goldfishRank, canonicalStrategy: selected.identity.canonicalStrategy,
    queueOrder: order, matrixSizeBefore: before.strategies.length, matrixSizeAfter: after.strategies.length,
    games, elapsedMs, equilibriumElapsedMs });
  checkpoint.matrix = after; checkpoint.equilibrium = equilibrium;
  checkpoint.queue = checkpoint.queue.filter((entry) => entry.strategyId !== selectedId);
  checkpoint.cleanScans = cleanScansAfter(checkpoint.cleanScans, true, false);
  checkpoint.phase = 'ready'; checkpoint.pending = null;
  addPhase(checkpoint, 'matrix', games, elapsedMs, matrix.telemetry, equilibriumElapsedMs);
}

export async function runThresholdRacingCampaign(root: string, source: ThresholdRacingSource,
  workers: number, runId: string | number, execution: 'local' | 'modal'): Promise<Checkpoint> {
  const file = checkpointFile(root, runId);
  let checkpoint: Checkpoint;
  if (fs.existsSync(file)) {
    const value = readJson<unknown>(file);
    if (!validateThresholdRacingCheckpoint(value, source, runId)) {
      throw new Error(`Invalid threshold-racing checkpoint ${file}.`);
    }
    checkpoint = value;
    if (resumeLegacyScreenCap(checkpoint)) checkpoint = saveCheckpoint(root, checkpoint);
  } else checkpoint = saveCheckpoint(root, createThresholdRacingInitialCheckpoint(source, runId));
  if (checkpoint.status !== 'running') return checkpoint;
  const kingdom = strategySearchKingdom(source.kingdomId);
  const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  const confidence: ConfidenceRunner = workers === 1 ? new InlineConfidenceRunner()
    : new WorkerConfidenceRunner(workers,
      new URL('../src/server/confidenceWorker.ts', import.meta.url), ['--import', 'tsx']);
  const competitiveConfig = { kingdomId: source.kingdomId, turnLimitPerPlayer: 30,
    actionCapPerTurn: 200, startingDraftEnabled: false };
  const residentStrategies = source.reservoir.entries.map((entry) => entry.strategy);
  const nativeScorer = execution === 'local' ? new RustGoldfishScorer(workers) : null;
  try {
    let evaluate: Evaluate;
    if (nativeScorer) {
      const nativeEvaluator = await RustCompetitiveEvaluator.create(nativeScorer, kingdom,
        residentStrategies, competitiveConfig, workers);
      evaluate = nativeEvaluator.evaluate.bind(nativeEvaluator);
    } else {
      const buildVersion = process.env.HEXDECK_BUILD_VERSION
        ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const modalEvaluator = new ModalCompetitiveEvaluator(kingdom, residentStrategies,
        competitiveConfig, path.join(runRoot(root, runId), 'modal'), buildVersion);
      evaluate = modalEvaluator.evaluate.bind(modalEvaluator);
    }
    const chunkSize = execution === 'modal' ? Number.MAX_SAFE_INTEGER : EVALUATION_CHUNK;
    while (checkpoint.status === 'running') {
      if (checkpoint.phase === 'ready' && checkpoint.queue.length) {
        const lottery = positiveLottery(checkpoint.matrix, checkpoint.equilibrium);
        const retest = checkpoint.queueRetests.length + 1;
        const schedule = scheduleFor(checkpoint, `queue-retest:${retest}:confirmation`,
          CONFIRMATION_LOOKS.at(-1)!, lottery.weights);
        const queueRaw = rawArtifactStore(root, runId, source, 'queue-retest');
        const confirmation = await runConfirmationRace({ candidates: candidates(source,
          checkpoint.queue.map((entry) => entry.strategyId)), opponents: lottery.opponents, schedule,
          kingdomId: source.kingdomId, runner, confidence, evaluate, chunkSize,
          lookIdPrefix: `run-${runId}.queue-retest-${retest}.confirmation`,
          ...(source.deadlineMs === undefined ? {} : { deadline: source.deadlineMs }),
          ...(queueRaw && { raw: queueRaw }) });
        addPhase(checkpoint, 'confirmation', confirmation.games, confirmation.elapsedMs, confirmation.telemetry);
        const capped = source.terminalOnUnresolved && confirmation.unresolved.length > 0;
        const report: QueueRetestReport = { retest, cycle: checkpoint.admissions.length + 1,
          matrixSize: checkpoint.matrix.strategies.length, lotteryHash: lottery.lotteryHash,
          enteredStrategyIds: checkpoint.queue.map((entry) => entry.strategyId), confirmation,
          outcome: capped ? 'terminal-incomplete' : actionAfterConfirmation(confirmation),
          games: confirmation.games, elapsedMs: confirmation.elapsedMs };
        if (capped) {
          checkpoint.queueRetests.push(report);
          terminal(checkpoint, 'unresolved', 'fixed-protocol-look-cap-unresolved');
        } else { checkpoint.pending = { kind: 'queue-confirmed', report }; checkpoint.phase = 'confirmed'; }
        checkpoint = saveCheckpoint(root, checkpoint); continue;
      }
      if (checkpoint.phase === 'ready') {
        const scan = checkpoint.scans.length + 1;
        const lottery = positiveLottery(checkpoint.matrix, checkpoint.equilibrium);
        const active = new Set(checkpoint.matrix.strategies.map((strategy) => strategy.id));
        const inactive = candidates(source).filter((entry) => !active.has(entry.strategy.id));
        if (inactive.length !== source.reservoir.entries.length - checkpoint.matrix.strategies.length) {
          throw new Error('Inactive campaign reservoir coverage is incomplete.');
        }
        const schedule = scheduleFor(checkpoint, `scan:${scan}:screen`, SCREEN_DEPTHS.at(-1)!, lottery.weights);
        const screenRaw = rawArtifactStore(root, runId, source, 'screen');
        const screen = await runThresholdRace({ candidates: inactive, opponents: lottery.opponents,
          schedule, kingdomId: source.kingdomId, runner, confidence, evaluate, chunkSize,
          lookIdPrefix: `run-${runId}.scan-${scan}.screen`,
          ...(source.deadlineMs === undefined ? {} : { deadline: source.deadlineMs }),
          ...(screenRaw && { raw: screenRaw }) });
        addPhase(checkpoint, 'screening', screen.games, screen.elapsedMs, screen.telemetry);
        const base: ScanBase = { scan, cycle: checkpoint.admissions.length + 1,
          matrixSize: checkpoint.matrix.strategies.length, inactiveCandidates: inactive.length,
          lotteryHash: lottery.lotteryHash, screen };
        if (source.terminalOnUnresolved && screen.unresolved.length > 0) {
          checkpoint.scans.push({ ...base, confirmation: null, outcome: 'terminal-incomplete',
            games: { screening: screen.games, confirmation: 0, total: screen.games },
            elapsedMs: { screening: screen.elapsedMs, confirmation: 0, total: screen.elapsedMs } });
          terminal(checkpoint, 'unresolved', 'fixed-protocol-look-cap-unresolved');
        } else if (actionAfterScreen(screen) === 'clean') {
          checkpoint.scans.push({ ...base, confirmation: null, outcome: 'clean',
            games: { screening: screen.games, confirmation: 0, total: screen.games },
            elapsedMs: { screening: screen.elapsedMs, confirmation: 0, total: screen.elapsedMs } });
          checkpoint.cleanScans = cleanScansAfter(checkpoint.cleanScans, false, true);
          if (checkpoint.cleanScans >= 2) terminal(checkpoint, 'complete', 'empirical-two-clean-scans');
        } else {
          checkpoint.pending = { kind: 'screened', base }; checkpoint.phase = 'screened';
        }
        checkpoint = saveCheckpoint(root, checkpoint); continue;
      }
      if (checkpoint.phase === 'screened' && checkpoint.pending?.kind === 'screened') {
        const base = checkpoint.pending.base;
        const lottery = positiveLottery(checkpoint.matrix, checkpoint.equilibrium);
        if (lottery.lotteryHash !== base.lotteryHash) throw new Error('Lottery changed inside a reservoir scan.');
        const schedule = scheduleFor(checkpoint, `scan:${base.scan}:confirmation`,
          CONFIRMATION_LOOKS.at(-1)!, lottery.weights);
        const confirmationRaw = rawArtifactStore(root, runId, source, 'confirmation');
        const confirmation = await runConfirmationRace({ candidates: candidates(source,
          base.screen.provisional.map((entry) => entry.strategyId)), opponents: lottery.opponents,
          schedule, kingdomId: source.kingdomId, runner, confidence, evaluate, chunkSize,
          lookIdPrefix: `run-${runId}.scan-${base.scan}.confirmation`,
          ...(source.deadlineMs === undefined ? {} : { deadline: source.deadlineMs }),
          ...(confirmationRaw && { raw: confirmationRaw }) });
        addPhase(checkpoint, 'confirmation', confirmation.games, confirmation.elapsedMs, confirmation.telemetry);
        if (source.terminalOnUnresolved && confirmation.unresolved.length > 0) {
          checkpoint.scans.push({ ...base, confirmation, outcome: 'terminal-incomplete',
            games: { screening: base.screen.games, confirmation: confirmation.games,
              total: base.screen.games + confirmation.games },
            elapsedMs: { screening: base.screen.elapsedMs, confirmation: confirmation.elapsedMs,
              total: base.screen.elapsedMs + confirmation.elapsedMs } });
          terminal(checkpoint, 'unresolved', 'fixed-protocol-look-cap-unresolved');
        } else { checkpoint.pending = { kind: 'scan-confirmed', base, confirmation }; checkpoint.phase = 'confirmed'; }
        checkpoint = saveCheckpoint(root, checkpoint); continue;
      }
      if (checkpoint.phase === 'confirmed' && checkpoint.pending?.kind === 'scan-confirmed') {
        const { base, confirmation } = checkpoint.pending;
        const outcome = actionAfterConfirmation(confirmation) === 'queued' ? 'queued' : 'clean';
        checkpoint.scans.push({ ...base, confirmation, outcome,
          games: { screening: base.screen.games, confirmation: confirmation.games,
            total: base.screen.games + confirmation.games },
          elapsedMs: { screening: base.screen.elapsedMs, confirmation: confirmation.elapsedMs,
            total: base.screen.elapsedMs + confirmation.elapsedMs } });
        if (outcome === 'clean') {
          checkpoint.cleanScans = cleanScansAfter(checkpoint.cleanScans, false, true);
          checkpoint.phase = 'ready'; checkpoint.pending = null;
          if (checkpoint.cleanScans >= 2) terminal(checkpoint, 'complete', 'empirical-two-clean-scans');
        } else {
          checkpoint.queue = confirmation.confirmed;
          await admit(checkpoint, source, runner, confirmation.order);
        }
        checkpoint = saveCheckpoint(root, checkpoint); continue;
      }
      if (checkpoint.phase === 'confirmed' && checkpoint.pending?.kind === 'queue-confirmed') {
        const report = checkpoint.pending.report;
        checkpoint.queueRetests.push(report);
        if (report.outcome === 'empty') {
          checkpoint.queue = []; checkpoint.phase = 'ready'; checkpoint.pending = null;
        } else {
          checkpoint.queue = report.confirmation.confirmed;
          await admit(checkpoint, source, runner, report.confirmation.order);
        }
        checkpoint = saveCheckpoint(root, checkpoint); continue;
      }
      throw new Error(`Invalid checkpoint phase ${checkpoint.phase}.`);
    }
    return checkpoint;
  } finally {
    await Promise.all([runner.close(), confidence.close(), ...(nativeScorer ? [nativeScorer.close()] : [])]);
  }
}

export function parseOptions(args: readonly string[]): ParsedOptions {
  const modes = ['--run', '--validate-inputs', '--status', '--report'].filter((flag) => args.includes(flag));
  if (modes.length !== 1) throw new Error('Use exactly one pilot mode.');
  const mode = modes[0] as ParsedOptions['mode'];
  const value = (name: string) => {
    const index = args.indexOf(name), held = args[index + 1];
    if (index < 0 || !held || held.startsWith('--')) throw new Error(`${name} needs a value.`);
    return held;
  };
  const valueFlags = mode === '--run' ? ['--inputs', '--out', '--workers', '--run-id', '--execution']
    : mode === '--validate-inputs' ? ['--inputs'] : ['--out', '--run-id'];
  const allowed = new Set([mode, ...valueFlags]);
  for (let index = 0; index < args.length; index += 1) {
    if (!allowed.has(args[index]!)) throw new Error(`Unknown pilot option ${args[index]}.`);
    if (args[index] !== mode) index += 1;
  }
  const workers = mode === '--run' && args.includes('--workers') ? Number(value('--workers')) : 4;
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 192) throw new Error('Invalid worker count.');
  const execution = mode === '--run' && args.includes('--execution') ? value('--execution') : 'local';
  if (execution !== 'local' && execution !== 'modal') {
    throw new Error('Execution must be local or modal.');
  }
  const needsRunId = mode !== '--validate-inputs';
  const rawRunId = needsRunId ? Number(value('--run-id')) : null;
  if (rawRunId !== null && rawRunId !== 1 && rawRunId !== 2 && rawRunId !== 3) {
    throw new Error('Run ID must be 1, 2, or 3.');
  }
  return { mode, inputs: mode === '--run' || mode === '--validate-inputs' ? path.resolve(value('--inputs')) : null,
    out: mode !== '--validate-inputs' ? path.resolve(value('--out')) : null, workers,
    runId: rawRunId as 1 | 2 | 3 | null, execution: execution as 'local' | 'modal' };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(args);
  if (options.mode === '--validate-inputs') {
    const source = await loadSource(options.inputs!);
    console.log(JSON.stringify({ kingdomId: PILOT_KINGDOM, initialStrategies: source.initialMatrix.strategies.length,
      reservoirStrategies: source.reservoir.entries.length, gamesPlayed: 0 }, null, 2));
    return;
  }
  if (options.mode === '--status') {
    const file = checkpointFile(options.out!, options.runId!);
    console.log(JSON.stringify({ runId: options.runId, checkpoint: fs.existsSync(file),
      value: fs.existsSync(file) ? readJson<unknown>(file) : null }, null, 2)); return;
  }
  if (options.mode === '--report') {
    console.log(JSON.stringify(readJson<unknown>(reportFile(options.out!, options.runId!)), null, 2)); return;
  }
  const source = await loadSource(options.inputs!);
  const result = await runThresholdRacingCampaign(options.out!, source, options.workers,
    options.runId!, options.execution);
  const cycles = Math.max(0, ...result.scans.map((scan) => scan.cycle),
    ...result.queueRetests.map((retest) => retest.cycle), ...result.admissions.map((entry) => entry.cycle));
  console.log(JSON.stringify({ runId: result.runId, kingdomId: PILOT_KINGDOM, status: result.status,
    stopReason: result.stopReason, cycles, scans: result.scans.length, admissions: result.admissions.length,
    matrixSize: result.matrix.strategies.length, cleanScans: result.cleanScans,
    execution: options.execution, games: result.games, elapsedMs: result.elapsedMs,
    formalClosure: false }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
