import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, listLegalActions, resetKingdoms } from '../../src/game';
import type { GameCommand, GameState } from '../../src/game';
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

function actionPhaseCommands(
  state: GameState, plan: ReturnType<typeof strategy>, memo: ReturnType<typeof createMemo> | null
): { commands: GameCommand[]; state: GameState } {
  const baseline = searchBaseline(state, 'ochre');
  const commands: GameCommand[] = [];
  let current = state;
  for (let count = 0; count < 30; count += 1) {
    const action = searchAction(current, 'ochre', listLegalActions(current), plan, baseline, {
      stateLimit: 20000, memo
    }).action;
    commands.push(action.command);
    if (action.command.type === 'endActionPhase') return { commands, state: current };
    current = applyAction(current, action.id);
  }
  throw new Error('The test Action phase did not finish.');
}

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
    expect(playPhase(state, strategy()).fighters.indigo.health).toBe(16);
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

  it('keeps the publicly recovered top card while blinding only the hidden suffix', () => {
    const state = arena({
      kingdomId: 'three-way-engine', hand: ['reclaim', 'muster'],
      draw: ['copper', 'silver', 'copper'], discard: ['gold']
    });
    const reclaim = listLegalActions(state).find((action) =>
      'cardInstanceId' in action.command && definitionOf(state, action.command.cardInstanceId) === 'reclaim'
    )!;
    const pending = applyAction(state, reclaim.id);
    const recovered = applyAction(pending, choose(pending, strategy()).id);
    expect(recovered.players.ochre.deck.draw.map((card) => card.definitionId)).toEqual(['gold', 'silver', 'copper']);

    const permuted = structuredClone(recovered);
    permuted.players.ochre.deck.draw = [
      permuted.players.ochre.deck.draw[0]!,
      ...permuted.players.ochre.deck.draw.slice(1).reverse()
    ];
    expect(choose(permuted, strategy()).command).toEqual(choose(recovered, strategy()).command);
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

  it('retires Cull but keeps Copper when repeatable money is exactly at the floor', () => {
    const state = arena({ hand: ['cull', 'copper', 'silver'], firstBuyPending: false });
    const finished = playPhase(state, strategy({ repeatPurchase: 'footwork' }));
    expect(trashed(finished)).toEqual(['cull']);
    expect(finished.players.ochre.deck.hand.map((card) => card.definitionId)).toContain('copper');
  });

  it('retires obsolete Cull with no Copper even when money is already below the floor', () => {
    const state = arena({ hand: ['cull', 'silver'], firstBuyPending: false });
    expect(trashed(playPhase(state, strategy({ repeatPurchase: 'gold' })))).toEqual(['cull']);
  });
});

describe('fixed choice policy', () => {
  it('Reclaim selects the highest-cost discarded card', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['reclaim'], draw: ['copper'], discard: ['silver', 'gold'] });
    expect(playPhase(state, strategy({ repeatPurchase: 'footwork' })).players.ochre.deck.draw[0]?.definitionId).toBe('gold');
  });

  it('breaks equal Reclaim costs by definition id', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['reclaim'], draw: ['copper'], discard: ['silver', 'footwork'] });
    expect(playPhase(state, strategy({ repeatPurchase: 'footwork' })).players.ochre.deck.draw[0]?.definitionId).toBe('footwork');
  });

  it('uses the revealed state after Prism to preserve the maximum damage line', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['prism', 'fireball', 'copper'], draw: ['channel'], firstBuyPending: false });
    const finished = playPhase(state, strategy({ repeatPurchase: 'footwork' }));
    expect(finished.fighters.indigo.health).toBe(34);
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

  it('blinds hidden draw order without changing the live game state', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['footwork', 'aim'], draw: ['gold', 'copper', 'silver'],
      ochre: 2, indigo: 3
    });
    const before = structuredClone(state);

    choose(state, strategy());

    expect(state).toEqual(before);
  });

  it('keeps exact memo results through Reclaim and a later draw', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['reclaim'], draw: ['muster'], discard: ['gold', 'copper'] });
    const plan = strategy({ repeatPurchase: 'footwork' });
    const memoized = actionPhaseCommands(structuredClone(state), plan, createMemo());
    const plain = actionPhaseCommands(structuredClone(state), plan, null);
    expect(memoized.commands).toEqual(plain.commands);
    expect(memoized.state).toEqual(plain.state);
    expect(memoized.commands.map((command) => command.type)).toContain('resolveRecover');
    expect(memoized.commands.filter((command) => 'cardInstanceId' in command)).toHaveLength(2);
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

  it('keeps distinct current draw orders in distinct memo entries', () => {
    const forward = arena({ kingdomId: 'three-way-engine', draw: ['silver', 'gold'] });
    const backward = structuredClone(forward);
    backward.players.ochre.deck.draw.reverse();
    expect(memoKey(forward, 'ochre')).not.toBe(memoKey(backward, 'ochre'));
  });

  it('throws instead of returning a weaker action past its state limit', () => {
    const state = arena({ hand: ['footwork', 'muster', 'aim'], draw: ['copper', 'copper'], ochre: 2, indigo: 3 });
    expect(() => choose(state, strategy(), { stateLimit: 1 })).toThrow(ActionSearchOverflowError);
  });
});
