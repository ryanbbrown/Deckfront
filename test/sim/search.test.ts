import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, listLegalActions, registerKingdom, resetKingdoms } from '../../src/game';
import type { GameState } from '../../src/game';
import { applyLegalAction } from '../../src/game/engine';
import { createMemo, memoKey, searchAction, searchBaseline } from '../../src/sim/search';
import { tacticalAgent } from '../../src/sim/tacticalAgent';
import { ActionSearchOverflowError } from '../../src/sim/types';
import { arena, choose, playPhase, strategy } from './fixtures';
import { INFINITE_COUNT } from '../../src/sim/strategy';

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


  it('orders tactical actions before Flurry', () => {
    const state = arena({ hand: ['footwork', 'feint', 'flurry'], draw: ['copper', 'copper'], ochre: 3, indigo: 3, health: 20 });
    const finished = playPhase(state, strategy());
    expect(finished.fighters.indigo.health).toBe(17);
    expect(finished.turnState.cardsPlayed.at(-1)).toBe('flurry');
  });

  it('moves a Mage deck away from a public Melee deck', () => {
    const state = arena({
      kingdomId: 'three-way-open', hand: ['step'], draw: ['arcBolt'], ochre: 2, indigo: 3,
      indigoHand: ['heavyBlow'], indigoDraw: [], indigoDiscard: []
    });
    expect(choose(state, strategy()).command).toMatchObject({ type: 'playMoveAction', direction: 'left' });
  });

  it('uses the public opponent deck to break a Near and Far damage tie', () => {
    const state = arena({
      kingdomId: 'range-rich-mixed', hand: ['footwork', 'steadyShot'], draw: [], ochre: 2, indigo: 3,
      indigoHand: ['heavyBlow'], indigoDraw: [], indigoDiscard: []
    });
    expect(choose(state, strategy()).command).toMatchObject({ type: 'playFootwork', movement: 'left' });
  });

  it('still moves Close when that preserves the largest damage line', () => {
    const state = arena({
      kingdomId: 'range-rich-mixed', hand: ['step', 'heavyBlow'], draw: [], ochre: 2, indigo: 3,
      health: 20, indigoHand: ['steadyShot'], indigoDraw: [], indigoDiscard: []
    });
    expect(choose(state, strategy()).command).toMatchObject({ type: 'playMoveAction', direction: 'right' });
    expect(playPhase(state, strategy()).fighters.indigo.health).toBe(14);
  });
});

describe('hidden draw order', () => {
  it('does not change the next action when either hidden draw pile is permuted', () => {
    const forward = arena({ kingdomId: 'current-duel', hand: ['muster', 'footwork'], draw: ['volley', 'copper', 'aim'], ochre: 2, indigo: 3 });
    const backward = structuredClone(forward);
    backward.players.ochre.deck.draw.reverse();
    backward.players.indigo.deck.draw.reverse();
    const plan = strategy({ buyPlan: [{ kind: 'buy', cardId: 'volley', desiredCount: 2 }, { kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }] });
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
    expect(recovered.players.ochre.deck.draw.map((card) => card.definitionId)).toEqual(['copper', 'silver', 'copper']);
    expect(recovered.players.ochre.deck.hand.map((card) => card.definitionId)).toContain('gold');

    const permuted = structuredClone(recovered);
    permuted.players.ochre.deck.draw.reverse();
    expect(choose(permuted, strategy()).command).toEqual(choose(recovered, strategy()).command);
  });
});

describe('Cull policy', () => {
  it('never trashes a non-Copper card', () => {
    const state = arena({ hand: ['cull', 'gold'], firstBuyPending: false });
    const finished = playPhase(state, strategy({ buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }] }));
    expect(trashed(finished)).toEqual(['cull']);
    expect(finished.players.ochre.deck.hand.map((card) => card.definitionId)).toContain('gold');
  });

  it('trashes one Copper when trashing two would lose an earlier planned purchase', () => {
    const state = arena({ hand: ['cull', 'copper', 'copper', 'copper', 'gold'], firstBuyPending: false });
    const plan = strategy({ buyPlan: [{ kind: 'buy', cardId: 'volley', desiredCount: 1 }, { kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }] });
    expect(trashed(playPhase(state, plan))).toEqual(['copper']);
  });

  it('trashes two Coppers when every choice buys the same card', () => {
    const state = arena({ hand: ['cull', 'copper', 'copper', 'gold'], firstBuyPending: false });
    expect(trashed(playPhase(state, strategy({ buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }] })))).toEqual(['copper', 'copper']);
  });

  it('retires Cull but keeps Copper when repeatable money is exactly at the floor', () => {
    const state = arena({ hand: ['cull', 'copper', 'silver'], firstBuyPending: false });
    const finished = playPhase(state, strategy({ buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }] }));
    expect(trashed(finished)).toEqual(['cull']);
    expect(finished.players.ochre.deck.hand.map((card) => card.definitionId)).toContain('copper');
  });

  it('retires obsolete Cull with no Copper even when money is already below the floor', () => {
    const state = arena({ hand: ['cull', 'silver'], firstBuyPending: false });
    expect(trashed(playPhase(state, strategy({ buyPlan: [{ kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }] })))).toEqual(['cull']);
  });

  it('uses the smaller live deck after Cull when it evaluates a later Step', () => {
    const state = arena({
      kingdomId: 'range-rich-mixed', hand: ['cull', 'copper', 'step'], draw: ['heavyBlow'],
      discard: ['gold'], ochre: 1, indigo: 2,
      indigoHand: ['heavyBlow', 'copper', 'copper', 'copper', 'copper'],
      indigoDraw: [], indigoDiscard: [], firstBuyPending: false
    });
    const finished = playPhase(state, strategy({ buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }] }));
    expect(trashed(finished)).toContain('copper');
    expect(finished.fighters.ochre.position).toBe(2);
  });
});

