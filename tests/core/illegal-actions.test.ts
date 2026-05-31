import { describe, expect, it } from 'vitest';
import { applyAction } from '../../src/core/engine';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import { testConfig } from '../helpers/config';

describe('engine legality enforcement', () => {
  it('rejects action-phase end turn outside the legal action list', () => {
    const state = setupGame(testConfig(), new SeededRng(1));

    expect(() => applyAction(state, { type: 'endTurn' }, new SeededRng(1))).toThrow('Illegal action');
  });

  it('rejects mandatory pending skips and invalid hand indexes', () => {
    const state = setupGame(
      testConfig({
        cards: [
          { id: 'copper', name: 'Copper', type: 'treasure', cost: 0, treasure: 1 },
          { id: 'estate', name: 'Estate', type: 'victory', cost: 2, victoryPoints: 1 },
          { id: 'cellar', name: 'Cellar', type: 'action', cost: 2, effects: [{ kind: 'discard', count: 1 }] }
        ],
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 2,
          startingDeck: ['cellar', 'copper'],
          attributes: {}
        },
        supply: [{ card: 'estate', count: 8 }]
      }),
      new SeededRng(1)
    );
    state.players[0]!.hand = ['cellar', 'copper'];

    const pending = applyAction(state, { type: 'playAction', handIndex: 0 }, new SeededRng(1));

    expect(() => applyAction(pending, { type: 'resolvePending', choice: 'skip' }, new SeededRng(1))).toThrow('Illegal action');
    expect(() => applyAction(pending, { type: 'resolvePending', choice: 'select', handIndex: 9 }, new SeededRng(1))).toThrow(
      'Illegal action'
    );
  });

  it('rejects lookahead destinations not offered by the pending effect', () => {
    const state = setupGame(
      testConfig({
        cards: [
          { id: 'copper', name: 'Copper', type: 'treasure', cost: 0, treasure: 1 },
          { id: 'estate', name: 'Estate', type: 'victory', cost: 2, victoryPoints: 1 },
          { id: 'scout', name: 'Scout', type: 'action', cost: 3, effects: [{ kind: 'lookahead', count: 1, choices: ['discard'] }] }
        ],
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 1,
          startingDeck: ['scout'],
          attributes: {}
        },
        supply: [{ card: 'estate', count: 8 }]
      }),
      new SeededRng(1)
    );
    state.players[0]!.hand = ['scout'];
    state.players[0]!.draw = ['copper'];

    const pending = applyAction(state, { type: 'playAction', handIndex: 0 }, new SeededRng(1));

    expect(() =>
      applyAction(pending, { type: 'resolvePending', choice: 'lookahead', exposedIndex: 0, destination: 'trash' }, new SeededRng(1))
    ).toThrow('Illegal action');
  });

  it('accepts valid action objects regardless of property insertion order', () => {
    const state = setupGame(
      testConfig({
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 2,
          handSize: 2,
          startingDeck: ['village', 'copper'],
          attributes: {}
        },
        supply: [{ card: 'estate', count: 8 }]
      }),
      new SeededRng(1)
    );
    state.players[0]!.hand = ['village', 'copper'];
    state.players[0]!.draw = ['estate'];

    const afterAction = applyAction(state, { handIndex: 0, type: 'playAction' } as never, new SeededRng(1));
    const buyPhase = applyAction(afterAction, { type: 'moveToBuy' }, new SeededRng(1));
    const afterBuy = applyAction(buyPhase, { cardId: 'estate', type: 'buyCard' } as never, new SeededRng(1));

    expect(afterBuy.players[0]?.discard).toContain('estate');
  });

  it('accepts valid pending choices regardless of property insertion order', () => {
    const state = setupGame(
      testConfig({
        cards: [
          { id: 'copper', name: 'Copper', type: 'treasure', cost: 0, treasure: 1 },
          { id: 'estate', name: 'Estate', type: 'victory', cost: 2, victoryPoints: 1 },
          { id: 'chapel', name: 'Chapel', type: 'action', cost: 2, effects: [{ kind: 'trash', count: 1, optional: true }] }
        ],
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 2,
          startingDeck: ['chapel', 'copper'],
          attributes: {}
        },
        supply: [{ card: 'estate', count: 8 }]
      }),
      new SeededRng(1)
    );
    state.players[0]!.hand = ['chapel', 'copper'];

    const pending = applyAction(state, { type: 'playAction', handIndex: 0 }, new SeededRng(1));
    const resolved = applyAction(pending, { choice: 'skip', type: 'resolvePending' } as never, new SeededRng(1));

    expect(resolved.pending).toBeUndefined();
  });
});
