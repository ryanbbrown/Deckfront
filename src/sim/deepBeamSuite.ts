import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { registerKingdom } from '../game';
import type { Kingdom } from '../game';
import rawFrozenManifest from './deep-beam-balance-suite-v3.json' with { type: 'json' };
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './experimentConfig';
import { matrixProtocol } from './payoffMatrix';
import { rulesFingerprint } from './rulesFingerprint';
import type { RulesFingerprint } from './rulesFingerprint';
import { STRATIFIED_ADMISSIONS_PER_LANE, STRATIFIED_BEAM_LANES } from './stratifiedBeam';

export const DEEP_BEAM_SUITE_VERSION = 'deep-beam-v1';
export const DEEP_BEAM_CONFIG = Object.freeze({
  workers: 10,
  iterations: 3,
  maxSlots: 8,
  lanes: STRATIFIED_BEAM_LANES,
  admissionsPerLane: STRATIFIED_ADMISSIONS_PER_LANE
});
export const DEEP_BEAM_DRAFT = Object.freeze({ startingDraftEnabled: false });

const RESULT_CONFIG = Object.freeze({
  startingDraftEnabled: false,
  workers: DEEP_BEAM_CONFIG.workers,
  iterations: DEEP_BEAM_CONFIG.iterations,
  maxSlots: DEEP_BEAM_CONFIG.maxSlots,
  lanes: STRATIFIED_BEAM_LANES,
  admissionsPerLane: STRATIFIED_ADMISSIONS_PER_LANE,
  stageSeeds: [1, 2, 4],
  confirmationSeeds: 12,
  matrixSeeds: 8,
  earlyStopDelta: 0.002,
  earlyStopPatience: 2,
  sweep: false
});

export interface DeepBeamSuiteInput {
  schemaVersion: 1;
  suiteVersion: typeof DEEP_BEAM_SUITE_VERSION;
  kingdom: Kingdom;
  startingDraftEnabled: false;
  beamConfig: typeof DEEP_BEAM_CONFIG;
  rulesFingerprint: RulesFingerprint;
}

export interface DeepBeamRunRequest {
  root: string;
  kingdomId: string;
  inputPath: string;
  resultPath: string;
  config: typeof DEEP_BEAM_CONFIG;
  signal?: AbortSignal | undefined;
}
export type DeepBeamRunAdapter = (request: DeepBeamRunRequest) => Promise<void>;

export interface DeepBeamProgress {
  kingdomId: string;
  status: 'skipped' | 'completed' | 'failed';
  finished: number;
  total: number;
  elapsedMs: number;
  etaMs: number | null;
}

export interface DeepBeamBatchOptions {
  root: string;
  kingdomIds?: readonly string[];
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: DeepBeamProgress) => void) | undefined;
}

export interface DeepBeamFailure { kingdomId: string; error: string }
export interface DeepBeamBatchResult {
  skipped: string[];
  completed: string[];
  failed: DeepBeamFailure[];
  interrupted: boolean;
}

export interface DeepBeamSuiteStatus {
  valid: boolean;
  complete: number;
  total: number;
  elapsedMs: number;
  failures: DeepBeamFailure[];
}

interface ResultEvidence { valid: boolean; elapsedMs: number; reason: string }
interface FrozenSourceKingdom extends Kingdom { split: 'tuning' | 'validation' }
interface FrozenSourceManifest { suiteVersion: string; kingdoms: FrozenSourceKingdom[] }
export const FROZEN_DEEP_BEAM_SOURCE_MANIFEST = rawFrozenManifest as FrozenSourceManifest;

function deepKingdom(source: FrozenSourceKingdom): Kingdom {
  return {
    id: source.id.replace(/^balance-/, 'deep-beam-'),
    name: source.name.replace(/^Balance /, 'Deep Beam '),
    startingHealth: 50,
    actionPiles: source.actionPiles.map((pile) => ({ ...pile }))
  };
}

export const DEEP_BEAM_KINGDOMS: readonly Kingdom[] = Object.freeze(
  FROZEN_DEEP_BEAM_SOURCE_MANIFEST.kingdoms.map((kingdom) => Object.freeze(deepKingdom(kingdom)))
);
const kingdomById = new Map(DEEP_BEAM_KINGDOMS.map((kingdom) => [kingdom.id, kingdom]));

