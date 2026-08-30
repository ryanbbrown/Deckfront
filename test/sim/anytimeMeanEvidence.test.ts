import { describe, expect, it } from 'vitest';
import { BETTING_LAMBDAS, anytimeConfidenceBounds, anytimeMeanEvidence, holmStepDown }
  from '../../src/sim/anytimeMeanEvidence';

function direct(values: number[], threshold: number): number {
  let maximum = 1;
  const capitals = BETTING_LAMBDAS.map(() => 1);
  for (const value of values) {
    BETTING_LAMBDAS.forEach((lambda, index) => { capitals[index] = capitals[index]! * (1 + lambda * (value - threshold)); });
    maximum = Math.max(maximum, capitals.reduce((sum, value) => sum + value, 0) / capitals.length);
  }
  return 1 / maximum;
}

function fromBits(bits: bigint): number {
  const bytes = new ArrayBuffer(8), view = new DataView(bytes);
  view.setBigUint64(0, bits, true);
  return view.getFloat64(0, true);
}

describe('anytime bounded-mean evidence', () => {
  it('matches direct mixture products and keeps the best prefix', () => {
    const values = [1, 1, 0, 0.75, 0.5];
    const evidence = anytimeMeanEvidence(values, 0.5, 'greater');
    expect(evidence.pValue).toBeCloseTo(direct(values, 0.5), 12);
    expect(evidence.pValue).toBeLessThanOrEqual(1);
    expect(() => anytimeMeanEvidence([0.5, Number.NaN], 0.5, 'greater')).toThrow();
  });

  it('matches the Rust libm golden decisions within 2^-20', () => {
    const rustScreen = [
      [8, 0x0000000000000000n, 0x3ff0000000000000n],
      [16, 0x3fb0a67000000000n, 0x3fedeb3200000000n],
      [32, 0x3fd34f1c00000000n, 0x3fe6587200000000n],
      [64, 0x3fd9ef9c00000000n, 0x3fe3083200000000n],
      [128, 0x3fdd090e00000000n, 0x3fe17b7900000000n],
      [256, 0x3fde88c000000000n, 0x3fe0bba000000000n],
      [512, 0x3fdf456a00000000n, 0x3fe05d4b00000000n]
    ] as const;
    for (const [depth, lower, upper] of rustScreen) {
      const held = anytimeConfidenceBounds(Array(depth).fill(0.5), 0.05);
      expect(Math.abs(held.lower - fromBits(lower))).toBeLessThanOrEqual(2 ** -20);
      expect(Math.abs(held.upper - fromBits(upper))).toBeLessThanOrEqual(2 ** -20);
      expect(held.lower > 0.51 ? 'above' : held.upper <= 0.51 ? 'below' : 'unresolved').toBe('unresolved');
    }
    for (const depth of [400, 800, 1_600, 3_200, 6_400]) {
      const held = anytimeConfidenceBounds(Array(depth).fill(1), 0.025);
      expect(held.lower).toBeGreaterThan(0.51);
    }
  });

  it('returns ordered confidence bounds and deterministic Holm decisions', () => {
    const bounds = anytimeConfidenceBounds(Array(400).fill(0.8));
    expect(bounds.lower).toBeGreaterThan(0.5);
    expect(bounds.upper).toBeGreaterThan(bounds.lower);
    const holm = holmStepDown([{ id: 'b', pValue: 0.02 }, { id: 'a', pValue: 0.001 },
      { id: 'c', pValue: 0.2 }], 0.05);
    expect(holm.map((entry) => [entry.id, entry.rejected])).toEqual([['a', true], ['b', true], ['c', false]]);
    expect(holm.find((entry) => entry.id === 'a')!.adjustedPValue).toBeCloseTo(0.003);
  });
});
