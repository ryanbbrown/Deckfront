import type {
  CardDefinition, CardInstance, Coordinate, GameCommand, GameEvent, LegalAction,
  Phase, PieceId, PlayerId, TemporaryBlock
} from '../game/types';

export interface StrategyPreset {
  id: string;
  name: string;
  markdown: string;
}

export interface SafePiece {
  id: PieceId;
  ownerId: PlayerId;
  position: Coordinate | null;
  needsRespawn: boolean;
  baselineMoves: number;
  braced: boolean;
  pinned: boolean;
}

export interface SafePlayer {
  id: PlayerId;
  hand: CardInstance[] | null;
  zoneCounts: { draw: number; hand: number; discard: number; play: number };
  money: number;
  buys: number;
  turnsTaken: number;
}

export interface SafeGameView {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  elapsedSeconds: number;
  completedTurns: number;
  durationSeconds: number | null;
  humanPlayerId: PlayerId;
  aiPlayerId: PlayerId;
  activePlayerId: PlayerId;
  phase: Phase;
  scores: Record<PlayerId, number>;
  winner: PlayerId | null;
  pieces: Record<PieceId, SafePiece>;
  blocks: TemporaryBlock[];
  supply: Record<string, number>;
  cards: Record<string, CardDefinition>;
  players: Record<PlayerId, SafePlayer>;
  trashCount: number;
  turnActionLimits: {
    actionUses: Array<{ pieceId: PieceId; definitionId: string }>;
    relayUsed: boolean;
  };
  events: GameEvent[];
  draftEventStart: number;
  legalActions: LegalAction[];
  canUndo: boolean;
  strategy: { presetId: string; markdown: string };
  aiRuntime: { model: string; effort: string };
  lastAiSummary: string | null;
}

export interface AiTurnStatus {
  status: 'idle' | 'running' | 'complete' | 'error';
  game?: SafeGameView | undefined;
  error?: string | undefined;
}

export interface RedactedExport {
  schemaVersion: 1;
  exportedAt: string;
  game: SafeGameView;
}

export interface DraftRecord {
  baseVersion: number;
  baseState: import('../game/types').GameState;
  commands: GameCommand[];
}
