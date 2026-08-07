import { describe, expect, it } from 'vitest';
import type { BoardState } from '../../src/board/schema';
import type { ReplayBoardActions } from '../../src/replay/schema';
import { buildBoardAnnotations } from '../../viewer/src/annotations';
import { skirmishUnit } from '../helpers/skirmish';

describe('board replay annotations', () => {
  it('draws each attack from the unit recorded in that activation', () => {
    const previousState = state([
      { ...skirmishUnit('P1-left', 'P1', 'soldier', 3, 7), hp: 6 },
      { ...skirmishUnit('P1-right', 'P1', 'soldier', 5, 7), hp: 6 },
      skirmishUnit('P2-left', 'P2', 'soldier', 4, 8),
      skirmishUnit('P2-right', 'P2', 'soldier', 8, 8)
    ]);
    const currentState = state([
      { ...skirmishUnit('P1-left', 'P1', 'soldier', 3, 7), hp: 5 },
      { ...skirmishUnit('P1-right', 'P1', 'soldier', 5, 7), hp: 4 },
      skirmishUnit('P2-left', 'P2', 'soldier', 4, 8),
      skirmishUnit('P2-right', 'P2', 'soldier', 8, 8)
    ]);
    const actions: ReplayBoardActions = {
      keyPointUpgrades: [],
      upgrades: [],
      activations: [
        {
          unit: 'P2-left',
          from: { col: 4, row: 8 },
          attack: { target: 'P1-left', damage: 1, targetRemoved: false },
          to: { col: 4, row: 8 }
        },
        {
          unit: 'P2-right',
          from: { col: 8, row: 8 },
          attack: { target: 'P1-right', damage: 2, targetRemoved: false },
          to: { col: 8, row: 8 }
        }
      ]
    };

    const attacks = buildBoardAnnotations(previousState, currentState, 'P2', actions).filter((annotation) => annotation.kind === 'attack');

    expect(attacks.map((annotation) => ({ attacker: annotation.from?.id, target: annotation.to.id, label: annotation.label }))).toEqual([
      { attacker: 'P2-left', target: 'P1-left', label: '-1' },
      { attacker: 'P2-right', target: 'P1-right', label: '-2' }
    ]);
  });

  it('shows one combined damage label when multiple attacks hit the same unit', () => {
    const previousState = state([
      { ...skirmishUnit('P1-target', 'P1', 'soldier', 4, 8), hp: 6 },
      skirmishUnit('P2-left', 'P2', 'soldier', 4, 9),
      skirmishUnit('P2-right', 'P2', 'soldier', 5, 8)
    ]);
    const currentState = state([
      { ...skirmishUnit('P1-target', 'P1', 'soldier', 4, 8), hp: 4 },
      skirmishUnit('P2-left', 'P2', 'soldier', 4, 9),
      skirmishUnit('P2-right', 'P2', 'soldier', 5, 8)
    ]);
    const actions: ReplayBoardActions = {
      keyPointUpgrades: [],
      upgrades: [],
      activations: [
        {
          unit: 'P2-left',
          from: { col: 4, row: 9 },
          attack: { target: 'P1-target', damage: 1, targetRemoved: false },
          to: { col: 4, row: 9 }
        },
        {
          unit: 'P2-right',
          from: { col: 5, row: 8 },
          attack: { target: 'P1-target', damage: 1, targetRemoved: false },
          to: { col: 5, row: 8 }
        }
      ]
    };

    const attacks = buildBoardAnnotations(previousState, currentState, 'P2', actions).filter((annotation) => annotation.kind === 'attack');

    expect(attacks.map((annotation) => ({ attacker: annotation.from?.id, label: annotation.label, showImpact: annotation.showImpact }))).toEqual([
      { attacker: 'P2-left', label: '-2', showImpact: false },
      { attacker: 'P2-right', label: '-2', showImpact: true }
    ]);
  });
});

function state(units: BoardState['units']): BoardState {
  return {
    schemaVersion: 1,
    ruleset: 'skirmish-v1',
    map: 'skirmish-v1',
    players: ['P1', 'P2'],
    turn: { activePlayer: 'P1', round: 1 },
    units,
    notes: []
  };
}
