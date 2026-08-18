import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyAction, createGame, listLegalActions, marketCost, registerKingdom, resetKingdoms, submitStartingBuild
} from '../../src/game';
import type { GameCommand, GameState, Kingdom, PlayerId } from '../../src/game';
import { BASELINE_STRATEGIES, baselineStrategy } from '../../src/sim/baselines';
import { chooseBuyAction, ownedCount } from '../../src/sim/buy';
import { strategyAgent } from '../../src/sim/agents/strategyAgent';
import { repairBuild } from '../../src/sim/build';
import { runMatch } from '../../src/sim/match';
import type { Strategy } from '../../src/sim/strategy';
import type { Agent, MatchConfig, MatchResult } from '../../src/sim/types';
import { strategy, weights } from './fixtures';
import { CURATED_KINGDOMS, registerCuratedKingdoms } from './kingdoms';

function buyState(options: { kingdomId?: string; money: number }): GameState {
  const empty = createGame({ seed: 1, kingdomId: options.kingdomId ?? 'distance-duel' });
  const state = submitStartingBuild(submitStartingBuild(empty, 'ochre', []), 'indigo', []);
  state.phase = 'buy';
  state.players.ochre.money = options.money;
  return state;
}
function step(state: GameState, plan: Strategy): { state: GameState; command: GameCommand } {
  const chosen = chooseBuyAction(state, 'ochre', listLegalActions(state), plan);
  return { state: applyAction(state, chosen.id), command: chosen.command };
}
function buyRun(state: GameState, plan: Strategy, limit = 20): GameCommand[] {
  const commands: GameCommand[] = [];
  let current = state;
  for (let count = 0; count < limit; count += 1) {
    const next = step(current, plan);
    commands.push(next.command);
    if (next.command.type === 'endBuyPhase') return commands;
    current = next.state;
  }
  throw new Error('The Buy phase did not end.');
}
function bought(commands: readonly GameCommand[]): string[] {
  return commands.flatMap((command) => (command.type === 'buyCard' ? [command.definitionId] : []));
}

afterEach(() => { resetKingdoms(); });

describe('buy agenda', () => {
  it('buys down the agenda, stops at the desired count, and falls through to treasure', () => {
    const plan = strategy({ buyAgenda: [{ cardId: 'footwork', desiredCount: 2 }], treasureFallback: ['gold', 'silver'] });
    // 20 money: two Footwork at 3, then two Gold at 6, leaving 2 for nothing.
    const commands = buyRun(buyState({ money: 20 }), plan);
    expect(bought(commands)).toEqual(['footwork', 'footwork', 'gold', 'gold']);
    expect(commands.at(-1)!.type).toBe('endBuyPhase');

    const tighter = buyRun(buyState({ money: 10 }), plan);
    expect(bought(tighter)).toEqual(['footwork', 'footwork', 'silver']);
  });

  it('skips an agenda entry the kingdom does not sell and one whose pile is exhausted', () => {
    const plan = strategy({
      buyAgenda: [{ cardId: 'heavyBlow', desiredCount: 2 }, { cardId: 'footwork', desiredCount: 1 }],
      treasureFallback: ['silver']
    });
    expect(bought(buyRun(buyState({ money: 6 }), plan))).toEqual(['footwork', 'silver']);

    const exhausted = buyState({ money: 6 });
    exhausted.supply.footwork = 0;
    expect(bought(buyRun(exhausted, plan))).toEqual(['silver', 'silver']);
  });

  it('prices Heavy Blow through the kingdom override, not the card data', () => {
    registerKingdom({
      id: 'cheap-blow', name: 'cheap-blow', startingHealth: 20,
      actionPiles: [{ cardId: 'heavyBlow', count: 10 }],
      overrides: { heavyBlow: { cost: 3 } }
    });
    const plan = strategy({ buyAgenda: [{ cardId: 'heavyBlow', desiredCount: 1 }], treasureFallback: [] });

    const atFive = step(buyState({ kingdomId: 'cheap-blow', money: 5 }), plan);
    expect(atFive.command).toEqual({ type: 'buyCard', definitionId: 'heavyBlow' });
    expect(atFive.state.players.ochre.money).toBe(2);   // charged 3, not the base 5

    // The base cost of 5 would put Heavy Blow out of reach at 3 money.
    const atThree = step(buyState({ kingdomId: 'cheap-blow', money: 3 }), plan);
    expect(atThree.command).toEqual({ type: 'buyCard', definitionId: 'heavyBlow' });
  });

  it('counts owned cards by zone, so a purchase counts once and a Cull frees the slot', () => {
    const plan = strategy({ buyAgenda: [{ cardId: 'footwork', desiredCount: 1 }], treasureFallback: [] });
    const first = step(buyState({ money: 20 }), plan);
    expect(first.command).toEqual({ type: 'buyCard', definitionId: 'footwork' });
    expect(ownedCount(first.state, 'ochre', 'footwork')).toBe(1);
    expect(first.state.players.ochre.purchases).toEqual(['footwork']);
    expect(step(first.state, plan).command.type).toBe('endBuyPhase');

    const culled = structuredClone(first.state);
    const deck = culled.players.ochre.deck;
    const index = deck.discard.findIndex((card) => card.definitionId === 'footwork');
    culled.trash.push(...deck.discard.splice(index, 1));
    expect(ownedCount(culled, 'ochre', 'footwork')).toBe(0);
    expect(culled.players.ochre.purchases).toEqual(['footwork']);
    expect(step(culled, plan).command).toEqual({ type: 'buyCard', definitionId: 'footwork' });
  });

  it('finishes the Buy phase even when the treasure fallback names Copper', { timeout: 5000 }, () => {
    const plan = strategy({ buyAgenda: [], treasureFallback: ['copper', 'silver'] });
    const commands = buyRun(buyState({ money: 7 }), plan);
    expect(bought(commands)).toEqual(['silver', 'silver']);
    expect(commands.at(-1)!.type).toBe('endBuyPhase');
  });
});

