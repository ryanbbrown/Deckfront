import { describe, expect, it } from 'vitest';
import { applyAction } from '../../src/core/engine';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import { testConfig } from '../helpers/config';

describe('multi-player integration', () => {
  it('advances active player after cleanup', () => {
    const state = setupGame(
      testConfig({
        players: 2,
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 1,
          startingDeck: ['copper'],
          attributes: {}
        }
      }),
      new SeededRng(1)
    );

    const buyPhase = applyAction(state, { type: 'moveToBuy' }, new SeededRng(2));
    const nextTurn = applyAction(buyPhase, { type: 'endTurn' }, new SeededRng(2));

    expect(nextTurn.activePlayer).toBe(1);
    expect(nextTurn.players[0]?.turnsTaken).toBe(1);
    expect(nextTurn.players[1]?.turnsTaken).toBe(0);
  });
});
