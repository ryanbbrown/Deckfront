import rawCatalog from './pretrained-opponents.json' with { type: 'json' };
import { ALWAYS_AVAILABLE_ACTION_IDS, RANDOM_KINGDOM_SIZE, TREASURE_IDS, VARIABLE_ACTION_IDS } from '../game';
import { BUY_PLAN_SLOTS, fixedBuyPlan } from '../sim/strategy';
import type { BuyPlanSlot, Strategy } from '../sim/strategy';
import { z } from 'zod';

const EXPECTED_KINGDOMS: Readonly<Record<string, readonly [signature: string, planCount: number]>> = {
  'balance-tuning-005': ['cascade|channel|flurry|heavyBlow|overload|prism|regiment|starfire|strike|volley', 55],
  'balance-tuning-007': ['attune|bullRush|cascade|discharge|feint|flurry|heavyBlow|improvise|stipend|strike', 59],
  'balance-tuning-009': ['attune|discipline|drive|feint|heavyBlow|longshot|openingStrike|precisionShot|prism|starfire', 54],
  'balance-tuning-010': ['aim|bullRush|cull|flurry|jab|leyStep|overload|precisionShot|repellingShot|starfire', 51],
  'balance-tuning-011': ['aim|bullRush|heavyBlow|improvise|jab|openingStrike|prism|reclaim|regroup|scour', 53],
  'balance-tuning-013': ['bullRush|cascade|discipline|feint|heavyBlow|improvise|overload|precisionShot|rally|salvageShot', 58],
  'balance-tuning-014': ['attune|cull|discipline|feint|heavyBlow|jab|pepperingShot|reclaim|reforge|sharpen', 57],
  'balance-tuning-015': ['aim|discipline|jab|leyStep|overload|reclaim|salvageShot|steadyShot|stipend|volley', 52],
  'balance-tuning-018': ['adapt|attune|bullRush|cascade|discharge|drive|footwork|leyStep|overload|prism', 51],
  'balance-tuning-021': ['bullRush|channel|cull|fireball|jab|muster|precisionShot|repellingShot|steadyShot|strike', 51],
  'balance-tuning-024': ['cascade|channel|discharge|drive|fireball|leyStep|reclaim|regroup|scour|sharpen', 51],
  'balance-tuning-029': ['attune|cull|flurry|improvise|muster|openingStrike|overload|prism|reforge|regroup', 54],
  'balance-tuning-031': ['adapt|bullRush|cull|drive|flurry|footwork|longshot|muster|regiment|strike', 55],
  'balance-tuning-033': ['adapt|arcBolt|attune|cascade|channel|fireball|flurry|improvise|overload|starfire', 50],
  'balance-tuning-034': ['adapt|aim|longshot|muster|pepperingShot|precisionShot|regroup|salvageShot|sharpen|volley', 51],
  'balance-tuning-037': ['bullRush|feint|fireball|jab|openingStrike|pepperingShot|rally|reforge|regiment|salvageShot', 51],
  'balance-tuning-042': ['arcBolt|attune|cull|leyStep|regiment|regroup|scour|steadyShot|stipend|strike', 50],
  'balance-tuning-047': ['aim|discharge|discipline|footwork|improvise|pepperingShot|repellingShot|salvageShot|scour|volley', 51],
  'balance-tuning-053': ['feint|flurry|jab|leyStep|longshot|muster|rally|scour|steadyShot|volley', 51],
  'balance-tuning-056': ['fireball|heavyBlow|improvise|jab|leyStep|openingStrike|reforge|starfire|stipend|volley', 52],
  'balance-tuning-057': ['aim|arcBolt|discharge|discipline|footwork|longshot|openingStrike|precisionShot|reclaim|steadyShot', 51],
  'balance-tuning-064': ['arcBolt|discipline|fireball|flurry|improvise|jab|regiment|regroup|scour|sharpen', 53],
  'balance-tuning-067': ['adapt|channel|discharge|discipline|flurry|openingStrike|pepperingShot|repellingShot|sharpen|stipend', 50],
  'balance-tuning-080': ['adapt|arcBolt|bullRush|channel|feint|fireball|longshot|reclaim|scour|strike', 50],
  'balance-tuning-082': ['aim|cascade|drive|heavyBlow|leyStep|longshot|pepperingShot|repellingShot|scour|volley', 51],
  'balance-tuning-086': ['arcBolt|fireball|footwork|heavyBlow|jab|prism|rally|reforge|regiment|scour', 54],
  'balance-tuning-090': ['bullRush|discipline|heavyBlow|muster|rally|reforge|scour|sharpen|starfire|strike', 51],
  'balance-tuning-097': ['aim|arcBolt|attune|footwork|prism|rally|regroup|repellingShot|starfire|steadyShot', 51],
  'balance-tuning-116': ['arcBolt|cascade|muster|precisionShot|prism|reforge|salvageShot|steadyShot|stipend|strike', 52],
  'balance-tuning-126': ['discipline|drive|fireball|flurry|improvise|longshot|precisionShot|reclaim|salvageShot|sharpen', 52]
};

