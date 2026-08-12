import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPlaytestCli } from '../../src/playtest/main';
import { expectedTerminalEvents, initPlaytestRun, validateReplayBundle } from '../../src/playtest/run';
import { buildTurnArtifacts, skirmishArmyState } from '../helpers/skirmish';

const tempDirs: string[] = [];

describe('Skirmish replay validation', () => {
  afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

  it('strictly validates executor output using the independent replay implementation', async () => {
    const root = await tempDir();
    await buildTurnArtifacts(root);
    const bundle = await validateReplayBundle(join(root, 'timeline.json'), { strict: true, strictDeck: true, strictWin: true });
    expect(bundle.entries).toHaveLength(1);
  });

  it('independently replays paid upgrades and movement instead of only empty turns', async () => {
    const root = await tempDir();
    const artifacts = await buildTurnArtifacts(root, {
      produced: { soldierAttack: 2 },
      boardInput: {
        schemaVersion: 1, turnId: 'turn-001', player: 'P1',
        actions: {
          upgrades: [{ target: 'P1-soldier-1', stat: 'attack', to: 2 }],
          activations: [{ unit: 'P1-soldier-1', from: { col: 0, row: 0 }, to: { col: 0, row: 1 } }]
        }
      }
    });
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strict: true })).resolves.toMatchObject({ entries: [{ boardAfter: { turn: { activePlayer: 'P2' } } }] });
    const mutated = structuredClone(artifacts.boardAfter);
    mutated.units.find((unit) => unit.id === 'P1-soldier-1')!.attack = 3;
    await writeFile(join(root, 'snapshots/turn-001.after.board.json'), `${JSON.stringify(mutated)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strict: true })).rejects.toThrow('independently replayed board actions do not match');
  });

  it('rejects validator-specific upgrade step and symbol-lane mutations', async () => {
    const stepRoot = await tempDir();
    const stepArtifacts = await buildTurnArtifacts(stepRoot, {
      produced: { soldierAttack: 2 },
      boardInput: {
        schemaVersion: 1, turnId: 'turn-001', player: 'P1',
        actions: { upgrades: [{ target: 'P1-soldier-1', stat: 'attack', to: 2 }], activations: [] }
      }
    });
    const raisedTwoSteps = structuredClone(stepArtifacts.timeline);
    raisedTwoSteps.entries[0]!.actions!.upgrades[0]!.to = 3;
    await writeFile(join(stepRoot, 'timeline.json'), `${JSON.stringify(raisedTwoSteps)}\n`);
    await expect(validateReplayBundle(join(stepRoot, 'timeline.json'), { strict: true })).rejects.toThrow('P1-soldier-1 attack must increase exactly once');

    const laneRoot = await tempDir();
    const laneArtifacts = await buildTurnArtifacts(laneRoot, {
      produced: { soldierAttack: 2 },
      boardInput: {
        schemaVersion: 1, turnId: 'turn-001', player: 'P1',
        actions: { upgrades: [{ target: 'P1-soldier-1', stat: 'attack', to: 2 }], activations: [] }
      }
    });
    const underproduced = structuredClone(laneArtifacts.timeline);
    underproduced.entries[0]!.deck.produced.soldierAttack = 1;
    await writeFile(join(laneRoot, 'timeline.json'), `${JSON.stringify(underproduced)}\n`);
    await expect(validateReplayBundle(join(laneRoot, 'timeline.json'), { strict: true })).rejects.toThrow('upgrades spend 2 soldierAttack, exceeding produced 1');
  });

  it('rejects a ranged attack through a wall at the independent validator seam', async () => {
    const root = await tempDir();
    const artifacts = await buildTurnArtifacts(root);
    const before = structuredClone(artifacts.boardBefore);
    const after = structuredClone(artifacts.boardAfter);
    const attacker = before.units.find((unit) => unit.id === 'P1-soldier-1')!;
    Object.assign(attacker, { type: 'archer', col: 6, row: 6, hp: 4, attack: 1, movement: 3, range: 2 });
    const attackerAfter = after.units.find((unit) => unit.id === attacker.id)!;
    Object.assign(attackerAfter, attacker);
    const target = before.units.find((unit) => unit.id === 'P2-soldier-1')!;
    Object.assign(target, { col: 5, row: 8 });
    const targetAfter = after.units.find((unit) => unit.id === target.id)!;
    Object.assign(targetAfter, target, { hp: target.hp - 1 });
    const timeline = structuredClone(artifacts.timeline);
    timeline.entries[0]!.actions = {
      keyPointUpgrades: [], upgrades: [],
      activations: [{ unit: attacker.id, from: { col: 6, row: 6 }, attack: { target: target.id, damage: 1, targetRemoved: false }, to: { col: 6, row: 6 } }]
    };
    await Promise.all([
      writeFile(join(root, 'snapshots/turn-001.before.board.json'), `${JSON.stringify(before)}\n`),
      writeFile(join(root, 'snapshots/turn-001.after.board.json'), `${JSON.stringify(after)}\n`),
      writeFile(join(root, 'timeline.json'), `${JSON.stringify(timeline)}\n`)
    ]);

    await expect(validateReplayBundle(join(root, 'timeline.json'), { strict: true })).rejects.toThrow(`${attacker.id} has no line of sight to ${target.id}`);
  });

  it('rejects activation reordering when the original order opens an occupied hex', async () => {
    const root = await tempDir();
    const artifacts = await buildTurnArtifacts(root, {
      boardInput: {
        schemaVersion: 1, turnId: 'turn-001', player: 'P1',
        actions: {
          upgrades: [],
          activations: [
            { unit: 'P1-soldier-1', from: { col: 0, row: 0 }, to: { col: 0, row: 1 } },
            { unit: 'P1-soldier-2', from: { col: 1, row: 0 }, to: { col: 0, row: 0 } }
          ]
        }
      }
    });
    const reordered = structuredClone(artifacts.timeline);
    reordered.entries[0]!.actions!.activations.reverse();
    await writeFile(join(root, 'timeline.json'), `${JSON.stringify(reordered)}\n`);

    await expect(validateReplayBundle(join(root, 'timeline.json'), { strict: true })).rejects.toThrow('P1-soldier-2 cannot move to occupied hex 0,0 containing P1-soldier-1');
  });

  it('rejects changing a genuine turn-cap draw into a win', async () => {
    const root = await tempDir();
    const artifacts = await buildTurnArtifacts(root);
    const timeline = structuredClone(artifacts.timeline);
    timeline.run = { turnCap: 1 };
    const terminal = expectedTerminalEvents(artifacts.boardAfter, 1, 1);
    timeline.entries[0]!.winEvents = terminal;
    timeline.terminalWinEvents = terminal;
    await writeFile(join(root, 'timeline.json'), `${JSON.stringify(timeline)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strictWin: true })).resolves.toMatchObject({ entries: [{ entry: { winEvents: [{ outcome: 'draw' }] } }] });

    const fabricated = structuredClone(timeline);
    fabricated.entries[0]!.winEvents![0]!.outcome = 'win';
    fabricated.entries[0]!.winEvents![0]!.player = 'P1';
    fabricated.terminalWinEvents![0]!.outcome = 'win';
    fabricated.terminalWinEvents![0]!.player = 'P1';
    await writeFile(join(root, 'timeline.json'), `${JSON.stringify(fabricated)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strictWin: true })).rejects.toThrow('turn-001: winEvents do not match expected terminal state');
  });

  it('rejects a one-field movement mutation that the action log cannot explain', async () => {
    const root = await tempDir();
    const artifacts = await buildTurnArtifacts(root);
    const mutated = structuredClone(artifacts.boardAfter);
    mutated.units[0]!.col += 1;
    await writeFile(join(root, 'snapshots/turn-001.after.board.json'), `${JSON.stringify(mutated)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strict: true })).rejects.toThrow('independently replayed board actions do not match');
  });

  it('rejects produced resources that do not match the deck replay', async () => {
    const root = await tempDir();
    const artifacts = await buildTurnArtifacts(root);
    const timeline = structuredClone(artifacts.timeline);
    timeline.entries[0]!.deck.produced.money = 999;
    await writeFile(join(root, 'timeline.json'), `${JSON.stringify(timeline)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strictDeck: true })).rejects.toThrow('deck.produced.money does not match replay');
  });

  it('rejects fabricated terminal outcomes independently of deck validation', async () => {
    const root = await tempDir();
    const artifacts = await buildTurnArtifacts(root);
    const timeline = structuredClone(artifacts.timeline);
    timeline.entries[0]!.winEvents = [{ type: 'turnCap', outcome: 'win', player: 'P1', completedTurns: 1, playerUnits: 5, opponentUnits: 5, playerHp: 30, opponentHp: 30 }];
    await writeFile(join(root, 'timeline.json'), `${JSON.stringify(timeline)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strictWin: true })).rejects.toThrow('winEvents do not match expected terminal state');
  });

  it('rejects replay snapshots that reset the absolute clock', async () => {
    const root = await tempDir();
    const artifacts = await buildTurnArtifacts(root);
    const board = structuredClone(artifacts.boardBefore);
    board.turn.round = 2;
    await writeFile(join(root, 'snapshots/turn-001.before.board.json'), `${JSON.stringify(board)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strict: true })).rejects.toThrow('initial board must begin at round 1');

    await writeFile(join(root, 'snapshots/turn-001.before.board.json'), `${JSON.stringify(artifacts.boardBefore)}\n`);
    const deck = structuredClone(artifacts.deckBefore);
    deck.game.players[0]!.turnsTaken = 1;
    await writeFile(join(root, 'snapshots/turn-001.before.deck.json'), `${JSON.stringify(deck)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strict: true })).rejects.toThrow('initial deck players must have zero turns taken');
  });

  it('rejects invalid --units counts, occupancy, types, and placement', async () => {
    const valid = unitCompositions();
    const fourUnits = structuredClone(valid).filter((unit) => unit.id !== 'P1-soldier-5');
    const sixUnits = structuredClone(valid);
    sixUnits.push({ ...sixUnits.find((unit) => unit.id === 'P1-soldier-1')!, id: 'P1-soldier-6', col: 5 });
    const duplicate = structuredClone(valid);
    Object.assign(duplicate.find((unit) => unit.id === 'P1-soldier-2')!, { col: 0, row: 0 });
    const unknown = structuredClone(valid);
    unknown.find((unit) => unit.id === 'P1-soldier-1')!.type = 'mage';
    const misplaced = structuredClone(valid);
    Object.assign(misplaced.find((unit) => unit.id === 'P1-soldier-1')!, { col: 8, row: 8 });
    const cases = [
      { name: 'four units', units: fourUnits, message: 'P1 must deploy exactly 5 units' },
      { name: 'six units', units: sixUnits, message: 'P1 must deploy exactly 5 units' },
      { name: 'duplicate occupancy', units: duplicate, message: 'multiple units occupy 0,0' },
      { name: 'unknown unit type', units: unknown, message: 'P1-soldier-1 has unknown unit type mage' },
      { name: 'bad placement', units: misplaced, message: "outside P1's deployment zone" }
    ];

    for (const invalid of cases) {
      const root = await tempDir();
      const armyPath = join(root, `${invalid.name}.json`);
      await writeFile(armyPath, `${JSON.stringify(invalid.units)}\n`);
      await expect(initPlaytestRun({ root: join(root, 'run'), ruleset: 'skirmish-v1', map: 'skirmish-v1', unitsPath: armyPath })).rejects.toThrow(invalid.message);
    }
  });

  it('requires exactly one complete setup source and validates complete board stats', async () => {
    await expect(initPlaytestRun({ root: await tempDir(), ruleset: 'skirmish-v1', map: 'skirmish-v1' })).rejects.toThrow('Missing army setup: provide exactly one of boardPath or unitsPath');

    const root = await tempDir();
    const boardPath = join(root, 'board.json');
    const unitsPath = join(root, 'units.json');
    await writeFile(boardPath, `${JSON.stringify(skirmishArmyState())}\n`);
    await writeFile(unitsPath, `${JSON.stringify(unitCompositions())}\n`);
    await expect(initPlaytestRun({ root: join(root, 'conflict'), ruleset: 'skirmish-v1', map: 'skirmish-v1', boardPath, unitsPath })).rejects.toThrow('Conflicting army setup: provide only one of boardPath or unitsPath');

    const emptyBoardPath = join(root, 'empty-board.json');
    await writeFile(emptyBoardPath, `${JSON.stringify(skirmishArmyState({ units: [] }))}\n`);
    await expect(initPlaytestRun({ root: join(root, 'empty'), ruleset: 'skirmish-v1', map: 'skirmish-v1', boardPath: emptyBoardPath })).rejects.toThrow('P1 must deploy exactly 5 units');

    const inflated = skirmishArmyState();
    inflated.units.find((unit) => unit.id === 'P1-soldier-1')!.attack = 2;
    await writeFile(boardPath, `${JSON.stringify(inflated)}\n`);
    await expect(initPlaytestRun({ root: join(root, 'inflated'), ruleset: 'skirmish-v1', map: 'skirmish-v1', boardPath })).rejects.toThrow('P1-soldier-1 attack is 2, expected base 1');
  });

  it('enforces setup sources and derives canonical stats through the public init CLI', async () => {
    const root = await tempDir();
    const baseArgs = ['init', '--run', join(root, 'missing'), '--ruleset', 'skirmish-v1', '--map', 'skirmish-v1'];
    await expect(runPlaytestCli(baseArgs)).rejects.toThrow('Missing army setup: provide exactly one of boardPath or unitsPath');

    const unitsPath = join(root, 'composition.json');
    const composition = unitCompositions();
    composition.find((unit) => unit.id === 'P1-soldier-1')!.type = 'archer';
    await writeFile(unitsPath, `${JSON.stringify(composition)}\n`);
    const boardPath = join(root, 'complete-board.json');
    await writeFile(boardPath, `${JSON.stringify(skirmishArmyState())}\n`);
    await expect(runPlaytestCli([...baseArgs, '--board', boardPath, '--units', unitsPath])).rejects.toThrow('Conflicting army setup: provide only one of boardPath or unitsPath');

    const runRoot = join(root, 'run');
    const output: string[] = [];
    await runPlaytestCli(['init', '--run', runRoot, '--ruleset', 'skirmish-v1', '--map', 'skirmish-v1', '--units', unitsPath], (message) => output.push(message));
    const initialized = JSON.parse(await readFile(join(runRoot, 'board.json'), 'utf8')) as ReturnType<typeof skirmishArmyState>;
    expect(initialized.units.find((unit) => unit.id === 'P1-soldier-1')).toMatchObject({ type: 'archer', hp: 4, attack: 1, movement: 3, range: 2 });
    expect(initialized.units.find((unit) => unit.id === 'P1-soldier-2')).toMatchObject({ type: 'soldier', hp: 6, attack: 1, movement: 3, range: 1 });
    expect(output).toEqual([`Initialized playtest run: ${runRoot}`]);

    const withStats = unitCompositions().map((unit) => ({ ...unit, hp: 99 }));
    await writeFile(unitsPath, `${JSON.stringify(withStats)}\n`);
    await expect(runPlaytestCli(['init', '--run', join(root, 'extra-stats'), '--ruleset', 'skirmish-v1', '--map', 'skirmish-v1', '--units', unitsPath])).rejects.toThrow('Invalid --units setup');
  });

  it('resolves elimination and every turn-cap tiebreak, including a draw', () => {
    const base = skirmishArmyState();
    expect(expectedTerminalEvents({ ...base, units: base.units.filter((unit) => unit.player === 'P1') }, 3, 20)[0]).toMatchObject({ type: 'elimination', outcome: 'win', player: 'P1' });
    expect(expectedTerminalEvents({ ...base, units: base.units.slice(1) }, 20, 20)[0]).toMatchObject({ type: 'turnCap', outcome: 'win', player: 'P2' });
    const hpWinner = structuredClone(base);
    hpWinner.units.find((unit) => unit.player === 'P2')!.hp -= 1;
    expect(expectedTerminalEvents(hpWinner, 20, 20)[0]).toMatchObject({ outcome: 'win', player: 'P1', playerHp: 30, opponentHp: 29 });
    expect(expectedTerminalEvents(base, 20, 20)[0]).toMatchObject({ outcome: 'draw', player: null });
    expect(expectedTerminalEvents(base, 19, 20)).toEqual([]);
  });

  it('initializes game paths with an absolute turn cap and validates army setup', async () => {
    const root = await tempDir();
    const armyPath = join(root, 'army.json');
    await writeFile(armyPath, `${JSON.stringify(unitCompositions())}\n`);
    const paths = await initPlaytestRun({ root, ruleset: 'skirmish-v1', map: 'skirmish-v1', unitsPath: armyPath, turnCap: 12 });
    const timeline = JSON.parse(await readFile(paths.timeline, 'utf8')) as { run: { turnCap: number } };
    expect(timeline.run.turnCap).toBe(12);
    expect(JSON.parse(await readFile(paths.boardState, 'utf8')).units).toHaveLength(10);

    const defaultPaths = await initPlaytestRun({ root: await tempDir(), ruleset: 'skirmish-v1', map: 'skirmish-v1', unitsPath: armyPath });
    expect(JSON.parse(await readFile(defaultPaths.timeline, 'utf8')).run.turnCap).toBe(60);

    const lateBoardPath = join(root, 'late-board.json');
    await writeFile(lateBoardPath, `${JSON.stringify(skirmishArmyState({ turn: { activePlayer: 'P1', round: 2 } }))}\n`);
    await expect(initPlaytestRun({ root: await tempDir(), ruleset: 'skirmish-v1', map: 'skirmish-v1', boardPath: lateBoardPath })).rejects.toThrow('must begin at round 1');

    const invalidArmy = unitCompositions().map((unit, index) => index === 0 ? { ...unit, col: 8, row: 8 } : unit);
    await writeFile(armyPath, `${JSON.stringify(invalidArmy)}\n`);
    await expect(initPlaytestRun({ root: await tempDir(), ruleset: 'skirmish-v1', map: 'skirmish-v1', unitsPath: armyPath })).rejects.toThrow('outside P1\'s deployment zone');
    await expect(initPlaytestRun({ root: await tempDir(), ruleset: 'skirmish-v1', map: 'skirmish-v1', players: ['Red', 'Blue'], boardPath: lateBoardPath })).rejects.toThrow('must match deployment order');
  });
});

function unitCompositions(): Array<{ id: string; player: string; type: string; col: number; row: number }> {
  return skirmishArmyState().units.map(({ id, player, type, col, row }) => ({ id, player, type, col, row }));
}

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
  tempDirs.push(root);
  return root;
}