function register(): void {
  for (const kingdom of DEEP_BEAM_KINGDOMS) registerKingdom(kingdom);
}

function suiteRoot(root: string): string {
  return path.join(root, '.experiments', 'deep-beam-suite', DEEP_BEAM_SUITE_VERSION);
}
function inputPath(root: string, kingdomId: string): string {
  return path.join(suiteRoot(root), 'inputs', `${kingdomId}.json`);
}
function resultPath(root: string, kingdomId: string): string {
  return path.join(suiteRoot(root), 'results', `${kingdomId}.json`);
}

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createInput(kingdomId: string): DeepBeamSuiteInput {
  register();
  const kingdom = kingdomById.get(kingdomId);
  if (!kingdom) throw new Error(`Unknown deep-beam kingdom ${kingdomId}.`);
  return {
    schemaVersion: 1,
    suiteVersion: DEEP_BEAM_SUITE_VERSION,
    kingdom,
    startingDraftEnabled: false,
    beamConfig: DEEP_BEAM_CONFIG,
    rulesFingerprint: rulesFingerprint(kingdomId, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false)
  };
}

function expectedProtocol(kingdomId: string): ReturnType<typeof matrixProtocol> {
  return matrixProtocol(kingdomId, Array.from({ length: 8 }, (_value, index) => 40_000 + index),
    TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false);
}

function inspectFile(file: string, kingdomId: string): ResultEvidence {
  try {
    const result = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const input = createInput(kingdomId);
    const matrix = result.matrix as Record<string, unknown> | undefined;
    const strategies = matrix?.strategies;
    const cells = matrix?.cells;
    const fingerprint = result.rulesFingerprint as Record<string, unknown> | undefined;
    const valid = result.schemaVersion === 1
      && result.experiment === 'draft-off-diverse-beam-double-oracle'
      && result.suiteVersion === DEEP_BEAM_SUITE_VERSION
      && exact(result.kingdom, input.kingdom)
      && exact(result.config, RESULT_CONFIG)
      && exact(fingerprint, input.rulesFingerprint)
      && matrix?.complete === true
      && exact(matrix.protocol, expectedProtocol(kingdomId))
      && Array.isArray(strategies) && strategies.length > 0
      && Array.isArray(cells)
      && cells.length === strategies.length * (strategies.length - 1) / 2
      && cells.every((cell) => (cell as { complete?: unknown }).complete === true)
      && Array.isArray(result.iterations) && result.iterations.length > 0
      && result.equilibrium !== null && typeof result.equilibrium === 'object'
      && Array.isArray(result.targetMixture)
      && result.independentSweep === null
      && typeof result.elapsedMs === 'number' && Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0;
    return {
      valid,
      elapsedMs: typeof result.elapsedMs === 'number' && Number.isFinite(result.elapsedMs) ? result.elapsedMs : 0,
      reason: valid ? 'complete' : 'artifact is incomplete, malformed, failed, or stale'
    };
  } catch (error) {
    return { valid: false, elapsedMs: 0, reason: error instanceof Error ? error.message : String(error) };
  }
}

function inspectRun(root: string, kingdomId: string): ResultEvidence {
  return inspectFile(resultPath(root, kingdomId), kingdomId);
}

function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

async function defaultRun(request: DeepBeamRunRequest): Promise<void> {
  const root = path.resolve(request.root);
  const arguments_ = [
    '--import', 'tsx', path.join(root, 'scripts', 'beam_draft_off.ts'),
    '--game', request.inputPath,
    '--out', request.resultPath,
    '--workers', String(request.config.workers),
    '--iterations', String(request.config.iterations),
    '--max-slots', String(request.config.maxSlots)
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, { cwd: root, stdio: 'inherit' });
    let settled = false;
    const stop = (): void => { if (!child.killed) child.kill('SIGTERM'); };
    request.signal?.addEventListener('abort', stop, { once: true });
    child.once('error', (error) => {
      settled = true;
      request.signal?.removeEventListener('abort', stop);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      request.signal?.removeEventListener('abort', stop);
      if (code === 0) resolve();
      else reject(new Error(`Beam child exited with ${signal ?? `code ${String(code)}`}.`));
    });
  });
}

