import { describe, expect, it } from 'vitest';
import {
  CARDS, applyAction, applyCommand, assertInvariants, createCard, createGame, listActionAvailability,
  listLegalActions, rangeBand, replayCommands, submitStartingBuild, DEFAULT_KINGDOM_ID, kingdomOf
} from '../src/game';
import type { GameCommand, GameState, PlayerId } from '../src/game';
import { gameCommandSchema } from '../src/server/schemas';

function ready(seed = 1, first: PlayerId = 'ochre', ochre: string[] = [], indigo: string[] = []): GameState {
  let state = createGame({ seed, firstPlayerId: first }); state = submitStartingBuild(state, 'ochre', ochre); return submitStartingBuild(state, 'indigo', indigo);
}
function action(state: GameState, predicate: (command: GameCommand) => boolean) {
  const found = listLegalActions(state).find((candidate) => predicate(candidate.command));
  if (!found) throw new Error(`Missing action: ${JSON.stringify(listLegalActions(state))}`); return found;
}
function play(state: GameState, type: GameCommand['type']): GameState { return applyAction(state, action(state, (command) => command.type === type).id); }
function isolateHand(state: GameState, playerId: PlayerId, definitions: string[]): void {
  const deck = state.players[playerId].deck; state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play);
  deck.draw = []; deck.hand = definitions.map((id) => createCard(state, id)); deck.discard = []; deck.play = [];
}
function setDraw(state: GameState, playerId: PlayerId, definitions: string[]): void {
  state.players[playerId].deck.draw = definitions.map((id) => createCard(state, id));
}

describe('starting build', () => {
  it('creates no physical cards or draws before both hidden builds complete', () => {
    let state = createGame({ seed: 7, firstPlayerId: 'indigo' }); expect(state.phase).toBe('startingBuild'); expect(state.nextCardSerial).toBe(1);
    state = submitStartingBuild(state, 'ochre', ['footwork', 'aim', 'volley']);
    expect(state.activePlayerId).toBe('indigo'); expect(state.players.ochre.deck.hand).toEqual([]); expect(state.nextCardSerial).toBe(1);
    state = submitStartingBuild(state, 'indigo', ['footwork', 'feint', 'drive']);
    expect(state.phase).toBe('action'); expect(state.activePlayerId).toBe('indigo'); expect(state.turn).toBe(1);
    expect(state.players.ochre.firstBuyMoney).toBe(1); expect(state.players.indigo.firstBuyMoney).toBe(2);
    expect(state.players.ochre.deck.hand).toHaveLength(5); expect(state.players.indigo.deck.hand).toHaveLength(5);
    expect(state.nextCardSerial).toBe(21); expect(state.fighters.ochre).toMatchObject({ position: 2, health: 40 }); expect(state.fighters.indigo).toMatchObject({ position: 3, health: 37 });
    assertInvariants(state);
  });
  it('creates instances, shuffles, and draws in the exact approved player order', () => {
    let state = createGame({ seed: 7, firstPlayerId: 'ochre' }); state = submitStartingBuild(state, 'ochre', ['aim', 'volley']); state = submitStartingBuild(state, 'indigo', ['feint', 'drive']);
    expect(state.nextCardSerial).toBe(19); expect(state.rngState).toBe(3338981911); expect(state.players.ochre.deck.hand.map((card) => [card.id, card.definitionId])).toEqual([['card-9', 'volley'], ['card-7', 'copper'], ['card-2', 'copper'], ['card-4', 'copper'], ['card-1', 'copper']]);
    expect(state.players.indigo.deck.hand.map((card) => [card.id, card.definitionId])).toEqual([['card-18', 'drive'], ['card-15', 'copper'], ['card-11', 'copper'], ['card-14', 'copper'], ['card-12', 'copper']]); expect(state.fighters).toEqual({ ochre: { playerId: 'ochre', position: 2, health: 37, aimed: false, exposed: false }, indigo: { playerId: 'indigo', position: 3, health: 40, aimed: false, exposed: false } });
  });
  it('accepts no paid cards, repeats, and free Copper but rejects bad builds', () => {
    const initial = createGame({ seed: 2 }); expect(submitStartingBuild(initial, 'ochre', []).players.ochre.startingBuild).toEqual([]);
    expect(() => submitStartingBuild(createGame({ seed: 2 }), 'ochre', ['gold', 'gold', 'copper', 'copper'])).not.toThrow();
    expect(() => submitStartingBuild(createGame({ seed: 2 }), 'ochre', ['gold', 'gold', 'silver'])).toThrow('more than 12');
    expect(() => submitStartingBuild(createGame({ seed: 2 }), 'ochre', ['missing'])).toThrow('Unknown card');
  });
  it('removes Vault from card data, market piles, and starting builds', () => {
    expect(CARDS.vault).toBeUndefined(); expect(kingdomOf(DEFAULT_KINGDOM_ID).actionPiles.map((pile) => pile.cardId)).not.toContain('vault');
    expect(() => submitStartingBuild(createGame({ seed: 2 }), 'ochre', ['vault'])).toThrow('Unknown card definition: vault');
  });
  it('replays setup and deterministic shuffle exactly', () => {
    const initial = createGame({ seed: 99, firstPlayerId: 'ochre' }); const commands: GameCommand[] = [
      { type: 'submitStartingBuild', playerId: 'ochre', definitionIds: ['aim', 'volley'] },
      { type: 'submitStartingBuild', playerId: 'indigo', definitionIds: ['feint', 'drive'] }
    ];
    const direct = commands.reduce((state, command) => applyCommand(state, command), initial); expect(replayCommands(initial, commands)).toEqual(direct);
  });
});

