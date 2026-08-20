import { describe, expect, it } from 'vitest';
import {
  applyAction, assertInvariants, createCard, createGame, listActionAvailability,
  listLegalActions, replayCommands, submitStartingBuild
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
  it('Reclaim draws, offers the discard pile, and puts the chosen card on top of the deck', () => {
    let state = ready(); isolateHand(state, 'ochre', ['reclaim', 'muster']); setDraw(state, 'ochre', ['copper']); setDiscard(state, 'ochre', ['gold', 'silver']);
    state = playCard(state, 'reclaim');
    expect(definitions(state.players.ochre.deck.hand)).toEqual(['muster', 'copper']);
    expect(state.pendingChoice).toEqual({ type: 'recover', playerId: 'ochre', remaining: 1 });
    const gold = state.players.ochre.deck.discard.find((card) => card.definitionId === 'gold')!;
    state = applyAction(state, action(state, (command) => command.type === 'resolveRecover' && command.recoverInstanceId === gold.id).id);
    expect(state.pendingChoice).toBeNull(); expect(definitions(state.players.ochre.deck.draw)).toEqual(['gold']); expect(definitions(state.players.ochre.deck.discard)).toEqual(['silver']);
    state = playCard(state, 'muster'); expect(definitions(state.players.ochre.deck.hand)).toEqual(['copper', 'gold', 'silver']); assertInvariants(state);
  });
  it('Reclaim that recovers nothing leaves the discard pile unchanged', () => {
    let state = ready(); isolateHand(state, 'ochre', ['reclaim']); setDraw(state, 'ochre', ['copper']); setDiscard(state, 'ochre', ['gold', 'silver']);
    state = playCard(state, 'reclaim');
    state = applyAction(state, action(state, (command) => command.type === 'resolveRecover' && command.recoverInstanceId === null).id);
    expect(state.pendingChoice).toBeNull(); expect(definitions(state.players.ochre.deck.discard)).toEqual(['gold', 'silver']); expect(state.players.ochre.deck.draw).toEqual([]);
    assertInvariants(state);
  });
  it('Reclaim reshuffles an empty draw pile and then offers the emptied discard pile', () => {
    let state = ready(); isolateHand(state, 'ochre', ['reclaim']); setDiscard(state, 'ochre', ['gold']);
    state = playCard(state, 'reclaim');
    expect(definitions(state.players.ochre.deck.hand)).toEqual(['gold']); expect(state.players.ochre.deck.discard).toEqual([]);
    expect(state.pendingChoice).toBeNull(); assertInvariants(state);
  });
  it('Reclaim with an empty discard pile after the draw resolves immediately', () => {
    let state = ready(); isolateHand(state, 'ochre', ['reclaim']); setDraw(state, 'ochre', ['copper']);
    state = playCard(state, 'reclaim');
    expect(definitions(state.players.ochre.deck.hand)).toEqual(['copper']); expect(state.pendingChoice).toBeNull();
    expect(listLegalActions(state).some((entry) => entry.command.type === 'endActionPhase')).toBe(true); assertInvariants(state);
  });
  it('Adapt draws 1 without movement and 2 after the acting fighter moved', () => {
    function adaptDraws(prepare: (state: GameState) => GameState, hand: string[]): number {
      let state = ready(); state.fighters.indigo.position = 2; isolateHand(state, 'ochre', [...hand, 'adapt']); setDraw(state, 'ochre', ['copper', 'copper', 'copper', 'copper']);
      state = prepare(state); const before = state.players.ochre.deck.hand.length;
      state = playCard(state, 'adapt'); assertInvariants(state);
      return state.players.ochre.deck.hand.length - (before - 1);
    }
    expect(adaptDraws((state) => state, [])).toBe(1);
    expect(adaptDraws((state) => playCard(state, 'footwork', (command) => command.type === 'playFootwork' && command.movement === 'left'), ['footwork'])).toBe(2);
    expect(adaptDraws((state) => playCard(state, 'footwork', (command) => command.type === 'playFootwork' && command.movement === 'stay'), ['footwork'])).toBe(1);
    expect(adaptDraws((state) => playCard(state, 'drive', (command) => command.type === 'playDrive' && command.direction === 'right'), ['drive'])).toBe(2);
    expect(adaptDraws((state) => {
      state.fighters.ochre.position = 5; state.fighters.indigo.position = 5;
      return playCard(state, 'drive', (command) => command.type === 'playDrive' && command.direction === 'right');
    }, ['drive'])).toBe(1);
    expect(adaptDraws((state) => {
      const moved = playCard(state, 'footwork', (command) => command.type === 'playFootwork' && command.movement === 'left');
      return playCard(moved, 'footwork', (command) => command.type === 'playFootwork' && command.movement === 'right');
    }, ['footwork', 'footwork'])).toBe(2);
  });
  it('Drive never sets the pushed opponent position flag, and the flag resets between a player own turns', () => {
    let state = ready(); state.fighters.indigo.position = 2; isolateHand(state, 'ochre', ['drive']); isolateHand(state, 'indigo', []);
    state = playCard(state, 'drive', (command) => command.type === 'playDrive' && command.direction === 'right');
    expect(state.players.ochre.positionChanged).toBe(true); expect(state.players.indigo.positionChanged).toBe(false);
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
  it('Heavy Blow deals 4 at Close, 6 into Exposed, and is illegal at Near or Far', () => {
    let state = ready(); state.fighters.indigo.position = 2; isolateHand(state, 'ochre', ['heavyBlow']);
    state = playCard(state, 'heavyBlow'); expect(state.fighters.indigo.health).toBe(36); assertInvariants(state);
    state = ready(); state.fighters.indigo.position = 2; state.fighters.indigo.exposed = true; isolateHand(state, 'ochre', ['heavyBlow']);
    state = playCard(state, 'heavyBlow'); expect(state.fighters.indigo.health).toBe(34); expect(state.fighters.indigo.exposed).toBe(false);
    for (const position of [3, 5]) {
      const near = ready(); near.fighters.indigo.position = position; isolateHand(near, 'ochre', ['heavyBlow']);
      expect(availability(near, 'heavyBlow')).toMatchObject({ enabled: false, reasonCode: 'NEEDS_CLOSE' });
    }
  });
  it('Quick Shot deals 1 and draws 1 at range, is illegal at Close, and skips its draw on a win', () => {
    for (const position of [3, 5]) {
      let state = ready(); state.fighters.indigo.position = position; isolateHand(state, 'ochre', ['quickShot']); setDraw(state, 'ochre', ['gold']);
      state = playCard(state, 'quickShot');
      expect(state.fighters.indigo.health).toBe(39); expect(definitions(state.players.ochre.deck.hand)).toEqual(['gold']); assertInvariants(state);
    }
    const close = ready(); close.fighters.indigo.position = 2; isolateHand(close, 'ochre', ['quickShot']);
    expect(availability(close, 'quickShot')).toMatchObject({ enabled: false, reasonCode: 'NEEDS_NEAR_OR_FAR' });
    let lethal = ready(); lethal.fighters.indigo.health = 1; isolateHand(lethal, 'ochre', ['quickShot']); setDraw(lethal, 'ochre', ['gold']);
    lethal = playCard(lethal, 'quickShot');
    expect(lethal.winner).toBe('ochre'); expect(lethal.players.ochre.deck.hand).toEqual([]); assertInvariants(lethal);
  });
  it('Steady Shot deals 3 at Near and Far and is illegal at Close', () => {
    for (const position of [3, 5]) {
      let state = ready(); state.fighters.indigo.position = position; isolateHand(state, 'ochre', ['steadyShot']);
      state = playCard(state, 'steadyShot'); expect(state.fighters.indigo.health).toBe(38); expect(state.players.ochre.deck.hand).toEqual([]); assertInvariants(state);
    }
    const close = ready(); close.fighters.indigo.position = 2; isolateHand(close, 'ochre', ['steadyShot']);
    expect(availability(close, 'steadyShot')).toMatchObject({ enabled: false, reasonCode: 'NEEDS_NEAR_OR_FAR' });
  });
  it('Step, Strike, and Shot carry the always-available row rules', () => {
    let state = ready(); isolateHand(state, 'ochre', ['step']); setDraw(state, 'ochre', ['gold']);
    state = playCard(state, 'step', (command) => command.type === 'playMoveAction' && command.direction === 'right');
    expect(state.fighters.ochre.position).toBe(3); expect(state.players.ochre.deck.hand).toEqual([]); assertInvariants(state);

    state = ready(); state.fighters.indigo.position = 2; isolateHand(state, 'ochre', ['strike']);
    state = playCard(state, 'strike'); expect(state.fighters.indigo.health).toBe(38);
    const strikeFar = ready(); strikeFar.fighters.indigo.position = 5; isolateHand(strikeFar, 'ochre', ['strike']);
    expect(availability(strikeFar, 'strike')).toMatchObject({ enabled: false, reasonCode: 'NEEDS_CLOSE' });

    for (const position of [3, 5]) {
      let shot = ready(); shot.fighters.indigo.position = position; isolateHand(shot, 'ochre', ['shot']);
      shot = playCard(shot, 'shot'); expect(shot.fighters.indigo.health).toBe(38);
    }
    const shotClose = ready(); shotClose.fighters.indigo.position = 2; isolateHand(shotClose, 'ochre', ['shot']);
    expect(availability(shotClose, 'shot')).toMatchObject({ enabled: false, reasonCode: 'NEEDS_NEAR_OR_FAR' });
  });
  it('a spell leaves Exposed alone while a melee attack consumes it', () => {
    let spell = ready(); spell.fighters.indigo.position = 2; spell.fighters.indigo.exposed = true; spell.players.ochre.mana = 1; isolateHand(spell, 'ochre', ['arcBolt']);
    spell = playCard(spell, 'arcBolt'); expect(spell.fighters.indigo.health).toBe(37); expect(spell.fighters.indigo.exposed).toBe(true);
    let melee = ready(); melee.fighters.indigo.position = 2; melee.fighters.indigo.exposed = true; isolateHand(melee, 'ochre', ['strike']);
    melee = playCard(melee, 'strike'); expect(melee.fighters.indigo.health).toBe(36); expect(melee.fighters.indigo.exposed).toBe(false);
  });
});

describe('mage cards', () => {
  it('Channel gains 1 mana per player and the Action phase reset touches only the player who ended it', () => {
    let state = ready(); isolateHand(state, 'ochre', ['channel']); setDraw(state, 'ochre', ['gold']); state.players.indigo.mana = 2;
    state = playCard(state, 'channel');
    expect(state.players.ochre.mana).toBe(1); expect(state.players.indigo.mana).toBe(2); expect(definitions(state.players.ochre.deck.hand)).toEqual(['gold']);
    state = applyAction(state, action(state, (command) => command.type === 'endActionPhase').id);
    expect(state.players.ochre.mana).toBe(0); expect(state.players.indigo.mana).toBe(2); assertInvariants(state);
  });
  it('Ley Step moves exactly one space, gains mana, and offers no move into a wall', () => {
    let state = ready(); isolateHand(state, 'ochre', ['leyStep', 'leyStep']);
    state = playCard(state, 'leyStep', (command) => command.type === 'playMoveAction' && command.direction === 'left');
    expect(state.fighters.ochre.position).toBe(1); expect(state.players.ochre.mana).toBe(1); assertInvariants(state);
    expect(availability(state, 'leyStep')).toMatchObject({ selection: 'direction', movements: ['right'] });
    expect(listLegalActions(state).filter((entry) => entry.command.type === 'playMoveAction')).toHaveLength(1);
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
  it('spells spend their mana cost and are illegal without it', () => {
    for (const [definitionId, mana, damage] of [['arcBolt', 1, 3], ['fireball', 2, 6], ['starfire', 3, 9]] as const) {
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
    { id: 'heavyBlow', position: 2, mana: 0 }, { id: 'quickShot', position: 3, mana: 0 }, { id: 'steadyShot', position: 3, mana: 0 },
    { id: 'channel', position: 3, mana: 0 }, { id: 'leyStep', position: 3, mana: 0 }, { id: 'prism', position: 3, mana: 0 },
    { id: 'arcBolt', position: 3, mana: 1 }, { id: 'fireball', position: 3, mana: 2 }, { id: 'starfire', position: 3, mana: 3 },
    { id: 'step', position: 3, mana: 0 }, { id: 'strike', position: 2, mana: 0 }, { id: 'shot', position: 3, mana: 0 }
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
    expect(played.players.ochre.deck.draw).toEqual([]); expect(played.players.ochre.mana).toBe(1); expect(played.actionsThisTurn).toEqual(['channel']);
    expect(played.events.slice(-3).map((event) => event.type)).toEqual(['cardPlayed', 'mana', 'draw']);

    const step = ready(); isolateHand(step, 'ochre', ['step']);
    const moved = replayCommands(step, [{ type: 'playMoveAction', cardInstanceId: handCard(step, 'ochre', 'step'), direction: 'right' }]);
    expect(moved.fighters.ochre.position).toBe(3); expect(moved.players.ochre.positionChanged).toBe(true);
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
    expect(definitions(recovered.players.ochre.deck.hand)).toEqual(['copper']); expect(definitions(recovered.players.ochre.deck.draw)).toEqual(['gold']);
    expect(recovered.players.ochre.deck.discard).toEqual([]); expect(definitions(recovered.players.ochre.deck.play)).toEqual(['reclaim']);
  });
});
