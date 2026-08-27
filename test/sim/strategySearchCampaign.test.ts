import { describe, expect, it } from 'vitest';
import {
  deriveLaunchAuthorizationToken, deriveSourceImageIdentity, deriveStrategySearch, parseStrategySearchRequest,
  validateLaunchAuthorizationToken, verifySourceImageFiles
} from '../../src/sim/strategySearchCampaign';
import { strategySearchKingdoms } from '../../src/sim/strategySearchKingdoms';

function source() { return deriveSourceImageIdentity({ expectedPaths: ['a', 'b'], files: [
  { path: 'b', content: 'two' }, { path: 'a', content: 'one' }
] }); }
describe('strategy-search request and semantic identity', () => {
  it('accepts only the strict two-field request', () => {
    expect(parseStrategySearchRequest({ kingdomIds: ['deep-beam-tuning-007'], maxActiveCpus: 400 }))
      .toEqual({ kingdomIds: ['deep-beam-tuning-007'], maxActiveCpus: 400 });
    for (const value of [{ kingdomIds: [], maxActiveCpus: 400 },
      { kingdomIds: ['deep-beam-tuning-007', 'deep-beam-tuning-007'], maxActiveCpus: 400 },
      { kingdomIds: ['unknown'], maxActiveCpus: 400 }, { kingdomIds: ['deep-beam-tuning-007'] },
      { kingdomIds: ['deep-beam-tuning-007'], maxActiveCpus: 3 },
      { kingdomIds: ['deep-beam-tuning-007'], maxActiveCpus: 400, extra: true }]) {
      expect(() => parseStrategySearchRequest(value)).toThrow();
    }
  });

  it('derives the exact candidate contract for every registered kingdom', () => {
    for (const kingdom of strategySearchKingdoms) {
      const parsed = deriveStrategySearch({ request: { kingdomIds: [kingdom.id], maxActiveCpus: 400 },
        sourceImage: source() });
      expect(parsed.kingdoms[0]).toMatchObject({ kingdomId: kingdom.id,
        orderedProduct: { candidateCount: 12_972_960, seeds: [4_100_000, 4_100_001, 4_100_002, 4_100_003] } });
      expect(parsed.kingdoms[0]!.evidenceId).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('keeps kingdom evidence stable across capacity and campaign-list changes', () => {
    const one = deriveStrategySearch({ request: { kingdomIds: ['deep-beam-tuning-007'], maxActiveCpus: 400 },
      sourceImage: source() });
    const capacity = deriveStrategySearch({ request: { kingdomIds: ['deep-beam-tuning-007'], maxActiveCpus: 800 },
      sourceImage: source() });
    const superset = deriveStrategySearch({ request: { kingdomIds: ['deep-beam-tuning-002',
      'deep-beam-tuning-007'], maxActiveCpus: 400 }, sourceImage: source() });
    expect(capacity.kingdoms[0]!.evidenceId).toBe(one.kingdoms[0]!.evidenceId);
    expect(superset.kingdoms[1]!.evidenceId).toBe(one.kingdoms[0]!.evidenceId);
    expect(capacity.campaignExecutionId).toBe(one.campaignExecutionId);
    expect(superset.campaignExecutionId).not.toBe(one.campaignExecutionId);
    expect(capacity.authorizationToken).not.toBe(one.authorizationToken);
    expect(validateLaunchAuthorizationToken(one.authorizationToken, one)).toBe(true);
    expect(validateLaunchAuthorizationToken(one.authorizationToken, capacity)).toBe(false);
    expect(() => deriveLaunchAuthorizationToken({ request: one.request, sourceDigest: source().digest,
      orderedEvidenceIds: [] })).toThrow();
  });

  it('uses one exact fail-closed executable image allowlist', () => {
    const identity = source();
    expect(identity.files.map((entry) => entry.path)).toEqual(['a', 'b']);
    expect(verifySourceImageFiles(identity, [{ path: 'a', content: 'one' }, { path: 'b', content: 'two' }])).toBe(true);
    expect(verifySourceImageFiles(identity, [{ path: 'a', content: 'changed' }, { path: 'b', content: 'two' }])).toBe(false);
    expect(() => deriveSourceImageIdentity({ expectedPaths: ['a'], files: [{ path: 'a', content: 'one' },
      { path: 'b', content: 'two' }] })).toThrow('allowlist');
    expect(() => deriveSourceImageIdentity({ files: [{ path: 'a', content: 'one' }],
      dirtyExecutablePaths: ['a'] })).toThrow('dirty');
  });
});
