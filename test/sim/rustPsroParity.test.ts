import { describe, expect, it } from 'vitest';
import { solveEquilibrium, SUPPORT_TOLERANCE } from '../../src/sim/equilibrium';

const percentages = [
  [50, 47.666666666666664, 1.6666666666666667, 0],
  [52.333333333333336, 50, 7.666666666666667, 6],
  [98.33333333333333, 92.33333333333333, 50, 8.666666666666666],
  [100, 94, 91.33333333333333, 50]
];

describe('Rust PSRO fixture parity', () => {
  it('selects the same final support as the balance-tuning-005 Rust fixture', () => {
    const ids = ['gf-9597038', 'gf-10927691', 'gf-1681382', 'gf-10681409'];
    const payoff = percentages.map((row) => row.map((value) => (value - 50) / 50));
    const result = solveEquilibrium(ids, payoff);
    expect(ids.filter((id) => result.weights[id]! > SUPPORT_TOLERANCE)).toEqual(['gf-10681409']);
    expect(result.maximumKnownAdvantage).toBeLessThanOrEqual(1e-6);
  });
});
