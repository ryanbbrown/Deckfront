import type { GameCommand, GameState, PlayerId } from '../game/types';
import type { DraftRecord } from '../shared/api';

export interface GameRecord {
  schemaVersion: 2;
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  completedActions: number;
  durationSeconds: number | null;
  humanPlayerId: PlayerId;
  aiPlayerId: PlayerId;
  strategy: { presetId: string; markdown: string };
  aiRuntime: { model: string; effort: string };
  aiActions: Array<{
    committedRevision: number;
    round: number;
    actionStep: number;
    actionId: string;
    summary: string;
    durationSeconds: number;
  }>;
  initialState: GameState;
  committedCommands: GameCommand[];
  committedState: GameState;
  draft: DraftRecord;
  state: GameState;
}

export interface GameRepository {
  create(record: GameRecord): Promise<void>;
  load(id: string): Promise<GameRecord>;
  save(record: GameRecord): Promise<void>;
  withLock<T>(id: string, work: () => Promise<T>): Promise<T>;
}
