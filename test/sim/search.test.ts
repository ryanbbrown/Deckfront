import { afterEach, describe, expect, it } from 'vitest';
import {
  applyAction, kingdomMarket, listLegalActions, registerKingdom, resetKingdoms
} from '../../src/game';
import { EFFECTS, opponent, resolveCard } from '../../src/game';
import { applyLegalAction } from '../../src/game/engine';
import type { GameState } from '../../src/game';
import { createMemo, memoKey, scoreState, searchAction, searchBaseline } from '../../src/sim/search';
import { ActionSearchOverflowError } from '../../src/sim/types';
import { runMatch } from '../../src/sim/match';
import { strategyAgent } from '../../src/sim/agents/strategyAgent';
import { seedStrategies } from '../../src/sim/seedPopulation';
import { arena, choose, playPhase, strategy, weights } from './fixtures';

afterEach(() => { resetKingdoms(); });

function definitionOf(state: GameState, cardInstanceId: string): string | undefined {
  return state.players.ochre.deck.hand.find((card) => card.id === cardInstanceId)?.definitionId;
}
function trashedIds(state: GameState): string[] { return state.trash.map((card) => card.definitionId).sort(); }

describe('action search damage lines', () => {
  it('takes a lethal line even when an extreme weight pays far more for another', () => {
    const state = arena({ kingdomId: 'range-rich-mixed', hand: ['heavyBlow', 'cull'], ochre: 3, indigo: 3, health: 4 });
    // Culling Heavy Blow is worth 1e9 here and destroys the only lethal line. Lethality is a
    // separate lexicographic key, so it must still win.
    const greedy = strategy({ weights: weights({ trashed: 1e9 }), trashPriority: ['heavyBlow'] });
    const extreme = choose(state, greedy);
    expect('cardInstanceId' in extreme.command && definitionOf(state, extreme.command.cardInstanceId)).toBe('heavyBlow');

    const normal = strategy({ weights: weights({ damage: 10, trashed: 2 }), trashPriority: ['heavyBlow'] });
    const plain = choose(state, normal);
    expect('cardInstanceId' in plain.command && definitionOf(state, plain.command.cardInstanceId)).toBe('heavyBlow');
    expect(playPhase(state, greedy).fighters.indigo.health).toBe(0);
  });

  it('moves into Close before the melee blow that movement unlocks', () => {
    const state = arena({ kingdomId: 'range-rich-mixed', hand: ['footwork', 'heavyBlow'], draw: ['copper'], ochre: 2, indigo: 3, health: 4 });
    const plan = strategy({ preferredRange: 'Close', weights: weights({ damage: 10, preferredRange: 3 }) });
    const first = choose(state, plan);
    expect(first.command.type).toBe('playFootwork');
    expect('movement' in first.command && first.command.movement).toBe('right');

    const finished = playPhase(state, plan);
    expect(finished.fighters.indigo.health).toBe(0);
    expect(finished.fighters.ochre.position).toBe(3);
  });

  it('plays Aim before Volley when the aimed shot is the lethal one', () => {
    const state = arena({ hand: ['aim', 'volley'], draw: ['copper'], ochre: 2, indigo: 3, health: 5 });
    const plan = strategy({ preferredRange: 'Near', weights: weights({ damage: 10 }) });
    const first = choose(state, plan);
    expect('cardInstanceId' in first.command && definitionOf(state, first.command.cardInstanceId)).toBe('aim');
    expect(playPhase(state, plan).fighters.indigo.health).toBe(0);
  });

  it('drives into the wall when the collision is the best line', () => {
    const state = arena({ hand: ['drive'], ochre: 5, indigo: 5, health: 4 });
    const plan = strategy({ preferredRange: 'Close', weights: weights({ damage: 10 }) });
    const first = choose(state, plan);
    expect(first.command.type).toBe('playDrive');
    expect('direction' in first.command && first.command.direction).toBe('right');

    const finished = playPhase(state, plan);
    expect(finished.fighters.indigo.health).toBe(0);
    expect(finished.events.some((event) => event.type === 'wallCollision')).toBe(true);
  });

  it('orders the Tactical Actions before Flurry', () => {
    const state = arena({ hand: ['footwork', 'feint', 'flurry'], draw: ['copper', 'copper'], ochre: 3, indigo: 3, health: 20 });
    const plan = strategy({ preferredRange: 'Close', weights: weights({ damage: 10, cardsDrawn: 1, preferredRange: 3 }) });
    const finished = playPhase(state, plan);

    // Footwork and Feint give Flurry two Tactical Actions, and Feint's Exposed adds 2 more damage.
    expect(finished.fighters.indigo.health).toBe(16);
    expect(finished.actionsThisTurn.at(-1)).toBe('flurry');
    expect(finished.actionsThisTurn).toHaveLength(3);
  });
});