describe('arena and movement', () => {
  it('derives Close, Near, and Far for every position pair, including shared spaces', () => {
    const state = ready();
    for (let left = 1; left <= 5; left += 1) for (let right = 1; right <= 5; right += 1) {
      state.fighters.ochre.position = left; state.fighters.indigo.position = right; const difference = Math.abs(left - right);
      expect(rangeBand(state)).toBe(difference === 0 ? 'Close' : difference === 1 ? 'Near' : 'Far');
      expect(() => assertInvariants(state)).not.toThrow();
    }
  });
  it('Footwork can stay or move through occupied spaces, always draws, and keeps Stay at walls', () => {
    let state = ready(); isolateHand(state, 'ochre', ['footwork']); setDraw(state, 'ochre', ['aim']);
    state = applyAction(state, action(state, (command) => command.type === 'playFootwork' && command.movement === 'stay').id);
    expect(state.fighters.ochre.position).toBe(2); expect(state.fighters.indigo.position).toBe(3); expect(rangeBand(state)).toBe('Near'); expect(state.players.ochre.deck.hand.map((card) => card.definitionId)).toEqual(['aim']);
    isolateHand(state, 'ochre', ['footwork']); state = applyAction(state, action(state, (command) => command.type === 'playFootwork' && command.movement === 'right').id);
    expect(state.fighters.ochre.position).toBe(3); expect(state.fighters.indigo.position).toBe(3); expect(rangeBand(state)).toBe('Close');
    isolateHand(state, 'ochre', ['footwork']); state = applyAction(state, action(state, (command) => command.type === 'playFootwork' && command.movement === 'right').id);
    expect(state.fighters.ochre.position).toBe(4); expect(state.fighters.indigo.position).toBe(3); expect(rangeBand(state)).toBe('Near');
    state.fighters.ochre.position = 1; isolateHand(state, 'ochre', ['footwork']); expect(listActionAvailability(state, 'ochre')[0]).toMatchObject({ movements: ['stay', 'right'] });
    state.fighters.ochre.position = 5; expect(listActionAvailability(state, 'ochre')[0]).toMatchObject({ movements: ['left', 'stay'] });
  });
});

