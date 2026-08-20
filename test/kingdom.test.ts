import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import kingdomLibrary from '../src/game-data/kingdoms.json' with { type: 'json' };
import {
  ALWAYS_AVAILABLE_ACTION_IDS, ALWAYS_AVAILABLE_COUNT, CARDS, DEFAULT_KINGDOM_ID,
  applyAction, assertInvariants, checkInvariants, cardDefinition,
  createCard, createGame, kingdomMarket, kingdomOf, listLegalActions, registerKingdom, resetKingdoms,
  resolveCard, submitStartingBuild
} from '../src/game';
import type { GameCommand, GameState, Kingdom, PlayerId } from '../src/game';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACTION_IDS = Object.values(CARDS).filter((card) => card.type === 'action'
  && !ALWAYS_AVAILABLE_ACTION_IDS.includes(card.id)).map((card) => card.id);

function piles(cardIds: readonly string[], count = 10): { cardId: string; count: number }[] {
  return cardIds.map((cardId) => ({ cardId, count }));
}
/** The committed library, so the registry is checked against the data rather than against a copy of it. */
function kingdomIds(): string[] {
  return kingdomLibrary.kingdoms.map((entry) => entry.id);
}
function kingdom(id: string, overrides: Partial<Kingdom> = {}): Kingdom {
  return { id, name: id, startingHealth: 20, actionPiles: piles(['footwork', 'muster']), ...overrides };
}
function ready(state: GameState, ochre: string[] = [], indigo: string[] = []): GameState {
  return submitStartingBuild(submitStartingBuild(state, 'ochre', ochre), 'indigo', indigo);
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
function playCard(state: GameState, definitionId: string, extra: (command: GameCommand) => boolean = () => true): GameState {
  const card = state.players[state.activePlayerId].deck.hand.find((candidate) => candidate.definitionId === definitionId);
  if (!card) throw new Error(`No ${definitionId} in hand.`);
  return applyAction(state, action(state, (command) => 'cardInstanceId' in command && command.cardInstanceId === card.id && extra(command)).id);
}

afterEach(() => { resetKingdoms(); });

describe('kingdom registry', () => {
  it('uses distance-duel by default and reproduces the shipped supply exactly', () => {
    const state = createGame({ seed: 1 });
    expect(state.kingdomId).toBe(DEFAULT_KINGDOM_ID); expect(state.startingHealth).toBe(40);
    expect(state.supply).toEqual({ footwork: 10, muster: 10, feint: 10, drive: 10, flurry: 10,
      aim: 10, volley: 10, step: 10, cull: 10, focus: 10 });
    expect(state.fighters.ochre.health).toBe(37); expect(state.fighters.indigo.health).toBe(40);
    assertInvariants(state);
  });
  it('subtracts three health from the selected first player and bounds both fighters by kingdom health', () => {
    registerKingdom(kingdom('tall', { startingHealth: 30 }));
    const state = createGame({ seed: 1, kingdomId: 'tall', firstPlayerId: 'indigo' });
    expect(state.startingHealth).toBe(30); expect(state.fighters.ochre.health).toBe(30); expect(state.fighters.indigo.health).toBe(27);
    expect(checkInvariants(state)).toEqual([]);
    state.fighters.ochre.health = 31;
    expect(checkInvariants(state)).toContain('ochre has invalid health.');
  });
  it('gives every kingdom Step, Cull, and Focus at ten without listing them', () => {
    registerKingdom(kingdom('cull-free', { actionPiles: piles(['aim']) }));
    const state = createGame({ seed: 1, kingdomId: 'cull-free' });
    expect(state.supply).toEqual({ aim: 10, step: ALWAYS_AVAILABLE_COUNT,
      cull: ALWAYS_AVAILABLE_COUNT, focus: ALWAYS_AVAILABLE_COUNT });
    expect(kingdomOf('cull-free').actionPiles.map((pile) => pile.cardId)).toEqual(['aim']);
    assertInvariants(state);
  });
  it('offers exactly the kingdom piles, universal actions, treasures, and End Buy phase', () => {
    const ten = ACTION_IDS.slice(0, 10);
    registerKingdom(kingdom('ten', { actionPiles: piles(ten) }));
    const state = ready(createGame({ seed: 1, kingdomId: 'ten' }));
    expect(Object.keys(state.supply).sort()).toEqual([...ten, 'step', 'cull', 'focus'].sort());
    state.phase = 'buy'; state.players.ochre.money = 100;
    expect(listLegalActions(state).map((entry) => entry.label).sort()).toEqual([
      ...[...ten, 'step', 'cull', 'focus', 'copper', 'silver', 'gold'].map((id) => `Buy ${cardDefinition(id).name}`),
      'End Buy phase'
    ].sort());
  });
  it('removes an exhausted pile from the buy list, including Cull', () => {
    let state = ready(createGame({ seed: 1 }));
    state.phase = 'buy'; state.players.ochre.money = 500;
    for (const definitionId of ['footwork', 'cull']) {
      for (let count = 0; count < 10; count += 1) state = applyAction(state, action(state, (command) => command.type === 'buyCard' && command.definitionId === definitionId).id);
      expect(state.supply[definitionId]).toBe(0);
      expect(listLegalActions(state).some((entry) => entry.command.type === 'buyCard' && entry.command.definitionId === definitionId)).toBe(false);
    }
    assertInvariants(state);
  });
  it('throws for an unknown kingdom id, in the registry and in createGame', () => {
    expect(() => kingdomOf('missing')).toThrow('Unknown kingdom: missing');
    expect(() => createGame({ seed: 1, kingdomId: 'missing' })).toThrow('Unknown kingdom: missing');
  });
  it('rejects a second registration with different content but accepts a reordered repeat', () => {
    registerKingdom(kingdom('repeat', { actionPiles: piles(['aim', 'volley']) }));
    expect(() => registerKingdom(kingdom('repeat', { actionPiles: piles(['volley', 'aim']) }))).not.toThrow();
    expect(() => registerKingdom(kingdom('repeat', { actionPiles: piles(['aim', 'volley'], 9) }))).toThrow('already registered');
    expect(() => registerKingdom(kingdom('repeat', { startingHealth: 25, actionPiles: piles(['aim', 'volley']) }))).toThrow('already registered');
  });
  it('ignores mutation of the submitted object and of the object it returns', () => {
    const submitted = kingdom('frozen', { actionPiles: piles(['aim']) });
    registerKingdom(submitted);
    submitted.startingHealth = 99; submitted.actionPiles.push({ cardId: 'volley', count: 10 });
    expect(kingdomOf('frozen').startingHealth).toBe(20); expect(kingdomOf('frozen').actionPiles).toHaveLength(1);
    expect(() => { kingdomOf('frozen').actionPiles.push({ cardId: 'volley', count: 10 }); }).toThrow();
    expect(kingdomOf('frozen').actionPiles).toHaveLength(1);
    expect(createGame({ seed: 1, kingdomId: 'frozen' }).supply).toEqual({ aim: 10, step: 10, cull: 10, focus: 10 });
  });
  it('freezes the nested values a resolved card exposes, with and without an override', () => {
    registerKingdom(kingdom('sharp', { actionPiles: piles(['aim', 'volley']), overrides: { volley: { values: { far: 9 } } } }));
    const state = createGame({ seed: 1, kingdomId: 'sharp' });
    // The type already forbids these writes, so the cast is what proves the runtime freeze.
    const mutable = (id: string): Record<string, number> => resolveCard(state, id).values as Record<string, number>;
    expect(() => { mutable('aim').draw = 99; }).toThrow();
    expect(() => { mutable('volley').far = 99; }).toThrow();
    expect(CARDS.aim!.values!.draw).toBe(cardDefinition('aim').values!.draw);
    expect(resolveCard(state, 'volley').values!.far).toBe(9);
  });
  it('rejects every malformed kingdom', () => {
    expect(() => registerKingdom(kingdom('bad', { actionPiles: piles(['invented']) }))).toThrow('Unknown card definition: invented');
    expect(() => registerKingdom(kingdom('bad', { actionPiles: [...piles(['aim']), ...piles(['aim'])] }))).toThrow('Duplicate market pile');
    expect(() => registerKingdom(kingdom('bad', { actionPiles: piles(['silver']) }))).toThrow('Action cards only');
    expect(() => registerKingdom(kingdom('bad', { actionPiles: piles(['cull']) }))).toThrow('available in every kingdom');
    expect(() => registerKingdom(kingdom('bad', { actionPiles: piles(['focus']) }))).toThrow('available in every kingdom');
    expect(() => registerKingdom(kingdom('bad', { overrides: { aim: { nonsense: 1 } as never } }))).toThrow();
    expect(() => registerKingdom(kingdom('bad', { overrides: { aim: { values: { damage: 1 } } } }))).toThrow('no damage value to override');
    expect(() => registerKingdom(kingdom('bad', { overrides: { aim: { values: { draw: Number.POSITIVE_INFINITY } } } }))).toThrow();
    expect(() => registerKingdom(kingdom('bad', { overrides: { invented: { cost: 1 } } }))).toThrow('Unknown card definition: invented');
    expect(() => registerKingdom(kingdom('bad', { actionPiles: piles(['aim'], 0) }))).toThrow();
    expect(() => registerKingdom(kingdom('bad', { actionPiles: piles(['aim'], 11) }))).toThrow('at most 10');
    expect(() => registerKingdom(kingdom('bad', { actionPiles: piles(['aim'], 1.5) }))).toThrow();
    expect(() => registerKingdom(kingdom('bad', { actionPiles: [] }))).toThrow();
    expect(() => registerKingdom(kingdom('bad', { startingHealth: 0 }))).toThrow();
    expect(() => registerKingdom(kingdom('bad', { startingHealth: 20.5 }))).toThrow();
    expect(() => kingdomOf('bad')).toThrow('Unknown kingdom');
  });
  it('rejects a supply that misses a pile or carries an extra one', () => {
    const state = ready(createGame({ seed: 1 }));
    const missing = structuredClone(state); delete missing.supply.cull;
    expect(checkInvariants(missing)).toContain('Supply is missing cull.');
    const extra = structuredClone(state); extra.supply.starfire = 10;
    expect(checkInvariants(extra)).toContain('Supply has invalid card starfire.');
    const over = structuredClone(state); over.supply.aim = 11;
    expect(checkInvariants(over)).toContain('aim has invalid supply count.');
  });
  it('limits a starting build to the cards the kingdom sells', () => {
    registerKingdom(kingdom('narrow', { actionPiles: piles(['aim']) }));
    const state = createGame({ seed: 1, kingdomId: 'narrow' });
    expect(() => submitStartingBuild(state, 'ochre', ['aim', 'step', 'cull', 'focus'])).not.toThrow();
    expect(() => submitStartingBuild(state, 'ochre', ['volley'])).toThrow('does not sell volley');
    expect(() => submitStartingBuild(state, 'ochre', ['invented'])).toThrow('Unknown card definition: invented');
  });
  it('produces identical states from the same seed, kingdom, and first player', () => {
    const play = (): GameState => {
      const state = ready(createGame({ seed: 42, firstPlayerId: 'indigo', kingdomId: DEFAULT_KINGDOM_ID }), ['aim', 'volley'], ['feint', 'drive']);
      return applyAction(state, action(state, (command) => command.type === 'endActionPhase').id);
    };
    expect(play()).toEqual(play());
  });
});

describe('the curated kingdoms', () => {
  const THREE_WAY_OPEN = ['footwork', 'stipend', 'drive', 'heavyBlow', 'aim', 'volley', 'channel', 'leyStep', 'arcBolt', 'fireball'];
  const EXPECTED: readonly Kingdom[] = [
    {
      id: 'distance-duel', name: 'Distance Duel', startingHealth: 40,
      actionPiles: piles(['footwork', 'muster', 'feint', 'drive', 'flurry', 'aim', 'volley'])
    },
    {
      id: 'current-duel', name: 'Current Duel', startingHealth: 40,
      actionPiles: piles(['footwork', 'muster', 'feint', 'drive', 'flurry', 'aim', 'volley', 'adapt'])
    },
    { id: 'three-way-open', name: 'Three-Way Open', startingHealth: 40, actionPiles: piles(THREE_WAY_OPEN) },
    {
      id: 'three-way-engine', name: 'Three-Way Engine', startingHealth: 40,
      actionPiles: piles(['footwork', 'muster', 'stipend', 'reclaim', 'adapt', 'heavyBlow', 'steadyShot', 'channel', 'prism', 'fireball'])
    },
    {
      id: 'range-rich-mixed', name: 'Range-Rich Mixed', startingHealth: 40,
      actionPiles: piles(['footwork', 'adapt', 'fireball', 'steadyShot', 'aim', 'volley', 'drive', 'heavyBlow', 'channel', 'arcBolt'])
    }
  ];

  it('registers exactly the five committed kingdoms, each with its approved content', () => {
    expect(kingdomIds()).toEqual(EXPECTED.map((entry) => entry.id));
    for (const expected of EXPECTED) {
      const registered = kingdomOf(expected.id);
      expect(registered.name, expected.id).toBe(expected.name);
      expect(registered.startingHealth, expected.id).toBe(expected.startingHealth);
      expect(registered.actionPiles, expected.id).toEqual(expected.actionPiles);
      expect(registered.overrides ?? undefined, expected.id).toEqual(expected.overrides);
      // Universal actions and the three treasures are available everywhere and are never listed as piles.
      expect(kingdomMarket(expected.id).map((card) => card.id), expected.id)
        .toEqual(expect.arrayContaining(['step', 'cull', 'focus', 'copper', 'silver', 'gold']));
    }
  });

  it('keeps distance-duel as the default with its shipped supply', () => {
    const state = createGame({ seed: 1 });
    expect(state.kingdomId).toBe(DEFAULT_KINGDOM_ID);
    expect(state.supply).toEqual({ footwork: 10, muster: 10, feint: 10, drive: 10, flurry: 10,
      aim: 10, volley: 10, step: 10, cull: 10, focus: 10 });
  });

  // Asserted on `actionPiles`, not on the supply or market, because both also carry Step, Cull,
  // Focus, and the treasures.
  it('gives current-duel eight action piles and the other three ten', () => {
    expect(kingdomOf('current-duel').actionPiles).toHaveLength(8);
    for (const id of ['three-way-open', 'three-way-engine', 'range-rich-mixed']) {
      expect(kingdomOf(id).actionPiles, id).toHaveLength(10);
    }
  });

  it('starts every curated kingdom with the first player at 37 health and the second at 40', () => {
    for (const expected of EXPECTED) {
      const state = createGame({ seed: 4, kingdomId: expected.id });
      expect(state.startingHealth, expected.id).toBe(40);
      expect(state.fighters.ochre.health, expected.id).toBe(37);
      expect(state.fighters.indigo.health, expected.id).toBe(40);
      expect(() => assertInvariants(state), expected.id).not.toThrow();
      expect(() => assertInvariants(ready(state)), expected.id).not.toThrow();
    }
  });

  it('leaves Step, Strike, Repelling Shot, and Starfire out of every curated kingdom', () => {
    for (const id of kingdomIds()) {
      const sold = new Set(kingdomOf(id).actionPiles.map((pile) => pile.cardId));
      for (const excluded of ['step', 'strike', 'repellingShot', 'starfire']) {
        expect(sold.has(excluded), `${id} sells ${excluded}`).toBe(false);
      }
    }
  });

  it('still rejects an override naming a value the mechanic does not declare', () => {
    expect(() => registerKingdom(kingdom('bad', { overrides: { heavyBlow: { values: { draw: 1 } } } })))
      .toThrow('no draw value to override');
  });
});

describe('card overrides', () => {
  it('changes the buy cost, the build budget, and the damage without touching the card data', () => {
    registerKingdom(kingdom('heavy', { actionPiles: piles(['heavyBlow']), overrides: { heavyBlow: { cost: 3, values: { damage: 6 } } } }));
    let state = ready(createGame({ seed: 1, kingdomId: 'heavy' }), ['heavyBlow', 'heavyBlow']);
    expect(state.players.ochre.firstBuyMoney).toBe(3);
    expect(CARDS.heavyBlow).toMatchObject({ cost: 5, values: { damage: 4 } });
    expect(resolveCard(state, 'heavyBlow')).toMatchObject({ cost: 3, values: { damage: 6 } });
    state.fighters.indigo.position = 2; isolateHand(state, 'ochre', ['heavyBlow']);
    state = playCard(state, 'heavyBlow');
    expect(state.fighters.indigo.health).toBe(14);
    state.phase = 'buy'; state.players.ochre.money = 3;
    expect(action(state, (command) => command.type === 'buyCard' && command.definitionId === 'heavyBlow')).toBeDefined();
  });
  it('changes the money a Treasure provides in the Buy phase', () => {
    registerKingdom(kingdom('rich', { overrides: { silver: { money: 5 } } }));
    let state = ready(createGame({ seed: 1, kingdomId: 'rich' }));
    isolateHand(state, 'ochre', ['silver', 'copper']); state.players.ochre.firstBuyPending = false;
    state = applyAction(state, action(state, (command) => command.type === 'endActionPhase').id);
    expect(state.players.ochre.money).toBe(6);
  });
});

describe('override coverage', () => {
  const OVERRIDES: Record<string, { cost?: number; money?: number; values?: Record<string, number> }> = {
    copper: { cost: 1, money: 4 }, silver: { cost: 1, money: 5 }, gold: { cost: 1, money: 6 },
    footwork: { cost: 1, values: { draw: 2 } },
    cull: { cost: 1 },
    focus: { cost: 1, values: { mana: 2, draw: 0 } },
    muster: { cost: 1, values: { draw: 3 } },
    feint: { cost: 1, values: { bonus: 4 } },
    drive: { cost: 1, values: { damage: 5, wallDamage: 6 } },
    flurry: { cost: 1, values: { perAction: 2, max: 9 } },
    aim: { cost: 1, values: { draw: 2 } },
    volley: { cost: 1, values: { near: 7, far: 8, aimedNear: 9, aimedFar: 10 } },
    stipend: { cost: 1, values: { draw: 2, money: 5 } },
    reclaim: { cost: 1, values: { draw: 2 } },
    adapt: { cost: 1, values: { draw: 2, movedDraw: 3 } },
    heavyBlow: { cost: 1, values: { damage: 7 } },
    steadyShot: { cost: 1, values: { damage: 7, draw: 1 } },
    channel: { cost: 1, values: { mana: 3, draw: 2 } },
    leyStep: { cost: 1, values: { mana: 4 } },
    prism: { cost: 1, values: { mana: 5, draw: 2, discard: 2 } },
    arcBolt: { cost: 1, values: { damage: 7, manaCost: 2 } },
    fireball: { cost: 1, values: { damage: 9, manaCost: 1 } },
    starfire: { cost: 1, values: { damage: 11, manaCost: 1 } },
    step: { cost: 1 },
    strike: { cost: 1, values: { damage: 6 } },
    repellingShot: { cost: 1, values: { damage: 8 } }
  };
  function tuned(position = 3, mana = 0): GameState {
    registerKingdom(kingdom('tuned', { startingHealth: 40, actionPiles: piles(ACTION_IDS), overrides: OVERRIDES }));
    const state = ready(createGame({ seed: 3, kingdomId: 'tuned' }));
    state.fighters.indigo.position = position; state.players.ochre.mana = mana;
    return state;
  }
  it('covers every declared value key and every mechanic', () => {
    expect(Object.keys(OVERRIDES).sort()).toEqual(Object.keys(CARDS).sort());

    let state = tuned(); isolateHand(state, 'ochre', ['footwork']); setDraw(state, 'ochre', ['copper', 'copper', 'copper', 'copper', 'copper']);
    state = playCard(state, 'footwork', (command) => command.type === 'playFootwork' && command.movement === 'stay');
    expect(state.players.ochre.deck.hand).toHaveLength(2);

    state = tuned(); isolateHand(state, 'ochre', ['muster']); setDraw(state, 'ochre', ['copper', 'copper', 'copper', 'copper']);
    expect(playCard(state, 'muster').players.ochre.deck.hand).toHaveLength(3);

    state = tuned(2); isolateHand(state, 'ochre', ['feint', 'strike']);
    state = playCard(state, 'feint'); state = playCard(state, 'strike');
    expect(state.fighters.indigo.health).toBe(40 - 6 - 4);

    state = tuned(2); isolateHand(state, 'ochre', ['drive']);
    expect(playCard(state, 'drive', (command) => command.type === 'playDrive' && command.direction === 'right').fighters.indigo.health).toBe(35);
    state = tuned(2); state.fighters.ochre.position = 5; state.fighters.indigo.position = 5; isolateHand(state, 'ochre', ['drive']);
    expect(playCard(state, 'drive', (command) => command.type === 'playDrive' && command.direction === 'right').fighters.indigo.health).toBe(40 - 5 - 6);

    state = tuned(2); isolateHand(state, 'ochre', ['step', 'step', 'flurry']);
    state = playCard(state, 'step', (command) => command.type === 'playMoveAction' && command.direction === 'left');
    state = playCard(state, 'step', (command) => command.type === 'playMoveAction' && command.direction === 'right');
    expect(playCard(state, 'flurry').fighters.indigo.health).toBe(36);

    state = tuned(5); isolateHand(state, 'ochre', ['aim', 'volley']); setDraw(state, 'ochre', ['copper', 'copper']);
    state = playCard(state, 'aim'); expect(state.players.ochre.deck.hand.filter((card) => card.definitionId === 'copper')).toHaveLength(2);
    expect(playCard(state, 'volley').fighters.indigo.health).toBe(30);

    state = tuned(5); isolateHand(state, 'ochre', ['volley']);
    expect(playCard(state, 'volley').fighters.indigo.health).toBe(32);
    state = tuned(3); isolateHand(state, 'ochre', ['volley']);
    expect(playCard(state, 'volley').fighters.indigo.health).toBe(33);
    state = tuned(3); isolateHand(state, 'ochre', ['aim', 'volley']); setDraw(state, 'ochre', ['copper', 'copper']);
    expect(playCard(playCard(state, 'aim'), 'volley').fighters.indigo.health).toBe(31);

    state = tuned(3); isolateHand(state, 'ochre', ['step', 'step', 'step', 'step', 'step', 'flurry']);
    for (const direction of ['left', 'right', 'left', 'right', 'left']) {
      state = playCard(state, 'step', (command) => command.type === 'playMoveAction' && command.direction === direction);
    }
    state.fighters.indigo.position = state.fighters.ochre.position;
    expect(playCard(state, 'flurry').fighters.indigo.health).toBe(31);

    state = tuned(); isolateHand(state, 'ochre', ['stipend']); setDraw(state, 'ochre', ['gold', 'gold']);
    state = playCard(state, 'stipend');
    expect(state.players.ochre.deck.hand).toHaveLength(2); expect(state.players.ochre.money).toBe(5);

    state = tuned(); isolateHand(state, 'ochre', ['reclaim']); setDraw(state, 'ochre', ['copper', 'copper', 'copper']);
    expect(playCard(state, 'reclaim').players.ochre.deck.hand).toHaveLength(2);

    state = tuned(); isolateHand(state, 'ochre', ['reclaim']); setDraw(state, 'ochre', ['copper', 'copper', 'copper']);
    state.players.ochre.deck.discard.push(createCard(state, 'gold'));
    state = playCard(state, 'reclaim');
    expect(state.pendingChoice).toMatchObject({ type: 'recover', playerId: 'ochre' });
    const recover = action(state, (command) => command.type === 'resolveRecover' && command.recoverInstanceId !== null);
    state = applyAction(state, recover.id);
    expect(state.pendingChoice).toBeNull();
    expect(state.players.ochre.deck.draw[0]?.definitionId).toBe('gold');

    state = tuned(); isolateHand(state, 'ochre', ['adapt']); setDraw(state, 'ochre', ['copper', 'copper', 'copper', 'copper', 'copper']);
    expect(playCard(state, 'adapt').players.ochre.deck.hand).toHaveLength(2);
    state = tuned(); isolateHand(state, 'ochre', ['leyStep', 'adapt']); setDraw(state, 'ochre', ['copper', 'copper', 'copper', 'copper', 'copper']);
    state = playCard(state, 'leyStep', (command) => command.type === 'playMoveAction' && command.direction === 'left');
    expect(state.players.ochre.mana).toBe(4);
    expect(playCard(state, 'adapt').players.ochre.deck.hand).toHaveLength(5);

    state = tuned(2); isolateHand(state, 'ochre', ['heavyBlow']);
    expect(playCard(state, 'heavyBlow').fighters.indigo.health).toBe(33);

    state = tuned(); isolateHand(state, 'ochre', ['focus']);
    state = playCard(state, 'focus');
    expect(state.players.ochre.mana).toBe(2); expect(state.players.ochre.deck.hand).toHaveLength(0);

    state = tuned(); isolateHand(state, 'ochre', ['steadyShot']); setDraw(state, 'ochre', ['copper', 'copper']);
    state = playCard(state, 'steadyShot');
    expect(state.fighters.indigo.health).toBe(33); expect(state.players.ochre.deck.hand).toHaveLength(1);

    state = tuned(); isolateHand(state, 'ochre', ['repellingShot']);
    state = playCard(state, 'repellingShot');
    expect(state.fighters.indigo.health).toBe(32); expect(state.fighters.indigo.position).toBe(4);

    state = tuned(); isolateHand(state, 'ochre', ['channel']); setDraw(state, 'ochre', ['copper', 'copper', 'copper']);
    state = playCard(state, 'channel');
    expect(state.players.ochre.mana).toBe(3); expect(state.players.ochre.deck.hand).toHaveLength(2);

    state = tuned(); isolateHand(state, 'ochre', ['prism', 'copper', 'copper']); setDraw(state, 'ochre', ['gold', 'gold', 'gold']);
    state = playCard(state, 'prism');
    expect(state.players.ochre.mana).toBe(5); expect(state.players.ochre.deck.hand).toHaveLength(4);
    expect(state.pendingChoice).toMatchObject({ type: 'discard', remaining: 2 });
    state = applyAction(state, listLegalActions(state)[0]!.id);
    expect(state.pendingChoice).toMatchObject({ remaining: 1 });
    state = applyAction(state, listLegalActions(state)[0]!.id);
    expect(state.pendingChoice).toBeNull(); expect(state.players.ochre.deck.discard).toHaveLength(2);

    for (const [definitionId, mana, health] of [['arcBolt', 2, 33], ['fireball', 1, 31], ['starfire', 1, 29]] as const) {
      state = tuned(3, mana); isolateHand(state, 'ochre', [definitionId]);
      expect(playCard(state, definitionId).fighters.indigo.health, definitionId).toBe(health);
      const short = tuned(3, mana - 1); isolateHand(short, 'ochre', [definitionId]);
      expect(listLegalActions(short).some((entry) => entry.command.type === 'playAction'), definitionId).toBe(false);
    }

    state = tuned(); isolateHand(state, 'ochre', ['cull', 'copper']); state.players.ochre.firstBuyPending = false;
    state = applyAction(state, action(state, (command) => command.type === 'endActionPhase').id);
    expect(state.players.ochre.money).toBe(4);
    for (const definitionId of ['cull', 'step', 'gold']) {
      expect(resolveCard(state, definitionId).cost, definitionId).toBe(1);
    }
  });
});

describe('kingdom persistence and source hygiene', () => {
  it('survives a save, a load, and one committed action', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-kingdom-'));
    try {
      const service = new GameService(new FileGameRepository(directory));
      const created = await service.create({ seed: 5 });
      const first = await service.updateBuild(created.id, created.revision, [], true);
      const both = await service.updateBuild(created.id, first.revision, [], true);
      const after = await service.commitAction(created.id, both.revision, both.actions.phases.find((entry) => entry.kind === 'endAction')!.id);
      expect(after.phase).toBe('buy');
      const record = await service.getRecord(created.id);
      expect(record.state.kingdomId).toBe(record.kingdom.id); expect(record.state.startingHealth).toBe(40);
      expect(Object.keys(after.cards).sort()).toEqual([...kingdomMarket(record.kingdom.id).map((card) => card.id)].sort());
      assertInvariants(record.state);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('leaves no removed market symbol, bare-number createGame, or health literal behind', () => {
    function walk(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === 'e2e' ? [] : walk(full);
        return /\.tsx?$/.test(entry.name) ? [full] : [];
      });
    }
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'test'))];
    const removed = new RegExp([['FIRST', 'MARKET'].join('_'), ['MARKET', 'CARD', 'IDS'].join('_'), ['market', 'Schema'].join('')].join('|'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(removed.test(source), file).toBe(false);
      expect(/createGame\(\s*[0-9]/.test(source), file).toBe(false);
    }
    for (const file of walk(path.join(root, 'src', 'game'))) {
      expect(/\b20\b/.test(readFileSync(file, 'utf8')), file).toBe(false);
    }
  });
});
