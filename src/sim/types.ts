import type { GameState, LegalAction, PlayerId } from '../game';

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
  startingDraftEnabled?: boolean;
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
  moneySpent: Record<PlayerId, number>;      // summed purchase costs, which carry kingdom overrides
  unspentMoney: Record<PlayerId, number>;
  finalHealth: Record<PlayerId, number>;
}

export type MatchOutcome = 'ochre' | 'indigo' | 'draw' | 'aborted';
export type MatchReason = 'victory' | 'turnLimit' | 'actionCap' | 'actionSearchOverflow';

export interface MatchResult {
  config: Omit<MatchConfig, 'agents' | 'startingDraftEnabled'> & { startingDraftEnabled: boolean; agentIds: Record<PlayerId, string> };
  outcome: MatchOutcome;
  reason: MatchReason;
  turns: number;                  // completed player turns
  telemetry: MatchTelemetry;
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
  planPositionPurchasesByStrategy?: Record<string, Record<string, number>>;
  damageByCard: Record<string, number>;
  playsByCard: Record<string, number>;
  deadDraws: DeadDrawCounts;
  turnsToWin: { total: number; count: number };
  byOrientation: Record<OrientationKey, Record<SideKey, PairRecord>>;
}
