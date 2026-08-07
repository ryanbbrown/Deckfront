import { describe, expect, it } from 'vitest';
import { hexToPixel } from '../../viewer/src/hex';

describe('Skirmish viewer geometry', () => {
  it('insets even rows to match odd-row movement coordinates', () => {
    const map = { orientation: 'pointy' as const, coordinateSystem: 'odd-row' as const };
    expect(hexToPixel({ col: 4, row: 8 }, 1, map).x).toBeCloseTo(Math.sqrt(3) * 4.5);
    expect(hexToPixel({ col: 4, row: 7 }, 1, map).x).toBeCloseTo(Math.sqrt(3) * 4);
  });
});
