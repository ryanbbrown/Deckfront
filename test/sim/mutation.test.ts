import { afterEach, describe, expect, it } from 'vitest';
import { SeededRandom, createGame, kingdomMarket, marketCost, registerKingdom, resetKingdoms, submitStartingBuild } from '../../src/game';
import { strategyAgent } from '../../src/sim/agents/strategyAgent';
import { repairBuildIn } from '../../src/sim/build';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';
import {
  MUTATION_ATTEMPTS, MUTATION_NAMES, applyMutation, kingdomFacts, neighbourhood,
  mutate, mutateUnique, mutationRandom, repairStrategy
} from '../../src/sim/mutation';
import { diagnosticLabels, diagnosticStrategies } from '../../src/sim/baselines';
import { ATTACK_MECHANICS } from '../../src/sim/search';
import { BUY_PLAN_SLOTS, INFINITE_COUNT, MAXIMUM_FINITE_COUNT, canonicalStrategy, isInfinite } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import { strategy } from './fixtures';

afterEach(() => { resetKingdoms(); });

function assertBounds(kingdomId: string, plan: Strategy): void {
  const definitions = new Map(kingdomMarket(kingdomId).map((card) => [card.id, card]));
  expect(Object.keys(plan).sort()).toEqual(['buyPlan', 'id', 'startingBuild']);
  expect(plan.startingBuild).not.toContain('copper');
  expect(plan.buyPlan).toHaveLength(BUY_PLAN_SLOTS);
  for (const slot of plan.buyPlan) {
    if (slot.kind === 'inactive') continue;
    if (slot.kind === 'stop') {
      expect(slot.threshold).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(slot.threshold)).toBe(true);
      continue;
    }
    expect(slot.cardId).not.toBe('copper');
    expect(definitions.get(slot.cardId)?.cost).toBeGreaterThan(0);
    expect(slot.desiredCount).toBeGreaterThan(0);
    expect(Number.isInteger(slot.desiredCount)).toBe(true);
    if (isInfinite(slot)) expect(slot.desiredCount).toBe(INFINITE_COUNT);
    else {
      expect(slot.desiredCount).toBeLessThanOrEqual(MAXIMUM_FINITE_COUNT);
      expect(plan.startingBuild.filter((id) => id === slot.cardId).length).toBeLessThan(slot.desiredCount);
    }
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
  it('removes Copper, zero targets, and rungs the draft already satisfied', () => {
    const repaired = repairStrategy('current-duel', strategy({
      startingBuild: ['copper', 'channel'],
      buyPlan: [
        { kind: 'buy', cardId: 'copper', desiredCount: 9 },
        { kind: 'buy', cardId: 'channel', desiredCount: 1 },
        { kind: 'buy', cardId: 'aim', desiredCount: 3 },
        { kind: 'buy', cardId: 'aim', desiredCount: 4 },
        { kind: 'buy', cardId: 'volley', desiredCount: 0 },
        { kind: 'buy', cardId: 'copper', desiredCount: INFINITE_COUNT }
      ]
    }));
    expect(repaired.startingBuild).toEqual(['channel']);
    expect(repaired.buyPlan.slice(0, 4)).toEqual([
      { kind: 'buy', cardId: 'aim', desiredCount: 3 },
      { kind: 'buy', cardId: 'aim', desiredCount: 4 },
      { kind: 'inactive' }, { kind: 'inactive' }
    ]);
    assertBounds('current-duel', repaired);
  });

  it('normalizes inactive gaps because they do not change execution without cost bands', () => {
    const left = repairStrategy('current-duel', strategy({ buyPlan: [
      { kind: 'inactive' }, { kind: 'buy', cardId: 'aim', desiredCount: 2 }
    ] }));
    const right = repairStrategy('current-duel', strategy({ buyPlan: [
      { kind: 'buy', cardId: 'aim', desiredCount: 2 }, { kind: 'inactive' }
    ] }));
    expect(left.buyPlan[0]).toEqual({ kind: 'buy', cardId: 'aim', desiredCount: 2 });
    expect(left.id).toBe(right.id);
  });

  it('does not give removed tactical fields identity or population slots', () => {
    const base = strategy({ startingBuild: ['aim'], buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }] });
    const legacyA = { ...base, preferredRange: 'Far', weights: { damage: 99 }, trashPriority: ['gold'] } as Strategy;
    const legacyB = { ...base, preferredRange: 'Close', weights: { damage: -99 }, trashPriority: ['copper'] } as Strategy;
    expect(canonicalStrategy(repairStrategy('current-duel', legacyA)))
      .toBe(canonicalStrategy(repairStrategy('current-duel', legacyB)));
  });

  it('normalizes starting-build permutations to one population slot', () => {
    const left = repairStrategy('current-duel', strategy({
      startingBuild: ['precisionShot', 'aim'],
      buyPlan: [{ kind: 'buy', cardId: 'channel', desiredCount: INFINITE_COUNT }]
    }));
    const right = repairStrategy('current-duel', strategy({
      startingBuild: ['aim', 'precisionShot'],
      buyPlan: [{ kind: 'buy', cardId: 'channel', desiredCount: INFINITE_COUNT }]
    }));
    expect(left.startingBuild).toEqual(['aim', 'precisionShot']);
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
      if (JSON.stringify(child.buyPlan) !== JSON.stringify(parent.buyPlan)) reached.add('buyPlan');
      assertBounds('range-rich-mixed', child);
    }
    expect([...reached].sort()).toEqual(['buyPlan', 'startingBuild']);
    expect(MUTATION_NAMES).toEqual([
      'build-add', 'build-remove', 'build-replace', 'slot-activate', 'slot-deactivate',
      'slot-card', 'slot-count', 'slot-kind', 'slot-stop-threshold', 'slot-reorder'
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

  it('reaches every slot state and each adjacent reorder in the complete neighbourhood', () => {
    const parent = repairStrategy('current-duel', strategy({ buyPlan: [
      { kind: 'buy', cardId: 'precisionShot', desiredCount: 2 },
      { kind: 'stop', threshold: 3 }
    ] }));
    const forms = new Set(neighbourhood('current-duel', parent).map(canonicalStrategy));
    const withSlot = (index: number, slot: Strategy['buyPlan'][number]): string => {
      const buyPlan = parent.buyPlan.map((held, position) => position === index ? slot : held);
      return canonicalStrategy(repairStrategy('current-duel', { ...parent, buyPlan }));
    };
    expect(forms).toContain(withSlot(0, { kind: 'inactive' }));
    expect(forms).toContain(withSlot(0, { kind: 'buy', cardId: 'aim', desiredCount: INFINITE_COUNT }));
    expect(forms).toContain(withSlot(1, { kind: 'stop', threshold: 7 }));
    expect(forms).toContain(withSlot(2, { kind: 'buy', cardId: 'aim', desiredCount: 4 }));
    const swapped = [...parent.buyPlan]; [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(forms).toContain(canonicalStrategy(repairStrategy('current-duel', { ...parent, buyPlan: swapped })));
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
        const planned = [...seed.startingBuild,
          ...seed.buyPlan.flatMap((slot) => slot.kind === 'buy' ? [slot.cardId] : [])];
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
