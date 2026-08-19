import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, listLegalActions, resetKingdoms } from '../../src/game';
import type { GameState } from '../../src/game';
import { applyLegalAction } from '../../src/game/engine';
import { createMemo, memoKey, searchAction, searchBaseline } from '../../src/sim/search';
import { ActionSearchOverflowError } from '../../src/sim/types';
import { arena, choose, playPhase, strategy } from './fixtures';

afterEach(() => { resetKingdoms(); });

function definitionOf(state: GameState, cardInstanceId: string): string | undefined {
  return state.players.ochre.deck.hand.find((card) => card.id === cardInstanceId)?.definitionId;
}
function firstPlayedDefinition(state: GameState, plan = strategy()): string | undefined {
  const action = choose(state, plan);
  return 'cardInstanceId' in action.command ? definitionOf(state, action.command.cardInstanceId) : undefined;
}
function trashed(state: GameState): string[] { return state.trash.map((card) => card.definitionId).sort(); }

describe('shared damage pilot', () => {
  it('takes a lethal line and moves to unlock it', () => {
    const state = arena({ kingdomId: 'range-rich-mixed', hand: ['footwork', 'heavyBlow'], draw: ['copper'], ochre: 2, indigo: 3, health: 4 });
    const first = choose(state, strategy());
    expect(first.command).toMatchObject({ type: 'playFootwork', movement: 'right' });
    expect(playPhase(state, strategy()).fighters.indigo.health).toBe(0);
  });

  it('plays Aim before Volley when that deals more damage', () => {
    const state = arena({ hand: ['aim', 'volley'], draw: ['copper'], ochre: 2, indigo: 3, health: 20 });
    expect(firstPlayedDefinition(state)).toBe('aim');
    expect(playPhase(state, strategy()).fighters.indigo.health).toBe(15);
  });

  it('orders tactical actions before Flurry', () => {
    const state = arena({ hand: ['footwork', 'feint', 'flurry'], draw: ['copper', 'copper'], ochre: 3, indigo: 3, health: 20 });
    const finished = playPhase(state, strategy());
    expect(finished.fighters.indigo.health).toBe(16);
    expect(finished.actionsThisTurn.at(-1)).toBe('flurry');
  });
});

describe('hidden draw order', () => {
  it('does not change the next action when either hidden draw pile is permuted', () => {
    const forward = arena({ kingdomId: 'current-duel', hand: ['muster', 'footwork'], draw: ['volley', 'copper', 'aim'], ochre: 2, indigo: 3 });
    const backward = structuredClone(forward);
    backward.players.ochre.deck.draw.reverse();
    backward.players.indigo.deck.draw.reverse();
    const plan = strategy({ buyAgenda: [{ cardId: 'volley', desiredCount: 2 }], repeatPurchase: 'footwork' });
    expect(choose(backward, plan).command).toEqual(choose(forward, plan).command);
  });

  it('may use a card after it has actually entered the revealed hand', () => {
    const state = arena({ kingdomId: 'current-duel', hand: ['muster'], draw: ['volley', 'copper'], ochre: 2, indigo: 3 });
    const afterMuster = applyAction(state, choose(state, strategy()).id);
    expect(afterMuster.players.ochre.deck.hand.map((card) => card.definitionId)).toContain('volley');
    expect(firstPlayedDefinition(afterMuster)).toBe('volley');
  });
});

