import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyAction, createGame, listLegalActions, registerKingdom, resetKingdoms, submitStartingBuild
} from '../../src/game';
import type { GameCommand, GameState, Kingdom } from '../../src/game';
import { BASELINE_STRATEGIES, baselineStrategy } from '../../src/sim/baselines';
import { chooseBuyAction, ownedCount } from '../../src/sim/buy';
import { repairBuild, strategyAgent } from '../../src/sim/agents/strategyAgent';
import { runMatch } from '../../src/sim/match';
import type { Strategy } from '../../src/sim/strategy';
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
      actionPiles: [{ cardId: 'drive', count: 10 }, { cardId: 'step', count: 10 }]
    });
    registerKingdom({
      id: 'pricey', name: 'pricey', startingHealth: 20,
      actionPiles: [{ cardId: 'heavyBlow', count: 10 }, { cardId: 'drive', count: 10 }, { cardId: 'step', count: 10 }],
      overrides: { heavyBlow: { cost: 20 }, drive: { cost: 20 }, step: { cost: 20 } }
    });
    const agent = strategyAgent(melee);

    for (const kingdomId of ['no-blow', 'pricey']) {
      const state = createGame({ seed: 1, kingdomId });
      const build = agent.chooseStartingBuild(state, 'ochre');
      expect(() => submitStartingBuild(state, 'ochre', build)).not.toThrow();
    }
    expect(repairBuild(createGame({ seed: 1, kingdomId: 'no-blow' }), melee.startingBuild)).toEqual(['drive', 'step']);
    expect(repairBuild(createGame({ seed: 1, kingdomId: 'pricey' }), melee.startingBuild)).toEqual([]);
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
