import type { ExperimentMode } from './report';

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

/** 30 turns per player before a draw, and the action cap used by the match runner. */
export const TURN_LIMIT_PER_PLAYER = 30;
export const ACTION_CAP_PER_TURN = 200;
