import { applyAction, listLegalActions, registerKingdom, resetKingdoms } from '../../src/game';
import type { GameState, LegalAction } from '../../src/game';
import { tacticalAgent } from '../../src/sim/tacticalAgent';
import { afterEach, describe, expect, it } from 'vitest';
import { arena, strategy } from './fixtures';
import { INFINITE_COUNT } from '../../src/sim/strategy';

afterEach(() => { resetKingdoms(); });

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

function chosenDirection(action: LegalAction): string | undefined {
  return 'movement' in action.command ? action.command.movement
    : 'direction' in action.command ? action.command.direction : undefined;
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

  it('moves a position-independent Mage profile away when retreat improves its public advantage over Melee', () => {
    const state = arena({
      kingdomId: 'three-way-open', hand: ['step'], draw: ['arcBolt'], ochre: 2, indigo: 3,
      indigoHand: ['heavyBlow'], indigoDraw: [], indigoDiscard: []
    });
    expect(choose(state).command).toMatchObject({ type: 'playMoveAction', direction: 'left' });
  });

  it('moves a Ranged profile away when retreat improves its public advantage over Melee', () => {
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

  it.each([
    ['Step', 'step'], ['Ley Step', 'leyStep'], ['Footwork', 'footwork']
  ] as const)('chooses mirrored %s directions when only continued movement space breaks the tie', (_name, card) => {
    const normal = arena({
      kingdomId: 'three-way-open', hand: [card, 'steadyShot'], draw: [], ochre: 3, indigo: 3,
      indigoHand: [], indigoDraw: [], indigoDiscard: []
    });
    const reflected = arena({
      kingdomId: 'three-way-open', hand: [card, 'steadyShot'], draw: [], ochre: 4, indigo: 4,
      indigoHand: [], indigoDraw: [], indigoDiscard: []
    });
    expect(chosenDirection(choose(normal))).toBe('right');
    expect(chosenDirection(choose(reflected))).toBe('left');
  });

  it('chooses mirrored Drive directions when public position and immediate damage tie', () => {
    const normal = arena({
      kingdomId: 'three-way-open', hand: ['drive', 'steadyShot'], draw: [], ochre: 3, indigo: 3,
      indigoHand: [], indigoDraw: [], indigoDiscard: []
    });
    const reflected = arena({
      kingdomId: 'three-way-open', hand: ['drive', 'steadyShot'], draw: [], ochre: 4, indigo: 4,
      indigoHand: [], indigoDraw: [], indigoDiscard: []
    });
    expect(chosenDirection(choose(normal))).toBe('right');
    expect(chosenDirection(choose(reflected))).toBe('left');
  });

  it('chooses Drive wall damage at both arena walls', () => {
    const left = arena({ hand: ['drive'], ochre: 1, indigo: 1 });
    const right = arena({ hand: ['drive'], ochre: 6, indigo: 6 });
    expect(choose(left).command).toMatchObject({ type: 'playDrive', direction: 'left' });
    expect(choose(right).command).toMatchObject({ type: 'playDrive', direction: 'right' });
  });

  it('uses the highest-cost Ranged card for Salvage Shot damage', () => {
    registerKingdom({
      id: 'salvage-policy', name: 'Salvage policy', startingHealth: 40,
      actionPiles: [
        { cardId: 'salvageShot', count: 10 }, { cardId: 'pepperingShot', count: 10 },
        { cardId: 'longshot', count: 10 }
      ]
    });
    const state = arena({
      kingdomId: 'salvage-policy', hand: ['salvageShot', 'pepperingShot', 'longshot'], draw: []
    });
    const action = choose(state);
    expect(action.command.type).toBe('playTargetedAction');
    const targetId = action.command.type === 'playTargetedAction'
      ? action.command.targetCardInstanceIds[0] : undefined;
    expect(state.players.ochre.deck.hand.find((card) => card.id === targetId)?.definitionId).toBe('longshot');
  });

  it('trashes Scrap before Copper with Discipline and Reforge', () => {
    for (const mechanic of ['discipline', 'reforge'] as const) {
      registerKingdom({
        id: `${mechanic}-policy`, name: `${mechanic} policy`, startingHealth: 40,
        actionPiles: [{ cardId: mechanic, count: 10 }]
      });
      const state = arena({ kingdomId: `${mechanic}-policy`, hand: [mechanic, 'copper', 'scrap'] });
      const action = choose(state);
      expect(action.command.type).toBe('playTargetedAction');
      const targetId = action.command.type === 'playTargetedAction'
        ? action.command.targetCardInstanceIds[0] : undefined;
      expect(state.players.ochre.deck.hand.find((card) => card.id === targetId)?.definitionId).toBe('scrap');
    }
  });

  it('trashes Copper with Discipline instead of trashing Discipline when no Scrap is available', () => {
    registerKingdom({
      id: 'discipline-policy', name: 'Discipline policy', startingHealth: 40,
      actionPiles: [{ cardId: 'discipline', count: 10 }]
    });
    const state = arena({ kingdomId: 'discipline-policy', hand: ['discipline', 'copper'] });
    const action = choose(state);
    expect(action.command.type).toBe('playTargetedAction');
    const targetId = action.command.type === 'playTargetedAction'
      ? action.command.targetCardInstanceIds[0] : undefined;
    expect(state.players.ochre.deck.hand.find((card) => card.id === targetId)?.definitionId).toBe('copper');
  });

  it('plays Opening Strike before a setup card keeps it from dealing full damage', () => {
    registerKingdom({
      id: 'opening-policy', name: 'Opening policy', startingHealth: 40,
      actionPiles: [{ cardId: 'channel', count: 10 }, { cardId: 'openingStrike', count: 10 }]
    });
    const state = arena({
      kingdomId: 'opening-policy', hand: ['channel', 'openingStrike'], ochre: 2, indigo: 2
    });
    expect(playedDefinition(state, choose(state))).toBe('openingStrike');
  });

  it('plays another affordable spell before Cascade increases its damage', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['cascade', 'arcBolt'], mana: 2, health: 40
    });
    expect(playedDefinition(state, choose(state))).toBe('arcBolt');
  });

  it('does not count one Aim bonus once for every Ranged card while moving', () => {
    registerKingdom({
      id: 'aim-once-policy', name: 'Aim once policy', startingHealth: 40,
      actionPiles: [
        { cardId: 'footwork', count: 10 }, { cardId: 'pepperingShot', count: 10 },
        { cardId: 'heavyBlow', count: 10 }
      ],
      overrides: { heavyBlow: { values: { damage: 5, draw: 0 } } }
    });
    const state = arena({
      kingdomId: 'aim-once-policy', hand: ['footwork', 'pepperingShot', 'pepperingShot', 'heavyBlow'],
      aimed: true, ochre: 2, indigo: 3, indigoHand: [], indigoDraw: [], indigoDiscard: []
    });
    expect(choose(state).command).toMatchObject({ type: 'playFootwork', movement: 'right' });
  });

  it('uses Scour on Scrap before filling its remaining capacity with Copper', () => {
    const state = arena({ hand:['scour','copper','scrap','copper','silver'] });
    const selected = choose(state);
    expect(selected.command.type).toBe('playTargetedAction');
    const selectedIds = selected.command.type === 'playTargetedAction' ? selected.command.targetCardInstanceIds : [];
    expect(selectedIds.map((id) => state.players.ochre.deck.hand.find((card) => card.id === id)?.definitionId).sort())
      .toEqual(['copper','scrap']);
  });

  it('uses Cull on Scrap before filling its remaining capacity with Copper', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['cull', 'copper', 'scrap', 'copper'], money: 5,
      firstBuyPending: false
    });
    const selected = choose(state, strategy({
      buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }]
    }));
    expect(selected.command.type).toBe('playTargetedAction');
    const selectedIds = selected.command.type === 'playTargetedAction' ? selected.command.targetCardInstanceIds : [];
    expect(selectedIds.map((id) => state.players.ochre.deck.hand.find((card) => card.id === id)?.definitionId).sort())
      .toEqual(['copper','scrap']);
  });

  it('uses Sharpen on Scrap before Copper', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['sharpen', 'scrap', 'copper'], draw: [], firstBuyPending: false
    });
    const pending = applyAction(state, choose(state).id);
    const selected = choose(pending);
    expect(selected.command.type).toBe('resolveOptionalTrash');
    const targetId = selected.command.type === 'resolveOptionalTrash' ? selected.command.trashInstanceId : null;
    expect(pending.players.ochre.deck.hand.find((card) => card.id === targetId)?.definitionId).toBe('scrap');
  });

  it('skips Scour targets without Scrap or Copper', () => {
    const state = arena({ hand:['scour','silver'] });
    expect(choose(state).command).toMatchObject({ type:'playTargetedAction', targetCardInstanceIds:[] });
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

  it('discards Scrap before Copper when Copper preserves the planned purchase', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['scrap', 'copper'], money: 2, firstBuyPending: false
    });
    state.pendingChoice = { type: 'discard', playerId: 'ochre', remaining: 1 };
    const action = choose(state, strategy({
      buyPlan: [{ kind: 'buy', cardId: 'silver', desiredCount: INFINITE_COUNT }]
    }));
    expect(action.command.type).toBe('resolveDiscard');
    const discardedId = action.command.type === 'resolveDiscard' ? action.command.discardInstanceId : null;
    expect(state.players.ochre.deck.hand.find((card) => card.id === discardedId)?.definitionId).toBe('scrap');
  });

  it('retains the one tactically useful Scrap when the purchase is already safe', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['scrap', 'copper'], money: 5, firstBuyPending: false
    });
    state.pendingChoice = { type: 'discard', playerId: 'ochre', remaining: 1 };
    const action = choose(state, strategy({
      buyPlan: [{ kind: 'buy', cardId: 'silver', desiredCount: 1 }]
    }));
    expect(action.command.type).toBe('resolveDiscard');
    const discardedId = action.command.type === 'resolveDiscard' ? action.command.discardInstanceId : null;
    expect(state.players.ochre.deck.hand.find((card) => card.id === discardedId)?.definitionId).toBe('copper');
  });

  it('discards a redundant extra Scrap before Copper', () => {
    const state = arena({
      kingdomId: 'current-duel', hand: ['scrap', 'scrap', 'copper'], money: 5, firstBuyPending: false
    });
    state.pendingChoice = { type: 'discard', playerId: 'ochre', remaining: 1 };
    const action = choose(state);
    expect(action.command.type).toBe('resolveDiscard');
    const discardedId = action.command.type === 'resolveDiscard' ? action.command.discardInstanceId : null;
    expect(state.players.ochre.deck.hand.find((card) => card.id === discardedId)?.definitionId).toBe('scrap');
  });

  it('uses Sharpen to trash Copper when the planned purchase stays available', () => {
    registerKingdom({
      id: 'sharpen-policy', name: 'Sharpen policy', startingHealth: 40,
      actionPiles: [{ cardId: 'sharpen', count: 10 }]
    });
    const state = arena({
      kingdomId: 'sharpen-policy', hand: ['sharpen', 'copper'], draw: [], firstBuyPending: false
    });
    const finished = applyAction(state, choose(state).id);
    expect(finished.pendingChoice?.type).toBe('optionalTrash');
    const resolution = tacticalAgent(strategy({
      buyPlan: [{ kind: 'buy', cardId: 'silver', desiredCount: INFINITE_COUNT }]
    })).chooseAction(finished, 'ochre', listLegalActions(finished));
    expect(resolution.command.type).toBe('resolveOptionalTrash');
    const trashId = resolution.command.type === 'resolveOptionalTrash'
      ? resolution.command.trashInstanceId : undefined;
    expect(finished.players.ochre.deck.hand.find((card) => card.id === trashId)?.definitionId).toBe('copper');
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
