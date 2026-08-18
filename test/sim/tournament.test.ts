import { afterEach, describe, expect, it } from 'vitest';
import { resetKingdoms } from '../../src/game';
import { checkRiggedMelee } from '../../src/sim/calibration';
import { evolve, retainedLeaders } from '../../src/sim/evolution';
import { repairStrategy } from '../../src/sim/mutation';
import { baselineLabels, seedStrategies } from '../../src/sim/seedPopulation';
import { canonicalStrategy } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import { roundRobin } from '../../src/sim/tournament';
import type { TournamentConfig } from '../../src/sim/types';
import { strategy } from './fixtures';

afterEach(() => { resetKingdoms(); });

const KINGDOM = 'rigged-melee';

function config(overrides: Partial<TournamentConfig> = {}): TournamentConfig {
  return {
    kingdomId: KINGDOM, seed: 31, sharedSeeds: 1, turnLimitPerPlayer: 4, actionCapPerTurn: 200, ...overrides
  };
}
/** A strategy that acquires exactly its starting build: no agenda and no treasure fallback. */
function opener(build: string[]): Strategy {
  return repairStrategy(KINGDOM, strategy({ startingBuild: build, buyAgenda: [], treasureFallback: [] }));
}

describe('the pairwise table', () => {
  it('balances every pair, holds no self entry, and lists unique entrants', () => {
    const entrants = seedStrategies(KINGDOM);
    const result = roundRobin(entrants, config());
    expect(result.entrants).toHaveLength(entrants.length);
    expect(new Set(result.entrants.map(canonicalStrategy)).size).toBe(entrants.length);

    for (const left of result.entrants) {
      expect(result.pairs[left.id]![left.id]).toBeUndefined();
      for (const right of result.entrants) {
        if (left.id === right.id) continue;
        const forward = result.pairs[left.id]![right.id]!;
        const back = result.pairs[right.id]![left.id]!;
        expect(forward.wins + back.wins + forward.draws, `${left.id} vs ${right.id}`).toBe(forward.played);
        expect(back.played).toBe(forward.played);
        expect(forward.played + forward.aborted).toBe(4);
      }
    }
    expect(result.ranking).toHaveLength(entrants.length);
    expect(result.ranking.every((entry) => entry.score >= 0 && entry.score <= 1)).toBe(true);
  });

  it('enters a leader retained unchanged once, however many times it is offered', () => {
    const entrants = seedStrategies(KINGDOM);
    const repeated = [...entrants, entrants[0]!, { ...entrants[1]!, id: 'renamed' }];
    const result = roundRobin(repeated, config());
    expect(result.entrants.map((entrant) => entrant.id)).toEqual(entrants.map((entrant) => entrant.id));
  });

  it('stops between pairings when the injected clock passes the deadline', () => {
    let clock = 500;
    const result = roundRobin(seedStrategies(KINGDOM), config({ deadline: 502, now: () => (clock += 1) }));
    const played = Object.values(result.pairs).flatMap((row) => Object.values(row));
    expect(played.length).toBeLessThan(result.entrants.length * (result.entrants.length - 1));
    expect(result.entrants).toHaveLength(5);
  });
});

describe('the calibration input the tournament builds', () => {
  it('sums acquisitions over both seats and both arena sides', () => {
    // Neither side buys anything, so acquisition is the starting build alone: one copy for each of
    // the four games a pairing plays.
    const melee = opener(['heavyBlow', 'heavyBlow']);
    const ranged = opener(['volley']);
    const result = roundRobin([melee, ranged], config());
    expect(result.telemetry.acquisitionsByStrategy[melee.id]).toEqual({ heavyBlow: 8 });
    expect(result.telemetry.acquisitionsByStrategy[ranged.id]).toEqual({ volley: 4 });
  });

  it('feeds checkRiggedMelee unchanged, ranking the named final leaders in tournament order', () => {
    const melee = opener(['heavyBlow', 'heavyBlow', 'heavyBlow']);
    const quiet = opener([]);
    const result = roundRobin([melee, quiet], config({ finalLeaderIds: [melee.id, quiet.id] }));
    expect(result.calibration.finalLeaders.map((leader) => leader.rank)).toEqual([1, 2]);
    expect(result.calibration.finalLeaders.map((leader) => leader.strategyId).sort())
      .toEqual([melee.id, quiet.id].sort());
    const check = checkRiggedMelee(result.calibration);
    expect(check.leaderCount).toBe(2);
    expect(check.leadersWhoAcquired).toBe(1);
    expect(result.calibration.acquisitionsByStrategy[melee.id]!.heavyBlow).toBe(12);
  });

  it('leaves the fixed baselines out of the leader set, even when they are named', () => {
    const seeds = seedStrategies(KINGDOM);
    const evolved = opener(['heavyBlow']);
    const labels = baselineLabels(KINGDOM);
    expect(seeds.every((seed) => labels.has(seed.id))).toBe(true);

    const result = roundRobin([evolved, ...seeds], config({
      finalLeaderIds: [evolved.id, ...seeds.map((seed) => seed.id)]
    }));
    expect(result.calibration.finalLeaders).toEqual([{ strategyId: evolved.id, rank: 1 }]);
    expect(checkRiggedMelee(result.calibration)).toMatchObject({ passed: true, leaderCount: 1 });
  });

  it('defaults the leader set to every entrant that is not a baseline', () => {
    const evolved = opener(['heavyBlow']);
    const result = roundRobin([evolved, ...seedStrategies(KINGDOM)], config());
    expect(result.calibration.finalLeaders).toEqual([{ strategyId: evolved.id, rank: 1 }]);
  });
});

describe('the whole search, end to end', () => {
  it('evolves, retains one leader per generation, and reports a gate result', () => {
    const results = evolve({
      kingdomId: KINGDOM, seed: 7, candidates: 6, leaders: 2, generations: 2, sharedSeeds: 1,
      turnLimitPerPlayer: 4, actionCapPerTurn: 200
    }, () => {});
    const finalLeaders = results.at(-1)!.leaders.map((entry) => entry.strategy);
    const entrants = [...finalLeaders, ...retainedLeaders(results), ...seedStrategies(KINGDOM)];

    const tournament = roundRobin(entrants, config({
      seed: 7, finalLeaderIds: finalLeaders.map((leader) => leader.id)
    }));
    // Deduping is by canonical form, so a final leader that is also the retained leader enters once.
    expect(new Set(tournament.entrants.map(canonicalStrategy)).size).toBe(tournament.entrants.length);
    expect(tournament.entrants.length).toBeLessThan(entrants.length);

    const gate = checkRiggedMelee(tournament.calibration);
    expect(gate.leaderCount).toBeGreaterThan(0);
    expect(gate.leaderCount).toBeLessThanOrEqual(finalLeaders.length);
    expect(typeof gate.passed).toBe('boolean');
  });
});
