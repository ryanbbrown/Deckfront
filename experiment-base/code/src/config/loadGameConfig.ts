import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { GameConfigSchema } from './schema';
import type { GameConfig } from '../core/types';

export async function loadGameConfig(path: string): Promise<GameConfig> {
  const rawText = await readFile(path, 'utf8');
  const raw = parse(rawText);
  return GameConfigSchema.parse(raw) as GameConfig;
}
