import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALWAYS_AVAILABLE_ACTION_IDS, ALWAYS_AVAILABLE_COUNT, CARDS, VARIABLE_ACTION_IDS,
  assertInvariants, checkInvariants, createGame, kingdomMarket, kingdomOf, listLegalActions,
  registerKingdom, resetKingdoms, resolveCard, submitStartingBuild
} from '../src/game';
import type { GameState, Kingdom } from '../src/game';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';

function piles(ids: readonly string[], count = 10) { return ids.map((cardId) => ({ cardId, count })); }
function kingdom(id: string, overrides: Partial<Kingdom> = {}): Kingdom { return { id, name: id, startingHealth: 20, actionPiles: piles(['footwork']), ...overrides }; }
function ready(state: GameState): GameState { return submitStartingBuild(submitStartingBuild(state, 'ochre', []), 'indigo', []); }
afterEach(resetKingdoms);

describe('kingdom registry', () => {

  it('makes only Step and Focus universal and keeps Cull variable', () => {
    expect(ALWAYS_AVAILABLE_ACTION_IDS).toEqual(['step', 'focus']);
    expect(VARIABLE_ACTION_IDS).toContain('cull'); expect(VARIABLE_ACTION_IDS).not.toContain('scrap');
    registerKingdom(kingdom('narrow', { actionPiles: piles(['aim']) }));
    const state = createGame({ seed: 1, kingdomId: 'narrow' });
    expect(state.supply).toEqual({ aim:10, step:ALWAYS_AVAILABLE_COUNT, focus:ALWAYS_AVAILABLE_COUNT });
    expect(kingdomMarket('narrow').map((card) => card.id)).toEqual(['copper','silver','gold','aim','step','focus']);
  });

  it('offers market piles, universal actions, treasures, and End Buy only', () => {
    registerKingdom(kingdom('ten', { actionPiles: piles(VARIABLE_ACTION_IDS.slice(0, 10)) }));
    const state = ready(createGame({ seed: 1, kingdomId: 'ten' })); state.phase = 'buy'; state.players.ochre.money = 100;
    expect(listLegalActions(state).map((entry) => entry.label).sort()).toEqual([
      'Buy Copper','Buy Silver','Buy Gold','Buy Step','Buy Focus','End Buy phase',
      ...VARIABLE_ACTION_IDS.slice(0,10).map((id) => `Buy ${CARDS[id]!.name}`)
    ].sort());
  });

  it('freezes registered kingdoms and nested resolved values', () => {
    const submitted = kingdom('frozen', { actionPiles: piles(['aim','volley']), overrides: { volley: { values: { far: 9 } } } });
    registerKingdom(submitted); submitted.startingHealth = 99; submitted.actionPiles.push({ cardId:'cull', count:10 });
    expect(kingdomOf('frozen').startingHealth).toBe(20); expect(kingdomOf('frozen').actionPiles).toHaveLength(2);
    expect(() => kingdomOf('frozen').actionPiles.push({ cardId:'cull', count:10 })).toThrow();
    const mutable = resolveCard(createGame({ seed:1, kingdomId:'frozen' }), 'volley').values as Record<string,number>;
    expect(() => { mutable.far = 2; }).toThrow(); expect(mutable.far).toBe(9);
  });

  it('rejects unknown, duplicate, Treasure, universal, malformed, and oversized piles', () => {
    expect(() => registerKingdom(kingdom('bad', { actionPiles:piles(['invented']) }))).toThrow('Unknown card');
    expect(() => registerKingdom(kingdom('bad', { actionPiles:piles(['aim','aim']) }))).toThrow('Duplicate market pile');
    expect(() => registerKingdom(kingdom('bad', { actionPiles:piles(['silver']) }))).toThrow('Action cards only');
    expect(() => registerKingdom(kingdom('bad', { actionPiles:piles(['step']) }))).toThrow('available in every kingdom');
    expect(() => registerKingdom(kingdom('bad', { actionPiles:piles(['aim'],11) }))).toThrow('at most 10');
    expect(() => registerKingdom(kingdom('bad', { actionPiles:[] }))).toThrow();
    expect(() => registerKingdom(kingdom('bad', { overrides:{ aim:{ values:{ damage:1 } } } }))).toThrow('no damage value');
    expect(() => registerKingdom(kingdom('bad', { overrides:{ longshot:{ values:{ bonus:1 } } } }))).toThrow('no bonus value');
  });

  it('accepts a reordered identical registration and rejects changed content', () => {
    registerKingdom(kingdom('repeat', { actionPiles:piles(['aim','volley']) }));
    expect(() => registerKingdom(kingdom('repeat', { actionPiles:piles(['volley','aim']) }))).not.toThrow();
    expect(() => registerKingdom(kingdom('repeat', { actionPiles:piles(['aim'],9) }))).toThrow('already registered');
  });

  it('validates supply membership and bounds', () => {
    const state = ready(createGame({ seed:1 })); const missing = structuredClone(state); delete missing.supply.cull;
    expect(checkInvariants(missing)).toContain('Supply is missing cull.');
    const extra = structuredClone(state); extra.supply.starfire = 10; expect(checkInvariants(extra)).toContain('Supply has invalid card starfire.');
    const over = structuredClone(state); over.supply.aim = 11; expect(checkInvariants(over)).toContain('aim has invalid supply count.');
  });

  it('limits starting builds to sold cards and the two universal cards', () => {
    registerKingdom(kingdom('build', { actionPiles:piles(['aim','cull']) })); const state = createGame({ seed:1, kingdomId:'build' });
    expect(() => submitStartingBuild(state, 'ochre', ['aim','cull','step'])).not.toThrow();
    expect(() => submitStartingBuild(state, 'ochre', ['volley'])).toThrow('does not sell volley');
  });
});

