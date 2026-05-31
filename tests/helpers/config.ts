import type { GameConfig } from '../../src/core/types';

export function testConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  const config: GameConfig = {
    players: 1,
    setup: {
      initialActions: 1,
      initialBuys: 1,
      initialMoney: 0,
      handSize: 5,
      startingDeck: ['copper', 'copper', 'copper', 'estate', 'estate'],
      attributes: {}
    },
    cards: [
      { id: 'copper', name: 'Copper', type: 'treasure', cost: 0, treasure: 1 },
      { id: 'estate', name: 'Estate', type: 'victory', cost: 2, victoryPoints: 1 },
      { id: 'province', name: 'Province', type: 'victory', cost: 8, victoryPoints: 6 },
      { id: 'village', name: 'Village', type: 'action', cost: 3, effects: [{ kind: 'grant', cards: 1, actions: 2 }] },
      { id: 'chapel', name: 'Chapel', type: 'action', cost: 2, effects: [{ kind: 'trash', count: 4, optional: true }] },
      { id: 'cellar', name: 'Cellar', type: 'action', cost: 2, effects: [{ kind: 'discard', count: 1, optional: true }] }
    ],
    supply: [
      { card: 'estate', count: 8 },
      { card: 'province', count: 8 },
      { card: 'village', count: 10 },
      { card: 'chapel', count: 10 },
      { card: 'cellar', count: 10 }
    ],
    endGame: { or: [{ gte: ['emptyPiles', 3] }, { eq: ['provincePileEmpty', true] }] }
  };
  return {
    ...config,
    ...overrides,
    setup: { ...config.setup, ...overrides.setup },
    cards: overrides.cards ?? config.cards,
    supply: overrides.supply ?? config.supply
  };
}
