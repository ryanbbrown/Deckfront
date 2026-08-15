import { describe, expect, it } from 'vitest';
import {
  CARDS, applyAction, applyCommand, assertInvariants, listLegalActions, replayCommands
} from '../src/game';
import type { GameCommand, GameState } from '../src/game';
import { actionFor, addCard, clearHands, freshState, setPosition, snapshot } from './helpers';

function take(state: GameState, predicate: (command: GameCommand) => boolean): GameState {
  const action = actionFor(state, predicate);
  return applyAction(state, action.id);
}

function pass(state: GameState): GameState { return take(state, (command) => command.type === 'pass'); }

describe('alternating round flow', () => {
  it('moves once, spends that piece allowance, and gives the opponent one action step', () => {
    const state = freshState();
    const next = take(state, (command) => command.type === 'baselineMove' && command.pieceId === 'ochre-a');
    expect(next.activePlayerId).toBe('indigo');
    expect(next.round.actionStep).toBe(2);
    expect(next.pieces['ochre-a'].baselineMoves).toBe(0);
    expect(next.pieces['ochre-b'].baselineMoves).toBe(1);
  });

  it('plays one card into play and gives the opponent one action step', () => {
    const state = freshState(); clearHands(state);
    const dash = addCard(state, 'ochre', 'dash');
    const next = take(state, (command) => command.type === 'playDash' && command.cardInstanceId === dash.id);
    expect(next.activePlayerId).toBe('indigo');
    expect(next.players.ochre.deck.hand).not.toContainEqual(dash);
    expect(next.players.ochre.deck.play).toContainEqual(dash);
    expect(next.round.actionStep).toBe(2);
  });

  it('lets duplicate named cards use the same piece in later action steps', () => {
    let state = freshState(); clearHands(state);
    const first = addCard(state, 'ochre', 'dash');
    const second = addCard(state, 'ochre', 'dash');
    state = take(state, (command) => command.type === 'playDash' && command.cardInstanceId === first.id && command.pieceId === 'ochre-a');
    state = take(state, (command) => command.type === 'baselineMove' && command.pieceId === 'indigo-a');
    state = take(state, (command) => command.type === 'playDash' && command.cardInstanceId === second.id && command.pieceId === 'ochre-a');
    expect(state.players.ochre.deck.play.map((card) => card.id)).toEqual([first.id, second.id]);
    expect(state.activePlayerId).toBe('indigo');
  });

  it('makes pass final and lets the other player continue alone', () => {
    let state = pass(freshState());
    expect(state.round.passedPlayerIds).toEqual(['ochre']);
    expect(state.activePlayerId).toBe('indigo');
    state = take(state, (command) => command.type === 'baselineMove' && command.pieceId === 'indigo-a');
    expect(state.activePlayerId).toBe('indigo');
    expect(listLegalActions(state).some((action) => action.command.type === 'baselineMove')).toBe(true);
    expect(state.round.passedPlayerIds).toEqual(['ochre']);
  });

  it('uses pass order for purchases, then cleans, draws, and alternates initiative', () => {
    let state = freshState(); clearHands(state);
    addCard(state, 'ochre', 'gold');
    addCard(state, 'indigo', 'silver');
    state = pass(state);
    state = pass(state);
    expect(state.phase).toBe('purchase');
    expect(state.round.purchaseOrder).toEqual(['ochre', 'indigo']);
    expect(state.activePlayerId).toBe('ochre');
    expect(state.players.ochre.money).toBe(3);
    const silverCount = state.supply.silver!;
    state = take(state, (command) => command.type === 'buyCard' && command.definitionId === 'silver');
    expect(state.supply.silver).toBe(silverCount - 1);
    expect(state.activePlayerId).toBe('indigo');
    state = take(state, (command) => command.type === 'skipPurchase');
    expect(state.phase).toBe('action');
    expect(state.round.number).toBe(2);
    expect(state.round.startingPlayerId).toBe('indigo');
    expect(state.activePlayerId).toBe('indigo');
    expect(state.round.passedPlayerIds).toEqual([]);
    expect(state.players.ochre.roundsCompleted).toBe(1);
    expect(state.players.indigo.roundsCompleted).toBe(1);
    expect(state.players.ochre.deck.hand).toHaveLength(5);
    expect(state.players.indigo.deck.hand).toHaveLength(5);
    expect(Object.values(state.pieces).map((piece) => piece.baselineMoves)).toEqual([1, 1, 1, 1]);
    assertInvariants(state);
  });

  it('replays every committed atomic command to the exact final state', () => {
    const initial = freshState();
    const commands: GameCommand[] = [];
    let state = snapshot(initial);
    for (const choose of [
      (command: GameCommand) => command.type === 'baselineMove' && command.pieceId === 'ochre-a',
      (command: GameCommand) => command.type === 'baselineMove' && command.pieceId === 'indigo-a',
      (command: GameCommand) => command.type === 'pass',
      (command: GameCommand) => command.type === 'pass',
      (command: GameCommand) => command.type === 'skipPurchase',
      (command: GameCommand) => command.type === 'skipPurchase'
    ]) {
      const action = actionFor(state, choose);
      commands.push(action.command);
      state = applyAction(state, action.id);
    }
    expect(replayCommands(initial, commands)).toEqual(state);
  });

  it('keeps a passed owner pending through purchases and respawns before its next action step', () => {
    let state = freshState(); clearHands(state); addCard(state, 'indigo', 'shove');
    setPosition(state, 'indigo-a', 2, 0); setPosition(state, 'ochre-a', 3, 0);
    setPosition(state, 'indigo-b', -2, 0); setPosition(state, 'ochre-b', 0, 2);
    state = pass(state);
    state = take(state, (command) => command.type === 'playShove' && command.actorId === 'indigo-a' && command.targetId === 'ochre-a');
    expect(state.pieces['ochre-a'].needsRespawn).toBe(true);
    expect(state.activePlayerId).toBe('indigo');
    state = pass(state);
    expect(state.phase).toBe('purchase');
    expect(state.activePlayerId).toBe('ochre');
    expect(state.pieces['ochre-a'].needsRespawn).toBe(true);
    assertInvariants(state);
    state = take(state, (command) => command.type === 'skipPurchase');
    state = take(state, (command) => command.type === 'skipPurchase');
    expect(state.round.number).toBe(2);
    expect(state.activePlayerId).toBe('indigo');
    expect(state.pieces['ochre-a'].needsRespawn).toBe(true);
    state = take(state, (command) => command.type === 'baselineMove' && command.pieceId === 'indigo-a');
    expect(state.activePlayerId).toBe('ochre');
    expect(state.pieces['ochre-a'].needsRespawn).toBe(false);
    expect(state.pieces['ochre-a'].baselineMoves).toBe(1);
    expect(state.events.at(-1)?.type).toBe('respawn');
  });

  it('automatically passes players with no board action in deterministic order', () => {
    let state = freshState(); clearHands(state);
    state.pieces['indigo-a'].baselineMoves = 0; state.pieces['indigo-b'].baselineMoves = 0;
    state = pass(state);
    expect(state.phase).toBe('purchase');
    expect(state.round.passedPlayerIds).toEqual(['ochre', 'indigo']);
    expect(state.round.purchaseOrder).toEqual(['ochre', 'indigo']);
  });

  it('uses indigo-first pass order for purchases', () => {
    let state = freshState();
    state.activePlayerId = 'indigo'; state.round.startingPlayerId = 'indigo';
    state = pass(state); state = pass(state);
    expect(state.phase).toBe('purchase');
    expect(state.round.purchaseOrder).toEqual(['indigo', 'ochre']);
    expect(state.activePlayerId).toBe('indigo');
  });
});

