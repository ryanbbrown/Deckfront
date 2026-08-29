import { describe, expect, it } from 'vitest';
import {
  applyAction, assertInvariants, cardDefinition, createCard, createGame, listActionAvailability,
  isTacticalAction, listLegalActions, replayCommands, submitStartingBuild
} from '../src/game';
import type { GameCommand, GameState, PlayerId } from '../src/game';

function ready(seed = 1, first: PlayerId = 'ochre'): GameState {
  let state = createGame({ seed, firstPlayerId: first }); state = submitStartingBuild(state, 'ochre', []); return submitStartingBuild(state, 'indigo', []);
}
function action(state: GameState, predicate: (command: GameCommand) => boolean) {
  const found = listLegalActions(state).find((candidate) => predicate(candidate.command));
  if (!found) throw new Error(`Missing action: ${JSON.stringify(listLegalActions(state))}`); return found;
}
function isolateHand(state: GameState, playerId: PlayerId, definitions: string[]): void {
  const deck = state.players[playerId].deck; state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play);
  deck.draw = []; deck.hand = definitions.map((id) => createCard(state, id)); deck.discard = []; deck.play = [];
}
function setDraw(state: GameState, playerId: PlayerId, definitions: string[]): void {
  state.players[playerId].deck.draw = definitions.map((id) => createCard(state, id));
}
function setDiscard(state: GameState, playerId: PlayerId, definitions: string[]): void {
  state.players[playerId].deck.discard = definitions.map((id) => createCard(state, id));
}
function handCard(state: GameState, playerId: PlayerId, definitionId: string): string {
  const card = state.players[playerId].deck.hand.find((candidate) => candidate.definitionId === definitionId);
  if (!card) throw new Error(`No ${definitionId} in hand.`); return card.id;
}
function playCard(state: GameState, definitionId: string, extra: (command: GameCommand) => boolean = () => true): GameState {
  const cardInstanceId = handCard(state, state.activePlayerId, definitionId);
  return applyAction(state, action(state, (command) => 'cardInstanceId' in command && command.cardInstanceId === cardInstanceId && extra(command)).id);
}
function availability(state: GameState, definitionId: string) {
  const cardInstanceId = handCard(state, state.activePlayerId, definitionId);
  return listActionAvailability(state, state.activePlayerId).find((entry) => entry.cardInstanceId === cardInstanceId)!;
}
function definitions(cards: { definitionId: string }[]): string[] { return cards.map((card) => card.definitionId); }
function endTurn(state: GameState): GameState {
  const next = applyAction(state, action(state, (command) => command.type === 'endActionPhase').id);
  return applyAction(next, action(next, (command) => command.type === 'endBuyPhase').id);
}