describe('Cull policy', () => {
  it('never trashes a non-Copper card', () => {
    const state = arena({ hand: ['cull', 'gold'], firstBuyPending: false });
    const finished = playPhase(state, strategy({ repeatPurchase: 'footwork' }));
    expect(trashed(finished)).toEqual(['cull']);
    expect(finished.players.ochre.deck.hand.map((card) => card.definitionId)).toContain('gold');
  });

  it('trashes one Copper when trashing two would lose an earlier planned purchase', () => {
    const state = arena({ hand: ['cull', 'copper', 'copper', 'copper', 'gold'], firstBuyPending: false });
    const plan = strategy({ buyAgenda: [{ cardId: 'volley', desiredCount: 1 }], repeatPurchase: 'footwork' });
    expect(trashed(playPhase(state, plan))).toEqual(['copper']);
  });

  it('trashes two Coppers when every choice buys the same card', () => {
    const state = arena({ hand: ['cull', 'copper', 'copper', 'gold'], firstBuyPending: false });
    expect(trashed(playPhase(state, strategy({ repeatPurchase: 'footwork' })))).toEqual(['copper', 'copper']);
  });

  it('does not lower repeatable money below the repeated purchase cost', () => {
    const state = arena({ hand: ['cull', 'copper', 'silver'], firstBuyPending: false });
    const finished = playPhase(state, strategy({ repeatPurchase: 'footwork' }));
    expect(trashed(finished)).toEqual(['cull']);
    expect(finished.players.ochre.deck.hand.map((card) => card.definitionId)).toContain('copper');
  });

  it('trashes Cull itself after all Copper is gone', () => {
    const state = arena({ hand: ['cull', 'gold'], firstBuyPending: false });
    expect(trashed(playPhase(state, strategy({ repeatPurchase: 'footwork' })))).toEqual(['cull']);
  });
});

describe('fixed choice policy', () => {
  it('Reclaim selects the highest-cost discarded card', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['reclaim'], draw: ['copper'], discard: ['silver', 'gold'] });
    expect(playPhase(state, strategy({ repeatPurchase: 'footwork' })).players.ochre.deck.draw[0]?.definitionId).toBe('gold');
  });

  it('uses the revealed state after Prism to preserve the maximum damage line', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['prism', 'fireball', 'copper'], draw: ['channel'], firstBuyPending: false });
    const finished = playPhase(state, strategy({ repeatPurchase: 'footwork' }));
    expect(finished.fighters.indigo.health).toBe(25);
    expect(finished.events.some((event) => event.type === 'discard')).toBe(true);
  });
});

describe('search mechanics', () => {
  it('is deterministic with and without memoization', () => {
    const state = arena({ kingdomId: 'current-duel', hand: ['footwork', 'aim', 'volley', 'muster'], draw: ['copper', 'copper'], ochre: 2, indigo: 3 });
    const plan = strategy({ repeatPurchase: 'footwork' });
    expect(choose(structuredClone(state), plan).command).toEqual(choose(state, plan).command);
    expect(choose(state, plan, { memo: null }).command).toEqual(choose(state, plan).command);
  });

  it('does not read labels while searching', () => {
    const state = arena({ hand: [] });
    const actions = listLegalActions(state).map((action) => ({
      id: action.id, command: action.command,
      get label(): string { throw new Error('search read a presentation label'); }
    }));
    expect(() => searchAction(state, 'ochre', actions, strategy(), searchBaseline(state, 'ochre'), { stateLimit: 10, memo: createMemo() })).not.toThrow();
  });

  it('applies the listed action through the fast path', () => {
    const state = arena({ hand: ['footwork'], ochre: 2, indigo: 3 });
    const action = listLegalActions(state)[0]!;
    expect(applyLegalAction(state, action)).toEqual(applyAction(state, action.id));
  });

  it('keys hidden draw piles by observable counts', () => {
    const forward = arena({ kingdomId: 'three-way-engine', draw: ['silver', 'gold'] });
    const backward = structuredClone(forward);
    backward.players.ochre.deck.draw.reverse();
    expect(memoKey(forward, 'ochre')).toBe(memoKey(backward, 'ochre'));
  });

  it('throws instead of returning a weaker action past its state limit', () => {
    const state = arena({ hand: ['footwork', 'muster', 'aim'], draw: ['copper', 'copper'], ochre: 2, indigo: 3 });
    expect(() => choose(state, strategy(), { stateLimit: 1 })).toThrow(ActionSearchOverflowError);
  });
});
