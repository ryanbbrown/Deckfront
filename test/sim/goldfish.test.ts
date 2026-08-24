import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { compareGoldfishScores, scoreGoldfishStrategy } from '../../src/sim/goldfish';
import type { GoldfishScore } from '../../src/sim/goldfish';
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
      meanTurnsTo50: null, totalTurnsTo50: 0, damageArea: 10, meanDamage: 1,
      moneySpent: 5, unspentMoney: 0 });
    const first = { ...plan('first', 'gold'), id: 'a' };
    const second = { ...plan('second', 'gold'), id: 'b' };
    expect([score(second), score(first)].sort(compareGoldfishScores).map((entry) => entry.strategy.id))
      .toEqual(['a', 'b']);
  });
});
