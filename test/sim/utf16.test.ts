import { describe, expect, it } from 'vitest';
import { CARDS } from '../../src/game';
import { canonicalStrategy, fixedBuyPlan } from '../../src/sim/strategy';
import { compareUtf16 } from '../../src/sim/utf16';

function sign(value: number): number { return value === 0 ? 0 : value < 0 ? -1 : 1; }

describe('UTF-16 canonical ordering', () => {
  it('matches current locale ordering for every current card-ID pair', () => {
    const ids = Object.keys(CARDS);
    for (const left of ids) for (const right of ids) {
      expect(sign(compareUtf16(left, right))).toBe(sign(left.localeCompare(right)));
    }
  });

  it('orders non-ASCII and collision tie text by UTF-16 code units', () => {
    expect(compareUtf16('a', 'A')).toBeGreaterThan(0);
    expect(compareUtf16('x\ud83d\ude00', 'x\uffff')).toBeLessThan(0);
    const left = canonicalStrategy({ id: 'same', startingBuild: [], buyPlan: fixedBuyPlan([]) });
    const right = canonicalStrategy({ id: 'same', startingBuild: ['copper'], buyPlan: fixedBuyPlan([]) });
    expect(compareUtf16(left, right)).not.toBe(0);
  });
});
