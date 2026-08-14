import { describe, expect, it } from 'vitest';
import { applyCommand, assertInvariants, checkInvariants, listLegalActions } from '../src/game';
import type { GameCommand, GameState, PieceId } from '../src/game';
import { clearHand, gameFor, giveCard, setPosition } from './helpers';

type PlayCommand = Exclude<GameCommand,
  { type: 'respawn' | 'baselineMove' | 'enterBuyPhase' | 'buyCard' | 'endTurn' }
>;

interface ActorLimitCase {
  definitionId: string;
  configure?: (state: GameState) => void;
  firstCommand: (cardInstanceId: string) => PlayCommand;
}

const dualTargets = {
  'ochre-a': { q: 0, r: 0 },
  'ochre-b': { q: 0, r: 1 },
  'indigo-a': { q: 1, r: 0 },
  'indigo-b': { q: -1, r: 1 }
} as const;

const actorLimitedCases: ActorLimitCase[] = [
  {
    definitionId: 'shove',
    firstCommand: (cardInstanceId) => ({
      type: 'playShove', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
    })
  },
  {
    definitionId: 'drive',
    firstCommand: (cardInstanceId) => ({
      type: 'playDrive', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
    })
  },
  {
    definitionId: 'breaker',
    firstCommand: (cardInstanceId) => ({
      type: 'playBreaker', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
    })
  },
  {
    definitionId: 'press',
    firstCommand: (cardInstanceId) => ({
      type: 'playPress', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
    })
  },
  {
    definitionId: 'pull',
    configure: (state) => {
      setPosition(state, 'indigo-a', { q: 2, r: 0 });
      setPosition(state, 'indigo-b', { q: -2, r: 1 });
    },
    firstCommand: (cardInstanceId) => ({
      type: 'playPull', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
    })
  },
  {
    definitionId: 'sweep',
    firstCommand: (cardInstanceId) => ({
      type: 'playSweep', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a',
      destination: { q: 1, r: -1 }
    })
  },
  {
    definitionId: 'block',
    firstCommand: (cardInstanceId) => ({
      type: 'playBlock', cardInstanceId, actorId: 'ochre-a', destination: { q: 0, r: -1 }
    })
  },
  {
    definitionId: 'pin',
    firstCommand: (cardInstanceId) => ({
      type: 'playPin', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
    })
  },
  {
    definitionId: 'corner',
    firstCommand: (cardInstanceId) => ({
      type: 'playCorner', cardInstanceId, actorId: 'ochre-a', targetId: 'indigo-a'
    })
  },
  {
    definitionId: 'dash',
    firstCommand: (cardInstanceId) => ({
      type: 'playDash', cardInstanceId, pieceId: 'ochre-a', destination: { q: 1, r: -1 }
    })
  },
  {
    definitionId: 'vault',
    firstCommand: (cardInstanceId) => ({
      type: 'playVault', cardInstanceId, pieceId: 'ochre-a', jumpedPieceId: 'indigo-a'
    })
  },
  {
    definitionId: 'brace',
    firstCommand: (cardInstanceId) => ({ type: 'playBrace', cardInstanceId, pieceId: 'ochre-a' })
  }
];