describe('ring-outs and round statuses', () => {
  it('scores immediately and respawns before the owner chooses without consuming the step', () => {
    let state = freshState(); clearHands(state);
    addCard(state, 'ochre', 'shove');
    setPosition(state, 'ochre-a', 2, 0); setPosition(state, 'ochre-b', -2, 0);
    setPosition(state, 'indigo-a', 3, 0); setPosition(state, 'indigo-b', 0, 2);
    state = take(state, (command) => command.type === 'playShove' && command.targetId === 'indigo-a');
    expect(state.scores.ochre).toBe(1);
    expect(state.pieces['indigo-a'].needsRespawn).toBe(false);
    expect(state.pieces['indigo-a'].position).toEqual({ q: 1, r: -1 });
    expect(state.activePlayerId).toBe('indigo');
    expect(state.round.actionStep).toBe(2);
    expect(state.events.map((event) => event.type)).toContain('respawn');
  });

  it('ends immediately on the fifth point without a respawn or handoff', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'shove');
    state.scores.ochre = 4;
    setPosition(state, 'ochre-a', 2, 0); setPosition(state, 'indigo-a', 3, 0);
    state = take(state, (command) => command.type === 'playShove' && command.targetId === 'indigo-a');
    expect(state.winner).toBe('ochre');
    expect(state.phase).toBe('ended');
    expect(state.scores.ochre).toBe(5);
    expect(state.pieces['indigo-a'].needsRespawn).toBe(true);
  });

  it('preserves unused and used baseline allowances through ring-out and respawn', () => {
    for (const baselineMoves of [1, 0]) {
      let state = freshState(); clearHands(state); addCard(state, 'ochre', 'shove');
      setPosition(state, 'ochre-a', 2, 0); setPosition(state, 'indigo-a', 3, 0);
      setPosition(state, 'ochre-b', -2, 0); setPosition(state, 'indigo-b', 0, 2);
      state.pieces['indigo-a'].baselineMoves = baselineMoves;
      state = take(state, (command) => command.type === 'playShove' && command.targetId === 'indigo-a');
      expect(state.pieces['indigo-a'].needsRespawn).toBe(false);
      expect(state.pieces['indigo-a'].baselineMoves).toBe(baselineMoves);
    }
  });

  it('Brace cancels one displacement, then clears, and unused Brace clears at cleanup', () => {
    let state = freshState(); clearHands(state);
    const brace = addCard(state, 'ochre', 'brace');
    addCard(state, 'indigo', 'shove');
    setPosition(state, 'ochre-a', 0, 0); setPosition(state, 'indigo-a', 1, 0);
    state = take(state, (command) => command.type === 'playBrace' && command.cardInstanceId === brace.id && command.pieceId === 'ochre-a');
    state = take(state, (command) => command.type === 'playShove' && command.targetId === 'ochre-a');
    expect(state.pieces['ochre-a'].position).toEqual({ q: 0, r: 0 });
    expect(state.pieces['ochre-a'].braced).toBe(false);
    state.pieces['ochre-b'].braced = true;
    while (state.phase === 'action') state = pass(state);
    state = take(state, (command) => command.type === 'skipPurchase'); state = take(state, (command) => command.type === 'skipPurchase');
    expect(state.pieces['ochre-b'].braced).toBe(false);
  });

  it('Pin persists across cleanup, consumes one baseline attempt, and then clears', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'pin');
    setPosition(state, 'ochre-a', 0, 0); setPosition(state, 'indigo-a', 1, 0);
    state = take(state, (command) => command.type === 'playPin' && command.targetId === 'indigo-a');
    while (state.phase === 'action') state = pass(state);
    state = take(state, (command) => command.type === 'skipPurchase'); state = take(state, (command) => command.type === 'skipPurchase');
    expect(state.pieces['indigo-a'].pinned).not.toBeNull();
    if (state.activePlayerId === 'indigo') {
      const before = state.pieces['indigo-a'].position;
      state = take(state, (command) => command.type === 'baselineMove' && command.pieceId === 'indigo-a');
      expect(state.pieces['indigo-a'].position).toEqual(before);
      expect(state.pieces['indigo-a'].baselineMoves).toBe(0);
      expect(state.pieces['indigo-a'].pinned).toBeNull();
    } else throw new Error('Indigo must start round two.');
  });

  it('Block expires at round cleanup and Relay is limited once per player per round', () => {
    let state = freshState(); clearHands(state);
    addCard(state, 'ochre', 'block'); addCard(state, 'ochre', 'relay'); addCard(state, 'ochre', 'relay');
    state = take(state, (command) => command.type === 'playBlock');
    state = take(state, (command) => command.type === 'baselineMove' && command.pieceId === 'indigo-a');
    state = take(state, (command) => command.type === 'playRelay');
    expect(state.round.relayUsed.ochre).toBe(true);
    state = take(state, (command) => command.type === 'baselineMove' && command.pieceId === 'indigo-b');
    expect(listLegalActions(state).some((action) => action.command.type === 'playRelay')).toBe(false);
    while (state.phase === 'action') state = pass(state);
    state = take(state, (command) => command.type === 'skipPurchase'); state = take(state, (command) => command.type === 'skipPurchase');
    expect(state.blocks).toEqual([]);
    expect(state.round.relayUsed.ochre).toBe(false);
  });

  it('keeps Pin through ring-out and respawn until the pinned baseline attempt', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'shove');
    setPosition(state, 'ochre-a', 2, 0); setPosition(state, 'indigo-a', 3, 0);
    setPosition(state, 'ochre-b', -2, 0); setPosition(state, 'indigo-b', 0, 2);
    state.pieces['indigo-a'].pinned = { sourcePlayerId: 'ochre' };
    state = take(state, (command) => command.type === 'playShove' && command.targetId === 'indigo-a');
    expect(state.pieces['indigo-a'].needsRespawn).toBe(false);
    expect(state.pieces['indigo-a'].pinned).not.toBeNull();
    const before = state.pieces['indigo-a'].position;
    state = take(state, (command) => command.type === 'baselineMove' && command.pieceId === 'indigo-a');
    expect(state.pieces['indigo-a'].position).toEqual(before);
    expect(state.pieces['indigo-a'].pinned).toBeNull();
  });
});

