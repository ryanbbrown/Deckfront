import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';

describe('multi-player CLI integration', () => {
  it('renders player alternation and final winner in scripted mode', async () => {
    const output: string[] = [];

    await runCli(['--config', 'tests/fixtures/multi-player.yaml', '--script', 'tests/fixtures/multi-player.script', '--seed', '1'], (line) =>
      output.push(line)
    );

    const transcript = output.join('\n---\n');
    expect(transcript).toContain('Active: P1');
    expect(transcript).toContain('Active: P2');
    expect(transcript).toContain('Winner: P2');
  });
});
