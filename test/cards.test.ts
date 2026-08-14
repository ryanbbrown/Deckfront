import { describe, expect, it } from 'vitest';
import { applyCommand, assertInvariants, listLegalActions } from '../src/game';
import type { GameCommand } from '../src/game';
import { clearHand, gameFor, giveCard, setPosition } from './helpers';

describe('basic cards', () => {
  it('uses Dash after baseline movement', () => {
    const state = gameFor();
    clearHand(state);
    const dash = giveCard(state, 'dash');
    state.pieces['ochre-a'].baselineMoves = 0;
    const next = applyCommand(state, {
      type: 'playDash', cardInstanceId: dash.id, pieceId: 'ochre-a', destination: { q: 0, r: 0 }
    });
    expect(next.pieces['ochre-a'].position).toEqual({ q: 0, r: 0 });
    expect(next.pieces['ochre-a'].baselineMoves).toBe(0);
  });

  it('trashes Cull itself or a different card without replacement', () => {
    const state = gameFor();
    clearHand(state);
    const cull = giveCard(state, 'cull');
    const copper = giveCard(state, 'copper');
    const next = applyCommand(state, {
      type: 'playCull', cardInstanceId: cull.id, trashInstanceId: copper.id
    });
    expect(next.trash).toContainEqual(copper);
    expect(next.players.ochre.deck.play).toContainEqual(cull);
    expect(next.players.ochre.deck.hand).toHaveLength(0);
    assertInvariants(next);
  });

  it('does not create card actions when no target is legal', () => {
    const state = gameFor();
    clearHand(state);
    giveCard(state, 'shove');
    setPosition(state, 'indigo-a', { q: 2, r: -2 });
    setPosition(state, 'indigo-b', { q: 2, r: 0 });
    expect(listLegalActions(state).some((action) => action.command.type === 'playShove')).toBe(false);
  });
});

