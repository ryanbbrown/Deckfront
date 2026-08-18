import rawCards from '../game-data/cards.json' with { type: 'json' };
import { cardLibrarySchema } from './schema';
import type { CardDefinition } from './types';

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
