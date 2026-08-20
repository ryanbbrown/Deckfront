import { afterEach, describe, expect, it } from 'vitest';
import { SeededRandom, createGame, kingdomMarket, marketCost, registerKingdom, resetKingdoms, submitStartingBuild } from '../../src/game';
import { strategyAgent } from '../../src/sim/agents/strategyAgent';
import { repairBuildIn } from '../../src/sim/build';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';
import {
  MAX_DESIRED_COUNT, MUTATION_ATTEMPTS, MUTATION_NAMES, applyMutation, kingdomFacts,
  mutate, mutateUnique, mutationRandom, repairStrategy
} from '../../src/sim/mutation';
import { diagnosticLabels, diagnosticStrategies } from '../../src/sim/baselines';
import { ATTACK_MECHANICS } from '../../src/sim/search';
import { canonicalStrategy } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import { strategy } from './fixtures';

afterEach(() => { resetKingdoms(); });

function assertBounds(kingdomId: string, plan: Strategy): void {
  const definitions = new Map(kingdomMarket(kingdomId).map((card) => [card.id, card]));
  expect(Object.keys(plan).sort()).toEqual(['buyAgenda', 'id', 'repeatPurchase', 'startingBuild']);
  expect(plan.startingBuild).not.toContain('copper');
  expect(plan.buyAgenda.map((entry) => entry.cardId)).not.toContain('copper');
  expect(plan.repeatPurchase).not.toBe('copper');
  expect(definitions.get(plan.repeatPurchase)?.cost).toBeGreaterThan(0);
  expect(new Set(plan.buyAgenda.map((entry) => entry.cardId)).size).toBe(plan.buyAgenda.length);
  for (const entry of plan.buyAgenda) {
    expect(entry.desiredCount).toBeGreaterThan(0);
    expect(entry.desiredCount).toBeLessThanOrEqual(MAX_DESIRED_COUNT);
    expect(Number.isInteger(entry.desiredCount)).toBe(true);
    expect(plan.startingBuild.filter((id) => id === entry.cardId).length).toBeLessThan(entry.desiredCount);
  }
}

function seedByLabel(kingdomId: string, label: string): Strategy {
  const labels = diagnosticLabels(kingdomId);
  const found = diagnosticStrategies(kingdomId).find((entry) => labels.get(entry.id) === label);
  if (!found) throw new Error(`No ${label} seed in ${kingdomId}.`);
  return found;
}

describe('shared build repair', () => {
  it('uses the same legal build at mutation time and match time', () => {
    for (const kingdomId of CURATED_KINGDOM_IDS) {
      for (const baseline of diagnosticStrategies(kingdomId)) {
        const mutated = mutate(kingdomId, baseline, mutationRandom(21, 1, 3));
        const state = createGame({ seed: 5, kingdomId });
        expect(strategyAgent(mutated).chooseStartingBuild(state, 'ochre')).toEqual(mutated.startingBuild);
        expect(marketCost(state, mutated.startingBuild)).toBeLessThanOrEqual(12);
      }
    }
  });

  it('repairs a large overrun in one call', () => {
    const overspent = ['fireball', 'volley', 'heavyBlow', 'fireball', 'volley', 'heavyBlow', 'aim', 'aim'];
    const repaired = repairBuildIn('three-way-open', overspent);
    const state = createGame({ seed: 1, kingdomId: 'three-way-open' });
    expect(marketCost(state, repaired)).toBeLessThanOrEqual(12);
    expect(() => submitStartingBuild(state, 'ochre', repaired)).not.toThrow();
    expect(repairBuildIn('three-way-open', repaired)).toEqual(repaired);
  });
});

