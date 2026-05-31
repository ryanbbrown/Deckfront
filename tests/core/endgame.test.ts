import { describe, expect, it } from 'vitest';
import { evaluateEndGame } from '../../src/core/endgame';
import { finalResults, scorePlayer } from '../../src/core/scoring';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import { testConfig } from '../helpers/config';

describe('endgame and scoring', () => {
  it('evaluates boolean expressions over public supply metrics', () => {
    const state = setupGame(testConfig(), new SeededRng(1));
    state.supply.estate = 0;
    state.supply.village = 0;
    state.supply.cellar = 0;

    expect(evaluateEndGame({ gte: ['emptyPiles', 3] }, state)).toBe(true);
  });

  it('evaluates eq, and, or expressions for the province pile metric', () => {
    const state = setupGame(testConfig(), new SeededRng(1));
    state.supply.province = 0;

    expect(evaluateEndGame({ eq: ['provincePileEmpty', true] }, state)).toBe(true);
    expect(evaluateEndGame({ and: [{ eq: ['provincePileEmpty', true] }, { gte: ['emptyPiles', 1] }] }, state)).toBe(true);
    expect(evaluateEndGame({ or: [{ gte: ['emptyPiles', 3] }, { eq: ['provincePileEmpty', true] }] }, state)).toBe(true);
  });

  it('breaks score ties by fewer turns taken', () => {
    const state = setupGame(
      testConfig({
        players: 2,
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 1,
          startingDeck: ['estate'],
          attributes: {}
        }
      }),
      new SeededRng(1)
    );
    state.players[0]!.turnsTaken = 3;
    state.players[1]!.turnsTaken = 2;

    expect(finalResults(state).winners.map((winner) => winner.playerId)).toEqual(['P2']);
  });

  it('adds VP counters to owned-card victory points', () => {
    const state = setupGame(testConfig(), new SeededRng(1));
    state.players[0]!.hand = ['estate'];
    state.players[0]!.draw = [];
    state.players[0]!.discard = ['province'];
    state.players[0]!.vpCounters = 2;

    expect(scorePlayer(state.players[0]!, state.cards)).toBe(9);
  });
});
