import { describe, expect, it } from 'vitest';
import { applyAction } from '../../src/core/engine';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import { testConfig } from '../helpers/config';

describe('engine', () => {
  it('creates deterministic setup for the same seed', () => {
    const first = setupGame(testConfig(), new SeededRng(12));
    const second = setupGame(testConfig(), new SeededRng(12));

    expect(first.players[0]?.hand).toEqual(second.players[0]?.hand);
    expect(first.players[0]?.draw).toEqual(second.players[0]?.draw);
  });

  it('moves to buy phase and automatically contributes treasure', () => {
    const state = setupGame(
      testConfig({
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 5,
          startingDeck: ['copper', 'copper', 'copper', 'estate', 'estate'],
          attributes: {}
        }
      }),
      new SeededRng(1)
    );

    const next = applyAction(state, { type: 'moveToBuy' }, new SeededRng(2));

    expect(next.phase).toBe('buy');
    expect(next.players[0]?.money).toBe(3);
    expect(next.players[0]?.play).toEqual(['copper', 'copper', 'copper']);
  });
});
