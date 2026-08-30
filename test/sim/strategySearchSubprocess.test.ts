import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const kingdomId = 'balance-tuning-005';
const evidenceId = 'a'.repeat(64);
function execute(entry: string, args: string[]) {
  return spawnSync(process.execPath,
    ['--import', 'tsx', 'scripts/strategy_search_subprocess.ts', '--entry', entry,
      '--kingdom', kingdomId, '--', ...args],
    { encoding: 'utf8', timeout: 10_000 });
}

describe('Goldfish validation subprocess', () => {
  it('registers the kingdom before it starts artifact validation', () => {
    const result = execute('validator', ['--stage', 'fixture', '--file', '/not-used',
      '--evidence-id', evidenceId, '--kingdom', kingdomId, '--evidence-root', '/not-used']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not use validation');
    expect(result.stderr).not.toContain('Unknown kingdom');
  });

  it('rejects every entry except the Goldfish validator', () => {
    const result = execute('matrix', []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unknown strategy-search subprocess matrix');
  });

  it('is the post-download validator used by the Goldfish operator', () => {
    const operator = fs.readFileSync('scripts/strategy_search_goldfish_modal.ts', 'utf8');
    const wrapper = fs.readFileSync('scripts/strategy_search_subprocess.ts', 'utf8');
    expect(operator).toContain("'scripts/strategy_search_subprocess.ts', '--entry', 'validator'");
    expect(wrapper).toContain("entry !== 'validator'");
    expect(wrapper).toContain("scripts/strategy_search_validate_artifact.ts");
  });
});
