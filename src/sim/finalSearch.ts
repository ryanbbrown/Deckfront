import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean, raceCandidates } from './mixtureEvaluation';
import { emptyAggregate, mergeAggregate } from './pairing';
import type { PairingRunner } from './pairingRunner';
import { randomUniqueStrategies } from './randomStrategy';
import { globalAdmission } from './responseOracle';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';
import type { ResponseResult } from './responseOracle';
import { RACE_TOTAL_SEEDS, raceRoundSeeds } from './seedNamespaces';
import type { FinalSearchSeeds } from './seedNamespaces';

export const FINAL_SEARCH_CANDIDATES = 3_000;
export const FINAL_SEARCH_SCREEN_BLOCKS = RACE_TOTAL_SEEDS;
export const FINAL_SEARCH_CONFIRM_BLOCKS = 25;

export interface FinalSearchOptions {
  targetWeights: Readonly<Record<string, number>>;
  strategies: readonly Strategy[];
  kingdomId: string;
  seeds: FinalSearchSeeds;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  runner: PairingRunner;
  deadline?: number | undefined;
}

export interface FinalSearchOutcome {
  result: ResponseResult;
  candidate: Strategy | null;
}

export async function runFinalSearch(options: FinalSearchOptions): Promise<FinalSearchOutcome> {
  if (options.seeds.screen.length !== FINAL_SEARCH_SCREEN_BLOCKS
    || options.seeds.confirmation.length !== FINAL_SEARCH_CONFIRM_BLOCKS
    || options.seeds.bootstrap.length !== 1) {
    throw new Error('The final search received an incomplete seed schedule.');
  }
  const opponents = new Map(options.strategies.map((strategy) => [strategy.id, strategy]));
  const generated = randomUniqueStrategies(options.kingdomId, options.seeds.candidate[0]!,
    FINAL_SEARCH_CANDIDATES, new Set(options.strategies.map(canonicalStrategy)));
  if (generated.shortfall) {
    throw new Error(`The final search generated ${generated.strategies.length} of ${FINAL_SEARCH_CANDIDATES} strategies.`);
  }
  const sources = {
    requested: FINAL_SEARCH_CANDIDATES, requestedLocal: 0, requestedRandom: FINAL_SEARCH_CANDIDATES,
    actual: generated.strategies.length, local: 0, random: generated.strategies.length,
    duplicateRejections: generated.duplicateRejections, localShortfall: 0,
    randomShortfall: generated.shortfall
  };
  const screenSchedule = mixtureSchedule(options.targetWeights, options.seeds.screen,
    options.seeds.screenSampling[0]!);
  const confirmSchedule = mixtureSchedule(options.targetWeights, options.seeds.confirmation,
    options.seeds.confirmationSampling[0]!);
  if (!generated.strategies.length) {
    return { candidate: null, result: {
      objective: 'final', sources, screenSchedule, confirmSchedule,
      bestTrainingMean: 0, candidateId: null, heldOutMean: null, interval: null, rounds: [],
      admitted: false, matches: 0, telemetry: emptyAggregate(),
      screenTelemetry: emptyAggregate(), confirmationTelemetry: emptyAggregate(),
      failureReason: 'empty-batch'
    } };
  }
  const race = await raceCandidates(generated.strategies, opponents, options.targetWeights,
    raceRoundSeeds(options.seeds.screen), options.seeds.screenSampling[0]!, options.runner, options);
  const finalists = race.best ? [race.best] : [];
  const confirmed = await evaluateCandidates(finalists.map((entry) => entry.strategy), opponents,
    confirmSchedule, options.runner, options);
  const screenMeans = new Map(finalists.map((entry) => [entry.strategy.id, entry.mean]));
  const raceRounds = race.rounds;
  const ranked = confirmed.map((entry, index) => ({
    ...entry,
    interval: percentileBootstrapMean(entry.blockScores, options.seeds.bootstrap[index]!)
  })).sort((left, right) => right.mean - left.mean
    || right.interval.lower - left.interval.lower
    || left.strategy.id.localeCompare(right.strategy.id));
  const best = ranked[0]!;
  const admitted = ranked.find((entry) => globalAdmission(entry.mean, entry.interval)) ?? null;
  const screenTelemetry = race.telemetry;
  const confirmationTelemetry = emptyAggregate();
  for (const entry of confirmed) mergeAggregate(confirmationTelemetry, entry.telemetry);
  const telemetry = emptyAggregate();
  mergeAggregate(telemetry, screenTelemetry); mergeAggregate(telemetry, confirmationTelemetry);
  return { candidate: admitted?.strategy ?? best.strategy, result: {
    objective: 'final', sources, screenSchedule, confirmSchedule,
    bestTrainingMean: screenMeans.get((admitted ?? best).strategy.id)!,
    candidateId: (admitted ?? best).strategy.id, heldOutMean: (admitted ?? best).mean,
    interval: (admitted ?? best).interval, admitted: admitted !== null, rounds: raceRounds,
    matches: race.matches + confirmed.reduce((sum, entry) => sum + entry.matches, 0),
    telemetry, screenTelemetry, confirmationTelemetry, failureReason: null
  } };
}
