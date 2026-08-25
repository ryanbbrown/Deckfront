import { describe, expect, it } from 'vitest';
import {
  STAGED_GOLDFISH_POOL_SEEDS, parseStagedGoldfishArgs, stagedGoldfishArtifactDirectory,
  stagedGoldfishAttackSeeds, stagedGoldfishEvidenceSeedRoots
} from '../../src/sim/stagedGoldfishSuite';

describe('staged goldfish suite configuration', () => {
  it('parses one-seed and sequential suite commands', () => {
    expect(parseStagedGoldfishArgs([])).toEqual({ command: 'run', poolSeed: 5 });
    expect(parseStagedGoldfishArgs(['--run', '--seed', '2'])).toEqual({ command: 'run', poolSeed: 2 });
    expect(parseStagedGoldfishArgs(['--status', '--seed', '4'])).toEqual({ command: 'status', poolSeed: 4 });
    expect(parseStagedGoldfishArgs(['--suite'])).toEqual({ command: 'suite' });
    expect(parseStagedGoldfishArgs(['--suite-status'])).toEqual({ command: 'suite-status' });
    expect(() => parseStagedGoldfishArgs(['--suite', '--seed', '1'])).toThrow('does not take --seed');
    expect(() => parseStagedGoldfishArgs(['--seed', '6'])).toThrow('from 1 through 5');
  });

  it('isolates each pool seed and retains the seed-5 evidence namespace', () => {
    expect(STAGED_GOLDFISH_POOL_SEEDS.map((seed) =>
      stagedGoldfishArtifactDirectory('deep-beam-tuning-009', seed))).toEqual([
      '.experiments/staged-goldfish-ab/staged-goldfish-ab-v1/deep-beam-tuning-009/seed-1',
      '.experiments/staged-goldfish-ab/staged-goldfish-ab-v1/deep-beam-tuning-009/seed-2',
      '.experiments/staged-goldfish-ab/staged-goldfish-ab-v1/deep-beam-tuning-009/seed-3',
      '.experiments/staged-goldfish-ab/staged-goldfish-ab-v1/deep-beam-tuning-009/seed-4',
      '.experiments/staged-goldfish-ab/staged-goldfish-ab-v1/deep-beam-tuning-009/seed-5'
    ]);
    expect(STAGED_GOLDFISH_POOL_SEEDS.map((seed) => stagedGoldfishEvidenceSeedRoots(seed).acquisition))
      .toEqual([8_110_000, 8_120_000, 8_130_000, 8_140_000, 8_100_000]);
    expect(STAGED_GOLDFISH_POOL_SEEDS.map((seed) => stagedGoldfishEvidenceSeedRoots(seed).lottery))
      .toEqual([8_401_000, 8_402_000, 8_403_000, 8_404_000, 8_400_000]);
    expect(stagedGoldfishEvidenceSeedRoots(5)).toEqual({ acquisition: 8_100_000, lottery: 8_400_000,
      lotteryBootstrap: [8_500_001, 8_500_002],
      attacks: { 'baseline-vs-staged': 9_200_005, 'staged-vs-baseline': 9_300_005 } });
  });

  it('keeps all cross-attack simulation seeds separate across directions and pool seeds', () => {
    const protocol = { raceBlocks: [1, 2, 4, 8], confirmationBlocks: 400, finalists: 8 };
    const seen = new Set<number>();
    for (const poolSeed of STAGED_GOLDFISH_POOL_SEEDS) {
      for (const direction of ['baseline-vs-staged', 'staged-vs-baseline'] as const) {
        const configured = stagedGoldfishAttackSeeds(poolSeed, direction, protocol);
        const seeds = Object.values(configured.namespaces).flat();
        expect(seeds).toHaveLength(428);
        expect(seeds.some((seed) => seen.has(seed))).toBe(false);
        seeds.forEach((seed) => seen.add(seed));
      }
    }
    expect(seen.size).toBe(4_280);
  });
});
