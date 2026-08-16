import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertInvariants } from '../game/invariants';
import { gameRecordSchema } from './schemas';
import type { GameRecord, GameRepository } from './types';

export class GameNotFoundError extends Error {}
export class UnsupportedSchemaError extends Error {}
export class FileGameRepository implements GameRepository {
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
      const raw = JSON.parse(await readFile(this.pathFor(id), 'utf8')) as { schemaVersion?: unknown };
      if (raw.schemaVersion !== 5) throw new UnsupportedSchemaError(`Saved game schema ${String(raw.schemaVersion)} is not supported. Start a new game.`);
      const record = gameRecordSchema.parse(raw) as GameRecord; assertInvariants(record.state); return record;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new GameNotFoundError(`Game not found: ${id}`);
      throw error;
    }
  }
  async save(record: GameRecord): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true }); gameRecordSchema.parse(record); assertInvariants(record.state);
    const target = this.pathFor(record.id); const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); await rename(temporary, target);
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
