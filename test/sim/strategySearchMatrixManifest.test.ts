import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function run(kingdomId: string) {
  const missing = path.join(os.tmpdir(), `hexdeck-missing-reservoir-${process.pid}.hgf`);
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/strategy_search_subprocess.ts',
    '--entry', 'matrix-manifest', '--kingdom', kingdomId, '--',
    '--evidence-id', 'a'.repeat(64), '--kingdom', kingdomId, '--reservoir', missing,
    '--reservoir-sha256', 'b'.repeat(64), '--seed-namespace', 'fixture', '--out', `${missing}.json`],
  { encoding: 'utf8' });
}

describe('strategy-search Matrix manifest CLI startup', () => {
  it.each(['balance-tuning-001', 'balance-tuning-005'])(
    'registers %s before the first candidate-space lookup', (kingdomId) => {
      const result = run(kingdomId);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('ENOENT');
      expect(result.stderr).not.toContain('Unknown kingdom');
    });
});
