import { describe, expect, it } from 'vitest';
import { MAXIMA, parseExperimentOptions } from '../../src/sim/cli';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';

const base = ['--kingdom', 'rigged-melee', '--mode', 'smoke'];

describe('the experiment command line', () => {
  it('takes the defaults of the mode it is given', () => {
    expect(parseExperimentOptions(base)).toEqual({
      kingdomId: 'rigged-melee', mode: 'smoke', seed: 1,
      candidates: 20, leaders: 3, generations: 5, sharedSeeds: 5, deadlineMinutes: 30, stateLimit: 20000,
      workers: 10
    });
    expect(parseExperimentOptions(['--kingdom', 'current-duel', '--mode', 'full'])).toEqual({
      kingdomId: 'current-duel', mode: 'full', seed: 1,
      candidates: 30, leaders: 4, generations: 32, sharedSeeds: 8, deadlineMinutes: 240, stateLimit: 20000,
      workers: 10
    });
  });

  // The mode sets the defaults, never the ceiling: the maxima are the approved design maximum and
  // apply in both modes, so a smoke run may be widened up to them and a full run may not pass them.
  const limits = [
    { flag: '--candidates', field: 'candidates', accepted: 50, rejected: MAXIMA.candidates + 1 },
    { flag: '--leaders', field: 'leaders', accepted: 2, rejected: MAXIMA.leaders + 1 },
    { flag: '--generations', field: 'generations', accepted: 4, rejected: MAXIMA.generations + 1 },
    { flag: '--seeds', field: 'sharedSeeds', accepted: 3, rejected: MAXIMA.sharedSeeds + 1 },
    { flag: '--deadline-minutes', field: 'deadlineMinutes', accepted: 10, rejected: MAXIMA.deadlineMinutes + 1 },
    { flag: '--state-limit', field: 'stateLimit', accepted: 500, rejected: MAXIMA.stateLimit + 1 },
    { flag: '--workers', field: 'workers', accepted: 2, rejected: MAXIMA.workers + 1 }
  ] as const;

  for (const mode of ['smoke', 'full'] as const) {
    for (const limit of limits) {
      it(`accepts a lower ${limit.flag} and rejects one above the maximum in ${mode} mode`, () => {
        const argv = ['--kingdom', 'rigged-melee', '--mode', mode, limit.flag, String(limit.accepted)];
        expect(parseExperimentOptions(argv)[limit.field]).toBe(limit.accepted);
        expect(() => parseExperimentOptions([...argv.slice(0, 4), limit.flag, String(limit.rejected)]))
          .toThrow(`${limit.flag} may be at most ${MAXIMA[limit.field]}`);
      });
    }
  }

  it('rejects a fractional, zero, or negative value', () => {
    for (const value of ['2.5', '0', '-3', 'many']) {
      expect(() => parseExperimentOptions([...base, '--candidates', value]))
        .toThrow('--candidates must be a positive whole number');
    }
  });

  it('rejects a kingdom outside the curated five, naming them', () => {
    // `distance-duel` is registered by default, but it is the browser kingdom, not an experiment one.
    for (const kingdomId of ['distance-duel', 'not-a-kingdom']) {
      expect(() => parseExperimentOptions(['--kingdom', kingdomId, '--mode', 'smoke']))
        .toThrow(`Unknown experiment kingdom ${kingdomId}. Choose one of: ${CURATED_KINGDOM_IDS.join(', ')}.`);
    }
  });

  it('rejects an unknown option, a missing value, and a missing required option', () => {
    expect(() => parseExperimentOptions([...base, '--out', 'somewhere'])).toThrow('Unknown option --out');
    // A typo with nothing after it is still a typo, not a missing value.
    expect(() => parseExperimentOptions([...base, '--kingdmo'])).toThrow('Unknown option --kingdmo');
    expect(() => parseExperimentOptions([...base, '--candidates'])).toThrow('--candidates needs a value');
    expect(() => parseExperimentOptions([...base, '--candidates', '--leaders', '2']))
      .toThrow('--candidates needs a value');
    expect(() => parseExperimentOptions(['--mode', 'smoke'])).toThrow('--kingdom is required');
    expect(() => parseExperimentOptions(['--kingdom', 'rigged-melee'])).toThrow('--mode is required');
    expect(() => parseExperimentOptions([...base.slice(0, 2), '--mode', 'quick'])).toThrow('--mode must be smoke or full');
  });

  // Rejected in the parser so the run fails before it writes anything, not after `run.json` exists.
  it('rejects a population too small to hold the five fixed seeds', () => {
    expect(() => parseExperimentOptions([...base, '--candidates', '4'])).toThrow('--candidates must be at least 5');
    expect(parseExperimentOptions([...base, '--candidates', '5', '--leaders', '5']).candidates).toBe(5);
  });

  it('takes an explicit run seed and keeps every other default', () => {
    expect(parseExperimentOptions([...base, '--seed', '77']).seed).toBe(77);
  });
});
