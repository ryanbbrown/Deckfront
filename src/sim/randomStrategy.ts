import { SeededRandom, kingdomMarket } from '../game';
import { kingdomFacts, repairStrategy } from './mutation';
import { BUY_PLAN_SLOTS, INFINITE_COUNT, MAXIMUM_STOP_THRESHOLD, canonicalStrategy, fixedBuyPlan } from './strategy';
import type { BuyPlanSlot, Strategy } from './strategy';

export const MAX_RANDOM_BUILD_LENGTH = 8;

export function randomLegalStrategy(kingdomId: string, random: SeededRandom): Strategy {
  const facts = kingdomFacts(kingdomId);
  if (!facts.purchaseIds.length) throw new Error(`Kingdom ${kingdomId} has no legal purchases.`);
  const buildLength = random.nextInt(MAX_RANDOM_BUILD_LENGTH + 1);
  const startingBuild = Array.from({ length: buildLength }, () =>
    facts.marketIds[random.nextInt(facts.marketIds.length)]!);
  const buyPlan = fixedBuyPlan([]);
  const activeCount = 1 + random.nextInt(3);
  const open = Array.from({ length: BUY_PLAN_SLOTS }, (_unused, index) => index);
  for (let active = 0; active < activeCount; active += 1) {
    const pick = random.nextInt(open.length); const index = open.splice(pick, 1)[0]!;
    const slot: BuyPlanSlot = random.nextInt(5) === 0
      ? { kind: 'stop', threshold: random.nextInt(MAXIMUM_STOP_THRESHOLD + 1) }
      : { kind: 'buy', cardId: facts.purchaseIds[random.nextInt(facts.purchaseIds.length)]!,
          desiredCount: random.nextInt(3) === 0 ? INFINITE_COUNT : 1 + random.nextInt(6) };
    buyPlan[index] = slot;
  }
  return repairStrategy(kingdomId, { id: '', startingBuild, buyPlan });
}

export function randomUniqueStrategies(
  kingdomId: string, seed: number, count: number, taken: ReadonlySet<string> = new Set()
): { strategies: Strategy[]; duplicateRejections: number; shortfall: number } {
  const random = new SeededRandom(seed);
  const forms = new Set(taken); const strategies: Strategy[] = [];
  let duplicateRejections = 0;
  const attemptLimit = Math.max(100, count * 64);
  for (let attempt = 0; attempt < attemptLimit && strategies.length < count; attempt += 1) {
    const strategy = randomLegalStrategy(kingdomId, random);
    const form = canonicalStrategy(strategy);
    if (forms.has(form)) { duplicateRejections += 1; continue; }
    forms.add(form); strategies.push(strategy);
  }
  return { strategies, duplicateRejections, shortfall: count - strategies.length };
}

export function strategyIsLegal(kingdomId: string, strategy: Strategy): boolean {
  const market = new Set(kingdomMarket(kingdomId).map((card) => card.id));
  return strategy.buyPlan.length === BUY_PLAN_SLOTS
    && canonicalStrategy(repairStrategy(kingdomId, strategy)) === canonicalStrategy(strategy)
    && strategy.startingBuild.every((card) => market.has(card) && card !== 'copper')
    && strategy.buyPlan.every((slot) => slot.kind !== 'buy' || slot.cardId !== 'copper');
}
