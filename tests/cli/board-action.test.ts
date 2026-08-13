import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';
import type { BoardState } from '../../src/board/schema';
import { executeBoardAction, loadBoardRulesContext, type BoardActionInput } from '../../src/playtest/boardAction';
import type { DeckTurnResult } from '../../src/playtest/deckTurn';
import { skirmishUnit } from '../helpers/skirmish';

const tempDirs: string[] = [];

describe('structured Skirmish board actions', () => {
  afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

  it('requires both setup actions before the first activation', async () => {
    const context = await loadBoardRulesContext();
    const initial = state([skirmishUnit('p1', 'P1', 'soldier', 0, 0), skirmishUnit('p2', 'P2', 'soldier', 0, 16)]);
    expect(() => executeBoardAction(initial, activation('a1', 'P1', 'p1', 0, 0), context, paths())).toThrow('board phase is setup');

    const first = executeBoardAction(initial, setup('s1', 'P1'), context, paths(), deckFor('s1', 'P1'));
    expect(first.after.turn).toMatchObject({ phase: 'setup', activePlayer: 'P2', completedSetupPlayers: ['P1'] });
    const second = executeBoardAction(first.after, setup('s2', 'P2'), context, paths(), deckFor('s2', 'P2'));
    expect(second.after.turn).toEqual({ round: 1, phase: 'activation', initiativePlayer: 'P1', activePlayer: 'P1', completedSetupPlayers: ['P1', 'P2'], activatedUnitIds: [], activationCounts: { P1: 0, P2: 0 } });
  });

  it('alternates one unit at a time and rejects duplicate activation', async () => {
    const context = await loadBoardRulesContext();
    const ready = activationState([
      skirmishUnit('p1a', 'P1', 'soldier', 0, 5), skirmishUnit('p1b', 'P1', 'soldier', 1, 5),
      skirmishUnit('p2a', 'P2', 'soldier', 0, 11), skirmishUnit('p2b', 'P2', 'soldier', 1, 11)
    ]);
    const first = executeBoardAction(ready, activation('a1', 'P1', 'p1a', 0, 5), context, paths());
    expect(first.after.turn).toMatchObject({ activePlayer: 'P2', activatedUnitIds: ['p1a'], activationCounts: { P1: 1, P2: 0 } });
    expect(() => executeBoardAction({ ...first.after, turn: { ...first.after.turn, activePlayer: 'P1' } }, activation('a2', 'P1', 'p1a', 0, 5), context, paths())).toThrow('already activated');
  });

  it('passes automatically and changes initiative after the completed round', async () => {
    const context = await loadBoardRulesContext();
    const ready = activationState([
      skirmishUnit('p1a', 'P1', 'soldier', 0, 5), skirmishUnit('p1b', 'P1', 'soldier', 1, 5),
      skirmishUnit('p2a', 'P2', 'soldier', 0, 11)
    ]);
    const one = executeBoardAction(ready, activation('a1', 'P1', 'p1a', 0, 5), context, paths());
    const two = executeBoardAction(one.after, activation('a2', 'P2', 'p2a', 0, 11), context, paths());
    expect(two.after.turn.activePlayer).toBe('P1');
    const three = executeBoardAction(two.after, activation('a3', 'P1', 'p1b', 1, 5), context, paths());
    expect(three.after.turn).toEqual({ round: 2, phase: 'setup', initiativePlayer: 'P2', activePlayer: 'P2', completedSetupPlayers: [], activatedUnitIds: [], activationCounts: { P1: 0, P2: 0 } });
  });

  it('limits each player to three independently chosen units', async () => {
    const context = await loadBoardRulesContext();
    const units = ['a', 'b', 'c', 'd', 'e'];
    let board = activationState([
      ...units.map((suffix, index) => skirmishUnit(`p1${suffix}`, 'P1', 'soldier', index, 5)),
      ...units.map((suffix, index) => skirmishUnit(`p2${suffix}`, 'P2', 'soldier', index, 11))
    ]);
    for (const [index, suffix] of ['a', 'b', 'c'].entries()) {
      const p1 = executeBoardAction(board, activation(`p1-${suffix}`, 'P1', `p1${suffix}`, index, 5), context, paths());
      board = p1.after;
      const p2 = executeBoardAction(board, activation(`p2-${suffix}`, 'P2', `p2${suffix}`, index, 11), context, paths());
      board = p2.after;
    }
    expect(board.turn).toEqual({
      round: 2,
      phase: 'setup',
      initiativePlayer: 'P2',
      activePlayer: 'P2',
      completedSetupPlayers: [],
      activatedUnitIds: [],
      activationCounts: { P1: 0, P2: 0 }
    });
    expect(board.units.map((unit) => unit.id)).toEqual([
      'p1a', 'p1b', 'p1c', 'p1d', 'p1e', 'p2a', 'p2b', 'p2c', 'p2d', 'p2e'
    ]);
  });

  it('lets a two-unit player use both survivors while the opponent uses three units', async () => {
    const context = await loadBoardRulesContext();
    let board = activationState([
      skirmishUnit('p1a', 'P1', 'soldier', 0, 5),
      skirmishUnit('p1b', 'P1', 'soldier', 1, 5),
      skirmishUnit('p2a', 'P2', 'soldier', 0, 11),
      skirmishUnit('p2b', 'P2', 'soldier', 1, 11),
      skirmishUnit('p2c', 'P2', 'soldier', 2, 11),
      skirmishUnit('p2d', 'P2', 'soldier', 3, 11),
      skirmishUnit('p2e', 'P2', 'soldier', 4, 11)
    ]);
    board = executeBoardAction(board, activation('p1-a', 'P1', 'p1a', 0, 5), context, paths()).after;
    board = executeBoardAction(board, activation('p2-a', 'P2', 'p2a', 0, 11), context, paths()).after;
    board = executeBoardAction(board, activation('p1-b', 'P1', 'p1b', 1, 5), context, paths()).after;
    expect(board.turn).toMatchObject({ activePlayer: 'P2', activationCounts: { P1: 2, P2: 1 } });
    board = executeBoardAction(board, activation('p2-b', 'P2', 'p2b', 1, 11), context, paths()).after;
    expect(board.turn).toMatchObject({ activePlayer: 'P2', activationCounts: { P1: 2, P2: 2 } });
    board = executeBoardAction(board, activation('p2-c', 'P2', 'p2c', 2, 11), context, paths()).after;
    expect(board.turn).toEqual({
      round: 2,
      phase: 'setup',
      initiativePlayer: 'P2',
      activePlayer: 'P2',
      completedSetupPlayers: [],
      activatedUnitIds: [],
      activationCounts: { P1: 0, P2: 0 }
    });
  });

  it('rejects a fourth activation by the same player', async () => {
    const context = await loadBoardRulesContext();
    const ready = activationState([
      skirmishUnit('p1a', 'P1', 'soldier', 0, 5),
      skirmishUnit('p1b', 'P1', 'soldier', 1, 5),
      skirmishUnit('p1c', 'P1', 'soldier', 2, 5),
      skirmishUnit('p1d', 'P1', 'soldier', 3, 5),
      skirmishUnit('p2a', 'P2', 'soldier', 0, 11)
    ]);
    ready.turn.activatedUnitIds = ['p1a', 'p1b', 'p1c'];
    ready.turn.activationCounts.P1 = 3;
    expect(() => executeBoardAction(ready, activation('a4', 'P1', 'p1d', 3, 5), context, paths())).toThrow('already completed 3 activations');
  });

  it('does not restore an activation when an activated unit is removed', async () => {
    const context = await loadBoardRulesContext();
    let board = activationState([
      { ...skirmishUnit('p1a', 'P1', 'soldier', 4, 5), attack: 8 },
      skirmishUnit('p1b', 'P1', 'soldier', 2, 5),
      skirmishUnit('p1c', 'P1', 'soldier', 0, 5),
      skirmishUnit('p2a', 'P2', 'soldier', 5, 5),
      skirmishUnit('p2b', 'P2', 'soldier', 2, 11),
      skirmishUnit('p2c', 'P2', 'soldier', 3, 11),
      skirmishUnit('p2d', 'P2', 'soldier', 4, 11)
    ]);
    board.turn.initiativePlayer = 'P2';
    board.turn.activePlayer = 'P2';
    board = executeBoardAction(board, activation('p2-a', 'P2', 'p2a', 5, 5), context, paths()).after;
    board = executeBoardAction(board, {
      schemaVersion: 1,
      stepId: 'p1-a',
      player: 'P1',
      action: { type: 'activation', activation: { unit: 'p1a', from: { col: 4, row: 5 }, attack: { target: 'p2a' }, to: { col: 4, row: 5 } } }
    }, context, paths()).after;
    expect(board.units.some((unit) => unit.id === 'p2a')).toBe(false);
    expect(board.turn.activatedUnitIds).toContain('p2a');
    expect(board.turn.activationCounts.P2).toBe(1);
    board = executeBoardAction(board, activation('p2-b', 'P2', 'p2b', 2, 11), context, paths()).after;
    board = executeBoardAction(board, activation('p1-b', 'P1', 'p1b', 2, 5), context, paths()).after;
    board = executeBoardAction(board, activation('p2-c', 'P2', 'p2c', 3, 11), context, paths()).after;
    board = executeBoardAction(board, activation('p1-c', 'P1', 'p1c', 0, 5), context, paths()).after;
    expect(board.turn).toMatchObject({ round: 2, phase: 'setup', activationCounts: { P1: 0, P2: 0 } });
  });

  it('removes a target before it can activate and stops on elimination', async () => {
    const context = await loadBoardRulesContext();
    const ready = activationState([
      { ...skirmishUnit('p1', 'P1', 'soldier', 4, 5), attack: 2 },
      { ...skirmishUnit('p2', 'P2', 'soldier', 5, 5), hp: 2 }
    ]);
    const executed = executeBoardAction(ready, {
      schemaVersion: 1, stepId: 'a1', player: 'P1',
      action: { type: 'activation', activation: { unit: 'p1', from: { col: 4, row: 5 }, attack: { target: 'p2' }, to: { col: 4, row: 5 } } }
    }, context, paths());
    expect(executed.after.units.map((unit) => unit.id)).toEqual(['p1']);
    expect(executed.after.turn.activePlayer).toBe('P1');
    expect(executed.result.action).toMatchObject({ type: 'activation', activation: { attack: { targetRemoved: true } } });
  });

  it('removes an unactivated unit and passes activation to another survivor', async () => {
    const context = await loadBoardRulesContext();
    const ready = activationState([
      { ...skirmishUnit('p1', 'P1', 'soldier', 4, 5), attack: 2 },
      { ...skirmishUnit('p2a', 'P2', 'soldier', 5, 5), hp: 2 },
      skirmishUnit('p2b', 'P2', 'soldier', 7, 5)
    ]);
    const executed = executeBoardAction(ready, {
      schemaVersion: 1, stepId: 'a1', player: 'P1',
      action: { type: 'activation', activation: { unit: 'p1', from: { col: 4, row: 5 }, attack: { target: 'p2a' }, to: { col: 4, row: 5 } } }
    }, context, paths());
    expect(executed.after.units.map((unit) => unit.id)).toEqual(['p1', 'p2b']);
    expect(executed.after.turn).toMatchObject({ activePlayer: 'P2', activatedUnitIds: ['p1'], activationCounts: { P1: 1, P2: 0 } });
    expect(() => executeBoardAction(executed.after, activation('a2', 'P2', 'p2a', 5, 5), context, paths())).toThrow('missing unit p2a');
  });

  it('rejects board actions after an army is eliminated', async () => {
    const context = await loadBoardRulesContext();
    const terminal = activationState([skirmishUnit('p1', 'P1', 'soldier', 4, 5)]);
    expect(() => executeBoardAction(terminal, activation('a2', 'P1', 'p1', 4, 5), context, paths())).toThrow('after elimination');
  });

  it('applies paid and key-point upgrades only during setup', async () => {
    const context = await loadBoardRulesContext();
    const initial = state([skirmishUnit('p1', 'P1', 'soldier', 1, 8), skirmishUnit('p2', 'P2', 'soldier', 0, 16)]);
    const executed = executeBoardAction(initial, {
      schemaVersion: 1, stepId: 's1', player: 'P1', action: { type: 'setup', upgrades: [] }
    }, context, paths(), deckFor('s1', 'P1', { soldierAttack: 2 }));
    expect(executed.after.units.find((unit) => unit.id === 'p1')?.attack).toBe(2);
    expect(executed.result.action).toMatchObject({ type: 'setup', keyPointUpgrades: [{ target: 'p1', stat: 'attack', to: 2 }] });
  });

  it('rejects an affordable upgrade that setup leaves unspent', async () => {
    const context = await loadBoardRulesContext();
    const initial = state([skirmishUnit('p1', 'P1', 'soldier', 0, 0), skirmishUnit('p2', 'P2', 'soldier', 0, 16)]);
    expect(() => executeBoardAction(initial, setup('s1', 'P1'), context, paths(), deckFor('s1', 'P1', { soldierAttack: 2 }))).toThrow('affordable upgrade remains');
  });

  it('enforces movement, occupancy, range, and line of sight', async () => {
    const context = await loadBoardRulesContext();
    const movement = activationState([skirmishUnit('p1', 'P1', 'soldier', 0, 5), skirmishUnit('p2', 'P2', 'soldier', 8, 5)]);
    expect(() => executeBoardAction(movement, {
      schemaVersion: 1, stepId: 'move', player: 'P1', action: { type: 'activation', activation: { unit: 'p1', from: { col: 0, row: 5 }, to: { col: 4, row: 5 } } }
    }, context, paths())).toThrow('exceeding movement 3');

    const occupied = activationState([skirmishUnit('p1', 'P1', 'soldier', 0, 5), skirmishUnit('p1b', 'P1', 'soldier', 1, 5), skirmishUnit('p2', 'P2', 'soldier', 8, 5)]);
    expect(() => executeBoardAction(occupied, {
      schemaVersion: 1, stepId: 'occupied', player: 'P1', action: { type: 'activation', activation: { unit: 'p1', from: { col: 0, row: 5 }, to: { col: 1, row: 5 } } }
    }, context, paths())).toThrow('occupied hex 1,5');

    const range = activationState([skirmishUnit('p1', 'P1', 'soldier', 0, 5), skirmishUnit('p2', 'P2', 'soldier', 2, 5)]);
    expect(() => executeBoardAction(range, {
      schemaVersion: 1, stepId: 'range', player: 'P1', action: { type: 'activation', activation: { unit: 'p1', from: { col: 0, row: 5 }, attack: { target: 'p2' }, to: { col: 0, row: 5 } } }
    }, context, paths())).toThrow('exceeding range 1');

    const sight = activationState([skirmishUnit('p1', 'P1', 'archer', 6, 6), skirmishUnit('p2', 'P2', 'soldier', 5, 8)]);
    expect(() => executeBoardAction(sight, {
      schemaVersion: 1, stepId: 'sight', player: 'P1', action: { type: 'activation', activation: { unit: 'p1', from: { col: 6, row: 6 }, attack: { target: 'p2' }, to: { col: 6, row: 6 } } }
    }, context, paths())).toThrow('no line of sight');
  });

  it('rejects paid upgrades that exceed the produced budget', async () => {
    const context = await loadBoardRulesContext();
    const initial = state([skirmishUnit('p1', 'P1', 'soldier', 0, 0), skirmishUnit('p2', 'P2', 'soldier', 0, 16)]);
    expect(() => executeBoardAction(initial, {
      schemaVersion: 1, stepId: 's1', player: 'P1', action: { type: 'setup', upgrades: [{ target: 'p1', stat: 'attack', to: 2 }] }
    }, context, paths(), deckFor('s1', 'P1', { soldierAttack: 1 }))).toThrow('exceeding produced 1');
  });

  it('executes the public board-action command with real persisted state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-board-action-'));
    tempDirs.push(root);
    const statePath = join(root, 'board.json');
    const actionsPath = join(root, 'actions.json');
    const resultPath = join(root, 'result.json');
    await writeFile(statePath, `${JSON.stringify(activationState([skirmishUnit('p1', 'P1', 'soldier', 0, 5), skirmishUnit('p2', 'P2', 'soldier', 0, 11)]))}\n`);
    await writeFile(actionsPath, `${JSON.stringify(activation('a1', 'P1', 'p1', 0, 5))}\n`);
    await runCli(['board-action', '--state', statePath, '--actions', actionsPath, '--result', resultPath], () => undefined);
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as BoardState;
    expect(saved.turn).toMatchObject({ activePlayer: 'P2', activatedUnitIds: ['p1'], activationCounts: { P1: 1, P2: 0 } });
    expect(JSON.parse(await readFile(resultPath, 'utf8')).action.type).toBe('activation');
  });
});

