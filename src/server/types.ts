import type { GameCommand, GameState, Kingdom, PlayerId } from '../game/types';
import type { AiDifficulty, GameMode, TrainingSummary } from '../shared/api';
import type { Strategy } from '../sim/strategy';

export interface UndoHistoryEntry {
  committedCommandCount: number;
  completedActions: number;
  finishedAt: string | null;
  durationSeconds: number | null;
}
export interface GameRecord {
  schemaVersion: 14;
  id: string; revision: number; createdAt: string; updatedAt: string; finishedAt: string | null;
  completedActions: number; durationSeconds: number | null;
  buildProposal: string[];
  kingdom: Kingdom; startingDraftEnabled: boolean; mode: GameMode; humanPlayerId: PlayerId | null; aiDifficulty: AiDifficulty | null;
  aiStrategy: Strategy | null; training: TrainingSummary | null;
  initialState: GameState; committedCommands: GameCommand[];
  undoHistory: UndoHistoryEntry[]; state: GameState;
}
export interface GameRepository {
  create(record: GameRecord): Promise<void>; load(id: string): Promise<GameRecord>; save(record: GameRecord): Promise<void>;
  withLock<T>(id: string, work: () => Promise<T>): Promise<T>;
}
