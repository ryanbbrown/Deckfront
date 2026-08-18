import type {
  ActionAvailability, CardDefinition, CardInstance, GameEvent, LegalAction,
  Phase, PlayerId, RangeBand
} from '../game/types';

export interface GamePlayerView {
  id: PlayerId;
  hand: CardInstance[];
  played: CardInstance[];
  zoneCounts: { draw: number; hand: number; discard: number; play: number };
  deckCounts: Record<string, number>;
  money: number;
  firstBuyMoney: number;
  firstBuyPending: boolean;
  purchases: string[];
}
export interface FighterView { playerId: PlayerId; position: number; health: number; aimed: boolean; exposed: boolean }
export interface GameView {
  schemaVersion: 9;
  id: string; revision: number; createdAt: string; updatedAt: string; elapsedSeconds: number;
  completedActions: number; durationSeconds: number | null;
  activePlayerId: PlayerId; selectedFirstPlayerId: PlayerId; phase: Phase; turn: number; winner: PlayerId | null;
  fighters: Record<PlayerId, FighterView>; range: RangeBand; supply: Record<string, number>;
  cards: Record<string, CardDefinition>; players: Record<PlayerId, GamePlayerView>; trashCount: number;
  events: GameEvent[]; legalActions: LegalAction[]; actionAvailability: ActionAvailability[];
  canUndo: boolean;
  buildProposal: string[]; completedBuilds: Record<PlayerId, string[]> | null;
}
export interface GameExport { schemaVersion: 9; exportedAt: string; game: GameView }
