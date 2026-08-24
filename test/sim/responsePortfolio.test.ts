import { afterEach, describe, expect, it } from 'vitest';
import { kingdomOf, registerKingdom, resetKingdoms } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import {
  deriveResponseCardRoles, proposeResponsePortfolio, responseDamageCores, responsePortfolioAllocation
} from '../../src/sim/responsePortfolio';
import { stoplessRandomDomain, strategyArchetype } from '../../src/sim/randomPsro';
import { INFINITE_COUNT, canonicalStrategy, fixedBuyPlan, identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

afterEach(() => resetKingdoms());

function kingdom009() {
  deepBeamSuite.register();
  return kingdomOf('deep-beam-tuning-009');
}
function plan(slots: Parameters<typeof fixedBuyPlan>[0]): Strategy {
  return identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan(slots) });
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
    expect(strategyArchetype(plan([
      { kind: 'buy', cardId: 'precisionShot', desiredCount: 2 },
      { kind: 'buy', cardId: 'improvise', desiredCount: INFINITE_COUNT }
    ]))).toBe('Ranged + Engine');
  });

  it('covers every feasible damage core and retains its cards and sampled hard enablers', () => {
    deepBeamSuite.register();
    const kingdom = kingdomOf('deep-beam-tuning-003');
    const roles = deriveResponseCardRoles(kingdom);
    const cores = responseDamageCores(roles);
    const result = proposeResponsePortfolio({ kingdom, seed: 35_001, count: 500, excludedCanonical: new Set() });
    expect(cores).toContainEqual(expect.objectContaining({ cardIds: ['longshot', 'salvageShot'], familyShape: 'pure' }));
    expect(result.diagnostics.recipeCoverage.coveredCoreIds)
      .toEqual(result.diagnostics.recipeCoverage.availableCoreIds);
    for (let index = 0; index < result.policies.length; index += 1) {
      const origin = result.origins[index]!;
      if (origin.source !== 'semantic') continue;
      const cards = new Set(result.policies[index]!.buyPlan.flatMap((slot) => slot.kind === 'buy' ? [slot.cardId] : []));
      expect(origin.coreCardIds.every((cardId) => cards.has(cardId))).toBe(true);
      expect(origin.requiredEnablerIds.every((cardId) => cards.has(cardId))).toBe(true);
    }
  });

  it('rejects damage cores whose mana, spender, or discard-fodder requirements are impossible', () => {
    registerKingdom({ id: 'impossible-overload', name: 'Impossible Overload', startingHealth: 50,
      actionPiles: [{ cardId: 'overload', count: 10 }] });
    const overloadRoles = deriveResponseCardRoles(kingdomOf('impossible-overload'));
    expect(overloadRoles.damage).toContain('overload');
    expect(responseDamageCores(overloadRoles).map((core) => core.id)).not.toContain('overload');
    expect(() => proposeResponsePortfolio({ kingdom: kingdomOf('impossible-overload'), seed: 1,
      count: 10, excludedCanonical: new Set() })).toThrow('no credible purchasable damage path');

    registerKingdom({ id: 'impossible-mana', name: 'Impossible Mana', startingHealth: 50,
      actionPiles: [{ cardId: 'arcBolt', count: 10 }], overrides: { focus: { cost: 0 } } });
    expect(responseDamageCores(deriveResponseCardRoles(kingdomOf('impossible-mana')))).toEqual([]);

    registerKingdom({ id: 'impossible-fodder', name: 'Impossible Fodder', startingHealth: 50,
      actionPiles: [{ cardId: 'salvageShot', count: 10 }, { cardId: 'strike', count: 10 }] });
    expect(responseDamageCores(deriveResponseCardRoles(kingdomOf('impossible-fodder')))
      .some((core) => core.cardIds.includes('salvageShot'))).toBe(false);
  });

  it('makes semantic recipes legal, damaging, useful, and free of cumulative no-ops', () => {
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
    }
    const sampledManaEnablers = new Set(result.origins.flatMap((origin) =>
      origin.source === 'semantic' && origin.coreCardIds.includes('arcBolt') ? origin.requiredEnablerIds : []));
    expect(sampledManaEnablers.size).toBeGreaterThan(1);
    expect(new Set(result.policies.map(canonicalStrategy)).size).toBe(result.policies.length);
  });

  it('prioritizes weighted support, links local changes to scored parents, and finds the observed attack', () => {
    const kingdom = kingdom009();
    const dominant = plan([
      { kind: 'buy', cardId: 'precisionShot', desiredCount: 4 },
      { kind: 'buy', cardId: 'sharpen', desiredCount: 3 },
      { kind: 'buy', cardId: 'strike', desiredCount: 3 },
      { kind: 'buy', cardId: 'step', desiredCount: 2 },
      { kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }
    ]);
    const secondary = plan([
      { kind: 'buy', cardId: 'strike', desiredCount: 2 },
      { kind: 'buy', cardId: 'step', desiredCount: 2 },
      { kind: 'buy', cardId: 'silver', desiredCount: INFINITE_COUNT }
    ]);
    const archive = plan([{ kind: 'buy', cardId: 'longshot', desiredCount: INFINITE_COUNT }]);
    const excluded = new Set([dominant, secondary, archive].map(canonicalStrategy));
    const result = proposeResponsePortfolio({ kingdom, seed: 35_002, count: 20_000, excludedCanonical: excluded,
      parents: [{ strategy: secondary, weight: 0.102 }, { strategy: dominant, weight: 0.898 }],
      archiveParents: [archive] });
    expect(result.diagnostics.sourceCounts).toEqual({ semantic: 12_000, local: 5_000, unrestricted: 3_000 });
    expect(result.diagnostics).toMatchObject({ supportParentCount: 2, archiveParentCount: 1 });
    const localIndexes = result.origins.flatMap((origin, index) => origin.source === 'local' ? [index] : []);
    expect(result.origins[localIndexes[0]!]!).toMatchObject({ source: 'local', parentId: dominant.id,
      parentKind: 'support', operator: 'count-vector' });
    for (const index of localIndexes) {
      const origin = result.origins[index]!;
      if (origin.source !== 'local') continue;
      const parent = [dominant, secondary, archive].find((candidate) => candidate.id === origin.parentId)!;
      expect(canonicalStrategy(result.policies[index]!)).not.toBe(canonicalStrategy(parent));
    }
    const attack = result.policies.find((policy, index) => {
      const origin = result.origins[index]!;
      const active = policy.buyPlan.filter((slot) => slot.kind === 'buy');
      return origin.source === 'local' && origin.parentId === dominant.id
        && active.map((slot) => slot.desiredCount).join('/') === `3/3/4/1/${INFINITE_COUNT}`
        && active.map((slot) => slot.cardId).join('/') === 'precisionShot/sharpen/strike/step/gold';
    });
    expect(attack, 'the seed-35002 dominant-parent 3 / 3 / 4 / 1 attack').toBeDefined();
    expect(new Set(result.policies.map(canonicalStrategy)).size).toBe(20_000);
  });

  it('uses exact allocation and moves the local quota to semantic without parents', () => {
    expect(responsePortfolioAllocation(20_000, true)).toEqual({ semantic: 12_000, local: 5_000, unrestricted: 3_000 });
    const parentless = proposeResponsePortfolio({ kingdom: kingdom009(), seed: 5, count: 200,
      excludedCanonical: new Set() });
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
