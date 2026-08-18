import { afterEach, describe, expect, it } from 'vitest';
import {
  applyAction, createCard, createGame, listLegalActions, registerKingdom, resetKingdoms, submitStartingBuild
} from '../../src/game';
import type { ActionAvailability, GameEvent, GameState, PlayerId } from '../../src/game';
import { accumulate, createAccumulator, deadDrawCounts } from '../../src/sim/telemetry';
import type { TelemetrySlice } from '../../src/sim/telemetry';

const EMPTY_BUILD = { ochre: [], indigo: [] };

function event(sequence: number, type: GameEvent['type'], playerId: PlayerId, detail: Record<string, unknown>): GameEvent {
  return { sequence, type, playerId, detail };
}
function run(slice: TelemetrySlice) {
  return accumulate(createAccumulator(EMPTY_BUILD), slice).telemetry;
}
function availability(cardInstanceId: string, overrides: Partial<ActionAvailability> = {}): ActionAvailability {
  return {
    cardInstanceId, enabled: false, reasonCode: null, reason: null,
    selection: 'none', eligibleCardInstanceIds: [], movements: [], ...overrides
  };
}
function handOf(state: GameState, playerId: PlayerId, definitionIds: readonly string[]): void {
  state.players[playerId].deck.hand = definitionIds.map((id) => createCard(state, id));
}

afterEach(() => { resetKingdoms(); });

describe('telemetry accumulator', () => {
  it('attributes every damage event of a slice to the card that produced it', () => {
    const telemetry = run({
      completedTurns: 3,
      events: [
        event(0, 'cardPlayed', 'ochre', { cardInstanceId: 'card-1', definitionId: 'drive' }),
        event(1, 'damage', 'ochre', { targetId: 'indigo', amount: 2, health: 18 }),
        event(2, 'wallCollision', 'ochre', { targetId: 'indigo', direction: 'right' }),
        event(3, 'damage', 'ochre', { targetId: 'indigo', amount: 2, health: 16 })
      ]
    });
    expect(telemetry.damageByCard.ochre).toEqual({ drive: 4 });
    expect(telemetry.damageByCard.indigo).toEqual({});
    expect(telemetry.playsByCard.ochre).toEqual({ drive: 1 });
    expect(telemetry.eventCount).toBe(4);
  });

  it('records raw damage, so a killing blow exceeds the health the target lost', () => {
    registerKingdom({
      id: 'overkill', name: 'overkill', startingHealth: 20,
      actionPiles: [{ cardId: 'heavyBlow', count: 10 }],
      overrides: { heavyBlow: { values: { damage: 25 } } }
    });
    let state = submitStartingBuild(submitStartingBuild(createGame({ seed: 1, kingdomId: 'overkill' }), 'ochre', []), 'indigo', []);
    state.fighters.indigo.position = state.fighters.ochre.position;
    handOf(state, 'ochre', ['heavyBlow']);
    const before = state.events.length;
    const play = listLegalActions(state).find((action) => action.command.type === 'playAction');
    state = applyAction(state, play!.id);

    const telemetry = run({ events: state.events.slice(before), completedTurns: state.turn - 1 });
    expect(state.fighters.indigo.health).toBe(0);
    expect(telemetry.damageByCard.ochre.heavyBlow).toBe(25);
    expect(telemetry.damageByCard.ochre.heavyBlow!).toBeGreaterThan(state.startingHealth - state.fighters.indigo.health);
    expect(telemetry.turnsToWin).toBe(state.turn - 1);
  });

  it('counts purchases, spending, unspent money, and the winning turn', () => {
    const telemetry = run({
      completedTurns: 6,
      unspentMoney: { playerId: 'indigo', amount: 4 },
      events: [
        event(0, 'purchase', 'indigo', { definitionId: 'volley', cost: 5 }),
        event(1, 'purchase', 'indigo', { definitionId: 'volley', cost: 5 }),
        event(2, 'purchase', 'indigo', { definitionId: 'silver', cost: 3 }),
        event(3, 'victory', 'indigo', { winner: 'indigo' })
      ]
    });
    expect(telemetry.purchasesByCard.indigo).toEqual({ volley: 2, silver: 1 });
    expect(telemetry.moneySpent).toEqual({ ochre: 0, indigo: 13 });
    expect(telemetry.unspentMoney).toEqual({ ochre: 0, indigo: 4 });
    expect(telemetry.turnsToWin).toBe(6);
  });

  it('classifies dead draws from the availability list read before the phase ends', () => {
    const state = createGame({ seed: 1 });
    handOf(state, 'ochre', ['volley', 'arcBolt', 'muster', 'copper', 'volley', 'flurry']);
    const [blockedVolley, blockedBolt, blockedMuster, treasure, liveVolley, liveFlurry] = state.players.ochre.deck.hand;
    const list: ActionAvailability[] = [
      availability(blockedVolley!.id, { reasonCode: 'NEEDS_NEAR_OR_FAR' }),
      availability(blockedBolt!.id, { reasonCode: 'NEEDS_MANA' }),
      availability(blockedMuster!.id, { reasonCode: 'RESOLVE_CHOICE_FIRST' }),
      availability(treasure!.id, { reasonCode: 'TREASURE_AUTOPLAYS' }),
      availability(liveVolley!.id, { enabled: true }),
      availability(liveFlurry!.id, { enabled: true })
    ];

    expect(state.fighters.ochre.aimed).toBe(false);
    expect(deadDrawCounts({ playerId: 'ochre', state, availability: list })).toEqual({ range: 1, mana: 1, setup: 2, total: 3 });
  });

  it('drops the setup count once the missing setup is present', () => {
    const state = createGame({ seed: 1 });
    handOf(state, 'ochre', ['volley', 'flurry']);
    const [volley, flurry] = state.players.ochre.deck.hand;
    const list: ActionAvailability[] = [
      availability(volley!.id, { enabled: true }),
      availability(flurry!.id, { enabled: true })
    ];
    state.fighters.ochre.aimed = true;
    state.actionsThisTurn = ['footwork'];
    expect(deadDrawCounts({ playerId: 'ochre', state, availability: list })).toEqual({ range: 0, mana: 0, setup: 0, total: 0 });
  });

  it('accumulates dead draws into the running telemetry per player', () => {
    const state = createGame({ seed: 1 });
    handOf(state, 'indigo', ['volley']);
    const list = [availability(state.players.indigo.deck.hand[0]!.id, { reasonCode: 'NEEDS_NEAR_OR_FAR' })];
    const first = accumulate(createAccumulator(EMPTY_BUILD), {
      events: [], completedTurns: 0, deadDraws: { playerId: 'indigo', state, availability: list }
    });
    const second = accumulate(first, {
      events: [], completedTurns: 0, deadDraws: { playerId: 'indigo', state, availability: list }
    });
    expect(second.telemetry.deadDraws.indigo).toEqual({ range: 2, mana: 0, setup: 0, total: 2 });
    expect(second.telemetry.deadDraws.ochre).toEqual({ range: 0, mana: 0, setup: 0, total: 0 });
    expect(first.telemetry.deadDraws.indigo).toEqual({ range: 1, mana: 0, setup: 0, total: 1 });
  });
});
