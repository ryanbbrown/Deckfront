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
