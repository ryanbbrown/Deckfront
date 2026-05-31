import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';

describe('single-player integration', () => {
  it('stops when the configured end-game expression becomes true', async () => {
    const output: string[] = [];

    const state = await runCli(
      ['--config', 'tests/fixtures/single-player.yaml', '--script', 'tests/fixtures/single-player.script', '--seed', '7'],
      (line) => output.push(line)
    );

    expect(state.ended).toBe(true);
    expect(state.supply.estate).toBe(0);
    expect(output.at(-1)).toContain('Game over');
  });
});
