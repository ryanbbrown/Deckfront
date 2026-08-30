import { afterEach, describe, expect, it } from 'vitest';
import {
  applyAction, createGame, listLegalActions, marketCost, registerKingdom, resetKingdoms, submitStartingBuild
} from '../../src/game';
import type { GameCommand, GameState, PlayerId } from '../../src/game';
import { acquiredCount, chooseBuyAction, projectPurchases } from '../../src/sim/buy';
import { strategyAgent } from '../../src/sim/agents/strategyAgent';
import { repairBuild } from '../../src/sim/build';
import { runMatch } from '../../src/sim/match';
import { INFINITE_COUNT } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import type { Agent, MatchConfig, MatchResult } from '../../src/sim/types';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';
import { diagnosticLabels, diagnosticStrategies } from '../../src/sim/baselines';
import { strategy } from './fixtures';

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

function seedByLabel(kingdomId: string, label: string): Strategy {
  const labels = diagnosticLabels(kingdomId);
  const found = diagnosticStrategies(kingdomId).find((entry) => labels.get(entry.id) === label);
  if (!found) throw new Error(`No ${label} seed in ${kingdomId}.`);
  return found;
}

describe('fixed buy ladder', () => {
  it('uses an explicit stop threshold without blocking a cheaper low-money purchase', () => {
    const plan = strategy({ buyPlan: [
      { kind: 'buy', cardId: 'heavyBlow', desiredCount: 1 },
      { kind: 'stop', threshold: 3 },
      { kind: 'buy', cardId: 'step', desiredCount: INFINITE_COUNT }
    ] });
    expect(bought(buyRun(buyState({ money: 4 }), plan))).toEqual([]);
    expect(bought(buyRun(buyState({ money: 3 }), plan))).toEqual([]);
    expect(bought(buyRun(buyState({ money: 2 }), plan))).toEqual(['step']);
    expect(projectPurchases(buyState({ money: 4 }), 'ochre', 4, plan).bought)
      .toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('lets an infinite buy slot act as a floor anywhere in the ladder', () => {
    const plan = strategy({ buyPlan: [
      { kind: 'buy', cardId: 'heavyBlow', desiredCount: 1 },
      { kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT },
      { kind: 'buy', cardId: 'step', desiredCount: INFINITE_COUNT }
    ] });
    expect(bought(buyRun(buyState({ money: 3 }), plan))).toEqual(['footwork']);
    expect(bought(buyRun(buyState({ money: 2 }), plan))).toEqual(['step']);
  });

  it('buys finite targets, then repeats the explicit final card', () => {
    const plan = strategy({ buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: 2 }, { kind: 'buy', cardId: 'aim', desiredCount: INFINITE_COUNT }] });
    const commands = buyRun(buyState({ money: 20 }), plan);
    expect(bought(commands)).toEqual(['footwork', 'footwork', 'aim', 'aim']);
    expect(commands.at(-1)!.type).toBe('endBuyPhase');
  });

  it('skips an unavailable finite entry', () => {
    const plan = strategy({
      buyPlan: [{ kind: 'buy', cardId: 'heavyBlow', desiredCount: 2 }, { kind: 'buy', cardId: 'footwork', desiredCount: 1 }, { kind: 'buy', cardId: 'aim', desiredCount: INFINITE_COUNT }]
    });
    expect(bought(buyRun(buyState({ money: 6 }), plan))).toEqual(['footwork']);

    const exhausted = buyState({ money: 6 });
    exhausted.supply.footwork = 0;
    expect(bought(buyRun(exhausted, plan))).toEqual(['aim']);
  });

  it('prices Heavy Blow through the kingdom override, not the card data', () => {
    registerKingdom({
      id: 'cheap-blow', name: 'cheap-blow', startingHealth: 20,
      actionPiles: [{ cardId: 'heavyBlow', count: 10 }],
      overrides: { heavyBlow: { cost: 3 } }
    });
    const plan = strategy({ buyPlan: [{ kind: 'buy', cardId: 'heavyBlow', desiredCount: 1 }, { kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }] });

    const atFive = step(buyState({ kingdomId: 'cheap-blow', money: 5 }), plan);
    expect(atFive.command).toEqual({ type: 'buyCard', definitionId: 'heavyBlow' });
    expect(atFive.state.players.ochre.money).toBe(2);   // charged 3, not the base 5

    // The base cost of 5 would put Heavy Blow out of reach at 3 money.
    const atThree = step(buyState({ kingdomId: 'cheap-blow', money: 3 }), plan);
    expect(atThree.command).toEqual({ type: 'buyCard', definitionId: 'heavyBlow' });
  });

  it('does not buy a finite target already acquired in the starting build', () => {
    const state = buyState({ money: 5 });
    state.players.ochre.startingBuild = ['footwork'];
    const plan = strategy({ buyPlan: [
      { kind: 'buy', cardId: 'footwork', desiredCount: 1 },
      { kind: 'buy', cardId: 'aim', desiredCount: INFINITE_COUNT }
    ] });
    expect(bought(buyRun(state, plan))).toEqual(['aim']);
  });

  it('does not buy a trashed purchased card again', () => {
    const plan = strategy({ buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: 1 }, { kind: 'buy', cardId: 'aim', desiredCount: INFINITE_COUNT }] });
    const first = step(buyState({ money: 20 }), plan);
    expect(first.command).toEqual({ type: 'buyCard', definitionId: 'footwork' });
    expect(acquiredCount(first.state, 'ochre', 'footwork')).toBe(1);
    expect(first.state.players.ochre.purchases).toEqual(['footwork']);

    const culled = structuredClone(first.state);
    const deck = culled.players.ochre.deck;
    const index = deck.discard.findIndex((card) => card.definitionId === 'footwork');
    culled.trash.push(...deck.discard.splice(index, 1));
    expect(culled.players.ochre.purchases).toEqual(['footwork']);
    expect(step(culled, plan).command).toEqual({ type: 'buyCard', definitionId: 'aim' });
  });

  it('never buys Copper even from an unnormalized plan', { timeout: 5000 }, () => {
    const plan = strategy({
      buyPlan: [{ kind: 'buy', cardId: 'copper', desiredCount: 10 }, { kind: 'buy', cardId: 'copper', desiredCount: INFINITE_COUNT }]
    });
    const commands = buyRun(buyState({ money: 7 }), plan);
    expect(bought(commands)).toEqual([]);
    expect(commands.at(-1)!.type).toBe('endBuyPhase');
  });

  it('projects the same 101 unlimited purchases the real Buy phase executes', () => {
    const state = buyState({ money: 303 });
    const plan = strategy({ buyPlan: [{ kind: 'buy', cardId: 'silver', desiredCount: INFINITE_COUNT }] });
    expect(projectPurchases(state, 'ochre', 303, plan)).toEqual({
      bought: [101, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    });
    const actual = buyRun(state, plan, 102);
    expect(bought(actual)).toEqual(Array<string>(101).fill('silver'));
    expect(actual.at(-1)?.type).toBe('endBuyPhase');
  });
});

