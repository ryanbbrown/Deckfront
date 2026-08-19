import type {
  CardDefinition, CardInstance, GameEvent, Phase, PlayerId, RangeBand
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
export interface BrowserAction { id: string; label: string; text: string }
export interface CardActionChoice extends BrowserAction { targetCardInstanceIds: string[] }
export interface CardActionPresentation {
  cardInstanceId: string;
  enabled: boolean;
  reason: string | null;
  selection: 'none' | 'movement' | 'trashOneOrTwo';
  eligibleCardInstanceIds: string[];
  actionId: string | null;
  choices: CardActionChoice[];
}
export interface PhaseActionPresentation { id: string; kind: 'endAction' | 'endBuy' }
export interface BuyActionPresentation { id: string; definitionId: string }
export interface SelectionActionPresentation extends BrowserAction { cardInstanceId: string | null }
export interface SelectionPresentation {
  kind: 'discard' | 'recover';
  choices: SelectionActionPresentation[];
}
export interface GameActionPresentation {
  cards: CardActionPresentation[];
  phases: PhaseActionPresentation[];
  buys: BuyActionPresentation[];
  selection: SelectionPresentation | null;
}
export interface GameView {
  schemaVersion: 10;
  id: string; revision: number; createdAt: string; updatedAt: string; elapsedSeconds: number;
  completedActions: number; durationSeconds: number | null;
  activePlayerId: PlayerId; selectedFirstPlayerId: PlayerId; phase: Phase; turn: number; winner: PlayerId | null;
  fighters: Record<PlayerId, FighterView>; range: RangeBand; supply: Record<string, number>;
  cards: Record<string, CardDefinition>; players: Record<PlayerId, GamePlayerView>; trashCount: number;
  events: GameEvent[]; actions: GameActionPresentation;
  canUndo: boolean;
  buildProposal: string[]; completedBuilds: Record<PlayerId, string[]> | null;
}
export interface GameExport { schemaVersion: 10; exportedAt: string; game: GameView }
