import { describe, expect, it } from 'vitest';
import type { LegalAction } from '../src/game';
import {
  actionsForCard, baselineActionsForPiece, commandActorId, commandDestination, commandTargetId
} from '../src/client/actionPresentation';

const actions: LegalAction[] = [
  {
    id: 'move', label: 'Move',
    command: { type: 'baselineMove', pieceId: 'ochre-a', destination: { q: 0, r: 0 } }
  },
  {
    id: 'shove', label: 'Shove',
    command: { type: 'playShove', cardInstanceId: 'card-1', actorId: 'ochre-a', targetId: 'indigo-a' }
  },
  {
    id: 'dash', label: 'Dash',
    command: { type: 'playDash', cardInstanceId: 'card-2', pieceId: 'ochre-b', destination: { q: 0, r: 1 } }
  }
];

describe('client action presentation', () => {
  it('groups choices by physical card instance', () => {
    expect(actionsForCard(actions, 'card-1').map((action) => action.id)).toEqual(['shove']);
    expect(actionsForCard(actions, 'card-2').map((action) => action.id)).toEqual(['dash']);
  });

  it('finds baseline destinations without treating card movement as baseline movement', () => {
    expect(baselineActionsForPiece(actions, 'ochre-a').map((action) => action.id)).toEqual(['move']);
    expect(commandDestination(actions[0]!.command)).toEqual({ q: 0, r: 0 });
    expect(commandDestination(actions[1]!.command)).toBeNull();
  });

  it('keeps actor and target roles separate', () => {
    expect(commandActorId(actions[1]!.command)).toBe('ochre-a');
    expect(commandTargetId(actions[1]!.command)).toBe('indigo-a');
  });
});