describe('direct force cards', () => {
  it('Drive follows only after a successful displacement', () => {
    const state = gameFor();
    clearHand(state);
    const drive = giveCard(state, 'drive');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    setPosition(state, 'indigo-b', { q: 2, r: -1 });
    const next = applyCommand(state, {
      type: 'playDrive', cardInstanceId: drive.id, actorId: 'ochre-a', targetId: 'indigo-a', follow: true
    });
    expect(next.pieces['ochre-a'].position).toEqual({ q: 0, r: 0 });
    expect(next.pieces['indigo-a'].position).toEqual({ q: 1, r: 0 });
  });

  it('Breaker removes Brace and pushes through it', () => {
    const state = gameFor();
    clearHand(state);
    const breaker = giveCard(state, 'breaker');
    setPosition(state, 'ochre-a', { q: 1, r: 0 });
    setPosition(state, 'indigo-a', { q: 2, r: 0 });
    state.pieces['indigo-a'].braced = true;
    const next = applyCommand(state, {
      type: 'playBreaker', cardInstanceId: breaker.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    expect(next.scores.ochre).toBe(1);
    expect(next.pieces['indigo-a'].braced).toBe(false);
  });

  it('Press earns a second step from an earlier resolved displacement', () => {
    let state = gameFor();
    clearHand(state);
    const drive = giveCard(state, 'drive');
    const press = giveCard(state, 'press');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    setPosition(state, 'indigo-b', { q: 2, r: -1 });
    state = applyCommand(state, {
      type: 'playDrive', cardInstanceId: drive.id, actorId: 'ochre-a', targetId: 'indigo-a', follow: true
    });
    state = applyCommand(state, {
      type: 'playPress', cardInstanceId: press.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    expect(state.scores.ochre).toBe(1);
    expect(state.pieces['indigo-a'].position).toBeNull();
  });

  it('keeps the first Press step when its second destination is blocked', () => {
    const state = gameFor();
    clearHand(state);
    const press = giveCard(state, 'press');
    setPosition(state, 'ochre-a', { q: -2, r: 0 });
    setPosition(state, 'indigo-a', { q: -1, r: 0 });
    setPosition(state, 'indigo-b', { q: 1, r: 0 });
    state.turn.pressSetupPieceIds.push('indigo-a');
    const next = applyCommand(state, {
      type: 'playPress', cardInstanceId: press.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    expect(next.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
    expect(next.scores.ochre).toBe(0);
  });

  it('Brace cancels the complete multi-step Press effect', () => {
    const state = gameFor();
    clearHand(state);
    const press = giveCard(state, 'press');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    setPosition(state, 'indigo-b', { q: 2, r: -1 });
    state.turn.pressSetupPieceIds.push('indigo-a');
    state.pieces['indigo-a'].braced = true;
    const next = applyCommand(state, {
      type: 'playPress', cardInstanceId: press.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    expect(next.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
    expect(next.pieces['indigo-a'].braced).toBe(false);
    expect(next.events.filter((event) => event.type === 'displacement')).toHaveLength(0);
  });

  it('does not let one Press enable the next Press', () => {
    let state = gameFor();
    clearHand(state);
    const firstPress = giveCard(state, 'press');
    const secondPress = giveCard(state, 'press');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'ochre-b', { q: 1, r: -1 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    setPosition(state, 'indigo-b', { q: -2, r: 2 });
    state = applyCommand(state, {
      type: 'playPress', cardInstanceId: firstPress.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    state = applyCommand(state, {
      type: 'playPress', cardInstanceId: secondPress.id, actorId: 'ochre-b', targetId: 'indigo-a'
    });
    expect(state.pieces['indigo-a'].position).toEqual({ q: 1, r: 1 });
    expect(state.scores.ochre).toBe(0);
    expect(state.turn.displacedPieceIds).toContain('indigo-a');
    expect(state.turn.pressSetupPieceIds).not.toContain('indigo-a');
  });

  it('tracks every approved Press setup displacement', () => {
    const cases: Array<{
      cardId: 'shove' | 'drive' | 'breaker' | 'pull' | 'sweep' | 'corner';
      configure?: (state: ReturnType<typeof gameFor>) => void;
      command: (cardInstanceId: string) => GameCommand;
    }> = [
      { cardId: 'shove', command: (cardInstanceId) => ({
        type: 'playShove', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
      }) },
      { cardId: 'drive', command: (cardInstanceId) => ({
        type: 'playDrive', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a', follow: false
      }) },
      { cardId: 'breaker', configure: (state) => { state.pieces['indigo-a'].braced = true; }, command: (cardInstanceId) => ({
        type: 'playBreaker', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
      }) },
      { cardId: 'pull', configure: (state) => { setPosition(state, 'indigo-a', { q: 1, r: 0 }); }, command: (cardInstanceId) => ({
        type: 'playPull', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
      }) },
      { cardId: 'sweep', command: (cardInstanceId) => ({
        type: 'playSweep', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a', destination: { q: 0, r: -1 }
      }) },
      { cardId: 'corner', command: (cardInstanceId) => ({
        type: 'playCorner', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
      }) }
    ];
    for (const setup of cases) {
      const state = gameFor();
      clearHand(state);
      const card = giveCard(state, setup.cardId);
      setPosition(state, 'ochre-a', { q: -1, r: 0 });
      setPosition(state, 'indigo-a', { q: 0, r: 0 });
      setPosition(state, 'indigo-b', { q: 2, r: -1 });
      setup.configure?.(state);
      const next = applyCommand(state, setup.command(card.id));
      expect(next.turn.pressSetupPieceIds, setup.cardId).toContain('indigo-a');
    }
  });
});

describe('geometry cards', () => {
  it('Pull moves an enemy into the empty middle hex', () => {
    const state = gameFor();
    clearHand(state);
    const pull = giveCard(state, 'pull');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'indigo-a', { q: 1, r: 0 });
    const next = applyCommand(state, {
      type: 'playPull', cardInstanceId: pull.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    expect(next.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
  });

  it('Pull removes Brace when its middle hex is occupied', () => {
    const state = gameFor();
    clearHand(state);
    giveCard(state, 'pull');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'ochre-b', { q: 0, r: 0 });
    setPosition(state, 'indigo-a', { q: 1, r: 0 });
    state.pieces['indigo-a'].braced = true;
    const action = listLegalActions(state).find((candidate) => candidate.command.type === 'playPull');
    if (!action) throw new Error('Expected Pull against a Braced target.');
    const next = applyCommand(state, action.command);
    expect(next.pieces['indigo-a'].position).toEqual({ q: 1, r: 0 });
    expect(next.pieces['indigo-a'].braced).toBe(false);
    expect(next.events.at(-1)?.type).toBe('braceCanceledDisplacement');
  });

  it('keeps Pull illegal when an unbraced target has an occupied middle hex', () => {
    const state = gameFor();
    clearHand(state);
    giveCard(state, 'pull');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'ochre-b', { q: 0, r: 0 });
    setPosition(state, 'indigo-a', { q: 1, r: 0 });
    expect(listLegalActions(state).some((candidate) => candidate.command.type === 'playPull')).toBe(false);
  });

  it('Vault jumps over either player piece into an empty landing hex', () => {
    const state = gameFor();
    clearHand(state);
    const vault = giveCard(state, 'vault');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    setPosition(state, 'indigo-b', { q: 2, r: -1 });
    setPosition(state, 'indigo-b', { q: 2, r: -1 });
    const next = applyCommand(state, {
      type: 'playVault', cardInstanceId: vault.id, pieceId: 'ochre-a', jumpedPieceId: 'indigo-a'
    });
    expect(next.pieces['ochre-a'].position).toEqual({ q: 1, r: 0 });
  });

  it('Sweep can rotate an enemy off the board', () => {
    const state = gameFor();
    clearHand(state);
    giveCard(state, 'sweep');
    setPosition(state, 'ochre-a', { q: 2, r: -1 });
    setPosition(state, 'indigo-a', { q: 2, r: 0 });
    const action = listLegalActions(state).find((candidate) =>
      candidate.command.type === 'playSweep' && !(
        Math.abs(candidate.command.destination.q) <= 2
        && Math.abs(candidate.command.destination.r) <= 2
        && Math.abs(candidate.command.destination.q + candidate.command.destination.r) <= 2
      )
    );
    if (!action || action.command.type !== 'playSweep') throw new Error('Expected off-board Sweep.');
    const next = applyCommand(state, action.command);
    expect(next.scores.ochre).toBe(1);
  });

  it('Relay swaps positions while preserving movement and statuses', () => {
    const state = gameFor();
    clearHand(state);
    const relay = giveCard(state, 'relay');
    state.pieces['ochre-a'].baselineMoves = 0;
    state.pieces['ochre-b'].braced = true;
    const first = state.pieces['ochre-a'].position;
    const second = state.pieces['ochre-b'].position;
    const next = applyCommand(state, { type: 'playRelay', cardInstanceId: relay.id });
    expect(next.pieces['ochre-a'].position).toEqual(second);
    expect(next.pieces['ochre-b'].position).toEqual(first);
    expect(next.pieces['ochre-a'].baselineMoves).toBe(0);
    expect(next.pieces['ochre-b'].braced).toBe(true);
  });
});

describe('confinement cards', () => {
  it('requires the third Block to replace one owned block', () => {
    const state = gameFor();
    clearHand(state);
    const block = giveCard(state, 'block');
    state.blocks = [
      { id: 'old-1', ownerId: 'ochre', position: { q: -2, r: 1 }, clearAfterTurn: 2 },
      { id: 'old-2', ownerId: 'ochre', position: { q: -1, r: -1 }, clearAfterTurn: 2 }
    ];
    const actions = listLegalActions(state).filter((action) => action.command.type === 'playBlock');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => action.command.type === 'playBlock' && action.command.replaceBlockId)).toBe(true);
    const next = applyCommand(state, actions[0]!.command);
    expect(next.blocks.filter((candidate) => candidate.ownerId === 'ochre')).toHaveLength(2);
    expect(next.players.ochre.deck.play).toContainEqual(block);
  });

  it('Pin prevents baseline movement on the target next turn', () => {
    const state = gameFor();
    clearHand(state);
    const pin = giveCard(state, 'pin');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    let next = applyCommand(state, {
      type: 'playPin', cardInstanceId: pin.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    next = applyCommand(next, { type: 'enterBuyPhase' });
    next = applyCommand(next, { type: 'endTurn' });
    expect(next.activePlayerId).toBe('indigo');
    expect(next.pieces['indigo-a'].baselineMoves).toBe(0);
    expect(next.pieces['indigo-a'].pinned).not.toBeNull();
  });

  it('Pin plus Corner reaches its second displacement step', () => {
    let state = gameFor();
    clearHand(state);
    const pin = giveCard(state, 'pin');
    const corner = giveCard(state, 'corner');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    setPosition(state, 'indigo-b', { q: 2, r: -1 });
    state = applyCommand(state, {
      type: 'playPin', cardInstanceId: pin.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    state = applyCommand(state, {
      type: 'playCorner', cardInstanceId: corner.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    expect(state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });
  });

  it('Block plus Corner reaches its second displacement step', () => {
    let state = gameFor();
    clearHand(state);
    const block = giveCard(state, 'block');
    const corner = giveCard(state, 'corner');
    setPosition(state, 'ochre-a', { q: -1, r: 0 });
    setPosition(state, 'ochre-b', { q: 0, r: -1 });
    setPosition(state, 'indigo-a', { q: 0, r: 0 });
    setPosition(state, 'indigo-b', { q: 2, r: -1 });
    state = applyCommand(state, {
      type: 'playBlock', cardInstanceId: block.id, actorId: 'ochre-b', destination: { q: 1, r: -1 }
    });
    state = applyCommand(state, {
      type: 'playCorner', cardInstanceId: corner.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    expect(state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });
  });
});