describe('deck tools', () => {
  it('Stipend draws 1 and adds its money at the end of the Action phase', () => {
    let state = ready(); isolateHand(state, 'ochre', ['stipend']); setDraw(state, 'ochre', ['gold']);
    state = playCard(state, 'stipend');
    expect(definitions(state.players.ochre.deck.hand)).toEqual(['gold']); expect(state.players.ochre.money).toBe(1);
    state.players.ochre.firstBuyPending = false;
    state = applyAction(state, action(state, (command) => command.type === 'endActionPhase').id);
    expect(state.players.ochre.money).toBe(4); assertInvariants(state);
  });
  it('Reclaim offers the discard pile and moves the mandatory choice directly to hand', () => {
    let state = ready(); isolateHand(state, 'ochre', ['reclaim', 'muster']); setDraw(state, 'ochre', ['copper']); setDiscard(state, 'ochre', ['gold', 'silver']);
    state = playCard(state, 'reclaim'); expect(definitions(state.players.ochre.deck.hand)).toEqual(['muster']);
    expect(state.pendingChoice).toEqual({ type: 'recover', playerId: 'ochre', remaining: 1 });
    const gold = state.players.ochre.deck.discard.find((card) => card.definitionId === 'gold')!;
    const legal = listLegalActions(state); expect(legal).toHaveLength(2); expect(legal.every((entry) => entry.command.type === 'resolveRecover')).toBe(true);
    state = applyAction(state, action(state, (command) => command.type === 'resolveRecover' && command.recoverInstanceId === gold.id).id);
    expect(state.pendingChoice).toBeNull(); expect(definitions(state.players.ochre.deck.hand)).toEqual(['muster','gold']);
    expect(definitions(state.players.ochre.deck.discard)).toEqual(['silver']);
    state = playCard(state, 'muster'); expect(definitions(state.players.ochre.deck.hand)).toEqual(['gold','copper','silver']); assertInvariants(state);
  });
  it('Reclaim never offers a recover-nothing action when discard is nonempty', () => {
    let state = ready(); isolateHand(state, 'ochre', ['reclaim']); setDiscard(state, 'ochre', ['gold','silver']); state = playCard(state,'reclaim');
    expect(listLegalActions(state).map((entry) => entry.command)).toEqual([
      { type:'resolveRecover', recoverInstanceId:state.players.ochre.deck.discard[0]!.id },
      { type:'resolveRecover', recoverInstanceId:state.players.ochre.deck.discard[1]!.id }
    ]);
  });
  it('Reclaim with one discarded card creates one mandatory recovery', () => {
    let state = ready(); isolateHand(state, 'ochre', ['reclaim']); setDiscard(state, 'ochre', ['gold']); state = playCard(state,'reclaim');
    expect(state.players.ochre.deck.hand).toEqual([]); expect(state.pendingChoice).toEqual({ type:'recover', playerId:'ochre', remaining:1 });
    state = applyAction(state,listLegalActions(state)[0]!.id); expect(definitions(state.players.ochre.deck.hand)).toEqual(['gold']); assertInvariants(state);
  });
  it('Reclaim with an empty discard pile after the draw resolves immediately', () => {
    let state = ready(); isolateHand(state, 'ochre', ['reclaim']); setDraw(state, 'ochre', ['copper']);
    state = playCard(state, 'reclaim');
    expect(definitions(state.players.ochre.deck.hand)).toEqual(['copper']); expect(state.pendingChoice).toBeNull();
    expect(listLegalActions(state).some((entry) => entry.command.type === 'endActionPhase')).toBe(true); assertInvariants(state);
  });
  it('Adapt draws 1 without movement and 2 after the acting fighter moved', () => {
    function adaptDraws(prepare: (state: GameState) => GameState, hand: string[]): number {
      let state = ready(); state.fighters.indigo.position = 3; isolateHand(state, 'ochre', [...hand, 'adapt']); setDraw(state, 'ochre', ['copper', 'copper', 'copper', 'copper']);
      state = prepare(state); const before = state.players.ochre.deck.hand.length;
      state = playCard(state, 'adapt'); assertInvariants(state);
      return state.players.ochre.deck.hand.length - (before - 1);
    }
    expect(adaptDraws((state) => state, [])).toBe(1);
    expect(adaptDraws((state) => playCard(state, 'footwork', (command) => command.type === 'playFootwork' && command.movement === 'left'), ['footwork'])).toBe(2);
    expect(adaptDraws((state) => playCard(state, 'footwork', (command) => command.type === 'playFootwork' && command.movement === 'stay'), ['footwork'])).toBe(1);
    expect(adaptDraws((state) => playCard(state, 'drive', (command) => command.type === 'playDrive' && command.direction === 'right'), ['drive'])).toBe(2);
    expect(adaptDraws((state) => {
      state.fighters.ochre.position = 6; state.fighters.indigo.position = 6;
      return playCard(state, 'drive', (command) => command.type === 'playDrive' && command.direction === 'right');
    }, ['drive'])).toBe(1);
    expect(adaptDraws((state) => {
      const moved = playCard(state, 'footwork', (command) => command.type === 'playFootwork' && command.movement === 'left');
      return playCard(moved, 'footwork', (command) => command.type === 'playFootwork' && command.movement === 'right');
    }, ['footwork', 'footwork'])).toBe(2);
  });
  it('Drive never sets the pushed opponent position flag, and the flag resets between a player own turns', () => {
    let state = ready(); state.fighters.indigo.position = 3; isolateHand(state, 'ochre', ['drive']); isolateHand(state, 'indigo', []);
    state = playCard(state, 'drive', (command) => command.type === 'playDrive' && command.direction === 'right');
    expect(state.players.ochre.positionChanged).toBe(true); expect(state.players.indigo.positionChanged).toBe(false);
    expect(state.turnState.spacesMoved).toBe(1);
    state = endTurn(state);
    isolateHand(state, 'indigo', ['adapt']); setDraw(state, 'indigo', ['copper', 'copper']);
    state = playCard(state, 'adapt'); expect(definitions(state.players.indigo.deck.hand)).toEqual(['copper']);
    state = endTurn(state);
    expect(state.players.ochre.positionChanged).toBe(false);
    isolateHand(state, 'ochre', ['adapt']); setDraw(state, 'ochre', ['copper', 'copper']);
    state = playCard(state, 'adapt'); expect(definitions(state.players.ochre.deck.hand)).toEqual(['copper']); assertInvariants(state);
  });
});

