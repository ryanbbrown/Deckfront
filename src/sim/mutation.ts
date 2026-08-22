import { SeededRandom, kingdomEpoch, kingdomMarket } from '../game';
import { repairBuildIn } from './build';
import {
  BUY_PLAN_SLOTS, INFINITE_COUNT, MAXIMUM_FINITE_COUNT, MAXIMUM_STOP_THRESHOLD,
  canonicalStrategy, fixedBuyPlan, identify, inactiveSlot
} from './strategy';
import type { BuyPlanSlot, BuySlot, Strategy } from './strategy';

export interface KingdomFacts { marketIds: readonly string[]; purchaseIds: readonly string[] }
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

/** Normalizes every strategy to one valid ten-slot executable form. */
export function repairStrategy(kingdomId: string, strategy: Strategy): Strategy {
  const { marketIds, purchaseIds } = kingdomFacts(kingdomId);
  const sold = new Set(purchaseIds);
  const startingBuild = repairBuildIn(kingdomId,
    strategy.startingBuild.filter((cardId) => cardId !== 'copper' && marketIds.includes(cardId)))
    .sort((left, right) => left.localeCompare(right));
  const normalized = fixedBuyPlan(strategy.buyPlan).map((slot): BuyPlanSlot => {
    if (slot.kind === 'inactive') return inactiveSlot();
    if (slot.kind === 'stop') {
      const threshold = Math.round(slot.threshold);
      return Number.isFinite(threshold) && threshold >= 0 && threshold <= MAXIMUM_STOP_THRESHOLD
        ? { kind: 'stop', threshold } : inactiveSlot();
    }
    if (!sold.has(slot.cardId)) return inactiveSlot();
    const rounded = Math.round(slot.desiredCount);
    if (!Number.isFinite(rounded) || rounded <= 0) return inactiveSlot();
    const desiredCount = rounded >= INFINITE_COUNT
      ? INFINITE_COUNT : Math.min(MAXIMUM_FINITE_COUNT, rounded);
    if (desiredCount !== INFINITE_COUNT && count(startingBuild, slot.cardId) >= desiredCount) return inactiveSlot();
    return { kind: 'buy', cardId: slot.cardId, desiredCount };
  });
  // Without cost bands, inactive gaps have no behavior. Keep one canonical form so search never
  // spends games comparing ladders that execute identically.
  const buyPlan = fixedBuyPlan(normalized.filter((slot) => slot.kind !== 'inactive'));
  return identify({ id: strategy.id, startingBuild, buyPlan });
}

function pick<T>(items: readonly T[], random: SeededRandom): T | undefined {
  return items.length ? items[random.nextInt(items.length)] : undefined;
}
function between(random: SeededRandom, low: number, high: number): number {
  return low + random.nextInt(high - low + 1);
}
function replaceSlot(strategy: Strategy, index: number, slot: BuyPlanSlot): Strategy {
  return { ...strategy, buyPlan: strategy.buyPlan.map((held, position) => position === index ? slot : held) };
}
function randomBuy(kingdomId: string, random: SeededRandom): BuySlot | null {
  const cardId = pick(kingdomFacts(kingdomId).purchaseIds, random);
  if (!cardId) return null;
  return { kind: 'buy', cardId, desiredCount: random.nextInt(4) === 0 ? INFINITE_COUNT : between(random, 1, 4) };
}

export type MutationName =
  | 'build-add' | 'build-remove' | 'build-replace'
  | 'slot-activate' | 'slot-deactivate' | 'slot-card' | 'slot-count'
  | 'slot-kind' | 'slot-stop-threshold' | 'slot-reorder';
type Operator = (kingdomId: string, strategy: Strategy, random: SeededRandom) => Strategy;

