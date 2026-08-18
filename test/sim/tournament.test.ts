import { afterEach, describe, expect, it } from 'vitest';
import { resetKingdoms } from '../../src/game';
import { checkRiggedMelee } from '../../src/sim/calibration';
import { evolve, retainedLeaders } from '../../src/sim/evolution';
import { repairStrategy } from '../../src/sim/mutation';
import { seedLabels, seedStrategies } from '../../src/sim/seedPopulation';
import { canonicalStrategy } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import { roundRobin } from '../../src/sim/tournament';
import { emptyAggregate } from '../../src/sim/pairing';
import type { PairingOutcome } from '../../src/sim/pairing';
import type { PairingRunner } from '../../src/sim/pairingRunner';
import type { TournamentConfig } from '../../src/sim/types';
import { strategy } from './fixtures';

afterEach(() => { resetKingdoms(); });

const KINGDOM = 'rigged-melee';

function config(overrides: Partial<TournamentConfig> = {}): TournamentConfig {
  return {
    kingdomId: KINGDOM, seed: 31, sharedSeeds: 1, turnLimitPerPlayer: 4, actionCapPerTurn: 200,
    finalLeaderIds: [], ...overrides
  };
}
/** A strategy that acquires exactly its starting build: no agenda and no treasure fallback. */
function opener(build: string[]): Strategy {
  return repairStrategy(KINGDOM, strategy({ startingBuild: build, buyAgenda: [], treasureFallback: [] }));
}

function pairing(candidateMean: number | null, matches: number, aborted = 0): PairingOutcome {
  const played = candidateMean === null ? 0 : matches - aborted;
  return {
    record: {
      played, wins: candidateMean === 1 ? played : 0, draws: candidateMean === 0.5 ? played : 0,
      losses: candidateMean === 0 ? played : 0, aborted
    },
    candidateScore: candidateMean === null ? 0 : candidateMean * played,
    opponentScore: candidateMean === null ? 0 : (1 - candidateMean) * played,
    candidateMean,
    opponentMean: candidateMean === null ? null : 1 - candidateMean,
    telemetry: emptyAggregate(), matches, seedBlocks: matches / 4, stopReason: 'maximum'
  };
}

function outcomeRunner(outcomes: readonly PairingOutcome[]): PairingRunner {
  return {
    run: async (jobs) => ({ outcomes: jobs.map((_, index) => outcomes[index] ?? null), submitted: jobs.length }),
    close: async () => {}
  };
}

