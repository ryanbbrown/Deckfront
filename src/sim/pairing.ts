import type { PlayerId } from '../game';
import { runSimulationMatch, runSimulationMatchScoreOnly } from './simulationKernel';
import type { Strategy } from './strategy';
import type { MatchResult, OrientationKey, PairRecord, SideKey, TelemetryAggregate } from './types';

export interface Orientation {
  firstPlayerId: PlayerId;
  swapSides: boolean;
}

/** One shuffle seed evaluates two games with fixed seats and alternating first players. */
export const ORIENTATIONS = Object.freeze([
  { firstPlayerId: 'ochre', swapSides: false },
  { firstPlayerId: 'indigo', swapSides: false }
] as const satisfies readonly Orientation[]);

export const GAMES_PER_SEED = ORIENTATIONS.length;

export function emptyPairRecord(): PairRecord {
  return { played: 0, wins: 0, draws: 0, losses: 0, aborted: 0 };
}

export function emptyAggregate(): TelemetryAggregate {
  const side = (): Record<SideKey, PairRecord> => ({ normal: emptyPairRecord(), swapped: emptyPairRecord() });
  return {
    acquisitionsByStrategy: {},
    planPositionPurchasesByStrategy: {},
    damageByCard: {},
    playsByCard: {},
    deadDraws: { range: 0, mana: 0, setup: 0, total: 0 },
    turnsToWin: { total: 0, count: 0 },
    byOrientation: { firstOchre: side(), firstIndigo: side() }
  };
}

function addCounts(into: Record<string, number>, from: Readonly<Record<string, number>>): void {
  for (const [key, amount] of Object.entries(from)) into[key] = (into[key] ?? 0) + amount;
}
function addRecord(into: PairRecord, from: PairRecord): void {
  into.played += from.played; into.wins += from.wins; into.draws += from.draws;
  into.losses += from.losses; into.aborted += from.aborted;
}

export function mergeAggregate(into: TelemetryAggregate, from: TelemetryAggregate): void {
  for (const [strategyId, counts] of Object.entries(from.acquisitionsByStrategy)) {
    into.acquisitionsByStrategy[strategyId] ??= {};
    addCounts(into.acquisitionsByStrategy[strategyId]!, counts);
  }
  into.planPositionPurchasesByStrategy ??= {};
  for (const [strategyId, counts] of Object.entries(from.planPositionPurchasesByStrategy ?? {})) {
    into.planPositionPurchasesByStrategy[strategyId] ??= {};
    addCounts(into.planPositionPurchasesByStrategy[strategyId]!, counts);
  }
  addCounts(into.damageByCard, from.damageByCard);
  addCounts(into.playsByCard, from.playsByCard);
  into.deadDraws.range += from.deadDraws.range;
  into.deadDraws.mana += from.deadDraws.mana;
  into.deadDraws.setup += from.deadDraws.setup;
  into.deadDraws.total += from.deadDraws.total;
  into.turnsToWin.total += from.turnsToWin.total;
  into.turnsToWin.count += from.turnsToWin.count;
  for (const first of ['firstOchre', 'firstIndigo'] as const) {
    for (const side of ['normal', 'swapped'] as const) {
      addRecord(into.byOrientation[first][side], from.byOrientation[first][side]);
    }
  }
}

/** Acquisition is the starting build plus purchases. An agenda entry never acquired is not one. */
function acquisitions(result: MatchResult, seat: PlayerId): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cardId of result.telemetry.startingBuild[seat]) counts[cardId] = (counts[cardId] ?? 0) + 1;
  addCounts(counts, result.telemetry.purchasesByCard[seat]);
  return counts;
}

function planPositionPurchases(result: MatchResult, seat: PlayerId, strategy: Strategy): Record<string, number> {
  const starting: Record<string, number> = {};
  for (const cardId of result.telemetry.startingBuild[seat]) starting[cardId] = (starting[cardId] ?? 0) + 1;
  const final = Object.fromEntries(Object.entries(result.telemetry.purchasesByCard[seat])
    .map(([cardId, purchases]) => [cardId, (starting[cardId] ?? 0) + purchases]));
  const previousTarget = { ...starting }; const positions: Record<string, number> = {};
  strategy.buyPlan.forEach((slot, position) => {
    if (slot.kind !== 'buy') return;
    const lower = previousTarget[slot.cardId] ?? 0;
    const upper = Math.max(lower, slot.desiredCount);
    const reached = Math.max(0, Math.min(final[slot.cardId] ?? lower, upper) - lower);
    if (reached) positions[String(position)] = reached;
    previousTarget[slot.cardId] = upper;
  });
  return positions;
}

