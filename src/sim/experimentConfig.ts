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
  stateLimit: number;
  workers: number;
}

export const TURN_LIMIT_PER_PLAYER = 30;
export const ACTION_CAP_PER_TURN = 200;
export const UNION_DEADLINE_RESERVE = 0.3;

export function conservativeGameBound(options: Pick<ExperimentOptions,
  'restarts' | 'initialStrategies' | 'iterations' | 'candidates' | 'seeds' | 'unionIterations'>): number {
  const maximumUnion = options.restarts * (options.initialStrategies + options.iterations) + options.unionIterations;
  const matrixGames = 4 * options.seeds * maximumUnion * (maximumUnion - 1) / 2;
  const restartGames = 4 * options.seeds * options.restarts * options.iterations * 2 * (options.candidates + 1);
  const unionGames = 4 * options.seeds * options.unionIterations * (options.candidates + 1);
  return matrixGames + restartGames + unionGames;
}