describe('the pairwise table', () => {
  it('weights every completed opponent pairing equally and reports actual attempted matches', async () => {
    const entrants = [opener(['heavyBlow']), opener(['volley']), opener(['arcBolt'])];
    const result = await roundRobin(
      entrants,
      config({ finalLeaderIds: entrants.map((entrant) => entrant.id) }),
      outcomeRunner([pairing(1, 48), pairing(0, 100), pairing(0.5, 100)])
    );
    const alpha = result.ranking.find((entry) => entry.strategy.id === entrants[0]!.id)!;
    expect(alpha.score).toBe(0.5);
    expect(alpha.completedPairings).toBe(2);
    expect(alpha.completedGames).toBe(148);
    expect(result.matches).toBe(248);
  });

  it('excludes a fully aborted pairing from the strategy score denominator', async () => {
    const entrants = [opener(['heavyBlow']), opener(['volley']), opener(['arcBolt'])];
    const result = await roundRobin(
      entrants,
      config({ finalLeaderIds: entrants.map((entrant) => entrant.id) }),
      outcomeRunner([pairing(null, 4, 4), pairing(1, 4), pairing(0.5, 4)])
    );
    const alpha = result.ranking.find((entry) => entry.strategy.id === entrants[0]!.id)!;
    expect(alpha).toMatchObject({ score: 1, completedPairings: 1, completedGames: 4, abortedGames: 4 });
  });

  it('balances every pair, holds no self entry, and lists unique entrants', async () => {
    const entrants = seedStrategies(KINGDOM);
    const result = await roundRobin(entrants, config({ finalLeaderIds: entrants.map((entrant) => entrant.id) }));
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

  it('enters a leader retained unchanged once, however many times it is offered', async () => {
    const entrants = seedStrategies(KINGDOM);
    const repeated = [...entrants, entrants[0]!, { ...entrants[1]!, id: 'renamed' }];
    const result = await roundRobin(repeated, config({ finalLeaderIds: [entrants[0]!.id] }));
    expect(result.entrants.map((entrant) => entrant.id)).toEqual(entrants.map((entrant) => entrant.id));
  });

  it('stops between pairings when the injected clock passes the deadline', async () => {
    let clock = 500;
    const seeds = seedStrategies(KINGDOM);
    const result = await roundRobin(seeds, config({ deadline: 502, now: () => (clock += 1), finalLeaderIds: [seeds[0]!.id] }));
    const played = Object.values(result.pairs).flatMap((row) => Object.values(row));
    expect(played.length).toBeLessThan(result.entrants.length * (result.entrants.length - 1));
    expect(result.entrants).toHaveLength(5);
    // The verdict is still built, and `partial` is what stops it being read as a complete one.
    expect(result.partial).toBe(true);
    expect(result.pairsExpected).toBe(10);
    expect(result.pairsPlayed).toBeLessThan(result.pairsExpected);
    expect(result.pairsPlayed).toBe(played.length / 2);
  });

  it('marks a table that played every pair as complete', async () => {
    const seeds = seedStrategies(KINGDOM);
    const result = await roundRobin(seeds, config({ finalLeaderIds: [seeds[0]!.id] }));
    expect(result.partial).toBe(false);
    expect(result.pairsPlayed).toBe(10);
    expect(result.pairsPlayed).toBe(result.pairsExpected);
  });

  // The id is a 32-bit hash, so a collision is unlikely but not impossible, and it would merge two
  // strategies' rows and scores with nothing in the output saying so.
  it('throws when two different strategies arrive under one id', async () => {
    const seeds = seedStrategies(KINGDOM);
    const collided = { ...seeds[1]!, id: seeds[0]!.id };
    await expect(roundRobin([seeds[0]!, collided], config({ finalLeaderIds: [seeds[0]!.id] })))
      .rejects.toThrow(`Two different strategies share the id ${seeds[0]!.id}`);
  });
});

describe('the calibration input the tournament builds', () => {
  it('sums acquisitions over both seats and both arena sides', async () => {
    // Neither side buys anything, so acquisition is the starting build alone: one copy for each of
    // the four games a pairing plays.
    const melee = opener(['heavyBlow', 'heavyBlow']);
    const ranged = opener(['volley']);
    const result = await roundRobin([melee, ranged], config({ finalLeaderIds: [melee.id] }));
    expect(result.telemetry.acquisitionsByStrategy[melee.id]).toEqual({ heavyBlow: 8 });
    expect(result.telemetry.acquisitionsByStrategy[ranged.id]).toEqual({ volley: 4 });
  });

  it('feeds checkRiggedMelee unchanged, ranking the named final leaders in tournament order', async () => {
    const melee = opener(['heavyBlow', 'heavyBlow', 'heavyBlow']);
    const quiet = opener([]);
    const result = await roundRobin([melee, quiet], config({ finalLeaderIds: [melee.id, quiet.id] }));
    expect(result.calibration.finalLeaders.map((leader) => leader.rank)).toEqual([1, 2]);
    expect(result.calibration.finalLeaders.map((leader) => leader.strategyId).sort())
      .toEqual([melee.id, quiet.id].sort());
    const check = checkRiggedMelee(result.calibration);
    expect(check.leaderCount).toBe(2);
    expect(check.leadersWhoAcquired).toBe(1);
    expect(result.calibration.acquisitionsByStrategy[melee.id]!.heavyBlow).toBe(12);
  });

  it('leaves the fixed seeds out of the leader set, even when they are named', async () => {
    const seeds = seedStrategies(KINGDOM);
    const evolved = opener(['heavyBlow']);
    const labels = seedLabels(KINGDOM);
    expect(seeds.every((seed) => labels.has(seed.id))).toBe(true);

    const result = await roundRobin([evolved, ...seeds], config({
      finalLeaderIds: [evolved.id, ...seeds.map((seed) => seed.id)]
    }));
    expect(result.calibration.finalLeaders).toEqual([{ strategyId: evolved.id, rank: 1 }]);
    expect(checkRiggedMelee(result.calibration)).toMatchObject({ passed: true, leaderCount: 1 });
  });

  it('throws when a named final leader never entered the tournament', async () => {
    const seeds = seedStrategies(KINGDOM);
    await expect(roundRobin(seeds, config({ finalLeaderIds: ['sg-never-played'] })))
      .rejects.toThrow('Final leader sg-never-played is not one of the tournament entrants');
  });
});

describe('the whole search, end to end', () => {
  async function search(seed: number): Promise<{ finalLeaders: Strategy[]; entrants: Strategy[] }> {
    const results = await evolve({
      kingdomId: KINGDOM, seed, candidates: 6, leaders: 2, generations: 2, sharedSeeds: 1,
      turnLimitPerPlayer: 4, actionCapPerTurn: 200
    }, () => {});
    const finalLeaders = results.at(-1)!.leaders.map((entry) => entry.strategy);
    return { finalLeaders, entrants: [...finalLeaders, ...retainedLeaders(results), ...seedStrategies(KINGDOM)] };
  }

  it('evolves, retains one leader per generation, and reports a gate result', async () => {
    const { finalLeaders, entrants } = await search(6);
    const labels = seedLabels(KINGDOM);
    expect(finalLeaders.every((leader) => !labels.has(leader.id))).toBe(true);

    const tournament = await roundRobin(entrants, config({
      seed: 6, finalLeaderIds: finalLeaders.map((leader) => leader.id)
    }));
    // Deduping is by canonical form, so a final leader that is also the retained leader enters once.
    expect(new Set(tournament.entrants.map(canonicalStrategy)).size).toBe(tournament.entrants.length);
    expect(tournament.entrants.length).toBeLessThan(entrants.length);

    const gate = checkRiggedMelee(tournament.calibration);
    expect(gate.leaderCount).toBe(finalLeaders.length);
    expect(typeof gate.passed).toBe('boolean');
  });

  // If the search cannot beat the fixed seeds, the gate has nothing evolved to judge and must
  // refuse instead of passing on a seed's record.
  it('refuses the gate when every final leader is a fixed seed', async () => {
    const finalLeaders = seedStrategies(KINGDOM).slice(0, 2);
    const entrants = [...finalLeaders];
    const labels = seedLabels(KINGDOM);
    expect(finalLeaders.every((leader) => labels.has(leader.id))).toBe(true);

    const tournament = await roundRobin(entrants, config({
      seed: 7, finalLeaderIds: finalLeaders.map((leader) => leader.id)
    }));
    expect(tournament.calibration.finalLeaders).toEqual([]);
    expect(() => checkRiggedMelee(tournament.calibration)).toThrow('needs at least one final leader');
  });
});
