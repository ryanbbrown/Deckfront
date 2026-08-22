import { describe, expect, it } from 'vitest';
import {
  beamFloors, expandBeamCandidate, retainDiverseBeam
} from '../../scripts/beam_draft_off';
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
