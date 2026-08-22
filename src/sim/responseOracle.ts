import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean, raceCandidates } from './mixtureEvaluation';
import type { BootstrapInterval, MixtureSchedule, RaceRound } from './mixtureEvaluation';
import { neighbourhood } from './mutation';
import { emptyAggregate, mergeAggregate } from './pairing';
import type { PairingRunner } from './pairingRunner';
import { randomUniqueStrategies } from './randomStrategy';
import { RACE_TOTAL_SEEDS, namespaceSeeds, raceRoundSeeds } from './seedNamespaces';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';
import type { TelemetryAggregate } from './types';

export interface CandidateSources {
  requested: number;
  requestedLocal: number;
  requestedRandom: number;
  actual: number;
  local: number;
  random: number;
  duplicateRejections: number;
  localShortfall: number;
  randomShortfall: number;
}
export interface ResponseBatch { candidates: Strategy[]; sources: CandidateSources }
export interface ResponseResult {
  objective: 'global' | 'final';
  sources: CandidateSources;
  screenSchedule: MixtureSchedule;
  confirmSchedule: MixtureSchedule;
  bestTrainingMean: number;
  candidateId: string | null;
  heldOutMean: number | null;
  interval: BootstrapInterval | null;
  rounds: RaceRound[];
  admitted: boolean;
  matches: number;
  telemetry: TelemetryAggregate;
  screenTelemetry: TelemetryAggregate;
  confirmationTelemetry: TelemetryAggregate;
  failureReason: 'empty-batch' | null;
}

export function globalAdmission(mean: number, interval: BootstrapInterval): boolean {
  return mean >= 0.52 && interval.lower > 0.5;
}

export function allocateLocalCandidates(weights: Readonly<Record<string, number>>, count: number): [string, number][] {
  const entries = Object.entries(weights).filter((entry) => entry[1] > 0).sort(([a], [b]) => a.localeCompare(b));
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  const raw = entries.map(([id, weight]) => ({ id, exact: count * weight / total }));
  const result = raw.map(({ id, exact }) => [id, Math.floor(exact)] as [string, number]);
  const left = count - result.reduce((sum, entry) => sum + entry[1], 0);
  const byRemainder = raw.map((entry) => ({ ...entry, remainder: entry.exact - Math.floor(entry.exact) }))
    .sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
  for (let index = 0; index < left; index += 1) {
    const id = byRemainder[index]!.id;
    result.find((entry) => entry[0] === id)![1] += 1;
  }
  return result;
}

/**
 * Parents to search around: the two highest-weight support strategies, then a strategy that uses
 * cards neither parent uses.
 *
 * A one-strategy support sends every local candidate to the same parent, and that parent's own cards
 * then dominate the whole batch. Adding the least-represented strategies keeps a card the current
 * answer ignores in play, which is the only way a plan built on it is ever proposed.
 */
export function chooseParents(
  strategies: readonly Strategy[], weights: Readonly<Record<string, number>>, extra: number
): Strategy[] {
  const chosen = strategies.filter((strategy) => (weights[strategy.id] ?? 0) > 0)
    .sort((left, right) => (weights[right.id] ?? 0) - (weights[left.id] ?? 0)
      || left.id.localeCompare(right.id)).slice(0, 2);
  const cardsOf = (strategy: Strategy): Set<string> =>
    new Set([...strategy.startingBuild,
      ...strategy.buyPlan.flatMap((slot) => slot.kind === 'buy' ? [slot.cardId] : [])]);
  const covered = new Set(chosen.flatMap((strategy) => [...cardsOf(strategy)]));
  const rest = strategies.filter((strategy) => !chosen.includes(strategy));
  for (let added = 0; added < extra; added += 1) {
    let bestStrategy: Strategy | null = null;
    let bestNew = 0;
    for (const strategy of rest) {
      if (chosen.includes(strategy)) continue;
      const fresh = [...cardsOf(strategy)].filter((cardId) => !covered.has(cardId)).length;
      if (fresh > bestNew || (fresh === bestNew && bestStrategy
        && strategy.id.localeCompare(bestStrategy.id) < 0 && fresh > 0)) {
        bestStrategy = strategy; bestNew = fresh;
      }
    }
    if (!bestStrategy) break;
    chosen.push(bestStrategy);
    for (const cardId of cardsOf(bestStrategy)) covered.add(cardId);
  }
  return chosen;
}

export const DIVERSITY_PARENTS = 1;

/**
 * The batch is every strategy one change away from each parent, plus a random tail.
 *
 * Sampling a few mutations leaves most of the neighbourhood untried, and a change that only pays off
 * with a second change is invisible either way. Enumerating removes the sampling; the random tail is
 * what reaches plans no single change can build.
 */
