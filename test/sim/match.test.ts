import { afterEach, describe, expect, it } from 'vitest';
import {
  applyAction, assertInvariants, cloneGame, createGame, listLegalActions, rangeBand, registerKingdom,
  resetKingdoms, submitStartingBuild
} from '../../src/game';
import type { GameEvent, GameState, LegalAction, PlayerId } from '../../src/game';
import { runMatch } from '../../src/sim/match';
import { ActionSearchOverflowError } from '../../src/sim/types';
import type { Agent, MatchConfig, MatchResult } from '../../src/sim/types';
import { scriptedAgent } from './scripted';

function config(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    kingdomId: 'distance-duel', seed: 11, firstPlayerId: 'ochre', swapSides: false,
    turnLimitPerPlayer: 3, actionCapPerTurn: 200,
    agents: { ochre: scriptedAgent({ id: 'ochre-agent' }), indigo: scriptedAgent({ id: 'indigo-agent' }) },
    ...overrides
  };
}
function passiveAgents(observe?: (state: GameState, playerId: PlayerId) => void): Record<PlayerId, Agent> {
  return {
    ochre: scriptedAgent({ id: 'ochre-agent', ...(observe ? { observe } : {}) }),
    indigo: scriptedAgent({ id: 'indigo-agent', ...(observe ? { observe } : {}) })
  };
}
/** Agents that build, play, and buy, so the shuffle order reaches the event log. */
function busyAgents(): Record<PlayerId, Agent> {
  return {
    ochre: scriptedAgent({
      id: 'ochre-agent', builds: { ochre: ['footwork', 'aim', 'volley'] },
      play: ['aim', 'volley', 'footwork'], buy: ['footwork', 'silver']
    }),
    indigo: scriptedAgent({
      id: 'indigo-agent', builds: { indigo: ['muster', 'feint', 'footwork'] },
      play: ['muster', 'footwork', 'feint'], buy: ['muster', 'silver']
    })
  };
}
/** Runs a match and keeps the state its last applied action produced. */
function play(overrides: Partial<MatchConfig> = {}): { result: MatchResult; final: GameState; log: GameEvent[] } {
  let final: GameState | null = null;
  const result = runMatch(config(overrides), (state) => { final = state; });
  if (!final) throw new Error('The match applied no action.');
  return { result, final, log: (final as GameState).events };
}
/** Registers a kingdom whose Steady Shot kills at the Near range both fighters start in. */
function lethalKingdom(): void {
  registerKingdom({
    id: 'sim-lethal', name: 'sim-lethal', startingHealth: 20,
    actionPiles: [{ cardId: 'steadyShot', count: 10 }, { cardId: 'footwork', count: 10 }],
    overrides: { steadyShot: { cost: 1, values: { damage: 25 } } }
  });
}

afterEach(() => { resetKingdoms(); });

describe('runMatch determinism', () => {
  it('repeats a result exactly and produces a different event log for a different seed', () => {
    const first = play({ agents: busyAgents() });
    const second = play({ agents: busyAgents() });
    expect(second.result).toEqual(first.result);
    expect(second.log).toEqual(first.log);

    // The log compared is the complete one. `sequence` is the event's own index, so a final event
    // sitting at `length - 1` proves nothing was left off the end.
    expect(first.log.length).toBeGreaterThan(0);
    expect(first.log.at(-1)!.sequence).toBe(first.log.length - 1);

    const other = play({ seed: 99, agents: busyAgents() });
    expect(other.log).not.toEqual(first.log);
    expect(other.result.config.seed).toBe(99);
  });
});

