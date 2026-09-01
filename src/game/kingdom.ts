import rawKingdoms from '../game-data/kingdoms.json' with { type: 'json' };
import { CARDS, cardDefinition } from './config';
import { kingdomLibrarySchema, kingdomSchema } from './schema';
import type { CardDefinition, GameState, Kingdom } from './types';
import { VALUE_KEYS } from './values';

export const DEFAULT_KINGDOM_ID = 'distance-duel';
export const ALWAYS_AVAILABLE_ACTION_IDS: readonly string[] = Object.freeze(['step', 'focus', 'scrap']);
export const ALWAYS_AVAILABLE_COUNT = 10;
export const MAX_PILE_COUNT = 10;
export const RANDOM_KINGDOM_SIZE = 10;
export const TREASURE_IDS: readonly string[] = Object.freeze(Object.values(CARDS).filter((card) => card.type === 'treasure').map((card) => card.id));
export const VARIABLE_ACTION_IDS: readonly string[] = Object.freeze(Object.values(CARDS)
  .filter((card) => card.type === 'action' && card.id !== 'scrap' && !ALWAYS_AVAILABLE_ACTION_IDS.includes(card.id)).map((card) => card.id));

export interface RandomIndexSource { nextInt(maxExclusive: number): number }
export function randomVariableCardIds(
  random: RandomIndexSource, eligible: readonly string[] = VARIABLE_ACTION_IDS
): string[] {
  const available = [...eligible];
  if (available.length < RANDOM_KINGDOM_SIZE || new Set(available).size !== available.length
    || available.some((cardId) => !VARIABLE_ACTION_IDS.includes(cardId))) {
    throw new Error(`Random market candidates need at least ${RANDOM_KINGDOM_SIZE} unique variable action cards.`);
  }
  const selected: string[] = [];
  while (selected.length < RANDOM_KINGDOM_SIZE) {
    const index = random.nextInt(available.length);
    selected.push(available.splice(index, 1)[0]!);
  }
  return selected;
}

const BUILT_IN = kingdomLibrarySchema.parse(rawKingdoms).kingdoms;
const registry = new Map<string, Kingdom>();
const resolved = new Map<string, Map<string, CardDefinition>>();
let epoch = 0;

/**
 * Counts how many times the registry was cleared. Anything caching per kingdom id outside this module
 * compares it and drops its own cache, because an id can be re-registered with different piles and
 * costs. The counter keeps that possible without this module knowing its callers.
 */
