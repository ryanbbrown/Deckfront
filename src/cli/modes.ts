import { readFile } from 'node:fs/promises';

export interface InputAdapter {
  nextChoice(): Promise<number>;
}

export class InteractiveInputAdapter implements InputAdapter {
  async nextChoice(): Promise<number> {
    const input = prompt('Choice: ');
    return parseIntegerChoice(input ?? '');
  }
}

export class ScriptedInputAdapter implements InputAdapter {
  private index = 0;

  constructor(private readonly choices: number[]) {}

  async nextChoice(): Promise<number> {
    const choice = this.choices[this.index];
    this.index += 1;
    if (choice === undefined) {
      throw new Error('Script ended before the game did');
    }
    return choice;
  }
}

export async function scriptedInputFromFile(path: string): Promise<ScriptedInputAdapter> {
  const content = await readFile(path, 'utf8');
  const choices = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(parseIntegerChoice);
  return new ScriptedInputAdapter(choices);
}

export function parseIntegerChoice(raw: string): number {
  return /^-?\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
}
