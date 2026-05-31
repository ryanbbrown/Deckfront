import { describe, expect, it } from 'vitest';
import { applyAction } from '../../src/core/engine';
import { finalResults } from '../../src/core/scoring';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import { testConfig } from '../helpers/config';

describe('endgame tie-break integration', () => {
  it('counts a decisive game-ending buy as the active player taking a turn', () => {
    const state = setupGame(
      testConfig({
        players: 2,
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 2,
          handSize: 1,
          startingDeck: ['copper'],
          attributes: {}
        },
        supply: [{ card: 'estate', count: 1 }],
        endGame: { gte: ['emptyPiles', 1] }
      }),
      new SeededRng(1)
    );
    state.players[1]!.discard = ['estate'];
    state.players[1]!.turnsTaken = 0;

    const buyPhase = applyAction(state, { type: 'moveToBuy' }, new SeededRng(1));
    const ended = applyAction(buyPhase, { type: 'buyCard', cardId: 'estate' }, new SeededRng(1));

    expect(ended.ended).toBe(true);
    expect(ended.players[0]?.turnsTaken).toBe(1);
    expect(finalResults(ended).winners.map((winner) => winner.playerId)).toEqual(['P2']);
  });
});
