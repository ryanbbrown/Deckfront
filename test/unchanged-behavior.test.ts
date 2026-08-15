import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  RESPAWN_ANCHORS, SeededRandom, applyCommand, createGame, shuffle
} from '../src/game';
import {
  DIRECTIONS, allBoardCoordinates, directionFromTo, distance, onBoard, rotate60
} from '../src/game/hex';
import type { LegalAction } from '../src/game';
import {
  actionsForCard, baselineActionsForPiece, commandActorId, commandDestination, commandTargetId,
  uniqueActorIds, uniqueTargetIds
} from '../src/client/actionPresentation';

const executeFile = promisify(execFile);

describe('unchanged board geometry', () => {
  it('keeps 37 radius-three cells, six directions, and exact respawn anchors', () => {
    expect(allBoardCoordinates()).toHaveLength(37);
    expect(DIRECTIONS).toEqual([
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ]);
    expect(RESPAWN_ANCHORS).toEqual({
      ochre: [{ q: -1, r: 0 }, { q: -1, r: 1 }],
      indigo: [{ q: 1, r: -1 }, { q: 1, r: 0 }]
    });
    expect([{ q: 3, r: 0 }, { q: 0, r: -3 }, { q: -3, r: 3 }].every(onBoard)).toBe(true);
    expect([{ q: 4, r: 0 }, { q: 0, r: -4 }, { q: -4, r: 4 }].every((coordinate) => !onBoard(coordinate))).toBe(true);
  });

  it('computes exact distances, adjacent directions, and rotations', () => {
    expect(distance({ q: -2, r: 1 }, { q: 2, r: -1 })).toBe(4);
    expect(directionFromTo({ q: 0, r: 0 }, { q: 1, r: -1 })).toEqual({ q: 1, r: -1 });
    expect(directionFromTo({ q: 0, r: 0 }, { q: 2, r: -2 })).toBeNull();
    expect(rotate60({ q: 1, r: 0 }, true)).toEqual({ q: 1, r: -1 });
    expect(rotate60({ q: 1, r: 0 }, false)).toEqual({ q: 0, r: 1 });
  });
});

describe('seeded shuffle and cleanup draw', () => {
  it('keeps seeded setup and Fisher-Yates output deterministic', () => {
    expect(createGame(9823)).toEqual(createGame(9823));
    expect(createGame(9823)).not.toEqual(createGame(9824));
    expect(shuffle(['a', 'b', 'c', 'd', 'e'], new SeededRandom(7))).toEqual(['a', 'c', 'e', 'd', 'b']);
  });

  it('reshuffles each discard and draws exactly five during round cleanup', () => {
    let state = createGame(31);
    for (const playerId of ['ochre', 'indigo'] as const) {
      const deck = state.players[playerId].deck;
      deck.discard.push(...deck.draw, ...deck.hand, ...deck.play);
      deck.draw = []; deck.hand = []; deck.play = [];
    }
    state.phase = 'purchase'; state.round.passedPlayerIds = ['ochre', 'indigo'];
    state.round.purchaseOrder = ['ochre', 'indigo']; state.round.purchaseIndex = 0; state.activePlayerId = 'ochre';
    state = applyCommand(state, { type: 'skipPurchase' });
    state = applyCommand(state, { type: 'skipPurchase' });
    expect(state.players.ochre.deck.hand.map((card) => card.id)).toEqual(['card-6', 'card-1', 'card-4', 'card-5', 'card-3']);
    expect(state.players.ochre.deck.draw.map((card) => card.id)).toEqual(['card-7', 'card-2', 'card-10', 'card-8', 'card-9']);
    expect(state.players.indigo.deck.hand.map((card) => card.id)).toEqual(['card-14', 'card-15', 'card-17', 'card-11', 'card-13']);
    expect(state.players.indigo.deck.draw.map((card) => card.id)).toEqual(['card-19', 'card-16', 'card-20', 'card-12', 'card-18']);
    expect(state.players.ochre.deck.discard).toEqual([]);
    expect(state.players.indigo.deck.discard).toEqual([]);
    expect(state.rngState).toBe(3362464825);
  });
});

describe('client action presentation', () => {
  const actions: LegalAction[] = [
    { id: 'move', label: 'Move', command: { type: 'baselineMove', pieceId: 'ochre-a', destination: { q: 0, r: 0 } } },
    { id: 'shove', label: 'Shove', command: { type: 'playShove', cardInstanceId: 'card-1', actorId: 'ochre-a', targetId: 'indigo-a' } },
    { id: 'dash', label: 'Dash', command: { type: 'playDash', cardInstanceId: 'card-2', pieceId: 'ochre-b', destination: { q: 0, r: 1 } } }
  ];

  it('selects exact cards, baseline choices, destinations, actors, and targets', () => {
    expect(actionsForCard(actions, 'card-1').map((action) => action.id)).toEqual(['shove']);
    expect(actionsForCard(actions, 'card-2').map((action) => action.id)).toEqual(['dash']);
    expect(baselineActionsForPiece(actions, 'ochre-a').map((action) => action.id)).toEqual(['move']);
    expect(commandDestination(actions[0]!.command)).toEqual({ q: 0, r: 0 });
    expect(commandDestination(actions[1]!.command)).toBeNull();
    expect(commandActorId(actions[1]!.command)).toBe('ochre-a');
    expect(commandTargetId(actions[1]!.command)).toBe('indigo-a');
    expect(uniqueActorIds(actions)).toEqual(['ochre-a', 'ochre-b']);
    expect(uniqueTargetIds(actions)).toEqual(['indigo-a']);
  });
});

describe('one-action Python tool contract', () => {
  it('rejects a second choose_action call and keeps the first selection', async () => {
    const script = [
      'import json',
      'from scripts.run_ai_action import ActionTool, ChooseActionArgs',
      'tool = ActionTool({"v1-action-1", "v1-action-2"})',
      'first = tool.choose(ChooseActionArgs(action_id="v1-action-1"))',
      'second = tool.choose(ChooseActionArgs(action_id="v1-action-2"))',
      'print(json.dumps({"first": first.content, "second": second.content, "selected": tool.selected, "calls": tool.calls}))'
    ].join('; ');
    const { stdout } = await executeFile('uv', ['run', 'python', '-c', script], { cwd: process.cwd() });
    expect(JSON.parse(stdout)).toEqual({
      first: 'Action accepted. End your response now.',
      second: 'Exactly one action is allowed.',
      selected: 'v1-action-1',
      calls: [
        { tool: 'choose_action', actionId: 'v1-action-1' },
        { tool: 'choose_action', actionId: 'v1-action-2' }
      ]
    });
  });
});
