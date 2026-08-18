import { afterEach, describe, expect, it } from 'vitest';
import {
  SeededRandom, createGame, kingdomMarket, marketCost, registerKingdom, resetKingdoms, submitStartingBuild
} from '../../src/game';
import { strategyAgent } from '../../src/sim/agents/strategyAgent';
import { repairBuildIn } from '../../src/sim/build';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';
import { runMatch } from '../../src/sim/match';
import {
  MAX_DESIRED_COUNT, MUTATION_ATTEMPTS, MUTATION_NAMES, RANGE_BANDS, WEIGHT_LIMIT, applyMutation,
  kingdomFacts, mutate, mutateUnique, mutationRandom, repairStrategy
} from '../../src/sim/mutation';
import { nextPopulation } from '../../src/sim/evolution';
import { seedLabels, seedStrategies } from '../../src/sim/seedPopulation';
import { canonicalStrategy } from '../../src/sim/strategy';
import { ATTACK_MECHANICS } from '../../src/sim/search';
import type { Strategy } from '../../src/sim/strategy';
import { strategy } from './fixtures';

afterEach(() => { resetKingdoms(); });

function assertBounds(kingdomId: string, plan: Strategy): void {
  const sold = new Set(kingdomMarket(kingdomId).map((definition) => definition.id));
  const label = `${kingdomId}/${plan.id}`;
  for (const weight of Object.values(plan.weights)) {
    expect(Number.isFinite(weight), label).toBe(true);
    expect(Math.abs(weight), label).toBeLessThanOrEqual(WEIGHT_LIMIT);
  }
  for (const entry of plan.buyAgenda) {
    expect(Number.isInteger(entry.desiredCount), label).toBe(true);
    expect(entry.desiredCount, label).toBeGreaterThanOrEqual(0);
    expect(entry.desiredCount, label).toBeLessThanOrEqual(MAX_DESIRED_COUNT);
    expect(sold.has(entry.cardId), `${label} agenda ${entry.cardId}`).toBe(true);
  }
  expect(RANGE_BANDS).toContain(plan.preferredRange);
  const named = [
    ...plan.startingBuild, ...plan.treasureFallback,
    ...plan.trashPriority, ...plan.reclaimPriority, ...plan.discardPriority
  ];
  for (const cardId of named) expect(sold.has(cardId), `${label} names ${cardId}`).toBe(true);
}

function seedByLabel(kingdomId: string, label: string): Strategy {
  const labels = seedLabels(kingdomId);
  const found = seedStrategies(kingdomId).find((entry) => labels.get(entry.id) === label);
  if (!found) throw new Error(`No ${label} seed in ${kingdomId}.`);
  return found;
}

describe('the shared build repair', () => {
  it('brings a build 30 money over budget inside 12 in one call', () => {
    const overspent = ['fireball', 'volley', 'heavyBlow', 'fireball', 'volley', 'heavyBlow', 'aim', 'aim', 'drive'];
    const state = createGame({ seed: 1, kingdomId: 'three-way-open' });
    expect(marketCost(state, overspent)).toBeGreaterThan(30);
    const repaired = repairBuildIn('three-way-open', overspent);
    expect(marketCost(state, repaired)).toBeLessThanOrEqual(12);
    expect(() => submitStartingBuild(state, 'ochre', repaired)).not.toThrow();
    // Repeating the call is a no-op, which is what "one call, not one drop" means.
    expect(repairBuildIn('three-way-open', repaired)).toEqual(repaired);
    expect(repairBuildIn('three-way-open', overspent)).toEqual(repaired);
  });

  it('gives the same answer at mutation time as the agent gives at match time', () => {
    for (const kingdomId of CURATED_KINGDOM_IDS) {
      for (const baseline of seedStrategies(kingdomId)) {
        const mutated = mutate(kingdomId, baseline, mutationRandom(21, 1, 3));
        const state = createGame({ seed: 5, kingdomId });
        const atMatchTime = strategyAgent(mutated).chooseStartingBuild(state, 'ochre');
        expect(atMatchTime, `${kingdomId}/${baseline.id}`).toEqual(mutated.startingBuild);
      }
    }
  });

  it('drops the most expensive card, breaking equal costs on the definition id', () => {
    // Fireball 5 and volley 5 tie; `fireball` sorts before `volley`, so Fireball goes first.
    expect(repairBuildIn('three-way-open', ['fireball', 'volley', 'aim', 'aim'])).toEqual(['volley', 'aim', 'aim']);
    expect(repairBuildIn('three-way-open', ['volley', 'fireball', 'aim', 'aim'])).toEqual(['volley', 'aim', 'aim']);
  });
});

