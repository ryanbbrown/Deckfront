import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertInvariants } from '../game/invariants';
import { registerKingdom } from '../game/kingdom';
import { kingdomSchema } from '../game/schema';
import { AI_DIFFICULTIES } from '../shared/api';
import type { GameStatistics } from '../shared/api';
import { gameRecordSchema, gameStatisticsMetadataSchema } from './schemas';
import type { GameRecord, GameRepository, GameStatisticsRepository } from './types';

export class GameNotFoundError extends Error {}
export class UnsupportedSchemaError extends Error {}
const GAME_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

export class FileGameRepository implements GameRepository, GameStatisticsRepository {
  private readonly locks = new Map<string, Promise<void>>();
  constructor(private readonly dataDirectory: string) {}
  async create(record: GameRecord): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    try { await readFile(this.pathFor(record.id), 'utf8'); throw new Error(`Game already exists: ${record.id}`); }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
    await this.save(record);
  }
  async load(id: string): Promise<GameRecord> {
    try {
      const raw = JSON.parse(await readFile(this.pathFor(id), 'utf8')) as { schemaVersion?: unknown; kingdom?: unknown };
      if (raw.schemaVersion !== 16) throw new UnsupportedSchemaError(`Saved game schema ${String(raw.schemaVersion)} is not supported. Start a new game.`);
      registerKingdom(kingdomSchema.parse(raw.kingdom));
      const record = gameRecordSchema.parse(raw) as GameRecord; assertInvariants(record.state); return record;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new GameNotFoundError(`Game not found: ${id}`);
      throw error;
    }
  }
  async save(record: GameRecord): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true }); registerKingdom(record.kingdom); gameRecordSchema.parse(record); assertInvariants(record.state);
    const target = this.pathFor(record.id); const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); await rename(temporary, target);
  }
  async statistics(): Promise<GameStatistics> {
    const latestBySeries = new Map<string, ReturnType<typeof gameStatisticsMetadataSchema.parse>>();
    const entries = await readdir(this.dataDirectory, { withFileTypes: true }).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isFile() || !GAME_FILE_NAME.test(entry.name)) continue;
      const raw = JSON.parse(await readFile(path.join(this.dataDirectory, entry.name), 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw) || raw.schemaVersion !== 16) continue;
      const parsed = gameStatisticsMetadataSchema.safeParse(raw);
      if (!parsed.success) throw new Error('Malformed schema 16 game statistics metadata.', { cause: parsed.error });
      const record = parsed.data;
      if (`${record.id}.json`.toLowerCase() !== entry.name.toLowerCase()) throw new Error('Saved game id does not match its filename.');
      const latest = latestBySeries.get(record.seriesId);
      if (!latest || record.attemptNumber > latest.attemptNumber) latestBySeries.set(record.seriesId, record);
      else if (record.attemptNumber === latest.attemptNumber) throw new Error(`Game series ${record.seriesId} has duplicate attempt ${record.attemptNumber}.`);
    }
    const difficulties = AI_DIFFICULTIES.map((difficulty) => ({ difficulty, gamesPlayed: 0, humanWins: 0, aiWins: 0 }));
    const byDifficulty = new Map(difficulties.map((entry) => [entry.difficulty, entry]));
    for (const record of latestBySeries.values()) {
      if (record.mode !== 'ai' || !record.finishedAt || !record.state.winner || !record.aiDifficulty || !record.humanPlayerId) continue;
      const result = byDifficulty.get(record.aiDifficulty)!;
      result.gamesPlayed += 1;
      if (record.state.winner === record.humanPlayerId) result.humanWins += 1;
      else result.aiWins += 1;
    }
    return { difficulties };
  }
  async withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve(); let release = (): void => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; }); const queued = previous.then(() => current);
    this.locks.set(id, queued); await previous;
    try { return await work(); } finally { release(); if (this.locks.get(id) === queued) this.locks.delete(id); }
  }
  private pathFor(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new GameNotFoundError(`Invalid game id: ${id}`);
    return path.join(this.dataDirectory, `${id}.json`);
  }
}
