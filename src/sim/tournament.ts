import { compareScored } from './evolution';
import { emptyAggregate, emptyPairRecord, mergeAggregate, sharedSeedList } from './pairing';
import { InlinePairingRunner } from './pairingRunner';
import type { PairingJob, PairingRunner } from './pairingRunner';
import { seedLabels } from './seedPopulation';
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
export async function roundRobin(
  entrants: readonly Strategy[], config: TournamentConfig, runner: PairingRunner = new InlinePairingRunner()
): Promise<TournamentResult> {
  const unique = uniqueEntrants(entrants);
  const now = config.now ?? Date.now;
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
  let matches = 0;
  const pairingStops = { significant: 0, maximum: 0 };
  const seedBlockCounts: Record<string, number> = {};
  const totals = new Map<string, {
    pairingScore: number; completedPairings: number; completedGames: number; abortedGames: number
  }>();
  for (const entrant of unique) {
    totals.set(entrant.id, { pairingScore: 0, completedPairings: 0, completedGames: 0, abortedGames: 0 });
  }
  const jobs: PairingJob[] = [];
  const pairIndexes: [number, number][] = [];
  for (let left = 0; left < unique.length; left += 1) {
    for (let right = left + 1; right < unique.length; right += 1) {
      const candidate = unique[left]!;
      const opponent = unique[right]!;
      jobs.push({ candidate, opponent, options: {
        kingdomId: config.kingdomId, seeds, stateLimit: config.stateLimit,
        turnLimitPerPlayer: config.turnLimitPerPlayer, actionCapPerTurn: config.actionCapPerTurn
      } });
      pairIndexes.push([left, right]);
    }
  }
  const batch = await runner.run(jobs, { deadline: config.deadline, now });
  for (let index = 0; index < batch.outcomes.length; index += 1) {
      const outcome = batch.outcomes[index];
      if (!outcome) continue;
      const [left, right] = pairIndexes[index]!;
      const candidate = unique[left]!;
      const opponent = unique[right]!;
      mergeAggregate(telemetry, outcome.telemetry);
      pairsPlayed += 1;
      matches += outcome.matches;
      pairingStops[outcome.stopReason] += 1;
      seedBlockCounts[String(outcome.seedBlocks)] = (seedBlockCounts[String(outcome.seedBlocks)] ?? 0) + 1;
      pairs[candidate.id]![opponent.id] = outcome.record;
      pairs[opponent.id]![candidate.id] = mirror(outcome.record);

      const candidateTotal = totals.get(candidate.id)!;
      if (outcome.candidateMean !== null) {
        candidateTotal.pairingScore += outcome.candidateMean;
        candidateTotal.completedPairings += 1;
      }
      candidateTotal.completedGames += outcome.record.played;
      candidateTotal.abortedGames += outcome.record.aborted;
      const opponentTotal = totals.get(opponent.id)!;
      if (outcome.opponentMean !== null) {
        opponentTotal.pairingScore += outcome.opponentMean;
        opponentTotal.completedPairings += 1;
      }
      opponentTotal.completedGames += outcome.record.played;
      opponentTotal.abortedGames += outcome.record.aborted;
  }

  const ranking: ScoredStrategy[] = unique
    .map((strategy) => {
      const total = totals.get(strategy.id)!;
      return {
        strategy,
        score: total.completedPairings ? total.pairingScore / total.completedPairings : 0,
        completedPairings: total.completedPairings,
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
    entrants: unique, pairs, ranking, telemetry, pairsPlayed, pairsExpected, matches,
    pairingStops, seedBlockCounts,
    partial: pairsPlayed < pairsExpected,
    calibration: calibrationFrom(ranking, telemetry, config)
  };
}

/**
 * Lists exactly the named final leaders, in tournament rank order, with the fixed seeds excluded
 * from both the numerator and the denominator. Most fixed seeds can never acquire Heavy
 * Blow, and the entrant list also holds a retained leader from every generation, so any wider
 * reading makes the 80 percent branch arithmetically unreachable.
 *
 * A named leader that never entered the tournament throws. Dropping it silently would shrink the
 * gate's denominator and turn a caller's mistake into a wrong pass.
 */
function calibrationFrom(
  ranking: readonly ScoredStrategy[], telemetry: TournamentResult['telemetry'], config: TournamentConfig
): CalibrationInput {
  const seeds = seedLabels(config.kingdomId);
  const ranked = new Set(ranking.map((entry) => entry.strategy.id));
  for (const id of config.finalLeaderIds) {
    if (!ranked.has(id)) throw new Error(`Final leader ${id} is not one of the tournament entrants.`);
  }
  const wanted = new Set(config.finalLeaderIds);

  const finalLeaders = ranking
    .filter((entry) => wanted.has(entry.strategy.id) && !seeds.has(entry.strategy.id))
    .map((entry, index) => ({ strategyId: entry.strategy.id, rank: index + 1 }));

  return { finalLeaders, acquisitionsByStrategy: telemetry.acquisitionsByStrategy };
}

/** A pair that never played, for a table cell the deadline cut short. */
export function pairRecordOf(result: TournamentResult, left: string, right: string): PairRecord {
  return result.pairs[left]?.[right] ?? emptyPairRecord();
}