const rawPlanSchema = z.tuple([
  z.string().regex(/^gf-\d+$/u),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.array(z.union([z.string(), z.number()])).length(10)
]);
const rawCatalogSchema = z.object({
  v: z.literal(1),
  kingdoms: z.array(z.object({
    id: z.string().min(1),
    cards: z.array(z.string()).length(RANDOM_KINGDOM_SIZE),
    plans: z.array(rawPlanSchema).min(1)
  }).strict()).length(Object.keys(EXPECTED_KINGDOMS).length)
}).strict();

export interface PretrainedPlan {
  strategy: Strategy;
  equilibriumWeight: number;
  selectedLotteryScore: number;
}
export interface PretrainedKingdom {
  id: string;
  variableCardIds: readonly string[];
  plans: readonly PretrainedPlan[];
}

function signature(cardIds: readonly string[]): string { return [...cardIds].sort().join('|'); }

function loadCatalog(value: unknown): readonly PretrainedKingdom[] {
  const parsed = rawCatalogSchema.parse(value);
  const seenKingdomIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const seenPlanIds = new Set<string>();
  const allowedBuyCards = new Set([...TREASURE_IDS, ...ALWAYS_AVAILABLE_ACTION_IDS]);
  const kingdoms = parsed.kingdoms.map((rawKingdom): PretrainedKingdom => {
    const expected = EXPECTED_KINGDOMS[rawKingdom.id];
    const heldSignature = signature(rawKingdom.cards);
    if (!expected || expected[0] !== heldSignature || expected[1] !== rawKingdom.plans.length
      || seenKingdomIds.has(rawKingdom.id) || seenSignatures.has(heldSignature)
      || new Set(rawKingdom.cards).size !== RANDOM_KINGDOM_SIZE
      || rawKingdom.cards.some((cardId) => !VARIABLE_ACTION_IDS.includes(cardId))) {
      throw new Error(`Pretrained kingdom ${rawKingdom.id} has an invalid signature or plan count.`);
    }
    seenKingdomIds.add(rawKingdom.id); seenSignatures.add(heldSignature);
    const kingdomBuyCards = new Set([...allowedBuyCards, ...rawKingdom.cards]);
    const plans = rawKingdom.plans.map(([id, equilibriumWeight, selectedLotteryScore, encodedSteps]): PretrainedPlan => {
      if (seenPlanIds.has(id)) throw new Error(`Pretrained strategy id is duplicated: ${id}.`);
      seenPlanIds.add(id);
      const activeSlots: BuyPlanSlot[] = [];
      for (let index = 0; index < encodedSteps.length; index += 2) {
        const cardId = encodedSteps[index], desiredCount = encodedSteps[index + 1];
        if (typeof cardId !== 'string' || typeof desiredCount !== 'number'
          || !Number.isInteger(desiredCount) || desiredCount <= 0 || desiredCount > 99
          || !kingdomBuyCards.has(cardId)) throw new Error(`Pretrained strategy ${id} has an invalid buy step.`);
        activeSlots.push({ kind: 'buy', cardId, desiredCount });
      }
      const strategy: Strategy = { id, startingBuild: [], buyPlan: fixedBuyPlan(activeSlots) };
      if (strategy.buyPlan.length !== BUY_PLAN_SLOTS) throw new Error(`Pretrained strategy ${id} has an invalid plan length.`);
      return { strategy, equilibriumWeight, selectedLotteryScore };
    });
    const totalWeight = plans.reduce((sum, plan) => sum + plan.equilibriumWeight, 0);
    if (Math.abs(totalWeight - 1) > 1e-9 || !plans.some((plan) => plan.equilibriumWeight > 0)) {
      throw new Error(`Pretrained kingdom ${rawKingdom.id} has invalid equilibrium weights.`);
    }
    return { id: rawKingdom.id, variableCardIds: Object.freeze([...rawKingdom.cards]), plans: Object.freeze(plans) };
  });
  if (seenKingdomIds.size !== Object.keys(EXPECTED_KINGDOMS).length) throw new Error('Pretrained catalog is incomplete.');
  return Object.freeze(kingdoms);
}

const CATALOG = loadCatalog(rawCatalog);
const BY_SIGNATURE = new Map(CATALOG.map((kingdom) => [signature(kingdom.variableCardIds), kingdom]));

export function pretrainedVariableCardSets(): string[][] {
  return CATALOG.map((kingdom) => [...kingdom.variableCardIds]);
}

export function findPretrainedKingdom(variableCardIds: readonly string[]): PretrainedKingdom | null {
  if (variableCardIds.length !== RANDOM_KINGDOM_SIZE || new Set(variableCardIds).size !== RANDOM_KINGDOM_SIZE) return null;
  return BY_SIGNATURE.get(signature(variableCardIds)) ?? null;
}
