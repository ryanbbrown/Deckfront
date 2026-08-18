import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isMainThread, workerData } from 'node:worker_threads';
import { MIN_CANDIDATES } from './evolution';
import { runExperiment } from './experiment';
import type { ExperimentDeps } from './experiment';
import { CURATED_KINGDOM_IDS } from './kingdoms';
import type { ExperimentMode } from './report';
import { WorkerPairingRunner, runPairingWorker } from './pairingRunner';

export interface ExperimentOptions {
  kingdomId: string;
  mode: ExperimentMode;
  seed: number;
  candidates: number;
  leaders: number;
  generations: number;
  sharedSeeds: number;
  deadlineMinutes: number;
  stateLimit: number;
  workers: number;
}

/** 30 turns per player before a draw, and the action cap the match runner already uses. */
export const TURN_LIMIT_PER_PLAYER = 30;
export const ACTION_CAP_PER_TURN = 200;
export const DEFAULT_SEED = 1;

type LimitName = 'candidates' | 'leaders' | 'generations' | 'sharedSeeds' | 'deadlineMinutes' | 'stateLimit' | 'workers';

const DEFAULTS: Record<ExperimentMode, Record<LimitName, number>> = {
  smoke: { candidates: 20, leaders: 3, generations: 5, sharedSeeds: 5, deadlineMinutes: 30, stateLimit: 20000, workers: 10 },
  full: { candidates: 30, leaders: 4, generations: 32, sharedSeeds: 8, deadlineMinutes: 240, stateLimit: 20000, workers: 10 }
};

/**
 * The approved ceilings, applied in **both** modes. The mode sets the defaults, not the maximum, so
 * `--candidates 50` is legal in smoke mode and `--candidates 200` is rejected in either. The full
 * defaults sit below the maxima because the measured throughput makes a design-maximum run 41 hours.
 */
export const MAXIMA: Record<LimitName, number> = {
  candidates: 100, leaders: 5, generations: 32, sharedSeeds: 25, deadlineMinutes: 420, stateLimit: 20000, workers: 16
};

const LIMIT_FLAGS: Record<string, LimitName> = {
  '--candidates': 'candidates',
  '--leaders': 'leaders',
  '--generations': 'generations',
  '--seeds': 'sharedSeeds',
  '--deadline-minutes': 'deadlineMinutes',
  '--state-limit': 'stateLimit',
  '--workers': 'workers'
};

const KNOWN_FLAGS = new Set(['--kingdom', '--mode', '--seed', ...Object.keys(LIMIT_FLAGS)]);

function positiveInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive whole number, not ${raw}.`);
  }
  return value;
}

/**
 * Parses the command line without touching the file system, so the whole option matrix is testable
 * without a child process. An explicit option may lower a limit and never raise it above the maximum.
 */
export function parseExperimentOptions(argv: readonly string[]): ExperimentOptions {
  let kingdomId: string | null = null;
  let mode: ExperimentMode | null = null;
  let seed = DEFAULT_SEED;
  const limits: Partial<Record<LimitName, number>> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    // The name is checked first: `--kingdmo` with nothing after it is a typo, not a missing value.
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`Unknown option ${flag}.`);
    const raw = argv[index + 1];
    if (raw === undefined || raw.startsWith('--')) throw new Error(`${flag} needs a value.`);
    index += 1;
    if (flag === '--kingdom') {
      if (!CURATED_KINGDOM_IDS.includes(raw)) {
        throw new Error(`Unknown experiment kingdom ${raw}. Choose one of: ${CURATED_KINGDOM_IDS.join(', ')}.`);
      }
      kingdomId = raw;
    } else if (flag === '--mode') {
      if (raw !== 'smoke' && raw !== 'full') throw new Error(`--mode must be smoke or full, not ${raw}.`);
      mode = raw;
    } else if (flag === '--seed') {
      seed = positiveInteger(flag, raw);
    } else {
      const name = LIMIT_FLAGS[flag]!;
      const value = positiveInteger(flag, raw);
      if (value > MAXIMA[name]) throw new Error(`${flag} may be at most ${MAXIMA[name]}, not ${value}.`);
      limits[name] = value;
    }
  }

  if (!kingdomId) throw new Error(`--kingdom is required. Choose one of: ${CURATED_KINGDOM_IDS.join(', ')}.`);
  if (!mode) throw new Error('--mode is required, smoke or full.');

  const resolved = { ...DEFAULTS[mode], ...limits };
  // Checked here so a run fails before it writes anything, rather than after `run.json` exists. The
  // leader count needs no check: its maximum is 5 and the candidate minimum is 5.
  if (resolved.candidates < MIN_CANDIDATES) {
    throw new Error(`--candidates must be at least ${MIN_CANDIDATES}, so the fixed seeds all fit,`
      + ` not ${resolved.candidates}.`);
  }
  return { kingdomId, mode, seed, ...resolved };
}

export function experimentDir(root: string, kingdomId: string, mode: ExperimentMode): string {
  // The mode segment keeps a full run from overwriting the committed smoke report for the same
  // kingdom, which is the evidence `GOAL.md` asks for.
  return path.join(root, '.experiments', kingdomId, mode);
}

export async function main(argv: readonly string[], root: string, deps: ExperimentDeps = {}): Promise<number> {
  const options = parseExperimentOptions(argv);
  const pairingRunner = deps.pairingRunner
    ?? new WorkerPairingRunner(options.workers, new URL(import.meta.url));
  const summary = await runExperiment(
    options, experimentDir(root, options.kingdomId, options.mode), { ...deps, pairingRunner }
  );
  process.stdout.write(`${options.kingdomId} ${options.mode}: ${summary.stopReason}`
    + `, ${summary.evolutionMatches + summary.tournamentMatches} matches`
    + `, report at ${experimentDir(root, options.kingdomId, options.mode)}/report.md\n`);
  if (summary.error) process.stderr.write(`${summary.error}\n`);
  return summary.stopReason === 'error' ? 1 : 0;
}

const entry = process.argv[1];
if (!isMainThread) {
  if ((workerData as { kind?: unknown } | null)?.kind !== 'pairing-worker') {
    throw new Error('Unknown worker kind.');
  }
  runPairingWorker();
} else if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    process.exitCode = await main(process.argv.slice(2), process.cwd());
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
