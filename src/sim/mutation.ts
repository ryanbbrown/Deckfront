import { SeededRandom, kingdomEpoch, kingdomMarket } from '../game';
import { repairBuildIn } from './build';
import { canonicalStrategy, identify } from './strategy';
import type { BuyAgendaEntry, Strategy } from './strategy';

export const MAX_DESIRED_COUNT = 10;

interface KingdomFacts {
  marketIds: readonly string[];
  purchaseIds: readonly string[];
}
const facts = new Map<string, KingdomFacts>();
let factsEpoch = kingdomEpoch();

export function kingdomFacts(kingdomId: string): KingdomFacts {
  if (factsEpoch !== kingdomEpoch()) { facts.clear(); factsEpoch = kingdomEpoch(); }
  const cached = facts.get(kingdomId);
  if (cached) return cached;
  const market = kingdomMarket(kingdomId);
  const built = {
    marketIds: market.filter((card) => card.id !== 'copper').map((card) => card.id),
    purchaseIds: market.filter((card) => card.id !== 'copper' && card.cost > 0).map((card) => card.id)
  };
  facts.set(kingdomId, built);
  return built;
}

function count(ids: readonly string[], wanted: string): number {
  return ids.reduce((total, id) => total + (id === wanted ? 1 : 0), 0);
}

/** Normalizes every strategy to the executable deck-plan shape used for identity and evolution. */
export function repairStrategy(kingdomId: string, strategy: Strategy): Strategy {
  const { marketIds, purchaseIds } = kingdomFacts(kingdomId);
  const sold = new Set(purchaseIds);
  const startingBuild = repairBuildIn(
    kingdomId,
    strategy.startingBuild.filter((cardId) => cardId !== 'copper' && marketIds.includes(cardId))
  ).sort((left, right) => left.localeCompare(right));
  const buyAgenda: BuyAgendaEntry[] = [];
  for (const entry of strategy.buyAgenda) {
    if (!sold.has(entry.cardId) || buyAgenda.some((kept) => kept.cardId === entry.cardId)) continue;
    const desiredCount = Math.max(0, Math.min(MAX_DESIRED_COUNT, Math.round(entry.desiredCount)));
    if (!Number.isFinite(desiredCount) || desiredCount === 0) continue;
    if (count(startingBuild, entry.cardId) >= desiredCount) continue;
    buyAgenda.push({ cardId: entry.cardId, desiredCount });
  }
  const repeatPurchase = sold.has(strategy.repeatPurchase)
    ? strategy.repeatPurchase
    : buyAgenda.at(-1)?.cardId ?? purchaseIds[0];
  if (!repeatPurchase) throw new Error(`Kingdom ${kingdomId} has no legal repeated purchase.`);
  return identify({ id: strategy.id, startingBuild, buyAgenda, repeatPurchase });
}

function pick<T>(items: readonly T[], random: SeededRandom): T | undefined {
  return items.length ? items[random.nextInt(items.length)] : undefined;
}
function between(random: SeededRandom, low: number, high: number): number {
  return low + random.nextInt(high - low + 1);
}
function nonZero(random: SeededRandom, magnitude: number): number {
  const step = between(random, 1, magnitude);
  return random.nextInt(2) === 0 ? -step : step;
}
function insert<T>(items: readonly T[], item: T, random: SeededRandom): T[] {
  const copy = [...items];
  copy.splice(random.nextInt(copy.length + 1), 0, item);
  return copy;
}
function without<T>(items: readonly T[], index: number): T[] {
  const copy = [...items];
  copy.splice(index, 1);
  return copy;
}
function swapped<T>(items: readonly T[], random: SeededRandom): T[] {
  if (items.length < 2) return [...items];
  const copy = [...items];
  const left = random.nextInt(copy.length);
  let right = random.nextInt(copy.length - 1);
  if (right >= left) right += 1;
  [copy[left], copy[right]] = [copy[right]!, copy[left]!];
  return copy;
}

export type MutationName =
  | 'build-add' | 'build-remove' | 'build-replace'
  | 'agenda-add' | 'agenda-remove' | 'agenda-reorder' | 'agenda-count'
  | 'repeat-purchase';

