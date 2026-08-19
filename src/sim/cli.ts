import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isMainThread, workerData } from 'node:worker_threads';
import { runExperiment } from './experiment';
import type { ExperimentDeps } from './experiment';
import { CURATED_KINGDOM_IDS } from './kingdoms';
import type { ExperimentOptions } from './experimentConfig';
import type { ExperimentMode } from './report';
import { WorkerPairingRunner, runPairingWorker } from './pairingRunner';

export const DEFAULT_SEED = 1;
type LimitName = 'restarts' | 'initialStrategies' | 'candidates' | 'iterations' | 'nicheAdditions'
  | 'seeds' | 'unionIterations' | 'deadlineMinutes' | 'stateLimit' | 'workers';
const DEFAULTS: Record<ExperimentMode, Record<LimitName, number>> = {
  smoke: { restarts: 1, initialStrategies: 5, candidates: 20, iterations: 4, nicheAdditions: 1,
    seeds: 8, unionIterations: 2, deadlineMinutes: 30, stateLimit: 20000, workers: 10 },
  full: { restarts: 3, initialStrategies: 8, candidates: 100, iterations: 12, nicheAdditions: 4,
    seeds: 25, unionIterations: 8, deadlineMinutes: 240, stateLimit: 20000, workers: 10 }
};
export const MAXIMA: Record<LimitName, number> = {
  restarts: 3, initialStrategies: 12, candidates: 100, iterations: 16, nicheAdditions: 4,
  seeds: 25, unionIterations: 8, deadlineMinutes: 420, stateLimit: 20000, workers: 16
};
const FLAGS: Record<string, LimitName> = {
  '--restarts': 'restarts', '--initial-strategies': 'initialStrategies', '--candidates': 'candidates',
  '--iterations': 'iterations', '--niche-additions': 'nicheAdditions', '--seeds': 'seeds',
  '--union-iterations': 'unionIterations', '--deadline-minutes': 'deadlineMinutes',
  '--state-limit': 'stateLimit', '--workers': 'workers'
};
const KNOWN = new Set(['--kingdom', '--mode', '--seed', ...Object.keys(FLAGS)]);
function positive(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive whole number, not ${raw}.`);
  return value;
}
export function parseExperimentOptions(argv: readonly string[]): ExperimentOptions {
  let kingdomId: string | null = null, mode: ExperimentMode | null = null, seed = DEFAULT_SEED;
  const specified: Partial<Record<LimitName, number>> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (!KNOWN.has(flag)) throw new Error(`Unknown option ${flag}.`);
    const raw = argv[++index];
    if (!raw || raw.startsWith('--')) throw new Error(`${flag} needs a value.`);
    if (flag === '--kingdom') {
      if (!CURATED_KINGDOM_IDS.includes(raw)) throw new Error(`Unknown experiment kingdom ${raw}.`);
      kingdomId = raw;
    } else if (flag === '--mode') {
      if (raw !== 'smoke' && raw !== 'full') throw new Error(`--mode must be smoke or full, not ${raw}.`);
      mode = raw;
    } else if (flag === '--seed') seed = positive(flag, raw);
    else {
      const name = FLAGS[flag]!; const value = positive(flag, raw);
      if (value > MAXIMA[name]) throw new Error(`${flag} may be at most ${MAXIMA[name]}, not ${value}.`);
      specified[name] = value;
    }
  }
  if (!kingdomId) throw new Error('--kingdom is required.');
  if (!mode) throw new Error('--mode is required, smoke or full.');
  return { kingdomId, mode, seed, ...DEFAULTS[mode], ...specified };
}
export function experimentDir(root: string, kingdomId: string, mode: ExperimentMode): string {
  return path.join(root, '.experiments', kingdomId, mode);
}
export async function main(argv: readonly string[], root: string, deps: ExperimentDeps = {}): Promise<number> {
  const options = parseExperimentOptions(argv);
  const pairingRunner = deps.pairingRunner ?? new WorkerPairingRunner(options.workers, new URL(import.meta.url));
  const summary = await runExperiment(options, experimentDir(root, options.kingdomId, options.mode),
    { ...deps, pairingRunner });
  process.stdout.write(`${options.kingdomId} ${options.mode}: ${summary.stopReason}, ${summary.matches} matches, report at `
    + `${experimentDir(root, options.kingdomId, options.mode)}/report.md\n`);
  if (summary.error) process.stderr.write(`${summary.error}\n`);
  return summary.valid ? 0 : 1;
}
const entry = process.argv[1];
if (!isMainThread) {
  if ((workerData as { kind?: unknown } | null)?.kind !== 'pairing-worker') throw new Error('Unknown worker kind.');
  runPairingWorker();
} else if (entry && import.meta.url === pathToFileURL(entry).href) {
  try { process.exitCode = await main(process.argv.slice(2), process.cwd()); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
