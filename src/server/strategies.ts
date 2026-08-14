import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { StrategyPreset } from '../shared/api';

export async function loadStrategyPresets(directory: string): Promise<StrategyPreset[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith('.md')).sort();
  return Promise.all(files.map(async (file) => {
    const markdown = await readFile(path.join(directory, file), 'utf8');
    const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return {
      id: file.slice(0, -3),
      name: heading || file.slice(0, -3),
      markdown
    };
  }));
}