describe('overrides and persistence', () => {
  it('applies cost, value, and Treasure money overrides without mutating base definitions', () => {
    expect(CARDS.longshot!.values).toEqual({});
    registerKingdom(kingdom('tuned', { actionPiles:piles(['heavyBlow']), overrides:{ heavyBlow:{ cost:3, values:{ damage:6 } }, silver:{ money:5 } } }));
    const state = createGame({ seed:1, kingdomId:'tuned' });
    expect(resolveCard(state,'heavyBlow')).toMatchObject({ cost:3, values:{ damage:6, draw:0 } });
    expect(resolveCard(state,'silver').money).toBe(5); expect(CARDS.heavyBlow).toMatchObject({ cost:5, values:{ damage:6, draw:0 } });
  });

  it('accepts every declared mechanic value key in a registered override', () => {
    const ids = Object.values(CARDS).filter((card) => card.type === 'action' && card.id !== 'scrap' && !ALWAYS_AVAILABLE_ACTION_IDS.includes(card.id)).map((card) => card.id);
    const overrides = Object.fromEntries(Object.values(CARDS).map((card) => [card.id, card.type === 'treasure'
      ? { cost:1, money:7 } : { cost:1, values:Object.fromEntries(Object.keys(card.values ?? {}).map((key) => [key,7])) }]));
    registerKingdom(kingdom('all-values', { actionPiles:piles(ids), overrides }));
    const state = createGame({ seed:1, kingdomId:'all-values' });
    for (const card of Object.values(CARDS)) { expect(resolveCard(state,card.id).cost).toBe(1);
      if (card.type === 'treasure') expect(resolveCard(state,card.id).money).toBe(7);
      else for (const key of Object.keys(card.values ?? {})) expect(resolveCard(state,card.id).values?.[key]).toBe(7); }
  });

  it('persists, reloads, and exposes owned plus starting-only definitions with overrides', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-kingdom-'));
    try { const service = new GameService(new FileGameRepository(directory)); const created = await service.create({ seed:5 });
      const one = await service.updateBuild(created.id, created.revision, [], true); const both = await service.updateBuild(created.id, one.revision, [], true);
      const after = await service.commitAction(created.id, both.revision, both.actions.phases.find((entry) => entry.kind === 'endAction')!.id);
      const record = await service.getRecord(created.id); expect(after.phase).toBe('buy'); expect(record.state.kingdomId).toBe(record.kingdom.id);
      expect(Object.keys(after.cards).sort()).toEqual(Object.keys(CARDS).sort()); expect(after.cards.scrap).toEqual(CARDS.scrap); assertInvariants(record.state);
    } finally { await rm(directory,{ recursive:true, force:true }); }
  });
});
