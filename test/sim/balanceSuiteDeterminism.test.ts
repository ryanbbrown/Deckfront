import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderKingdomSuiteDesignReport } from '../../scripts/generate_kingdom_suite_design_report';
import { BALANCE_SUITE_MANIFEST } from '../../src/sim/balanceSuite';
import {
  generateBalanceSuiteCoveringSearchInput, generateBalanceSuiteManifest, serializeBalanceSuiteManifest
} from '../../src/sim/balanceSuiteDesign';

describe('balance-suite fresh-process determinism', () => {
  it('pins the executable covering-search input, implementation, and stages', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const source = JSON.parse(fs.readFileSync(path.join(root,
      'src/sim/balance-suite-covering-design-v2.json'), 'utf8')) as {
      search: { initialConstruction: { inputDigest: string }; implementation: string;
        implementationDigest: string; stages: unknown[] };
    };
    expect(createHash('sha256').update(generateBalanceSuiteCoveringSearchInput()).digest('hex'))
      .toBe(source.search.initialConstruction.inputDigest);
    expect(createHash('sha256').update(fs.readFileSync(path.join(root, source.search.implementation))).digest('hex'))
      .toBe(source.search.implementationDigest);
    expect(source.search.stages).toEqual([
      { name: 'validation', attempts: 10_000_000, seed: 11_111, mode: 'validation' },
      { name: 'tuning', attempts: 15_000_000, seed: 22_222, mode: 'tuning' }
    ]);
  }, 120_000);

  it('regenerates the manifest byte for byte in this and a fresh process', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const expected = fs.readFileSync(path.join(root, 'src/sim/balance-suite-manifest.json'), 'utf8');
    expect(serializeBalanceSuiteManifest(generateBalanceSuiteManifest())).toBe(expected);
    const child = spawnSync(process.execPath,
      ['--import', 'tsx', 'scripts/generate_balance_suite_manifest.ts', '--check'],
      { cwd: root, encoding: 'utf8', timeout: 180_000 });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain('Verified');
  }, 240_000);

  it('matches the committed design report in a fresh process', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const committed = fs.readFileSync(path.join(root, '.html', 'kingdom-suite-design.html'), 'utf8');
    expect(renderKingdomSuiteDesignReport(BALANCE_SUITE_MANIFEST)).toBe(committed);
    const child = spawnSync(process.execPath,
      ['--import', 'tsx', 'scripts/generate_kingdom_suite_design_report.ts', '--check'],
      { cwd: root, encoding: 'utf8', timeout: 120_000 });
    expect(child.status, child.stderr).toBe(0);
  });
});
