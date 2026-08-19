import { describe, expect, it } from 'vitest';
import { MAXIMA, parseExperimentOptions } from '../../src/sim/cli';
import { conservativeGameBound } from '../../src/sim/experimentConfig';

describe('PSRO CLI', () => {
  const base = ['--kingdom', 'current-duel', '--mode', 'smoke'];
  it('uses the approved smoke and full defaults', () => {
    expect(parseExperimentOptions(base)).toMatchObject({ restarts: 1, initialStrategies: 5,
      candidates: 20, iterations: 4, nicheAdditions: 1, seeds: 8, unionIterations: 2,
      deadlineMinutes: 30, stateLimit: 20000, workers: 10 });
    expect(parseExperimentOptions(['--kingdom', 'current-duel', '--mode', 'full'])).toMatchObject({
      restarts: 3, initialStrategies: 8, candidates: 100, iterations: 12,
      nicheAdditions: 4, seeds: 25, unionIterations: 8, deadlineMinutes: 240
    });
  });
  it('rejects removed evolution aliases and values above maxima', () => {
    expect(() => parseExperimentOptions([...base, '--leaders', '5'])).toThrow('Unknown option --leaders');
    expect(() => parseExperimentOptions([...base, '--generations', '5'])).toThrow('Unknown option --generations');
    expect(() => parseExperimentOptions([...base, '--workers', String(MAXIMA.workers + 1)])).toThrow('at most');
  });
  it('calculates the mechanical smoke and maximum bounds', () => {
    expect(conservativeGameBound(parseExperimentOptions(base))).toBe(8608);
    const maximum = parseExperimentOptions(['--kingdom', 'current-duel', '--mode', 'full',
      '--initial-strategies', '12', '--iterations', '16', '--deadline-minutes', '420', '--workers', '16']);
    expect(conservativeGameBound(maximum)).toBe(1_473_800);
  });
});
