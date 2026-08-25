import { SeededRandom } from '../game';
import { emptyAggregate, mergeAggregate } from './pairing';
import type { PairingRunner } from './pairingRunner';
import type { Strategy } from './strategy';
import type { TelemetryAggregate } from './types';
import { DeadlineInterruptionError, InvalidEvaluationError } from './payoffMatrix';

export interface MixtureBlock { seed: number; opponentId: string }
export interface MixtureSchedule {
  targetWeights: Record<string, number>;
  blocks: MixtureBlock[];
  realizedOpponentCounts: Record<string, number>;
  unsampledPositiveWeightStrategies: string[];
}
export interface BootstrapInterval { lower: number; upper: number }
export interface CandidateEvaluation {
  strategy: Strategy;
  mean: number;
  blockScores: number[];
  interval: BootstrapInterval | null;
  matches: number;
  telemetry: TelemetryAggregate;
}

export function mixtureSchedule(
  weights: Readonly<Record<string, number>>, seeds: readonly number[], samplingSeed: number
): MixtureSchedule {
  const entries = Object.entries(weights).filter((entry) => entry[1] > 0).sort(([a], [b]) => a.localeCompare(b));
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  if (!entries.length || !(total > 0)) throw new Error('A mixture schedule needs positive weights.');
  const random = new SeededRandom(samplingSeed);
  const realizedOpponentCounts: Record<string, number> = Object.fromEntries(entries.map(([id]) => [id, 0]));
  const blocks = seeds.map((seed) => {
    const point = random.nextInt(0x1000000) / 0x1000000 * total;
    let running = 0;
    let opponentId = entries.at(-1)![0];
    for (const [id, weight] of entries) { running += weight; if (point < running) { opponentId = id; break; } }
    realizedOpponentCounts[opponentId] = (realizedOpponentCounts[opponentId] ?? 0) + 1;
    return { seed, opponentId };
  });
  return {
    targetWeights: Object.fromEntries(entries), blocks, realizedOpponentCounts,
    unsampledPositiveWeightStrategies: entries.map(([id]) => id).filter((id) => !realizedOpponentCounts[id])
  };
}

export function percentileBootstrapMean(
  values: readonly number[], seed: number, samples = 2000
): BootstrapInterval {
  if (!values.length) throw new Error('Bootstrap needs at least one complete block.');
  const random = new SeededRandom(seed);
  const means = Array.from({ length: samples }, () => {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[random.nextInt(values.length)]!;
    return total / values.length;
  }).sort((a, b) => a - b);
  return { lower: means[Math.floor(samples * 0.025)]!, upper: means[Math.ceil(samples * 0.975) - 1]! };
}

