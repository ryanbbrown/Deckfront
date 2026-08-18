import { compareScored } from './evolution';
import { emptyAggregate, emptyPairRecord, mergeAggregate, playPairing, sharedSeedList } from './pairing';
import { baselineLabels } from './seedPopulation';
import { canonicalStrategy, registerIdentity } from './strategy';
import type { Strategy } from './strategy';
import type { CalibrationInput } from './calibration';
import type { PairRecord, ScoredStrategy, TournamentConfig, TournamentResult } from './types';

/** Deduped by canonical form, so a leader retained unchanged across generations enters once. */
export function uniqueEntrants(entrants: readonly Strategy[]): Strategy[] {
  const seen = new Set<string>();
  const kept: Strategy[] = [];
  for (const entrant of entrants) {
    const form = canonicalStrategy(entrant);
    if (seen.has(form)) continue;
    seen.add(form);
    kept.push(entrant);
  }
  return kept;
}

function mirror(record: PairRecord): PairRecord {
  return { played: record.played, wins: record.losses, draws: record.draws, losses: record.wins, aborted: record.aborted };
}

/**
 * Plays every pair once and reports the complete pairwise table. `pairs[a][b]` is a's view of the
 * pairing, so `pairs[a][b].wins + pairs[b][a].wins + pairs[a][b].draws` equals `played` and there is
 * no self entry.
 *
 * It takes the deadline for the same reason `evolve` does: a run that stops cleanly must not then
 * enter an unbounded tournament.
 */
export function roundRobin(entrants: readonly Strategy[], config: TournamentConfig): TournamentResult {
  const unique = uniqueEntrants(entrants);
  const now = config.now ?? Date.now;
  const expired = (): boolean => config.deadline !== undefined && now() >= config.deadline;
  const seeds = sharedSeedList(config.seed, config.sharedSeeds);

  const pairs: Record<string, Record<string, PairRecord>> = {};
  const known = new Map<string, string>();
  for (const entrant of unique) {
    registerIdentity(known, entrant);
    pairs[entrant.id] = {};
  }
  const pairsExpected = (unique.length * (unique.length - 1)) / 2;
  let pairsPlayed = 0;
  const telemetry = emptyAggregate();
  const totals = new Map<string, { score: number; completedGames: number; abortedGames: number }>();
  for (const entrant of unique) totals.set(entrant.id, { score: 0, completedGames: 0, abortedGames: 0 });

  pairings: for (let left = 0; left < unique.length; left += 1) {
    for (let right = left + 1; right < unique.length; right += 1) {
      if (expired()) break pairings;
      const candidate = unique[left]!;
      const opponent = unique[right]!;
      const outcome = playPairing(candidate, opponent, {
        kingdomId: config.kingdomId, seeds, stateLimit: config.stateLimit,
        turnLimitPerPlayer: config.turnLimitPerPlayer, actionCapPerTurn: config.actionCapPerTurn
      });
      mergeAggregate(telemetry, outcome.telemetry);
      pairsPlayed += 1;
      pairs[candidate.id]![opponent.id] = outcome.record;
      pairs[opponent.id]![candidate.id] = mirror(outcome.record);

      const candidateTotal = totals.get(candidate.id)!;
      candidateTotal.score += outcome.candidateScore;
      candidateTotal.completedGames += outcome.record.played;
      candidateTotal.abortedGames += outcome.record.aborted;
      const opponentTotal = totals.get(opponent.id)!;
      opponentTotal.score += outcome.opponentScore;
      opponentTotal.completedGames += outcome.record.played;
      opponentTotal.abortedGames += outcome.record.aborted;
    }
  }

  const ranking: ScoredStrategy[] = unique
    .map((strategy) => {
      const total = totals.get(strategy.id)!;
      return {
        strategy,
        score: total.completedGames ? total.score / total.completedGames : 0,
        completedGames: total.completedGames,
        abortedGames: total.abortedGames
      };
    })
    .sort(compareScored);

  // The calibration input is built even when the deadline cut the table short, and `partial` is what
  // says so. The tournament reports; step 7 decides whether a partial table may answer the gate. A
  // truncated table is still worth reporting, and it is not the tournament's place to set policy on
  // the one pass-or-fail check in the goal.
  return {
    entrants: unique, pairs, ranking, telemetry, pairsPlayed, pairsExpected,
    partial: pairsPlayed < pairsExpected,
    calibration: calibrationFrom(ranking, telemetry, config)
  };
}

/**
 * Lists exactly the named final leaders, in tournament rank order, with the fixed baselines excluded
 * from both the numerator and the denominator. Four of the five baselines can never acquire Heavy
 * Blow, and the entrant list also holds a retained leader from every generation, so any wider
 * reading makes the 80 percent branch arithmetically unreachable.
 *
 * A named leader that never entered the tournament throws. Dropping it silently would shrink the
 * gate's denominator and turn a caller's mistake into a wrong pass.
 */
function calibrationFrom(
  ranking: readonly ScoredStrategy[], telemetry: TournamentResult['telemetry'], config: TournamentConfig
): CalibrationInput {
  const baselines = baselineLabels(config.kingdomId);
  const ranked = new Set(ranking.map((entry) => entry.strategy.id));
  for (const id of config.finalLeaderIds) {
    if (!ranked.has(id)) throw new Error(`Final leader ${id} is not one of the tournament entrants.`);
  }
  const wanted = new Set(config.finalLeaderIds);

  const finalLeaders = ranking
    .filter((entry) => wanted.has(entry.strategy.id) && !baselines.has(entry.strategy.id))
    .map((entry, index) => ({ strategyId: entry.strategy.id, rank: index + 1 }));

  return { finalLeaders, acquisitionsByStrategy: telemetry.acquisitionsByStrategy };
}

/** A pair that never played, for a table cell the deadline cut short. */
export function pairRecordOf(result: TournamentResult, left: string, right: string): PairRecord {
  return result.pairs[left]?.[right] ?? emptyPairRecord();
}
