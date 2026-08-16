import type {
  ActionAvailability, CardDefinition, CardInstance, GameEvent, LegalAction,
  Phase, PlayerId, RangeBand
} from '../game/types';

export type OpponentMode = 'ai' | 'local';
export interface StrategyPreset { id: string; name: string; markdown: string }
export interface SafePlayer {
  id: PlayerId;
  hand: CardInstance[] | null;
  zoneCounts: { draw: number; hand: number; discard: number; play: number };
  deckCounts: Record<string, number> | null;
  money: number;
  firstBuyMoney: number;
  firstBuyPending: boolean;
  purchases: string[];
}
export interface SafeFighter { playerId: PlayerId; position: number; health: number; aimed: boolean; exposed: boolean }
export interface SafeGameView {
  schemaVersion: 5;
  id: string; revision: number; createdAt: string; updatedAt: string; elapsedSeconds: number;
  completedActions: number; durationSeconds: number | null; humanPlayerId: PlayerId; aiPlayerId: PlayerId;
  opponentMode: OpponentMode; viewPlayerId: PlayerId;
  activePlayerId: PlayerId; selectedFirstPlayerId: PlayerId; phase: Phase; turn: number; winner: PlayerId | null;
  fighters: Record<PlayerId, SafeFighter>; range: RangeBand; supply: Record<string, number>;
  cards: Record<string, CardDefinition>; players: Record<PlayerId, SafePlayer>; trashCount: number;
  events: GameEvent[]; legalActions: LegalAction[]; actionAvailability: ActionAvailability[];
  canUndo: boolean;
  humanBuildProposal: string[]; completedBuilds: Record<PlayerId, string[]> | null;
  strategy: { presetId: string; markdown: string }; aiRuntime: { model: string; effort: string };
  lastAiSummary: string | null;
}
export interface AiTurnStatus { status: 'idle' | 'running' | 'complete' | 'error'; game?: SafeGameView; error?: string }
export interface RedactedExport { schemaVersion: 5; exportedAt: string; game: SafeGameView }
