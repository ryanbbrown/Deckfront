import rawCards from '../game-data/cards.json' with { type: 'json' };
import rawMarket from '../game-data/first-market.json' with { type: 'json' };
import { cardLibrarySchema, marketSchema } from './schema';
import type { CardDefinition } from './types';

const parsedLibrary = cardLibrarySchema.parse(rawCards);
export const FIRST_MARKET = marketSchema.parse(rawMarket);

export const CARDS: Readonly<Record<string, CardDefinition>> = Object.freeze(
  Object.fromEntries(parsedLibrary.cards.map((card) => [card.id, card]))
);

for (const pile of [...FIRST_MARKET.basicPiles, ...FIRST_MARKET.kingdomPiles]) {
  if (!CARDS[pile.cardId]) throw new Error(`Market refers to unknown card: ${pile.cardId}`);
}

export const STARTING_DECK = [
  'copper', 'copper', 'copper', 'copper', 'copper',
  'shove', 'shove', 'dash', 'dash', 'brace'
] as const;

export function cardDefinition(id: string): CardDefinition {
  const definition = CARDS[id];
  if (!definition) throw new Error(`Unknown card definition: ${id}`);
  return definition;
}
