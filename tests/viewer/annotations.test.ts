import { describe, expect, it } from 'vitest';
import type { BoardState } from '../../src/board/schema';
import type { ReplayBoardAction } from '../../src/replay/schema';
import { buildBoardAnnotations } from '../../viewer/src/annotations';
import { skirmishUnit } from '../helpers/skirmish';

describe('board replay annotations', () => {
  it('draws one activation attack and both movement legs', () => {
    const previous = state([skirmishUnit('p1', 'P1', 'soldier', 3, 7), skirmishUnit('p2', 'P2', 'soldier', 5, 7)]);
    const current = state([skirmishUnit('p1', 'P1', 'soldier', 3, 7), { ...skirmishUnit('p2', 'P2', 'soldier', 5, 7), hp: 5 }]);
    const action: ReplayBoardAction = { type: 'activation', activation: { unit: 'p1', from: { col: 3, row: 7 }, via: { col: 4, row: 7 }, attack: { target: 'p2', damage: 1, targetRemoved: false }, to: { col: 3, row: 7 } } };
    const annotations = buildBoardAnnotations(previous, current, 'P1', action);
    expect(annotations.map((item) => item.kind)).toEqual(['movement', 'attack', 'movement']);
    expect(annotations.find((item) => item.kind === 'attack')).toMatchObject({ label: '-1', from: { id: 'p1' }, to: { id: 'p2' } });
  });

  it('draws no action annotation for setup', () => {
    const previous = state([skirmishUnit('p1', 'P1', 'soldier', 0, 8)]);
    const current = state([skirmishUnit('p1', 'P1', 'soldier', 1, 8)]);
    expect(buildBoardAnnotations(previous, current, 'P1', { type: 'setup', keyPointUpgrades: [], upgrades: [] })).toEqual([]);
  });
});

function state(units: BoardState['units']): BoardState {
  return { schemaVersion: 1, ruleset: 'skirmish-v1', map: 'skirmish-v1', players: ['P1', 'P2'], turn: { round: 1, phase: 'activation', initiativePlayer: 'P1', activePlayer: 'P1', completedSetupPlayers: ['P1', 'P2'], activatedUnitIds: [], activationCounts: { P1: 0, P2: 0 } }, units, notes: [] };
}
