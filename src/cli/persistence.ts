import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GameState } from '../core/types';

export interface PersistedGame {
  schemaVersion: 1;
  rngState: number;
  game: GameState;
}

export async function stateFileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

export async function loadPersistedGame(path: string): Promise<PersistedGame> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!isPersistedGame(raw)) {
    throw new Error(`Invalid persisted game state: ${path}`);
  }
  return raw;
}

export async function savePersistedGame(path: string, persisted: PersistedGame): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`);
}

function isPersistedGame(value: unknown): value is PersistedGame {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PersistedGame>;
  return candidate.schemaVersion === 1 && Number.isInteger(candidate.rngState) && Boolean(candidate.game);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
