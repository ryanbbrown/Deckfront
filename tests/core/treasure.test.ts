import { describe, expect, it } from 'vitest';
import { autoPlayTreasures } from '../../src/core/treasure';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import { testConfig } from '../helpers/config';

describe('autoPlayTreasures', () => {
  it('moves only treasures to play and preserves non-treasure hand order', () => {
    const state = setupGame(
      testConfig({
        cards: [
          { id: 'copper', name: 'Copper', type: 'treasure', cost: 0, treasure: 1 },
          { id: 'dud', name: 'Dud', type: 'treasure', cost: 0 },
          { id: 'estate', name: 'Estate', type: 'victory', cost: 2, victoryPoints: 1 }
        ],
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 3,
          startingDeck: ['copper', 'estate', 'dud'],
          attributes: {}
        },
        supply: [{ card: 'estate', count: 8 }]
      }),
      new SeededRng(1)
    );
    const player = state.players[0]!;
    player.hand = ['copper', 'estate', 'dud'];

    autoPlayTreasures(state, player);

    expect(player.money).toBe(1);
    expect(player.play).toEqual(['copper', 'dud']);
    expect(player.hand).toEqual(['estate']);
  });

  it('no-ops for empty hands and hands without treasures', () => {
    const state = setupGame(testConfig(), new SeededRng(1));
    const player = state.players[0]!;
    player.hand = ['estate'];

    autoPlayTreasures(state, player);
    expect(player.hand).toEqual(['estate']);

    player.hand = [];
    autoPlayTreasures(state, player);
    expect(player.hand).toEqual([]);
  });
});
