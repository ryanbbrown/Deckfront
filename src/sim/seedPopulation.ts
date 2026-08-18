import { BASELINE_STRATEGIES } from './baselines';
import { mutateUnique, repairStrategy } from './mutation';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

/**
 * The five fixed baselines, each repaired into the kingdom it will play in. Repairing here rather
 * than at match time is what makes the strategy recorded in the results the strategy that played.
 *
 * Several baselines lose most of their shape in several kingdoms — `engine-draw` in `three-way-open`
 * sells none of muster, stipend, adapt, or steady shot, so it loses its whole build and its whole
 * agenda. Plan `10-4` allows that, so it is left alone: hand-written per-kingdom seeds would be new
 * strategy content that no approved document authorises. Generation 1 is thinner there, and the
 * mutations that fill the population draw from the kingdom market, so its children recover at once.
 */
export function seedStrategies(kingdomId: string): Strategy[] {
  const seeds: Strategy[] = [];
  const taken = new Set<string>();
  for (const baseline of BASELINE_STRATEGIES) {
    const repaired = repairStrategy(kingdomId, baseline);
    const form = canonicalStrategy(repaired);
    if (taken.has(form)) continue;
    taken.add(form);
    seeds.push(repaired);
  }
  return seeds;
}

/**
 * The name each repaired baseline came from, so the report and the calibration gate can tell a fixed
 * baseline from an evolved strategy after `identify` has replaced every readable id with a hash.
 */
export function baselineLabels(kingdomId: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const baseline of BASELINE_STRATEGIES) {
    const repaired = repairStrategy(kingdomId, baseline);
    if (!labels.has(repaired.id)) labels.set(repaired.id, baseline.id);
  }
  return labels;
}

/**
 * The seeds first, then mutations of them, round robin over the seeds so no seed dominates. A slot
 * whose mutation keeps landing on a form the population already holds is left empty, so the
 * population can come back a little short of `size`; the generation records what it actually ran.
 */
export function seedPopulation(kingdomId: string, runSeed: number, size: number): Strategy[] {
  const seeds = seedStrategies(kingdomId);
  const population = seeds.slice(0, size);
  const taken = new Set(population.map(canonicalStrategy));
  for (let index = population.length; index < size; index += 1) {
    const parent = seeds[(index - seeds.length) % seeds.length]!;
    const child = mutateUnique(kingdomId, parent, taken, runSeed, 0, index);
    const form = canonicalStrategy(child);
    if (taken.has(form)) continue;
    taken.add(form);
    population.push(child);
  }
  return population;
}
