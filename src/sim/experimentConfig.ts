import type { ExperimentMode } from './report';

export interface ExperimentOptions {
  kingdomId: string;
  mode: ExperimentMode;
  seed: number;
  restarts: number;
  initialStrategies: number;
  candidates: number;
  iterations: number;
  nicheAdditions: number;
  seeds: number;
  unionIterations: number;
  deadlineMinutes: number;
  workers: number;
}

export type ExperimentLimitName = 'restarts' | 'initialStrategies' | 'candidates' | 'iterations'
  | 'nicheAdditions' | 'seeds' | 'unionIterations' | 'deadlineMinutes' | 'workers';

export const EXPERIMENT_DEFAULTS: Record<ExperimentMode, Record<ExperimentLimitName, number>> = {
  smoke: { restarts: 1, initialStrategies: 5, candidates: 20, iterations: 4, nicheAdditions: 1,
    seeds: 8, unionIterations: 2, deadlineMinutes: 30, workers: 4 },
  full: { restarts: 3, initialStrategies: 8, candidates: 100, iterations: 12, nicheAdditions: 4,
    seeds: 25, unionIterations: 8, deadlineMinutes: 240, workers: 4 }
};

export function defaultExperimentOptions(
  kingdomId: string, mode: ExperimentMode, workers = EXPERIMENT_DEFAULTS[mode].workers
): ExperimentOptions {
  return { kingdomId, mode, seed: 1, ...EXPERIMENT_DEFAULTS[mode], workers };
}

export const TURN_LIMIT_PER_PLAYER = 30;
export const ACTION_CAP_PER_TURN = 200;
export const UNION_DEADLINE_RESERVE = 0.3;

export function conservativeGameBound(options: Pick<ExperimentOptions,
  'restarts' | 'initialStrategies' | 'iterations' | 'candidates' | 'seeds' | 'unionIterations'>): number {
  const maximumUnion = options.restarts * (options.initialStrategies + options.iterations) + options.unionIterations;
  const matrixGames = 4 * options.seeds * maximumUnion * (maximumUnion - 1) / 2;
  const restartGames = 4 * options.seeds * options.restarts * options.iterations * (2 * options.candidates + 3);
  const unionGames = 4 * options.seeds * options.unionIterations * (options.candidates + 1);
  return matrixGames + restartGames + unionGames;
}