export function generateResponseBatch(options: {
  kingdomId: string; seed: number; count: number; parents: ReadonlyMap<string, Strategy>;
  weights: Readonly<Record<string, number>>; existing: readonly Strategy[];
}): ResponseBatch {
  const taken = new Set(options.existing.map(canonicalStrategy));
  const candidates: Strategy[] = [];
  let duplicateRejections = 0;
  const parents = chooseParents([...options.parents.values()], options.weights, DIVERSITY_PARENTS);
  for (const parent of parents) {
    for (const child of neighbourhood(options.kingdomId, parent)) {
      const form = canonicalStrategy(child);
      if (taken.has(form)) { duplicateRejections += 1; continue; }
      taken.add(form); candidates.push(child);
    }
  }
  const local = candidates.length;
  const randomResult = randomUniqueStrategies(options.kingdomId, options.seed ^ 0xa53c9e1d,
    options.count, taken);
  candidates.push(...randomResult.strategies);
  duplicateRejections += randomResult.duplicateRejections;
  return { candidates, sources: {
    // `count` is the random-tail budget. Exhaustive local proposals are intentionally additional.
    requested: local + options.count, requestedLocal: local, requestedRandom: options.count,
    actual: candidates.length, local, random: randomResult.strategies.length, duplicateRejections,
    localShortfall: 0, randomShortfall: randomResult.shortfall
  } };
}

export async function runResponseSearch(options: {
  objective: 'global'; targetWeights: Readonly<Record<string, number>>;
  strategies: readonly Strategy[]; kingdomId: string; runSeed: number; restart: number; attempt: number;
  candidateCount: number; blocks: number; turnLimitPerPlayer: number; actionCapPerTurn: number;
  runner: PairingRunner; deadline?: number | undefined;
  batchFactory?: typeof generateResponseBatch | undefined;
}): Promise<{ result: ResponseResult | null; candidate: Strategy | null }> {
  const strategyMap = new Map(options.strategies.map((strategy) => [strategy.id, strategy]));
  const seed = namespaceSeeds(options.runSeed, 'global-race', 1, options.restart, options.attempt)[0]!;
  const makeBatch = options.batchFactory ?? generateResponseBatch;
  const batch = makeBatch({
    kingdomId: options.kingdomId, seed, count: options.candidateCount, parents: strategyMap,
    weights: options.targetWeights, existing: options.strategies
  });
  const raceSeeds = namespaceSeeds(options.runSeed, 'global-race', RACE_TOTAL_SEEDS,
    options.restart, options.attempt);
  const confirmSeeds = namespaceSeeds(options.runSeed, 'global-confirm', options.blocks,
    options.restart, options.attempt);
  const screenSchedule = mixtureSchedule(options.targetWeights, raceSeeds, seed ^ 0x45d9f3b);
  const confirmSchedule = mixtureSchedule(options.targetWeights, confirmSeeds, seed ^ 0x119de1f3);
  if (!batch.candidates.length) {
    return { candidate: null, result: {
      objective: 'global',
      sources: batch.sources, screenSchedule, confirmSchedule, bestTrainingMean: 0,
      candidateId: null, heldOutMean: null, interval: null, rounds: [],
      admitted: false, matches: 0, telemetry: emptyAggregate(),
      screenTelemetry: emptyAggregate(), confirmationTelemetry: emptyAggregate(),
      failureReason: 'empty-batch'
    } };
  }
  const race = await raceCandidates(batch.candidates, strategyMap, options.targetWeights,
    raceRoundSeeds(raceSeeds), seed ^ 0x45d9f3b, options.runner, options);
  const best = race.best!;
  const confirmed = await evaluateCandidates([best.strategy], strategyMap, confirmSchedule, options.runner, options);
  const values = confirmed[0]!.blockScores;
  const matches = race.matches + confirmed[0]!.matches;
  const screenTelemetry = race.telemetry;
  const confirmationTelemetry = emptyAggregate();
  mergeAggregate(confirmationTelemetry, confirmed[0]!.telemetry);
  const bootstrapSeed = namespaceSeeds(options.runSeed, 'bootstrap', 1, options.restart, options.attempt)[0]!;
  const interval = percentileBootstrapMean(values, bootstrapSeed);
  const admitted = globalAdmission(confirmed[0]!.mean, interval);
  return { candidate: best.strategy, result: {
    objective: 'global',
    sources: batch.sources, screenSchedule, confirmSchedule, bestTrainingMean: best.mean,
    candidateId: best.strategy.id, heldOutMean: confirmed[0]!.mean, interval, rounds: race.rounds,
    admitted, matches, screenTelemetry, confirmationTelemetry, failureReason: null,
    telemetry: (() => {
      const total = emptyAggregate();
      mergeAggregate(total, screenTelemetry); mergeAggregate(total, confirmationTelemetry); return total;
    })()
  } };
}
