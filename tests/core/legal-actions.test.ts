import { describe, expect, it } from 'vitest';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import { testConfig } from '../helpers/config';

describe('legal actions', () => {
  it('orders action plays by hand index and keeps the phase transition last', () => {
    const state = setupGame(
      testConfig({
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 3,
          startingDeck: ['village', 'cellar', 'copper'],
          attributes: {}
        }
      }),
      new SeededRng(1)
    );
    state.players[0]!.hand = ['village', 'cellar', 'copper'];

    expect(listLegalActions(state).map((action) => action.description)).toEqual([
      'Play Village',
      'Play Cellar',
      'Move to buy phase'
    ]);
  });

  it('excludes action cards when no actions remain', () => {
    const state = setupGame(
      testConfig({
        setup: {
          initialActions: 0,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 1,
          startingDeck: ['village'],
          attributes: {}
        }
      }),
      new SeededRng(1)
    );

    expect(listLegalActions(state).map((action) => action.description)).toEqual(['Move to buy phase']);
  });
});
