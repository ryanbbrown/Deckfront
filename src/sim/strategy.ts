import type { RangeBand } from '../game';

export interface BuyAgendaEntry { cardId: string; desiredCount: number }  // desiredCount: non-negative integer

export interface StateWeights {
  damage: number;                   // opponent health lost this turn
  preferredRange: number;           // the range band matches preferredRange when the turn ends
  cardsDrawn: number;               // cards drawn this turn, counted from draw events
  moneyGained: number;              // money the Action phase leaves for the Buy phase
  trashed: number;                  // per card removed, using trashPriority rank
  reclaimed: number;                // a card put back on the deck, using reclaimPriority rank
  discarded: number;                // per card discarded, using discardPriority rank
  unspentMana: number;              // negative in a sensible strategy
  opponentOutOfAttackRange: number; // the final band matches no attack the owned deck holds
}

export interface Strategy {
  id: string;
  startingBuild: string[];              // definition ids, resolved cost at most 12
  buyAgenda: BuyAgendaEntry[];          // ordered
  treasureFallback: string[];           // for example ['gold', 'silver']
  preferredRange: RangeBand;
  weights: StateWeights;
  trashPriority: string[];              // Cull targets, best first
  reclaimPriority: string[];            // Reclaim targets, best first
  discardPriority: string[];            // Prism discards, best first
}

/**
 * Every priority list is best-first, so index 0 must earn the largest contribution. Scoring the raw
 * index would pay more for the least-wanted card and quietly invert the strategy.
 */
export function priorityRank(list: readonly string[], cardId: string | null): number {
  if (cardId === null) return 0;
  const index = list.indexOf(cardId);
  return index < 0 ? 0 : list.length - index;
}

/**
 * Every behavioural field, with object keys in a fixed order and `id` excluded. Array order is kept
 * wherever it is behaviour: the buy agenda is tried in order, and each priority list is best-first.
 */
export function canonicalStrategy(strategy: Strategy): string {
  const weightKeys = Object.keys(strategy.weights).sort() as (keyof StateWeights)[];
  return JSON.stringify({
    buyAgenda: strategy.buyAgenda.map((entry) => [entry.cardId, entry.desiredCount]),
    discardPriority: strategy.discardPriority,
    preferredRange: strategy.preferredRange,
    reclaimPriority: strategy.reclaimPriority,
    startingBuild: strategy.startingBuild,
    trashPriority: strategy.trashPriority,
    treasureFallback: strategy.treasureFallback,
    weights: weightKeys.map((key) => [key, strategy.weights[key]])
  });
}

/** FNV-1a, 32 bit. Stable across processes and runs, which `Object` hashing and iteration order are not. */
export function stableHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}${(text.length >>> 0).toString(16)}`;
}

export const STRATEGY_ID_PREFIX = 'sg-';

/**
 * Gives a strategy the id its behaviour earns. Exact duplicates then collapse on their own, a mutant
 * can never inherit its parent's id and overwrite it in a score map, and a leader retained unchanged
 * across generations enters the round robin once instead of several times under different ids.
 */
export function identify(strategy: Strategy): Strategy {
  return { ...strategy, id: `${STRATEGY_ID_PREFIX}${stableHash(canonicalStrategy(strategy))}` };
}

/**
 * Records an id against the behaviour it stands for and throws if the same id ever stands for two.
 *
 * The id is a 32-bit hash, so a collision between two live strategies is unlikely but possible. Every
 * map keyed by id — the generation tallies, the tournament's pairwise rows — would then merge two
 * strategies' scores and telemetry and skip their pairing as a self-pair, with no sign in the output.
 * Failing is the only safe answer; widening the hash would cost the short readable id and still leave
 * the failure silent.
 */
export function registerIdentity(known: Map<string, string>, strategy: Strategy): void {
  const form = canonicalStrategy(strategy);
  const seen = known.get(strategy.id);
  if (seen === undefined) { known.set(strategy.id, form); return; }
  if (seen !== form) throw new Error(`Two different strategies share the id ${strategy.id}: ${seen} and ${form}.`);
}

export function formatStrategy(strategy: Strategy): string {
  const agenda = strategy.buyAgenda.map((entry) => `${entry.cardId} x${entry.desiredCount}`).join(' -> ') || 'none';
  const weights = (Object.entries(strategy.weights) as [keyof StateWeights, number][])
    .map(([name, weight]) => `${name} ${weight}`).join(', ');
  return [
    strategy.id,
    `  build: ${strategy.startingBuild.join(', ') || 'none'}`,
    `  agenda: ${agenda}`,
    `  treasure: ${strategy.treasureFallback.join(' -> ') || 'none'}`,
    `  range: ${strategy.preferredRange}`,
    `  weights: ${weights}`,
    `  trash: ${strategy.trashPriority.join(' -> ') || 'none'}`,
    `  reclaim: ${strategy.reclaimPriority.join(' -> ') || 'none'}`,
    `  discard: ${strategy.discardPriority.join(' -> ') || 'none'}`
  ].join('\n');
}