describe('strategy normalization', () => {
  it('removes Copper, duplicates, zero targets, and targets satisfied by setup', () => {
    const repaired = repairStrategy('current-duel', strategy({
      startingBuild: ['copper', 'footwork'],
      buyAgenda: [
        { cardId: 'copper', desiredCount: 9 },
        { cardId: 'footwork', desiredCount: 1 },
        { cardId: 'aim', desiredCount: 3 },
        { cardId: 'aim', desiredCount: 4 },
        { cardId: 'volley', desiredCount: 0 }
      ],
      repeatPurchase: 'copper'
    }));
    expect(repaired.startingBuild).toEqual(['footwork']);
    expect(repaired.buyAgenda).toEqual([{ cardId: 'aim', desiredCount: 3 }]);
    expect(repaired.repeatPurchase).toBe('aim');
    assertBounds('current-duel', repaired);
  });

  it('does not give removed tactical fields identity or population slots', () => {
    const base = strategy({ startingBuild: ['aim'], repeatPurchase: 'footwork' });
    const legacyA = { ...base, preferredRange: 'Far', weights: { damage: 99 }, trashPriority: ['gold'] } as Strategy;
    const legacyB = { ...base, preferredRange: 'Close', weights: { damage: -99 }, trashPriority: ['copper'] } as Strategy;
    expect(canonicalStrategy(repairStrategy('current-duel', legacyA)))
      .toBe(canonicalStrategy(repairStrategy('current-duel', legacyB)));
  });

  it('normalizes starting-build permutations to one population slot', () => {
    const left = repairStrategy('current-duel', strategy({
      startingBuild: ['volley', 'aim', 'aim'], repeatPurchase: 'footwork'
    }));
    const right = repairStrategy('current-duel', strategy({
      startingBuild: ['aim', 'volley', 'aim'], repeatPurchase: 'footwork'
    }));
    expect(left.startingBuild).toEqual(['aim', 'aim', 'volley']);
    expect(right.startingBuild).toEqual(left.startingBuild);
    expect(right.id).toBe(left.id);
    expect(new Set([canonicalStrategy(left), canonicalStrategy(right)]).size).toBe(1);
  });
});

describe('mutation reach and bounds', () => {
  it('mutates every and only deck-plan field', () => {
    const parent = seedByLabel('range-rich-mixed', 'ranged-volley');
    const reached = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const child = mutate('range-rich-mixed', parent, mutationRandom(5, 1, index));
      if (JSON.stringify(child.startingBuild) !== JSON.stringify(parent.startingBuild)) reached.add('startingBuild');
      if (JSON.stringify(child.buyAgenda) !== JSON.stringify(parent.buyAgenda)) reached.add('buyAgenda');
      if (child.repeatPurchase !== parent.repeatPurchase) reached.add('repeatPurchase');
      assertBounds('range-rich-mixed', child);
    }
    expect([...reached].sort()).toEqual(['buyAgenda', 'repeatPurchase', 'startingBuild']);
    expect(MUTATION_NAMES).toEqual([
      'build-add', 'build-remove', 'build-replace', 'agenda-add', 'agenda-remove',
      'agenda-reorder', 'agenda-count', 'repeat-purchase'
    ]);
  });

  it('applies every named operator without leaving the executable shape', () => {
    const parent = seedByLabel('range-rich-mixed', 'ranged-shot');
    for (const name of MUTATION_NAMES) {
      for (let draw = 0; draw < 12; draw += 1) {
        assertBounds('range-rich-mixed', applyMutation(name, 'range-rich-mixed', parent, new SeededRandom(draw + 1)));
      }
    }
  });

  it('reports no candidate when every attempted form is taken', () => {
    const parent = diagnosticStrategies('three-way-open')[1]!;
    const taken = new Set<string>();
    for (let salt = 0; salt < MUTATION_ATTEMPTS; salt += 1) {
      taken.add(canonicalStrategy(mutate('three-way-open', parent, mutationRandom(5, 1, 0, salt))));
    }
    expect(mutateUnique('three-way-open', parent, taken, 5, 1, 0)).toBeNull();
  });
});

describe('seeded strategies', () => {
  it('provides five distinct valid damage plans in every curated kingdom', () => {
    for (const kingdomId of CURATED_KINGDOM_IDS) {
      const seeds = diagnosticStrategies(kingdomId);
      expect(seeds).toHaveLength(5);
      expect(new Set(seeds.map((seed) => seed.id)).size).toBe(5);
      const definitions = new Map(kingdomMarket(kingdomId).map((definition) => [definition.id, definition]));
      for (const seed of seeds) {
        assertBounds(kingdomId, seed);
        const planned = [...seed.startingBuild, ...seed.buyAgenda.map((entry) => entry.cardId), seed.repeatPurchase];
        expect(planned.some((cardId) => ATTACK_MECHANICS.has(definitions.get(cardId)!.mechanic))).toBe(true);
      }
    }
  });
});

describe('kingdom fact cache', () => {
  it('drops cached markets when the registry resets', () => {
    const kingdom = (cardId: string) => ({ id: 'cache-probe', name: 'cache-probe', startingHealth: 20, actionPiles: [{ cardId, count: 10 }] });
    registerKingdom(kingdom('heavyBlow'));
    expect(kingdomFacts('cache-probe').marketIds).toContain('heavyBlow');
    resetKingdoms();
    registerKingdom(kingdom('volley'));
    expect(kingdomFacts('cache-probe').marketIds).not.toContain('heavyBlow');
  });
});