describe('cards and conditions', () => {
  it('Cull can trash itself alone, one remaining hand card, or two remaining hand cards', () => {
    let state = ready(); isolateHand(state, 'ochre', ['cull']); const self = state.players.ochre.deck.hand[0]!;
    expect(listActionAvailability(state, 'ochre')[0]).toMatchObject({ enabled: true, reasonCode: null, selection: 'trashOneOrTwo', eligibleCardInstanceIds: [self.id] });
    state = applyAction(state, action(state, (command) => command.type === 'playCull' && command.trashInstanceIds.length === 1 && command.trashInstanceIds[0] === self.id).id);
    expect(state.trash.at(-1)?.definitionId).toBe('cull'); expect(state.actionsThisTurn).toHaveLength(1);

    state = ready(); isolateHand(state, 'ochre', ['cull', 'copper']); const [cull, copper] = state.players.ochre.deck.hand;
    state = applyAction(state, action(state, (command) => command.type === 'playCull' && command.trashInstanceIds.length === 1 && command.trashInstanceIds[0] === copper!.id).id);
    expect(state.players.ochre.deck.play.map((card) => card.id)).toContain(cull!.id); expect(state.trash.at(-1)?.definitionId).toBe('copper');

    state = ready(); isolateHand(state, 'ochre', ['cull', 'copper', 'silver']); const [playedCull, first, second] = state.players.ochre.deck.hand;
    state = applyAction(state, action(state, (command) => command.type === 'playCull' && command.trashInstanceIds.includes(first!.id) && command.trashInstanceIds.includes(second!.id)).id);
    expect(state.players.ochre.deck.play.map((card) => card.id)).toContain(playedCull!.id); expect(state.trash.slice(-2).map((card) => card.definitionId).sort()).toEqual(['copper', 'silver']);
  });
  it('Muster draws across a reshuffle and stops when only one card exists', () => {
    let state = ready(); isolateHand(state, 'ochre', ['muster']); state.players.ochre.deck.discard.push(createCard(state, 'copper'), createCard(state, 'aim'));
    state = play(state, 'playMuster'); expect(state.players.ochre.deck.hand.map((card) => card.definitionId).sort()).toEqual(['aim', 'copper']);
    state = ready(); isolateHand(state, 'ochre', ['muster']); state.players.ochre.deck.discard.push(createCard(state, 'volley')); state = play(state, 'playMuster'); expect(state.players.ochre.deck.hand.map((card) => card.definitionId)).toEqual(['volley']);
  });
  it('Footwork draws across a reshuffle boundary', () => {
    let state = ready(); isolateHand(state, 'ochre', ['footwork']); state.players.ochre.deck.discard.push(createCard(state, 'aim')); state = applyAction(state, action(state, (command) => command.type === 'playFootwork' && command.movement === 'left').id); expect(state.players.ochre.deck.hand.map((card) => card.definitionId)).toEqual(['aim']);
  });
  it('Cull accepts one or two schema targets but rejects zero, duplicates, three, missing, and already-played targets', () => {
    let state = ready(); isolateHand(state, 'ochre', ['cull', 'copper', 'silver', 'muster']); const [cull, copper, silver, muster] = state.players.ochre.deck.hand;
    expect(gameCommandSchema.safeParse({ type: 'playCull', cardInstanceId: cull!.id, trashInstanceIds: [copper!.id] }).success).toBe(true);
    expect(gameCommandSchema.safeParse({ type: 'playCull', cardInstanceId: cull!.id, trashInstanceIds: [copper!.id, silver!.id] }).success).toBe(true);
    expect(gameCommandSchema.safeParse({ type: 'playCull', cardInstanceId: cull!.id, trashInstanceIds: [] }).success).toBe(false);
    const invalid = [
      { type: 'playCull', cardInstanceId: cull!.id, trashInstanceIds: [] },
      { type: 'playCull', cardInstanceId: cull!.id, trashInstanceIds: [copper!.id, copper!.id] },
      { type: 'playCull', cardInstanceId: cull!.id, trashInstanceIds: [copper!.id, silver!.id, muster!.id] },
      { type: 'playCull', cardInstanceId: cull!.id, trashInstanceIds: [copper!.id, 'missing-id'] }
    ];
    for (const command of invalid) expect(() => applyCommand(state, command as unknown as GameCommand)).toThrow('Illegal command');
    state = applyAction(state, action(state, (command) => command.type === 'playMuster').id); expect(() => applyCommand(state, { type: 'playCull', cardInstanceId: cull!.id, trashInstanceIds: [copper!.id, muster!.id] })).toThrow('Illegal command');
  });
  it('Feint reapplies without stacking, while Drive moves both fighters or collides with a wall', () => {
    let state = ready(); state.fighters.ochre.position = 3; state.fighters.indigo.position = 3; isolateHand(state, 'ochre', ['feint', 'feint', 'drive']);
    state = play(state, 'playFeint'); state = play(state, 'playFeint'); expect(state.fighters.indigo.exposed).toBe(true);
    state = applyAction(state, action(state, (command) => command.type === 'playDrive' && command.direction === 'left').id);
    expect(state.fighters.indigo.health).toBe(36); expect(state.fighters.indigo.position).toBe(2); expect(state.fighters.ochre.position).toBe(2); expect(rangeBand(state)).toBe('Close'); expect(state.fighters.indigo.exposed).toBe(false);
    expect(state.events.at(-1)).toMatchObject({ type: 'move', detail: { movement: 'left', from: 3, to: 2, fighters: ['ochre', 'indigo'], source: 'drive' } });
    state.fighters.ochre.position = 1; state.fighters.indigo.position = 1; isolateHand(state, 'ochre', ['feint', 'drive']); state = play(state, 'playFeint'); state = applyAction(state, action(state, (command) => command.type === 'playDrive' && command.direction === 'left').id);
    expect(state.fighters.indigo.health).toBe(30); expect(state.fighters.indigo.position).toBe(1); expect(state.fighters.ochre.position).toBe(1); expect(state.events.some((event) => event.type === 'wallCollision' && event.detail.direction === 'left')).toBe(true);
  });
  it('Drive victory clamps at zero and stops before push', () => {
    let state = ready(); state.fighters.ochre.position = 3; state.fighters.indigo.position = 3; state.fighters.indigo.health = 1; isolateHand(state, 'ochre', ['drive']);
    state = play(state, 'playDrive'); expect(state.fighters.indigo.health).toBe(0); expect(state.winner).toBe('ochre'); expect(state.phase).toBe('ended'); expect(state.fighters.indigo.position).toBe(3);
  });
  it('Flurry needs Close, consumes Exposed, and counts only other Tactical Actions', () => {
    for (const position of [3, 5]) {
      const state = ready(); state.fighters.ochre.position = 2; state.fighters.indigo.position = position; isolateHand(state, 'ochre', ['flurry']);
      expect(listActionAvailability(state, 'ochre')[0]).toMatchObject({ enabled: false, reasonCode: 'NEEDS_CLOSE' });
    }
    let state = ready(); state.fighters.indigo.position = 2; isolateHand(state, 'ochre', ['flurry']); state.fighters.indigo.exposed = true;
    state = play(state, 'playFlurry'); expect(state.fighters.indigo.health).toBe(38);

    state = ready(); state.fighters.indigo.position = 2; isolateHand(state, 'ochre', ['channel', 'muster', 'flurry']);
    state = play(state, 'playAction'); state = play(state, 'playMuster'); state = play(state, 'playFlurry'); expect(state.fighters.indigo.health).toBe(40);

    state = ready(); isolateHand(state, 'ochre', ['aim', 'footwork', 'flurry']);
    state = play(state, 'playAim'); state = applyAction(state, action(state, (command) => command.type === 'playFootwork' && command.movement === 'right').id);
    expect(rangeBand(state)).toBe('Close'); state = play(state, 'playFlurry'); expect(state.fighters.indigo.health).toBe(38);
  });
  it('Flurry counts an earlier Flurry, never itself, and caps at 5', () => {
    let state = ready(); state.fighters.indigo.position = 2; isolateHand(state, 'ochre', ['footwork', 'flurry', 'flurry']);
    state = applyAction(state, action(state, (command) => command.type === 'playFootwork' && command.movement === 'stay').id);
    state = play(state, 'playFlurry'); expect(state.fighters.indigo.health).toBe(39);
    state = play(state, 'playFlurry'); expect(state.fighters.indigo.health).toBe(37);

    state = ready(); state.fighters.indigo.position = 2; isolateHand(state, 'ochre', ['footwork', 'footwork', 'footwork', 'footwork', 'footwork', 'footwork', 'flurry']);
    for (let index = 0; index < 6; index += 1) state = applyAction(state, action(state, (command) => command.type === 'playFootwork' && command.movement === 'stay').id);
    state = play(state, 'playFlurry'); expect(state.fighters.indigo.health).toBe(35);
  });
  it('Aim draws and refreshes, while Volley resolves literal Near and Far damage', () => {
    for (const test of [
      { enemy: 3, aimed: false, damage: 1 }, { enemy: 5, aimed: false, damage: 4 },
      { enemy: 3, aimed: true, damage: 4 }, { enemy: 5, aimed: true, damage: 5 }
    ]) {
      let state = ready(); state.fighters.ochre.position = 2; state.fighters.indigo.position = test.enemy; isolateHand(state, 'ochre', test.aimed ? ['aim', 'aim', 'volley'] : ['volley']);
      if (test.aimed) { state = play(state, 'playAim'); state = play(state, 'playAim'); expect(state.fighters.ochre.aimed).toBe(true); }
      state = play(state, 'playVolley'); expect(state.fighters.indigo.health).toBe(40 - test.damage); expect(state.fighters.ochre.aimed).toBe(false);
    }
    const close = ready(); close.fighters.ochre.position = 2; close.fighters.indigo.position = 2; isolateHand(close, 'ochre', ['aim', 'volley']); expect(listActionAvailability(close, 'ochre').map((item) => item.reasonCode)).toEqual(['NEEDS_NEAR_OR_FAR', 'NEEDS_NEAR_OR_FAR']);
  });
});