describe('attacks', () => {
  it('Heavy Blow deals 6 at Close and gains the persistent Feint bonus at Close', () => {
    let state = ready(); state.fighters.indigo.position = 3; isolateHand(state, 'ochre', ['heavyBlow']);
    state = playCard(state, 'heavyBlow'); expect(state.fighters.indigo.health).toBe(34); assertInvariants(state);
    state = ready(); state.fighters.indigo.position = 3; state.fighters.indigo.exposed = true; isolateHand(state, 'ochre', ['heavyBlow']);
    state = playCard(state, 'heavyBlow'); expect(state.fighters.indigo.health).toBe(33); expect(state.fighters.indigo.exposed).toBe(true);
    for (const position of [4, 6]) {
      const near = ready(); near.fighters.indigo.position = position; isolateHand(near, 'ochre', ['heavyBlow']);
      expect(availability(near, 'heavyBlow')).toMatchObject({ enabled: false, reasonCode: 'NEEDS_CLOSE' });
    }
  });
  it('Steady Shot deals 2 at Near and Far and is illegal at Close', () => {
    expect(cardDefinition('steadyShot').cost).toBe(3);
    for (const position of [4, 6]) {
      let state = ready(); state.fighters.indigo.position = position; isolateHand(state, 'ochre', ['steadyShot']);
      state = playCard(state, 'steadyShot'); expect(state.fighters.indigo.health).toBe(38); expect(state.players.ochre.deck.hand).toEqual([]); assertInvariants(state);
    }
    const close = ready(); close.fighters.indigo.position = 3; isolateHand(close, 'ochre', ['steadyShot']);
    expect(availability(close, 'steadyShot')).toMatchObject({ enabled: false, reasonCode: 'NEEDS_NEAR_OR_FAR' });
  });
  it('Step moves and Strike attacks at Close range', () => {
    let state = ready(); isolateHand(state, 'ochre', ['step']); setDraw(state, 'ochre', ['gold']);
    state = playCard(state, 'step', (command) => command.type === 'playMoveAction' && command.direction === 'right');
    expect(state.fighters.ochre.position).toBe(4); expect(state.players.ochre.deck.hand).toEqual([]); assertInvariants(state);

    state = ready(); state.fighters.indigo.position = 3; isolateHand(state, 'ochre', ['strike']);
    state = playCard(state, 'strike'); expect(state.fighters.indigo.health).toBe(37);
    const strikeFar = ready(); strikeFar.fighters.indigo.position = 6; isolateHand(strikeFar, 'ochre', ['strike']);
    expect(availability(strikeFar, 'strike')).toMatchObject({ enabled: false, reasonCode: 'NEEDS_CLOSE' });

  });
  it('Repelling Shot damages and moves the opponent farther away', () => {
    expect(cardDefinition('repellingShot')).toMatchObject({ cost: 3, values: { near: 1, far: 2 } });
    expect(isTacticalAction('repellingShot')).toBe(true);
    let state = ready(); isolateHand(state, 'ochre', ['repellingShot']);
    state = playCard(state, 'repellingShot');
    expect(state.fighters.ochre.position).toBe(3); expect(state.fighters.indigo.position).toBe(5);
    expect(state.fighters.indigo.health).toBe(39); expect(state.players.indigo.positionChanged).toBe(false);
    expect(state.events.slice(-2).map((event) => event.type)).toEqual(['damage', 'move']);
    assertInvariants(state);
  });
  it('Repelling Shot moves the attacker when the opponent is blocked by a wall', () => {
    let state = ready(); state.fighters.indigo.position = 6; isolateHand(state, 'ochre', ['repellingShot']);
    state = playCard(state, 'repellingShot');
    expect(state.fighters.ochre.position).toBe(2); expect(state.fighters.indigo.position).toBe(6);
    expect(state.fighters.indigo.health).toBe(38); expect(state.players.ochre.positionChanged).toBe(true);
    expect(state.turnState.spacesMoved).toBe(1);
    assertInvariants(state);
  });
  it('Repelling Shot moves neither fighter when both are blocked by walls', () => {
    let state = ready(); state.fighters.ochre.position = 1; state.fighters.indigo.position = 6;
    isolateHand(state, 'ochre', ['repellingShot']);
    state = playCard(state, 'repellingShot');
    expect(state.fighters.ochre.position).toBe(1); expect(state.fighters.indigo.position).toBe(6);
    expect(state.fighters.indigo.health).toBe(38); expect(state.events.at(-1)?.type).toBe('damage');
    expect(state.turnState.spacesMoved).toBe(0);
    assertInvariants(state);
  });
  it('Repelling Shot is illegal at Close and consumes Aimed when played at range', () => {
    const close = ready(); close.fighters.indigo.position = 3; isolateHand(close, 'ochre', ['repellingShot']);
    expect(availability(close, 'repellingShot')).toMatchObject({ enabled: false, reasonCode: 'NEEDS_NEAR_OR_FAR' });
    let aimed = ready(); aimed.fighters.ochre.aimed = true; isolateHand(aimed, 'ochre', ['repellingShot']);
    aimed = playCard(aimed, 'repellingShot');
    expect(aimed.fighters.ochre.aimed).toBe(false); expect(aimed.fighters.indigo.health).toBe(37);
  });
  it('a spell leaves Exposed alone while Close attacks use it without consuming it', () => {
    let spell = ready(); spell.fighters.indigo.position = 3; spell.fighters.indigo.exposed = true; spell.players.ochre.mana = 1; isolateHand(spell, 'ochre', ['arcBolt']);
    spell = playCard(spell, 'arcBolt'); expect(spell.fighters.indigo.health).toBe(36); expect(spell.fighters.indigo.exposed).toBe(true);
    let melee = ready(); melee.fighters.indigo.position = 3; melee.fighters.indigo.exposed = true; isolateHand(melee, 'ochre', ['strike']);
    melee = playCard(melee, 'strike'); expect(melee.fighters.indigo.health).toBe(36); expect(melee.fighters.indigo.exposed).toBe(true);
  });
  it('Opening Strike deals 4 after setup and 1 after an earlier attack', () => {
    let setup = ready(); setup.fighters.indigo.position = 3; isolateHand(setup, 'ochre', ['focus', 'openingStrike']);
    setup = playCard(setup, 'focus'); setup = playCard(setup, 'openingStrike');
    expect(setup.fighters.indigo.health).toBe(36);

    let attacked = ready(); attacked.fighters.indigo.position = 3; isolateHand(attacked, 'ochre', ['strike', 'openingStrike']);
    attacked = playCard(attacked, 'strike'); attacked = playCard(attacked, 'openingStrike');
    expect(attacked.fighters.indigo.health).toBe(36);
  });
});

