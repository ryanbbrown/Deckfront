import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { boardStateSchema, type BoardState } from '../../src/board/schema';
import { replayTimelineSchema } from '../../src/replay/schema';
import { initPlaytestRun, playtestRunPaths, turnSnapshotPaths, validateReplayBundle } from '../../src/playtest/run';
import { runPlaytestCli } from '../../src/playtest/main';

describe('playtest run helpers', () => {
  it('uses one directory layout for mutable run artifacts', () => {
    expect(playtestRunPaths('.games/example')).toEqual({
      root: '.games/example',
      deckState: '.games/example/deck.json',
      boardState: '.games/example/board.json',
      timeline: '.games/example/timeline.json',
      snapshotsDir: '.games/example/snapshots'
    });

    expect(turnSnapshotPaths('.games/example', 'turn-003')).toEqual({
      deckBefore: '.games/example/snapshots/turn-003.before.deck.json',
      deckAfter: '.games/example/snapshots/turn-003.after.deck.json',
      boardBefore: '.games/example/snapshots/turn-003.before.board.json',
      boardAfter: '.games/example/snapshots/turn-003.after.board.json'
    });
  });

  it('validates the committed territory replay bundle', async () => {
    const bundle = await validateReplayBundle('.games/territory-v1-playtest/timeline.json');

    expect(bundle.entries).toHaveLength(2);
    expect(bundle.entries[0]?.entry.id).toBe('turn-001');
    expect(bundle.entries[1]?.entry.player).toBe('P2');
  });

  it('rejects empty replay bundles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = join(root, 'timeline.json');
    await writeFile(
      timelinePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          title: 'Empty Replay',
          entries: []
        },
        null,
        2
      )}\n`
    );

    await expect(validateReplayBundle(timelinePath)).rejects.toThrow('timeline has no entries');
  });

  it('rejects board snapshots with overlapping units', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      afterUnits: [
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 11, 1, 8, 8, 2)
      ]
    });

    await expect(validateReplayBundle(timelinePath)).rejects.toThrow('multiple units occupy 11,1');
  });

  it('requires action logs for strict validation', async () => {
    await expect(validateReplayBundle('.games/territory-v1-playtest/timeline.json', { strict: true })).rejects.toThrow(
      'strict validation requires board actions'
    );
  });

  it('strictly validates logged attack range and damage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      afterUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4), testUnit('P2-scout-1', 'P2', 'scout', 10, 1, 4, 8, 2)],
      actions: {
        movements: [],
        recruits: [],
        attacks: [{ attacker: 'P1-guardian-1', target: 'P2-scout-1', damage: 4, deckDamage: 0, targetRemoved: false }]
      }
    });

    const bundle = await validateReplayBundle(timelinePath, { strict: true });
    expect(bundle.entries).toHaveLength(1);
  });

  it('rejects out-of-range strict attack logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      beforeUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4), testUnit('P2-scout-1', 'P2', 'scout', 8, 1, 8, 8, 2)],
      afterUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4), testUnit('P2-scout-1', 'P2', 'scout', 8, 1, 4, 8, 2)],
      actions: {
        movements: [],
        recruits: [],
        attacks: [{ attacker: 'P1-guardian-1', target: 'P2-scout-1', damage: 4, deckDamage: 0, targetRemoved: false }]
      }
    });

    await expect(validateReplayBundle(timelinePath, { strict: true })).rejects.toThrow('exceeding range 1');
  });

  it('rejects same-turn recruit attacks in strict validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      beforeUnits: [testUnit('P2-scout-1', 'P2', 'scout', 10, 1, 8, 8, 2)],
      afterUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4), testUnit('P2-scout-1', 'P2', 'scout', 10, 1, 4, 8, 2)],
      actions: {
        movements: [],
        recruits: [{ unit: 'P1-guardian-1', type: 'guardian', at: { col: 11, row: 1 } }],
        attacks: [{ attacker: 'P1-guardian-1', target: 'P2-scout-1', damage: 4, deckDamage: 0, targetRemoved: false }]
      }
    });

    await expect(validateReplayBundle(timelinePath, { strict: true })).rejects.toThrow('cannot attack on the turn it was recruited');
  });

  it('rejects logged recruits that are absent after the turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      beforeSupply: [
        { player: 'P1', amount: 5 },
        { player: 'P2', amount: 0 }
      ],
      afterSupply: [
        { player: 'P1', amount: 0 },
        { player: 'P2', amount: 0 }
      ],
      beforeUnits: [testUnit('P2-scout-1', 'P2', 'scout', 10, 1, 8, 8, 2)],
      afterUnits: [testUnit('P2-scout-1', 'P2', 'scout', 10, 1, 8, 8, 2)],
      actions: {
        movements: [],
        recruits: [{ unit: 'P1-guardian-1', type: 'guardian', at: { col: 11, row: 1 } }],
        attacks: []
      }
    });

    await expect(validateReplayBundle(timelinePath, { strict: true })).rejects.toThrow('recruit P1-guardian-1 is logged but missing after the turn');
  });

  it('rejects multiple recruits under recruitcap rulesets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      ruleset: 'territory-v1-cost6-damagecap-recruitcap',
      beforeSupply: [
        { player: 'P1', amount: 12 },
        { player: 'P2', amount: 0 }
      ],
      afterSupply: [
        { player: 'P1', amount: 2 },
        { player: 'P2', amount: 0 }
      ],
      beforeUnits: [],
      afterUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 10, 1, 16, 16, 4), testUnit('P1-scout-1', 'P1', 'scout', 11, 0, 8, 8, 2)],
      actions: {
        movements: [],
        recruits: [
          { unit: 'P1-guardian-1', type: 'guardian', at: { col: 10, row: 1 } },
          { unit: 'P1-scout-1', type: 'scout', at: { col: 11, row: 0 } }
        ],
        attacks: []
      }
    });

    await expect(validateReplayBundle(timelinePath, { strict: true })).rejects.toThrow('recruitcap rulesets allow at most 1 recruit per turn');
  });

  it('rejects movement through occupied enemy hexes in strict validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      beforeUnits: [testUnit('P1-raider-1', 'P1', 'raider', 0, 0, 8, 8, 6), testUnit('P2-scout-1', 'P2', 'scout', 1, 0, 8, 8, 2)],
      afterUnits: [testUnit('P1-raider-1', 'P1', 'raider', 2, 0, 8, 8, 6), testUnit('P2-scout-1', 'P2', 'scout', 1, 0, 8, 8, 2)],
      actions: {
        movements: [{ unit: 'P1-raider-1', from: { col: 0, row: 0 }, to: { col: 2, row: 0 } }],
        recruits: [],
        attacks: []
      }
    });

    await expect(validateReplayBundle(timelinePath, { strict: true })).rejects.toThrow('exceeding movement 2');
  });

  it('strictly validates supply income and recruit spend', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      beforeSupply: [
        { player: 'P1', amount: 3 },
        { player: 'P2', amount: 0 }
      ],
      afterSupply: [
        { player: 'P1', amount: 1 },
        { player: 'P2', amount: 0 }
      ],
      beforeUnits: [testUnit('P2-scout-1', 'P2', 'scout', 10, 1, 8, 8, 2)],
      afterUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4), testUnit('P2-scout-1', 'P2', 'scout', 10, 1, 8, 8, 2)],
      actions: {
        movements: [],
        recruits: [{ unit: 'P1-guardian-1', type: 'guardian', at: { col: 11, row: 1 } }],
        attacks: []
      }
    });

    await expect(validateReplayBundle(timelinePath, { strict: true })).rejects.toThrow('P1 supply is 1, expected 0');
  });

  it('strictly validates logged deck healing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      produced: { heal: 2 },
      beforeUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 10, 16, 4)],
      afterUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 12, 16, 4)],
      actions: {
        movements: [],
        recruits: [],
        attacks: [],
        heals: [{ target: 'P1-guardian-1', amount: 2, source: 'deck' }],
        upgrades: []
      }
    });

    const bundle = await validateReplayBundle(timelinePath, { strict: true });
    expect(bundle.entries).toHaveLength(1);
  });

  it('rejects unexplained strict hp increases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      beforeUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 10, 16, 4)],
      afterUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 12, 16, 4)],
      actions: {
        movements: [],
        recruits: [],
        attacks: [],
        heals: [],
        upgrades: []
      }
    });

    await expect(validateReplayBundle(timelinePath, { strict: true })).rejects.toThrow('exceeding logged damage/upgrades/healing maximum');
  });

  it('strictly validates logged permanent upgrades', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      produced: { upgradeDamage: 1, upgradeHealth: 2 },
      beforeUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)],
      afterUnits: [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 18, 18, 5)],
      actions: {
        movements: [],
        recruits: [],
        attacks: [],
        heals: [],
        upgrades: [{ target: 'P1-guardian-1', attack: 1, maxHp: 2 }]
      }
    });

    const bundle = await validateReplayBundle(timelinePath, { strict: true });
    expect(bundle.entries).toHaveLength(1);
  });

  it('rejects printed healing above the healer budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      beforeUnits: [testUnit('P1-druid-1', 'P1', 'druid', 11, 1, 10, 10, 4), testUnit('P1-guardian-1', 'P1', 'guardian', 10, 1, 14, 16, 4)],
      afterUnits: [testUnit('P1-druid-1', 'P1', 'druid', 11, 1, 10, 10, 4), testUnit('P1-guardian-1', 'P1', 'guardian', 10, 1, 16, 16, 4)],
      actions: {
        movements: [],
        recruits: [],
        attacks: [],
        heals: [{ healer: 'P1-druid-1', target: 'P1-guardian-1', amount: 2, source: 'unit' }],
        upgrades: []
      }
    });

    await expect(validateReplayBundle(timelinePath, { strict: true })).rejects.toThrow('exceeding printed heal 1');
  });

  it('rejects cumulative printed healing above one healer budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      beforeUnits: [testUnit('P1-healer-1', 'P1', 'healer', 10, 1, 4, 4, 1), testUnit('P1-guardian-1', 'P1', 'guardian', 10, 2, 10, 16, 4)],
      afterUnits: [testUnit('P1-healer-1', 'P1', 'healer', 10, 1, 4, 4, 1), testUnit('P1-guardian-1', 'P1', 'guardian', 10, 2, 12, 16, 4)],
      actions: {
        movements: [],
        recruits: [],
        attacks: [],
        heals: [
          { healer: 'P1-healer-1', target: 'P1-guardian-1', amount: 1, source: 'unit' },
          { healer: 'P1-healer-1', target: 'P1-guardian-1', amount: 1, source: 'unit' }
        ],
        upgrades: []
      }
    });

    await expect(validateReplayBundle(timelinePath, { strict: true })).rejects.toThrow('P1-healer-1 healed 2, exceeding printed heal 1');
  });

  it('validates logged unit-lead win threat creation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      ruleset: 'territory-v1-cost6-damagecap-responsewin-lead4',
      beforeUnits: [
        testUnit('P1-raider-1', 'P1', 'raider', 10, 1, 8, 8, 6),
        testUnit('P1-marksman-1', 'P1', 'marksman', 11, 0, 8, 8, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 12, 1, 8, 8, 2),
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)
      ],
      afterUnits: [
        testUnit('P1-raider-1', 'P1', 'raider', 10, 1, 8, 8, 6),
        testUnit('P1-marksman-1', 'P1', 'marksman', 11, 0, 8, 8, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 12, 1, 8, 8, 2),
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)
      ],
      winEvents: [
        {
          type: 'unitLead',
          status: 'created',
          player: 'P1',
          completedTurns: 0,
          playerUnits: 4,
          opponentUnits: 0,
          playerCenters: 0,
          opponentCenters: 0
        }
      ]
    });

    const bundle = await validateReplayBundle(timelinePath, { strictWin: true });
    expect(bundle.entries).toHaveLength(1);
  });

  it('rejects missing strict win events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      ruleset: 'territory-v1-cost6-damagecap-responsewin-lead4',
      beforeUnits: [
        testUnit('P1-raider-1', 'P1', 'raider', 10, 1, 8, 8, 6),
        testUnit('P1-marksman-1', 'P1', 'marksman', 11, 0, 8, 8, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 12, 1, 8, 8, 2),
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)
      ],
      afterUnits: [
        testUnit('P1-raider-1', 'P1', 'raider', 10, 1, 8, 8, 6),
        testUnit('P1-marksman-1', 'P1', 'marksman', 11, 0, 8, 8, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 12, 1, 8, 8, 2),
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)
      ]
    });

    await expect(validateReplayBundle(timelinePath, { strictWin: true })).rejects.toThrow('strict win validation requires winEvents');
  });

  it('rejects incorrect strict win event statuses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      ruleset: 'territory-v1-cost6-damagecap-responsewin-lead4',
      beforeUnits: [
        testUnit('P1-raider-1', 'P1', 'raider', 10, 1, 8, 8, 6),
        testUnit('P1-marksman-1', 'P1', 'marksman', 11, 0, 8, 8, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 12, 1, 8, 8, 2),
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)
      ],
      afterUnits: [
        testUnit('P1-raider-1', 'P1', 'raider', 10, 1, 8, 8, 6),
        testUnit('P1-marksman-1', 'P1', 'marksman', 11, 0, 8, 8, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 12, 1, 8, 8, 2),
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)
      ],
      winEvents: [
        {
          type: 'unitLead',
          status: 'confirmed',
          player: 'P1',
          completedTurns: 0,
          playerUnits: 4,
          opponentUnits: 0,
          playerCenters: 0,
          opponentCenters: 0
        }
      ]
    });

    await expect(validateReplayBundle(timelinePath, { strictWin: true })).rejects.toThrow('do not match expected');
  });

  it('validates terminal win events after the final completed turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      ruleset: 'territory-v1-cost6-damagecap-responsewin-lead4',
      afterActivePlayer: 'P1',
      beforeUnits: [
        testUnit('P1-raider-1', 'P1', 'raider', 10, 1, 8, 8, 6),
        testUnit('P1-marksman-1', 'P1', 'marksman', 11, 0, 8, 8, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 12, 1, 8, 8, 2),
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)
      ],
      afterUnits: [
        testUnit('P1-raider-1', 'P1', 'raider', 10, 1, 8, 8, 6),
        testUnit('P1-marksman-1', 'P1', 'marksman', 11, 0, 8, 8, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 12, 1, 8, 8, 2),
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)
      ],
      winEvents: [
        {
          type: 'unitLead',
          status: 'created',
          player: 'P1',
          completedTurns: 0,
          playerUnits: 4,
          opponentUnits: 0,
          playerCenters: 0,
          opponentCenters: 0
        }
      ],
      terminalWinEvents: [
        {
          type: 'unitLead',
          status: 'confirmed',
          player: 'P1',
          completedTurns: 1,
          playerUnits: 4,
          opponentUnits: 0,
          playerCenters: 0,
          opponentCenters: 0
        }
      ]
    });

    const bundle = await validateReplayBundle(timelinePath, { strictWin: true });
    expect(bundle.timeline.terminalWinEvents).toHaveLength(1);
  });

  it('initializes a mutable run directory from a ruleset and map', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));

    const paths = await initPlaytestRun({ root, ruleset: 'territory-v1', map: 'sketch-v1', title: 'Fresh Run' });
    const board = boardStateSchema.parse(JSON.parse(await readFile(paths.boardState, 'utf8')) as unknown);
    const timeline = replayTimelineSchema.parse(JSON.parse(await readFile(paths.timeline, 'utf8')) as unknown);

    expect(board.ruleset).toBe('territory-v1');
    expect(board.map).toBe('sketch-v1');
    expect(board.units).toEqual([]);
    expect(board.supplyControl).toHaveLength(8);
    expect(board.supply).toEqual([
      { player: 'P1', amount: 0 },
      { player: 'P2', amount: 0 }
    ]);
    expect(timeline).toEqual({ schemaVersion: 1, title: 'Fresh Run', entries: [] });
  });

  it('runs validate and init through the playtest CLI', async () => {
    const output: string[] = [];
    await runPlaytestCli(['validate', '.games/territory-v1-playtest/timeline.json'], (line) => output.push(line));

    expect(output[0]).toContain('Valid replay bundle');

    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    await runPlaytestCli(['init', '--run', root, '--ruleset', 'territory-v1', '--map', 'sketch-v1'], (line) => output.push(line));

    expect(output.at(-1)).toBe(`Initialized playtest run: ${root}`);
  });

  it('runs strict win validation through the playtest CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = await writeSingleTurnReplay(root, {
      ruleset: 'territory-v1-cost6-damagecap-responsewin-lead4',
      beforeUnits: [
        testUnit('P1-raider-1', 'P1', 'raider', 10, 1, 8, 8, 6),
        testUnit('P1-marksman-1', 'P1', 'marksman', 11, 0, 8, 8, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 12, 1, 8, 8, 2),
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)
      ],
      afterUnits: [
        testUnit('P1-raider-1', 'P1', 'raider', 10, 1, 8, 8, 6),
        testUnit('P1-marksman-1', 'P1', 'marksman', 11, 0, 8, 8, 4),
        testUnit('P1-scout-1', 'P1', 'scout', 12, 1, 8, 8, 2),
        testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4)
      ],
      actions: {
        movements: [],
        recruits: [],
        attacks: [],
        heals: [],
        upgrades: []
      },
      winEvents: [
        {
          type: 'unitLead',
          status: 'created',
          player: 'P1',
          completedTurns: 0,
          playerUnits: 4,
          opponentUnits: 0,
          playerCenters: 0,
          opponentCenters: 0
        }
      ]
    });

    const output: string[] = [];
    await runPlaytestCli(['validate', '--strict', '--strict-win', timelinePath], (line) => output.push(line));

    expect(output.at(-1)).toContain('Valid replay bundle');
  });

  it('initializes from a starter board file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));

    await runPlaytestCli(
      [
        'init',
        '--run',
        root,
        '--ruleset',
        'territory-v1',
        '--map',
        'sketch-v1',
        '--board',
        '.games/territory-v1-playtest/snapshots/turn-001.before.board.json'
      ],
      () => undefined
    );

    const board = boardStateSchema.parse(JSON.parse(await readFile(join(root, 'board.json'), 'utf8')) as unknown);

    expect(board.units).toHaveLength(8);
    expect(board.units.find((unit) => unit.id === 'P1-guardian-1')?.hp).toBe(16);
    expect(board.units.find((unit) => unit.id === 'P2-druid-1')?.hp).toBe(10);
  });

  it('fails loudly when a timeline references missing snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = join(root, 'timeline.json');
    await writeFile(
      timelinePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          title: 'Broken Replay',
          entries: [
            {
              id: 'turn-001',
              player: 'P1',
              round: 1,
              deck: {
                before: 'snapshots/turn-001.before.deck.json',
                after: 'snapshots/turn-001.after.deck.json'
              },
              board: {
                before: 'snapshots/turn-001.before.board.json',
                after: 'snapshots/turn-001.after.board.json'
              },
              summary: 'Missing files.',
              reasoning: 'The bundle validator should catch missing snapshot paths.'
            }
          ]
        },
        null,
        2
      )}\n`
    );

    await expect(validateReplayBundle(timelinePath)).rejects.toThrow('Invalid replay bundle');
  });
});

