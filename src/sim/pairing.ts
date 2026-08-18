import type { PlayerId } from '../game';
import { strategyAgent } from './agents/strategyAgent';
import { runMatch } from './match';
import type { Strategy } from './strategy';
import type { Agent, MatchResult, OrientationKey, PairRecord, SideKey, TelemetryAggregate } from './types';

export interface Orientation {
  firstPlayerId: PlayerId;
  swapSides: boolean;
  candidateSeat: PlayerId;
}

/**
 * The four games a pairing plays for each shared seed: two first-player orders times two arena
 * sides. The candidate takes ochre in orientations 1 and 3 and indigo in 2 and 4, so it holds each
 * seat twice and moves first in exactly two of the four.
 */
export const ORIENTATIONS: readonly Orientation[] = Object.freeze([
  { firstPlayerId: 'ochre', swapSides: false, candidateSeat: 'ochre' },
  { firstPlayerId: 'ochre', swapSides: true, candidateSeat: 'indigo' },
  { firstPlayerId: 'indigo', swapSides: false, candidateSeat: 'ochre' },
  { firstPlayerId: 'indigo', swapSides: true, candidateSeat: 'indigo' }
] as const);

function mix(left: number, right: number): number {
  let value = (left ^ Math.imul(right + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x2545f491) >>> 0;
  return value >>> 0;
}

/**
 * Fixed for the whole run, so a score in generation 1 and a score in generation 32 are comparable.
 * Nothing about the generation or the pairing enters the seed: if it did, no two pairings would play
 * the same shuffles and the shared seeds would not be shared.
 */
export function sharedSeedList(runSeed: number, count: number): number[] {
  const seeds: number[] = [];
  let value = runSeed >>> 0;
  for (let index = 0; index < count; index += 1) {
    value = mix(value, index + 1);
    seeds.push(value);
  }
  return seeds;
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

export function recordMatch(
  into: TelemetryAggregate, result: MatchResult, orientation: Orientation,
  seatStrategyIds: Record<PlayerId, string>
): void {
  for (const seat of ['ochre', 'indigo'] as const) {
    const strategyId = seatStrategyIds[seat];
    into.acquisitionsByStrategy[strategyId] ??= {};
    addCounts(into.acquisitionsByStrategy[strategyId]!, acquisitions(result, seat));
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
  stateLimit?: number | undefined;
}

export interface PairingOutcome {
  record: PairRecord;        // the candidate's view of the pairing
  candidateScore: number;
  opponentScore: number;
  telemetry: TelemetryAggregate;
  matches: number;           // every game played, aborted ones included
}

/**
 * Plays one pairing over every shared seed in every orientation. Agents are built per match: a
 * strategy agent caches an Action-phase baseline and a memo, and reusing one across matches is what
 * the group 2 review found corrupting scores.
 *
 * An aborted game scores for neither side and counts in neither `played` nor the mean, so a deep
 * search is not punished for overflowing the state limit.
 */
export function playPairing(candidate: Strategy, opponent: Strategy, options: PairingOptions): PairingOutcome {
  const record = emptyPairRecord();
  const telemetry = emptyAggregate();
  let candidateScore = 0;
  let opponentScore = 0;
  let matches = 0;

  for (const seed of options.seeds) {
    for (let orientationIndex = 0; orientationIndex < ORIENTATIONS.length; orientationIndex += 1) {
      const orientation = ORIENTATIONS[orientationIndex]!;
      const candidateIsOchre = orientation.candidateSeat === 'ochre';
      const agent = (strategy: Strategy): Agent =>
        strategyAgent(strategy, options.stateLimit === undefined ? {} : { stateLimit: options.stateLimit });
      const agents: Record<PlayerId, Agent> = candidateIsOchre
        ? { ochre: agent(candidate), indigo: agent(opponent) }
        : { ochre: agent(opponent), indigo: agent(candidate) };
      const seatStrategyIds: Record<PlayerId, string> = candidateIsOchre
        ? { ochre: candidate.id, indigo: opponent.id }
        : { ochre: opponent.id, indigo: candidate.id };

      const result = runMatch({
        kingdomId: options.kingdomId,
        seed: matchSeed(seed, orientationIndex),
        firstPlayerId: orientation.firstPlayerId,
        swapSides: orientation.swapSides,
        turnLimitPerPlayer: options.turnLimitPerPlayer,
        actionCapPerTurn: options.actionCapPerTurn,
        agents
      });
      matches += 1;
      recordMatch(telemetry, result, orientation, seatStrategyIds);

      if (result.outcome === 'aborted') { record.aborted += 1; continue; }
      record.played += 1;
      if (result.outcome === 'draw') {
        record.draws += 1; candidateScore += 0.5; opponentScore += 0.5;
      } else if (result.outcome === orientation.candidateSeat) {
        record.wins += 1; candidateScore += 1;
      } else {
        record.losses += 1; opponentScore += 1;
      }
    }
  }
  return { record, candidateScore, opponentScore, telemetry, matches };
}