describe('action search priority ranks', () => {
  it('trashes the best-ranked Cull target, not the worst', () => {
    const state = arena({ hand: ['cull', 'copper', 'gold'], firstBuyPending: false });
    const plan = strategy({ weights: weights({ trashed: 1, moneyGained: 1 }), trashPriority: ['copper', 'gold'] });
    expect(trashedIds(playPhase(state, plan))).toContain('copper');
    expect(trashedIds(playPhase(state, plan))).not.toContain('gold');
  });

  it('reclaims the best-ranked discard, not the worst', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['reclaim'], draw: ['copper'], discard: ['silver', 'gold'] });
    const plan = strategy({ weights: weights({ reclaimed: 1 }), reclaimPriority: ['silver', 'gold'] });
    expect(playPhase(state, plan).players.ochre.deck.draw[0]?.definitionId).toBe('silver');
  });

  it('discards the best-ranked Prism target, not the worst', () => {
    const state = arena({ kingdomId: 'three-way-engine', hand: ['prism', 'copper', 'silver'] });
    const plan = strategy({ weights: weights({ discarded: 1 }), discardPriority: ['copper', 'silver'] });
    const finished = playPhase(state, plan);
    expect(finished.players.ochre.deck.discard.map((card) => card.definitionId)).toEqual(['copper']);
  });
});

describe('action search determinism', () => {
  const busy = arena({ hand: ['footwork', 'aim', 'volley', 'muster'], draw: ['copper', 'copper'], ochre: 2, indigo: 3 });
  const plan = strategy({ preferredRange: 'Far', weights: weights({ damage: 10, cardsDrawn: 2, preferredRange: 3, moneyGained: 1 }) });

  it('returns the same choice from the same state, and across a JSON round trip', () => {
    const first = choose(busy, plan);
    expect(choose(busy, plan).command).toEqual(first.command);

    const copiedState = JSON.parse(JSON.stringify(busy)) as GameState;
    const copiedPlan = JSON.parse(JSON.stringify(plan)) as typeof plan;
    expect(choose(copiedState, copiedPlan).command).toEqual(first.command);
  });

  it('chooses the same action with the memo on and with it off', () => {
    // Adapt sits deep enough in the draw pile that it only reaches the hand after both Footworks,
    // so the only route to its extra draw runs through the collided state. From the left wall,
    // `stay, stay` is searched before `right, left`; both reach the same position, hand, and piles,
    // so a memo key without `positionChanged` caches the smaller draw and hides the better line.
    const collide = arena({ kingdomId: 'current-duel', hand: ['footwork', 'footwork'], draw: ['copper', 'adapt', 'copper', 'copper'], ochre: 1, indigo: 3 });
    const drawPlan = strategy({ preferredRange: 'Far', weights: weights({ cardsDrawn: 1, preferredRange: 3 }) });
    const memoOff = choose(collide, drawPlan, { memo: null });
    expect(memoOff.command.type).toBe('playFootwork');
    expect('movement' in memoOff.command && memoOff.command.movement).toBe('right');
    expect(choose(collide, drawPlan).command).toEqual(memoOff.command);
    expect(choose(busy, plan, { memo: null }).command).toEqual(choose(busy, plan).command);
  });

  it('separates states that differ only in a field the memo key must carry', () => {
    const base = arena({ kingdomId: 'current-duel', hand: ['adapt'], draw: ['copper'], discard: ['silver', 'gold'], mana: 1, money: 2 });
    const key = memoKey(base, 'ochre');
    const changed = { ...base, players: { ...base.players, ochre: { ...base.players.ochre, positionChanged: true } } };
    const richer = { ...base, players: { ...base.players, ochre: { ...base.players.ochre, money: 3 } } };
    const reordered = structuredClone(base);
    reordered.players.ochre.deck.discard.reverse();
    const rolled = { ...base, rngState: base.rngState + 1 };

    expect(memoKey(changed, 'ochre')).not.toBe(key);
    expect(memoKey(richer, 'ochre')).not.toBe(key);
    expect(memoKey(reordered, 'ochre')).not.toBe(key);
    expect(memoKey(rolled, 'ochre')).not.toBe(key);
    expect(memoKey(structuredClone(base), 'ochre')).toBe(key);
  });

  it('takes a net-zero move sequence to unlock the extra Adapt draw', () => {
    const state = arena({ kingdomId: 'current-duel', hand: ['footwork', 'footwork', 'adapt'], draw: ['copper', 'copper', 'copper', 'copper'], ochre: 2, indigo: 3 });
    const plan = strategy({ preferredRange: 'Near', weights: weights({ cardsDrawn: 1, preferredRange: 3 }) });
    const finished = playPhase(state, plan);

    expect(finished.players.ochre.positionChanged).toBe(true);
    expect(finished.fighters.ochre.position).toBe(2);
    expect(finished.players.ochre.deck.draw).toHaveLength(0);
  });
});