describe('fixed choice policy', () => {
  it('Reclaim selects the highest-cost discarded card', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['reclaim'], draw: ['copper'], discard: ['silver', 'gold'] });
    const reclaim = listLegalActions(state).find((entry) => 'cardInstanceId' in entry.command)!;
    const pending = applyAction(state, reclaim.id);
    const agent = tacticalAgent(strategy({
      buyPlan: [{ kind: 'buy', cardId: 'channel', desiredCount: INFINITE_COUNT }]
    }));
    const selected = agent.chooseAction(pending, 'ochre', listLegalActions(pending));
    expect(selected.command.type).toBe('resolveRecover');
    const recoveredId = selected.command.type === 'resolveRecover' ? selected.command.recoverInstanceId : '';
    expect(pending.players.ochre.deck.discard.find((card) => card.id === recoveredId)?.definitionId).toBe('gold');
  });

  it('breaks equal Reclaim costs by definition id', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['reclaim'], draw: ['copper'], discard: ['silver', 'footwork'] });
    const reclaim = listLegalActions(state).find((entry) => 'cardInstanceId' in entry.command)!;
    const pending = applyAction(state, reclaim.id);
    const agent = tacticalAgent(strategy({
      buyPlan: [{ kind: 'buy', cardId: 'channel', desiredCount: INFINITE_COUNT }]
    }));
    const selected = agent.chooseAction(pending, 'ochre', listLegalActions(pending));
    const recoveredId = selected.command.type === 'resolveRecover' ? selected.command.recoverInstanceId : '';
    expect(pending.players.ochre.deck.discard.find((card) => card.id === recoveredId)?.definitionId).toBe('footwork');
  });

});

describe('search mechanics', () => {
  it('is deterministic with and without memoization', () => {
    const state = arena({ kingdomId: 'current-duel', hand: ['footwork', 'aim', 'volley', 'muster'], draw: ['copper', 'copper'], ochre: 2, indigo: 3 });
    const plan = strategy({ buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }] });
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

  it.each([
    ['spaces moved', (state: GameState) => { state.turnState.spacesMoved = 2; }],
    ['mana spent', (state: GameState) => { state.turnState.manaSpent = 2; }],
    ['spells played', (state: GameState) => { state.turnState.spellsPlayed = 2; }],
    ['copies by definition', (state: GameState) => { state.turnState.copiesPlayed = { rally: 2 }; }],
    ['distinct families', (state: GameState) => { state.turnState.familiesPlayed = ['mana', 'melee']; }],
    ['ordered card history', (state: GameState) => { state.turnState.cardsPlayed = ['channel', 'openingStrike']; }]
  ] as const)('includes %s in memo identity', (_name, mutate) => {
    const baseline = arena({ kingdomId: 'current-duel', hand: ['rally'] });
    const changed = structuredClone(baseline);
    mutate(changed);
    expect(memoKey(changed, 'ochre')).not.toBe(memoKey(baseline, 'ochre'));
  });

  it('distinguishes the first-card boundary even at the same tactical count', () => {
    const first = arena({ kingdomId: 'current-duel', hand: ['rally'] });
    const later = structuredClone(first);
    first.turnState.cardsPlayed = [];
    later.turnState.cardsPlayed = ['channel'];
    expect(memoKey(first, 'ochre')).not.toBe(memoKey(later, 'ochre'));
  });

  it('prunes Scour target combinations to the pilot-selected Copper cards', () => {
    registerKingdom({ id:'search-scour', name:'Search Scour', startingHealth:40,
      actionPiles:[{ cardId:'scour', count:10 }] });
    const state = arena({ kingdomId:'search-scour', hand:['scour','copper','copper','copper','silver','gold'] });
    const selected = choose(state, strategy({
      buyPlan: [{ kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }]
    }), { stateLimit:20 });
    expect(selected.command.type).toBe('playTargetedAction');
    const targets = selected.command.type === 'playTargetedAction' ? selected.command.targetCardInstanceIds : [];
    expect(targets.map((id) => state.players.ochre.deck.hand.find((card) => card.id === id)?.definitionId))
      .toEqual(['copper','copper']);
  });

  it('throws instead of returning a weaker action past its state limit', () => {
    const state = arena({ hand: ['footwork', 'muster', 'aim'], draw: ['copper', 'copper'], ochre: 2, indigo: 3 });
    expect(() => choose(state, strategy(), { stateLimit: 1 })).toThrow(ActionSearchOverflowError);
  });
});
