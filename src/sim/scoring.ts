import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';
import type { ScoredStrategy } from './types';

export interface ScoringTally {
  strategy: Strategy;
  pairingScore: number;
  completedPairings: number;
  completedGames: number;
  abortedGames: number;
}

export function scoredStrategy(tally: ScoringTally): ScoredStrategy {
  return {
    strategy: tally.strategy,
    score: tally.completedPairings ? tally.pairingScore / tally.completedPairings : 0,
    completedPairings: tally.completedPairings,
    completedGames: tally.completedGames,
    abortedGames: tally.abortedGames
  };
}

/** A zero-pairing score has no competitive meaning, so it ranks below every completed record. */
export function compareScored(left: ScoredStrategy, right: ScoredStrategy): number {
  if ((left.completedPairings === 0) !== (right.completedPairings === 0)) return left.completedPairings === 0 ? 1 : -1;
  if (left.score !== right.score) return right.score - left.score;
  if (left.strategy.id !== right.strategy.id) return left.strategy.id < right.strategy.id ? -1 : 1;
  const leftForm = canonicalStrategy(left.strategy);
  const rightForm = canonicalStrategy(right.strategy);
  return leftForm < rightForm ? -1 : leftForm > rightForm ? 1 : 0;
}
