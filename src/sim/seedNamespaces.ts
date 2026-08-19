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

export function configuredSeedNamespaces(options: {
  seed: number; kingdomId: string; restarts: number; iterations: number; unionIterations: number; seeds: number;
}): Record<string, number[]> {
  const inventory: Record<string, number[]> = { matrix: namespaceSeeds(options.seed, 'matrix', options.seeds) };
  for (let restart = 0; restart < options.restarts; restart += 1) {
    inventory[`initialization:${restart}`] = namespaceSeeds(options.seed, 'initialization', 1, restart, 0);
    for (let attempt = 0; attempt < options.iterations; attempt += 1) {
      for (const phase of ['global-screen', 'global-confirm', 'niche-screen', 'niche-confirm'] as const) {
        inventory[`${phase}:${restart}:${attempt}`] = namespaceSeeds(options.seed, phase,
          options.seeds, restart, attempt);
      }
      inventory[`bootstrap:global:${restart}:${attempt}`] = namespaceSeeds(options.seed, 'bootstrap', 1,
        restart, attempt * 2);
      inventory[`bootstrap:niche:${restart}:${attempt}`] = namespaceSeeds(options.seed, 'bootstrap', 1,
        restart, attempt * 2 + 1);
    }
  }
  for (let attempt = 0; attempt < options.unionIterations; attempt += 1) {
    for (const phase of ['global-screen', 'global-confirm'] as const) {
      inventory[`${phase}:union:${attempt}`] = namespaceSeeds(options.seed, phase,
        options.seeds, options.restarts, attempt);
    }
    inventory[`bootstrap:global:union:${attempt}`] = namespaceSeeds(options.seed, 'bootstrap', 1,
      options.restarts, attempt * 2);
  }
  if (options.kingdomId === 'rigged-melee') {
    inventory.diagnostic = namespaceSeeds(options.seed, 'diagnostic', options.seeds);
    inventory['bootstrap:diagnostic'] = namespaceSeeds(options.seed, 'bootstrap', 1, options.restarts + 1, 0);
  }
  inventory['bootstrap:weights'] = namespaceSeeds(options.seed, 'bootstrap', 1, options.restarts + 2, 0);
  return inventory;
}