export function recordMatch(
  into: TelemetryAggregate, result: MatchResult, orientation: Orientation,
  seatStrategies: Record<PlayerId, Strategy>
): void {
  for (const seat of ['ochre', 'indigo'] as const) {
    const strategy = seatStrategies[seat], strategyId = strategy.id;
    into.acquisitionsByStrategy[strategyId] ??= {};
    addCounts(into.acquisitionsByStrategy[strategyId]!, acquisitions(result, seat));
    into.planPositionPurchasesByStrategy ??= {};
    into.planPositionPurchasesByStrategy[strategyId] ??= {};
    addCounts(into.planPositionPurchasesByStrategy[strategyId]!, planPositionPurchases(result, seat, strategy));
    addCounts(into.damageByCard, result.telemetry.damageByCard[seat]);
    addCounts(into.playsByCard, result.telemetry.playsByCard[seat]);
    const dead = result.telemetry.deadDraws[seat];
    into.deadDraws.range += dead.range; into.deadDraws.mana += dead.mana;
    into.deadDraws.setup += dead.setup; into.deadDraws.total += dead.total;
  }
  if (result.telemetry.turnsToWin !== null) {
    into.turnsToWin.total += result.telemetry.turnsToWin;
    into.turnsToWin.count += 1;
  }
  const first: OrientationKey = orientation.firstPlayerId === 'ochre' ? 'firstOchre' : 'firstIndigo';
  const side: SideKey = orientation.swapSides ? 'swapped' : 'normal';
  const cell = into.byOrientation[first][side];
  if (result.outcome === 'aborted') cell.aborted += 1;
  else {
    cell.played += 1;
    if (result.outcome === 'ochre') cell.wins += 1;
    else if (result.outcome === 'indigo') cell.losses += 1;
    else cell.draws += 1;
  }
}

export interface PairingOptions {
  kingdomId: string;
  seeds: readonly number[];
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  startingDraftEnabled?: boolean | undefined;
  // Only preliminary payoff-matrix cells set this. Every other evaluation plays all shuffle seeds.
  allowEarlyStop?: boolean | undefined;
}

export interface SeedEvaluationResult {
  seed: number;
  score: number;
  played: number;
  aborted: number;
}
export interface PairingAbort {
  seed: number;
  orientationIndex: number;
  reason: MatchResult['reason'];
}

export interface PairingOutcome {
  record: PairRecord;        // the candidate's view of the pairing
  candidateScore: number;
  opponentScore: number;
  telemetry: TelemetryAggregate;
  matches: number;           // every game played, aborted ones included
  seedsEvaluated: number;
  stopReason: 'significant' | 'maximum';
  candidateMean: number | null;
  opponentMean: number | null;
  blocks: SeedEvaluationResult[];
  aborts: PairingAbort[];
}

export const SIGN_TEST_THRESHOLD = 0.0005;

export function isSignificantSignTest(pValue: number): boolean {
  return pValue <= SIGN_TEST_THRESHOLD;
}

/** Two-sided exact sign-test probability. Ties must be removed before calling this function. */
export function exactSignTest(positive: number, negative: number): number {
  const n = positive + negative;
  if (n === 0) return 1;
  const tail = Math.min(positive, negative);
  let combinations = 1;
  let sum = 1;
  for (let k = 1; k <= tail; k += 1) {
    combinations = combinations * (n - k + 1) / k;
    sum += combinations;
  }
  return Math.min(1, (2 * sum) / 2 ** n);
}

export function shouldStopPairing(
  completedSeeds: number, maximumSeeds: number, positive: number, negative: number
): boolean {
  return completedSeeds >= 5 && completedSeeds < maximumSeeds
    && isSignificantSignTest(exactSignTest(positive, negative));
}

export type PairingMatchRunner = typeof runSimulationMatch;

