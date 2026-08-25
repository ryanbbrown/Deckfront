import type {
  CardDefinition, CardInstance, GameEventType, Phase, PlayerId, RangeBand
} from '../game/types';

export type GameMode = 'local' | 'ai';
export const AI_DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'] as const;
export type AiDifficulty = (typeof AI_DIFFICULTIES)[number];
export interface TrainingSummary { elapsedMs: number; matches: number; strategyId: string }
export interface SetupCatalog {
  cards: Record<string, CardDefinition>;
  fixedCardIds: string[];
  variableCardIds: string[];
}

export interface GamePlayerView {
  id: PlayerId;
  hand: CardInstance[];
  played: CardInstance[];
  discardTop: CardInstance | null;
  zoneCounts: { draw: number; hand: number; discard: number; play: number };
  deckCounts: Record<string, number>;
  money: number;
  firstBuyMoney: number;
  firstBuyPending: boolean;
  purchases: string[];
}
export interface FighterView { playerId: PlayerId; position: number; health: number; aimed: boolean; exposed: boolean }
export interface PublicGameEvent { sequence: number; type: GameEventType; playerId: PlayerId; detail: Record<string, unknown> }
export interface BrowserAction { id: string; label: string; text: string }
export interface CardActionChoice extends BrowserAction {
  targetCardInstanceIds: string[];
  destination: number | null;
  intoWall: boolean;
}
export interface CardActionPresentation {
  cardInstanceId: string;
  enabled: boolean;
  reason: string | null;
  selection: 'none' | 'movement' | 'targets';
  eligibleCardInstanceIds: string[];
  minimumTargets: number;
  maximumTargets: number;
  actionId: string | null;
  batchPlayable: boolean;
  choices: CardActionChoice[];
}
export interface PhaseActionPresentation { id: string; kind: 'endAction' | 'endBuy' }
export interface BuyActionPresentation { id: string; definitionId: string }
export interface SelectionActionPresentation extends BrowserAction {
  cardInstanceId: string | null;
  definitionId: string | null;
}
export interface SelectionPresentation {
  kind: 'discard' | 'recover' | 'optionalTrash' | 'gain';
  choices: SelectionActionPresentation[];
}
export interface GameActionPresentation {
  cards: CardActionPresentation[];
  phases: PhaseActionPresentation[];
  buys: BuyActionPresentation[];
  selection: SelectionPresentation | null;
}
export interface PresentationTransfer {
  kind: 'handToPlayed' | 'drawToHand' | 'purchase';
  playerId: PlayerId;
  card: CardInstance;
  hidden: boolean;
}
export interface PresentationState {
  activePlayerId: PlayerId;
  phase: Phase;
  turn: number;
  winner: PlayerId | null;
  fighters: Record<PlayerId, FighterView>;
  range: RangeBand;
  supply: Record<string, number>;
  players: Record<PlayerId, GamePlayerView>;
  trashCount: number;
}
export interface PresentationFrame {
  playerId: PlayerId;
  commandType: string;
  state: PresentationState;
  eventCount: number;
  transfers: PresentationTransfer[];
}
export interface PresentationSequence { frames: PresentationFrame[] }

export interface GameView {
  schemaVersion: 14;
  id: string; revision: number; createdAt: string; updatedAt: string; elapsedSeconds: number;
  completedActions: number; durationSeconds: number | null;
  activePlayerId: PlayerId; selectedFirstPlayerId: PlayerId; phase: Phase; turn: number; winner: PlayerId | null;
  startingDraftEnabled: boolean;
  fighters: Record<PlayerId, FighterView>; range: RangeBand; supply: Record<string, number>;
  cards: Record<string, CardDefinition>; players: Record<PlayerId, GamePlayerView>; trashCount: number;
  events: PublicGameEvent[]; actions: GameActionPresentation;
  canUndo: boolean;
  mode: GameMode; humanPlayerId: PlayerId | null; aiPlayerId: PlayerId | null; aiDifficulty: AiDifficulty | null;
  training: TrainingSummary | null;
  fixedCardIds: string[]; variableCardIds: string[];
  buildProposal: string[]; completedBuilds: Record<PlayerId, string[]> | null;
}
export type GameUpdateView = GameView & { presentation: PresentationSequence };
export interface GameExport { schemaVersion: 14; exportedAt: string; game: GameView }
