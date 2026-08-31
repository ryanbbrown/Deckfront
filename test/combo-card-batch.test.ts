import { describe, expect, it } from 'vitest';
import {
  ALWAYS_AVAILABLE_ACTION_IDS, CARDS, EFFECTS, TACTICAL_ACTIONS, VARIABLE_ACTION_IDS, applyAction, applyCommand,
  cardDefinition, createCard, createGame, kingdomMarket, kingdomOf, listLegalActions, registerKingdom, replayCommands, submitStartingBuild
} from '../src/game';
import type { GameState, LegalAction } from '../src/game';
import { gameStateSchema } from '../src/server/schemas';
import { rulesFingerprint } from '../src/sim/rulesFingerprint';
import { runSimulationMatch } from '../src/sim/simulationKernel';
import { fixedBuyPlan } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';

function ready(): GameState {
  let state = createGame({ seed: 9 });
  state = submitStartingBuild(state, 'ochre', []);
  state = submitStartingBuild(state, 'indigo', []);
  state.fighters.ochre.health = 40; state.fighters.indigo.health = 40;
  return state;
}
function hand(state: GameState, ids: string[]): void {
  state.players[state.activePlayerId].deck.hand = ids.map((id) => createCard(state, id));
  state.players[state.activePlayerId].deck.draw = [];
}
function action(state: GameState, definitionId: string, targets?: string[]): LegalAction {
  const card = state.players[state.activePlayerId].deck.hand.find((candidate) => candidate.definitionId === definitionId)!;
  const found = listLegalActions(state).find((candidate) => 'cardInstanceId' in candidate.command
    && candidate.command.cardInstanceId === card.id
    && (targets === undefined || candidate.command.type === 'playTargetedAction'
      && targets.length === candidate.command.targetCardInstanceIds.length
      && targets.every((id) => candidate.command.type === 'playTargetedAction' && candidate.command.targetCardInstanceIds.includes(id))));
  if (!found) throw new Error(`No action for ${definitionId}`);
  return found;
}
function play(state: GameState, definitionId: string, targets?: string[]): GameState { return applyAction(state, action(state, definitionId, targets).id); }

