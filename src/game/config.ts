import rawCards from '../game-data/cards.json' with { type: 'json' };
import { cardLibrarySchema } from './schema';
import type { CardDefinition } from './types';

export const STARTING_BUDGET = 12;
export const MAX_FIRST_BUY_CARRY = 3;
export const FIRST_PLAYER_HEALTH_PENALTY = 3;
export function firstBuyCarry(buildCost: number): number {
  return Math.max(0, Math.min(MAX_FIRST_BUY_CARRY, STARTING_BUDGET - buildCost));
}
export function playerStartingHealth(startingHealth: number, isFirstPlayer: boolean): number {
  return Math.max(1, startingHealth - (isFirstPlayer ? FIRST_PLAYER_HEALTH_PENALTY : 0));
}

const library = cardLibrarySchema.parse(rawCards);
// `resolveCard` hands these objects out directly when a kingdom has no override, so nested values must freeze too.
function freezeCard(card: CardDefinition): CardDefinition {
  if (card.values) Object.freeze(card.values);
  return Object.freeze(card);
}
export const CARDS: Readonly<Record<string, CardDefinition>> = Object.freeze(Object.fromEntries(library.cards.map((card) => [card.id, freezeCard(card)])));
export function cardDefinition(id: string): CardDefinition {
  const card = CARDS[id];
  if (!card) throw new Error(`Unknown card definition: ${id}`);
  return card;
}
