import { describe, expect, it } from 'vitest';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import { testConfig } from '../helpers/config';

describe('effects', () => {
  it('applies grant effects from an action card', () => {
    const state = setupGame(
      testConfig({
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 2,
          startingDeck: ['village', 'copper', 'estate'],
          attributes: {}
        }
      }),
      new SeededRng(1)
    );
    state.players[0]!.hand = ['village', 'copper'];
    state.players[0]!.draw = ['estate'];

    const next = applyAction(state, { type: 'playAction', handIndex: 0 }, new SeededRng(1));

    expect(next.players[0]?.actions).toBe(2);
    expect(next.players[0]?.hand.length).toBe(2);
    expect(next.players[0]?.play).toEqual(['village']);
  });

  it('prompts for optional trash choices and can skip without changing hand', () => {
    const state = setupGame(
      testConfig({
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 3,
          startingDeck: ['chapel', 'copper', 'estate'],
          attributes: {}
        }
      }),
      new SeededRng(1)
    );
    state.players[0]!.hand = ['chapel', 'copper', 'estate'];
    const pending = applyAction(state, { type: 'playAction', handIndex: 0 }, new SeededRng(1));

    expect(listLegalActions(pending).map((action) => action.description)).toEqual([
      'Trash Copper',
      'Trash Estate',
      'Skip remaining effect'
    ]);

    const skipped = applyAction(pending, { type: 'resolvePending', choice: 'skip' }, new SeededRng(1));
    expect(skipped.pending).toBeUndefined();
    expect(skipped.players[0]?.hand).toEqual(['copper', 'estate']);
    expect(skipped.trash).toEqual([]);
  });

  it('moves selected cards for discard and resumes later effects', () => {
    const state = setupGame(
      testConfig({
        cards: [
          { id: 'copper', name: 'Copper', type: 'treasure', cost: 0, treasure: 1 },
          { id: 'estate', name: 'Estate', type: 'victory', cost: 2, victoryPoints: 1 },
          {
            id: 'cellar',
            name: 'Cellar',
            type: 'action',
            cost: 2,
            effects: [
              { kind: 'discard', count: 1 },
              { kind: 'grant', cards: 1 }
            ]
          }
        ],
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 3,
          startingDeck: ['cellar', 'copper', 'estate'],
          attributes: {}
        },
        supply: [{ card: 'estate', count: 8 }]
      }),
      new SeededRng(1)
    );
    state.players[0]!.hand = ['cellar', 'copper'];
    state.players[0]!.draw = ['estate'];

    const pending = applyAction(state, { type: 'playAction', handIndex: 0 }, new SeededRng(1));
    const resolved = applyAction(pending, { type: 'resolvePending', choice: 'select', handIndex: 0 }, new SeededRng(1));

    expect(resolved.pending).toBeUndefined();
    expect(resolved.players[0]?.discard).toEqual(['copper']);
    expect(resolved.players[0]?.hand).toEqual(['estate']);
  });

  it('resolves lookahead destinations and can reorder cards onto the draw pile', () => {
    const state = setupGame(
      testConfig({
        cards: [
          { id: 'copper', name: 'Copper', type: 'treasure', cost: 0, treasure: 1 },
          { id: 'estate', name: 'Estate', type: 'victory', cost: 2, victoryPoints: 1 },
          {
            id: 'scout',
            name: 'Scout',
            type: 'action',
            cost: 3,
            effects: [{ kind: 'lookahead', count: 2, choices: ['top', 'discard'] }]
          }
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
    state.players[0]!.draw = ['copper', 'estate'];

    const pending = applyAction(state, { type: 'playAction', handIndex: 0 }, new SeededRng(1));
    const topCopper = applyAction(pending, { type: 'resolvePending', choice: 'lookahead', exposedIndex: 0, destination: 'top' }, new SeededRng(1));
    const topEstate = applyAction(topCopper, { type: 'resolvePending', choice: 'lookahead', exposedIndex: 0, destination: 'top' }, new SeededRng(1));

    expect(topEstate.pending).toBeUndefined();
    expect(topEstate.players[0]?.draw).toEqual(['estate', 'copper']);
  });

  it('tracks VP counters and persistent custom attributes', () => {
    const state = setupGame(
      testConfig({
        cards: [
          { id: 'estate', name: 'Estate', type: 'victory', cost: 2, victoryPoints: 1 },
          {
            id: 'monument',
            name: 'Monument',
            type: 'action',
            cost: 4,
            effects: [
              { kind: 'vp', points: 1 },
              { kind: 'grant', attributes: { tokens: 2 } }
            ]
          }
        ],
        setup: {
          initialActions: 1,
          initialBuys: 1,
          initialMoney: 0,
          handSize: 1,
          startingDeck: ['monument'],
          attributes: { tokens: 0 }
        },
        supply: [{ card: 'estate', count: 8 }]
      }),
      new SeededRng(1)
    );
    state.players[0]!.hand = ['monument'];

    const afterPlay = applyAction(state, { type: 'playAction', handIndex: 0 }, new SeededRng(1));
    const afterCleanup = applyAction(applyAction(afterPlay, { type: 'moveToBuy' }, new SeededRng(1)), { type: 'endTurn' }, new SeededRng(1));

    expect(afterCleanup.players[0]?.vpCounters).toBe(1);
    expect(afterCleanup.players[0]?.attributes.tokens).toBe(2);
  });
});
