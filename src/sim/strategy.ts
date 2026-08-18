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