describe('mage cards', () => {
  it('Focus is always available, costs 1, and gains 1 mana without drawing', () => {
    expect(cardDefinition('focus').cost).toBe(1);
    let state = ready(); isolateHand(state, 'ochre', ['focus']); setDraw(state, 'ochre', ['gold']);
    state = playCard(state, 'focus');
    expect(state.players.ochre.mana).toBe(1);
    expect(state.players.ochre.deck.hand).toEqual([]);
    expect(state.players.ochre.deck.draw.map((card) => card.definitionId)).toEqual(['gold']);
    assertInvariants(state);
  });
  it('allows current-turn mana above 3, then persists at most 3 mana after the turn', () => {
    let state = ready(); isolateHand(state, 'ochre', ['focus', 'focus', 'focus', 'focus']); state.players.indigo.mana = 2;
    for (let count = 0; count < 4; count += 1) state = playCard(state, 'focus');
    expect(state.players.ochre.mana).toBe(4); expect(state.players.indigo.mana).toBe(2);

    state = applyAction(state, action(state, (command) => command.type === 'endActionPhase').id);
    expect(state.players.ochre.mana).toBe(4);
    state = applyAction(state, action(state, (command) => command.type === 'endBuyPhase').id);
    expect(state.players.ochre.mana).toBe(3); expect(state.players.indigo.mana).toBe(2);
    state = endTurn(state);
    expect(state.activePlayerId).toBe('ochre'); expect(state.players.ochre.mana).toBe(3); assertInvariants(state);
  });
  it('Ley Step moves exactly one space, gains mana, and offers no move into a wall', () => {
    expect(cardDefinition('leyStep').cost).toBe(3);
    let state = ready(); state.fighters.ochre.position = 2; isolateHand(state, 'ochre', ['leyStep', 'leyStep']);
    state = playCard(state, 'leyStep', (command) => command.type === 'playMoveAction' && command.direction === 'left');
    expect(state.fighters.ochre.position).toBe(1); expect(state.players.ochre.mana).toBe(2); assertInvariants(state);
    expect(availability(state, 'leyStep')).toMatchObject({ selection: 'direction', movements: ['right'] });
    expect(listLegalActions(state).filter((entry) => entry.command.type === 'playMoveAction')).toHaveLength(1);
  });
  it('Ley Step gains 1 mana at Near and 2 mana at Far after moving', () => {
    let near = ready(); near.fighters.indigo.position = 4; isolateHand(near, 'ochre', ['leyStep']);
    near = playCard(near, 'leyStep', (command) => command.type === 'playMoveAction' && command.direction === 'right');
    expect(near.fighters.ochre.position).toBe(4); expect(near.players.ochre.mana).toBe(1);

    let far = ready(); far.fighters.indigo.position = 4; isolateHand(far, 'ochre', ['leyStep']);
    far = playCard(far, 'leyStep', (command) => command.type === 'playMoveAction' && command.direction === 'left');
    expect(far.fighters.ochre.position).toBe(2); expect(far.players.ochre.mana).toBe(2);
  });

  it('Prism gains 2 mana, draws, and discards exactly the chosen card', () => {
    let state = ready(); isolateHand(state, 'ochre', ['prism', 'muster']); setDraw(state, 'ochre', ['gold']);
    state = playCard(state, 'prism');
    expect(state.players.ochre.mana).toBe(2); expect(definitions(state.players.ochre.deck.hand)).toEqual(['muster', 'gold']);
    expect(state.pendingChoice).toEqual({ type: 'discard', playerId: 'ochre', remaining: 1 });
    const gold = state.players.ochre.deck.hand.find((card) => card.definitionId === 'gold')!;
    state = applyAction(state, action(state, (command) => command.type === 'resolveDiscard' && command.discardInstanceId === gold.id).id);
    expect(state.pendingChoice).toBeNull(); expect(definitions(state.players.ochre.deck.hand)).toEqual(['muster']); expect(definitions(state.players.ochre.deck.discard)).toEqual(['gold']);
    assertInvariants(state);
  });
  it('Prism with an empty hand after its draw resolves immediately', () => {
    let state = ready(); isolateHand(state, 'ochre', ['prism']);
    state = playCard(state, 'prism');
    expect(state.players.ochre.mana).toBe(2); expect(state.players.ochre.deck.hand).toEqual([]); expect(state.pendingChoice).toBeNull(); assertInvariants(state);
  });
  it('a pending choice suppresses every other action, including End Action phase', () => {
    let state = ready(); isolateHand(state, 'ochre', ['prism', 'muster']); setDraw(state, 'ochre', ['gold']);
    state = playCard(state, 'prism');
    const legal = listLegalActions(state);
    expect(legal.every((entry) => entry.command.type === 'resolveDiscard')).toBe(true);
    expect(legal).toHaveLength(2);
    expect(availability(state, 'muster')).toMatchObject({ enabled: false, reasonCode: 'RESOLVE_CHOICE_FIRST', selection: 'discard' });
  });
  it('Overload deals 3 damage per mana spent this turn', () => {
    expect(cardDefinition('overload')).toMatchObject({ cost: 5, values: { perManaSpent: 3 } });
    let state = ready(); state.players.ochre.mana = 1; isolateHand(state, 'ochre', ['arcBolt', 'overload']);
    state = playCard(state, 'arcBolt'); state = playCard(state, 'overload');
    expect(state.turnState.manaSpent).toBe(1); expect(state.fighters.indigo.health).toBe(33);
  });
  it('uses the approved Volley and Bull Rush costs and damage', () => {
    expect(cardDefinition('volley')).toMatchObject({ cost: 5, values: { near: 2, far: 4 } });
    expect(cardDefinition('bullRush')).toMatchObject({ cost: 3, values: { damage: 7 } });
  });
  it('spells spend their mana cost and are illegal without it', () => {
    for (const [definitionId, mana, damage] of [['arcBolt', 1, 4], ['fireball', 2, 8], ['starfire', 3, 12]] as const) {
      for (const position of [2, 3, 5]) {
        let state = ready(); state.fighters.indigo.position = position; state.players.ochre.mana = mana; isolateHand(state, 'ochre', [definitionId]);
        state = playCard(state, definitionId);
        expect(state.fighters.indigo.health).toBe(40 - damage); expect(state.players.ochre.mana).toBe(0); assertInvariants(state);
      }
      const short = ready(); short.players.ochre.mana = mana - 1; isolateHand(short, 'ochre', [definitionId]);
      expect(availability(short, definitionId)).toMatchObject({ enabled: false, reasonCode: 'NEEDS_MANA' });
    }
  });
});