describe('strategy agent dispatch', () => {
  it('answers a Buy-phase state from the agenda and an Action-phase state from the search', () => {
    const agent = strategyAgent(strategy({
      id: 'dispatch', buyAgenda: [{ cardId: 'footwork', desiredCount: 1 }],
      weights: weights({ moneyGained: 1 })
    }));

    const buying = buyState({ money: 10 });
    const buyActions = listLegalActions(buying);
    const buyChoice = agent.chooseAction(buying, 'ochre', buyActions);
    expect(buyActions).toContain(buyChoice);
    expect(buyChoice.command).toEqual({ type: 'buyCard', definitionId: 'footwork' });

    const acting = submitStartingBuild(submitStartingBuild(createGame({ seed: 2 }), 'ochre', ['footwork']), 'indigo', []);
    const actActions = listLegalActions(acting);
    const actChoice = agent.chooseAction(acting, 'ochre', actActions);
    expect(actActions).toContain(actChoice);
    expect(['endActionPhase', 'playFootwork']).toContain(actChoice.command.type);
  });

  it('repairs a starting build the kingdom cannot sell or cannot afford', () => {
    const melee = baselineStrategy('melee-rush');
    registerKingdom({
      id: 'no-blow', name: 'no-blow', startingHealth: 20,
      actionPiles: [{ cardId: 'drive', count: 10 }, { cardId: 'footwork', count: 10 }]
    });
    registerKingdom({
      id: 'pricey', name: 'pricey', startingHealth: 20,
      actionPiles: [{ cardId: 'heavyBlow', count: 10 }, { cardId: 'drive', count: 10 }, { cardId: 'footwork', count: 10 }],
      overrides: { heavyBlow: { cost: 20 }, drive: { cost: 20 }, footwork: { cost: 20 } }
    });
    const agent = strategyAgent(melee);

    for (const kingdomId of ['no-blow', 'pricey']) {
      const state = createGame({ seed: 1, kingdomId });
      const build = agent.chooseStartingBuild(state, 'ochre');
      expect(() => submitStartingBuild(state, 'ochre', build)).not.toThrow();
    }
    expect(repairBuild(createGame({ seed: 1, kingdomId: 'no-blow' }), melee.startingBuild)).toEqual(['drive', 'footwork']);
    expect(repairBuild(createGame({ seed: 1, kingdomId: 'pricey' }), melee.startingBuild)).toEqual([]);
  });

  it('repairs a badly overrun build in one call, and breaks a cost tie the same way every time', () => {
    const state = createGame({ seed: 1 });
    // Seven Gold is 42, thirty over the budget of 12.
    const overrun = repairBuild(state, Array<string>(7).fill('gold'));
    expect(marketCost(state, overrun)).toBeLessThanOrEqual(12);
    expect(overrun).toEqual(['gold', 'gold']);

    // Flurry and Muster both cost 5, so the tie falls to the lower definition id.
    const tied = ['flurry', 'muster', 'aim', 'aim'];
    expect(repairBuild(state, tied)).toEqual(['muster', 'aim', 'aim']);
    expect(repairBuild(state, tied)).toEqual(repairBuild(state, tied));
  });

  it('drops the most expensive card, not the last one', () => {
    const state = createGame({ seed: 1 });
    // 6 + 6 + 6 + 0 is 18. Dropping one Gold reaches 12; dropping from the end would take the free
    // Copper first and end at two Gold, keeping a strictly worse build for the same money.
    expect(repairBuild(state, ['gold', 'gold', 'gold', 'copper'])).toEqual(['gold', 'gold', 'copper']);
    // Expensive first, cheap last: an end-dropping rule never reaches the Gold at all.
    expect(repairBuild(state, ['gold', 'gold', 'silver', 'silver'])).toEqual(['gold', 'silver', 'silver']);
  });
});

