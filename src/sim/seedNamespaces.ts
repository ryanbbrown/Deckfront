import { stableHash } from './strategy';

export type SeedPhase = 'initialization' | 'matrix' | 'global-screen' | 'global-confirm' | 'niche-screen'
  | 'niche-confirm' | 'bootstrap' | 'diagnostic';

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
