import { SeededRandom } from '../game';
import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean } from './mixtureEvaluation';
import type { BootstrapInterval, MixtureSchedule } from './mixtureEvaluation';
import { mutate } from './mutation';
import { emptyAggregate, mergeAggregate } from './pairing';
import type { PairingRunner } from './pairingRunner';
import { randomUniqueStrategies } from './randomStrategy';
import { namespaceSeeds } from './seedNamespaces';
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

export function generateResponseBatch(options: {
  kingdomId: string; seed: number; count: number; parents: ReadonlyMap<string, Strategy>;
  weights: Readonly<Record<string, number>>; existing: readonly Strategy[];
}): ResponseBatch {
  const requestedLocal = Math.floor(options.count * 0.7);
  const requestedRandom = options.count - requestedLocal;
  const taken = new Set(options.existing.map(canonicalStrategy));
  const candidates: Strategy[] = [];
  let duplicateRejections = 0;
  for (const [parentId, target] of allocateLocalCandidates(options.weights, requestedLocal)) {
    const parent = options.parents.get(parentId);
    if (!parent) continue;
    const random = new SeededRandom(Number.parseInt(parent.id.slice(3, 11), 16) ^ options.seed);
    for (let attempt = 0, made = 0; attempt < target * 64 + 32 && made < target; attempt += 1) {
      const child = mutate(options.kingdomId, parent, random);
      const form = canonicalStrategy(child);
      if (taken.has(form)) { duplicateRejections += 1; continue; }
      taken.add(form); candidates.push(child); made += 1;
    }
  }
  const local = candidates.length;
  const localShortfall = requestedLocal - local;
  const randomRequestedWithFill = requestedRandom + localShortfall;
  const randomResult = randomUniqueStrategies(options.kingdomId, options.seed ^ 0xa53c9e1d,
    randomRequestedWithFill, taken);
  candidates.push(...randomResult.strategies);
  duplicateRejections += randomResult.duplicateRejections;
  return { candidates, sources: {
    requested: options.count, requestedLocal, requestedRandom, actual: candidates.length,
    local, random: randomResult.strategies.length, duplicateRejections, localShortfall,
    randomShortfall: randomResult.shortfall
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
  const seed = namespaceSeeds(options.runSeed, 'global-screen', 1, options.restart, options.attempt)[0]!;
  const makeBatch = options.batchFactory ?? generateResponseBatch;
  const batch = makeBatch({
    kingdomId: options.kingdomId, seed, count: options.candidateCount, parents: strategyMap,
    weights: options.targetWeights, existing: options.strategies
  });
  const screenSeeds = namespaceSeeds(options.runSeed, 'global-screen', options.blocks, options.restart, options.attempt);
  const confirmSeeds = namespaceSeeds(options.runSeed, 'global-confirm', options.blocks, options.restart, options.attempt);
  const screenSchedule = mixtureSchedule(options.targetWeights, screenSeeds, seed ^ 0x45d9f3b);
  const confirmSchedule = mixtureSchedule(options.targetWeights, confirmSeeds, seed ^ 0x119de1f3);
  if (!batch.candidates.length) {
    return { candidate: null, result: {
      objective: 'global',
      sources: batch.sources, screenSchedule, confirmSchedule, bestTrainingMean: 0,
      candidateId: null, heldOutMean: null, interval: null,
      admitted: false, matches: 0, telemetry: emptyAggregate(),
      screenTelemetry: emptyAggregate(), confirmationTelemetry: emptyAggregate(),
      failureReason: 'empty-batch'
    } };
  }
  const training = await evaluateCandidates(batch.candidates, strategyMap, screenSchedule, options.runner, options);
  training.sort((a, b) => b.mean - a.mean || a.strategy.id.localeCompare(b.strategy.id));
  const best = training[0]!;
  const confirmed = await evaluateCandidates([best.strategy], strategyMap, confirmSchedule, options.runner, options);
  const values = confirmed[0]!.blockScores;
  const matches = training.reduce((sum, entry) => sum + entry.matches, 0) + confirmed[0]!.matches;
  const screenTelemetry = emptyAggregate();
  for (const evaluation of training) mergeAggregate(screenTelemetry, evaluation.telemetry);
  const confirmationTelemetry = emptyAggregate();
  mergeAggregate(confirmationTelemetry, confirmed[0]!.telemetry);
  const bootstrapSeed = namespaceSeeds(options.runSeed, 'bootstrap', 1, options.restart, options.attempt)[0]!;
  const interval = percentileBootstrapMean(values, bootstrapSeed);
  const admitted = globalAdmission(confirmed[0]!.mean, interval);
  return { candidate: best.strategy, result: {
    objective: 'global',
    sources: batch.sources, screenSchedule, confirmSchedule, bestTrainingMean: best.mean,
    candidateId: best.strategy.id, heldOutMean: confirmed[0]!.mean, interval,
    admitted, matches, screenTelemetry, confirmationTelemetry, failureReason: null,
    telemetry: (() => {
      const total = emptyAggregate();
      mergeAggregate(total, screenTelemetry); mergeAggregate(total, confirmationTelemetry); return total;
    })()
  } };
}