describe('mutation bounds', () => {
  it('keeps every mutated strategy inside its bounds through long seeded chains', () => {
    for (const kingdomId of CURATED_KINGDOM_IDS) {
      const seeds = seedStrategies(kingdomId);
      for (const baseline of seeds) {
        let plan = baseline;
        for (let step = 0; step < 40; step += 1) {
          plan = mutate(kingdomId, plan, mutationRandom(99, step, seeds.indexOf(baseline)));
          assertBounds(kingdomId, plan);
        }
        const state = createGame({ seed: 2, kingdomId });
        expect(() => submitStartingBuild(state, 'ochre', plan.startingBuild)).not.toThrow();
        const result = runMatch({
          kingdomId, seed: 4, firstPlayerId: 'ochre', swapSides: false,
          turnLimitPerPlayer: 2, actionCapPerTurn: 200,
          agents: { ochre: strategyAgent(plan), indigo: strategyAgent(strategy({ startingBuild: [], buyAgenda: [] })) }
        });
        expect(result.reason, `${kingdomId}/${baseline.id}`).not.toBe('actionSearchOverflow');
      }
    }
  });

  it('repairs a strategy that is out of bounds in every field at once', () => {
    const broken = strategy({
      startingBuild: ['starfire', 'heavyBlow', 'heavyBlow', 'heavyBlow', 'heavyBlow'],
      buyAgenda: [
        { cardId: 'starfire', desiredCount: 3 }, { cardId: 'heavyBlow', desiredCount: 99 },
        { cardId: 'heavyBlow', desiredCount: 1 }, { cardId: 'aim', desiredCount: -4 }
      ],
      treasureFallback: ['gold', 'heavyBlow'],
      preferredRange: 'Sideways' as never,
      weights: { ...strategy().weights, damage: Number.POSITIVE_INFINITY, cardsDrawn: -900, trashed: Number.NaN },
      trashPriority: ['starfire', 'copper'], reclaimPriority: ['step'], discardPriority: ['strike', 'silver']
    });
    const repaired = repairStrategy('rigged-melee', broken);
    assertBounds('rigged-melee', repaired);
    expect(repaired.weights.damage).toBe(WEIGHT_LIMIT);
    expect(repaired.weights.cardsDrawn).toBe(-WEIGHT_LIMIT);
    expect(repaired.weights.trashed).toBe(0);
    expect(repaired.preferredRange).toBe('Near');
    expect(repaired.buyAgenda).toEqual([{ cardId: 'heavyBlow', desiredCount: MAX_DESIRED_COUNT }, { cardId: 'aim', desiredCount: 0 }]);
    expect(repaired.treasureFallback).toEqual(['gold']);
    expect(repaired.reclaimPriority).toEqual([]);
    expect(repaired.discardPriority).toEqual(['silver']);
  });
});

describe('mutation reach', () => {
  const KINGDOM = 'range-rich-mixed';

  function changes(plan: Strategy, mutated: Strategy): Set<string> {
    const changed = new Set<string>();
    const agendaCards = (entry: Strategy): string[] => entry.buyAgenda.map((item) => item.cardId);
    if (JSON.stringify(plan.startingBuild) !== JSON.stringify(mutated.startingBuild)) changed.add('startingBuild');
    if ([...agendaCards(plan)].sort().join() !== [...agendaCards(mutated)].sort().join()) changed.add('agendaCards');
    else if (agendaCards(plan).join() !== agendaCards(mutated).join()) changed.add('agendaOrder');
    if (plan.buyAgenda.some((entry, index) => mutated.buyAgenda[index]?.cardId === entry.cardId
      && mutated.buyAgenda[index]?.desiredCount !== entry.desiredCount)) changed.add('desiredCount');
    if (plan.preferredRange !== mutated.preferredRange) changed.add('preferredRange');
    if (JSON.stringify(plan.weights) !== JSON.stringify(mutated.weights)) changed.add('weights');
    for (const field of ['trashPriority', 'reclaimPriority', 'discardPriority', 'treasureFallback'] as const) {
      if (JSON.stringify(plan[field]) !== JSON.stringify(mutated[field])) changed.add(field);
    }
    return changed;
  }

  it('can change every field a strategy carries', () => {
    const parent = seedByLabel(KINGDOM, 'ranged-volley');
    const reached = new Set<string>();
    for (let index = 0; index < 400; index += 1) {
      for (const field of changes(parent, mutate(KINGDOM, parent, mutationRandom(5, 1, index)))) reached.add(field);
    }
    expect([...reached].sort()).toEqual([
      'agendaCards', 'agendaOrder', 'desiredCount', 'preferredRange', 'startingBuild',
      'discardPriority', 'reclaimPriority', 'trashPriority', 'treasureFallback', 'weights'
    ].sort());
  });

  // The package mutation is the one that moves a related group: the band, the weight that rewards
  // holding it, and the attacks the deck buys.
  it('moves a related group together in the range package', () => {
    const parent = seedByLabel(KINGDOM, 'ranged-volley');
    expect(parent.preferredRange).toBe('Far');
    expect(parent.buyAgenda.map((entry) => entry.cardId)).toContain('volley');
    const pivoted = applyMutation('range-package', KINGDOM, parent, new SeededRandom(11));
    expect(changes(parent, pivoted)).toEqual(new Set(['startingBuild', 'agendaCards', 'preferredRange', 'weights']));
    expect(pivoted.preferredRange).toBe('Close');
    // Volley cannot fire at Close, so the pivot takes it out of the agenda and puts a Close attack in.
    const agenda = pivoted.buyAgenda.map((entry) => entry.cardId);
    expect(agenda).not.toContain('volley');
    expect(agenda.some((cardId) => ['heavyBlow', 'drive'].includes(cardId))).toBe(true);
    expect(pivoted.startingBuild.some((cardId) => ['heavyBlow', 'drive'].includes(cardId))).toBe(true);
  });

  it('names one operator per behaviour and applies each without leaving the bounds', () => {
    const parent = seedByLabel(KINGDOM, 'ranged-shot');
    for (const name of MUTATION_NAMES) {
      for (let draw = 0; draw < 12; draw += 1) {
        assertBounds(KINGDOM, applyMutation(name, KINGDOM, parent, new SeededRandom(draw + 1)));
      }
    }
  });

  it('gives two candidates in one generation different mutations', () => {
    const leaders = seedStrategies(KINGDOM).slice(0, 3);
    const population = nextPopulation(KINGDOM, leaders, 20, 77, 4);
    expect(population).toHaveLength(20);
    expect(new Set(population.map(canonicalStrategy)).size).toBe(20);
    expect(population.slice(0, 3)).toEqual(leaders);
  });
});

