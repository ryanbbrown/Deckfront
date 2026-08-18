import { EFFECTS, SeededRandom, createGame, kingdomEpoch, kingdomMarket, rangeBand } from '../game';
import type { CardDefinition, RangeBand } from '../game';
import { repairBuildIn } from './build';
import { ATTACK_MECHANICS } from './search';
import { canonicalStrategy, identify } from './strategy';
import type { BuyAgendaEntry, StateWeights, Strategy } from './strategy';

export const WEIGHT_LIMIT = 100;
export const MAX_DESIRED_COUNT = 10;
export const RANGE_BANDS: readonly RangeBand[] = ['Close', 'Near', 'Far'];

const WEIGHT_KEYS = [
  'damage', 'preferredRange', 'cardsDrawn', 'moneyGained', 'trashed',
  'reclaimed', 'discarded', 'unspentMana', 'opponentOutOfAttackRange'
] as const satisfies readonly (keyof StateWeights)[];

const PRIORITY_FIELDS = ['trashPriority', 'reclaimPriority', 'discardPriority'] as const;
type PriorityField = (typeof PRIORITY_FIELDS)[number];

/** Everything a mutation needs to stay inside one kingdom. Built once per kingdom, never per candidate. */
interface KingdomFacts {
  marketIds: readonly string[];
  treasureIds: readonly string[];
  attacksByBand: Readonly<Record<RangeBand, readonly string[]>>;
}
const facts = new Map<string, KingdomFacts>();
let factsEpoch = kingdomEpoch();

/**
 * Asks the engine which attacks a band allows rather than restating the gates here. A second copy of
 * the range rules would drift the first time a card's gate changes.
 */
function attacksInBand(market: readonly CardDefinition[], kingdomId: string, band: RangeBand): string[] {
  const state = createGame({ seed: 1, kingdomId });
  const [ochre, indigo] = band === 'Close' ? [3, 3] : band === 'Near' ? [2, 3] : [1, 3];
  state.fighters.ochre.position = ochre!;
  state.fighters.indigo.position = indigo!;
  state.players.ochre.mana = 99;
  if (rangeBand(state) !== band) throw new Error(`The probe state is not at ${band}.`);
  return market
    .filter((definition) => ATTACK_MECHANICS.has(definition.mechanic))
    .filter((definition) => {
      const code = EFFECTS[definition.mechanic].gate(state, 'ochre', definition.values ?? {});
      return code !== 'NEEDS_CLOSE' && code !== 'NEEDS_NEAR_OR_FAR';
    })
    .map((definition) => definition.id);
}

export function kingdomFacts(kingdomId: string): KingdomFacts {
  // Dropped whenever the registry is cleared: an id can come back with different piles, and a stale
  // market or stale `attacksByBand` would mutate strategies toward cards the kingdom no longer sells.
  if (factsEpoch !== kingdomEpoch()) { facts.clear(); factsEpoch = kingdomEpoch(); }
  const cached = facts.get(kingdomId);
  if (cached) return cached;
  const market = kingdomMarket(kingdomId);
  const built: KingdomFacts = {
    marketIds: market.map((definition) => definition.id),
    treasureIds: market.filter((definition) => definition.type === 'treasure').map((definition) => definition.id),
    attacksByBand: {
      Close: attacksInBand(market, kingdomId, 'Close'),
      Near: attacksInBand(market, kingdomId, 'Near'),
      Far: attacksInBand(market, kingdomId, 'Far')
    }
  };
  facts.set(kingdomId, built);
  return built;
}

// A NaN weight is the dangerous one: it makes the score comparator non-transitive, which corrupts
// the action search and the ranking at once with no error. Infinity clamps like any large number.
function clampWeight(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, Math.round(value)));
}
function keepKnown(ids: readonly string[], allowed: ReadonlySet<string>): string[] {
  const kept: string[] = [];
  for (const id of ids) if (allowed.has(id) && !kept.includes(id)) kept.push(id);
  return kept;
}

/**
 * The bounds every strategy in the population satisfies, applied after every mutation and to every
 * seed. Cards come from `kingdomMarket` only: an agenda entry the kingdom does not sell is skipped
 * silently at match time, and a build card it does not sell is dropped, so leaving either in place
 * spends population diversity on fields that never act.
 *
 * The build repair is `repairBuild`, the project's one rule. With two rules a mutated build would be
 * repaired one way here and another at match time, and the strategy written to the results would not
 * be the strategy that played.
 */
