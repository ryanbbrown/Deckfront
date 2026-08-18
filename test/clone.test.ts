import { describe, expect, it } from 'vitest';
import { cloneGame } from '../src/game';
import type { CardInstance, GameEvent, GameState } from '../src/game';
import { strategyAgent } from '../src/sim/agents/strategyAgent';
import { baselineStrategy } from '../src/sim/baselines';
import { runMatch } from '../src/sim/match';
import { repairStrategy } from '../src/sim/mutation';

/**
 * `cloneGame` shares the frozen cards and events instead of deep-copying them, so these are the only
 * checks that would catch a shared mutable array.
 */
const KINGDOM = 'three-way-engine';

/** Real states from a played match, so every zone holds what a game actually puts there. */
function statesOf(seed: number): GameState[] {
  const seen: GameState[] = [];
  runMatch({
    kingdomId: KINGDOM, seed, firstPlayerId: 'ochre', swapSides: false,
    turnLimitPerPlayer: 100, actionCapPerTurn: 200,
    agents: {
      ochre: strategyAgent(repairStrategy(KINGDOM, baselineStrategy('mage-standard'))),
      indigo: strategyAgent(repairStrategy(KINGDOM, baselineStrategy('engine-draw')))
    }
  }, (state) => { seen.push(state); });
  return seen;
}

const states = statesOf(11);
const midGame = states[Math.floor(states.length / 2)]!;
const pending = states.find((state) => state.pendingChoice !== null) ?? midGame;
const final = states.at(-1)!;

describe('cloning a game state', () => {
  it.each([['mid game', midGame], ['a pending choice', pending], ['the final state', final]] as const)(
    'copies %s exactly as structuredClone does',
    (_name, state) => {
      expect(cloneGame(state)).toEqual(structuredClone(state));
    }
  );

  it('shares no mutable array or object with the original', () => {
    const state = midGame;
    const before = structuredClone(state);
    const copy = cloneGame(state);

    const card: CardInstance = { id: 'card-intruder', definitionId: 'gold' };
    for (const player of [copy.players.ochre, copy.players.indigo]) {
      player.deck.draw.push(card);
      player.deck.hand.push(card);
      player.deck.discard.push(card);
      player.deck.play.push(card);
      player.purchases.push('intruder');
      player.money += 7;
      player.deck = { draw: [], hand: [], discard: [], play: [] };
    }
    for (const fighter of [copy.fighters.ochre, copy.fighters.indigo]) {
      fighter.position = 0;
      fighter.health = 99;
    }
    copy.trash.push(card);
    copy.actionsThisTurn.push('intruder');
    copy.events.push({ sequence: -1, type: 'draw', playerId: 'ochre', detail: {} });
    copy.supply.gold = 99;
    copy.turn = 999;
    if (copy.pendingChoice) copy.pendingChoice.remaining = 99;

    expect(state).toEqual(before);
  });

  it('refuses to edit a card or an event in place, which is what makes the sharing safe', () => {
    const event = final.events[0] as GameEvent;
    const card = final.players.ochre.deck.draw[0] ?? final.players.ochre.deck.discard[0];
    expect(card).toBeDefined();
    expect(() => { (event as { sequence: number }).sequence = 99; }).toThrow(TypeError);
    expect(() => { (event.detail as Record<string, unknown>).intruder = true; }).toThrow(TypeError);
    expect(() => { (card as { definitionId: string }).definitionId = 'gold'; }).toThrow(TypeError);
  });
});
