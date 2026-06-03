import { describe, expect, it } from 'vitest';
import { SeededRng } from '../../src/core/random';
import { drawCards } from '../../src/core/state';
import type { PlayerState } from '../../src/core/types';

function playerWithDiscard(discard: string[]): PlayerState {
  return {
    id: 'P1',
    draw: [],
    hand: [],
    discard,
    play: [],
    actions: 1,
    buys: 1,
    money: 0,
    attributes: {},
    persistentAttributes: {},
    vpCounters: 0,
    turnsTaken: 0,
    freeTrashUsed: false
  };
}

describe('drawCards', () => {
  it('reshuffles discard into draw deterministically when draw is empty', () => {
    const first = playerWithDiscard(['copper', 'estate', 'province']);
    const second = playerWithDiscard(['copper', 'estate', 'province']);

    drawCards(first, 2, new SeededRng(42));
    drawCards(second, 2, new SeededRng(42));

    expect(first.hand).toEqual(second.hand);
    expect(first.discard).toEqual([]);
    expect(first.draw.length).toBe(1);
  });
});
