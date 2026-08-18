import { BASELINE_STRATEGIES } from './baselines';
import { mutateUnique, repairStrategy } from './mutation';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

/**
 * The five fixed baselines, each repaired into the kingdom it will play in. Repairing here rather
 * than at match time is what makes the strategy recorded in the results the strategy that played.
 *
 * Several baselines lose most of their shape in several kingdoms. Plan `10-4` allows that, so it is
 * left alone: hand-written per-kingdom seeds would be new strategy content that no approved document
 * authorises. `seedFindings` reports what each kingdom cost its seeds, so the run can say so.
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

export interface SeedFinding {
  baselineId: string;
  strategyId: string;
  buildDropped: number;
  agendaDropped: number;
  /** The kingdom sells nothing this baseline was buying, so it seeded with no agenda at all. */
  degenerate: boolean;
}

/**
 * What the kingdom cost each baseline at seeding, listing only the baselines that lost something.
 *
 * This is a named result, not a footnote: generation 1 is measured against these seeds, so a kingdom
 * that guts several of them produces generation-1 scores that carry little signal. The run reports
 * it rather than hiding it, because the alternative reading — that generation 1 was a fair contest —
 * is wrong. `treasure-only` never appears; its empty build and empty agenda are its design, not a
 * loss.
 */
export function seedFindings(kingdomId: string): SeedFinding[] {
  const findings: SeedFinding[] = [];
  for (const baseline of BASELINE_STRATEGIES) {
    const repaired = repairStrategy(kingdomId, baseline);
    const buildDropped = baseline.startingBuild.length - repaired.startingBuild.length;
    const agendaDropped = baseline.buyAgenda.length - repaired.buyAgenda.length;
    if (buildDropped === 0 && agendaDropped === 0) continue;
    findings.push({
      baselineId: baseline.id,
      strategyId: repaired.id,
      buildDropped,
      agendaDropped,
      degenerate: repaired.buyAgenda.length === 0
    });
  }
  return findings;
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