describe('approved card costs and abilities', () => {
  it('uses the exact approved costs and treasure values', () => {
    expect(Object.fromEntries(Object.entries(CARDS).map(([id, card]) => [id, card.cost]))).toEqual({
      copper: 0, silver: 3, gold: 6, shove: 2, dash: 2, brace: 2, cull: 3,
      drive: 3, breaker: 3, press: 5, pull: 2, vault: 3, sweep: 4,
      relay: 4, block: 2, pin: 2, corner: 4
    });
    expect([CARDS.copper?.money, CARDS.silver?.money, CARDS.gold?.money]).toEqual([1, 2, 3]);
  });

  it('Shove pushes only the target', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'shove');
    setPosition(state, 'ochre-a', 0, 0); setPosition(state, 'indigo-a', 1, 0);
    state = take(state, (command) => command.type === 'playShove' && command.actorId === 'ochre-a' && command.targetId === 'indigo-a');
    expect(state.pieces['ochre-a'].position).toEqual({ q: 0, r: 0 });
    expect(state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });
  });

  it('Dash moves one friendly piece without spending its baseline move', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'dash');
    state = take(state, (command) => command.type === 'playDash' && command.pieceId === 'ochre-a' && command.destination.q === 0 && command.destination.r === 0);
    expect(state.pieces['ochre-a'].position).toEqual({ q: 0, r: 0 });
    expect(state.pieces['ochre-a'].baselineMoves).toBe(1);
  });

  it('Cull trashes exactly two other cards or itself and one other card', () => {
    let state = freshState(); clearHands(state);
    const cull = addCard(state, 'ochre', 'cull'); const copper = addCard(state, 'ochre', 'copper'); const silver = addCard(state, 'ochre', 'silver');
    state = take(state, (command) => command.type === 'playCull' && command.trashInstanceIds.includes(copper.id) && command.trashInstanceIds.includes(silver.id));
    expect(state.trash.map((card) => card.id).sort()).toEqual([copper.id, silver.id].sort());
    expect(state.players.ochre.deck.play).toContainEqual(cull);

    state = freshState(); clearHands(state);
    const self = addCard(state, 'ochre', 'cull'); const other = addCard(state, 'ochre', 'copper');
    state = take(state, (command) => command.type === 'playCull' && command.trashInstanceIds.includes(self.id));
    expect(state.trash.map((card) => card.id).sort()).toEqual([self.id, other.id].sort());
    expect(state.players.ochre.deck.play).toEqual([]);
  });

  it('Drive pushes and follows; Breaker removes Brace and pushes', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'drive');
    setPosition(state, 'ochre-a', 0, 0); setPosition(state, 'indigo-a', 1, 0);
    state = take(state, (command) => command.type === 'playDrive' && command.actorId === 'ochre-a');
    expect(state.pieces['ochre-a'].position).toEqual({ q: 1, r: 0 });
    expect(state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });

    state = freshState(); clearHands(state); addCard(state, 'ochre', 'breaker');
    setPosition(state, 'ochre-a', 0, 0); setPosition(state, 'indigo-a', 1, 0); state.pieces['indigo-a'].braced = true;
    state = take(state, (command) => command.type === 'playBreaker' && command.targetId === 'indigo-a');
    expect(state.pieces['indigo-a'].braced).toBe(false);
    expect(state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });
  });

  it('Press adds a second push only after an earlier displacement this round', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'shove'); addCard(state, 'ochre', 'press');
    setPosition(state, 'ochre-a', -1, 0); setPosition(state, 'indigo-a', 0, 0);
    setPosition(state, 'ochre-b', 0, 1); setPosition(state, 'indigo-b', -3, 0);
    state = take(state, (command) => command.type === 'playShove' && command.actorId === 'ochre-a' && command.targetId === 'indigo-a');
    state = take(state, (command) => command.type === 'baselineMove' && command.pieceId === 'indigo-b');
    state = take(state, (command) => command.type === 'playPress' && command.actorId === 'ochre-b' && command.targetId === 'indigo-a');
    expect(state.pieces['indigo-a'].position).toEqual({ q: 3, r: -2 });
    expect(state.pieces['ochre-b'].position).toEqual({ q: 0, r: 1 });
  });

  it('enabled Press spends Brace on the first attempt and resolves the extra displacement', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'press');
    setPosition(state, 'ochre-a', -1, 0); setPosition(state, 'indigo-a', 0, 0);
    setPosition(state, 'ochre-b', -3, 0); setPosition(state, 'indigo-b', 0, 3);
    state.pieces['indigo-a'].braced = true; state.round.pressSetupPieceIds = ['indigo-a'];
    state = take(state, (command) => command.type === 'playPress' && command.actorId === 'ochre-a');
    expect(state.pieces['indigo-a'].braced).toBe(false);
    expect(state.pieces['indigo-a'].position).toEqual({ q: 1, r: 0 });
  });

  it('Pull moves a target exactly two away one hex toward the actor', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'pull');
    setPosition(state, 'ochre-a', -1, 0); setPosition(state, 'indigo-a', 1, 0);
    state = take(state, (command) => command.type === 'playPull' && command.targetId === 'indigo-a');
    expect(state.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
  });

  it('Vault jumps over either adjacent piece into the empty hex beyond', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'vault');
    setPosition(state, 'ochre-a', -1, 0); setPosition(state, 'indigo-a', 0, 0);
    setPosition(state, 'indigo-b', 0, 3);
    state = take(state, (command) => command.type === 'playVault' && command.pieceId === 'ochre-a' && command.jumpedPieceId === 'indigo-a');
    expect(state.pieces['ochre-a'].position).toEqual({ q: 1, r: 0 });
    expect(state.pieces['ochre-a'].baselineMoves).toBe(1);
  });

  it('Sweep offers both 120 degree destinations, ignores intermediate hexes, and can ring out', () => {
    let state = freshState(); clearHands(state); const sweep = addCard(state, 'ochre', 'sweep');
    setPosition(state, 'ochre-a', 0, 0); setPosition(state, 'indigo-a', 1, 0);
    setPosition(state, 'ochre-b', -3, 0); setPosition(state, 'indigo-b', 0, 3);
    state.blocks.push({ id: 'block-test', ownerId: 'ochre', position: { q: 1, r: -1 }, expiresAfterRound: 1 });
    const sweeps = listLegalActions(state).filter((action) => action.command.type === 'playSweep' && action.command.cardInstanceId === sweep.id && action.command.actorId === 'ochre-a' && action.command.targetId === 'indigo-a');
    expect(sweeps.map((action) => action.command.type === 'playSweep' ? action.command.destination : null)).toEqual(expect.arrayContaining([{ q: -1, r: 1 }, { q: 0, r: -1 }]));

    state = freshState(); clearHands(state); addCard(state, 'ochre', 'sweep');
    setPosition(state, 'ochre-a', 3, 0); setPosition(state, 'indigo-a', 3, -1);
    const offBoard = actionFor(state, (command) => command.type === 'playSweep' && Math.max(Math.abs(command.destination.q), Math.abs(command.destination.r), Math.abs(command.destination.q + command.destination.r)) > 3);
    state = applyAction(state, offBoard.id);
    expect(state.scores.ochre).toBe(1);
  });

  it('Relay swaps both pieces at any distance', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'relay');
    setPosition(state, 'ochre-a', -3, 0); setPosition(state, 'ochre-b', 3, 0);
    state = take(state, (command) => command.type === 'playRelay');
    expect(state.pieces['ochre-a'].position).toEqual({ q: 3, r: 0 });
    expect(state.pieces['ochre-b'].position).toEqual({ q: -3, r: 0 });
  });

  it('Block places next to a friendly piece and a third Block replaces one selected Block', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'block');
    state.blocks = [
      { id: 'old-1', ownerId: 'ochre', position: { q: -2, r: 0 }, expiresAfterRound: 1 },
      { id: 'old-2', ownerId: 'ochre', position: { q: -2, r: 2 }, expiresAfterRound: 1 }
    ];
    state = take(state, (command) => command.type === 'playBlock' && command.replaceBlockId === 'old-1');
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks.some((block) => block.id === 'old-1')).toBe(false);
    expect(state.blocks.some((block) => block.id === 'old-2')).toBe(true);
  });

  it('Pin marks an adjacent enemy and does not stop Dash', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'pin'); addCard(state, 'indigo', 'dash');
    setPosition(state, 'ochre-a', 0, 0); setPosition(state, 'indigo-a', 1, 0);
    state = take(state, (command) => command.type === 'playPin' && command.targetId === 'indigo-a');
    state = take(state, (command) => command.type === 'playDash' && command.pieceId === 'indigo-a');
    expect(state.pieces['indigo-a'].pinned).not.toBeNull();
    expect(state.pieces['indigo-a'].position).not.toEqual({ q: 1, r: 0 });
  });

  it('Corner pushes twice when Pinned or when the first destination touches an owned Block', () => {
    let state = freshState(); clearHands(state); addCard(state, 'ochre', 'corner');
    setPosition(state, 'ochre-a', -1, 0); setPosition(state, 'indigo-a', 0, 0); state.pieces['indigo-a'].pinned = { sourcePlayerId: 'ochre' };
    setPosition(state, 'ochre-b', -3, 0); setPosition(state, 'indigo-b', 0, 3);
    state = take(state, (command) => command.type === 'playCorner' && command.actorId === 'ochre-a' && command.targetId === 'indigo-a');
    expect(state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });

    state = freshState(); clearHands(state); addCard(state, 'ochre', 'corner');
    setPosition(state, 'ochre-a', -1, 0); setPosition(state, 'indigo-a', 0, 0);
    setPosition(state, 'ochre-b', -3, 0); setPosition(state, 'indigo-b', 0, 3);
    state.blocks.push({ id: 'corner-block', ownerId: 'ochre', position: { q: 1, r: -1 }, expiresAfterRound: 1 });
    state = take(state, (command) => command.type === 'playCorner' && command.actorId === 'ochre-a' && command.targetId === 'indigo-a');
    expect(state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });
  });

  it('enabled Corner spends Brace on the first attempt and resolves the Pin or Block extra displacement', () => {
    for (const setup of ['pin', 'block'] as const) {
      let state = freshState(); clearHands(state); addCard(state, 'ochre', 'corner');
      setPosition(state, 'ochre-a', -1, 0); setPosition(state, 'indigo-a', 0, 0);
      setPosition(state, 'ochre-b', -3, 0); setPosition(state, 'indigo-b', 0, 3);
      state.pieces['indigo-a'].braced = true;
      if (setup === 'pin') state.pieces['indigo-a'].pinned = { sourcePlayerId: 'ochre' };
      else state.blocks.push({ id: 'corner-block', ownerId: 'ochre', position: { q: 0, r: -1 }, expiresAfterRound: 1 });
      state = take(state, (command) => command.type === 'playCorner' && command.actorId === 'ochre-a');
      expect(state.pieces['indigo-a'].braced).toBe(false);
      expect(state.pieces['indigo-a'].position).toEqual({ q: 1, r: 0 });
    }
  });

  it('gives every pinned attempted destination a distinct complete summary', () => {
    const state = freshState();
    state.pieces['ochre-a'].pinned = { sourcePlayerId: 'indigo' };
    const attempts = listLegalActions(state).filter((action) => action.command.type === 'baselineMove' && action.command.pieceId === 'ochre-a');
    expect(attempts.length).toBeGreaterThan(1);
    expect(new Set(attempts.map((action) => action.id)).size).toBe(attempts.length);
    expect(new Set(attempts.map((action) => action.label)).size).toBe(attempts.length);
    expect(attempts.every((action) => action.label.includes(' from ') && action.label.includes(' to '))).toBe(true);
    const before = state.pieces['ochre-a'].position;
    const next = applyAction(state, attempts[0]!.id);
    expect(next.pieces['ochre-a'].position).toEqual(before);
    expect(next.pieces['ochre-a'].baselineMoves).toBe(0);
    expect(next.pieces['ochre-a'].pinned).toBeNull();
  });

  it('replays a schema-rematerialized command with a different key order', () => {
    const initial = freshState(); clearHands(initial); const dash = addCard(initial, 'ochre', 'dash');
    const original: GameCommand = { type: 'playDash', cardInstanceId: dash.id, pieceId: 'ochre-a', destination: { q: 0, r: 0 } };
    const reordered = {
      destination: { r: 0, q: 0 }, pieceId: 'ochre-a', cardInstanceId: dash.id, type: 'playDash'
    } as GameCommand;
    expect(applyCommand(initial, reordered)).toEqual(applyCommand(initial, original));
  });

  it('rejects commands that are not one current enumerated action', () => {
    const state = freshState();
    expect(() => applyAction(state, 'v999-action-1')).toThrow('Unknown or stale');
    expect(() => applyCommand(state, { type: 'baselineMove', pieceId: 'ochre-a', destination: { q: 99, r: 99 } })).toThrow('Illegal command');
  });
});
