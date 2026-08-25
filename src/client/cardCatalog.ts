import type { CardDefinition, CardFamily } from '../game';

export const CARD_FAMILY_ORDER = ['treasure', 'engine', 'melee', 'ranged', 'mana'] as const satisfies readonly CardFamily[];

export interface CardCatalogGroup {
  family: CardFamily;
  heading: string;
  cards: CardDefinition[];
}

export function groupCardCatalog(cards: Iterable<CardDefinition>): CardCatalogGroup[] {
  const byFamily = new Map<CardFamily, CardDefinition[]>(CARD_FAMILY_ORDER.map((family) => [family, []]));
  for (const card of cards) byFamily.get(card.family)!.push(card);
  return CARD_FAMILY_ORDER.map((family) => ({
    family,
    heading: family[0]!.toUpperCase() + family.slice(1),
    cards: byFamily.get(family)!.sort((left, right) => left.cost - right.cost || left.name.localeCompare(right.name))
  }));
}
