import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStrategySearchContext } from '../../src/sim/strategySearchContext';
import { createStrategySearchMatrixManifest } from '../../src/sim/strategySearchMatrix';

const kingdomId = 'balance-tuning-005', evidenceId = 'a'.repeat(64);
const entrypoints = [
  'scripts/strategy_search_goldfish.ts',
  'scripts/strategy_search_campaign_matrix_manifest.ts',
  'scripts/strategy_search_campaign_matrix.ts',
  'scripts/strategy_search_campaign_psro.ts',
  'scripts/strategy_search_validate_artifact.ts'
] as const;
const execute = (entrypoint: string, args: string[]) => spawnSync(process.execPath,
  ['--import', 'tsx', entrypoint, ...args], { encoding: 'utf8', timeout: 10_000 });

describe('detached strategy-search campaign context', () => {
  it('starts Goldfish normally with an authoritative balance kingdom', () => {
    const result = execute(entrypoints[0], ['readiness', '--evidence-id', evidenceId, '--kingdom', kingdomId]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ready: true, kingdomId, candidateCount: 12_972_960 });
  });

  it('starts Matrix-manifest normally past context construction', () => {
    const result = execute(entrypoints[1], ['--evidence-id', evidenceId, '--kingdom', kingdomId,
      '--reservoir', '/missing/reservoir.hgf', '--reservoir-sha256', 'b'.repeat(64),
      '--seed-namespace', 'fixture', '--out', '/missing/manifest.json']);
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('ENOENT');
    expect(result.stderr).not.toContain('Unknown kingdom');
  });

  it('starts Matrix normally through manifest validation and context construction', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-matrix-context-'));
    try {
      const context = createStrategySearchContext(kingdomId);
      const manifest = createStrategySearchMatrixManifest({ source: { kingdomId, evidenceId,
        reservoirIdentityHash: 'b'.repeat(64), reservoirContentHash: 'c'.repeat(64),
        matrixSeedNamespace: 'fixture' }, strategies: Array.from({ length: 50 }, (_unused, index) =>
        context.strategyAt(index)) });
      const file = path.join(root, 'manifest.json'); fs.writeFileSync(file, JSON.stringify(manifest));
      const result = execute(entrypoints[2], ['--manifest', file, '--out', path.join(root, 'out'),
        '--control', path.join(root, 'control'), '--workers', '1', '--jobs-per-batch', '1',
        '--runtime-chunk-size', '125', '--shutdown-at-ms', '1']);
      expect(result.status).not.toBe(0); expect(result.stderr).toContain('Matrix execution input is invalid.');
      expect(result.stderr).not.toContain('Unknown kingdom');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('starts PSRO normally through config validation and context construction', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-context-'));
    try {
      const config = { evidenceId, kingdomId, runId: 'fixture', reservoirPath: path.join(root, 'missing.hgf'),
        reservoirSha256: 'b'.repeat(64), matrixEvidencePath: path.join(root, 'missing.json'),
        matrixSha256: 'c'.repeat(64), outputRoot: path.join(root, 'out'), controlRoot: path.join(root, 'control'),
        workers: 1, protocolInput: {} };
      const file = path.join(root, 'config.json'); fs.writeFileSync(file, JSON.stringify(config));
      const result = execute(entrypoints[3], ['--config', file, '--shutdown-at-ms', String(Date.now() + 10_000)]);
      expect(result.status).not.toBe(0); expect(result.stderr).toContain('ENOENT');
      expect(result.stderr).not.toContain('Unknown kingdom');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('starts artifact validation normally through context construction', () => {
    const result = execute(entrypoints[4], ['--stage', 'fixture', '--file', '/not-used',
      '--evidence-id', evidenceId, '--kingdom', kingdomId, '--evidence-root', '/not-used']);
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('does not use validation');
    expect(result.stderr).not.toContain('Unknown kingdom');
  });

  it.each(entrypoints)('%s cannot bypass the campaign context seam', (entrypoint) => {
    const source = fs.readFileSync(entrypoint, 'utf8');
    expect(source).toContain('createStrategySearchContext');
    for (const forbidden of ['orderedGoldfishCardIds', 'createOrderedCandidateSpace',
      'candidateIndexAt', 'strategySearchKingdom(', 'kingdomOf(', 'kingdomFacts(']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