describe('baseline starting builds', () => {
  beforeEach(() => { registerCuratedKingdoms(); });

  // Pins what each baseline actually opens with per kingdom. Plan 10-4 allows a build to repair away
  // to very little, so these are recorded rather than judged, and step 6 inherits the thin ones.
  const expected: Record<string, Record<string, string[]>> = {
    'current-duel': {
      'treasure-only': [], 'melee-rush': ['drive', 'footwork'], 'ranged-standard': ['volley', 'aim', 'footwork'],
      'mage-standard': ['footwork'], 'engine-draw': ['muster', 'footwork']
    },
    'three-way-open': {
      'treasure-only': [], 'melee-rush': ['heavyBlow', 'drive', 'footwork'], 'ranged-standard': ['volley', 'aim', 'footwork'],
      'mage-standard': ['channel', 'arcBolt', 'leyStep', 'footwork'], 'engine-draw': ['stipend', 'footwork']
    },
    'three-way-engine': {
      'treasure-only': [], 'melee-rush': ['heavyBlow', 'footwork'], 'ranged-standard': ['footwork'],
      'mage-standard': ['channel', 'footwork'], 'engine-draw': ['muster', 'stipend', 'footwork']
    },
    'range-rich-mixed': {
      'treasure-only': [], 'melee-rush': ['heavyBlow', 'drive', 'footwork'], 'ranged-standard': ['volley', 'aim', 'footwork'],
      'mage-standard': ['channel', 'arcBolt', 'footwork'], 'engine-draw': ['footwork']
    },
    'rigged-melee': {
      'treasure-only': [], 'melee-rush': ['heavyBlow', 'drive', 'footwork'], 'ranged-standard': ['volley', 'aim', 'footwork'],
      'mage-standard': ['channel', 'arcBolt', 'leyStep', 'footwork'], 'engine-draw': ['stipend', 'footwork']
    }
  };

  it('repairs every baseline into a build each curated kingdom accepts', () => {
    for (const kingdom of CURATED_KINGDOMS) {
      for (const plan of BASELINE_STRATEGIES) {
        const state = createGame({ seed: 1, kingdomId: kingdom.id });
        const build = repairBuild(state, plan.startingBuild);
        expect(build, `${kingdom.id}/${plan.id}`).toEqual(expected[kingdom.id]![plan.id]);
        expect(marketCost(state, build), `${kingdom.id}/${plan.id}`).toBeLessThanOrEqual(12);
        expect(() => submitStartingBuild(state, 'ochre', build)).not.toThrow();
      }
    }
  });

  it('keeps Heavy Blow in Rigged melee only because the override makes it affordable', () => {
    const rigged = createGame({ seed: 1, kingdomId: 'rigged-melee' });
    const open = createGame({ seed: 1, kingdomId: 'three-way-open' });
    const melee = baselineStrategy('melee-rush').startingBuild;
    expect(marketCost(rigged, melee)).toBe(10);
    expect(marketCost(open, melee)).toBe(12);
  });
});

