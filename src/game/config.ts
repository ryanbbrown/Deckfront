import rawCards from '../game-data/cards.json' with { type: 'json' };
import rawMarket from '../game-data/first-market.json' with { type: 'json' };
import { cardLibrarySchema, marketSchema } from './schema';
import type { CardDefinition } from './types';

const library = cardLibrarySchema.parse(rawCards);
export const FIRST_MARKET = marketSchema.parse(rawMarket);
export const CARDS: Readonly<Record<string, CardDefinition>> = Object.freeze(Object.fromEntries(library.cards.map((card) => [card.id, card])));
export const MARKET_CARD_IDS = Object.freeze(Object.keys(CARDS));
export const ACTION_CARD_IDS = Object.freeze(FIRST_MARKET.actionPiles.map((pile) => pile.cardId));
for (const pile of FIRST_MARKET.actionPiles) if (!CARDS[pile.cardId]) throw new Error(`Unknown market card: ${pile.cardId}`);
export function cardDefinition(id: string): CardDefinition {
  const card = CARDS[id];
  if (!card) throw new Error(`Unknown card definition: ${id}`);
  return card;
}
