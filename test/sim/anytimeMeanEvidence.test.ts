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

describe('anytime bounded-mean evidence', () => {
  it('matches direct mixture products and keeps the best prefix', () => {
    const values = [1, 1, 0, 0.75, 0.5];
    const evidence = anytimeMeanEvidence(values, 0.5, 'greater');
    expect(evidence.pValue).toBeCloseTo(direct(values, 0.5), 12);
    expect(evidence.pValue).toBeLessThanOrEqual(1);
    expect(() => anytimeMeanEvidence([0.5, Number.NaN], 0.5, 'greater')).toThrow();
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