type Operator = (kingdomId: string, strategy: Strategy, random: SeededRandom) => Strategy;

const OPERATORS: Readonly<Record<MutationName, Operator>> = {
  'build-add': (kingdomId, strategy, random) => {
    const card = pick(kingdomFacts(kingdomId).marketIds, random);
    return card ? { ...strategy, startingBuild: insert(strategy.startingBuild, card, random) } : strategy;
  },
  'build-remove': (_kingdomId, strategy, random) => strategy.startingBuild.length
    ? { ...strategy, startingBuild: without(strategy.startingBuild, random.nextInt(strategy.startingBuild.length)) }
    : strategy,
  'build-replace': (kingdomId, strategy, random) => {
    if (!strategy.startingBuild.length) return strategy;
    const card = pick(kingdomFacts(kingdomId).marketIds, random);
    if (!card) return strategy;
    const startingBuild = [...strategy.startingBuild];
    startingBuild[random.nextInt(startingBuild.length)] = card;
    return { ...strategy, startingBuild };
  },
  'agenda-add': (kingdomId, strategy, random) => {
    const card = pick(kingdomFacts(kingdomId).purchaseIds, random);
    return card
      ? { ...strategy, buyAgenda: insert(strategy.buyAgenda, { cardId: card, desiredCount: between(random, 1, 4) }, random) }
      : strategy;
  },
  'agenda-remove': (_kingdomId, strategy, random) => strategy.buyAgenda.length
    ? { ...strategy, buyAgenda: without(strategy.buyAgenda, random.nextInt(strategy.buyAgenda.length)) }
    : strategy,
  'agenda-reorder': (_kingdomId, strategy, random) => ({ ...strategy, buyAgenda: swapped(strategy.buyAgenda, random) }),
  'agenda-count': (_kingdomId, strategy, random) => {
    if (!strategy.buyAgenda.length) return strategy;
    const index = random.nextInt(strategy.buyAgenda.length);
    const buyAgenda = strategy.buyAgenda.map((entry) => ({ ...entry }));
    buyAgenda[index]!.desiredCount += nonZero(random, 3);
    return { ...strategy, buyAgenda };
  },
  'repeat-purchase': (kingdomId, strategy, random) => {
    const alternatives = kingdomFacts(kingdomId).purchaseIds.filter((cardId) => cardId !== strategy.repeatPurchase);
    const repeatPurchase = pick(alternatives, random);
    return repeatPurchase ? { ...strategy, repeatPurchase } : strategy;
  }
};

export const MUTATION_NAMES: readonly MutationName[] = Object.freeze(Object.keys(OPERATORS) as MutationName[]);

export function applyMutation(
  name: MutationName, kingdomId: string, strategy: Strategy, random: SeededRandom
): Strategy {
  return repairStrategy(kingdomId, OPERATORS[name](kingdomId, strategy, random));
}

export function mutationRandom(runSeed: number, generation: number, index: number, salt = 0): SeededRandom {
  let mixed = runSeed >>> 0;
  for (const term of [generation, index, salt]) {
    mixed = (Math.imul(mixed ^ (term + 0x9e3779b9), 0x85ebca6b) >>> 0) ^ (mixed >>> 13);
  }
  return new SeededRandom(mixed >>> 0);
}

export function mutate(kingdomId: string, strategy: Strategy, random: SeededRandom): Strategy {
  let mutated = strategy;
  const changes = between(random, 1, 3);
  for (let step = 0; step < changes; step += 1) {
    const name = MUTATION_NAMES[random.nextInt(MUTATION_NAMES.length)]!;
    mutated = OPERATORS[name](kingdomId, mutated, random);
  }
  return repairStrategy(kingdomId, mutated);
}

export const MUTATION_ATTEMPTS = 32;

export function mutateUnique(
  kingdomId: string, strategy: Strategy, taken: ReadonlySet<string>,
  runSeed: number, generation: number, index: number, attempts = MUTATION_ATTEMPTS
): Strategy | null {
  for (let salt = 0; salt < attempts; salt += 1) {
    const mutated = mutate(kingdomId, strategy, mutationRandom(runSeed, generation, index, salt));
    if (!taken.has(canonicalStrategy(mutated))) return mutated;
  }
  return null;
}
