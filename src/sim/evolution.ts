import { MUTATION_ATTEMPTS, mutateUnique } from './mutation';
import { emptyAggregate, mergeAggregate, sharedSeedList } from './pairing';
import { InlinePairingRunner } from './pairingRunner';
import type { PairingJob, PairingRunner } from './pairingRunner';
import { seedPopulation, seedStrategies } from './seedPopulation';
import { canonicalStrategy, registerIdentity } from './strategy';
import type { Strategy } from './strategy';
import type { EvolutionConfig, GenerationResult, ScoredStrategy, TelemetryAggregate } from './types';

/** The seed population must hold all five fixed strategies before it holds a single mutant. */
export const MIN_CANDIDATES = 5;

/**
 * Every limit is rejected, never clamped. A silently clamped limit would be recorded in the report as
 * the limit the caller asked for, and `GOAL.md` requires the actual limits.
 */
export function validateEvolutionConfig(config: EvolutionConfig): void {
  const positive = (name: string, value: number): void => {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer, not ${value}.`);
  };
  positive('candidates', config.candidates);
  positive('leaders', config.leaders);
  positive('generations', config.generations);
  positive('sharedSeeds', config.sharedSeeds);
  positive('turnLimitPerPlayer', config.turnLimitPerPlayer);
  positive('actionCapPerTurn', config.actionCapPerTurn);
  if (config.sharedSeeds > 25) throw new Error(`sharedSeeds may be at most 25, not ${config.sharedSeeds}.`);
  if (config.candidates < MIN_CANDIDATES) {
    throw new Error(`candidates must be at least ${MIN_CANDIDATES}, so the fixed seeds all fit, not ${config.candidates}.`);
  }
  if (config.leaders > config.candidates) {
    throw new Error(`leaders (${config.leaders}) cannot exceed candidates (${config.candidates}).`);
  }
}

interface Tally {
  strategy: Strategy;
  pairingScore: number;
  completedPairings: number;
  completedGames: number;
  abortedGames: number;
}

function scored(tally: Tally): ScoredStrategy {
  return {
    strategy: tally.strategy,
    score: tally.completedPairings ? tally.pairingScore / tally.completedPairings : 0,
    completedPairings: tally.completedPairings,
    completedGames: tally.completedGames,
    abortedGames: tally.abortedGames
  };
}

/**
 * Score descending, then the stable hash of the canonical form, then the canonical form itself so a
 * hash collision is still decided. A candidate with no completed game ranks below every candidate
 * that finished one, however badly it did: ranking by mean over zero games has no meaning.
 */
export function compareScored(left: ScoredStrategy, right: ScoredStrategy): number {
  if ((left.completedPairings === 0) !== (right.completedPairings === 0)) return left.completedPairings === 0 ? 1 : -1;
  if (left.score !== right.score) return right.score - left.score;
  if (left.strategy.id !== right.strategy.id) return left.strategy.id < right.strategy.id ? -1 : 1;
  const leftForm = canonicalStrategy(left.strategy);
  const rightForm = canonicalStrategy(right.strategy);
  return leftForm < rightForm ? -1 : leftForm > rightForm ? 1 : 0;
}

/**
 * Sorts under one comparator, drops exact duplicates, then truncates. That order matters: truncating
 * first would truncate an under-determined list, and the tiebreak could never decide anything.
 *
 * "Meaningfully different" is exact-duplicate removal and nothing more. The first run has no data to
 * define a distance metric on, and an arbitrary threshold would hide real results.
 */
export function selectLeaders(candidates: readonly ScoredStrategy[], limit: number): ScoredStrategy[] {
  const ordered = [...candidates].sort(compareScored);
  const seen = new Set<string>();
  const kept: ScoredStrategy[] = [];
  for (const entry of ordered) {
    const form = canonicalStrategy(entry.strategy);
    if (seen.has(form)) continue;
    seen.add(form);
    kept.push(entry);
    if (kept.length === limit) break;
  }
  return kept;
}

/**
 * The next population: the leaders themselves, so a leader is re-scored, then mutations of them. Every
 * slot is filled or the run fails. A population that quietly came back short would make `matchCount`,
 * every score, and every runtime estimate derived from them wrong, with nothing in the output saying so.
 */
export function nextPopulation(
  kingdomId: string, leaders: readonly Strategy[], size: number, runSeed: number, generation: number
): Strategy[] {
  const population = leaders.slice(0, size);
  const taken = new Set(population.map(canonicalStrategy));
  for (let index = population.length; index < size; index += 1) {
    const parent = leaders[(index - leaders.length) % leaders.length]!;
    const child = mutateUnique(kingdomId, parent, taken, runSeed, generation, index);
    if (!child) {
      throw new Error(
        `Generation ${generation} in ${kingdomId} found no new candidate for slot ${index + 1} of ${size} in ${MUTATION_ATTEMPTS} attempts.`
      );
    }
    taken.add(canonicalStrategy(child));
    population.push(child);
  }
  return population;
}

/** One entrant per generation for the final tournament: the generation's best leader. */
export function retainedLeaders(generations: readonly GenerationResult[]): Strategy[] {
  const kept: Strategy[] = [];
  const seen = new Set<string>();
  for (const generation of generations) {
    const best = generation.leaders[0];
    if (!best) continue;
    const form = canonicalStrategy(best.strategy);
    if (seen.has(form)) continue;
    seen.add(form);
    kept.push(best.strategy);
  }
  return kept;
}

/**
 * Runs the generations. Determinism is claimed for deadline-free runs only: a wall-clock deadline and
 * exact reproducibility cannot both hold, so tests inject `now`.
 *
 * The deadline is checked between pairings, not between generations. A full generation is thousands
 * of matches, so a generation-boundary check could overshoot the reserve in `GOAL.md` by hours. A
 * generation cut short still reports through `onGeneration` with `partial: true` and keeps every
 * match it finished.
 */
export async function evolve(
  config: EvolutionConfig,
  onGeneration: (result: GenerationResult) => void,
  runner: PairingRunner = new InlinePairingRunner()
): Promise<GenerationResult[]> {
  validateEvolutionConfig(config);
  const now = config.now ?? Date.now;
  const expired = (): boolean => config.deadline !== undefined && now() >= config.deadline;
  const seeds = sharedSeedList(config.seed, config.sharedSeeds);

  // Generation 1 has no previous leaders, so all five fixed seeds are the first leader set,
  // whatever `leaders` says. That limit governs generation 2 onward, and every generation-1 score
  // depends on this.
  let leaders: Strategy[] = seedStrategies(config.kingdomId);
  let population = seedPopulation(config.kingdomId, config.seed, config.candidates);
  const results: GenerationResult[] = [];

  for (let generation = 1; generation <= config.generations; generation += 1) {
    const started = now();
    const tallies = new Map<string, Tally>();
    const known = new Map<string, string>();
    const tally = (strategy: Strategy): Tally => {
      registerIdentity(known, strategy);
      let found = tallies.get(strategy.id);
      if (!found) {
        found = { strategy, pairingScore: 0, completedPairings: 0, completedGames: 0, abortedGames: 0 };
        tallies.set(strategy.id, found);
      }
      return found;
    };
    for (const candidate of population) tally(candidate);
    // The leaders too: a leader that collided with a candidate would be skipped as a self-pair.
    for (const leader of leaders) registerIdentity(known, leader);

    const telemetry: TelemetryAggregate = emptyAggregate();
    let matchCount = 0;
    let overflowCount = 0;
    let partial = false;
    const jobs: PairingJob[] = [];
    const jobCandidates: Strategy[] = [];
    for (const candidate of population) {
      for (const opponent of leaders) {
        // A strategy never plays itself. Identity is the canonical form, so a mutant that landed back
        // on its parent's shape is the same entrant, not a new one.
        if (candidate.id === opponent.id) continue;
        jobs.push({ candidate, opponent, options: {
          kingdomId: config.kingdomId, seeds, stateLimit: config.stateLimit,
          turnLimitPerPlayer: config.turnLimitPerPlayer, actionCapPerTurn: config.actionCapPerTurn
        } });
        jobCandidates.push(candidate);
      }
    }
    const batch = await runner.run(jobs, { deadline: config.deadline, now });
    partial = batch.submitted < jobs.length;
    const pairingStops = { significant: 0, maximum: 0 };
    const seedBlockCounts: Record<string, number> = {};
    const pairingsPlayed: { candidateId: string; opponentId: string }[] = [];
    for (let index = 0; index < batch.outcomes.length; index += 1) {
      const outcome = batch.outcomes[index];
      if (!outcome) continue;
      const candidate = jobCandidates[index]!;
        const job = jobs[index]!;
        pairingsPlayed.push({ candidateId: candidate.id, opponentId: job.opponent.id });
        matchCount += outcome.matches;
        overflowCount += outcome.record.aborted;
        mergeAggregate(telemetry, outcome.telemetry);
        pairingStops[outcome.stopReason] += 1;
        seedBlockCounts[String(outcome.seedBlocks)] = (seedBlockCounts[String(outcome.seedBlocks)] ?? 0) + 1;

        // Only the candidate side is tallied. A leader is also a candidate, so scoring the opponent
        // side too would give it a second record taken against the mutants it is being compared with,
        // while a mutant's whole record is against the leaders. The means would then measure two
        // different fields, incumbents would outrank mutants independent of merit, and the population
        // would stall on generation 1's leaders — the fixed seeds.
        const candidateTally = tally(candidate);
        if (outcome.candidateMean !== null) {
          candidateTally.pairingScore += outcome.candidateMean;
          candidateTally.completedPairings += 1;
        }
        candidateTally.completedGames += outcome.record.played;
        candidateTally.abortedGames += outcome.record.aborted;
    }

    const ranked = population.map((candidate) => scored(tally(candidate)));
    const nextLeaders = selectLeaders(ranked, config.leaders);
    const scores: Record<string, number> = {};
    for (const entry of ranked) scores[entry.strategy.id] = entry.score;

    const result: GenerationResult = {
      generation, partial, leaders: nextLeaders, scores, matchCount, overflowCount,
      elapsedMs: now() - started, telemetry, pairingStops, seedBlockCounts, pairingsPlayed
    };
    results.push(result);
    onGeneration(result);
    if (partial || expired()) break;

    leaders = nextLeaders.map((entry) => entry.strategy);
    population = nextPopulation(config.kingdomId, leaders, config.candidates, config.seed, generation + 1);
  }
  return results;
}
