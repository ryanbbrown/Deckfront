import { stableHash } from './strategy';

/**
 * A race spends its seeds in rounds that double while the field shrinks. The whole ladder comes from
 * one namespace slice, so every round sees games no earlier round has already shown the candidate.
 */
export const RACE_ROUND_SEEDS: readonly number[] = Object.freeze([1, 2, 4, 8]);
export const RACE_TOTAL_SEEDS = RACE_ROUND_SEEDS.reduce((sum, count) => sum + count, 0);

export function raceRoundSeeds(seeds: readonly number[]): number[][] {
  const rounds: number[][] = [];
  let offset = 0;
  for (const count of RACE_ROUND_SEEDS) {
    rounds.push([...seeds.slice(offset, offset + count)]);
    offset += count;
  }
  return rounds.filter((round) => round.length > 0);
}

export type SeedPhase = 'initialization' | 'matrix' | 'global-race' | 'global-confirm' | 'bootstrap'
  | 'final-candidate' | 'final-race' | 'final-screen-sampling' | 'final-confirm'
  | 'final-confirm-sampling' | 'final-bootstrap';

export interface FinalSearchSeeds {
  candidate: number[]; screen: number[]; screenSampling: number[];
  confirmation: number[]; confirmationSampling: number[]; bootstrap: number[];
}

function hashToSeed(text: string): number {
  return Number.parseInt(stableHash(text).slice(0, 8), 16) >>> 0;
}

export function namespaceSeeds(
  runSeed: number, phase: SeedPhase, count: number, restart = 0, attempt = 0
): number[] {
  return Array.from({ length: count }, (_unused, block) =>
    hashToSeed(`${runSeed >>> 0}:${phase}:${restart}:${attempt}:${block}`));
}

export function assertDisjointSeedNamespaces(namespaces: Readonly<Record<string, readonly number[]>>): void {
  const seen = new Map<number, string>();
  for (const [label, seeds] of Object.entries(namespaces)) {
    for (const seed of seeds) {
      const previous = seen.get(seed);
      if (previous) throw new Error(`Seed ${seed} collides between ${previous} and ${label}.`);
      seen.set(seed, label);
    }
  }
}

export function finalSearchSeedNamespaces(runSeed: number, attempt: number): FinalSearchSeeds {
  const namespace = 10_000 + attempt;
  const result = {
    candidate: namespaceSeeds(runSeed, 'final-candidate', 1, namespace, 0),
    screen: namespaceSeeds(runSeed, 'final-race', RACE_TOTAL_SEEDS, namespace, 0),
    screenSampling: namespaceSeeds(runSeed, 'final-screen-sampling', 1, namespace, 0),
    confirmation: namespaceSeeds(runSeed, 'final-confirm', 25, namespace, 0),
    confirmationSampling: namespaceSeeds(runSeed, 'final-confirm-sampling', 1, namespace, 0),
    bootstrap: namespaceSeeds(runSeed, 'final-bootstrap', 1, namespace, 0)
  };
  assertDisjointSeedNamespaces(result);
  return result;
}
