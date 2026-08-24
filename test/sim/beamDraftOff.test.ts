import { describe, expect, it } from 'vitest';
import {
  beamFloors, deduplicateLaneFinalists, expandBeamCandidate, laneGrammar, retainDiverseBeam,
  selectLaneResponses
} from '../../scripts/beam_draft_off';
import { forcedMageGrammar } from '../../scripts/diagnose_forced_mage';
import {
  ALWAYS_AVAILABLE_ACTION_IDS, cardDefinition
} from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { kingdomFacts } from '../../src/sim/mutation';
import { BUY_PLAN_SLOTS, INFINITE_COUNT, canonicalStrategy } from '../../src/sim/strategy';

describe('the experimental draft-off beam grammar', () => {
  it('starts with no-buy and every purchasable card as an infinite floor', () => {
    const floors = beamFloors('current-duel');
    expect(floors).toHaveLength(kingdomFacts('current-duel').purchaseIds.length + 1);
    expect(floors.every((entry) => entry.strategy.startingBuild.length === 0)).toBe(true);
    expect(floors[0]!.floorKey).toBe('no-buy');
    expect(floors[0]!.strategy.buyPlan[0]).toEqual({ kind: 'stop', threshold: 0 });
    for (const floor of floors.slice(1)) {
      expect(floor.strategy.buyPlan[0]).toEqual({
        kind: 'buy', cardId: floor.floorKey, desiredCount: INFINITE_COUNT
      });
    }
  });

  it('expands with repaired finite and stop slots without changing the floor', () => {
    const floor = beamFloors('current-duel')[1]!;
    const expanded = expandBeamCandidate('current-duel', floor);
    expect(expanded.length).toBeGreaterThan(kingdomFacts('current-duel').purchaseIds.length);
    expect(new Set(expanded.map((entry) => canonicalStrategy(entry.strategy))).size).toBe(expanded.length);
    expect(expanded.every((entry) => entry.floorKey === floor.floorKey)).toBe(true);
    expect(expanded.every((entry) => entry.strategy.startingBuild.length === 0
      && entry.strategy.buyPlan.length === BUY_PLAN_SLOTS)).toBe(true);
    expect(expanded.some((entry) => entry.strategy.buyPlan.some((slot) =>
      slot.kind === 'buy' && slot.desiredCount !== INFINITE_COUNT))).toBe(true);
    expect(expanded.some((entry) => entry.strategy.buyPlan.some((slot) =>
      slot.kind === 'stop'))).toBe(true);
  });

  it('constructs a full ten-slot alternating purchase ladder', () => {
    let candidate = beamFloors('three-way-engine').find((entry) => entry.floorKey === 'precisionShot')!;
    const rungs = [
      ['regroup', 1], ['pepperingShot', 1], ['regroup', 2], ['pepperingShot', 2],
      ['regroup', 3], ['pepperingShot', 3], ['regroup', 4], ['pepperingShot', 4], ['regroup', 5]
    ] as const;
    for (const [cardId, desiredCount] of rungs) {
      candidate = expandBeamCandidate('three-way-engine', candidate).find((entry) => {
        const slots = entry.strategy.buyPlan.filter((slot) => slot.kind !== 'inactive');
        const inserted = slots.at(-2);
        return inserted?.kind === 'buy' && inserted.cardId === cardId
          && inserted.desiredCount === desiredCount;
      })!;
      expect(candidate).toBeDefined();
    }
    const slots = candidate.strategy.buyPlan.filter((slot) => slot.kind !== 'inactive');
    expect(slots).toHaveLength(BUY_PLAN_SLOTS);
    expect(slots.map((slot) => slot.kind === 'buy' ? slot.cardId : 'stop'))
      .toEqual([...rungs.map(([cardId]) => cardId), 'precisionShot']);
  });

  it('respects a practical active-slot limit without expanding exhaustively past it', () => {
    let candidate = beamFloors('current-duel')[1]!;
    for (let active = 1; active < 4; active += 1) {
      candidate = expandBeamCandidate('current-duel', candidate, 4).find((entry) =>
        entry.strategy.buyPlan.filter((slot) => slot.kind !== 'inactive').length === active + 1)!;
    }
    const expanded = expandBeamCandidate('current-duel', candidate, 4);
    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.strategy.buyPlan.filter((slot) => slot.kind !== 'inactive')).toHaveLength(4);
  });

  it('restricts ladder cards and required terminal floors with a small grammar', () => {
    const grammar = { purchaseIds: ['silver', 'step', 'focus'], floorIds: ['focus'] };
    const floors = beamFloors('current-duel', grammar);
    expect(floors.map((floor) => floor.floorKey)).toEqual(['focus']);
    const expanded = expandBeamCandidate('current-duel', floors[0]!, 3, grammar);
    expect(expanded.every((candidate) => candidate.floorKey === 'focus')).toBe(true);
    const purchased = expanded.flatMap((candidate) => candidate.strategy.buyPlan.flatMap((slot) =>
      slot.kind === 'buy' ? [slot.cardId] : []));
    expect(new Set(purchased)).toEqual(new Set(grammar.purchaseIds));
  });

  it('builds every pure grammar from family damage and allowed support cards', () => {
    deepBeamSuite.register();
    const kingdomId = 'deep-beam-tuning-002';
    const alwaysAvailable = new Set(ALWAYS_AVAILABLE_ACTION_IDS);
    const lanes = [
      { id: 'mage' as const, family: 'mana', floors: ['arcBolt', 'discharge'] },
      { id: 'melee' as const, family: 'melee', floors: ['bullRush', 'drive'] },
      { id: 'ranged' as const, family: 'ranged', floors: ['precisionShot'] }
    ];
    for (const lane of lanes) {
      const grammar = laneGrammar(kingdomId, lane.id)!;
      expect(grammar.purchaseIds!.every((cardId) =>
        [lane.family, 'engine', 'treasure'].includes(cardDefinition(cardId).family)
        || alwaysAvailable.has(cardId))).toBe(true);
      expect(grammar.floorIds).toEqual(lane.floors);
      expect(grammar.floorIds!.every((cardId) => cardDefinition(cardId).family === lane.family)).toBe(true);
      expect(beamFloors(kingdomId, grammar).every((floor) => floor.floorKey !== 'no-buy')).toBe(true);
    }
    expect(forcedMageGrammar(kingdomId)).toEqual(laneGrammar(kingdomId, 'mage'));
    expect(laneGrammar(kingdomId, 'unrestricted')).toEqual({});
  });

  it('omits a pure lane when the kingdom offers no damage package for it', () => {
    deepBeamSuite.register();
    expect(laneGrammar('deep-beam-tuning-001', 'ranged')).toBeNull();
  });

  it('deduplicates pooled finalists and admits one competitive response from each lane', () => {
    const strategies = beamFloors('current-duel').slice(1, 5).map((entry) => entry.strategy);
    expect(deduplicateLaneFinalists([
      { lane: 'unrestricted', strategy: strategies[0]! }, { lane: 'mage', strategy: strategies[0]! },
      { lane: 'melee', strategy: strategies[1]! }
    ])).toEqual([
      { lane: 'unrestricted', strategy: strategies[0]! }, { lane: 'melee', strategy: strategies[1]! }
    ]);
    const finalists = [
      { lane: 'mage' as const, strategy: strategies[0]! },
      { lane: 'mage' as const, strategy: strategies[1]! },
      { lane: 'melee' as const, strategy: strategies[2]! },
      { lane: 'ranged' as const, strategy: strategies[3]! }
    ];
    const scores = finalists.map(({ strategy }, index) => ({
      strategy, mean: index === 3 ? 0.5 : 0.9 - index * 0.1, blockScores: [], matches: 0
    }));
    expect(selectLaneResponses(scores, finalists, new Set()).map((score) => score.strategy))
      .toEqual([strategies[0], strategies[2]]);
  });

  it('reserves a place for each floor before global score retention', () => {
    const floors = beamFloors('current-duel').slice(0, 3);
    const scored = floors.flatMap((floor, floorIndex) => [0, 1].map((rank) => ({
      ...floor,
      strategy: { ...floor.strategy, id: `${floor.strategy.id}-${rank}` },
      mean: floorIndex === 0 ? 1 - rank * 0.01 : 0.2 - floorIndex * 0.01 - rank * 0.01
    })));
    const retained = retainDiverseBeam(scored, 3);
    expect(new Set(retained.map((entry) => entry.floorKey))).toEqual(new Set(floors.map((entry) => entry.floorKey)));
  });
});