describe('combo card batch', () => {
  it('loads every specified card and classifies exactly the Tactical Actions', () => {
    expect(Object.keys(CARDS)).toHaveLength(46);
    const expected = ['step','footwork','leyStep','feint','jab','strike','drive','heavyBlow','openingStrike','rally','bullRush','flurry','aim','pepperingShot','steadyShot','repellingShot','longshot','volley','salvageShot','precisionShot','arcBolt','fireball','starfire','discharge','cascade','overload','discipline','improvise','scrap'].sort();
    expect([...TACTICAL_ACTIONS].sort()).toEqual(expected);
    expect(Object.values(CARDS).filter((card) => EFFECTS[card.mechanic].tactical).map((card) => card.id).sort()).toEqual(expected);
  });

  it('uses the approved fixed piles and curated kingdoms', () => {
    expect(ALWAYS_AVAILABLE_ACTION_IDS).toEqual(['step', 'focus']);
    expect(VARIABLE_ACTION_IDS).toContain('cull'); expect(VARIABLE_ACTION_IDS).not.toContain('scrap');
    for (const id of ['distance-duel','current-duel','three-way-open','three-way-engine','range-rich-mixed']) {
      const piles = kingdomOf(id).actionPiles.map((pile) => pile.cardId);
      expect(piles).toHaveLength(10); expect(piles).toContain('cull'); expect(piles).not.toContain('scrap');
    }
  });

  it('starts draft-off immediately with 7 Copper and 3 Scrap and no carry', () => {
    const state = createGame({ seed: 4, firstPlayerId: 'indigo', startingDraftEnabled: false });
    expect(state).toMatchObject({ phase: 'action', turn: 1, activePlayerId: 'indigo', startingDraftEnabled: false });
    for (const player of Object.values(state.players)) {
      const ids = [...player.deck.hand, ...player.deck.draw].map((card) => card.definitionId);
      expect(ids.filter((id) => id === 'copper')).toHaveLength(7); expect(ids.filter((id) => id === 'scrap')).toHaveLength(3);
      expect(player).toMatchObject({ startingBuild: null, firstBuyMoney: 0, firstBuyPending: false });
    }
    expect(kingdomMarket(state.kingdomId).map((card) => card.id)).not.toContain('scrap');
    expect(state.supply.scrap).toBeUndefined();
    expect(gameStateSchema.parse(state)).toEqual(state);
  });

  it('tracks spell, copy, family, mana-spend, and movement counters and resets them', () => {
    let state = ready(); state.players.ochre.mana = 2; hand(state, ['arcBolt', 'attune', 'leyStep']);
    state = play(state, 'arcBolt'); state = play(state, 'attune'); state = play(state, 'leyStep');
    expect(state.turnState).toMatchObject({ cardsPlayed: ['arcBolt','attune','leyStep'], manaSpent: 1, spellsPlayed: 1, spacesMoved: 1 });
    expect(state.turnState.copiesPlayed).toEqual({ arcBolt: 1, attune: 1, leyStep: 1 });
    expect(state.turnState.familiesPlayed).toEqual(['mana']);
    state = applyAction(state, listLegalActions(state).find((a) => a.command.type === 'endActionPhase')!.id);
    state = applyAction(state, listLegalActions(state).find((a) => a.command.type === 'endBuyPhase')!.id);
    expect(state.turnState).toEqual({ cardsPlayed: [], spacesMoved: 0, manaSpent: 0, spellsPlayed: 0, copiesPlayed: {}, familiesPlayed: [] });
  });

  it('uses resolved Feint and Aim bonus overrides', () => {
    registerKingdom({ id:'bonus-overrides', name:'Bonus overrides', startingHealth:40,
      actionPiles:['feint','strike','aim','steadyShot'].map((cardId) => ({ cardId, count:10 })),
      overrides:{ feint:{ values:{ bonus:3 } }, aim:{ values:{ bonus:5 } } } });
    const setup = (): GameState => {
      let state = createGame({ seed:2, kingdomId:'bonus-overrides' });
      state = submitStartingBuild(state,'ochre',[]); return submitStartingBuild(state,'indigo',[]);
    };
    let close = setup(); close.fighters.indigo.position = close.fighters.ochre.position; hand(close,['feint','strike']);
    close = play(close,'feint'); close = play(close,'strike'); expect(close.fighters.indigo.health).toBe(34);
    let ranged = setup(); hand(ranged,['aim','steadyShot']); ranged = play(ranged,'aim'); ranged = play(ranged,'steadyShot');
    expect(ranged.fighters.indigo.health).toBe(33);
  });

  it('applies persistent Feint and one-shot Aim through shared attack paths', () => {
    let state = ready(); state.fighters.ochre.position = state.fighters.indigo.position = 2; hand(state, ['feint','strike','rally']);
    state = play(state, 'feint'); state = play(state, 'strike'); state = play(state, 'rally');
    expect(state.fighters.indigo.health).toBe(33); expect(state.fighters.indigo.exposed).toBe(true);
    state = applyAction(state, listLegalActions(state).find((a) => a.command.type === 'endActionPhase')!.id);
    state = applyAction(state, listLegalActions(state).find((a) => a.command.type === 'endBuyPhase')!.id);
    expect(state.fighters.indigo.exposed).toBe(false);

    state = ready(); hand(state, ['aim','repellingShot','steadyShot']); state = play(state, 'aim'); state = play(state, 'repellingShot');
    expect(state.fighters.indigo.health).toBe(37); expect(state.fighters.ochre.aimBonus).toBe(0);
    state = play(state, 'steadyShot'); expect(state.fighters.indigo.health).toBe(35);
  });

  it('uses other-card boundaries for combos and replacement damage for Precision Shot', () => {
    let state = ready(); state.fighters.ochre.position = state.fighters.indigo.position = 2; hand(state, ['openingStrike','rally','rally','flurry']);
    state = play(state, 'openingStrike'); state = play(state, 'rally'); state = play(state, 'rally'); state = play(state, 'flurry');
    expect(state.fighters.indigo.health).toBe(27);
    state = ready(); hand(state, ['precisionShot','precisionShot']); state = play(state, 'precisionShot'); state = play(state, 'precisionShot');
    expect(state.fighters.indigo.health).toBe(34);
  });

  it('resolves mana and family combos', () => {
    let state = ready(); state.players.ochre.mana = 4; hand(state, ['arcBolt','cascade','overload','discharge']);
    state = play(state, 'arcBolt'); state = play(state, 'cascade'); state = play(state, 'overload'); state = play(state, 'discharge');
    expect(state.fighters.indigo.health).toBe(21); expect(state.players.ochre.mana).toBe(0); expect(state.turnState.manaSpent).toBe(2);
    state = ready(); hand(state, ['footwork','improvise']); state = play(state, 'footwork'); state = play(state, 'improvise');
    expect(state.fighters.indigo.health).toBe(40);
  });

  it('enforces family targets, self-trash, optional trash, and Reforge gain rules', () => {
    let state = ready(); state.fighters.ochre.position = state.fighters.indigo.position = 2; hand(state, ['bullRush','copper']);
    expect(listLegalActions(state).some((a) => 'cardInstanceId' in a.command && a.command.cardInstanceId === state.players.ochre.deck.hand[0]!.id)).toBe(false);
    state = ready(); hand(state,['salvageShot','copper']);
    expect(listLegalActions(state).some((a) => 'cardInstanceId' in a.command && a.command.cardInstanceId === state.players.ochre.deck.hand[0]!.id)).toBe(false);
    state = ready(); state.fighters.indigo.position = 3; hand(state, ['bullRush','strike']); const strike = state.players.ochre.deck.hand[1]!; state = play(state, 'bullRush', [strike.id]);
    expect(state.players.ochre.deck.discard).toContainEqual(strike); expect(state.fighters.indigo.health).toBe(33);

    state = ready(); hand(state, ['discipline']); const discipline = state.players.ochre.deck.hand[0]!; state = play(state, 'discipline', [discipline.id]);
    expect(state.trash).toContainEqual(discipline);

    state = ready(); hand(state, ['sharpen']); state.players.ochre.deck.draw = [createCard(state, 'gold')]; state = play(state, 'sharpen');
    expect(state.pendingChoice?.type).toBe('optionalTrash');
    state = applyAction(state, listLegalActions(state).find((a) => a.command.type === 'resolveOptionalTrash' && a.command.trashInstanceId === null)!.id);
    expect(state.pendingChoice).toBeNull();

    state = ready(); hand(state, ['reforge','gold']); const gold = state.players.ochre.deck.hand[1]!; state = play(state, 'reforge', [gold.id]);
    expect(state.pendingChoice).toMatchObject({ type: 'gain', maxCost: 9 });
    expect(listLegalActions(state).some((a) => a.command.type === 'resolveGain' && a.command.definitionId === 'scrap')).toBe(false);
    const supply = state.supply.cull; state = applyAction(state, listLegalActions(state).find((a) => a.command.type === 'resolveGain' && a.command.definitionId === 'cull')!.id);
    expect(state.supply.cull).toBe(supply! - 1); expect(state.players.ochre.purchases).toEqual([]);
  });

  it('moves Reclaim directly to hand and makes the choice mandatory', () => {
    let state = ready(); hand(state, ['reclaim']); const discarded = createCard(state, 'gold'); state.players.ochre.deck.discard = [discarded];
    state = play(state, 'reclaim'); const choices = listLegalActions(state);
    expect(choices).toHaveLength(1); expect(choices[0]!.command).toEqual({ type: 'resolveRecover', recoverInstanceId: discarded.id });
    state = applyAction(state, choices[0]!.id); expect(state.players.ochre.deck.hand).toContainEqual(discarded);
  });

  it('separates direct compact draft identities and rules fingerprints', () => {
    const strategy: Strategy = { id: 'simple', startingBuild: [], buyPlan: fixedBuyPlan([
      { kind: 'buy', cardId: 'silver', desiredCount: 99 }
    ]) };
    const base = { kingdomId: 'distance-duel', seed: 2, firstPlayerId: 'ochre' as const, swapSides: false, turnLimitPerPlayer: 1, actionCapPerTurn: 100, strategies: { ochre: strategy, indigo: strategy } };
    const on = runSimulationMatch({ ...base, startingDraftEnabled: true }); const off = runSimulationMatch({ ...base, startingDraftEnabled: false });
    expect(on.config.startingDraftEnabled).toBe(true); expect(off.config.startingDraftEnabled).toBe(false);
    expect(on.telemetry.startingBuild).toEqual({ ochre: [], indigo: [] }); expect(off.telemetry.startingBuild).toEqual({ ochre: [], indigo: [] });
    const fingerprint = rulesFingerprint('distance-duel');
    expect(fingerprint).toMatchObject({ version: 3, rules: { maximumCarriedMana: 2, manaUsableTurns: 'unlimited',
      simulationKernelProtocol: 'stacking-aim-v12', tacticalPilotProtocol: 'aim-stack-priority-v10' } });
    expect(rulesFingerprint('three-way-open').rules.tacticalPilotProtocol).toBe('first-attack-v9');
    expect(fingerprint.hash).not.toBe(rulesFingerprint('distance-duel', undefined, undefined, false).hash);
  });
});


