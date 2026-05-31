import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';

describe('scripted CLI session', () => {
  it('runs a deterministic single-player transcript', async () => {
    const output: string[] = [];

    await runCli(['--config', 'tests/fixtures/single-player.yaml', '--script', 'tests/fixtures/single-player.script', '--seed', '1'], (line) =>
      output.push(line)
    );

    expect(output.join('\n---\n')).toContain('Active: P1');
    expect(output.join('\n---\n')).toContain('1. Move to buy phase');
    expect(output.join('\n---\n')).toContain('Winner: P1');
  });
});