export function repairStrategy(kingdomId: string, strategy: Strategy): Strategy {
  const { marketIds, treasureIds } = kingdomFacts(kingdomId);
  const sold = new Set(marketIds);
  const treasures = new Set(treasureIds);

  const agenda: BuyAgendaEntry[] = [];
  for (const entry of strategy.buyAgenda) {
    if (!sold.has(entry.cardId) || agenda.some((kept) => kept.cardId === entry.cardId)) continue;
    const desiredCount = Math.max(0, Math.min(MAX_DESIRED_COUNT, Math.round(entry.desiredCount)));
    if (Number.isFinite(desiredCount)) agenda.push({ cardId: entry.cardId, desiredCount });
  }

  const weights = { ...strategy.weights };
  for (const key of WEIGHT_KEYS) weights[key] = clampWeight(weights[key]);

  return identify({
    ...strategy,
    startingBuild: repairBuildIn(kingdomId, strategy.startingBuild),
    buyAgenda: agenda,
    treasureFallback: keepKnown(strategy.treasureFallback, treasures),
    preferredRange: RANGE_BANDS.includes(strategy.preferredRange) ? strategy.preferredRange : 'Near',
    weights,
    trashPriority: keepKnown(strategy.trashPriority, sold),
    reclaimPriority: keepKnown(strategy.reclaimPriority, sold),
    discardPriority: keepKnown(strategy.discardPriority, sold)
  });
}

function pick<T>(items: readonly T[], random: SeededRandom): T | undefined {
  return items.length ? items[random.nextInt(items.length)] : undefined;
}
/** Inclusive on both ends. */
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
  | 'range' | 'weight' | 'weight-group' | 'priority' | 'treasure' | 'range-package';

type Operator = (kingdomId: string, strategy: Strategy, random: SeededRandom) => Strategy;

/**
 * Independent operators, so mixed decks and pivots stay reachable. None of them is restricted to one
 * card family, and `range-package` is the one that moves a related group together.
 */
const OPERATORS: Readonly<Record<MutationName, Operator>> = {
  'build-add': (kingdomId, strategy, random) => {
    const card = pick(kingdomFacts(kingdomId).marketIds, random);
    return card ? { ...strategy, startingBuild: insert(strategy.startingBuild, card, random) } : strategy;
  },
  'build-remove': (_kingdomId, strategy, random) => {
    if (!strategy.startingBuild.length) return strategy;
    return { ...strategy, startingBuild: without(strategy.startingBuild, random.nextInt(strategy.startingBuild.length)) };
  },
  'build-replace': (kingdomId, strategy, random) => {
    if (!strategy.startingBuild.length) return strategy;
    const card = pick(kingdomFacts(kingdomId).marketIds, random);
    if (!card) return strategy;
    const build = [...strategy.startingBuild];
    build[random.nextInt(build.length)] = card;
    return { ...strategy, startingBuild: build };
  },
  'agenda-add': (kingdomId, strategy, random) => {
    const card = pick(kingdomFacts(kingdomId).marketIds, random);
    if (!card) return strategy;
    return { ...strategy, buyAgenda: insert(strategy.buyAgenda, { cardId: card, desiredCount: between(random, 1, 4) }, random) };
  },
  'agenda-remove': (_kingdomId, strategy, random) => {
    if (!strategy.buyAgenda.length) return strategy;
    return { ...strategy, buyAgenda: without(strategy.buyAgenda, random.nextInt(strategy.buyAgenda.length)) };
  },
  'agenda-reorder': (_kingdomId, strategy, random) => ({ ...strategy, buyAgenda: swapped(strategy.buyAgenda, random) }),
  'agenda-count': (_kingdomId, strategy, random) => {
    if (!strategy.buyAgenda.length) return strategy;
    const index = random.nextInt(strategy.buyAgenda.length);
    const agenda = strategy.buyAgenda.map((entry) => ({ ...entry }));
    agenda[index]!.desiredCount += nonZero(random, 3);
    return { ...strategy, buyAgenda: agenda };
  },
  range: (_kingdomId, strategy, random) => {
    const others = RANGE_BANDS.filter((band) => band !== strategy.preferredRange);
    const band = pick(others, random);
    return band ? { ...strategy, preferredRange: band } : strategy;
  },
  weight: (_kingdomId, strategy, random) => {
    const key = WEIGHT_KEYS[random.nextInt(WEIGHT_KEYS.length)]!;
    return { ...strategy, weights: { ...strategy.weights, [key]: strategy.weights[key] + nonZero(random, 6) } };
  },
  'weight-group': (_kingdomId, strategy, random) => {
    const weights = { ...strategy.weights };
    for (let count = 0; count < 3; count += 1) {
      const key = WEIGHT_KEYS[random.nextInt(WEIGHT_KEYS.length)]!;
      weights[key] += nonZero(random, 4);
    }
    return { ...strategy, weights };
  },
  priority: (kingdomId, strategy, random) => {
    const field: PriorityField = PRIORITY_FIELDS[random.nextInt(PRIORITY_FIELDS.length)]!;
    const list = strategy[field];
    const choice = random.nextInt(3);
    if (choice === 0 || !list.length) {
      const card = pick(kingdomFacts(kingdomId).marketIds, random);
      return card ? { ...strategy, [field]: insert(list, card, random) } : strategy;
    }
    if (choice === 1) return { ...strategy, [field]: without(list, random.nextInt(list.length)) };
    return { ...strategy, [field]: swapped(list, random) };
  },
  treasure: (kingdomId, strategy, random) => {
    const { treasureIds } = kingdomFacts(kingdomId);
    if (random.nextInt(2) === 0) return { ...strategy, treasureFallback: swapped(strategy.treasureFallback, random) };
    const card = pick(treasureIds, random);
    if (!card) return strategy;
    return strategy.treasureFallback.includes(card)
      ? { ...strategy, treasureFallback: strategy.treasureFallback.filter((id) => id !== card) }
      : { ...strategy, treasureFallback: insert(strategy.treasureFallback, card, random) };
  },
  // The package mutation: a new band, the weight that rewards holding it, and the attacks the agenda
  // and the build buy, moved together. A band change on its own leaves a deck that cannot fire.
  'range-package': (kingdomId, strategy, random) => {
    const others = RANGE_BANDS.filter((band) => band !== strategy.preferredRange);
    const band = pick(others, random);
    if (!band) return strategy;
    const allowed = new Set(kingdomFacts(kingdomId).attacksByBand[band]);
    const everyAttack = new Set(RANGE_BANDS.flatMap((each) => kingdomFacts(kingdomId).attacksByBand[each]));
    const wrongBand = (cardId: string): boolean => everyAttack.has(cardId) && !allowed.has(cardId);

    const agenda = strategy.buyAgenda.filter((entry) => !wrongBand(entry.cardId));
    const build = strategy.startingBuild.filter((cardId) => !wrongBand(cardId));
    const added = pick([...allowed], random);
    return {
      ...strategy,
      preferredRange: band,
      weights: { ...strategy.weights, preferredRange: strategy.weights.preferredRange + between(random, 0, 4) },
      buyAgenda: added && !agenda.some((entry) => entry.cardId === added)
        ? [...agenda, { cardId: added, desiredCount: between(random, 1, 3) }]
        : agenda,
      startingBuild: added ? [...build, added] : build
    };
  }
};

