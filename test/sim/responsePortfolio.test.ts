import { afterEach, describe, expect, it } from 'vitest';
import { kingdomOf, resetKingdoms } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import {
  deriveResponseCardRoles, proposeResponsePortfolio, responseDamageCores, responsePortfolioAllocation
} from '../../src/sim/responsePortfolio';
import { stoplessRandomDomain } from '../../src/sim/randomPsro';
import { INFINITE_COUNT, canonicalStrategy } from '../../src/sim/strategy';

afterEach(() => resetKingdoms());

function kingdom009() {
  deepBeamSuite.register();
  return kingdomOf('deep-beam-tuning-009');
}

describe('semantic response proposal portfolio', () => {
  it('derives reusable roles and hard discard-fodder requirements from mechanics', () => {
    const roles = deriveResponseCardRoles(kingdom009());
    expect(roles.damage).toEqual(expect.arrayContaining(['improvise', 'longshot', 'precisionShot', 'salvageShot', 'strike']));
    expect(roles.mana).toContain('channel');
    expect(roles.movement).toContain('step');
    expect(roles.drawFilter).toEqual(expect.arrayContaining(['channel', 'reclaim', 'sharpen']));
    expect(roles.trashing).toEqual(expect.arrayContaining(['reforge', 'scour', 'sharpen']));
    expect(roles.economy).toEqual(expect.arrayContaining(['silver', 'gold']));
    expect(roles.cards.salvageShot).toMatchObject({ damage: true, requiredFodderFamily: 'ranged' });
  });

  it('covers every one-card and two-card damage core before repeating the portfolio', () => {
    const kingdom = kingdom009();
    const roles = deriveResponseCardRoles(kingdom);
    const cores = responseDamageCores(roles);
    const result = proposeResponsePortfolio({ kingdom, seed: 35_001, count: 100, excludedCanonical: new Set() });
    expect(cores).toHaveLength(15);
    expect(cores).toContainEqual(expect.objectContaining({
      cardIds: ['longshot', 'precisionShot'], familyShape: 'pure'
    }));
    expect(result.diagnostics.recipeCoverage.coveredCoreIds)
      .toEqual(result.diagnostics.recipeCoverage.availableCoreIds);
    expect(Object.values(result.diagnostics.recipeCoverage.recipesByCore).every((count) => count > 0)).toBe(true);
  });

  it('makes semantic recipes legal, damaging, enabled, useful, and free of cumulative no-ops', () => {
    deepBeamSuite.register();
    const kingdom = kingdomOf('deep-beam-tuning-001');
    const roles = deriveResponseCardRoles(kingdom);
    const domain = stoplessRandomDomain(kingdom.id);
    const result = proposeResponsePortfolio({ kingdom, seed: 91, count: 300, excludedCanonical: new Set() });
    const semantic = result.policies.filter((_policy, index) => result.sources[index] === 'semantic');
    for (const policy of semantic) {
      domain.decode(policy);
      const active = policy.buyPlan.filter((slot) => slot.kind !== 'inactive');
      const cards = active.flatMap((slot) => slot.kind === 'buy' ? [slot.cardId] : []);
      expect(cards.some((cardId) => roles.damage.includes(cardId))).toBe(true);
      expect(active.at(-1)).toMatchObject({ kind: 'buy', desiredCount: INFINITE_COUNT });
      const fallback = active.at(-1)!;
      if (fallback.kind === 'buy') {
        const role = roles.cards[fallback.cardId]!;
        expect(role.damage || role.drawFilter || role.economy).toBe(true);
      }
      expect(active.slice(0, -1).every((slot) => slot.kind === 'buy'
        && slot.desiredCount >= 1 && slot.desiredCount <= 5)).toBe(true);
      for (let index = 1; index < active.length; index += 1) {
        const previous = active[index - 1]!, current = active[index]!;
        expect(previous.kind === 'buy' && current.kind === 'buy' && previous.cardId === current.cardId).toBe(false);
      }
      if (cards.includes('arcBolt') || cards.includes('cascade') || cards.includes('fireball') || cards.includes('starfire')) {
        expect(cards.some((cardId) => roles.mana.includes(cardId))).toBe(true);
      }
    }
    expect(new Set(result.policies.map(canonicalStrategy)).size).toBe(result.policies.length);
  });

  it('uses exact source allocation and canonical meaningful local policies', () => {
    const kingdom = kingdom009();
    const seed = proposeResponsePortfolio({ kingdom, seed: 3, count: 20, excludedCanonical: new Set() });
    const excluded = new Set(seed.policies.map(canonicalStrategy));
    const result = proposeResponsePortfolio({ kingdom, seed: 4, count: 20_000,
      excludedCanonical: excluded, parents: seed.policies });
    expect(responsePortfolioAllocation(20_000, true)).toEqual({ semantic: 12_000, local: 5_000, unrestricted: 3_000 });
    expect(result.diagnostics.sourceCounts).toEqual({ semantic: 12_000, local: 5_000, unrestricted: 3_000 });
    expect(result.diagnostics.parentCount).toBe(20);
    const domain = stoplessRandomDomain(kingdom.id);
    const local = result.policies.filter((_policy, index) => result.sources[index] === 'local');
    expect(local).toHaveLength(5_000);
    for (const policy of local) {
      expect(() => domain.decode(policy)).not.toThrow();
      expect(excluded.has(canonicalStrategy(policy))).toBe(false);
    }
    expect(new Set(result.policies.map(canonicalStrategy)).size).toBe(20_000);

    const parentless = proposeResponsePortfolio({ kingdom, seed: 5, count: 200, excludedCanonical: new Set() });
    expect(parentless.diagnostics.sourceCounts).toEqual({ semantic: 170, local: 0, unrestricted: 30 });
  });

  it('is deterministic while every seed preserves recipe coverage', () => {
    const kingdom = kingdom009();
    const first = proposeResponsePortfolio({ kingdom, seed: 44, count: 100, excludedCanonical: new Set() });
    const repeated = proposeResponsePortfolio({ kingdom, seed: 44, count: 100, excludedCanonical: new Set() });
    const different = proposeResponsePortfolio({ kingdom, seed: 45, count: 100, excludedCanonical: new Set() });
    expect(repeated.diagnostics).toEqual(first.diagnostics);
    expect(repeated.policies.map(canonicalStrategy)).toEqual(first.policies.map(canonicalStrategy));
    expect(different.diagnostics.proposalHash).not.toBe(first.diagnostics.proposalHash);
    expect(different.diagnostics.recipeCoverage.coveredCoreIds)
      .toEqual(different.diagnostics.recipeCoverage.availableCoreIds);
  });
});
