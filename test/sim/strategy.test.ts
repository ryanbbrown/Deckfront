import { describe, expect, it } from 'vitest';
import { BASELINE_STRATEGIES, baselineStrategy } from '../../src/sim/baselines';
import { formatStrategy, identify, registerIdentity } from '../../src/sim/strategy';
import type { StateWeights } from '../../src/sim/strategy';
import { strategy, weights } from './fixtures';

describe('baseline immutability', () => {
  it('gives every baseline its own weights object', () => {
    const seen = new Set<StateWeights>();
    for (const plan of BASELINE_STRATEGIES) {
      expect(seen.has(plan.weights), `${plan.id} shares a weights object`).toBe(false);
      seen.add(plan.weights);
    }
    expect(seen.size).toBe(BASELINE_STRATEGIES.length);
  });

  it('refuses every in-place write, so one baseline cannot reach another', () => {
    const melee = baselineStrategy('melee-rush');
    const ranged = baselineStrategy('ranged-standard');
    const engine = baselineStrategy('engine-draw');

    // The three baselines that share the default numbers are the ones a shared reference would join.
    expect(melee.weights.damage).toBe(10);
    expect(() => { (melee.weights as unknown as Record<string, number>).damage = 999; }).toThrow(TypeError);
    expect(melee.weights.damage).toBe(10);
    expect(ranged.weights.damage).toBe(10);
    expect(engine.weights.damage).toBe(10);

    expect(() => { (melee.buyAgenda[0] as unknown as Record<string, number>).desiredCount = 99; }).toThrow(TypeError);
    expect(melee.buyAgenda[0]!.desiredCount).toBe(3);

    for (const list of [melee.startingBuild, melee.buyAgenda, melee.treasureFallback,
      melee.trashPriority, melee.reclaimPriority, melee.discardPriority]) {
      expect(Object.isFrozen(list)).toBe(true);
      expect(() => (list as unknown as unknown[]).push('copper')).toThrow(TypeError);
    }

    expect(() => { (melee as unknown as Record<string, string>).id = 'hijacked'; }).toThrow(TypeError);
    expect(() => (BASELINE_STRATEGIES as unknown as unknown[]).push(melee)).toThrow(TypeError);
  });

  it('does not let two baselines share a priority list', () => {
    const melee = baselineStrategy('melee-rush');
    const ranged = baselineStrategy('ranged-standard');
    expect(melee.trashPriority).not.toBe(ranged.trashPriority);
    expect(melee.treasureFallback).not.toBe(ranged.treasureFallback);
    expect(melee.trashPriority).toEqual(ranged.trashPriority);
  });
});

describe('formatStrategy', () => {
  it('prints every field on its own line', () => {
    const plan = strategy({
      id: 'printable', preferredRange: 'Close', startingBuild: ['heavyBlow', 'footwork'],
      buyAgenda: [{ cardId: 'heavyBlow', desiredCount: 3 }, { cardId: 'drive', desiredCount: 2 }],
      treasureFallback: ['gold', 'silver'], trashPriority: ['copper'],
      reclaimPriority: ['gold', 'silver'], discardPriority: ['copper', 'silver'],
      weights: weights({ damage: 10, unspentMana: -1 })
    });
    expect(formatStrategy(plan)).toBe([
      'printable',
      '  build: heavyBlow, footwork',
      '  agenda: heavyBlow x3 -> drive x2',
      '  treasure: gold -> silver',
      '  range: Close',
      '  weights: damage 10, preferredRange 0, cardsDrawn 0, moneyGained 0, trashed 0,'
        + ' reclaimed 0, discarded 0, unspentMana -1, opponentOutOfAttackRange 0',
      '  trash: copper',
      '  reclaim: gold -> silver',
      '  discard: copper -> silver'
    ].join('\n'));
  });

  it('prints "none" for every empty list', () => {
    const lines = formatStrategy(strategy({ id: 'bare' })).split('\n');
    expect(lines[0]).toBe('bare');
    expect(lines.filter((line) => line.endsWith('none'))).toHaveLength(5);
  });

  it('round trips every baseline through JSON without changing its text', () => {
    for (const plan of BASELINE_STRATEGIES) {
      expect(formatStrategy(JSON.parse(JSON.stringify(plan)))).toBe(formatStrategy(plan));
    }
  });
});

describe('strategy identity', () => {
  it('accepts the same behaviour under one id and rejects two behaviours under one id', () => {
    const known = new Map<string, string>();
    const plan = identify(strategy({ startingBuild: ['drive'] }));
    registerIdentity(known, plan);
    registerIdentity(known, { ...plan });
    expect(known.size).toBe(1);
    expect(() => registerIdentity(known, { ...strategy({ startingBuild: ['aim'] }), id: plan.id }))
      .toThrow(`Two different strategies share the id ${plan.id}`);
  });
});
