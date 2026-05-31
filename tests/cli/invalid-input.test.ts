import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';

describe('scripted CLI invalid input', () => {
  it('reports invalid choices and retries without changing state', async () => {
    const output: string[] = [];

    await runCli(['--config', 'tests/fixtures/single-player.yaml', '--script', 'tests/fixtures/invalid-then-valid.script', '--seed', '1'], (line) =>
      output.push(line)
    );

    expect(output).toContain('Invalid choice: 99');
    expect(output.join('\n')).toContain('Winner: P1');
  });

  it('rejects partially numeric scripted choices', async () => {
    const output: string[] = [];

    await runCli(['--config', 'tests/fixtures/single-player.yaml', '--script', 'tests/fixtures/partial-numeric.script', '--seed', '1'], (line) =>
      output.push(line)
    );

    expect(output).toContain('Invalid choice: NaN');
    expect(output.join('\n')).toContain('Winner: P1');
  });
});
