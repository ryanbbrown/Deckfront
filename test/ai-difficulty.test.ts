import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { randomKingdom } from '../src/game';
import { PretrainedAiTrainer } from '../src/server/aiTrainer';
import { findPretrainedKingdom, pretrainedVariableCardSets } from '../src/server/pretrainedCatalog';

const EXPECTED_KINGDOMS: Record<string, [signature: string, planCount: number]> = {
  'balance-tuning-005': ['cascade|channel|flurry|heavyBlow|overload|prism|regiment|starfire|strike|volley', 54],
  'balance-tuning-007': ['attune|bullRush|cascade|discharge|feint|flurry|heavyBlow|improvise|stipend|strike', 55],
  'balance-tuning-009': ['attune|discipline|drive|feint|heavyBlow|longshot|openingStrike|precisionShot|prism|starfire', 58],
  'balance-tuning-010': ['aim|bullRush|cull|flurry|jab|leyStep|overload|precisionShot|repellingShot|starfire', 55],
  'balance-tuning-011': ['aim|bullRush|heavyBlow|improvise|jab|openingStrike|prism|reclaim|regroup|scour', 51],
  'balance-tuning-013': ['bullRush|cascade|discipline|feint|heavyBlow|improvise|overload|precisionShot|rally|salvageShot', 50],
  'balance-tuning-014': ['attune|cull|discipline|feint|heavyBlow|jab|pepperingShot|reclaim|reforge|sharpen', 53],
  'balance-tuning-015': ['aim|discipline|jab|leyStep|overload|reclaim|salvageShot|steadyShot|stipend|volley', 50],
  'balance-tuning-018': ['adapt|attune|bullRush|cascade|discharge|drive|footwork|leyStep|overload|prism', 54],
  'balance-tuning-021': ['bullRush|channel|cull|fireball|jab|muster|precisionShot|repellingShot|steadyShot|strike', 54],
  'balance-tuning-024': ['cascade|channel|discharge|drive|fireball|leyStep|reclaim|regroup|scour|sharpen', 51],
  'balance-tuning-029': ['attune|cull|flurry|improvise|muster|openingStrike|overload|prism|reforge|regroup', 56],
  'balance-tuning-031': ['adapt|bullRush|cull|drive|flurry|footwork|longshot|muster|regiment|strike', 55],
  'balance-tuning-033': ['adapt|arcBolt|attune|cascade|channel|fireball|flurry|improvise|overload|starfire', 50],
  'balance-tuning-034': ['adapt|aim|longshot|muster|pepperingShot|precisionShot|regroup|salvageShot|sharpen|volley', 52],
  'balance-tuning-037': ['bullRush|feint|fireball|jab|openingStrike|pepperingShot|rally|reforge|regiment|salvageShot', 51],
  'balance-tuning-042': ['arcBolt|attune|cull|leyStep|regiment|regroup|scour|steadyShot|stipend|strike', 52],
  'balance-tuning-047': ['aim|discharge|discipline|footwork|improvise|pepperingShot|repellingShot|salvageShot|scour|volley', 50],
  'balance-tuning-053': ['feint|flurry|jab|leyStep|longshot|muster|rally|scour|steadyShot|volley', 52],
  'balance-tuning-056': ['fireball|heavyBlow|improvise|jab|leyStep|openingStrike|reforge|starfire|stipend|volley', 56],
  'balance-tuning-057': ['aim|arcBolt|discharge|discipline|footwork|longshot|openingStrike|precisionShot|reclaim|steadyShot', 53],
  'balance-tuning-064': ['arcBolt|discipline|fireball|flurry|improvise|jab|regiment|regroup|scour|sharpen', 56],
  'balance-tuning-067': ['adapt|channel|discharge|discipline|flurry|openingStrike|pepperingShot|repellingShot|sharpen|stipend', 51],
  'balance-tuning-080': ['adapt|arcBolt|bullRush|channel|feint|fireball|longshot|reclaim|scour|strike', 50],
  'balance-tuning-082': ['aim|cascade|drive|heavyBlow|leyStep|longshot|pepperingShot|repellingShot|scour|volley', 52],
  'balance-tuning-086': ['arcBolt|fireball|footwork|heavyBlow|jab|prism|rally|reforge|regiment|scour', 51],
  'balance-tuning-090': ['bullRush|discipline|heavyBlow|muster|rally|reforge|scour|sharpen|starfire|strike', 51],
  'balance-tuning-097': ['aim|arcBolt|attune|footwork|prism|rally|regroup|repellingShot|starfire|steadyShot', 52],
  'balance-tuning-116': ['arcBolt|cascade|muster|precisionShot|prism|reforge|salvageShot|steadyShot|stipend|strike', 52],
  'balance-tuning-126': ['discipline|drive|fireball|flurry|improvise|longshot|precisionShot|reclaim|salvageShot|sharpen', 51]
};
const firstCards = EXPECTED_KINGDOMS['balance-tuning-005']![0].split('|');
const firstKingdom = randomKingdom('pretrained-ai-test', firstCards);

function loadedKingdoms() {
  return pretrainedVariableCardSets().map((cardIds) => findPretrainedKingdom(cardIds)!);
}

describe('pretrained AI difficulty selection', () => {
  it('loads the 30 literal kingdom signatures and final-Matrix plan counts', () => {
    const kingdoms = loadedKingdoms();
    const actual = Object.fromEntries(kingdoms.map((kingdom) => [
      kingdom.id, [[...kingdom.variableCardIds].sort().join('|'), kingdom.plans.length]
    ]));

    expect(actual).toEqual(EXPECTED_KINGDOMS);
    expect(kingdoms.flatMap((kingdom) => kingdom.plans)).toHaveLength(1_578);
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

  it('loads 70 positive weights, unit kingdom lotteries, and one valid cross-kingdom duplicate id', () => {
    const kingdoms = loadedKingdoms();
    const positive = kingdoms.flatMap((kingdom) => kingdom.plans).filter((plan) => plan.equilibriumWeight > 0);
    expect(positive).toHaveLength(70);
    const savedWeights = kingdoms.map((kingdom) => [
      kingdom.id, kingdom.plans.map((plan) => [plan.strategy.id, plan.equilibriumWeight])
    ]);
    expect(createHash('sha256').update(JSON.stringify(savedWeights)).digest('hex'))
      .toBe('5109b481821a3235afb8091566ec5361267b605309669bb1a67f2ba20b892fbd');
    for (const kingdom of kingdoms) {
      expect(Math.abs(kingdom.plans.reduce((sum, plan) => sum + plan.equilibriumWeight, 0) - 1)).toBeLessThan(1e-12);
    }
    const owners = new Map<string, string[]>();
    for (const kingdom of kingdoms) for (const plan of kingdom.plans) {
      owners.set(plan.strategy.id, [...(owners.get(plan.strategy.id) ?? []), kingdom.id]);
    }
    expect([...owners].filter((entry) => entry[1].length > 1)).toEqual([
      ['gf-11949081', ['balance-tuning-014', 'balance-tuning-064']]
    ]);
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
    const cards = EXPECTED_KINGDOMS['balance-tuning-021']![0].split('|');
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
