import type { GameCommand, GameState } from '../game/types';

export interface UndoCheckpoint {
  committedCommandCount: number;
  completedActions: number;
  finishedAt: string | null;
  durationSeconds: number | null;
}
export interface GameRecord {
  schemaVersion: 9;
  id: string; revision: number; createdAt: string; updatedAt: string; finishedAt: string | null;
  completedActions: number; durationSeconds: number | null;
  buildProposal: string[];
  initialState: GameState; committedCommands: GameCommand[];
  undoCheckpoint: UndoCheckpoint | null; state: GameState;
}
export interface GameRepository {
  create(record: GameRecord): Promise<void>; load(id: string): Promise<GameRecord>; save(record: GameRecord): Promise<void>;
  withLock<T>(id: string, work: () => Promise<T>): Promise<T>;
}
