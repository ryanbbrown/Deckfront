import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { equilibriumGroupWeightRangeDetailed } from '../../src/sim/equilibriumGroupRange';

interface CycleFixture { ids: string[]; payoff: number[][]; value: number; groupIndexes: number[] }

describe('equilibrium group range fallback', () => {
  it('solves and independently validates the real 114-strategy cycling fixture', () => {
    const fixture = JSON.parse(fs.readFileSync('test/fixtures/robust-group-range-cycle-114.json', 'utf8')) as CycleFixture;
    const group = fixture.groupIndexes.map((index) => fixture.ids[index]!);
    const result = equilibriumGroupWeightRangeDetailed(fixture.ids, fixture.payoff, fixture.value, group);
    expect(result.minimum).toBeCloseTo(0.3293958032, 8);
    expect(result.maximum).toBeCloseTo(0.3294320425, 8);
    expect([result.minimumSolver, result.maximumSolver]).toContain('fallback');
  });

  it('fails closed on invalid payoff constraints', () => {
    expect(() => equilibriumGroupWeightRangeDetailed(['a', 'b'], [[0, 1], [0, 0]], 0, ['a'])).toThrow();
  });
});
