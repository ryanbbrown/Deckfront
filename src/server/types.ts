import type { GameCommand, GameState, Phase, PlayerId } from '../game/types';
import type { OpponentMode } from '../shared/api';

export interface UndoCheckpoint {
  state: GameState;
  committedState: GameState;
  committedCommandCount: number;
  completedActions: number;
  finishedAt: string | null;
  durationSeconds: number | null;
}
export interface GameRecord {
  schemaVersion: 5;
  id: string; revision: number; createdAt: string; updatedAt: string; finishedAt: string | null;
  completedActions: number; durationSeconds: number | null; humanPlayerId: PlayerId; aiPlayerId: PlayerId;
  opponentMode: OpponentMode;
  strategy: { presetId: string; markdown: string }; aiRuntime: { model: string; effort: string };
  humanBuildProposal: string[];
  aiActions: Array<{
    committedRevision: number; turn: number; phase: Phase; decisionIndex: number;
    actionId: string; summary: string; durationSeconds: number; fallback?: boolean;
  }>;
  initialState: GameState; committedCommands: GameCommand[]; committedState: GameState;
  undoCheckpoint: UndoCheckpoint | null; state: GameState;
}
export interface GameRepository {
  create(record: GameRecord): Promise<void>; load(id: string): Promise<GameRecord>; save(record: GameRecord): Promise<void>;
  withLock<T>(id: string, work: () => Promise<T>): Promise<T>;
}