describe('complete public card coverage', () => {
  // Feint is included because this set places every card that requires Close range, not only attacks.
  const closeRangeCards = new Set(['feint','jab','strike','drive','heavyBlow','openingStrike','rally','bullRush','flurry']);
  const manaGated = new Set(['arcBolt','fireball','starfire','cascade']);

  it.each(Object.values(CARDS).filter((card) => card.type === 'action').map((card) => card.id))(
    '%s resolves from a public legal action', (definitionId) => {
      let state = ready();
      state.fighters.ochre.position = 2; state.fighters.indigo.position = closeRangeCards.has(definitionId) ? 2 : 3;
      state.players.ochre.mana = manaGated.has(definitionId) ? 9 : definitionId === 'discharge' ? 3 : 0;
      const support = definitionId === 'bullRush' ? ['strike']
        : definitionId === 'salvageShot' ? ['steadyShot']
          : ['copper'];
      hand(state, [definitionId, ...support]);
      state.players.ochre.deck.draw = [createCard(state, 'gold'), createCard(state, 'silver'), createCard(state, 'copper')];
      if (definitionId === 'reclaim') state.players.ochre.deck.discard.push(createCard(state, 'gold'));
      const source = state.players.ochre.deck.hand[0]!;
      const legal = listLegalActions(state).filter((entry) => 'cardInstanceId' in entry.command && entry.command.cardInstanceId === source.id);
      expect(legal.length, definitionId).toBeGreaterThan(0);
      const selected = legal.find((entry) => entry.command.type === 'playTargetedAction'
        && entry.command.targetCardInstanceIds.includes(state.players.ochre.deck.hand[1]?.id ?? '')) ?? legal[0]!;
      state = applyAction(state, selected.id);
      while (state.pendingChoice && !state.winner) {
        const continuation = listLegalActions(state); expect(continuation.length, definitionId).toBeGreaterThan(0);
        const preferred = continuation.find((entry) => entry.command.type === 'resolveOptionalTrash' && entry.command.trashInstanceId === null)
          ?? continuation.find((entry) => entry.command.type === 'resolveGain' && entry.command.definitionId === 'copper') ?? continuation[0]!;
        state = applyAction(state, preferred.id);
      }
      expect(state.turnState.cardsPlayed, definitionId).toContain(definitionId);
      expect(() => gameStateSchema.parse(state), definitionId).not.toThrow();
    }
  );

  it('gates every Close, ranged, and mana-cost attack with literal reason codes', () => {
    for (const id of ['feint','jab','strike','drive','heavyBlow','openingStrike','rally','bullRush','flurry']) {
      const state = ready(); state.fighters.indigo.position = 4; hand(state, id === 'bullRush' ? [id,'strike'] : [id]);
      expect(listLegalActions(state).some((entry) => 'cardInstanceId' in entry.command)).toBe(false);
    }
    for (const id of ['aim','pepperingShot','steadyShot','repellingShot','longshot','volley','salvageShot','precisionShot']) {
      const state = ready(); state.fighters.indigo.position = 3; hand(state, id === 'salvageShot' ? [id,'steadyShot'] : [id]);
      expect(listLegalActions(state).some((entry) => 'cardInstanceId' in entry.command)).toBe(false);
    }
    for (const id of ['arcBolt','fireball','starfire','cascade']) {
      const state = ready(); state.players.ochre.mana = 0; hand(state,[id]);
      expect(listLegalActions(state).some((entry) => 'cardInstanceId' in entry.command)).toBe(false);
    }
  });

  it.each([
    ['jab',3],['strike',4],['drive',4],['heavyBlow',7],['openingStrike',5],['rally',3],['bullRush',8],['flurry',2]
  ] as const)('Feint routes persistent Close bonus through %s', (attackId, damage) => {
    let state = ready(); state.fighters.indigo.position = 3;
    hand(state,['feint',attackId,...(attackId === 'bullRush' ? ['strike'] : [])]); state = play(state,'feint');
    const source = state.players.ochre.deck.hand.find((card) => card.definitionId === attackId)!;
    const legal = listLegalActions(state).filter((entry) => 'cardInstanceId' in entry.command && entry.command.cardInstanceId === source.id);
    state = applyAction(state,legal[0]!.id);
    expect(state.fighters.indigo.health).toBe(40-damage); expect(state.fighters.indigo.exposed).toBe(true);
  });

  it.each(['pepperingShot','steadyShot','repellingShot','longshot','volley','salvageShot','precisionShot'])(
    'Aim adds exactly 2 once to %s', (attackId) => {
      const setup = (aimed: boolean): GameState => {
        let state = ready(); state.fighters.ochre.position = 2; state.fighters.indigo.position = 3;
        hand(state, [...(aimed ? ['aim'] : []), attackId, ...(attackId === 'salvageShot' ? ['steadyShot'] : [])]);
        if (aimed) state = play(state,'aim');
        const attack = state.players.ochre.deck.hand.find((card) => card.definitionId === attackId)!;
        const legal = listLegalActions(state).filter((entry) => 'cardInstanceId' in entry.command && entry.command.cardInstanceId === attack.id);
        return applyAction(state, legal.at(-1)!.id);
      };
      const plain = setup(false); const aimed = setup(true);
      expect(aimed.fighters.indigo.health).toBe(plain.fighters.indigo.health - 2);
      expect(aimed.fighters.ochre.aimBonus).toBe(0);
    }
  );

  it('does not draw after lethal Jab or Peppering Shot', () => {
    for (const [id, close] of [['jab',true],['pepperingShot',false]] as const) {
      let state = ready(); state.fighters.indigo.position = close ? 3 : 4; state.fighters.indigo.health = 1;
      hand(state,[id]); state.players.ochre.deck.draw = [createCard(state,'gold')]; state = play(state,id);
      expect(state.winner).toBe('ochre'); expect(state.players.ochre.deck.hand).toEqual([]);
      expect(state.players.ochre.deck.draw.map((card) => card.definitionId)).toEqual(['gold']);
    }
  });

  it('uses literal copy boundaries for Attune, Rally, and Precision Shot', () => {
    let state = ready(); hand(state,['attune','attune','attune']); state = play(state,'attune'); state = play(state,'attune'); state = play(state,'attune');
    expect(state.players.ochre.mana).toBe(6);
    state = ready(); state.fighters.indigo.position = 3; hand(state,['rally','rally','rally']); state = play(state,'rally'); state = play(state,'rally'); state = play(state,'rally');
    expect(state.fighters.indigo.health).toBe(28);
    state = ready(); hand(state,['precisionShot','precisionShot','precisionShot']); state = play(state,'precisionShot'); state = play(state,'precisionShot'); state = play(state,'precisionShot');
    expect(state.fighters.indigo.health).toBe(32);
  });

  it('uses literal Longshot distances and distinct Improvise families', () => {
    expect(cardDefinition('longshot').headline).toBe('Damage equal to distance');
    expect(cardDefinition('longshot').detail).toBeUndefined();
    for (const [position, damage] of [[3,1],[4,2],[5,3],[6,4]] as const) {
      let state = ready(); state.fighters.ochre.position = 2; state.fighters.indigo.position = position; hand(state,['longshot']); state = play(state,'longshot');
      expect(state.fighters.indigo.health).toBe(40-damage);
    }
    let state = ready(); hand(state,['channel','attune','footwork','improvise']); state = play(state,'channel'); state = play(state,'attune'); state = play(state,'footwork'); state = play(state,'improvise');
    expect(state.fighters.indigo.health).toBe(38);
    expect(cardDefinition('improvise').detail).toContain('Mana, Melee, or Ranged');
  });

  it('deals Scrap damage only for the first copy played each turn', () => {
    let state = ready(); hand(state, ['scrap', 'scrap', 'scrap']);
    state = play(state, 'scrap'); state = play(state, 'scrap'); state = play(state, 'scrap');
    expect(state.fighters.indigo.health).toBe(39);
    expect(state.turnState.copiesPlayed.scrap).toBe(3);
    expect(state.turnState.familiesPlayed).toContain('engine');
  });

  it('Scour trashes two selected Copper cards and draws one card per trash', () => {
    let state = ready(); hand(state,['scour','copper','copper','silver']);
    state.players.ochre.deck.draw = [createCard(state,'gold'),createCard(state,'footwork')];
    const coppers = state.players.ochre.deck.hand.filter((card) => card.definitionId === 'copper');
    state = play(state,'scour',coppers.map((card) => card.id));
    expect(state.trash.map((card) => card.definitionId)).toEqual(['copper','copper']);
    expect(state.players.ochre.deck.hand.map((card) => card.definitionId)).toEqual(['silver','gold','footwork']);
  });

  it('Scour can play with zero targets when no Copper is available', () => {
    let state = ready(); hand(state,['scour','silver']);
    state = play(state,'scour',[]);
    expect(state.trash).toEqual([]); expect(state.players.ochre.deck.hand.map((card) => card.definitionId)).toEqual(['silver']);
  });

  it('allows every trash card to select its own played instance', () => {
    for (const id of ['cull','discipline','reforge','scour']) {
      let state = ready(); hand(state,[id]); const source = state.players.ochre.deck.hand[0]!;
      const own = listLegalActions(state).find((entry) => entry.command.type === 'playTargetedAction' && entry.command.targetCardInstanceIds.includes(source.id));
      expect(own,id).toBeDefined(); state = applyAction(state,own!.id); expect(state.trash.map((card) => card.id),id).toContain(source.id);
    }
  });
});


