import { compareScored } from './evolution';
import { emptyAggregate, emptyPairRecord, mergeAggregate, playPairing, sharedSeedList } from './pairing';
import { baselineLabels } from './seedPopulation';
import { canonicalStrategy } from './strategy';
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
  for (const entrant of unique) pairs[entrant.id] = {};
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

  return { entrants: unique, pairs, ranking, telemetry, calibration: calibrationFrom(ranking, telemetry, config) };
}

/**
 * The gate reads the last generation's leaders only, in tournament rank order, with the fixed
 * baselines excluded from both the numerator and the denominator. Four of the five baselines can
 * never acquire Heavy Blow, and the entrant list also holds a retained leader from every generation,
 * so any wider reading makes the 80 percent branch arithmetically unreachable.
 */
function calibrationFrom(
  ranking: readonly ScoredStrategy[], telemetry: TournamentResult['telemetry'], config: TournamentConfig
): CalibrationInput {
  const baselines = baselineLabels(config.kingdomId);
  const wanted = config.finalLeaderIds
    ? new Set(config.finalLeaderIds)
    : new Set(ranking.map((entry) => entry.strategy.id).filter((id) => !baselines.has(id)));

  const finalLeaders = ranking
    .filter((entry) => wanted.has(entry.strategy.id) && !baselines.has(entry.strategy.id))
    .map((entry, index) => ({ strategyId: entry.strategy.id, rank: index + 1 }));

  return { finalLeaders, acquisitionsByStrategy: telemetry.acquisitionsByStrategy };
}

/** A pair that never played, for a table cell the deadline cut short. */
export function pairRecordOf(result: TournamentResult, left: string, right: string): PairRecord {
  return result.pairs[left]?.[right] ?? emptyPairRecord();
}
