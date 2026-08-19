import { describe, expect, it } from 'vitest';
import { cloneGame } from '../src/game';
import type { CardInstance, GameState } from '../src/game';
import { strategyAgent } from '../src/sim/agents/strategyAgent';
import { runMatch } from '../src/sim/match';
import { diagnosticStrategies } from '../src/sim/baselines';

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
      ochre: strategyAgent(diagnosticStrategies(KINGDOM)[2]!),
      indigo: strategyAgent(diagnosticStrategies(KINGDOM)[3]!)
    }
  }, (state) => { seen.push(state); });
  return seen;
}

const states = statesOf(11);
const midGame = states[Math.floor(states.length / 2)]!;
const pending = states.find((state) => state.pendingChoice !== null);
const final = states.at(-1)!;

describe('cloning a game state', () => {
  // `10-8:61` requires the mana-and-pending-choice case, which is where a cheap clone fails first.
  // Without this the fixture could silently lose it and every check below would still pass.
  it('has a state with a live pending choice to copy', () => {
    expect(pending?.pendingChoice).toMatchObject({ playerId: expect.any(String), remaining: expect.any(Number) });
  });

  it.each([['mid game', midGame], ['a pending choice', pending!], ['the final state', final]] as const)(
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

  it('shares the card and event objects on purpose, which is where the speed comes from', () => {
    const copy = cloneGame(final);
    // Nothing in `src/game/` edits a card or an event in place, so copying them would only cost
    // time. Deep-copying the event log again is what made a long game quadratic.
    expect(copy.events[0]).toBe(final.events[0]);
    expect(copy.events.at(-1)).toBe(final.events.at(-1));
    const zone = (['discard', 'draw', 'hand', 'play'] as const)
      .find((name) => final.players.ochre.deck[name].length > 0);
    expect(zone).toBeDefined();
    expect(copy.players.ochre.deck[zone!][0]).toBe(final.players.ochre.deck[zone!][0]);
  });
});
