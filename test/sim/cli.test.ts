import { describe, expect, it } from 'vitest';
import { MAXIMA, parseExperimentOptions } from '../../src/sim/cli';

describe('PSRO CLI', () => {
  const base = ['--kingdom', 'current-duel', '--mode', 'smoke'];
  it('uses the approved smoke and full defaults', () => {
    expect(parseExperimentOptions(base)).toMatchObject({ restarts: 1, initialStrategies: 5,
      candidates: 20, iterations: 4, seeds: 8, unionIterations: 2,
      deadlineMinutes: 30, workers: 4 });
    expect(parseExperimentOptions(['--kingdom', 'current-duel', '--mode', 'full'])).toMatchObject({
      restarts: 3, initialStrategies: 8, candidates: 100, iterations: 12,
      seeds: 25, unionIterations: 8, deadlineMinutes: 240, workers: 4
    });
  });
  it('rejects removed evolution aliases and values above maxima', () => {
    expect(() => parseExperimentOptions([...base, '--leaders', '5'])).toThrow('Unknown option --leaders');
    expect(() => parseExperimentOptions([...base, '--generations', '5'])).toThrow('Unknown option --generations');
    expect(() => parseExperimentOptions([...base, '--state-limit', '20000'])).toThrow('Unknown option --state-limit');
    expect(() => parseExperimentOptions([...base, '--workers', String(MAXIMA.workers + 1)])).toThrow('at most');
  });
  it('rejects the removed targeted-search option', () => {
    expect(() => parseExperimentOptions([...base, '--niche-additions', '1']))
      .toThrow('Unknown option --niche-additions');
  });
});
