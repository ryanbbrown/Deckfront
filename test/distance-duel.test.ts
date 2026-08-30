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
  it('pins card serials, RNG state, and player draw order', () => {
    let state = createGame({ seed: 7, firstPlayerId: 'ochre' });
    state = submitStartingBuild(state, 'ochre', ['aim', 'volley']);
    state = submitStartingBuild(state, 'indigo', ['feint', 'drive']);
    expect(state.nextCardSerial).toBe(19);
    expect(state.rngState).toBe(3338981911);
    expect(state.players.ochre.deck.hand.map((card) => [card.id, card.definitionId])).toEqual([
      ['card-9', 'volley'], ['card-7', 'copper'], ['card-2', 'copper'], ['card-4', 'copper'], ['card-1', 'copper']
    ]);
    expect(state.players.indigo.deck.hand.map((card) => [card.id, card.definitionId])).toEqual([
      ['card-18', 'drive'], ['card-15', 'copper'], ['card-11', 'copper'], ['card-14', 'copper'], ['card-12', 'copper']
    ]);
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
    for (let left = 1; left <= 6; left += 1) for (let right = 1; right <= 6; right += 1) {
      state.fighters.ochre.position = left; state.fighters.indigo.position = right; const difference = Math.abs(left - right);
      expect(rangeBand(state)).toBe(difference === 0 ? 'Close' : difference === 1 ? 'Near' : 'Far');
      expect(() => assertInvariants(state)).not.toThrow();
    }
  });
  it('Footwork can stay or move through occupied spaces, always draws, and keeps Stay at walls', () => {
    let state = ready(); isolateHand(state, 'ochre', ['footwork']); setDraw(state, 'ochre', ['aim']);
    state = applyAction(state, action(state, (command) => command.type === 'playFootwork' && command.movement === 'stay').id);
    expect(state.fighters.ochre.position).toBe(3); expect(state.fighters.indigo.position).toBe(4); expect(rangeBand(state)).toBe('Near'); expect(state.players.ochre.deck.hand.map((card) => card.definitionId)).toEqual(['aim']);
    isolateHand(state, 'ochre', ['footwork']); state = applyAction(state, action(state, (command) => command.type === 'playFootwork' && command.movement === 'right').id);
    expect(state.fighters.ochre.position).toBe(4); expect(state.fighters.indigo.position).toBe(4); expect(rangeBand(state)).toBe('Close');
    isolateHand(state, 'ochre', ['footwork']); state = applyAction(state, action(state, (command) => command.type === 'playFootwork' && command.movement === 'right').id);
    expect(state.fighters.ochre.position).toBe(5); expect(state.fighters.indigo.position).toBe(4); expect(rangeBand(state)).toBe('Near');
    state.fighters.ochre.position = 1; isolateHand(state, 'ochre', ['footwork']); expect(listActionAvailability(state, 'ochre')[0]).toMatchObject({ movements: ['stay', 'right'] });
    state.fighters.ochre.position = 6; expect(listActionAvailability(state, 'ochre')[0]).toMatchObject({ movements: ['left', 'stay'] });
  });
});

