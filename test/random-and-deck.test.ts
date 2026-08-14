import { describe, expect, it } from 'vitest';
import {
  CARDS, SeededRandom, applyCommand, assertInvariants, createGame, listLegalActions, shuffle
} from '../src/game';
import { clearHand, gameFor, giveCard } from './helpers';

describe('seeded setup and deck behavior', () => {
  it('repeats first player, shuffled decks, and card identifiers for one seed', () => {
    expect(createGame(9823)).toEqual(createGame(9823));
    expect(createGame(9823)).not.toEqual(createGame(9824));
  });

  it('uses the same Fisher-Yates shuffle as Deckfront', () => {
    const random = new SeededRandom(7);
    expect(shuffle(['a', 'b', 'c', 'd', 'e'], random)).toEqual(['a', 'c', 'e', 'd', 'b']);
  });

  it('auto-plays all treasures and closes board actions on entering buy', () => {
    const state = gameFor();
    clearHand(state);
    giveCard(state, 'copper');
    giveCard(state, 'silver');
    giveCard(state, 'dash');
    const next = applyCommand(state, { type: 'enterBuyPhase' });
    expect(next.phase).toBe('buy');
    expect(next.players.ochre.money).toBe(3);
    expect(next.players.ochre.deck.play.map((card) => card.definitionId)).toEqual(['copper', 'silver']);
    expect(next.players.ochre.deck.hand.map((card) => card.definitionId)).toEqual(['dash']);
    expect(listLegalActions(next).some((action) => action.command.type === 'baselineMove')).toBe(false);
  });

  it('places a purchase in discard and decrements its pile', () => {
    const state = gameFor();
    clearHand(state);
    giveCard(state, 'gold');
    giveCard(state, 'gold');
    const buying = applyCommand(state, { type: 'enterBuyPhase' });
    const count = buying.supply.press ?? 0;
    const bought = applyCommand(buying, { type: 'buyCard', definitionId: 'press' });
    expect(bought.supply.press).toBe(count - 1);
    expect(bought.players.ochre.deck.discard.at(-1)?.definitionId).toBe('press');
    expect(bought.players.ochre.buys).toBe(0);
    assertInvariants(bought);
  });

  it('cleans up, reshuffles discard, and draws exactly five without extra draw', () => {
    let state = gameFor();
    state.players.ochre.deck.discard.push(
      ...state.players.ochre.deck.draw.splice(0),
      ...state.players.ochre.deck.hand.splice(0)
    );
    state = applyCommand(state, { type: 'enterBuyPhase' });
    state = applyCommand(state, { type: 'endTurn' });
    expect(state.players.ochre.deck.hand).toHaveLength(5);
    expect(state.players.ochre.deck.draw).toHaveLength(5);
    expect(state.players.ochre.deck.discard).toHaveLength(0);
    assertInvariants(state);
  });

  it('has no Deckfront free-trash action and defines no draw effects', () => {
    const actions = listLegalActions(gameFor());
    expect(actions.map((action) => String(action.command.type))).not.toContain('trashCard');
    expect(Object.values(CARDS).every((card) => !card.text.toLowerCase().includes('draw'))).toBe(true);
  });
});
