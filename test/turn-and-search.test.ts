import { describe, expect, it } from 'vitest';
import {
  applyAction, applyCommand, applyPreviewAction, assertInvariants, createTurnPreview,
  findMaximumPoints, listLegalActions, replayCommands, SeededRandom, undoPreviewAction
} from '../src/game';
import type { GameState } from '../src/game';
import { clearHand, gameFor, giveCard, setPosition } from './helpers';

function finishTurn(state: GameState): GameState {
  const next = state.phase === 'action' ? applyCommand(state, { type: 'enterBuyPhase' }) : state;
  return applyCommand(next, { type: 'endTurn' });
}

describe('turn lifecycle and replay', () => {
  it('expires Brace at its owner next turn start', () => {
    let state = gameFor();
    clearHand(state);
    const brace = giveCard(state, 'brace');
    state = applyCommand(state, { type: 'playBrace', cardInstanceId: brace.id, pieceId: 'ochre-a' });
    state = finishTurn(state);
    state = finishTurn(state);
    expect(state.activePlayerId).toBe('ochre');
    expect(state.pieces['ochre-a'].braced).toBe(false);
  });

  it('clears Pin and temporary blocks after their source owner following turn', () => {
    let state = gameFor();
    clearHand(state);
    const pin = giveCard(state, 'pin');
    const block = giveCard(state, 'block');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'ochre-b', { q: -1, r: 1 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    state = applyCommand(state, {
      type: 'playPin', cardInstanceId: pin.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    state = applyCommand(state, {
      type: 'playBlock', cardInstanceId: block.id, actorId: 'ochre-b', destination: { q: 0, r: 1 }
    });
    state = finishTurn(state);
    state = finishTurn(state);
    expect(state.pieces['indigo-a'].pinned).not.toBeNull();
    expect(state.blocks).toHaveLength(1);
    state = finishTurn(state);
    expect(state.pieces['indigo-a'].pinned).toBeNull();
    expect(state.blocks).toHaveLength(0);
  });

  it('rebuilds preview state exactly after undo', () => {
    const initial = gameFor();
    let preview = createTurnPreview(initial);
    const move = listLegalActions(preview.state).find((action) => action.command.type === 'baselineMove');
    if (!move) throw new Error('Expected baseline move.');
    preview = applyPreviewAction(preview, move.id);
    const expected = preview.state;
    const secondMove = listLegalActions(preview.state).find((action) => action.command.type === 'baselineMove');
    if (!secondMove) throw new Error('Expected second baseline move.');
    preview = applyPreviewAction(preview, secondMove.id);
    preview = undoPreviewAction(preview);
    expect(preview.state).toEqual(expected);
    expect(replayCommands(initial, preview.commands)).toEqual(expected);
  });

  it('rejects stale action identifiers', () => {
    const state = gameFor();
    const actions = listLegalActions(state);
    const move = actions.find((action) => action.command.type === 'baselineMove');
    const other = actions.find((action) => action.command.type === 'enterBuyPhase');
    if (!move || !other) throw new Error('Expected actions.');
    const next = applyAction(state, move.id);
    expect(() => applyAction(next, other.id)).toThrow(/stale/);
  });

  it('preserves invariants through a deterministic sequence of legal turns', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      let state = gameFor();
      const random = new SeededRandom(seed);
      for (let step = 0; step < 80 && !state.winner; step += 1) {
        assertInvariants(state);
        const actions = listLegalActions(state);
        const choice = actions[random.nextInt(actions.length)];
        if (!choice) break;
        state = applyAction(state, choice.id);
      }
      assertInvariants(state);
    }
  });
});

describe('maximum-point tactical search', () => {
  it('completes against a normal starting hand', () => {
    const result = findMaximumPoints(gameFor());
    expect(result.points).toBeGreaterThanOrEqual(0);
    expect(result.exploredStates).toBeGreaterThan(0);
  });

  it('finds an available immediate ring-out', () => {
    const state = gameFor();
    clearHand(state);
    giveCard(state, 'shove');
    setPosition(state, 'ochre-a', { q: 2, r: 0 });
    setPosition(state, 'ochre-b', { q: -2, r: 0 });
    setPosition(state, 'indigo-a', { q: 3, r: 0 });
    setPosition(state, 'indigo-b', { q: 0, r: -2 });
    const result = findMaximumPoints(state);
    expect(result.points).toBe(1);
    expect(result.actions.some((action) => action.command.type === 'playShove')).toBe(true);
  });

  it('includes required respawn choices before searching the action phase', () => {
    const state = gameFor();
    clearHand(state);
    giveCard(state, 'shove');
    setPosition(state, 'ochre-a', null);
    setPosition(state, 'ochre-b', { q: 0, r: 2 });
    setPosition(state, 'indigo-a', { q: -3, r: 0 });
    setPosition(state, 'indigo-b', { q: 2, r: -2 });
    state.phase = 'respawn';
    const result = findMaximumPoints(state);
    expect(result.points).toBe(1);
    expect(result.actions[0]?.command.type).toBe('respawn');
    expect(result.actions.some((action) => action.command.type === 'playShove')).toBe(true);
  });

  it('always returns a match-winning line when one is available', () => {
    const state = gameFor();
    state.scores.ochre = 4;
    clearHand(state);
    giveCard(state, 'shove');
    setPosition(state, 'ochre-a', { q: 2, r: 0 });
    setPosition(state, 'indigo-a', { q: 3, r: 0 });
    const result = findMaximumPoints(state);
    expect(result.points).toBe(1);
    const final = result.actions.reduce((current, action) => applyCommand(current, action.command), state);
    expect(final.winner).toBe('ochre');
  });
});
