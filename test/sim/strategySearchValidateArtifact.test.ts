import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const K007_EVIDENCE_ID = 'd2e1daef8244113e1cad27458a49855cd2a28aa90414367b5c1ac7587bc68d69';

describe('strategy-search artifact CLI validation', () => {
  it('resolves an authoritative balance-suite kingdom before artifact validation', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx',
      'scripts/strategy_search_validate_artifact.ts', '--stage', 'fixture', '--file', '/not-used',
      '--evidence-id', 'a'.repeat(64), '--kingdom', 'balance-tuning-005', '--evidence-root', '/not-used'],
    { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Artifact stage fixture does not use validation.');
    expect(result.stderr).not.toContain('Unknown');
  });

  it('validates the exact K007 schema-4 top-500000 reducer artifact', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-k007-artifact-'));
    try {
      const artifact = path.join(root, 'top-500000.hgf');
      fs.writeFileSync(artifact, gunzipSync(fs.readFileSync(
        'test/fixtures/k007-schema4-top-500000.hgf.gz')));
      const output = execFileSync(process.execPath, ['--import', 'tsx',
        'scripts/strategy_search_validate_artifact.ts', '--stage', 'goldfish-one-reduce',
        '--file', artifact, '--evidence-id', K007_EVIDENCE_ID,
        '--kingdom', 'deep-beam-tuning-007', '--evidence-root', root],
      { encoding: 'utf8', timeout: 60_000 });
      expect(JSON.parse(output)).toEqual({ valid: true, stage: 'goldfish-one-reduce',
        evidenceId: K007_EVIDENCE_ID });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 70_000);
});