describe('cards and conditions', () => {
  it('Cull can trash itself alone, one remaining hand card, or two remaining hand cards', () => {
    let state = ready(); isolateHand(state, 'ochre', ['cull']); const self = state.players.ochre.deck.hand[0]!;
    expect(listActionAvailability(state, 'ochre')[0]).toMatchObject({ enabled: true, reasonCode: null, selection: 'targets', eligibleCardInstanceIds: [self.id] });
    state = applyAction(state, action(state, (command) => command.type === 'playTargetedAction' && command.targetCardInstanceIds.length === 1 && command.targetCardInstanceIds[0] === self.id).id);
    expect(state.trash.at(-1)?.definitionId).toBe('cull'); expect(state.turnState.cardsPlayed).toHaveLength(1);

    state = ready(); isolateHand(state, 'ochre', ['cull', 'copper']); const [cull, copper] = state.players.ochre.deck.hand;
    state = applyAction(state, action(state, (command) => command.type === 'playTargetedAction' && command.targetCardInstanceIds.length === 1 && command.targetCardInstanceIds[0] === copper!.id).id);
    expect(state.players.ochre.deck.play.map((card) => card.id)).toContain(cull!.id); expect(state.trash.at(-1)?.definitionId).toBe('copper');

    state = ready(); isolateHand(state, 'ochre', ['cull', 'copper', 'silver']); const [playedCull, first, second] = state.players.ochre.deck.hand;
    state = applyAction(state, action(state, (command) => command.type === 'playTargetedAction' && command.targetCardInstanceIds.includes(first!.id) && command.targetCardInstanceIds.includes(second!.id)).id);
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
    expect(gameCommandSchema.safeParse({ type: 'playTargetedAction', cardInstanceId: cull!.id, targetCardInstanceIds: [copper!.id] }).success).toBe(true);
    expect(gameCommandSchema.safeParse({ type: 'playTargetedAction', cardInstanceId: cull!.id, targetCardInstanceIds: [copper!.id, silver!.id] }).success).toBe(true);
    expect(gameCommandSchema.safeParse({ type: 'playTargetedAction', cardInstanceId: cull!.id, targetCardInstanceIds: [] }).success).toBe(true);
    const invalid = [
      { type: 'playTargetedAction', cardInstanceId: cull!.id, targetCardInstanceIds: [] },
      { type: 'playTargetedAction', cardInstanceId: cull!.id, targetCardInstanceIds: [copper!.id, copper!.id] },
      { type: 'playTargetedAction', cardInstanceId: cull!.id, targetCardInstanceIds: [copper!.id, silver!.id, muster!.id] },
      { type: 'playTargetedAction', cardInstanceId: cull!.id, targetCardInstanceIds: [copper!.id, 'missing-id'] }
    ];
    for (const command of invalid) expect(() => applyCommand(state, command as unknown as GameCommand)).toThrow('Illegal command');
    state = applyAction(state, action(state, (command) => command.type === 'playMuster').id); expect(() => applyCommand(state, { type: 'playTargetedAction', cardInstanceId: cull!.id, targetCardInstanceIds: [copper!.id, muster!.id] })).toThrow('Illegal command');
  });
  it('Drive victory clamps at zero and stops before push', () => {
    let state = ready(); state.fighters.ochre.position = 3; state.fighters.indigo.position = 3; state.fighters.indigo.health = 1; isolateHand(state, 'ochre', ['drive']);
    state = play(state, 'playDrive'); expect(state.fighters.indigo.health).toBe(0); expect(state.winner).toBe('ochre'); expect(state.phase).toBe('ended'); expect(state.fighters.indigo.position).toBe(3);
  });
});

describe('complete turns and purchases', () => {
  it('keeps control through actions, auto-plays Treasure, buys several cards, and cleans up', () => {
    let state = ready(1, 'ochre', [], []); state.fighters.indigo.position = 3; isolateHand(state, 'ochre', ['copper', 'silver', 'gold', 'flurry']);
    state = play(state, 'playFlurry'); expect(state.activePlayerId).toBe('ochre'); state = play(state, 'endActionPhase');
    expect(state.phase).toBe('buy'); expect(state.players.ochre.money).toBe(9);
    state = applyAction(state, action(state, (command) => command.type === 'buyCard' && command.definitionId === 'feint').id);
    state = applyAction(state, action(state, (command) => command.type === 'buyCard' && command.definitionId === 'silver').id);
    state = applyAction(state, action(state, (command) => command.type === 'buyCard' && command.definitionId === 'copper').id);
    expect(state.phase).toBe('buy'); expect(state.players.ochre.money).toBe(1); expect(state.supply.feint).toBe(9);
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