describe('batch integrity', () => {
  const PLAYABLE: readonly { id: string; position: number; mana: number }[] = [
    { id: 'stipend', position: 3, mana: 0 }, { id: 'reclaim', position: 3, mana: 0 }, { id: 'adapt', position: 3, mana: 0 },
    { id: 'heavyBlow', position: 3, mana: 0 }, { id: 'steadyShot', position: 4, mana: 0 },
    { id: 'focus', position: 3, mana: 0 }, { id: 'channel', position: 3, mana: 0 },
    { id: 'leyStep', position: 3, mana: 0 }, { id: 'prism', position: 3, mana: 0 },
    { id: 'arcBolt', position: 3, mana: 1 }, { id: 'fireball', position: 3, mana: 2 }, { id: 'starfire', position: 3, mana: 3 },
    { id: 'step', position: 3, mana: 0 }, { id: 'strike', position: 3, mana: 0 },
    { id: 'repellingShot', position: 4, mana: 0 }
  ];
  it('every card in the batch resolves into a valid state', () => {
    for (const entry of PLAYABLE) {
      let state = ready(); state.fighters.indigo.position = entry.position; state.players.ochre.mana = entry.mana;
      isolateHand(state, 'ochre', [entry.id]); setDraw(state, 'ochre', ['copper', 'copper']);
      state = playCard(state, entry.id);
      while (state.pendingChoice) state = applyAction(state, listLegalActions(state)[0]!.id);
      expect(state.players.ochre.deck.play.map((card) => card.definitionId), entry.id).toEqual([entry.id]);
      expect(() => assertInvariants(state), entry.id).not.toThrow();
    }
  });
  it('replays each new command type to an independently written expected state', () => {
    const channel = ready(); isolateHand(channel, 'ochre', ['channel']); setDraw(channel, 'ochre', ['gold']);
    const played = replayCommands(channel, [{ type: 'playAction', cardInstanceId: handCard(channel, 'ochre', 'channel') }]);
    expect(definitions(played.players.ochre.deck.hand)).toEqual(['gold']); expect(definitions(played.players.ochre.deck.play)).toEqual(['channel']);
    expect(played.players.ochre.deck.draw).toEqual([]); expect(played.players.ochre.mana).toBe(1); expect(played.turnState.cardsPlayed).toEqual(['channel']);
    expect(played.events.slice(-3).map((event) => event.type)).toEqual(['cardPlayed', 'mana', 'draw']);

    const step = ready(); isolateHand(step, 'ochre', ['step']);
    const moved = replayCommands(step, [{ type: 'playMoveAction', cardInstanceId: handCard(step, 'ochre', 'step'), direction: 'right' }]);
    expect(moved.fighters.ochre.position).toBe(4); expect(moved.players.ochre.positionChanged).toBe(true);
    expect(moved.players.ochre.deck.hand).toEqual([]); expect(definitions(moved.players.ochre.deck.play)).toEqual(['step']);
    expect(moved.events.slice(-2).map((event) => event.type)).toEqual(['cardPlayed', 'move']);

    const prism = ready(); isolateHand(prism, 'ochre', ['prism']); setDraw(prism, 'ochre', ['gold']);
    const prismCommands: GameCommand[] = [{ type: 'playAction', cardInstanceId: handCard(prism, 'ochre', 'prism') }];
    const drew = replayCommands(prism, prismCommands);
    const discarded = replayCommands(prism, [...prismCommands, { type: 'resolveDiscard', discardInstanceId: handCard(drew, 'ochre', 'gold') }]);
    expect(discarded.players.ochre.mana).toBe(2); expect(discarded.players.ochre.deck.hand).toEqual([]);
    expect(definitions(discarded.players.ochre.deck.discard)).toEqual(['gold']); expect(discarded.pendingChoice).toBeNull();

    const reclaim = ready(); isolateHand(reclaim, 'ochre', ['reclaim']); setDraw(reclaim, 'ochre', ['copper']); setDiscard(reclaim, 'ochre', ['gold']);
    const recovered = replayCommands(reclaim, [
      { type: 'playAction', cardInstanceId: handCard(reclaim, 'ochre', 'reclaim') },
      { type: 'resolveRecover', recoverInstanceId: reclaim.players.ochre.deck.discard[0]!.id }
    ]);
    expect(definitions(recovered.players.ochre.deck.hand)).toEqual(['gold']); expect(definitions(recovered.players.ochre.deck.draw)).toEqual(['copper']);
    expect(recovered.players.ochre.deck.discard).toEqual([]); expect(definitions(recovered.players.ochre.deck.play)).toEqual(['reclaim']);
  });
});
