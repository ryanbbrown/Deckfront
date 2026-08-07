import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';
import { executeBoardTurn, loadBoardRulesContext } from '../../src/playtest/boardTurn';
import { deckResult, skirmishUnit } from '../helpers/skirmish';
import type { BoardState } from '../../src/board/schema';

const tempDirs: string[] = [];

describe('structured Skirmish board turns', () => {
  afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

  it('executes move-attack-move against one shared movement budget', async () => {
    const context = await loadBoardRulesContext();
    const before = state([
      { ...skirmishUnit('s1', 'P1', 'soldier', 4, 5), attack: 2 },
      skirmishUnit('e1', 'P2', 'soldier', 5, 6)
    ]);
    const executed = executeBoardTurn(before, deckResult(), {
      schemaVersion: 1, turnId: 'turn-001', player: 'P1',
      actions: { activations: [{ unit: 's1', from: { col: 4, row: 5 }, via: { col: 5, row: 5 }, attack: { target: 'e1' }, to: { col: 4, row: 5 } }], upgrades: [] }
    }, context, { beforePath: 'before.json', afterPath: 'after.json' });

    expect(executed.after.units.find((unit) => unit.id === 's1')).toMatchObject({ col: 4, row: 5 });
    expect(executed.after.units.find((unit) => unit.id === 'e1')?.hp).toBe(4);
    expect(executed.result.actions.activations[0]?.attack).toEqual({ target: 'e1', damage: 2, targetRemoved: false });
  });

  it('rejects a two-leg activation one step over budget', async () => {
    const context = await loadBoardRulesContext();
    const before = state([skirmishUnit('a1', 'P1', 'archer', 1, 1), skirmishUnit('e1', 'P2', 'soldier', 8, 16)]);
    expect(() => executeBoardTurn(before, deckResult(), {
      schemaVersion: 1, turnId: 'turn-001', player: 'P1',
      actions: { activations: [{ unit: 'a1', from: { col: 1, row: 1 }, via: { col: 3, row: 1 }, to: { col: 0, row: 1 } }], upgrades: [] }
    }, context, { beforePath: 'before.json', afterPath: 'after.json' })).toThrow('exceeding movement 3');
  });

  it('uses per-unit range, line of sight, and permanent damage', async () => {
    const context = await loadBoardRulesContext();
    const before = state([skirmishUnit('a1', 'P1', 'archer', 6, 6), skirmishUnit('e1', 'P2', 'soldier', 5, 8)]);
    expect(() => executeBoardTurn(before, deckResult(), {
      schemaVersion: 1, turnId: 'turn-001', player: 'P1',
      actions: { activations: [{ unit: 'a1', from: { col: 6, row: 6 }, attack: { target: 'e1' }, to: { col: 6, row: 6 } }], upgrades: [] }
    }, context, { beforePath: 'before.json', afterPath: 'after.json' })).toThrow('no line of sight');
  });

  it('opens the killed target hex for the activation second leg', async () => {
    const context = await loadBoardRulesContext();
    const before = state([skirmishUnit('s1', 'P1', 'soldier', 4, 5), { ...skirmishUnit('e1', 'P2', 'soldier', 5, 5), hp: 1 }]);
    const executed = executeBoardTurn(before, deckResult(), {
      schemaVersion: 1, turnId: 'turn-001', player: 'P1',
      actions: { activations: [{ unit: 's1', from: { col: 4, row: 5 }, attack: { target: 'e1' }, to: { col: 5, row: 5 } }], upgrades: [] }
    }, context, { beforePath: 'before.json', afterPath: 'after.json' });
    expect(executed.after.units).toEqual([expect.objectContaining({ id: 's1', col: 5, row: 5 })]);
    expect(executed.result.actions.activations[0]?.attack).toEqual({ target: 'e1', damage: 1, targetRemoved: true });
  });

  it('does not let units block sight but does block occupied movement destinations', async () => {
    const context = await loadBoardRulesContext();
    const clearAttack = state([
      skirmishUnit('a1', 'P1', 'archer', 0, 8),
      skirmishUnit('s1', 'P1', 'soldier', 1, 8),
      skirmishUnit('e1', 'P2', 'soldier', 2, 8)
    ]);
    const attacked = executeBoardTurn(clearAttack, deckResult(), {
      schemaVersion: 1, turnId: 'turn-001', player: 'P1',
      actions: { upgrades: [], activations: [{ unit: 'a1', from: { col: 0, row: 8 }, attack: { target: 'e1' }, to: { col: 0, row: 8 } }] }
    }, context, { beforePath: 'before', afterPath: 'after' });
    expect(attacked.after.units.find((unit) => unit.id === 'e1')?.hp).toBe(5);

    expect(() => executeBoardTurn(state([skirmishUnit('s1', 'P1', 'soldier', 0, 5), skirmishUnit('s2', 'P1', 'soldier', 1, 5)]), deckResult(), {
      schemaVersion: 1, turnId: 'turn-001', player: 'P1',
      actions: { upgrades: [], activations: [{ unit: 's1', from: { col: 0, row: 5 }, via: { col: 1, row: 5 }, to: { col: 0, row: 5 } }] }
    }, context, { beforePath: 'before', afterPath: 'after' })).toThrow('occupied hex 1,5');
  });

  it('applies activations in order so an earlier vacancy opens a later path', async () => {
    const context = await loadBoardRulesContext();
    const before = state([skirmishUnit('front', 'P1', 'soldier', 1, 5), skirmishUnit('back', 'P1', 'soldier', 0, 5)]);
    const moveFront = { unit: 'front', from: { col: 1, row: 5 }, to: { col: 2, row: 5 } };
    const moveBack = { unit: 'back', from: { col: 0, row: 5 }, to: { col: 1, row: 5 } };
    const ordered = executeBoardTurn(before, deckResult(), {
      schemaVersion: 1, turnId: 'turn-001', player: 'P1', actions: { upgrades: [], activations: [moveFront, moveBack] }
    }, context, { beforePath: 'before', afterPath: 'after' });
    expect(ordered.after.units.map((unit) => [unit.id, unit.col, unit.row])).toEqual([['front', 2, 5], ['back', 1, 5]]);
    expect(() => executeBoardTurn(before, deckResult(), {
      schemaVersion: 1, turnId: 'turn-001', player: 'P1', actions: { upgrades: [], activations: [moveBack, moveFront] }
    }, context, { beforePath: 'before', afterPath: 'after' })).toThrow('occupied hex 1,5');
  });

  it('rejects unaffordable, forbidden, and duplicate stat upgrades', async () => {
    const context = await loadBoardRulesContext();
    const before = state([skirmishUnit('s1', 'P1', 'soldier', 4, 8), skirmishUnit('e1', 'P2', 'soldier', 8, 16)]);
    const input = (stat: 'attack' | 'range', to: number) => ({
      schemaVersion: 1 as const, turnId: 'turn-001', player: 'P1',
      actions: { activations: [], upgrades: [{ target: 's1', stat, to }] }
    });
    expect(() => executeBoardTurn(before, deckResult(), input('attack', 3), context, { beforePath: 'before', afterPath: 'after' })).toThrow('can only be raised once per turn');
    expect(() => executeBoardTurn(state([skirmishUnit('s1', 'P1', 'soldier', 3, 7)]), deckResult({ soldierAttack: 1 }), input('attack', 2), context, { beforePath: 'before', afterPath: 'after' })).toThrow('exceeding produced');
    expect(() => executeBoardTurn(state([skirmishUnit('s1', 'P1', 'soldier', 3, 7)]), deckResult({ soldierRange: 2 }), input('range', 2), context, { beforePath: 'before', afterPath: 'after' })).toThrow('cannot upgrade range');
    expect(() => executeBoardTurn(state([skirmishUnit('s1', 'P1', 'soldier', 3, 7)]), deckResult({ soldierAttack: 3 }), input('attack', 3), context, { beforePath: 'before', afterPath: 'after' })).toThrow('must increase from 1 to 2');
    expect(() => executeBoardTurn(state([skirmishUnit('s1', 'P1', 'soldier', 3, 7)]), deckResult({ archerAttack: 2 }), input('attack', 2), context, { beforePath: 'before', afterPath: 'after' })).toThrow('exceeding produced');
  });

  it('charges threshold costs per symbol lane and applies key points first', async () => {
    const context = await loadBoardRulesContext();
    const before = state([
      skirmishUnit('s1', 'P1', 'soldier', 4, 8),
      skirmishUnit('s2', 'P1', 'soldier', 3, 7),
      skirmishUnit('a1', 'P1', 'archer', 1, 8),
      skirmishUnit('a2', 'P1', 'archer', 2, 7),
      skirmishUnit('e1', 'P2', 'soldier', 0, 16)
    ]);
    const executed = executeBoardTurn(before, deckResult({ soldierAttack: 2, archerRange: 3 }), {
      schemaVersion: 1, turnId: 'turn-001', player: 'P1',
      actions: { activations: [], upgrades: [{ target: 's2', stat: 'attack', to: 2 }, { target: 'a2', stat: 'range', to: 3 }] }
    }, context, { beforePath: 'before.json', afterPath: 'after.json' });
    expect(executed.after.units.find((unit) => unit.id === 's1')?.attack).toBe(2);
    expect(executed.after.units.find((unit) => unit.id === 's2')?.attack).toBe(2);
    expect(executed.after.units.find((unit) => unit.id === 'a1')?.range).toBe(3);
    expect(executed.after.units.find((unit) => unit.id === 'a2')?.range).toBe(3);
    expect(executed.result.actions.keyPointUpgrades.map((upgrade) => upgrade.target)).toEqual(['a1', 's1']);
  });

  it('lets a soldier deny the range point without receiving its upgrade', async () => {
    const context = await loadBoardRulesContext();
    const executed = executeBoardTurn(state([skirmishUnit('s1', 'P1', 'soldier', 1, 8)]), deckResult(), {
      schemaVersion: 1, turnId: 'turn-001', player: 'P1', actions: { upgrades: [], activations: [] }
    }, context, { beforePath: 'before', afterPath: 'after' });
    expect(executed.after.units[0]?.range).toBe(1);
    expect(executed.result.actions.keyPointUpgrades).toEqual([]);
  });

  it('writes board snapshots and results through the CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-skirmish-'));
    tempDirs.push(root);
    const statePath = join(root, 'board.json');
    const deckPath = join(root, 'deck-result.json');
    const actionsPath = join(root, 'actions.json');
    const resultPath = join(root, 'result.json');
    await writeFile(statePath, `${JSON.stringify(state([skirmishUnit('s1', 'P1', 'soldier', 4, 5), skirmishUnit('e1', 'P2', 'soldier', 8, 16)]))}\n`);
    await writeFile(deckPath, `${JSON.stringify(deckResult())}\n`);
    await writeFile(actionsPath, `${JSON.stringify({ schemaVersion: 1, turnId: 'turn-001', player: 'P1', actions: { upgrades: [], activations: [{ unit: 's1', from: { col: 4, row: 5 }, to: { col: 5, row: 5 } }] } })}\n`);
    await runCli(['board-turn', '--state', statePath, '--deck-result', deckPath, '--actions', actionsPath, '--result', resultPath], () => undefined);
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as BoardState;
    expect(saved.units.find((unit) => unit.id === 's1')).toMatchObject({ col: 5, row: 5 });
    expect(saved.turn).toEqual({ activePlayer: 'P2', round: 1 });
  });
});

function state(units: BoardState['units']): BoardState {
  return { schemaVersion: 1, ruleset: 'skirmish-v1', map: 'skirmish-v1', players: ['P1', 'P2'], turn: { activePlayer: 'P1', round: 1 }, units, notes: [] };
}
