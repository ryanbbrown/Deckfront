import { SeededRandom, kingdomMarket } from '../game';
import { kingdomFacts, repairStrategy } from './mutation';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

export const MAX_RANDOM_BUILD_LENGTH = 8;

export function randomLegalStrategy(kingdomId: string, random: SeededRandom): Strategy {
  const facts = kingdomFacts(kingdomId);
  if (!facts.purchaseIds.length) throw new Error(`Kingdom ${kingdomId} has no legal purchases.`);
  const buildLength = random.nextInt(MAX_RANDOM_BUILD_LENGTH + 1);
  const startingBuild = Array.from({ length: buildLength }, () =>
    facts.marketIds[random.nextInt(facts.marketIds.length)]!);
  const shuffled = [...facts.purchaseIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = random.nextInt(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  const agendaLength = random.nextInt(shuffled.length + 1);
  return repairStrategy(kingdomId, {
    id: '',
    startingBuild,
    buyAgenda: shuffled.slice(0, agendaLength).map((cardId) => ({ cardId, desiredCount: 1 + random.nextInt(6) })),
    repeatPurchase: facts.purchaseIds[random.nextInt(facts.purchaseIds.length)]!
  });
}

export function randomUniqueStrategies(
  kingdomId: string, seed: number, count: number, taken: ReadonlySet<string> = new Set()
): { strategies: Strategy[]; duplicateRejections: number; shortfall: number } {
  const random = new SeededRandom(seed);
  const forms = new Set(taken);
  const strategies: Strategy[] = [];
  let duplicateRejections = 0;
  const attemptLimit = Math.max(100, count * 64);
  for (let attempt = 0; attempt < attemptLimit && strategies.length < count; attempt += 1) {
    const strategy = randomLegalStrategy(kingdomId, random);
    const form = canonicalStrategy(strategy);
    if (forms.has(form)) { duplicateRejections += 1; continue; }
    forms.add(form);
    strategies.push(strategy);
  }
  return { strategies, duplicateRejections, shortfall: count - strategies.length };
}

export function strategyIsLegal(kingdomId: string, strategy: Strategy): boolean {
  const market = new Set(kingdomMarket(kingdomId).map((card) => card.id));
  return canonicalStrategy(repairStrategy(kingdomId, strategy)) === canonicalStrategy(strategy)
    && strategy.startingBuild.every((card) => market.has(card) && card !== 'copper')
    && strategy.buyAgenda.every((entry) => entry.cardId !== 'copper')
    && strategy.repeatPurchase !== 'copper';
}
