import type { GameState, LegalAction, PlayerId } from '../game';
import type { CalibrationInput } from './calibration';
import type { Strategy } from './strategy';

/** Thrown by an agent whose Action-phase search passes its visited-state limit. */
export class ActionSearchOverflowError extends Error {}

export interface Agent {
  readonly id: string;
  chooseStartingBuild(state: GameState, playerId: PlayerId): string[];
  // Serves the Action phase, the Buy phase, and pending-choice resolution.
  // Throws ActionSearchOverflowError when its search exceeds its state limit.
  chooseAction(state: GameState, playerId: PlayerId, actions: readonly LegalAction[]): LegalAction;
}

export interface MatchConfig {
  kingdomId: string;
  seed: number;
  firstPlayerId: PlayerId;
  swapSides: boolean;             // exchanges the two starting positions
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  agents: Record<PlayerId, Agent>;
}

export interface DeadDrawCounts { range: number; mana: number; setup: number; total: number }

export interface MatchTelemetry {
  turnsToWin: number | null;                 // completed player turns when the game ended
  eventCount: number;
  damageByCard: Record<PlayerId, Record<string, number>>;
  playsByCard: Record<PlayerId, Record<string, number>>;
  purchasesByCard: Record<PlayerId, Record<string, number>>;
  startingBuild: Record<PlayerId, string[]>;
  deadDraws: Record<PlayerId, DeadDrawCounts>;
  moneySpent: Record<PlayerId, number>;
  unspentMoney: Record<PlayerId, number>;
  finalHealth: Record<PlayerId, number>;
}

export type MatchOutcome = 'ochre' | 'indigo' | 'draw' | 'aborted';
export type MatchReason = 'victory' | 'turnLimit' | 'actionCap' | 'actionSearchOverflow';

export interface MatchResult {
  config: Omit<MatchConfig, 'agents'> & { agentIds: Record<PlayerId, string> };
  outcome: MatchOutcome;
  reason: MatchReason;
  turns: number;                  // completed player turns
  telemetry: MatchTelemetry;
}

export interface ScoredStrategy {
  strategy: Strategy;
  score: number;           // mean score per completed game; 0 when nothing completed
  completedGames: number;
  abortedGames: number;
}

export interface PairRecord {
  played: number; wins: number; draws: number; losses: number; aborted: number;
}

export type OrientationKey = 'firstOchre' | 'firstIndigo';
export type SideKey = 'normal' | 'swapped';

/**
 * Aggregated across matches, keeping the orientation split the report needs. `byOrientation` counts
 * from the seats, not from a strategy: `wins` is ochre's, `losses` is indigo's. A summed score cannot
 * recover that split, and it is the only measure of seat and first-player advantage.
 */
export interface TelemetryAggregate {
  acquisitionsByStrategy: Record<string, Record<string, number>>;
  damageByCard: Record<string, number>;
  playsByCard: Record<string, number>;
  deadDraws: DeadDrawCounts;
  turnsToWin: { total: number; count: number };
  byOrientation: Record<OrientationKey, Record<SideKey, PairRecord>>;
}

export interface EvolutionConfig {
  kingdomId: string;
  seed: number;
  candidates: number;
  leaders: number;
  generations: number;
  sharedSeeds: number;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  // Action-phase visited-state limit. A search that passes it aborts the match, which scores for
  // neither side. Defaults to `DEFAULT_STATE_LIMIT`; lowering it makes matches abort.
  stateLimit?: number | undefined;
  deadline?: number | undefined;      // epoch milliseconds
  now?: (() => number) | undefined;   // injectable clock, for tests
}

export interface GenerationResult {
  generation: number;
  partial: boolean;
  leaders: ScoredStrategy[];
  scores: Record<string, number>;
  matchCount: number;
  overflowCount: number;
  elapsedMs: number;
  telemetry: TelemetryAggregate;
}

export interface TournamentConfig {
  kingdomId: string; seed: number; sharedSeeds: number;
  turnLimitPerPlayer: number; actionCapPerTurn: number;
  stateLimit?: number | undefined;
  deadline?: number | undefined; now?: (() => number) | undefined;
  // The last generation's leaders, whose acquisitions the calibration gate reads. The entrant list
  // also holds retained leaders from every generation and the fixed baselines, and nothing in it
  // says which generation an entrant came from. Defaults to every entrant that is not a baseline.
  finalLeaderIds?: readonly string[] | undefined;
}

export interface TournamentResult {
  entrants: Strategy[];
  pairs: Record<string, Record<string, PairRecord>>;
  ranking: ScoredStrategy[];
  telemetry: TelemetryAggregate;
  calibration: CalibrationInput;   // built here, consumed by checkRiggedMelee
}