describe('seeded strategies', () => {
  it('provides five complete distinct strategies in every curated kingdom', () => {
    for (const kingdomId of CURATED_KINGDOM_IDS) {
      const seeds = seedStrategies(kingdomId);
      expect(seeds, kingdomId).toHaveLength(5);
      expect(new Set(seeds.map((seed) => seed.id)).size, kingdomId).toBe(seeds.length);
      const definitions = new Map(kingdomMarket(kingdomId).map((definition) => [definition.id, definition]));
      const state = createGame({ seed: 1, kingdomId });
      for (const seed of seeds) {
        assertBounds(kingdomId, seed);
        expect(marketCost(state, seed.startingBuild), `${kingdomId}/${seed.id} build cost`)
          .toBeLessThanOrEqual(12);
        const planned = [...seed.startingBuild, ...seed.buyAgenda.map((entry) => entry.cardId)];
        expect(planned.some((cardId) => ATTACK_MECHANICS.has(definitions.get(cardId)!.mechanic)),
          `${kingdomId}/${seed.id} needs a damage card`).toBe(true);
      }
    }
  });

  it('uses the same canonical strategies where the two kingdoms have the same market', () => {
    expect(seedStrategies('rigged-melee').map((seed) => seed.id))
      .toEqual(seedStrategies('three-way-open').map((seed) => seed.id));
  });

  it('rejects a kingdom without an approved seed table', () => {
    expect(() => seedStrategies('distance-duel')).toThrow('Unknown seed kingdom');
  });
});

describe('filling a population', () => {
  it('gives every slot a strategy, in every kingdom', () => {
    for (const kingdomId of CURATED_KINGDOM_IDS) {
      const seeds = seedStrategies(kingdomId);
      const population = nextPopulation(kingdomId, seeds, 12, 5, 2);
      expect(population, kingdomId).toHaveLength(12);
      expect(new Set(population.map(canonicalStrategy)).size, kingdomId).toBe(12);
    }
  });

  // The signal the population loops turn into a thrown error. A slot that quietly stayed empty would
  // make the match count, every score, and every runtime estimate wrong with nothing saying so.
  it('reports no candidate when every attempt lands on a form already taken', () => {
    const parent = seedStrategies('three-way-open')[1]!;
    const taken = new Set<string>();
    for (let salt = 0; salt < MUTATION_ATTEMPTS; salt += 1) {
      taken.add(canonicalStrategy(mutate('three-way-open', parent, mutationRandom(5, 1, 0, salt))));
    }
    expect(mutateUnique('three-way-open', parent, taken, 5, 1, 0)).toBeNull();
    expect(mutateUnique('three-way-open', parent, new Set(), 5, 1, 0)).not.toBeNull();
  });
});

describe('the kingdom caches mutation keeps', () => {
  // Both caches are keyed by kingdom id, and an id can come back from `resetKingdoms` with different
  // piles. A stale market would mutate strategies toward cards the kingdom no longer sells.
  it('drops the market and the build probe when the registry is cleared', () => {
    const kingdom = (cardIds: readonly string[]) => ({
      id: 'cache-probe', name: 'cache-probe', startingHealth: 20,
      actionPiles: cardIds.map((cardId) => ({ cardId, count: 10 }))
    });
    registerKingdom(kingdom(['heavyBlow', 'footwork']));
    expect(kingdomFacts('cache-probe').marketIds).toContain('heavyBlow');
    expect(repairBuildIn('cache-probe', ['heavyBlow', 'volley'])).toEqual(['heavyBlow']);

    resetKingdoms();
    registerKingdom(kingdom(['volley', 'footwork']));
    expect(kingdomFacts('cache-probe').marketIds).not.toContain('heavyBlow');
    expect(repairBuildIn('cache-probe', ['heavyBlow', 'volley'])).toEqual(['volley']);
  });
});
