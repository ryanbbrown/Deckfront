import { applyAction, listLegalActions } from '../../src/game';
import type { GameState, LegalAction } from '../../src/game';
import { tacticalAgent } from '../../src/sim/tacticalAgent';
import { describe, expect, it } from 'vitest';
import { arena, strategy } from './fixtures';
import { INFINITE_COUNT } from '../../src/sim/strategy';

function choose(state: GameState, plan = strategy()): LegalAction {
  const actions = listLegalActions(state);
  return tacticalAgent(plan).chooseAction(state, 'ochre', actions);
}

function playedDefinition(state: GameState, action: LegalAction): string | null {
  const command = action.command;
  return 'cardInstanceId' in command
    ? state.players.ochre.deck.hand.find((card) => card.id === command.cardInstanceId)?.definitionId ?? null
    : null;
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

  it('uses Step to move a Mage deck away from a Melee deck', () => {
    const state = arena({
      kingdomId: 'three-way-open', hand: ['step'], draw: ['arcBolt'], ochre: 2, indigo: 3,
      indigoHand: ['heavyBlow'], indigoDraw: [], indigoDiscard: []
    });
    expect(choose(state).command).toMatchObject({ type: 'playMoveAction', direction: 'left' });
  });

  it('uses the opponent deck to prefer Far over Near when Steady Shot damage ties', () => {
    const state = arena({
      kingdomId: 'range-rich-mixed', hand: ['footwork', 'steadyShot'], draw: [], ochre: 2, indigo: 3,
      indigoHand: ['heavyBlow'], indigoDraw: [], indigoDiscard: []
    });
    expect(choose(state).command).toMatchObject({ type: 'playFootwork', movement: 'left' });
  });

  it('prefers Far when Volley deals more current damage there', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['footwork', 'volley'], draw: [], ochre: 2, indigo: 3,
      indigoHand: ['heavyBlow'], indigoDraw: [], indigoDiscard: []
    });
    expect(choose(state).command).toMatchObject({ type: 'playFootwork', movement: 'left' });
  });

  it('uses Repelling Shot before Volley when it creates Far range', () => {
    let state = arena({ hand: ['volley', 'repellingShot'], draw: [], ochre: 2, indigo: 3 });
    const repelling = choose(state);
    expect(playedDefinition(state, repelling)).toBe('repellingShot');
    state = applyAction(state, repelling.id);
    expect(state.fighters.indigo.position).toBe(4);
    expect(playedDefinition(state, choose(state))).toBe('volley');
  });

  it('keeps Footwork at Stay when current damage and public position value tie', () => {
    const state = arena({
      kingdomId: 'three-way-open', hand: ['footwork'], draw: ['arcBolt'], ochre: 2, indigo: 3,
      indigoHand: ['arcBolt'], indigoDraw: [], indigoDiscard: []
    });
    expect(choose(state).command).toMatchObject({ type: 'playFootwork', movement: 'stay' });
  });

  it('does not spend Step in a deck with no attacks', () => {
    const state = arena({ hand: ['step'], draw: ['copper'], indigoHand: [], indigoDraw: [], indigoDiscard: [] });
    expect(choose(state).command.type).toBe('endActionPhase');
  });

  it('moves before Adapt to earn its extra draw when current damage ties', () => {
    let state = arena({
      kingdomId: 'three-way-open', hand: ['adapt', 'step'], draw: ['copper', 'copper'], ochre: 2, indigo: 3,
      indigoHand: [], indigoDraw: [], indigoDiscard: []
    });
    const movement = choose(state);
    expect(movement.command).toMatchObject({ type: 'playMoveAction', direction: 'left' });
    state = applyAction(state, movement.id);
    const adapt = choose(state);
    expect(playedDefinition(state, adapt)).toBe('adapt');
    state = applyAction(state, adapt.id);
    expect(state.players.ochre.deck.hand.map((card) => card.definitionId)).toEqual(['copper', 'copper']);
  });

  it('does not move before Adapt when every direction reduces current damage', () => {
    const state = arena({
      kingdomId: 'three-way-open', hand: ['adapt', 'step', 'heavyBlow'], draw: [], ochre: 2, indigo: 2,
      indigoHand: [], indigoDraw: [], indigoDiscard: []
    });
    expect(playedDefinition(state, choose(state))).toBe('adapt');
  });

  it('spends Ley Step mana only once while deciding whether to move before Adapt', () => {
    const state = arena({
      kingdomId: 'three-way-open', hand: ['adapt', 'leyStep', 'flurry', 'arcBolt', 'arcBolt'],
      draw: [], mana: 0, ochre: 2, indigo: 2, indigoHand: [], indigoDraw: [], indigoDiscard: []
    });
    state.turnState.cardsPlayed = ['footwork', 'footwork', 'footwork', 'footwork', 'footwork'];
    expect(playedDefinition(state, choose(state))).toBe('adapt');
  });

  it('does not trade away current Melee damage to enable one spell with Ley Step', () => {
    const state = arena({
      kingdomId: 'three-way-open', hand: ['leyStep', 'heavyBlow', 'heavyBlow', 'arcBolt'],
      mana: 0, ochre: 2, indigo: 2, indigoHand: ['steadyShot'], indigoDraw: [], indigoDiscard: []
    });
    const action = choose(state);
    const command = action.command;
    expect(command.type).toBe('playAction');
    if (command.type !== 'playAction') throw new Error('Expected Heavy Blow to use playAction.');
    expect(state.players.ochre.deck.hand.find((card) => card.id === command.cardInstanceId)?.definitionId)
      .toBe('heavyBlow');
  });

  it('chooses Drive wall damage at both arena walls', () => {
    const left = arena({ hand: ['drive'], ochre: 1, indigo: 1 });
    const right = arena({ hand: ['drive'], ochre: 5, indigo: 5 });
    expect(choose(left).command).toMatchObject({ type: 'playDrive', direction: 'left' });
    expect(choose(right).command).toMatchObject({ type: 'playDrive', direction: 'right' });
  });

  it('uses Scour on the first two Copper cards and skips targets only without Copper', () => {
    const withCopper = arena({ hand:['scour','copper','copper','copper','silver'] });
    const selected = choose(withCopper);
    expect(selected.command.type).toBe('playTargetedAction');
    const selectedIds = selected.command.type === 'playTargetedAction' ? selected.command.targetCardInstanceIds : [];
    expect(selectedIds.map((id) => withCopper.players.ochre.deck.hand.find((card) => card.id === id)?.definitionId))
      .toEqual(['copper','copper']);

    const withoutCopper = arena({ hand:['scour','silver'] });
    expect(choose(withoutCopper).command).toMatchObject({ type:'playTargetedAction', targetCardInstanceIds:[] });
  });

  it('filters heterogeneous actions before scoring gain definitions', () => {
    const state = arena({ kingdomId:'current-duel', hand:[] });
    state.pendingChoice = { type:'gain', playerId:'ochre', maxCost:5 };
    const actions: LegalAction[] = [
      { id:'other', label:'Other', command:{ type:'endActionPhase' } },
      { id:'gain', label:'Gain Rally', command:{ type:'resolveGain', definitionId:'rally' } }
    ];
    expect(tacticalAgent(strategy()).chooseAction(state,'ochre',actions).command)
      .toEqual({ type:'resolveGain', definitionId:'rally' });
  });

  it('uses Cull-updated live deck size for a later Step decision', () => {
    let state = arena({
      kingdomId: 'range-rich-mixed', hand: ['cull', 'copper', 'step'], draw: ['heavyBlow'],
      discard: ['gold'], ochre: 1, indigo: 2,
      indigoHand: ['heavyBlow', 'copper', 'copper', 'copper', 'copper'],
      indigoDraw: [], indigoDiscard: [], firstBuyPending: false
    });
    const cull = choose(state);
    expect(cull.command.type).toBe('playTargetedAction');
    state = applyAction(state, cull.id);
    expect(choose(state).command).toMatchObject({ type: 'playMoveAction', direction: 'right' });
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
      buyPlan: [
        { kind: 'buy', cardId: 'precisionShot', desiredCount: 1 },
        { kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }
      ]
    }));
    expect(action.command.type).toBe('playTargetedAction');
    expect(action.command.type === 'playTargetedAction' ? action.command.targetCardInstanceIds : []).toHaveLength(2);
  });

  it('keeps Coppers when trashing them would lose the planned purchase', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['cull', 'copper', 'copper'], money: 3, firstBuyPending: false
    });
    expect(choose(state, strategy({
      buyPlan: [
        { kind: 'buy', cardId: 'precisionShot', desiredCount: 1 },
        { kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }
      ]
    })).command.type).toBe('endActionPhase');
  });
});
