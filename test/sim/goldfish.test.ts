import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import {
  compareGoldfishScores, compareMovementAwareGoldfishScores, scoreGoldfishStrategy,
  scoreMovementAwareGoldfishStrategy, selectEnrichmentCohorts, summarizeCompetitiveGoldfishEntries
} from '../../src/sim/goldfish';
import type { GoldfishScore, MovementAwareGoldfishScore } from '../../src/sim/goldfish';
import { runGoldfishTrial } from '../../src/sim/simulationKernel';
import { INFINITE_COUNT, fixedBuyPlan, identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

function plan(id: string, cardId: string): Strategy {
  return identify({ id, startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId, desiredCount: INFINITE_COUNT }
  ]) });
}
function config() {
  return { kingdomId: 'goldfish-test', seeds: [11, 12, 13, 14], turnLimit: 30, actionCapPerTurn: 200 };
}

afterEach(() => { resetKingdoms(); });

describe('goldfish scoring', () => {
  it('ranks a legal damage deck above a pure economy deck', () => {
    registerKingdom({ id: 'goldfish-test', name: 'Goldfish test', startingHealth: 50,
      actionPiles: [{ cardId: 'precisionShot', count: 10 }, { cardId: 'strike', count: 10 }] });
    const damage = scoreGoldfishStrategy(plan('damage', 'precisionShot'), config());
    const economy = scoreGoldfishStrategy(plan('economy', 'gold'), config());
    expect(damage.damageArea).toBeGreaterThan(economy.damageArea);
    expect([damage, economy].sort(compareGoldfishScores)[0]!.strategy.id).toBe(damage.strategy.id);
  });

  it('does not credit an out-of-range melee card with damage against the stationary dummy', () => {
    registerKingdom({ id: 'goldfish-test', name: 'Goldfish test', startingHealth: 50,
      actionPiles: [{ cardId: 'precisionShot', count: 10 }, { cardId: 'strike', count: 10 }] });
    const trial = runGoldfishTrial({ kingdomId: 'goldfish-test', seed: 11,
      strategy: plan('melee', 'strike'), turnLimit: 20, actionCapPerTurn: 200 });
    expect(trial.damageByCard.strike).toBeUndefined();
    expect(trial.completed).toBe(false);
  });

  it('uses stable strategy identity as the final deterministic tie-break', () => {
    const score = (strategy: Strategy): GoldfishScore => ({ strategy, trials: 1, completions: 0,
      meanTurnsTo50: null, totalTurnsTo50: 0, damageArea: 10, totalDamage: 1, meanDamage: 1,
      moneySpent: 5, unspentMoney: 0, penalizedTurnsTo50: 31 });
    const first = { ...plan('first', 'gold'), id: 'a' };
    const second = { ...plan('second', 'gold'), id: 'b' };
    expect([score(second), score(first)].sort(compareGoldfishScores).map((entry) => entry.strategy.id))
      .toEqual(['a', 'b']);
  });

  it('moves the scripted target toward and away from the candidate', () => {
    registerKingdom({ id: 'goldfish-test', name: 'Goldfish test', startingHealth: 50,
      actionPiles: [{ cardId: 'precisionShot', count: 10 }, { cardId: 'strike', count: 10 }] });
    const strategy = plan('economy', 'gold');
    const chaser = runGoldfishTrial({ kingdomId: 'goldfish-test', seed: 11, strategy,
      turnLimit: 2, actionCapPerTurn: 200, movementProfile: 'chaser' });
    const kiter = runGoldfishTrial({ kingdomId: 'goldfish-test', seed: 11, strategy,
      turnLimit: 2, actionCapPerTurn: 200, movementProfile: 'kiter' });
    expect(chaser.positionsByTurn.slice(0, 2)).toEqual([
      { candidate: 3, dummy: 4 }, { candidate: 3, dummy: 3 }
    ]);
    expect(kiter.positionsByTurn.slice(0, 3)).toEqual([
      { candidate: 3, dummy: 4 }, { candidate: 3, dummy: 5 }, { candidate: 3, dummy: 6 }
    ]);
  });

  it('ranks a ranged plan with movement above one trapped at Close range', () => {
    registerKingdom({ id: 'goldfish-test', name: 'Goldfish test', startingHealth: 50,
      actionPiles: [{ cardId: 'precisionShot', count: 10 }, { cardId: 'repellingShot', count: 10 }] });
    const still = plan('still', 'precisionShot');
    const mobile = plan('mobile', 'repellingShot');
    const scores = [still, mobile].map((strategy) => scoreMovementAwareGoldfishStrategy(strategy, config()));
    expect(scores.sort(compareMovementAwareGoldfishScores)[0]!.strategy.id).toBe(mobile.id);
  });

  it('selects deterministic disjoint controls without using score rank', () => {
    const scores = Array.from({ length: 8 }, (_unused, index): MovementAwareGoldfishScore => ({
      strategy: { ...plan(`s${index}`, 'gold'), id: `s${index}` }, profiles: [],
      worstCompletions: index, totalCompletions: index, worstPenalizedTurnsTo50: 30 - index,
      totalPenalizedTurnsTo50: 90 - index, worstDamageArea: index, totalDamageArea: index,
      totalMoneySpent: index
    }));
    const first = selectEnrichmentCohorts(scores, 3, 99);
    const second = selectEnrichmentCohorts([...scores].reverse(), 3, 99);
    expect(first.selected.map((entry) => entry.strategy.id)).toEqual(['s7', 's6', 's5']);
    expect(first.controls.map((entry) => entry.strategy.id)).toEqual(second.controls.map((entry) => entry.strategy.id));
    expect(first.controls.some((entry) => first.selected.includes(entry))).toBe(false);
  });

  it('summarizes every candidate across every lottery', () => {
    const summary = summarizeCompetitiveGoldfishEntries([
      { strategyId: 'a', lotteryId: 'one', score: 0.2 },
      { strategyId: 'a', lotteryId: 'two', score: 0.6 },
      { strategyId: 'b', lotteryId: 'one', score: 0.5 },
      { strategyId: 'b', lotteryId: 'two', score: 0.7 }
    ]);
    expect(summary.candidateScores).toEqual([
      { strategyId: 'b', mean: 0.6 }, { strategyId: 'a', mean: 0.4 }
    ]);
    expect(summary.perLotteryMaximum).toEqual({ one: 0.5, two: 0.7 });
    expect(() => summarizeCompetitiveGoldfishEntries([
      { strategyId: 'a', lotteryId: 'one', score: 0.2 },
      { strategyId: 'b', lotteryId: 'two', score: 0.7 }
    ])).toThrow('Every candidate needs every lottery');
  });
});
