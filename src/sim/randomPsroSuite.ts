import fs from 'node:fs';
import path from 'node:path';
import { registerKingdom } from '../game';
import { deepBeamSuite } from './deepBeamSuite';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './experimentConfig';
import { WorkerPairingRunner } from './pairingRunner';
import {
  RANDOM_PSRO_DEFAULT_CONFIG, RANDOM_PSRO_SUITE_SEEDS, RANDOM_PSRO_VERSION,
  runRandomPsro, validateRandomPsroArtifact
} from './randomPsro';
import type {
  ArtifactEvidence, RandomPsroArtifact, RandomPsroConfig, RunRandomPsroOptions
} from './randomPsro';
import { rulesFingerprint } from './rulesFingerprint';

export const RANDOM_PSRO_KINGDOMS = Object.freeze(deepBeamSuite.kingdoms.slice(0, 10));

export interface RandomPsroUnit { kingdomId: string; seed: number }
export interface RandomPsroBatchOptions {
  root: string;
  units?: readonly RandomPsroUnit[];
  workers?: number;
  config?: Partial<RandomPsroConfig>;
  signal?: AbortSignal;
  onProgress?: (progress: { unit: RandomPsroUnit; status: 'skipped' | 'completed' | 'incomplete' | 'failed';
    finished: number; total: number; elapsedMs: number }) => void;
}
export type RandomPsroRunAdapter = (options: RunRandomPsroOptions, workers: number) => Promise<RandomPsroArtifact>;
export interface RandomPsroBatchResult {
  skipped: RandomPsroUnit[];
  completed: RandomPsroUnit[];
  incomplete: RandomPsroUnit[];
  failed: { unit: RandomPsroUnit; error: string }[];
  interrupted: boolean;
}

export function registerRandomPsroKingdoms(): void {
  for (const kingdom of RANDOM_PSRO_KINGDOMS) registerKingdom(kingdom);
}

export function randomPsroUnits(): RandomPsroUnit[] {
  return RANDOM_PSRO_KINGDOMS.flatMap((kingdom) =>
    RANDOM_PSRO_SUITE_SEEDS.map((seed) => ({ kingdomId: kingdom.id, seed })));
}

function suiteRoot(root: string): string {
  return path.join(root, '.experiments', 'random-psro-consistency', RANDOM_PSRO_VERSION);
}

export function randomPsroArtifactPath(root: string, unit: RandomPsroUnit): string {
  registerRandomPsroKingdoms();
  const fingerprint = rulesFingerprint(unit.kingdomId, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false);
  return path.join(suiteRoot(root), fingerprint.hash, 'results', `${unit.kingdomId}-seed-${unit.seed}.json`);
}

export function inspectRandomPsroUnit(
  root: string, unit: RandomPsroUnit, config: Partial<RandomPsroConfig> = {}
): ArtifactEvidence {
  try {
    const parsed = JSON.parse(fs.readFileSync(randomPsroArtifactPath(root, unit), 'utf8')) as unknown;
    return validateRandomPsroArtifact(parsed, { ...unit, config });
  } catch (error) {
    return { valid: false, converged: false,
      reason: error instanceof Error ? error.message : String(error), artifact: null };
  }
}

function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

async function defaultAdapter(options: RunRandomPsroOptions, workers: number): Promise<RandomPsroArtifact> {
  const kingdom = RANDOM_PSRO_KINGDOMS.find((entry) => entry.id === options.kingdomId);
  if (!kingdom) throw new Error(`Unknown random PSRO kingdom ${options.kingdomId}.`);
  const runner = new WorkerPairingRunner(workers,
    new URL('../server/aiWorker.ts', import.meta.url), { kingdom }, ['--import', 'tsx']);
  try { return await runRandomPsro(options, runner); }
  finally { await runner.close(); }
}

export async function runRandomPsroBatch(
  options: RandomPsroBatchOptions, adapter: RandomPsroRunAdapter = defaultAdapter
): Promise<RandomPsroBatchResult> {
  registerRandomPsroKingdoms();
  const units = [...(options.units ?? randomPsroUnits())];
  const known = new Set(randomPsroUnits().map((unit) => `${unit.kingdomId}:${unit.seed}`));
  for (const unit of units) {
    if (!RANDOM_PSRO_KINGDOMS.some((entry) => entry.id === unit.kingdomId)) {
      throw new Error(`Unknown random PSRO kingdom ${unit.kingdomId}.`);
    }
    if (!Number.isInteger(unit.seed) || unit.seed < 0 || unit.seed > 0xffffffff) throw new Error('Unit seed must be a 32-bit integer.');
    if (!known.has(`${unit.kingdomId}:${unit.seed}`) && options.units === undefined) throw new Error('Default suite unit is invalid.');
  }
  const result: RandomPsroBatchResult = { skipped: [], completed: [], incomplete: [], failed: [], interrupted: false };
  let finished = 0;
  for (const unit of units) {
    if (options.signal?.aborted) { result.interrupted = true; break; }
    const held = inspectRandomPsroUnit(options.root, unit, options.config);
    if (held.valid) {
      (held.converged ? result.skipped : result.incomplete).push(unit);
      finished += 1;
      options.onProgress?.({ unit, status: held.converged ? 'skipped' : 'incomplete',
        finished, total: units.length, elapsedMs: held.artifact?.elapsedMs ?? 0 });
      continue;
    }
    const started = Date.now();
    try {
      const runOptions: RunRandomPsroOptions = { ...unit,
        ...(options.config ? { config: options.config } : {}) };
      const artifact = await adapter(runOptions, options.workers ?? 10);
      const evidence = validateRandomPsroArtifact(artifact, { ...unit,
        ...(options.config ? { config: options.config } : {}) });
      if (!evidence.valid) throw new Error(`Generated artifact failed validation: ${evidence.reason}.`);
      writeAtomic(randomPsroArtifactPath(options.root, unit), artifact);
      (evidence.converged ? result.completed : result.incomplete).push(unit);
      options.onProgress?.({ unit, status: evidence.converged ? 'completed' : 'incomplete',
        finished: ++finished, total: units.length, elapsedMs: artifact.elapsedMs });
    } catch (error) {
      if (options.signal?.aborted) { result.interrupted = true; break; }
      result.failed.push({ unit, error: error instanceof Error ? error.message : String(error) });
      options.onProgress?.({ unit, status: 'failed', finished: ++finished,
        total: units.length, elapsedMs: Date.now() - started });
    }
  }
  writeAtomic(path.join(suiteRoot(options.root), 'status.json'), {
    schemaVersion: 1, suiteVersion: RANDOM_PSRO_VERSION, config: { ...RANDOM_PSRO_DEFAULT_CONFIG, ...options.config },
    total: units.length, ...result
  });
  return result;
}

export function randomPsroStatus(root: string, config: Partial<RandomPsroConfig> = {}): {
  total: number; valid: number; converged: number; incomplete: number; missing: { unit: RandomPsroUnit; reason: string }[];
} {
  const units = randomPsroUnits();
  let valid = 0, converged = 0, incomplete = 0;
  const missing: { unit: RandomPsroUnit; reason: string }[] = [];
  for (const unit of units) {
    const evidence = inspectRandomPsroUnit(root, unit, config);
    if (!evidence.valid) missing.push({ unit, reason: evidence.reason });
    else { valid += 1; if (evidence.converged) converged += 1; else incomplete += 1; }
  }
  return { total: units.length, valid, converged, incomplete, missing };
}