export function kingdomEpoch(): number { return epoch; }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const entry of Object.values(value)) deepFreeze(entry); Object.freeze(value); }
  return value;
}
function canonical(kingdom: Kingdom): string {
  return JSON.stringify({
    id: kingdom.id, name: kingdom.name, startingHealth: kingdom.startingHealth,
    actionPiles: [...kingdom.actionPiles].sort((left, right) => left.cardId.localeCompare(right.cardId)).map((pile) => [pile.cardId, pile.count]),
    overrides: Object.entries(kingdom.overrides ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([id, override]) => [
      id, override.cost ?? null, override.money ?? null,
      Object.entries(override.values ?? {}).sort(([left], [right]) => left.localeCompare(right))
    ])
  });
}
function validate(kingdom: Kingdom): void {
  const piles = new Set<string>();
  for (const pile of kingdom.actionPiles) {
    const definition = cardDefinition(pile.cardId);
    if (piles.has(pile.cardId)) throw new Error(`Duplicate market pile: ${pile.cardId}`);
    piles.add(pile.cardId);
    if (definition.type !== 'action') throw new Error(`Market piles hold Action cards only: ${pile.cardId}`);
    if (ALWAYS_AVAILABLE_ACTION_IDS.includes(pile.cardId)) {
      throw new Error(`${definition.name} is available in every kingdom and needs no pile.`);
    }
    if (pile.count > MAX_PILE_COUNT) throw new Error(`${pile.cardId} may hold at most ${MAX_PILE_COUNT} cards.`);
  }
  for (const [definitionId, override] of Object.entries(kingdom.overrides ?? {})) {
    const definition = cardDefinition(definitionId);
    const declared = VALUE_KEYS[definition.mechanic] ?? [];
    for (const [key, amount] of [['cost', override.cost], ['money', override.money], ...Object.entries(override.values ?? {})] as [string, number | undefined][]) {
      if (amount !== undefined && !Number.isFinite(amount)) throw new Error(`${definitionId} has a non-finite ${key} override.`);
    }
    for (const key of Object.keys(override.values ?? {})) {
      if (!declared.includes(key)) throw new Error(`${definitionId} has no ${key} value to override.`);
    }
  }
}
export function registerKingdom(kingdom: Kingdom): void {
  const parsed = kingdomSchema.parse(kingdom) as Kingdom;
  validate(parsed);
  const existing = registry.get(parsed.id);
  if (existing) {
    if (canonical(existing) !== canonical(parsed)) throw new Error(`Kingdom is already registered with different content: ${parsed.id}`);
    return;
  }
  registry.set(parsed.id, deepFreeze(parsed));
}
export function resetKingdoms(): void {
  registry.clear(); resolved.clear(); epoch += 1;
  for (const kingdom of BUILT_IN) registerKingdom(structuredClone(kingdom) as Kingdom);
}
export function findKingdom(id: string): Kingdom | null { return registry.get(id) ?? null; }
export function kingdomOf(id: string): Kingdom {
  const kingdom = registry.get(id);
  if (!kingdom) throw new Error(`Unknown kingdom: ${id}`);
  return kingdom;
}
function resolveIn(kingdomId: string, definitionId: string): CardDefinition {
  let kingdomResolved = resolved.get(kingdomId);
  if (!kingdomResolved) {
    kingdomResolved = new Map();
    resolved.set(kingdomId, kingdomResolved);
  }
  const cached = kingdomResolved.get(definitionId);
  if (cached) return cached;
  const base = cardDefinition(definitionId);
  const override = kingdomOf(kingdomId).overrides?.[definitionId];
  let definition = base;
  if (override) {
    const merged: CardDefinition = { ...base };
    if (override.cost !== undefined) merged.cost = override.cost;
    if (override.money !== undefined) merged.money = override.money;
    if (override.values) merged.values = { ...(base.values ?? {}), ...override.values };
    definition = deepFreeze(merged);
  }
  kingdomResolved.set(definitionId, definition);
  return definition;
}
export function resolveCardInKingdom(kingdomId: string, definitionId: string): CardDefinition {
  return resolveIn(kingdomId, definitionId);
}
export function resolveCard(state: GameState, definitionId: string): CardDefinition {
  return resolveCardInKingdom(state.kingdomId, definitionId);
}
export function kingdomMarket(kingdomId: string): CardDefinition[] {
  const kingdom = kingdomOf(kingdomId);
  return [...TREASURE_IDS, ...kingdom.actionPiles.map((pile) => pile.cardId), ...ALWAYS_AVAILABLE_ACTION_IDS]
    .map((id) => resolveCardInKingdom(kingdomId, id));
}
export function randomKingdom(id: string, variableCardIds: readonly string[]): Kingdom {
  if (variableCardIds.length !== RANDOM_KINGDOM_SIZE || new Set(variableCardIds).size !== RANDOM_KINGDOM_SIZE
    || variableCardIds.some((cardId) => !VARIABLE_ACTION_IDS.includes(cardId))) {
    throw new Error(`A random kingdom needs ${RANDOM_KINGDOM_SIZE} unique variable action cards.`);
  }
  return {
    id, name: 'Random Kingdom', startingHealth: 50,
    actionPiles: variableCardIds.map((cardId) => ({ cardId, count: MAX_PILE_COUNT }))
  };
}
export function kingdomSupply(kingdom: Kingdom): Record<string, number> {
  return Object.fromEntries([...kingdom.actionPiles.map((pile) => [pile.cardId, pile.count] as const),
    ...ALWAYS_AVAILABLE_ACTION_IDS.map((id) => [id, ALWAYS_AVAILABLE_COUNT] as const)]);
}
resetKingdoms();