describe('runMatch stop conditions', () => {
  it('stops at the turn limit with a draw, on the exact half-turn boundary', () => {
    const result = runMatch(config({ turnLimitPerPlayer: 2 }));
    expect(result.outcome).toBe('draw');
    expect(result.reason).toBe('turnLimit');
    expect(result.turns).toBe(4);

    // The boundary the runner tests is `state.turn > turnLimitPerPlayer * 2`. Four completed player
    // turns leave `state.turn` at 5, which this engine-level replay pins independently.
    let state = submitStartingBuild(submitStartingBuild(createGame({ seed: 11 }), 'ochre', []), 'indigo', []);
    expect(state.turn).toBe(1);
    for (let half = 0; half < 4; half += 1) {
      for (const type of ['endActionPhase', 'endBuyPhase'] as const) {
        state = applyAction(state, listLegalActions(state).find((action) => action.command.type === type)!.id);
      }
    }
    expect(state.turn).toBe(5);
    expect(state.turn - 1).toBe(result.turns);
  });

  it('reports a victory for a lethal line, including one struck on the limit turn', () => {
    lethalKingdom();
    const killer = scriptedAgent({
      id: 'killer', builds: { ochre: Array<string>(12).fill('steadyShot') }, play: ['steadyShot']
    });
    const result = runMatch(config({
      kingdomId: 'sim-lethal', seed: 4, firstPlayerId: 'indigo', turnLimitPerPlayer: 1,
      agents: { ochre: killer, indigo: scriptedAgent({ id: 'idle' }) }
    }));
    expect(result.outcome).toBe('ochre');
    expect(result.reason).toBe('victory');
    expect(result.turns).toBe(1);
    expect(result.telemetry.turnsToWin).toBe(1);
    expect(result.telemetry.finalHealth.indigo).toBe(0);
    expect(result.telemetry.damageByCard.ochre.steadyShot).toBe(25);
  });

  it('stops a Copper-buying agent at the action cap instead of hanging', { timeout: 10_000 }, () => {
    const buyer = scriptedAgent({ id: 'copper-buyer', buy: ['copper'] });
    const result = runMatch(config({ actionCapPerTurn: 40, turnLimitPerPlayer: 100, agents: { ochre: buyer, indigo: buyer } }));
    expect(result.outcome).toBe('draw');
    expect(result.reason).toBe('actionCap');
    expect(result.telemetry.purchasesByCard.ochre.copper).toBeGreaterThanOrEqual(39);
  });

  it('counts the action that ends a turn against the cap of the turn it ended', () => {
    // A passive agent spends exactly two actions per turn: end the Action phase, end the Buy phase.
    // The second advances the turn, so a cap of 1 is only tripped if that action still counts.
    const capped = runMatch(config({ actionCapPerTurn: 1, turnLimitPerPlayer: 5 }));
    expect(capped.reason).toBe('actionCap');
    expect(capped.outcome).toBe('draw');

    // A cap of 2 is exactly enough, which pins the boundary from the other side.
    const roomy = runMatch(config({ actionCapPerTurn: 2, turnLimitPerPlayer: 5 }));
    expect(roomy.reason).toBe('turnLimit');
    expect(roomy.turns).toBe(10);
  });

  it('reads the command from the offered action, not from the object the agent returned', () => {
    // Same id, wrong command. The runner picks its telemetry snapshot from the command, so trusting
    // the returned object would take the money branch on every action and never the dead-draw one.
    const spoofing = (inner: Agent): Agent => ({
      id: inner.id,
      chooseStartingBuild: (state, playerId) => inner.chooseStartingBuild(state, playerId),
      chooseAction: (state, playerId, actions) => ({
        ...inner.chooseAction(state, playerId, actions), command: { type: 'endBuyPhase' }
      })
    });
    // A melee build stuck at range produces real dead draws, so both snapshots carry a value the
    // spoof would move. With all-zero telemetry the comparison below would prove nothing.
    const agents = (wrap: boolean): Record<PlayerId, Agent> => {
      const ochre = scriptedAgent({ id: 'melee', builds: { ochre: ['drive', 'feint', 'feint'] } });
      const indigo = scriptedAgent({ id: 'idle', buy: ['silver'] });
      return wrap ? { ochre: spoofing(ochre), indigo: spoofing(indigo) } : { ochre, indigo };
    };
    const settings = { seed: 3, turnLimitPerPlayer: 4 };
    const reference = runMatch(config({ ...settings, agents: agents(false) }));
    expect(reference.telemetry.deadDraws.ochre.total).toBeGreaterThan(0);
    expect(reference.telemetry.moneySpent.indigo).toBeGreaterThan(0);

    expect(runMatch(config({ ...settings, agents: agents(true) }))).toEqual(reference);
  });

  it('aborts on an action-search overflow and keeps the telemetry gathered so far', () => {
    let decisions = 0;
    const overflowing: Agent = {
      id: 'overflowing',
      chooseStartingBuild: () => ['footwork'],
      chooseAction: (state, playerId, actions) => {
        decisions += 1;
        if (decisions > 5) throw new ActionSearchOverflowError('state limit reached');
        return scriptedAgent({ buy: ['footwork'] }).chooseAction(state, playerId, actions);
      }
    };
    const result = runMatch(config({ turnLimitPerPlayer: 20, agents: { ochre: overflowing, indigo: scriptedAgent({ id: 'idle' }) } }));
    expect(result.outcome).toBe('aborted');
    expect(result.reason).toBe('actionSearchOverflow');
    expect(result.telemetry.eventCount).toBeGreaterThan(0);
    expect(result.telemetry.startingBuild.ochre).toEqual(['footwork']);
    expect(result.telemetry.purchasesByCard.ochre.footwork).toBeGreaterThan(0);
  });

  it('rejects an action the agent was never offered, naming the agent', () => {
    const cheat: Agent = {
      id: 'cheating-agent',
      chooseStartingBuild: () => [],
      chooseAction: (): LegalAction => ({ id: 'v0-action-99', label: 'invented', command: { type: 'endActionPhase' } })
    };
    expect(() => runMatch(config({ agents: { ochre: cheat, indigo: scriptedAgent() } })))
      .toThrow(/cheating-agent returned an action it was not offered/);
  });
});

