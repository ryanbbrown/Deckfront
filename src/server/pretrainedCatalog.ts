import { createHash } from 'node:crypto';
import rawCatalog from './pretrained-opponents.json' with { type: 'json' };
import { ALWAYS_AVAILABLE_ACTION_IDS, RANDOM_KINGDOM_SIZE, TREASURE_IDS, VARIABLE_ACTION_IDS } from '../game';
import { fixedBuyPlan } from '../sim/strategy';
import type { BuyPlanSlot, Strategy } from '../sim/strategy';
import { z } from 'zod';

const EXPECTED_KINGDOM_COUNT = 160;
const EXPECTED_PLAN_COUNT = 8_671;
const EXPECTED_POSITIVE_WEIGHT_COUNT = 430;
const EXPECTED_CATALOG_HASH = '4624c549a2c71ebac9d2066d20150c39bfaa837ff1a11108249a567b9a083e5b';

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
  }).strict()).length(EXPECTED_KINGDOM_COUNT)
}).strict();

export interface PretrainedPlan {
  strategy: Strategy;
  buyPlan: readonly BuyPlanSlot[];
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
  const catalogHash = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
  if (catalogHash !== EXPECTED_CATALOG_HASH) throw new Error('Pretrained catalog does not match the approved evidence.');

  const seenKingdomIds = new Set<string>();
  const seenSignatures = new Set<string>();
  let planCount = 0;
  let positiveWeightCount = 0;
  const fixedBuyCards = new Set([...TREASURE_IDS, ...ALWAYS_AVAILABLE_ACTION_IDS]);
  const kingdoms = parsed.kingdoms.map((rawKingdom): PretrainedKingdom => {
    const heldSignature = signature(rawKingdom.cards);
    if (seenKingdomIds.has(rawKingdom.id) || seenSignatures.has(heldSignature)
      || new Set(rawKingdom.cards).size !== RANDOM_KINGDOM_SIZE
      || rawKingdom.cards.some((cardId) => !VARIABLE_ACTION_IDS.includes(cardId))) {
      throw new Error(`Pretrained kingdom ${rawKingdom.id} has an invalid signature.`);
    }
    seenKingdomIds.add(rawKingdom.id);
    seenSignatures.add(heldSignature);
    const kingdomBuyCards = new Set([...fixedBuyCards, ...rawKingdom.cards]);
    const seenPlanIds = new Set<string>();
    const plans = rawKingdom.plans.map(([id, equilibriumWeight, selectedLotteryScore, encodedSteps]): PretrainedPlan => {
      if (seenPlanIds.has(id)) throw new Error(`Pretrained strategy id is duplicated: ${id}.`);
      seenPlanIds.add(id);
      const activeSlots: Array<Extract<BuyPlanSlot, { kind: 'buy' }>> = [];
      for (let index = 0; index < encodedSteps.length; index += 2) {
        const cardId = encodedSteps[index], desiredCount = encodedSteps[index + 1];
        if (typeof cardId !== 'string' || typeof desiredCount !== 'number'
          || !Number.isInteger(desiredCount) || desiredCount <= 0 || desiredCount > 99
          || !kingdomBuyCards.has(cardId)) throw new Error(`Pretrained strategy ${id} has an invalid buy step.`);
        activeSlots.push(Object.freeze({ kind: 'buy', cardId, desiredCount }));
      }
      const buyPlan = fixedBuyPlan(activeSlots);
      const strategy: Strategy = { id, startingBuild: [], buyPlan };
      return Object.freeze({ strategy: Object.freeze(strategy), buyPlan: Object.freeze(buyPlan), equilibriumWeight, selectedLotteryScore });
    });
    planCount += plans.length;
    positiveWeightCount += plans.filter((plan) => plan.equilibriumWeight > 0).length;
    const totalWeight = plans.reduce((sum, plan) => sum + plan.equilibriumWeight, 0);
    if (Math.abs(totalWeight - 1) > 1e-12 || !plans.some((plan) => plan.equilibriumWeight > 0)) {
      throw new Error(`Pretrained kingdom ${rawKingdom.id} has invalid equilibrium weights.`);
    }
    return Object.freeze({ id: rawKingdom.id, variableCardIds: Object.freeze([...rawKingdom.cards]), plans: Object.freeze(plans) });
  });
  if (seenKingdomIds.size !== EXPECTED_KINGDOM_COUNT || planCount !== EXPECTED_PLAN_COUNT
    || positiveWeightCount !== EXPECTED_POSITIVE_WEIGHT_COUNT) throw new Error('Pretrained catalog is incomplete.');
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