describe('pending choice replay and gain sequencing', () => {
  it('persists and replays optionalTrash after Sharpen draws', () => {
    const initial = ready(); hand(initial,['sharpen']); initial.players.ochre.deck.draw = [createCard(initial,'gold')];
    const playAction = action(initial,'sharpen'); const pending = applyAction(initial,playAction.id);
    expect(gameStateSchema.parse(JSON.parse(JSON.stringify(pending)))).toEqual(pending);
    expect(pending.pendingChoice).toMatchObject({ type:'optionalTrash', sourceCardInstanceId:pending.players.ochre.deck.play[0]!.id });
    const drawn = pending.players.ochre.deck.hand.find((card) => card.definitionId === 'gold')!;
    expect(listLegalActions(pending).some((entry) => entry.command.type === 'resolveOptionalTrash' && entry.command.trashInstanceId === drawn.id)).toBe(true);
    const resolved = listLegalActions(pending).find((entry) => entry.command.type === 'resolveOptionalTrash' && entry.command.trashInstanceId === null)!;
    expect(replayCommands(initial,[playAction.command,resolved.command])).toEqual(applyAction(pending,resolved.id));
  });

  it('persists and replays gain, excludes sold-out piles, and leaves Treasure supply and purchase telemetry unchanged', () => {
    const initial = ready(); hand(initial,['reforge','gold']); const gold = initial.players.ochre.deck.hand[1]!;
    const playAction = action(initial,'reforge',[gold.id]); const pending = applyAction(initial,playAction.id); pending.supply.cull = 0;
    expect(gameStateSchema.parse(JSON.parse(JSON.stringify(pending)))).toEqual(pending);
    expect(pending.pendingChoice).toEqual({ type:'gain', playerId:'ochre', maxCost:9 });
    const gains = listLegalActions(pending); expect(gains.some((entry) => entry.command.type === 'resolveGain' && entry.command.definitionId === 'cull')).toBe(false);
    expect(gains.some((entry) => entry.command.type === 'resolveGain' && entry.command.definitionId === 'scrap')).toBe(false);
    const gainGold = gains.find((entry) => entry.command.type === 'resolveGain' && entry.command.definitionId === 'gold')!;
    const resolved = applyAction(pending,gainGold.id); expect(resolved.supply.gold).toBeUndefined(); expect(resolved.players.ochre.purchases).toEqual([]);
    expect(resolved.events.at(-1)).toMatchObject({ type:'gain', detail:{ definitionId:'gold' } });
    const replayInitial = structuredClone(initial); const replayPending = applyCommand(replayInitial,playAction.command); replayPending.supply.cull = 0;
    expect(applyCommand(replayPending,gainGold.command)).toEqual(resolved);
  });
});
