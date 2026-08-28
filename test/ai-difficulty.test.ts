import { describe, expect, it } from 'vitest';
import { randomKingdom } from '../src/game';
import { PretrainedAiTrainer } from '../src/server/aiTrainer';
import { findPretrainedKingdom, pretrainedVariableCardSets } from '../src/server/pretrainedCatalog';

const cards = ['cascade','channel','flurry','heavyBlow','overload','prism','regiment','starfire','strike','volley'];
const kingdom = randomKingdom('pretrained-ai-test', cards);

describe('pretrained AI difficulty selection', () => {
  it('loads all exact kingdoms and final-matrix plans as padded ordered plans', () => {
    const cardSets = pretrainedVariableCardSets();
    const planCounts = cardSets.map((cardIds) => findPretrainedKingdom(cardIds)!.plans.length);
    const plans = cardSets.flatMap((cardIds) => findPretrainedKingdom(cardIds)!.plans);

    expect(cardSets).toHaveLength(30);
    expect(new Set(cardSets.map((cardIds) => [...cardIds].sort().join('|'))).size).toBe(30);
    expect(planCounts.reduce((sum, count) => sum + count, 0)).toBe(1_572);
    expect(plans.every((plan) => plan.buyPlan.length === 10)).toBe(true);
    expect(plans.every((plan) => plan.strategy.buyAgenda.length === plan.buyPlan.filter((slot) => slot.kind === 'buy').length)).toBe(true);
    expect(plans.every((plan) => plan.strategy.repeatPurchase === 'copper')).toBe(true);
  });

  it('matches a kingdom without depending on submitted card order', async () => {
    const trainer = new PretrainedAiTrainer();
    const first = await trainer.train(kingdom, 81, 'hard');
    const reordered = await trainer.train(randomKingdom('reordered', [...cards].reverse()), 81, 'hard');

    expect(reordered.strategy).toEqual(first.strategy);
    expect(first.summary).toMatchObject({ matches: 0, strategyId: first.strategy.id });
  });

  it('keeps deterministic saved score-band choices for Easy, Normal, and Hard', async () => {
    const trainer = new PretrainedAiTrainer();

    await expect(trainer.train(kingdom, 17, 'easy')).resolves.toMatchObject({ strategy: { id: 'gf-594448' } });
    await expect(trainer.train(kingdom, 17, 'normal')).resolves.toMatchObject({ strategy: { id: 'gf-594448' } });
    await expect(trainer.train(kingdom, 17, 'hard')).resolves.toMatchObject({ strategy: { id: 'gf-7839095' } });
  });

  it('samples Expert from only the positive-weight saved equilibrium plans', async () => {
    const trainer = new PretrainedAiTrainer();
    const trained = findPretrainedKingdom(cards)!;

    for (const seed of [134, 512, 0]) {
      const selected = await trainer.train(kingdom, seed, 'expert');
      expect(trained.plans.find((plan) => plan.strategy.id === selected.strategy.id)?.equilibriumWeight).toBeGreaterThan(0);
    }
    await expect(trainer.train(kingdom, 134, 'expert')).resolves.toMatchObject({ strategy: { id: 'gf-5261852' } });
    await expect(trainer.train(kingdom, 512, 'expert')).resolves.toMatchObject({ strategy: { id: 'gf-5256923' } });
    await expect(trainer.train(kingdom, 0, 'expert')).resolves.toMatchObject({ strategy: { id: 'gf-7839110' } });
  });

  it('rejects a kingdom outside the pretrained catalog', async () => {
    const untrained = randomKingdom('untrained', ['cull','footwork','aim','volley','muster','feint','drive','channel','arcBolt','reclaim']);
    await expect(new PretrainedAiTrainer().train(untrained, 1, 'expert')).rejects.toThrow('no pretrained AI opponent');
  });
});