describe('strategy agent dispatch', () => {
  it('answers a Buy-phase state from the agenda and an Action-phase state from the search', () => {
    const agent = strategyAgent(strategy({
      id: 'dispatch', buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: 1 }]
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
    const melee = seedByLabel('three-way-open', 'melee');
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

    // Muster is not sold in Distance Duel; the legal equal-cost cards remain in stable order.
    const tied = ['flurry', 'muster', 'aim', 'aim'];
    expect(repairBuild(state, tied)).toEqual(['flurry', 'aim']);
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

describe('seed starting builds', () => {
  it('submits every complete seed build without repair', () => {
    for (const kingdomId of CURATED_KINGDOM_IDS) {
      for (const plan of diagnosticStrategies(kingdomId)) {
        const state = createGame({ seed: 1, kingdomId });
        const build = repairBuild(state, plan.startingBuild);
        expect(build, `${kingdomId}/${plan.id}`).toEqual(plan.startingBuild);
        expect(marketCost(state, build), `${kingdomId}/${plan.id}`).toBeLessThanOrEqual(12);
        expect(() => submitStartingBuild(state, 'ochre', build)).not.toThrow();
      }
    }
  });

});

describe('strategy agent match boundaries', () => {
  // The first match lasts one turn per player, so each agent's stored phase key is still turn 1 when
  // the second match asks about turn 1. That collision is the only way a phase key alone lets a
  // baseline and a memo survive into a different game.
  const SPECS: readonly [string, number][] = [['current-duel', 1], ['three-way-engine', 4]];

  function playPair(reuse: boolean): { results: MatchResult[]; visited: number[][] } {
    const visited: number[][] = [[], []];
    let index = 0;
    const plans = [
      strategy({ startingBuild: ['muster', 'footwork'], buyPlan: [{ kind: 'buy', cardId: 'muster', desiredCount: 2 }] }),
      strategy({ startingBuild: ['footwork'], buyPlan: [{ kind: 'buy', cardId: 'footwork', desiredCount: 2 }] })
    ];
    const make = (position: number): Agent =>
      strategyAgent(plans[position]!, { onSearch: (report) => visited[index]!.push(report.visited) });
    const held: Record<PlayerId, Agent> = { ochre: make(0), indigo: make(1) };
    const results = SPECS.map(([kingdomId, turnLimitPerPlayer], position) => {
      index = position;
      const agents = reuse ? held : { ochre: make(0), indigo: make(1) };
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
  it('aborts the match when the search passes its state limit', () => {
    const cramped = strategyAgent(seedByLabel('current-duel', 'ranged-aim'), { stateLimit: 1 });
    const result = runMatch({
      kingdomId: 'current-duel', seed: 6, firstPlayerId: 'ochre', swapSides: false,
      turnLimitPerPlayer: 20, actionCapPerTurn: 200,
      agents: { ochre: cramped, indigo: strategyAgent(strategy({ startingBuild: [], buyPlan: [] })) }
    });
    expect(result.outcome).toBe('aborted');
    expect(result.reason).toBe('actionSearchOverflow');
    expect(result.telemetry.eventCount).toBeGreaterThan(0);
  });
});

describe('seed coverage', () => {
  it('plays every seed pair in every curated kingdom without throwing', { timeout: 120_000 }, () => {
    const kingdomIds = CURATED_KINGDOM_IDS;
    let matches = 0;
    for (const kingdomId of kingdomIds) {
      const seeds = diagnosticStrategies(kingdomId);
      for (const ochre of seeds) {
        for (const indigo of seeds) {
          const result = runMatch({
            kingdomId, seed: 17, firstPlayerId: 'ochre', swapSides: matches % 2 === 1,
            turnLimitPerPlayer: 3, actionCapPerTurn: 200,
            agents: { ochre: strategyAgent(ochre), indigo: strategyAgent(indigo) }
          });
          expect(result.reason, `${kingdomId} ${ochre.id} vs ${indigo.id}`).not.toBe('actionSearchOverflow');
          expect(result.turns, `${kingdomId} ${ochre.id} vs ${indigo.id}`).toBeGreaterThan(0);
          matches += 1;
        }
      }
    }
    expect(matches).toBe(kingdomIds.length * 5 ** 2);
  });
});