type BoardUnit = BoardState['units'][number];

function testUnit(id: string, player: string, type: string, col: number, row: number, hp: number, maxHp: number, attack: number): BoardUnit {
  return { id, player, type, col, row, hp, maxHp, attack };
}

async function writeSingleTurnReplay(
  root: string,
  options: {
    ruleset?: string;
    beforeUnits?: BoardState['units'];
    afterUnits?: BoardState['units'];
    beforeSupply?: BoardState['supply'];
    afterSupply?: BoardState['supply'];
    produced?: Record<string, number>;
    actions?: unknown;
    winEvents?: unknown;
    terminalWinEvents?: unknown;
    afterActivePlayer?: string;
  }
): Promise<string> {
  const snapshots = join(root, 'snapshots');
  await mkdir(snapshots, { recursive: true });

  const beforeUnits = options.beforeUnits ?? [testUnit('P1-guardian-1', 'P1', 'guardian', 11, 1, 16, 16, 4), testUnit('P2-scout-1', 'P2', 'scout', 10, 1, 8, 8, 2)];
  const afterUnits = options.afterUnits ?? beforeUnits;
  const beforeSupply = options.beforeSupply ?? [
    { player: 'P1', amount: 0 },
    { player: 'P2', amount: 0 }
  ];
  const afterSupply = options.afterSupply ?? [
    { player: 'P1', amount: 2 },
    { player: 'P2', amount: 0 }
  ];
  const boardBase = {
    schemaVersion: 1,
    ruleset: options.ruleset ?? 'territory-v1',
    map: 'sketch-v1',
    turn: { activePlayer: 'P1', round: 1 },
    supplyControl: [],
    notes: []
  };
  const deckSnapshot = {
    schemaVersion: 1,
    rngState: 1,
    game: {
      players: [{ id: 'P1' }, { id: 'P2' }],
      activePlayer: 0
    }
  };
  const entry = {
    id: 'turn-001',
    player: 'P1',
    round: 1,
    deck: {
      before: 'snapshots/turn-001.before.deck.json',
      after: 'snapshots/turn-001.after.deck.json',
      drawnHand: [],
      played: [],
      bought: [],
      produced: { damage: 0, reattack: 0, ...(options.produced ?? {}) }
    },
    board: {
      before: 'snapshots/turn-001.before.board.json',
      after: 'snapshots/turn-001.after.board.json'
    },
    ...(options.actions ? { actions: options.actions } : {}),
    ...(options.winEvents ? { winEvents: options.winEvents } : {}),
    summary: 'Synthetic turn.',
    reasoning: 'Synthetic replay for validator coverage.'
  };

  await writeFile(join(snapshots, 'turn-001.before.deck.json'), `${JSON.stringify(deckSnapshot, null, 2)}\n`);
  await writeFile(join(snapshots, 'turn-001.after.deck.json'), `${JSON.stringify(deckSnapshot, null, 2)}\n`);
  await writeFile(join(snapshots, 'turn-001.before.board.json'), `${JSON.stringify({ ...boardBase, supply: beforeSupply, units: beforeUnits }, null, 2)}\n`);
  await writeFile(
    join(snapshots, 'turn-001.after.board.json'),
    `${JSON.stringify({ ...boardBase, turn: { activePlayer: options.afterActivePlayer ?? 'P2', round: 1 }, supply: afterSupply, units: afterUnits }, null, 2)}\n`
  );
  await writeFile(
    join(root, 'timeline.json'),
    `${JSON.stringify({ schemaVersion: 1, title: 'Synthetic Replay', entries: [entry], ...(options.terminalWinEvents ? { terminalWinEvents: options.terminalWinEvents } : {}) }, null, 2)}\n`
  );

  return join(root, 'timeline.json');
}
