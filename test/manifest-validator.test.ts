import { describe, expect, it } from 'vitest';
import {
  requiredAiFlows, requiredBrowserFlows, requiredCards, validateManifest, type CoverageManifest
} from '../scripts/validate_e2e_manifest';

function completeManifest(id: string): CoverageManifest {
  return {
    cards: Object.fromEntries(requiredCards.map((key) => [key, [id]])),
    browserFlows: Object.fromEntries(requiredBrowserFlows.map((key) => [key, [id]])),
    aiFlows: Object.fromEntries(requiredAiFlows.map((key) => [key, [id]]))
  };
}

describe('current E2E coverage manifest gate', () => {
  it('accepts only exact discovered IDs for every required mapping', () => {
    expect(validateManifest(completeManifest('pw:EXACT'), new Set(['pw:EXACT']))).toEqual({ mappings: 44, tests: 1 });
  });

  it('rejects a missing required flow, stale test ID, and obsolete mapping', () => {
    const manifest = completeManifest('pw:EXACT');
    delete manifest.browserFlows.passFinal;
    manifest.aiFlows.oneActionOnly = ['vitest:renamed'];
    manifest.browserFlows.completeTurn = ['pw:EXACT'];
    expect(() => validateManifest(manifest, new Set(['pw:EXACT']))).toThrow([
      'browserFlows.passFinal has no mapped test.',
      'browserFlows.completeTurn is not a current required mapping.',
      'aiFlows.oneActionOnly: vitest:renamed is not an exact discovered test ID.'
    ].join('\n'));
  });
});