describe('search action construction', () => {
  it('does not read labels while it searches', () => {
    const state = arena({ hand: [] });
    const actions = listLegalActions(state).map((action) => ({
      id: action.id,
      command: action.command,
      get label(): string { throw new Error('search read a presentation label'); }
    }));
    expect(() => searchAction(
      state, 'ochre', actions, strategy(), searchBaseline(state, 'ochre'),
      { stateLimit: 10, memo: createMemo() }
    )).not.toThrow();
  });

  it('keeps labels enumerable for JSON clients', () => {
    const actions = listLegalActions(arena({ hand: ['footwork'] }));
    expect(Object.getOwnPropertyDescriptor(actions[0]!, 'label')?.get).toBeTypeOf('function');
    const serialized = JSON.parse(JSON.stringify(actions)) as { label: string }[];
    expect(serialized.map((action) => action.label)).toContain('End Action phase');
    expect(serialized.every((action) => typeof action.label === 'string')).toBe(true);
  });

  it('applies a listed action through the fast path with the same state and events as the public path', () => {
    const state = arena({ hand: ['footwork'], ochre: 2, indigo: 3 });
    const action = listLegalActions(state)[0]!;
    expect(applyLegalAction(state, action)).toEqual(applyAction(state, action.id));
    const stale = applyLegalAction(state, action);
    expect(() => applyLegalAction(stale, action)).toThrow('Unknown or stale legal action');
    expect(() => applyAction(stale, action.id)).toThrow('Unknown or stale legal action');
  });
});