describe('runMatch seating', () => {
  it('exchanges the starting positions when swapSides is set', () => {
    const swapped = createGame({ seed: 1, swapSides: true });
    expect(swapped.fighters.ochre.position).toBe(3);
    expect(swapped.fighters.indigo.position).toBe(2);
    expect(rangeBand(swapped)).toBe('Near');
    assertInvariants(swapped);

    const normal = createGame({ seed: 1 });
    expect(normal.fighters.ochre.position).toBe(2);
    expect(normal.fighters.indigo.position).toBe(3);

    const seen: GameState[] = [];
    runMatch(config({ swapSides: true, turnLimitPerPlayer: 1, agents: passiveAgents((state) => { if (!seen.length) seen.push(cloneGame(state)); }) }));
    expect(seen[0]!.fighters.ochre.position).toBe(3);
    expect(seen[0]!.fighters.indigo.position).toBe(2);
  });

  it('changes who acts on turn 1 without changing either deck shuffle', () => {
    const order: PlayerId[] = [];
    const decks: Record<string, string[]> = {};
    const record = (label: string) => (state: GameState, playerId: PlayerId): void => {
      if (state.version !== 2) return;                       // the first decision, before any action applies
      order.push(playerId);
      for (const id of ['ochre', 'indigo'] as const) {
        decks[`${label}-${id}`] = [...state.players[id].deck.draw, ...state.players[id].deck.hand].map((card) => card.definitionId);
      }
    };
    const build = { ochre: ['footwork', 'aim'], indigo: ['volley'] };
    runMatch(config({ seed: 21, firstPlayerId: 'ochre', turnLimitPerPlayer: 1, agents: {
      ochre: scriptedAgent({ id: 'a', builds: build, observe: record('first') }),
      indigo: scriptedAgent({ id: 'b', builds: build, observe: record('first') })
    } }));
    runMatch(config({ seed: 21, firstPlayerId: 'indigo', turnLimitPerPlayer: 1, agents: {
      ochre: scriptedAgent({ id: 'a', builds: build, observe: record('second') }),
      indigo: scriptedAgent({ id: 'b', builds: build, observe: record('second') })
    } }));

    expect(order).toEqual(['ochre', 'indigo']);
    expect(decks['second-ochre']).toEqual(decks['first-ochre']);
    expect(decks['second-indigo']).toEqual(decks['first-indigo']);
    expect(decks['first-ochre']).toHaveLength(9);
  });
});

