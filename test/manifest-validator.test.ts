import { describe, expect, it } from 'vitest';
import { validateManifest } from '../scripts/validate_e2e_manifest';
import type { CoverageManifest, DiscoveredTest } from '../scripts/validate_e2e_manifest';

describe('browser coverage manifest validation', () => {
  it('accepts an exact discovered non-skipped test ID', () => {
    expect(validateManifest(manifest('REAL-ID'), [discovered('REAL-ID')], ['shared'])).toEqual({
      rowCount: 1,
      testCount: 1
    });
  });

  it('rejects an ID that exists only in a source comment', () => {
    expect(() => validateManifest(manifest('COMMENT-ONLY'), [], ['shared']))
      .toThrow('COMMENT-ONLY does not exactly name a discovered browser test');
  });

  it('rejects a substring of a discovered test ID', () => {
    expect(() => validateManifest(manifest('REAL'), [discovered('REAL-ID')], ['shared']))
      .toThrow('REAL does not exactly name a discovered browser test');
  });

  it('rejects a missing test ID', () => {
    expect(() => validateManifest(manifest('MISSING'), [discovered('OTHER-ID')], ['shared']))
      .toThrow('MISSING does not exactly name a discovered browser test');
  });

  it('rejects a renamed test ID', () => {
    expect(() => validateManifest(manifest('OLD-ID'), [discovered('NEW-ID')], ['shared']))
      .toThrow('OLD-ID does not exactly name a discovered browser test');
  });

  it('rejects a skipped test ID', () => {
    expect(() => validateManifest(manifest('SKIPPED-ID'), [discovered('SKIPPED-ID', 'skipped')], ['shared']))
      .toThrow('SKIPPED-ID names a skipped browser test');
  });
});

function manifest(testId: string): CoverageManifest {
  return { shared: [{ rule: 'Direct browser behavior.', tests: [testId] }] };
}

function discovered(id: string, expectedStatus = 'passed'): DiscoveredTest {
  return { id, title: `${id}: direct browser behavior`, expectedStatus, file: 'fixture.spec.ts' };
}
