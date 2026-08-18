import { afterEach, describe, expect, it } from 'vitest';
import { SeededRandom, createGame, kingdomMarket, marketCost, resetKingdoms, submitStartingBuild } from '../../src/game';
import { strategyAgent } from '../../src/sim/agents/strategyAgent';
import { BASELINE_STRATEGIES, baselineStrategy } from '../../src/sim/baselines';
import { repairBuildIn } from '../../src/sim/build';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';
import { runMatch } from '../../src/sim/match';
import {
  MAX_DESIRED_COUNT, MUTATION_NAMES, RANGE_BANDS, WEIGHT_LIMIT, applyMutation, mutate, mutationRandom, repairStrategy
} from '../../src/sim/mutation';
import { nextPopulation } from '../../src/sim/evolution';
import { seedStrategies } from '../../src/sim/seedPopulation';
import { canonicalStrategy } from '../../src/sim/strategy';
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
      for (const baseline of BASELINE_STRATEGIES) {
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
      for (const baseline of BASELINE_STRATEGIES) {
        let plan = repairStrategy(kingdomId, baseline);
        for (let step = 0; step < 40; step += 1) {
          plan = mutate(kingdomId, plan, mutationRandom(99, step, BASELINE_STRATEGIES.indexOf(baseline)));
          assertBounds(kingdomId, plan);
        }
        const state = createGame({ seed: 2, kingdomId });
        expect(() => submitStartingBuild(state, 'ochre', plan.startingBuild)).not.toThrow();
        const result = runMatch({
          kingdomId, seed: 4, firstPlayerId: 'ochre', swapSides: false,
          turnLimitPerPlayer: 2, actionCapPerTurn: 200,
          agents: { ochre: strategyAgent(plan), indigo: strategyAgent(baselineStrategy('treasure-only')) }
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
    const parent = repairStrategy(KINGDOM, baselineStrategy('ranged-standard'));
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
    const parent = repairStrategy(KINGDOM, baselineStrategy('ranged-standard'));
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
    const parent = repairStrategy(KINGDOM, baselineStrategy('engine-draw'));
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
  it('repairs each baseline into the kingdom it will play in and keeps the five apart', () => {
    for (const kingdomId of CURATED_KINGDOM_IDS) {
      const seeds = seedStrategies(kingdomId);
      expect(seeds, kingdomId).toHaveLength(BASELINE_STRATEGIES.length);
      expect(new Set(seeds.map((seed) => seed.id)).size, kingdomId).toBe(seeds.length);
      for (const seed of seeds) assertBounds(kingdomId, seed);
    }
  });

  // Recorded, not fixed. Plan 10-4 allows a baseline to repair away, and inventing a replacement
  // would be new strategy content that no approved document authorises.
  it('records that engine-draw loses its whole build and agenda in three-way-open', () => {
    const seeds = seedStrategies('three-way-open');
    const engine = seeds.find((seed) => seed.preferredRange === 'Near' && seed.weights.cardsDrawn === 2)!;
    expect(engine.startingBuild).toEqual(['stipend', 'footwork']);
    expect(engine.buyAgenda).toEqual([{ cardId: 'stipend', desiredCount: 2 }]);
  });
});
