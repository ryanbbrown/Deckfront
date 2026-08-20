import { stableHash } from './strategy';

export type SeedPhase = 'initialization' | 'matrix' | 'global-screen' | 'global-confirm' | 'bootstrap'
  | 'final-candidate' | 'final-screen' | 'final-screen-sampling' | 'final-confirm'
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
    screen: namespaceSeeds(runSeed, 'final-screen', 5, namespace, 0),
    screenSampling: namespaceSeeds(runSeed, 'final-screen-sampling', 1, namespace, 0),
    confirmation: namespaceSeeds(runSeed, 'final-confirm', 25, namespace, 0),
    confirmationSampling: namespaceSeeds(runSeed, 'final-confirm-sampling', 1, namespace, 0),
    bootstrap: namespaceSeeds(runSeed, 'final-bootstrap', 20, namespace, 0)
  };
  assertDisjointSeedNamespaces(result);
  return result;
}