const OPERATORS: Readonly<Record<MutationName, Operator>> = {
  'build-add': (kingdomId, strategy, random) => {
    const card = pick(kingdomFacts(kingdomId).marketIds, random);
    return card ? { ...strategy, startingBuild: [...strategy.startingBuild, card] } : strategy;
  },
  'build-remove': (_kingdomId, strategy, random) => {
    if (!strategy.startingBuild.length) return strategy;
    const startingBuild = [...strategy.startingBuild];
    startingBuild.splice(random.nextInt(startingBuild.length), 1);
    return { ...strategy, startingBuild };
  },
  'build-replace': (kingdomId, strategy, random) => {
    if (!strategy.startingBuild.length) return strategy;
    const card = pick(kingdomFacts(kingdomId).marketIds, random);
    if (!card) return strategy;
    const startingBuild = [...strategy.startingBuild];
    startingBuild[random.nextInt(startingBuild.length)] = card;
    return { ...strategy, startingBuild };
  },
  'slot-activate': (kingdomId, strategy, random) => {
    const index = strategy.buyPlan.findIndex((slot) => slot.kind === 'inactive');
    if (index < 0) return strategy;
    const slot = random.nextInt(4) === 0
      ? { kind: 'stop' as const, threshold: between(random, 0, MAXIMUM_STOP_THRESHOLD) }
      : randomBuy(kingdomId, random);
    return slot ? replaceSlot(strategy, index, slot) : strategy;
  },
  'slot-deactivate': (_kingdomId, strategy, random) => {
    const indices = strategy.buyPlan.flatMap((slot, index) => slot.kind !== 'inactive' ? [index] : []);
    const index = pick(indices, random);
    return index === undefined ? strategy : replaceSlot(strategy, index, inactiveSlot());
  },
  'slot-card': (kingdomId, strategy, random) => {
    const indices = strategy.buyPlan.flatMap((slot, index) => slot.kind === 'buy' ? [index] : []);
    const index = pick(indices, random); const cardId = pick(kingdomFacts(kingdomId).purchaseIds, random);
    if (index === undefined || !cardId) return strategy;
    return replaceSlot(strategy, index, { ...(strategy.buyPlan[index] as BuySlot), cardId });
  },
  'slot-count': (_kingdomId, strategy, random) => {
    const indices = strategy.buyPlan.flatMap((slot, index) => slot.kind === 'buy' ? [index] : []);
    const index = pick(indices, random); if (index === undefined) return strategy;
    const held = strategy.buyPlan[index] as BuySlot;
    const desiredCount = held.desiredCount === INFINITE_COUNT ? between(random, 1, 4)
      : random.nextInt(4) === 0 ? INFINITE_COUNT : between(random, 1, MAXIMUM_FINITE_COUNT);
    return replaceSlot(strategy, index, { ...held, desiredCount });
  },
  'slot-kind': (kingdomId, strategy, random) => {
    const indices = strategy.buyPlan.flatMap((slot, index) => slot.kind !== 'inactive' ? [index] : []);
    const index = pick(indices, random); if (index === undefined) return strategy;
    const held = strategy.buyPlan[index]!;
    const slot = held.kind === 'stop' ? randomBuy(kingdomId, random)
      : { kind: 'stop' as const, threshold: between(random, 0, MAXIMUM_STOP_THRESHOLD) };
    return slot ? replaceSlot(strategy, index, slot) : strategy;
  },
  'slot-stop-threshold': (_kingdomId, strategy, random) => {
    const indices = strategy.buyPlan.flatMap((slot, index) => slot.kind === 'stop' ? [index] : []);
    const index = pick(indices, random); if (index === undefined) return strategy;
    return replaceSlot(strategy, index, { kind: 'stop', threshold: between(random, 0, MAXIMUM_STOP_THRESHOLD) });
  },
  'slot-reorder': (_kingdomId, strategy, random) => {
    const active = strategy.buyPlan.findIndex((slot) => slot.kind === 'inactive');
    const activeCount = active < 0 ? BUY_PLAN_SLOTS : active;
    if (activeCount < 2) return strategy;
    const index = random.nextInt(activeCount - 1); const buyPlan = [...strategy.buyPlan];
    [buyPlan[index], buyPlan[index + 1]] = [buyPlan[index + 1]!, buyPlan[index]!];
    return { ...strategy, buyPlan };
  }
};

export const MUTATION_NAMES: readonly MutationName[] = Object.freeze(Object.keys(OPERATORS) as MutationName[]);

export function applyMutation(name: MutationName, kingdomId: string, strategy: Strategy, random: SeededRandom): Strategy {
  return repairStrategy(kingdomId, OPERATORS[name](kingdomId, strategy, random));
}