describe('runMatch telemetry', () => {
  it('splits money between what a Buy phase spends and what it leaves, including the starting budget', () => {
    const oneFootwork: Agent = {
      id: 'one-footwork',
      chooseStartingBuild: () => [],
      chooseAction: (state, _playerId, actions) => {
        const buy = actions.find((action) => action.command.type === 'buyCard' && action.command.definitionId === 'footwork');
        if (state.phase === 'buy' && buy && !state.players[state.activePlayerId].purchases.length) return buy;
        return actions.at(-1)!;
      }
    };
    const result = runMatch(config({ seed: 5, turnLimitPerPlayer: 1, agents: { ochre: oneFootwork, indigo: scriptedAgent({ id: 'idle' }) } }));

    // An empty build leaves the whole 12 as firstBuyMoney, and the opening hand is five Coppers.
    expect(result.telemetry.moneySpent).toEqual({ ochre: 3, indigo: 0 });
    expect(result.telemetry.unspentMoney).toEqual({ ochre: 17 - 3, indigo: 17 });
    expect(result.telemetry.purchasesByCard.ochre).toEqual({ footwork: 1 });
    expect(result.telemetry.startingBuild).toEqual({ ochre: [], indigo: [] });
  });

  it('counts dead draws that a range gate blocked', () => {
    const result = runMatch(config({
      seed: 3, turnLimitPerPlayer: 4,
      agents: {
        ochre: scriptedAgent({ id: 'melee', builds: { ochre: ['drive', 'feint', 'feint'] } }),
        indigo: scriptedAgent({ id: 'idle' })
      }
    }));
    expect(result.telemetry.deadDraws.ochre.total).toBeGreaterThan(0);
    expect(result.telemetry.deadDraws.ochre.range).toBe(result.telemetry.deadDraws.ochre.total);
  });

  it('holds the invariants after every applied action of a full match', () => {
    const checked: number[] = [];
    const check = (state: GameState): void => { assertInvariants(state); checked.push(state.version); };
    const result = runMatch(config({ seed: 8, turnLimitPerPlayer: 3 }), check);

    expect(result.reason).toBe('turnLimit');
    expect(checked.length).toBeGreaterThan(6);
    // One version per applied action, with no gap, so the run covers the final state too.
    expect(checked).toEqual(checked.map((_, index) => checked[0]! + index));
  });

  it('holds the invariants on the state a lethal blow and an aborted search leave behind', () => {
    lethalKingdom();
    const killer = scriptedAgent({
      id: 'killer', builds: { ochre: Array<string>(12).fill('steadyShot') }, play: ['steadyShot']
    });
    let lethalFinal: GameState | null = null;
    const lethal = runMatch(config({
      kingdomId: 'sim-lethal', seed: 4, firstPlayerId: 'indigo', turnLimitPerPlayer: 1,
      agents: { ochre: killer, indigo: scriptedAgent({ id: 'idle' }) }
    }), (state) => { lethalFinal = state; });
    expect(lethal.outcome).toBe('ochre');
    expect(() => assertInvariants(lethalFinal!)).not.toThrow();
    expect((lethalFinal as unknown as GameState).phase).toBe('ended');

    let decisions = 0;
    const overflowing: Agent = {
      id: 'overflowing',
      chooseStartingBuild: () => ['footwork'],
      chooseAction: (state, playerId, actions) => {
        decisions += 1;
        if (decisions > 5) throw new ActionSearchOverflowError('state limit reached');
        return scriptedAgent({ buy: ['footwork'] }).chooseAction(state, playerId, actions);
      }
    };
    let abortedFinal: GameState | null = null;
    const aborted = runMatch(config({
      turnLimitPerPlayer: 20, agents: { ochre: overflowing, indigo: scriptedAgent({ id: 'idle' }) }
    }), (state) => { abortedFinal = state; });
    expect(aborted.outcome).toBe('aborted');
    expect(() => assertInvariants(abortedFinal!)).not.toThrow();
  });
});