describe('strategy agent match boundaries', () => {
  beforeEach(() => { registerCuratedKingdoms(); });

  // The first match lasts one turn per player, so each agent's stored phase key is still turn 1 when
  // the second match asks about turn 1. That collision is the only way a phase key alone lets a
  // baseline and a memo survive into a different game.
  const SPECS: readonly [string, number][] = [['current-duel', 1], ['three-way-engine', 4]];

  function playPair(reuse: boolean): { results: MatchResult[]; visited: number[][] } {
    const visited: number[][] = [[], []];
    let index = 0;
    const make = (id: string): Agent =>
      strategyAgent(baselineStrategy(id), { onSearch: (report) => visited[index]!.push(report.visited) });
    const held: Record<PlayerId, Agent> = { ochre: make('ranged-standard'), indigo: make('melee-rush') };
    const results = SPECS.map(([kingdomId, turnLimitPerPlayer], position) => {
      index = position;
      const agents = reuse ? held : { ochre: make('ranged-standard'), indigo: make('melee-rush') };
      const settings: MatchConfig = {
        kingdomId, seed: 3, firstPlayerId: 'ochre', swapSides: false,
        turnLimitPerPlayer, actionCapPerTurn: 200, agents
      };
      return runMatch(settings);
    });
    return { results, visited };
  }

  it('does not carry a baseline or memo from one match into the next', () => {
    const fresh = playPair(false);
    const reused = playPair(true);

    // A leaked memo entry is served instead of being searched, so the second match expands fewer
    // states than the same match played by an agent that has seen nothing.
    expect(reused.visited).toEqual(fresh.visited);
    expect(reused.results).toEqual(fresh.results);
    expect(fresh.visited[1]!.length).toBeGreaterThan(0);
  });
});

describe('strategy agent search limits', () => {
  beforeEach(() => { registerCuratedKingdoms(); });

  it('aborts the match when the search passes its state limit', () => {
    const cramped = strategyAgent(baselineStrategy('ranged-standard'), { stateLimit: 1 });
    const result = runMatch({
      kingdomId: 'current-duel', seed: 6, firstPlayerId: 'ochre', swapSides: false,
      turnLimitPerPlayer: 20, actionCapPerTurn: 200,
      agents: { ochre: cramped, indigo: strategyAgent(baselineStrategy('treasure-only')) }
    });
    expect(result.outcome).toBe('aborted');
    expect(result.reason).toBe('actionSearchOverflow');
    expect(result.telemetry.eventCount).toBeGreaterThan(0);
  });
});

describe('baseline coverage', () => {
  beforeEach(() => { registerCuratedKingdoms(); });

  it('plays every baseline pair in every curated kingdom without throwing', { timeout: 120_000 }, () => {
    const kingdoms: readonly Kingdom[] = CURATED_KINGDOMS;
    let matches = 0;
    for (const kingdom of kingdoms) {
      for (const ochre of BASELINE_STRATEGIES) {
        for (const indigo of BASELINE_STRATEGIES) {
          const result = runMatch({
            kingdomId: kingdom.id, seed: 17, firstPlayerId: 'ochre', swapSides: matches % 2 === 1,
            turnLimitPerPlayer: 3, actionCapPerTurn: 200,
            agents: { ochre: strategyAgent(ochre), indigo: strategyAgent(indigo) }
          });
          expect(result.reason, `${kingdom.id} ${ochre.id} vs ${indigo.id}`).not.toBe('actionSearchOverflow');
          expect(result.turns, `${kingdom.id} ${ochre.id} vs ${indigo.id}`).toBeGreaterThan(0);
          matches += 1;
        }
      }
    }
    expect(matches).toBe(kingdoms.length * BASELINE_STRATEGIES.length ** 2);
  });
});