describe('the indexed memo key', () => {
  function previousMemoKey(state: GameState, playerId: 'ochre' | 'indigo'): string {
    const player = state.players[playerId];
    const mine = state.fighters[playerId];
    const foe = state.fighters[opponent(playerId)];
    const sorted = (cards: readonly { definitionId: string }[]): string =>
      cards.map((card) => card.definitionId).sort().join(',');
    const ordered = (cards: readonly { definitionId: string }[]): string =>
      cards.map((card) => card.definitionId).join(',');
    const tactical = state.actionsThisTurn
      .filter((id) => EFFECTS[resolveCard(state, id).mechanic].tactical).length;
    const pending = state.pendingChoice;
    return [
      mine.position, mine.health, mine.aimed ? 1 : 0, mine.exposed ? 1 : 0,
      foe.position, foe.health, foe.aimed ? 1 : 0, foe.exposed ? 1 : 0,
      sorted(player.deck.hand), sorted(player.deck.play),
      ordered(player.deck.draw), ordered(player.deck.discard),
      player.mana, player.money, player.positionChanged ? 1 : 0, state.rngState,
      pending ? `${pending.type}:${pending.remaining}` : '-', tactical
    ].join('|');
  }

  it('keeps ordered zones and multi-digit indexes unambiguous', () => {
    const market = kingdomMarket('three-way-engine');
    const one = market[1]!.id;
    const eleven = market[11]!.id;
    const forward = arena({ kingdomId: 'three-way-engine', draw: [one, eleven] });
    const backward = arena({ kingdomId: 'three-way-engine', draw: [eleven, one] });
    expect(memoKey(forward, 'ochre')).not.toBe(memoKey(backward, 'ochre'));
  });

  it('keeps adjacent multi-digit counts unambiguous while treating hand order as irrelevant', () => {
    const market = kingdomMarket('three-way-engine');
    const one = market[1]!.id;
    const two = market[2]!.id;
    const left = arena({ kingdomId: 'three-way-engine', hand: [one, ...Array<string>(11).fill(two)] });
    const right = arena({ kingdomId: 'three-way-engine', hand: [...Array<string>(11).fill(one), two] });
    const reordered = arena({ kingdomId: 'three-way-engine', hand: [...Array<string>(11).fill(two), one] });
    expect(memoKey(left, 'ochre')).not.toBe(memoKey(right, 'ochre'));
    expect(memoKey(left, 'ochre')).toBe(memoKey(reordered, 'ochre'));
  });

  it('indexes Copper and Cull in every deck zone', () => {
    const zones = ['draw', 'hand', 'discard', 'play'] as const;
    for (const zone of zones) {
      const copper = arena({ kingdomId: 'current-duel' });
      const cull = structuredClone(copper);
      for (const current of zones) {
        copper.players.ochre.deck[current] = [];
        cull.players.ochre.deck[current] = [];
      }
      copper.players.ochre.deck[zone] = [{ id: 'probe', definitionId: 'copper' }];
      cull.players.ochre.deck[zone] = [{ id: 'probe', definitionId: 'cull' }];
      expect(() => memoKey(copper, 'ochre')).not.toThrow();
      expect(() => memoKey(cull, 'ochre')).not.toThrow();
      expect(memoKey(copper, 'ochre')).not.toBe(memoKey(cull, 'ochre'));
    }
  });

  it('drops a cached index when a kingdom id is re-registered after reset', () => {
    const kingdom = (cardId: string) => ({
      id: 'memo-probe', name: 'Memo probe', startingHealth: 20,
      actionPiles: [{ cardId, count: 10 }]
    });
    registerKingdom(kingdom('footwork'));
    expect(() => memoKey(arena({ kingdomId: 'memo-probe', hand: ['footwork'] }), 'ochre')).not.toThrow();
    resetKingdoms();
    registerKingdom(kingdom('heavyBlow'));
    expect(() => memoKey(arena({ kingdomId: 'memo-probe', hand: ['heavyBlow'] }), 'ochre')).not.toThrow();
    expect(() => memoKey(arena({ kingdomId: 'memo-probe', hand: ['footwork'] }), 'ochre'))
      .toThrow('Card footwork is not in kingdom memo-probe');
  });

  it('rejects a card that is not in the complete kingdom market', () => {
    expect(() => memoKey(arena({ hand: ['heavyBlow'] }), 'ochre'))
      .toThrow('Card heavyBlow is not in kingdom distance-duel');
  });

  it('keeps the same exact-key partition as the previous encoding over real search states', () => {
    const states: GameState[] = [];
    const [ochre, indigo] = seedStrategies('current-duel');
    runMatch({
      kingdomId: 'current-duel', seed: 23, firstPlayerId: 'ochre', swapSides: false,
      turnLimitPerPlayer: 4, actionCapPerTurn: 200,
      agents: { ochre: strategyAgent(ochre!), indigo: strategyAgent(indigo!) }
    }, (state) => {
      if (state.phase === 'action' && state.activePlayerId === 'ochre' && states.length < 40) {
        states.push(structuredClone(state));
      }
    });
    expect(states.length).toBeGreaterThan(1);
    for (let left = 0; left < states.length; left += 1) {
      for (let right = 0; right < states.length; right += 1) {
        expect(memoKey(states[left]!, 'ochre') === memoKey(states[right]!, 'ochre'))
          .toBe(previousMemoKey(states[left]!, 'ochre') === previousMemoKey(states[right]!, 'ochre'));
      }
    }
  });
});

