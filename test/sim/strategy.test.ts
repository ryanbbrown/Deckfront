import { describe, expect, it } from 'vitest';
import { SEED_STRATEGIES, diagnosticStrategies } from '../../src/sim/baselines';
import { formatStrategy, identify, registerIdentity } from '../../src/sim/strategy';
import { strategy } from './fixtures';

describe('seed strategy model', () => {
  it('contains only the executable deck-plan fields', () => {
    const expected = ['buyAgenda', 'id', 'repeatPurchase', 'startingBuild'];
    for (const plan of Object.values(SEED_STRATEGIES).flat()) {
      expect(Object.keys(plan).sort(), plan.id).toEqual(expected);
    }
  });

  it('refuses every in-place write', () => {
    const plan = diagnosticStrategies('current-duel')[0]!;
    expect(() => { (plan.buyAgenda[0] as unknown as Record<string, number>).desiredCount = 99; }).toThrow(TypeError);
    expect(plan.buyAgenda[0]!.desiredCount).toBe(4);
    for (const list of [plan.startingBuild, plan.buyAgenda]) {
      expect(Object.isFrozen(list)).toBe(true);
      expect(() => (list as unknown as unknown[]).push('copper')).toThrow(TypeError);
    }
    expect(() => { (plan as unknown as Record<string, string>).id = 'hijacked'; }).toThrow(TypeError);
    expect(() => (SEED_STRATEGIES['current-duel'] as unknown as unknown[]).push(plan)).toThrow(TypeError);
  });
});

describe('formatStrategy', () => {
  it('prints the complete purchase plan without tactical fields', () => {
    const plan = strategy({
      id: 'printable', startingBuild: ['heavyBlow', 'footwork'],
      buyAgenda: [{ cardId: 'heavyBlow', desiredCount: 3 }, { cardId: 'drive', desiredCount: 2 }],
      repeatPurchase: 'footwork'
    });
    expect(formatStrategy(plan)).toBe([
      'printable',
      '  build: heavyBlow, footwork',
      '  agenda: heavyBlow x3 -> drive x2',
      '  repeat: footwork'
    ].join('\n'));
  });

  it('round trips every seed through JSON without changing its text', () => {
    for (const plan of Object.values(SEED_STRATEGIES).flat()) {
      expect(formatStrategy(JSON.parse(JSON.stringify(plan)))).toBe(formatStrategy(plan));
    }
  });
});

describe('strategy identity', () => {
  it('accepts the same plan under one id and rejects two plans under one id', () => {
    const known = new Map<string, string>();
    const plan = identify(strategy({ startingBuild: ['drive'] }));
    registerIdentity(known, plan);
    registerIdentity(known, { ...plan });
    expect(known.size).toBe(1);
    expect(() => registerIdentity(known, { ...strategy({ startingBuild: ['aim'] }), id: plan.id }))
      .toThrow(`Two different strategies share the id ${plan.id}`);
  });
});
