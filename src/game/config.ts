import rawCards from '../game-data/cards.json' with { type: 'json' };
import { cardLibrarySchema } from './schema';
import type { CardDefinition } from './types';

const library = cardLibrarySchema.parse(rawCards);
export const CARDS: Readonly<Record<string, CardDefinition>> = Object.freeze(Object.fromEntries(library.cards.map((card) => [card.id, Object.freeze(card)])));
export function cardDefinition(id: string): CardDefinition {
  const card = CARDS[id];
  if (!card) throw new Error(`Unknown card definition: ${id}`);
  return card;
}
