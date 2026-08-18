import { afterEach, describe, expect, it } from 'vitest';
import { resetKingdoms } from '../../src/game';
import { baselineStrategy } from '../../src/sim/baselines';
import {
  MIN_CANDIDATES, compareScored, evolve, retainedLeaders, selectLeaders, validateEvolutionConfig
} from '../../src/sim/evolution';
import { repairStrategy } from '../../src/sim/mutation';
import { ORIENTATIONS, playPairing, sharedSeedList } from '../../src/sim/pairing';
import { seedStrategies } from '../../src/sim/seedPopulation';
import { canonicalStrategy, identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import type { EvolutionConfig, GenerationResult, ScoredStrategy } from '../../src/sim/types';
import { strategy } from './fixtures';

afterEach(() => { resetKingdoms(); });

const KINGDOM = 'current-duel';

function config(overrides: Partial<EvolutionConfig> = {}): EvolutionConfig {
  return {
    kingdomId: KINGDOM, seed: 13, candidates: 6, leaders: 2, generations: 2, sharedSeeds: 1,
    turnLimitPerPlayer: 3, actionCapPerTurn: 200, ...overrides
  };
}
function scoredWith(plan: Strategy, score: number, completedGames = 4): ScoredStrategy {
  return { strategy: plan, score, completedGames, abortedGames: 0 };
}

describe('the four orientations of a pairing', () => {
  it('covers both first-player orders, both arena sides, and each seat twice', () => {
    expect(ORIENTATIONS).toHaveLength(4);
    expect(ORIENTATIONS.filter((entry) => entry.firstPlayerId === 'ochre')).toHaveLength(2);
    expect(ORIENTATIONS.filter((entry) => entry.swapSides)).toHaveLength(2);
    expect(ORIENTATIONS.filter((entry) => entry.candidateSeat === 'ochre')).toHaveLength(2);
    // The candidate moves first in exactly half, so the pairing does not hand it the first turn.
    expect(ORIENTATIONS.filter((entry) => entry.candidateSeat === entry.firstPlayerId)).toHaveLength(2);
    expect(new Set(ORIENTATIONS.map((entry) => `${entry.firstPlayerId}:${entry.swapSides}`)).size).toBe(4);
  });

  it('plays four games for each shared seed and fills each orientation cell', () => {
    const [candidate, opponent] = seedStrategies(KINGDOM);
    const outcome = playPairing(candidate!, opponent!, {
      kingdomId: KINGDOM, seeds: sharedSeedList(13, 3), turnLimitPerPlayer: 3, actionCapPerTurn: 200
    });
    expect(outcome.matches).toBe(12);
    expect(outcome.record.played + outcome.record.aborted).toBe(12);
    expect(outcome.record.wins + outcome.record.losses + outcome.record.draws).toBe(outcome.record.played);
    expect(outcome.candidateScore + outcome.opponentScore).toBe(outcome.record.played);
    for (const first of ['firstOchre', 'firstIndigo'] as const) {
      for (const side of ['normal', 'swapped'] as const) {
        const cell = outcome.telemetry.byOrientation[first][side];
        expect(cell.played + cell.aborted, `${first}/${side}`).toBe(3);
      }
    }
  });

  it('scores a win 1, a draw 0.5, and a loss 0', () => {
    const [candidate, opponent] = seedStrategies(KINGDOM);
    const outcome = playPairing(candidate!, opponent!, {
      kingdomId: KINGDOM, seeds: sharedSeedList(29, 2), turnLimitPerPlayer: 8, actionCapPerTurn: 200
    });
    const { wins, draws, losses } = outcome.record;
    expect(outcome.candidateScore).toBe(wins + draws * 0.5);
    expect(outcome.opponentScore).toBe(losses + draws * 0.5);
  });

  it('excludes an aborted game from both scores and from played', () => {
    const [candidate, opponent] = seedStrategies(KINGDOM);
    // A one-state search limit overflows on the first decision of every match.
    const outcome = playPairing(candidate!, opponent!, {
      kingdomId: KINGDOM, seeds: sharedSeedList(13, 2), turnLimitPerPlayer: 8, actionCapPerTurn: 200, stateLimit: 1
    });
    expect(outcome.matches).toBe(8);
    expect(outcome.record.aborted).toBe(8);
    expect(outcome.record.played).toBe(0);
    expect(outcome.candidateScore).toBe(0);
    expect(outcome.opponentScore).toBe(0);
  });
});

describe('leader selection', () => {
  it('breaks equal scores on the stable hash, whatever order the list arrives in', () => {
    const seeds = seedStrategies(KINGDOM);
    const tied = seeds.map((plan) => scoredWith(plan, 0.5));
    const forward = selectLeaders(tied, 3).map((entry) => entry.strategy.id);
    const backward = selectLeaders([...tied].reverse(), 3).map((entry) => entry.strategy.id);
    expect(forward).toEqual(backward);
    expect(forward).toEqual([...seeds].map((plan) => plan.id).sort().slice(0, 3));
  });

  it('applies the tiebreak before it truncates', () => {
    const seeds = seedStrategies(KINGDOM);
    const sortedIds = seeds.map((plan) => plan.id).sort();
    // With one strategy scored above the rest, the remaining slot must go to the lowest hash of the
    // tied group, not to whichever tied entry happened to come first.
    const best = seeds.find((plan) => plan.id === sortedIds.at(-1))!;
    const scored = seeds.map((plan) => scoredWith(plan, plan.id === best.id ? 1 : 0.4));
    expect(selectLeaders([...scored].reverse(), 2).map((entry) => entry.strategy.id))
      .toEqual([best.id, sortedIds[0]]);
  });

  it('collapses two strategies that differ only by id, and keeps two that differ by agenda order', () => {
    const base = repairStrategy(KINGDOM, baselineStrategy('ranged-standard'));
    const renamed: Strategy = { ...base, id: 'a-different-name' };
    expect(canonicalStrategy(renamed)).toBe(canonicalStrategy(base));
    expect(selectLeaders([scoredWith(base, 1), scoredWith(renamed, 1)], 5)).toHaveLength(1);

    const reordered = identify({ ...base, buyAgenda: [...base.buyAgenda].reverse() });
    expect(canonicalStrategy(reordered)).not.toBe(canonicalStrategy(base));
    expect(selectLeaders([scoredWith(base, 1), scoredWith(reordered, 1)], 5)).toHaveLength(2);
  });

  it('ranks a candidate with no completed game below one that lost everything', () => {
    const seeds = seedStrategies(KINGDOM);
    const nothing: ScoredStrategy = { strategy: seeds[0]!, score: 0, completedGames: 0, abortedGames: 8 };
    const loser = scoredWith(seeds[1]!, 0);
    expect([nothing, loser].sort(compareScored)).toEqual([loser, nothing]);
    expect(selectLeaders([nothing, loser], 2)[0]!.strategy.id).toBe(loser.strategy.id);
  });
});

describe('running the generations', () => {
  it('scores every candidate, keeps the leader limit, and never pairs a strategy with itself', () => {
    const seen: GenerationResult[] = [];
    const results = evolve(config(), (result) => seen.push(result));
    expect(results).toHaveLength(2);
    expect(seen).toEqual(results);
    for (const result of results) {
      expect(result.partial).toBe(false);
      expect(result.leaders).toHaveLength(2);
      expect(Object.keys(result.scores)).toHaveLength(6);
      expect(result.overflowCount).toBe(0);
      expect(new Set(result.leaders.map((entry) => canonicalStrategy(entry.strategy))).size).toBe(2);
    }
    // Generation 1 pairs 6 candidates against all five baselines, minus the five self-pairings the
    // seeds share with the leader set, four games each. Generation 2 pairs 6 against 2 leaders.
    expect(results[0]!.matchCount).toBe((6 * 5 - 5) * 4);
    expect(results[1]!.matchCount).toBe((6 * 2 - 2) * 4);
  });

  it('counts every aborted game in overflowCount and leaves the ranking comparable', () => {
    // A one-state search limit overflows on the first decision, so no game in the generation completes.
    const results = evolve(config({ generations: 1, stateLimit: 1 }), () => {});
    const result = results[0]!;
    expect(result.overflowCount).toBe(result.matchCount);
    expect(Object.values(result.scores).every((score) => score === 0)).toBe(true);
    expect(result.leaders).toHaveLength(2);
    for (const leader of result.leaders) {
      expect(leader.completedGames).toBe(0);
      expect(leader.abortedGames).toBeGreaterThan(0);
    }
  });

  it('repeats exactly, generation by generation, with no deadline', () => {
    // `elapsedMs` is wall clock and is the one field a repeat is not expected to reproduce.
    const withoutClock = (results: GenerationResult[]): unknown =>
      results.map(({ elapsedMs: _elapsedMs, ...rest }) => rest);
    const first = evolve(config(), () => {});
    const second = evolve(config(), () => {});
    expect(withoutClock(second)).toEqual(withoutClock(first));
    expect(first.every((result) => result.elapsedMs >= 0)).toBe(true);
  });

  it('stops between pairings when the injected clock passes the deadline', () => {
    let clock = 1_000;
    const seen: GenerationResult[] = [];
    const results = evolve(
      config({ generations: 5, deadline: 1_000 + 12, now: () => (clock += 1) }),
      (result) => seen.push(result)
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThan(5);
    expect(results.at(-1)!.partial).toBe(true);
    expect(results.slice(0, -1).every((result) => !result.partial)).toBe(true);
    // Every generation reported before `evolve` returned, the partial one included.
    expect(seen).toEqual(results);
    expect(results.at(-1)!.matchCount).toBeGreaterThan(0);
  });

  it('retains the best leader of each generation, once each', () => {
    const results = evolve(config({ generations: 3 }), () => {});
    const retained = retainedLeaders(results);
    expect(retained.length).toBeLessThanOrEqual(results.length);
    expect(new Set(retained.map(canonicalStrategy)).size).toBe(retained.length);
    for (const entrant of retained) {
      expect(results.some((result) => result.leaders[0]?.strategy.id === entrant.id)).toBe(true);
    }
    // A leader that survives unchanged is retained once, not once per generation it led.
    const bestIds = results.map((result) => result.leaders[0]!.strategy.id);
    expect(retained.map((entrant) => entrant.id)).toEqual([...new Set(bestIds)]);
  });
});

describe('limit validation', () => {
  it('rejects every limit it cannot honour, and says why', () => {
    expect(() => validateEvolutionConfig(config({ candidates: 4 })))
      .toThrow(`candidates must be at least ${MIN_CANDIDATES}`);
    expect(() => validateEvolutionConfig(config({ candidates: 6, leaders: 7 })))
      .toThrow('leaders (7) cannot exceed candidates (6)');
    for (const field of ['candidates', 'leaders', 'generations', 'sharedSeeds', 'turnLimitPerPlayer', 'actionCapPerTurn'] as const) {
      expect(() => validateEvolutionConfig(config({ [field]: 0 })), field).toThrow('must be a positive integer');
      expect(() => validateEvolutionConfig(config({ [field]: 2.5 })), field).toThrow('must be a positive integer');
    }
    expect(() => validateEvolutionConfig(config())).not.toThrow();
  });

  it('rejects the limit rather than clamping it, so the report cannot record a limit that never ran', () => {
    expect(() => evolve(config({ candidates: 2 }), () => {})).toThrow('candidates must be at least');
  });
});

describe('the strategy fixture stays inside the kingdom', () => {
  it('repairs a hand-written strategy the same way a mutant is repaired', () => {
    const handWritten = strategy({ startingBuild: ['fireball'], buyAgenda: [{ cardId: 'fireball', desiredCount: 2 }] });
    const repaired = repairStrategy(KINGDOM, handWritten);
    expect(repaired.startingBuild).toEqual([]);
    expect(repaired.buyAgenda).toEqual([]);
  });
});