describe('per-piece card use', () => {
  for (const setup of actorLimitedCases) {
    it(`limits ${setup.definitionId} to one use per piece and keeps the other piece available`, () => {
      const state = actorLimitState(setup.definitionId);
      setup.configure?.(state);
      const firstCard = state.players.ochre.deck.hand[0]!;
      const secondCard = state.players.ochre.deck.hand[1]!;

      const next = applyCommand(state, setup.firstCommand(firstCard.id));

      expect(next.turn.actionUses).toEqual([
        { pieceId: 'ochre-a', definitionId: setup.definitionId }
      ]);
      const secondActions = listLegalActions(next).filter(
        (action) => 'cardInstanceId' in action.command
          && action.command.cardInstanceId === secondCard.id
      );
      expect(secondActions.length).toBeGreaterThan(0);
      expect(new Set(secondActions.map((action) => commandActor(action.command)))).toEqual(
        new Set<PieceId>(['ochre-b'])
      );
      assertInvariants(next);
    });
  }

  it('limits Relay to one use during a turn', () => {
    const state = actorLimitState('relay');
    const firstCard = state.players.ochre.deck.hand[0]!;
    const secondCard = state.players.ochre.deck.hand[1]!;

    const next = applyCommand(state, { type: 'playRelay', cardInstanceId: firstCard.id });

    expect(next.turn.relayUsed).toBe(true);
    expect(listLegalActions(next).some(
      (action) => action.command.type === 'playRelay'
        && action.command.cardInstanceId === secondCard.id
    )).toBe(false);
    assertInvariants(next);
  });

  it('keeps a different named action legal for the same piece', () => {
    let state = gameFor();
    clearHand(state);
    const shove = giveCard(state, 'shove');
    const drive = giveCard(state, 'drive');
    for (const [pieceId, position] of Object.entries(dualTargets)) {
      setPosition(state, pieceId as PieceId, position);
    }

    state = applyCommand(state, {
      type: 'playShove', cardInstanceId: shove.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    const driveAction = listLegalActions(state).find(
      (action) => action.command.type === 'playDrive'
        && action.command.cardInstanceId === drive.id
        && action.command.actorId === 'ochre-a'
        && action.command.targetId === 'indigo-b'
    );

    expect(driveAction).toBeDefined();
    state = applyCommand(state, driveAction!.command);
    expect(state.turn.actionUses).toEqual([
      { pieceId: 'ochre-a', definitionId: 'shove' },
      { pieceId: 'ochre-a', definitionId: 'drive' }
    ]);
    assertInvariants(state);
  });

  it('lets both duplicate Cull cards resolve during one turn', () => {
    let state = gameFor();
    clearHand(state);
    const firstCull = giveCard(state, 'cull');
    const secondCull = giveCard(state, 'cull');
    const copper = giveCard(state, 'copper');
    const silver = giveCard(state, 'silver');

    state = applyCommand(state, {
      type: 'playCull', cardInstanceId: firstCull.id, trashInstanceId: copper.id
    });
    state = applyCommand(state, {
      type: 'playCull', cardInstanceId: secondCull.id, trashInstanceId: silver.id
    });

    expect(state.players.ochre.deck.play.map((card) => card.definitionId)).toEqual(['cull', 'cull']);
    expect(state.trash.map((card) => card.definitionId)).toEqual(['copper', 'silver']);
    expect(state.turn.actionUses).toEqual([]);
    assertInvariants(state);
  });

  it('plays every treasure without adding a turn use', () => {
    let state = gameFor();
    clearHand(state);
    giveCard(state, 'copper');
    giveCard(state, 'copper');
    giveCard(state, 'silver');

    state = applyCommand(state, { type: 'enterBuyPhase' });

    expect(state.players.ochre.money).toBe(4);
    expect(state.players.ochre.deck.play.map((card) => card.definitionId)).toEqual([
      'copper', 'copper', 'silver'
    ]);
    expect(state.turn.actionUses).toEqual([]);
    expect(state.turn.relayUsed).toBe(false);
    assertInvariants(state);
  });

  it('resets piece and Relay limits when the next turn starts', () => {
    let state = actorLimitState('shove');
    const shove = state.players.ochre.deck.hand[0]!;
    const relay = giveCard(state, 'relay');
    state = applyCommand(state, {
      type: 'playShove', cardInstanceId: shove.id, actorId: 'ochre-a', targetId: 'indigo-a'
    });
    state = applyCommand(state, { type: 'playRelay', cardInstanceId: relay.id });
    expect(state.turn.actionUses).toEqual([{ pieceId: 'ochre-a', definitionId: 'shove' }]);
    expect(state.turn.relayUsed).toBe(true);

    state = applyCommand(state, { type: 'enterBuyPhase' });
    state = applyCommand(state, { type: 'endTurn' });

    expect(state.activePlayerId).toBe('indigo');
    expect(state.turn.actionUses).toEqual([]);
    expect(state.turn.relayUsed).toBe(false);
    assertInvariants(state);
  });

  it('reports an unknown action-use piece as an invariant error', () => {
    const state = gameFor();
    state.turn.actionUses.push({ pieceId: 'unknown-piece' as PieceId, definitionId: 'shove' });

    expect(checkInvariants(state)).toContain('Action use has unknown piece unknown-piece.');
  });
});

function actorLimitState(definitionId: string): GameState {
  const state = gameFor();
  clearHand(state);
  giveCard(state, definitionId);
  giveCard(state, definitionId);
  for (const [pieceId, position] of Object.entries(dualTargets)) {
    setPosition(state, pieceId as PieceId, position);
  }
  return state;
}

function commandActor(command: GameCommand): PieceId | null {
  if ('actorId' in command) return command.actorId;
  if (command.type === 'playDash' || command.type === 'playBrace' || command.type === 'playVault') {
    return command.pieceId;
  }
  return null;
}