describe('action-phase scoring', () => {
  it('reads mana and hand treasures before the phase ends', () => {
    const state = arena({ hand: ['gold', 'copper'], mana: 3, firstBuyPending: false });
    const plan = strategy({ weights: weights({ unspentMana: -1, moneyGained: 2 }) });
    const baseline = searchBaseline(state, 'ochre');
    expect(scoreState(state, 'ochre', plan, baseline)).toBe(-3 + 2 * (3 + 1));

    const richer = strategy({ weights: weights({ unspentMana: -1, moneyGained: 3 }) });
    const calmer = strategy({ weights: weights({ unspentMana: -5, moneyGained: 2 }) });
    expect(scoreState(state, 'ochre', richer, baseline)).toBe(-3 + 3 * 4);
    expect(scoreState(state, 'ochre', calmer, baseline)).toBe(-15 + 2 * 4);

    // `endActionPhase` zeroes mana and empties the hand of treasures, which is why the state is
    // scored before it applies.
    const end = listLegalActions(state).find((action) => action.command.type === 'endActionPhase')!;
    expect(scoreState(applyAction(state, end.id), 'ochre', plan, baseline)).toBe(2 * 4);
  });

  it('adds the pending starting budget to the money it scores', () => {
    const state = arena({ hand: ['gold', 'copper'] });
    const plan = strategy({ weights: weights({ moneyGained: 1 }) });
    expect(state.players.ochre.firstBuyPending).toBe(true);
    expect(state.players.ochre.firstBuyMoney).toBe(12);
    expect(scoreState(state, 'ochre', plan, searchBaseline(state, 'ochre'))).toBe(3 + 1 + 12);
  });
});

describe('action search state limit', () => {
  it('throws an overflow instead of returning a weaker action', () => {
    const state = arena({ hand: ['footwork', 'muster', 'aim'], draw: ['copper', 'copper'], ochre: 2, indigo: 3 });
    const plan = strategy({ weights: weights({ cardsDrawn: 1 }) });
    expect(() => choose(state, plan, { stateLimit: 1 })).toThrow(ActionSearchOverflowError);
    expect(() => choose(state, plan, { stateLimit: 1 })).toThrow(/passed its limit of 1 states/);

    // The same state under a workable limit still returns the drawing line, so the overflow is the
    // limit talking and not a state the search cannot answer.
    const chosen = choose(state, plan);
    expect('cardInstanceId' in chosen.command && definitionOf(state, chosen.command.cardInstanceId)).toBe('muster');
  });
});

describe('opponent out of attack range', () => {
  // The one renamed scoring term, weighted -4 in every baseline. It scores 1 when the owned deck
  // holds no attack the current band allows, so a sign or gate error moves every baseline's play.
  const plan = strategy({ weights: weights({ opponentOutOfAttackRange: -4 }) });
  const score = (state: GameState): number => scoreState(state, 'ochre', plan, searchBaseline(state, 'ochre'));

  it('scores nothing while an owned attack fits the band', () => {
    // Positions 2 and 3 are Near, which Volley allows.
    expect(score(arena({ hand: ['volley'], ochre: 2, indigo: 3 }))).toBe(0);
  });

  it('charges the weight when every owned attack is out of band', () => {
    // Both fighters on 2 is Close, and Volley reports NEEDS_NEAR_OR_FAR there.
    expect(score(arena({ hand: ['volley'], ochre: 2, indigo: 2 }))).toBe(-4);
    // Heavy Blow is the mirror case: melee needs Close, so Near puts it out of band.
    expect(score(arena({ kingdomId: 'range-rich-mixed', hand: ['heavyBlow'], ochre: 2, indigo: 3 }))).toBe(-4);
  });

  it('counts a spell short of mana as in band, because mana is not a range problem', () => {
    // Arc Bolt gates on mana alone. At Close, with no mana, it still answers the range question.
    expect(score(arena({ kingdomId: 'range-rich-mixed', hand: ['arcBolt'], ochre: 2, indigo: 2, mana: 0 }))).toBe(0);
  });

  it('reads the whole deck, so a card in the draw pile counts the same as one in hand', () => {
    expect(score(arena({ hand: ['footwork'], draw: ['volley'], ochre: 2, indigo: 3 }))).toBe(0);
    expect(score(arena({ hand: ['footwork'], discard: ['volley'], ochre: 2, indigo: 3 }))).toBe(0);
    // Footwork alone is no attack at all, so the band can never be satisfied.
    expect(score(arena({ hand: ['footwork'], ochre: 2, indigo: 3 }))).toBe(-4);
  });
});
