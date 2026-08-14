import { describe, expect, it } from 'vitest';
import { DIRECTIONS, allBoardCoordinates, equal } from '../src/game/hex';
import {
  applyCommand, assertInvariants, legalRespawnLocations, listLegalActions
} from '../src/game';
import { gameFor, giveCard, setPosition } from './helpers';

describe('board rules', () => {
  it('interleaves each baseline move with card movement without consuming another move', () => {
    let state = gameFor();
    const dash = state.players.ochre.deck.hand.find((card) => card.definitionId === 'dash');
    if (!dash) throw new Error('Expected Dash in test hand.');
    state = applyCommand(state, { type: 'baselineMove', pieceId: 'ochre-a', destination: { q: 0, r: 0 } });
    state = applyCommand(state, {
      type: 'playDash', cardInstanceId: dash.id, pieceId: 'ochre-a', destination: { q: 0, r: 1 }
    });
    expect(state.pieces['ochre-a'].position).toEqual({ q: 0, r: 1 });
    expect(state.pieces['ochre-a'].baselineMoves).toBe(0);
    expect(state.pieces['ochre-b'].baselineMoves).toBe(1);
  });

  it('never pushes a contiguous line of pieces', () => {
    const state = gameFor();
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    setPosition(state, 'indigo-b', { q: 1, r: 0 });
    if (!state.players.ochre.deck.hand.some((card) => card.definitionId === 'shove')) giveCard(state, 'shove');
    expect(listLegalActions(state).some((action) =>
      action.command.type === 'playShove'
      && action.command.actorId === 'ochre-a'
      && action.command.targetId === 'indigo-a'
    )).toBe(false);
  });

  it('allows Brace to absorb a displacement even when the destination is occupied', () => {
    const state = gameFor();
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    setPosition(state, 'indigo-b', { q: 1, r: 0 });
    state.pieces['indigo-a'].braced = true;
    const shove = state.players.ochre.deck.hand.find((card) => card.definitionId === 'shove') ?? giveCard(state, 'shove');
    const next = applyCommand(state, {
      type: 'playShove', cardInstanceId: shove.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    expect(next.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
    expect(next.pieces['indigo-a'].braced).toBe(false);
  });

  it.each(DIRECTIONS)('rings a piece out across board edge %j', (direction) => {
    const state = gameFor();
    const edge = { q: direction.q * 2, r: direction.r * 2 };
    const actor = { q: edge.q - direction.q, r: edge.r - direction.r };
    setPosition(state, 'ochre-a', actor);
    setPosition(state, 'indigo-a', edge);
    const spareCells = allBoardCoordinates().filter((coordinate) =>
      !equal(coordinate, edge) && !equal(coordinate, actor)
    );
    setPosition(state, 'ochre-b', spareCells[0]!);
    setPosition(state, 'indigo-b', spareCells[1]!);
    const shove = state.players.ochre.deck.hand.find((card) => card.definitionId === 'shove') ?? giveCard(state, 'shove');
    const next = applyCommand(state, {
      type: 'playShove', cardInstanceId: shove.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    expect(next.scores.ochre).toBe(1);
    expect(next.pieces['indigo-a'].position).toBeNull();
    expect(next.pieces['indigo-a'].needsRespawn).toBe(true);
    assertInvariants(next);
  });

  it('uses nearest empty cells when both respawn anchors are occupied', () => {
    const state = gameFor('indigo');
    setPosition(state, 'indigo-a', null);
    setPosition(state, 'ochre-a', { q: 1, r: -1 });
    setPosition(state, 'ochre-b', { q: 1, r: 0 });
    state.phase = 'respawn';
    const locations = legalRespawnLocations(state, 'indigo-a');
    expect(locations.length).toBeGreaterThan(0);
    expect(locations).not.toContainEqual({ q: 1, r: -1 });
    expect(locations).not.toContainEqual({ q: 1, r: 0 });
    expect(locations.every((location) =>
      Math.min(...[{ q: 1, r: -1 }, { q: 1, r: 0 }].map((anchor) =>
        (Math.abs(location.q - anchor.q) + Math.abs(location.r - anchor.r)
          + Math.abs(location.q + location.r - anchor.q - anchor.r)) / 2
      )) === 1
    )).toBe(true);
  });

  it('resolves multiple respawns one at a time', () => {
    let state = gameFor('indigo');
    setPosition(state, 'indigo-a', null);
    setPosition(state, 'indigo-b', null);
    state.phase = 'respawn';
    let actions = listLegalActions(state);
    expect(new Set(actions.map((action) =>
      action.command.type === 'respawn' ? action.command.pieceId : 'other'
    ))).toEqual(new Set(['indigo-a']));
    state = applyCommand(state, actions[0]!.command);
    expect(state.phase).toBe('respawn');
    actions = listLegalActions(state);
    expect(actions.every((action) =>
      action.command.type === 'respawn' && action.command.pieceId === 'indigo-b'
    )).toBe(true);
    state = applyCommand(state, actions[0]!.command);
    expect(state.phase).toBe('action');
    expect(state.pieces['indigo-a'].baselineMoves).toBe(1);
    expect(state.pieces['indigo-b'].baselineMoves).toBe(1);
  });

  it('ends immediately on the fifth point', () => {
    const state = gameFor();
    state.scores.ochre = 4;
    setPosition(state, 'ochre-a', { q: 1, r: 0 });
    setPosition(state, 'indigo-a', { q: 2, r: 0 });
    const shove = state.players.ochre.deck.hand.find((card) => card.definitionId === 'shove') ?? giveCard(state, 'shove');
    const next = applyCommand(state, {
      type: 'playShove', cardInstanceId: shove.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    expect(next.winner).toBe('ochre');
    expect(next.phase).toBe('ended');
    expect(listLegalActions(next)).toEqual([]);
  });

  it('contains exactly 19 board cells', () => {
    expect(allBoardCoordinates()).toHaveLength(19);
  });
});