describe('complete turns and purchases', () => {
  it('keeps control through actions, auto-plays Treasure, buys several cards, and cleans up', () => {
    let state = ready(1, 'ochre', [], []); state.fighters.indigo.position = 2; isolateHand(state, 'ochre', ['copper', 'silver', 'gold', 'flurry']);
    state = play(state, 'playFlurry'); expect(state.activePlayerId).toBe('ochre'); state = play(state, 'endActionPhase');
    expect(state.phase).toBe('buy'); expect(state.players.ochre.money).toBe(9);
    state = applyAction(state, action(state, (command) => command.type === 'buyCard' && command.definitionId === 'muster').id);
    state = applyAction(state, action(state, (command) => command.type === 'buyCard' && command.definitionId === 'silver').id);
    state = applyAction(state, action(state, (command) => command.type === 'buyCard' && command.definitionId === 'copper').id);
    expect(state.phase).toBe('buy'); expect(state.players.ochre.money).toBe(1); expect(state.supply.muster).toBe(9);
    state.fighters.ochre.aimed = true; state.fighters.indigo.exposed = true; state = play(state, 'endBuyPhase');
    expect(state.activePlayerId).toBe('indigo'); expect(state.phase).toBe('action'); expect(state.players.ochre.money).toBe(0); expect(state.fighters.ochre.aimed).toBe(false); expect(state.fighters.indigo.exposed).toBe(false);
    expect(state.players.ochre.deck.hand).toHaveLength(5); assertInvariants(state);
  });
  it('depletes the 10th Action but never base Treasures', () => {
    let state = ready(); state.phase = 'buy'; state.players.ochre.money = 100;
    for (let count = 0; count < 10; count += 1) state = applyAction(state, action(state, (command) => command.type === 'buyCard' && command.definitionId === 'footwork').id);
    expect(state.supply.footwork).toBe(0); expect(listLegalActions(state).some((candidate) => candidate.command.type === 'buyCard' && candidate.command.definitionId === 'footwork')).toBe(false);
    for (const definitionId of ['copper', 'silver', 'gold']) { state = applyAction(state, action(state, (command) => command.type === 'buyCard' && command.definitionId === definitionId).id); }
    expect(state.players.ochre.purchases.slice(-3)).toEqual(['copper', 'silver', 'gold']);
  });
  it('keeps Aimed and Exposed through Buy actions and expires them exactly at Buy completion', () => {
    let exposed = ready(); exposed.fighters.ochre.position = 2; exposed.fighters.indigo.position = 2; isolateHand(exposed, 'ochre', ['feint']); exposed = play(exposed, 'playFeint'); exposed = play(exposed, 'endActionPhase'); expect(exposed.fighters.indigo.exposed).toBe(true); exposed = applyAction(exposed, action(exposed, (command) => command.type === 'buyCard' && command.definitionId === 'copper').id); expect(exposed.fighters.indigo.exposed).toBe(true); exposed = play(exposed, 'endBuyPhase'); expect(exposed.fighters.indigo.exposed).toBe(false);
    let aimed = ready(); isolateHand(aimed, 'ochre', ['aim']); aimed = play(aimed, 'playAim'); aimed = play(aimed, 'endActionPhase'); expect(aimed.fighters.ochre.aimed).toBe(true); aimed = play(aimed, 'endBuyPhase'); expect(aimed.fighters.ochre.aimed).toBe(false);
  });
  it('keeps replay equivalent after every representative command', () => {
    let state = ready(14); isolateHand(state, 'ochre', ['aim', 'volley', 'copper']); const initial = structuredClone(state); const commands: GameCommand[] = [];
    for (const choose of [
      (candidate: GameCommand) => candidate.type === 'playAim',
      (candidate: GameCommand) => candidate.type === 'playVolley',
      (candidate: GameCommand) => candidate.type === 'endActionPhase',
      (candidate: GameCommand) => candidate.type === 'buyCard' && candidate.definitionId === 'copper',
      (candidate: GameCommand) => candidate.type === 'endBuyPhase'
    ]) {
      const command = action(state, choose).command; commands.push(command); state = applyCommand(state, command); expect(replayCommands(initial, commands)).toEqual(state);
    }
  });
  it('expires carried money after the first Buy phase and supports buying nothing', () => {
    let state = ready(); isolateHand(state, 'ochre', []); state = play(state, 'endActionPhase'); expect(state.players.ochre.money).toBe(3);
    state = play(state, 'endBuyPhase'); expect(state.players.ochre.firstBuyPending).toBe(false); expect(state.players.ochre.firstBuyMoney).toBe(0);
  });
  it('expires normal money and alternates four complete local turns exactly once', () => {
    let state = ready(); isolateHand(state, 'ochre', ['gold']); isolateHand(state, 'indigo', []); state.players.ochre.firstBuyPending = false; state.players.ochre.firstBuyMoney = 0; state.players.indigo.firstBuyPending = false; state.players.indigo.firstBuyMoney = 0;
    state = play(state, 'endActionPhase'); expect(state.players.ochre.money).toBe(3); state = play(state, 'endBuyPhase'); expect(state.players.ochre.money).toBe(0); expect([state.turn, state.activePlayerId]).toEqual([2, 'indigo']);
    state = play(state, 'endActionPhase'); state = play(state, 'endBuyPhase'); expect([state.turn, state.activePlayerId]).toEqual([3, 'ochre']);
    state = play(state, 'endActionPhase'); expect(state.players.ochre.money).toBe(3); state = play(state, 'endBuyPhase'); expect([state.turn, state.activePlayerId]).toEqual([4, 'indigo']);
  });
  it('keeps three bought Gold cards as Gold and each provides three money', () => {
    let state = ready(); isolateHand(state, 'ochre', []); state.phase = 'buy'; state.players.ochre.money = 18; state.players.ochre.firstBuyPending = false;
    for (let count = 0; count < 3; count += 1) state = applyAction(state, action(state, (command) => command.type === 'buyCard' && command.definitionId === 'gold').id);
    expect(state.players.ochre.money).toBe(0); expect(state.players.ochre.deck.discard.map((card) => card.definitionId)).toEqual(['gold', 'gold', 'gold']); expect(CARDS.gold?.money).toBe(3);
    state = play(state, 'endBuyPhase'); expect(state.players.ochre.deck.hand.map((card) => card.definitionId)).toEqual(['gold', 'gold', 'gold']);
  });
});
