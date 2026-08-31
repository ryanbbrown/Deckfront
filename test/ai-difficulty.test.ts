import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { randomKingdom } from '../src/game';
import { PretrainedAiTrainer } from '../src/server/aiTrainer';
import { findPretrainedKingdom, pretrainedVariableCardSets } from '../src/server/pretrainedCatalog';
import rawBalanceSuite from '../src/sim/balance-suite-manifest.json' with { type: 'json' };

function signature(cardIds: readonly string[]): string { return [...cardIds].sort().join('|'); }

const expectedKingdoms = rawBalanceSuite.kingdoms.map((kingdom) => ({
  id: kingdom.id,
  signature: signature(kingdom.actionPiles.map((pile) => pile.cardId))
}));
const firstCards = expectedKingdoms.find((kingdom) => kingdom.id === 'balance-tuning-005')!.signature.split('|');
const firstKingdom = randomKingdom('pretrained-ai-test', firstCards);

function loadedKingdoms() {
  return pretrainedVariableCardSets().map((cardIds) => findPretrainedKingdom(cardIds)!);
}

describe('pretrained AI difficulty selection', () => {
  it('loads all 160 balance-suite kingdoms and final-Matrix plans', () => {
    const kingdoms = loadedKingdoms();
    const actualKingdoms = kingdoms.map((kingdom) => ({
      id: kingdom.id,
      signature: signature(kingdom.variableCardIds)
    }));

    expect(actualKingdoms).toEqual(expectedKingdoms);
    expect(kingdoms.flatMap((kingdom) => kingdom.plans)).toHaveLength(8_650);
  });

  it('loads five active and five inactive legal slots for every strategy', () => {
    for (const kingdom of loadedKingdoms()) {
      const legalBuyIds = new Set(['copper', 'silver', 'gold', 'step', 'focus', ...kingdom.variableCardIds]);
      expect(new Set(kingdom.plans.map((plan) => plan.strategy.id)).size).toBe(kingdom.plans.length);
      for (const plan of kingdom.plans) {
        expect(plan.strategy.startingBuild).toEqual([]);
        expect(plan.strategy.buyPlan).toEqual(plan.buyPlan);
        expect(plan.buyPlan.slice(0, 5).map((slot) => slot.kind)).toEqual(['buy', 'buy', 'buy', 'buy', 'buy']);
        expect(plan.buyPlan.slice(5).map((slot) => slot.kind)).toEqual(['inactive', 'inactive', 'inactive', 'inactive', 'inactive']);
        for (const slot of plan.strategy.buyPlan) {
          if (slot.kind === 'buy') expect(legalBuyIds.has(slot.cardId)).toBe(true);
        }
      }
    }
  });

  it('loads 431 positive weights and unit kingdom lotteries', () => {
    const kingdoms = loadedKingdoms();
    const positive = kingdoms.flatMap((kingdom) => kingdom.plans).filter((plan) => plan.equilibriumWeight > 0);
    expect(positive).toHaveLength(431);
    const savedWeights = kingdoms.map((kingdom) => [
      kingdom.id, kingdom.plans.map((plan) => [plan.strategy.id, plan.equilibriumWeight])
    ]);
    expect(createHash('sha256').update(JSON.stringify(savedWeights)).digest('hex'))
      .toBe('b0a6e3accf0f0342e9cded5d368efe6bd39c093b3d3d946033328088319dea7b');
    for (const kingdom of kingdoms) {
      expect(Math.abs(kingdom.plans.reduce((sum, plan) => sum + plan.equilibriumWeight, 0) - 1)).toBeLessThan(1e-12);
    }
  });

  it('matches a kingdom without depending on submitted card order', async () => {
    const trainer = new PretrainedAiTrainer();
    const first = await trainer.train(firstKingdom, 81, 'hard');
    const reordered = await trainer.train(randomKingdom('reordered', [...firstCards].reverse()), 81, 'hard');

    expect(reordered.strategy).toEqual(first.strategy);
    expect(first.summary).toMatchObject({ matches: 0, strategyId: first.strategy.id });
  });

  it('keeps deterministic saved score-band choices for Easy, Normal, and Hard', async () => {
    const trainer = new PretrainedAiTrainer();

    await expect(trainer.train(firstKingdom, 17, 'easy')).resolves.toMatchObject({ strategy: { id: 'gf-9812897' } });
    await expect(trainer.train(firstKingdom, 17, 'normal')).resolves.toMatchObject({ strategy: { id: 'gf-9812897' } });
    await expect(trainer.train(firstKingdom, 17, 'hard')).resolves.toMatchObject({ strategy: { id: 'gf-9812897' } });
  });

  it('samples Expert deterministically from only the saved positive-weight lottery', async () => {
    const cards = expectedKingdoms.find((kingdom) => kingdom.id === 'balance-tuning-021')!.signature.split('|');
    const kingdom = randomKingdom('weighted-expert-test', cards);
    const trained = findPretrainedKingdom(cards)!;
    const trainer = new PretrainedAiTrainer();

    for (const seed of [0, 134, 512]) {
      const selected = await trainer.train(kingdom, seed, 'expert');
      expect(trained.plans.find((plan) => plan.strategy.id === selected.strategy.id)?.equilibriumWeight).toBeGreaterThan(0);
    }
    await expect(trainer.train(kingdom, 134, 'expert')).resolves.toMatchObject({ strategy: { id: 'gf-2507491' } });
    await expect(trainer.train(kingdom, 512, 'expert')).resolves.toMatchObject({ strategy: { id: 'gf-8545963' } });
  });

  it('rejects a kingdom outside the pretrained catalog', async () => {
    const untrained = randomKingdom('untrained', ['cull','footwork','aim','volley','muster','feint','drive','channel','arcBolt','reclaim']);
    await expect(new PretrainedAiTrainer().train(untrained, 1, 'expert')).rejects.toThrow('no pretrained AI opponent');
  });
});