export async function evaluateCandidates(
  candidates: readonly Strategy[], opponents: ReadonlyMap<string, Strategy>, schedule: MixtureSchedule,
  runner: PairingRunner, options: {
    kingdomId: string; turnLimitPerPlayer: number; actionCapPerTurn: number;
    startingDraftEnabled?: boolean | undefined; deadline?: number | undefined;
    scoreOnly?: boolean | undefined;
  }
): Promise<CandidateEvaluation[]> {
  const jobs = candidates.flatMap((candidate) => schedule.blocks.map((block) => {
    const opponent = opponents.get(block.opponentId);
    if (!opponent) throw new Error(`Mixture opponent ${block.opponentId} is missing.`);
    return { candidate, opponent, scoreOnly: options.scoreOnly ?? false, options: {
      kingdomId: options.kingdomId, seeds: [block.seed],
      turnLimitPerPlayer: options.turnLimitPerPlayer, actionCapPerTurn: options.actionCapPerTurn,
      startingDraftEnabled: options.startingDraftEnabled ?? true, allowEarlyStop: false
    } };
  }));
  const batch = await runner.run(jobs, { deadline: options.deadline });
  if (batch.submitted !== jobs.length) throw new DeadlineInterruptionError('Deadline interrupted a mixture evaluation.', {
    submitted: batch.submitted, expected: jobs.length
  });
  const evaluations: CandidateEvaluation[] = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const telemetry = emptyAggregate();
    const blockScores: number[] = [];
    let matches = 0;
    for (let blockIndex = 0; blockIndex < schedule.blocks.length; blockIndex += 1) {
      const result = batch.outcomes[candidateIndex * schedule.blocks.length + blockIndex];
      if (!result) throw new DeadlineInterruptionError('Mixture evaluation returned no result.', {
        strategyId: candidates[candidateIndex]!.id, block: blockIndex
      });
      if (result.record.aborted > 0 || result.blocks[0]?.played !== 4) {
        throw new InvalidEvaluationError('An aborted match invalidated a mixture evaluation.', {
          strategyId: candidates[candidateIndex]!.id, seed: schedule.blocks[blockIndex]!.seed,
          opponentId: schedule.blocks[blockIndex]!.opponentId,
          orientation: result.aborts[0]?.orientationIndex, reason: result.aborts[0]?.reason
        });
      }
      blockScores.push(result.blocks[0]!.score);
      matches += result.matches;
      mergeAggregate(telemetry, result.telemetry);
    }
    evaluations.push({
      strategy: candidates[candidateIndex]!,
      mean: blockScores.reduce((sum, score) => sum + score, 0) / blockScores.length,
      blockScores, interval: null, matches, telemetry
    });
  }
  return evaluations;
}

export interface RaceRound { seeds: readonly number[]; entered: number; survivors: number }
export interface RaceResult {
  best: CandidateEvaluation | null;
  rounds: RaceRound[];
  matches: number;
  telemetry: TelemetryAggregate;
}

/** Survivors per round. A third keeps the race short without discarding a whole tier at once. */
export const RACE_SURVIVOR_SHARE = 3;
export const RACE_FLOOR = 3;

/**
 * Successive halving. Every candidate gets a cheap look, and only the ones still standing pay for
 * more games, so the same match budget buys about ten times the evidence behind the winner.
 *
 * One-shot argmax over noisy means is biased upward: the winner is usually a weak candidate that
 * got lucky, it then fails its confirmation, and the search concludes nothing better exists. A race
 * makes that outcome rare, because surviving four rounds on four disjoint seed sets is not luck.
 */
export async function raceCandidates(
  candidates: readonly Strategy[], opponents: ReadonlyMap<string, Strategy>,
  weights: Readonly<Record<string, number>>, roundSeeds: readonly (readonly number[])[],
  samplingSeed: number, runner: PairingRunner, options: {
    kingdomId: string; turnLimitPerPlayer: number; actionCapPerTurn: number;
    startingDraftEnabled?: boolean | undefined; deadline?: number | undefined;
  }
): Promise<RaceResult> {
  const telemetry = emptyAggregate();
  const rounds: RaceRound[] = [];
  let matches = 0;
  let field = [...candidates];
  let best: CandidateEvaluation | null = null;
  for (let round = 0; round < roundSeeds.length && field.length; round += 1) {
    const seeds = roundSeeds[round]!;
    const schedule = mixtureSchedule(weights, seeds, samplingSeed ^ (round + 1));
    const evaluations = await evaluateCandidates(field, opponents, schedule, runner, options);
    evaluations.sort((left, right) => right.mean - left.mean
      || left.strategy.id.localeCompare(right.strategy.id));
    for (const evaluation of evaluations) { matches += evaluation.matches; mergeAggregate(telemetry, evaluation.telemetry); }
    best = evaluations[0]!;
    const survivors = Math.max(RACE_FLOOR, Math.ceil(field.length / RACE_SURVIVOR_SHARE));
    rounds.push({ seeds, entered: field.length, survivors: Math.min(survivors, evaluations.length) });
    if (evaluations.length <= RACE_FLOOR) break;
    field = evaluations.slice(0, survivors).map((evaluation) => evaluation.strategy);
  }
  return { best, rounds, matches, telemetry };
}