export function mutationRandom(runSeed: number, attempt: number, index: number, salt = 0): SeededRandom {
  let mixed = runSeed >>> 0;
  for (const term of [attempt, index, salt])
    mixed = (Math.imul(mixed ^ (term + 0x9e3779b9), 0x85ebca6b) >>> 0) ^ (mixed >>> 13);
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
  kingdomId: string, strategy: Strategy, taken: ReadonlySet<string>, runSeed: number,
  attempt: number, index: number, attempts = MUTATION_ATTEMPTS
): Strategy | null {
  for (let salt = 0; salt < attempts; salt += 1) {
    const mutated = mutate(kingdomId, strategy, mutationRandom(runSeed, attempt, index, salt));
    if (!taken.has(canonicalStrategy(mutated))) return mutated;
  }
  return null;
}

export const NEIGHBOUR_COUNTS: readonly number[] = Object.freeze([
  ...Array.from({ length: MAXIMUM_FINITE_COUNT }, (_unused, index) => index + 1), INFINITE_COUNT
]);
export const STOP_THRESHOLDS: readonly number[] = Object.freeze(
  Array.from({ length: MAXIMUM_STOP_THRESHOLD + 1 }, (_unused, threshold) => threshold));

/** Returns the complete one-build-change or one-slot-change neighbourhood. */
export function neighbourhood(kingdomId: string, parent: Strategy): Strategy[] {
  const { marketIds, purchaseIds } = kingdomFacts(kingdomId);
  const proposals: Strategy[] = [];
  const propose = (startingBuild: readonly string[], buyPlan: readonly BuyPlanSlot[]): void => {
    proposals.push(repairStrategy(kingdomId, { id: '', startingBuild: [...startingBuild], buyPlan: fixedBuyPlan(buyPlan) }));
  };
  const build = parent.startingBuild; const plan = parent.buyPlan;
  for (const cardId of marketIds) propose([...build, cardId], plan);
  for (let index = 0; index < build.length; index += 1) {
    propose([...build.slice(0, index), ...build.slice(index + 1)], plan);
    for (const cardId of marketIds) if (cardId !== build[index])
      propose(build.map((held, position) => position === index ? cardId : held), plan);
  }
  const firstInactive = plan.findIndex((slot) => slot.kind === 'inactive');
  const activeCount = firstInactive < 0 ? BUY_PLAN_SLOTS : firstInactive;
  for (let index = 0; index < activeCount; index += 1) {
    const held = plan[index]!;
    propose(build, plan.map((slot, position) => position === index ? inactiveSlot() : slot));
    for (const cardId of purchaseIds) for (const desiredCount of NEIGHBOUR_COUNTS)
      if (held.kind !== 'buy' || held.cardId !== cardId || held.desiredCount !== desiredCount)
        propose(build, plan.map((slot, position) => position === index
          ? { kind: 'buy' as const, cardId, desiredCount } : slot));
    for (const threshold of STOP_THRESHOLDS)
      if (held.kind !== 'stop' || held.threshold !== threshold)
        propose(build, plan.map((slot, position) => position === index
          ? { kind: 'stop' as const, threshold } : slot));
    if (index + 1 < activeCount) {
      const swapped = [...plan];
      [swapped[index], swapped[index + 1]] = [swapped[index + 1]!, swapped[index]!];
      propose(build, swapped);
    }
  }
  if (activeCount < BUY_PLAN_SLOTS) {
    for (const cardId of purchaseIds) for (const desiredCount of NEIGHBOUR_COUNTS)
      propose(build, plan.map((slot, index) => index === activeCount
        ? { kind: 'buy' as const, cardId, desiredCount } : slot));
    for (const threshold of STOP_THRESHOLDS)
      propose(build, plan.map((slot, index) => index === activeCount
        ? { kind: 'stop' as const, threshold } : slot));
  }
  const seen = new Set<string>([canonicalStrategy(parent)]);
  return proposals.filter((proposal) => {
    const form = canonicalStrategy(proposal);
    if (seen.has(form)) return false;
    seen.add(form); return true;
  });
}