/**
 * Evaluates every shuffle seed in two games. Strategy A keeps the ochre seat and space 3. Strategy A
 * moves first in game one, and strategy B moves first in game two. Both games use the seed unchanged.
 * Production pairings use the compact simulation kernel. An injected runner is the test seam.
 *
 * An aborted game is recorded outside `played` and the mean. PSRO callers reject the complete cell
 * or evaluation when `aborted` is nonzero.
 */
function playPairingMode(
  candidate: Strategy, opponent: Strategy, options: PairingOptions,
  scoreOnly: boolean, matchRunner?: PairingMatchRunner
): PairingOutcome {
  if (options.seeds.length < 1 || options.seeds.length > 25) {
    throw new Error(`A pairing needs 1 to 25 shared seeds, not ${options.seeds.length}.`);
  }
  const record = emptyPairRecord();
  const telemetry = emptyAggregate();
  let candidateScore = 0;
  let opponentScore = 0;
  let matches = 0;
  let seedsEvaluated = 0;
  let positiveSeeds = 0;
  let negativeSeeds = 0;
  let stopReason: PairingOutcome['stopReason'] = 'maximum';
  const blocks: SeedEvaluationResult[] = [];
  const aborts: PairingAbort[] = [];
  let pairingAborted = false;

  for (const seed of options.seeds) {
    let seedScore = 0;
    let gamesCompleted = 0;
    for (let orientationIndex = 0; orientationIndex < ORIENTATIONS.length; orientationIndex += 1) {
      const orientation = ORIENTATIONS[orientationIndex]!;
      const seatStrategies: Record<PlayerId, Strategy> = { ochre: candidate, indigo: opponent };

      const result = (matchRunner ?? (scoreOnly ? runSimulationMatchScoreOnly : runSimulationMatch))({
          kingdomId: options.kingdomId,
          seed,
          firstPlayerId: orientation.firstPlayerId,
          swapSides: orientation.swapSides,
          turnLimitPerPlayer: options.turnLimitPerPlayer,
          actionCapPerTurn: options.actionCapPerTurn,
          startingDraftEnabled: options.startingDraftEnabled ?? true,
          strategies: seatStrategies
        });
      matches += 1;
      if (!scoreOnly) recordMatch(telemetry, result, orientation, seatStrategies);

      if (result.outcome === 'aborted') {
        record.aborted += 1;
        aborts.push({ seed, orientationIndex, reason: result.reason });
        pairingAborted = true;
        break;
      }
      record.played += 1;
      gamesCompleted += 1;
      if (result.outcome === 'draw') {
        record.draws += 1; candidateScore += 0.5; opponentScore += 0.5; seedScore += 0.5;
      } else if (result.outcome === 'ochre') {
        record.wins += 1; candidateScore += 1; seedScore += 1;
      } else {
        record.losses += 1; opponentScore += 1;
      }
    }
    seedsEvaluated += 1;
    blocks.push({ seed, score: gamesCompleted ? seedScore / gamesCompleted : 0, played: gamesCompleted,
      aborted: pairingAborted ? 1 : 0 });
    if (pairingAborted) break;
    if (gamesCompleted > 0) {
      const mean = seedScore / gamesCompleted;
      if (mean > 0.5) positiveSeeds += 1;
      else if (mean < 0.5) negativeSeeds += 1;
    }
    if (options.allowEarlyStop === true
      && shouldStopPairing(seedsEvaluated, options.seeds.length, positiveSeeds, negativeSeeds)) {
      stopReason = 'significant';
      break;
    }
  }
  return {
    record, candidateScore, opponentScore, telemetry,
    matches, seedsEvaluated, stopReason,
    candidateMean: record.played ? candidateScore / record.played : null,
    opponentMean: record.played ? opponentScore / record.played : null,
    blocks, aborts
  };
}

export function playPairing(
  candidate: Strategy, opponent: Strategy, options: PairingOptions, matchRunner?: PairingMatchRunner
): PairingOutcome {
  return playPairingMode(candidate, opponent, options, false, matchRunner);
}

export function playPairingScoreOnly(
  candidate: Strategy, opponent: Strategy, options: PairingOptions
): PairingOutcome {
  return playPairingMode(candidate, opponent, options, true);
}
