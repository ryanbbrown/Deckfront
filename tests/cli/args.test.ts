import { describe, expect, it } from 'vitest';
import { parseArgs, runCli } from '../../src/cli/main';

describe('CLI args', () => {
  it('parses help and normal arguments', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['--config', 'game.yaml', '--seed', '12', '--script', 'script.txt', '--state', 'state.json', '--max-actions', '3'])).toEqual({
      config: 'game.yaml',
      seed: 12,
      script: 'script.txt',
      state: 'state.json',
      maxActions: 3,
      help: false
    });
  });

  it('rejects missing values, bad seeds, and unknown flags', () => {
    expect(() => parseArgs(['--config'])).toThrow('Missing value for --config');
    expect(() => parseArgs(['--seed', 'abc'])).toThrow('--seed must be an integer');
    expect(() => parseArgs(['--seed', '12abc'])).toThrow('--seed must be an integer');
    expect(() => parseArgs(['--seed', '1.5'])).toThrow('--seed must be an integer');
    expect(() => parseArgs(['--max-actions', '-1'])).toThrow('--max-actions must be a non-negative integer');
    expect(() => parseArgs(['--max-actions', 'one'])).toThrow('--max-actions must be a non-negative integer');
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown argument');
  });

  it('prints help text through the CLI entrypoint', async () => {
    const output: string[] = [];

    await expect(runCli(['--help'], (line) => output.push(line))).rejects.toThrow();
    expect(output.join('\n')).toContain('Usage: bun run src/cli/main.ts');
  });

  it('rejects missing required config when not showing help', async () => {
    await expect(runCli([], () => undefined)).rejects.toThrow('Missing required --config path');
  });
});