function state(units: BoardState['units']): BoardState {
  return { schemaVersion: 1, ruleset: 'skirmish-v1', map: 'skirmish-v1', players: ['P1', 'P2'], turn: { round: 1, phase: 'setup', initiativePlayer: 'P1', activePlayer: 'P1', completedSetupPlayers: [], activatedUnitIds: [], activationCounts: { P1: 0, P2: 0 } }, units, notes: [] };
}
function activationState(units: BoardState['units']): BoardState {
  return { ...state(units), turn: { round: 1, phase: 'activation', initiativePlayer: 'P1', activePlayer: 'P1', completedSetupPlayers: ['P1', 'P2'], activatedUnitIds: [], activationCounts: { P1: 0, P2: 0 } } };
}
function setup(stepId: string, player: string): BoardActionInput { return { schemaVersion: 1, stepId, player, action: { type: 'setup', upgrades: [] } }; }
function activation(stepId: string, player: string, unit: string, col: number, row: number): BoardActionInput { return { schemaVersion: 1, stepId, player, action: { type: 'activation', activation: { unit, from: { col, row }, to: { col, row } } } }; }
function paths(): { beforePath: string; afterPath: string } { return { beforePath: 'before.json', afterPath: 'after.json' }; }
function deckFor(turnId: string, player: string, produced: Record<string, number> = {}): DeckTurnResult {
  return { schemaVersion: 1, turnId, player, before: 'before.deck.json', after: 'after.deck.json', actions: [], drawnHand: [], played: [], bought: [], produced };
}
