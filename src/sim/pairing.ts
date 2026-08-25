import type { PlayerId } from '../game';
import { runSimulationMatch, runSimulationMatchScoreOnly } from './simulationKernel';
import type { Strategy } from './strategy';
import type { MatchResult, OrientationKey, PairRecord, SideKey, TelemetryAggregate } from './types';

export interface Orientation {
  firstPlayerId: PlayerId;
  swapSides: boolean;
  candidateSeat: PlayerId;
}

/**
 * The four games a pairing plays for each shared seed: two first-player orders times two arena sides.
 *
 * There are three binary factors to balance — seat, who moves first, and arena position — so four
 * games need a half-fraction rather than the obvious assignment. `createGame` puts ochre at position
 * 3 and indigo at 4 and exchanges them when `swapSides` is true. Taking ochre in orientations 1 and
 * 3 would leave the candidate on the same side in all four games, so `swapSides` would cancel
 * nothing for it. Ochre in 1 and 4 gives seat 2/2, moves-first 2/2, and arena side 2/2.
 *
 * A candidate plays both seats, moves first twice, and starts on each arena position twice. This
 * prevents seat or arena advantages from biasing a payoff cell or response evaluation.
 */
export const ORIENTATIONS: readonly Orientation[] = Object.freeze([
  { firstPlayerId: 'ochre', swapSides: false, candidateSeat: 'ochre' },
  { firstPlayerId: 'ochre', swapSides: true, candidateSeat: 'indigo' },
  { firstPlayerId: 'indigo', swapSides: false, candidateSeat: 'indigo' },
  { firstPlayerId: 'indigo', swapSides: true, candidateSeat: 'ochre' }
] as const);

function mix(left: number, right: number): number {
  let value = (left ^ Math.imul(right + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x2545f491) >>> 0;
  return value >>> 0;
}

export function matchSeed(sharedSeed: number, orientationIndex: number): number {
  return mix(sharedSeed, orientationIndex + 0x51);
}

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
  // Only preliminary payoff-matrix cells set this. Every other evaluation plays all seed blocks.
  allowEarlyStop?: boolean | undefined;
}

export interface PairingBlockResult {
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
  seedBlocks: number;
  stopReason: 'significant' | 'maximum';
  candidateMean: number | null;
  opponentMean: number | null;
  blocks: PairingBlockResult[];
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
  completedBlocks: number, maximumBlocks: number, positive: number, negative: number
): boolean {
  return completedBlocks >= 5 && completedBlocks < maximumBlocks
    && isSignificantSignTest(exactSignTest(positive, negative));
}

export type PairingMatchRunner = typeof runSimulationMatch;

/**
 * Plays one pairing over every shared seed in every orientation. Production pairings use the compact
 * simulation kernel. An injected match runner keeps the immutable engine available as a test seam.
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
  let seedBlocks = 0;
  let positiveBlocks = 0;
  let negativeBlocks = 0;
  let stopReason: PairingOutcome['stopReason'] = 'maximum';
  const blocks: PairingBlockResult[] = [];
  const aborts: PairingAbort[] = [];
  let pairingAborted = false;

  for (const seed of options.seeds) {
    let blockScore = 0;
    let blockCompleted = 0;
    for (let orientationIndex = 0; orientationIndex < ORIENTATIONS.length; orientationIndex += 1) {
      const orientation = ORIENTATIONS[orientationIndex]!;
      const candidateIsOchre = orientation.candidateSeat === 'ochre';
      const seatStrategies: Record<PlayerId, Strategy> = candidateIsOchre
        ? { ochre: candidate, indigo: opponent }
        : { ochre: opponent, indigo: candidate };

      const result = (matchRunner ?? (scoreOnly ? runSimulationMatchScoreOnly : runSimulationMatch))({
          kingdomId: options.kingdomId,
          seed: matchSeed(seed, orientationIndex),
          firstPlayerId: orientation.firstPlayerId,
          swapSides: orientation.swapSides,
          turnLimitPerPlayer: options.turnLimitPerPlayer,
          actionCapPerTurn: options.actionCapPerTurn,
          startingDraftEnabled: options.startingDraftEnabled ?? true,
          strategies: candidateIsOchre
            ? { ochre: candidate, indigo: opponent }
            : { ochre: opponent, indigo: candidate }
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
      blockCompleted += 1;
      if (result.outcome === 'draw') {
        record.draws += 1; candidateScore += 0.5; opponentScore += 0.5; blockScore += 0.5;
      } else if (result.outcome === orientation.candidateSeat) {
        record.wins += 1; candidateScore += 1; blockScore += 1;
      } else {
        record.losses += 1; opponentScore += 1;
      }
    }
    seedBlocks += 1;
    blocks.push({ seed, score: blockCompleted ? blockScore / blockCompleted : 0, played: blockCompleted,
      aborted: pairingAborted ? 1 : 0 });
    if (pairingAborted) break;
    if (blockCompleted > 0) {
      const mean = blockScore / blockCompleted;
      if (mean > 0.5) positiveBlocks += 1;
      else if (mean < 0.5) negativeBlocks += 1;
    }
    if (options.allowEarlyStop === true
      && shouldStopPairing(seedBlocks, options.seeds.length, positiveBlocks, negativeBlocks)) {
      stopReason = 'significant';
      break;
    }
  }
  return {
    record, candidateScore, opponentScore, telemetry,
    matches, seedBlocks, stopReason,
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
