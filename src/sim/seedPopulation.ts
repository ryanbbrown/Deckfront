import { SEED_LABELS, SEED_STRATEGIES } from './baselines';
import { MUTATION_ATTEMPTS, mutateUnique } from './mutation';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

export function seedStrategies(kingdomId: string): Strategy[] {
  const seeds = SEED_STRATEGIES[kingdomId];
  if (!seeds) throw new Error(`Unknown seed kingdom: ${kingdomId}`);
  return [...seeds];
}

/** Maps each canonical seed id to its readable name in the per-kingdom seed table. */
export function seedLabels(kingdomId: string): Map<string, string> {
  const seeds = SEED_STRATEGIES[kingdomId];
  const labels = SEED_LABELS[kingdomId];
  if (!seeds || !labels) throw new Error(`Unknown seed kingdom: ${kingdomId}`);
  return new Map(seeds.map((strategy, index) => [strategy.id, labels[index]!]));
}

/** Seeds first, then deterministic unique mutations in round-robin seed order. */
export function seedPopulation(kingdomId: string, runSeed: number, size: number): Strategy[] {
  const seeds = seedStrategies(kingdomId);
  const population = seeds.slice(0, size);
  const taken = new Set(population.map(canonicalStrategy));
  for (let index = population.length; index < size; index += 1) {
    const parent = seeds[(index - seeds.length) % seeds.length]!;
    const child = mutateUnique(kingdomId, parent, taken, runSeed, 0, index);
    if (!child) {
      throw new Error(
        `Seeding ${kingdomId} found no new candidate for slot ${index + 1} of ${size} in ${MUTATION_ATTEMPTS} attempts.`
      );
    }
    taken.add(canonicalStrategy(child));
    population.push(child);
  }
  return population;
}