async function runBatch(
  options: DeepBeamBatchOptions, adapter: DeepBeamRunAdapter = defaultRun
): Promise<DeepBeamBatchResult> {
  register();
  const ids = [...(options.kingdomIds ?? DEEP_BEAM_KINGDOMS.map((kingdom) => kingdom.id))];
  for (const id of ids) if (!kingdomById.has(id)) throw new Error(`Unknown deep-beam kingdom ${id}.`);
  const result: DeepBeamBatchResult = { skipped: [], completed: [], failed: [], interrupted: false };
  const root = suiteRoot(options.root);
  const statusFile = path.join(root, 'status.json');
  const durations: number[] = [];
  let finished = 0;
  const writeStatus = (activeKingdomId: string | null): void => writeAtomic(statusFile, {
    schemaVersion: 1,
    suiteVersion: DEEP_BEAM_SUITE_VERSION,
    beamConfig: DEEP_BEAM_CONFIG,
    startingDraftEnabled: false,
    total: ids.length,
    finished,
    activeKingdomId,
    ...result
  });
  const report = (kingdomId: string, status: DeepBeamProgress['status'], elapsedMs: number): void => {
    if (status !== 'failed') durations.push(elapsedMs);
    finished += 1;
    const mean = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null;
    options.onProgress?.({ kingdomId, status, finished, total: ids.length, elapsedMs,
      etaMs: mean === null ? null : Math.round(mean * (ids.length - finished)) });
  };

  const queue: string[] = [];
  for (const id of ids) {
    const input = createInput(id);
    writeAtomic(inputPath(options.root, id), input);
    const evidence = inspectRun(options.root, id);
    if (evidence.valid) {
      result.skipped.push(id);
      report(id, 'skipped', evidence.elapsedMs);
    } else queue.push(id);
  }
  writeStatus(null);

  for (const kingdomId of queue) {
    if (options.signal?.aborted) { result.interrupted = true; break; }
    writeStatus(kingdomId);
    const finalResult = resultPath(options.root, kingdomId);
    fs.mkdirSync(path.dirname(finalResult), { recursive: true });
    const temporaryResult = `${finalResult}.tmp-${process.pid}-${Date.now()}`;
    const started = Date.now();
    try {
      await adapter({ root: options.root, kingdomId, inputPath: inputPath(options.root, kingdomId),
        resultPath: temporaryResult, config: DEEP_BEAM_CONFIG, signal: options.signal });
      const evidence = inspectFile(temporaryResult, kingdomId);
      if (!evidence.valid) throw new Error(evidence.reason);
      fs.renameSync(temporaryResult, finalResult);
      result.completed.push(kingdomId);
      report(kingdomId, 'completed', evidence.elapsedMs);
    } catch (error) {
      if (options.signal?.aborted) {
        result.interrupted = true;
        break;
      }
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ kingdomId, error: message });
      report(kingdomId, 'failed', Date.now() - started);
    } finally {
      fs.rmSync(temporaryResult, { force: true });
    }
    writeStatus(null);
  }
  result.skipped.sort();
  result.completed.sort();
  result.failed.sort((left, right) => left.kingdomId.localeCompare(right.kingdomId));
  writeStatus(null);
  return result;
}

function status(root: string): DeepBeamSuiteStatus {
  register();
  const failures: DeepBeamFailure[] = [];
  let complete = 0;
  let elapsedMs = 0;
  for (const kingdom of DEEP_BEAM_KINGDOMS) {
    const evidence = inspectRun(root, kingdom.id);
    if (evidence.valid) { complete += 1; elapsedMs += evidence.elapsedMs; }
    else failures.push({ kingdomId: kingdom.id, error: evidence.reason });
  }
  return { valid: complete === DEEP_BEAM_KINGDOMS.length, complete,
    total: DEEP_BEAM_KINGDOMS.length, elapsedMs, failures };
}

export const deepBeamSuite = Object.freeze({
  version: DEEP_BEAM_SUITE_VERSION,
  config: DEEP_BEAM_CONFIG,
  kingdoms: DEEP_BEAM_KINGDOMS,
  register,
  createInput,
  inputPath,
  resultPath,
  resultEvidence: inspectRun,
  runBatch,
  status
});