export const MUTATION_NAMES: readonly MutationName[] = Object.freeze(Object.keys(OPERATORS) as MutationName[]);

/** One named operator, repaired. Lets a caller ask for a package mutation instead of drawing for it. */
export function applyMutation(
  name: MutationName, kingdomId: string, strategy: Strategy, random: SeededRandom
): Strategy {
  return repairStrategy(kingdomId, OPERATORS[name](kingdomId, strategy, random));
}

/** A distinct stream for every child, so a run replays exactly and two children never share draws. */
export function mutationRandom(runSeed: number, generation: number, index: number, salt = 0): SeededRandom {
  let mixed = runSeed >>> 0;
  for (const term of [generation, index, salt]) {
    mixed = (Math.imul(mixed ^ (term + 0x9e3779b9), 0x85ebca6b) >>> 0) ^ (mixed >>> 13);
  }
  return new SeededRandom(mixed >>> 0);
}

/**
 * Applies one to three operators and repairs the result. The repair is what makes every bound hold,
 * so an operator may produce an out-of-range value and does not have to check the kingdom itself.
 */
export function mutate(kingdomId: string, strategy: Strategy, random: SeededRandom): Strategy {
  let mutated = strategy;
  const count = between(random, 1, 3);
  for (let step = 0; step < count; step += 1) {
    const name = MUTATION_NAMES[random.nextInt(MUTATION_NAMES.length)]!;
    mutated = OPERATORS[name](kingdomId, mutated, random);
  }
  return repairStrategy(kingdomId, mutated);
}

/** Attempts per population slot, each with its own mutation stream. */
export const MUTATION_ATTEMPTS = 32;

/**
 * Mutates until the result differs from every form already taken, or returns `null` after
 * `MUTATION_ATTEMPTS` salted attempts. The caller must fill the slot or fail: a population that
 * silently runs short makes the match count, the scores, and every runtime estimate wrong.
 */
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
