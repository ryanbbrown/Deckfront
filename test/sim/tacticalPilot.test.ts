import { applyAction, listLegalActions } from '../../src/game';
import type { GameState, LegalAction } from '../../src/game';
import { tacticalAgent } from '../../src/sim/tacticalAgent';
import { describe, expect, it } from 'vitest';
import { arena, strategy } from './fixtures';

function choose(state: GameState, plan = strategy()): LegalAction {
  const actions = listLegalActions(state);
  return tacticalAgent(plan).chooseAction(state, 'ochre', actions);
}

describe('the shared tactical pilot', () => {
  it('uses an existing Aim on Volley before it draws or aims again', () => {
    const state = arena({ kingdomId: 'current-duel', hand: ['muster', 'aim', 'volley'], aimed: true });
    expect(choose(state).command.type).toBe('playVolley');
  });

  it('moves to the range with the largest visible attack value', () => {
    const state = arena({ kingdomId: 'current-duel', hand: ['footwork', 'drive'], ochre: 2, indigo: 1 });
    const action = choose(state);
    expect(action.command).toMatchObject({ type: 'playFootwork', movement: 'left' });
  });

  it('sets Feint before it uses a Close attack', () => {
    const state = arena({ kingdomId: 'current-duel', hand: ['heavyBlow', 'feint'], ochre: 2, indigo: 2 });
    expect(choose(state).command.type).toBe('playFeint');
  });

  it('keeps Flurry until other Tactical Actions increase its damage', () => {
    const state = arena({ kingdomId: 'current-duel', hand: ['flurry', 'drive'], ochre: 2, indigo: 2 });
    expect(choose(state).command.type).toBe('playDrive');
  });

  it('gains mana before it selects a newly affordable spell', () => {
    let state = arena({ kingdomId: 'three-way-open', hand: ['fireball', 'channel'], mana: 1 });
    const channel = choose(state);
    expect(channel.command.type).toBe('playAction');
    state = applyAction(state, channel.id);
    const spell = choose(state);
    expect(spell.command.type).toBe('playAction');
    const command = spell.command;
    expect('cardInstanceId' in command
      ? state.players.ochre.deck.hand.find((card) => card.id === command.cardInstanceId)?.definitionId
      : null).toBe('fireball');
  });

  it('recovers the highest-cost discard card', () => {
    let state = arena({
      kingdomId: 'three-way-engine', hand: ['reclaim'], draw: ['copper'], discard: ['footwork', 'fireball']
    });
    const reclaim = choose(state);
    state = applyAction(state, reclaim.id);
    expect(state.pendingChoice?.type).toBe('recover');
    expect(choose(state).command).toMatchObject({ type: 'resolveRecover' });
    const command = choose(state).command;
    expect(command.type === 'resolveRecover' && command.recoverInstanceId)
      .toBe(state.players.ochre.deck.discard.find((card) => card.definitionId === 'fireball')?.id);
  });

  it('discards Copper for Prism before a useful action', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['copper', 'channel'] });
    state.pendingChoice = { type: 'discard', playerId: 'ochre', remaining: 1 };
    expect(choose(state).command).toMatchObject({
      type: 'resolveDiscard', discardInstanceId: state.players.ochre.deck.hand[0]!.id
    });
  });

  it('trashes two Coppers when the planned purchase stays available', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['cull', 'copper', 'copper'], money: 5, firstBuyPending: false
    });
    const action = choose(state, strategy({
      buyAgenda: [{ cardId: 'volley', desiredCount: 1 }], repeatPurchase: 'footwork'
    }));
    expect(action.command.type).toBe('playCull');
    expect(action.command.type === 'playCull' ? action.command.trashInstanceIds : []).toHaveLength(2);
  });

  it('keeps Coppers when trashing them would lose the planned purchase', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['cull', 'copper', 'copper'], money: 3, firstBuyPending: false
    });
    expect(choose(state, strategy({
      buyAgenda: [{ cardId: 'volley', desiredCount: 1 }], repeatPurchase: 'footwork'
    })).command.type).toBe('endActionPhase');
  });
});
