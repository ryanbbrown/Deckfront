import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';
import { validateReplayBundle } from '../../src/playtest/run';
import type { BoardState } from '../../src/board/schema';

const tempDirs: string[] = [];

describe('structured board CLI', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('executes movement, captures centers, writes snapshots, and advances the board turn', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'results', 'turn-001.deck-result.json');
    const actionPath = join(dir, 'actions', 'turn-001.board.json');
    const resultPath = join(dir, 'results', 'turn-001.board-result.json');
    await writeJson(statePath, boardState({ units: [unit('P1-raider-1', 'P1', 'raider', 10, 1), unit('P2-scout-1', 'P2', 'scout', 0, 8)] }));
    await writeJson(deckResultPath, deckResult({ produced: {} }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [{ unit: 'P1-raider-1', from: { col: 10, row: 1 }, to: { col: 8, row: 1 } }],
        recruits: [],
        attacks: [],
        heals: [],
        upgrades: []
      }
    });

    await runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', resultPath], () => undefined);

    const result = JSON.parse(await readFile(resultPath, 'utf8')) as { before: string; after: string; actions: { movements: unknown[] } };
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as BoardState;

    expect(result.before).toBe('snapshots/turn-001.before.board.json');
    expect(result.after).toBe('snapshots/turn-001.after.board.json');
    expect(result.actions.movements).toHaveLength(1);
    expect(saved.turn).toEqual({ activePlayer: 'P2', round: 1 });
    expect(saved.units.find((candidate) => candidate.id === 'P1-raider-1')).toMatchObject({ col: 8, row: 1 });
    expect(saved.supply.find((entry) => entry.player === 'P1')?.amount).toBe(2);
    expect(saved.supplyControl.find((center) => center.id === 'center-northeast')?.controller).toBe('P1');
    await expect(readFile(join(dir, result.before), 'utf8')).resolves.toContain('"activePlayer": "P1"');
    await expect(readFile(join(dir, result.after), 'utf8')).resolves.toContain('"activePlayer": "P2"');
  });

  it('derives attack damage and removal from attacker stats and deck damage', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-001.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    const resultPath = join(dir, 'turn-001.board-result.json');
    await writeJson(statePath, boardState({ units: [unit('P1-guardian-1', 'P1', 'guardian', 10, 1), unit('P2-scout-1', 'P2', 'scout', 9, 1)] }));
    await writeJson(deckResultPath, deckResult({ produced: { damage: 4 } }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [],
        recruits: [],
        attacks: [{ attacker: 'P1-guardian-1', target: 'P2-scout-1', deckDamage: 4 }],
        heals: [],
        upgrades: []
      }
    });

    await runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', resultPath], () => undefined);

    const result = JSON.parse(await readFile(resultPath, 'utf8')) as { actions: { attacks: Array<{ damage: number; targetRemoved: boolean }> } };
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as BoardState;

    expect(result.actions.attacks).toEqual([{ attacker: 'P1-guardian-1', target: 'P2-scout-1', damage: 8, deckDamage: 4, targetRemoved: true }]);
    expect(saved.units.some((candidate) => candidate.id === 'P2-scout-1')).toBe(false);
  });

  it('rejects invalid movement without writing outputs or mutating board state', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-001.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    const resultPath = join(dir, 'turn-001.board-result.json');
    const before = boardState({ units: [unit('P1-guardian-1', 'P1', 'guardian', 10, 1), unit('P2-scout-1', 'P2', 'scout', 0, 8)] });
    await writeJson(statePath, before);
    await writeJson(deckResultPath, deckResult({ produced: {} }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [{ unit: 'P1-guardian-1', from: { col: 10, row: 1 }, to: { col: 8, row: 1 } }],
        recruits: [],
        attacks: [],
        heals: [],
        upgrades: []
      }
    });

    await expect(runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', resultPath], () => undefined)).rejects.toThrow(
      'exceeding movement 1'
    );

    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual(before);
    await expect(exists(resultPath)).resolves.toBe(false);
    await expect(exists(join(dir, 'snapshots', 'turn-001.before.board.json'))).resolves.toBe(false);
  });

  it('rejects mismatched deck result turn ids', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-999.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    await writeJson(statePath, boardState({ units: [unit('P1-guardian-1', 'P1', 'guardian', 10, 1)] }));
    await writeJson(deckResultPath, deckResult({ turnId: 'turn-999', produced: {} }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: { movements: [], recruits: [], attacks: [], heals: [], upgrades: [] }
    });

    await expect(
      runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', join(dir, 'result.json')], () => undefined)
    ).rejects.toThrow('does not match deck result');
  });

  it('rejects overusing absent deck damage counters', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-001.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    await writeJson(statePath, boardState({ units: [unit('P1-guardian-1', 'P1', 'guardian', 10, 1), unit('P2-scout-1', 'P2', 'scout', 9, 1)] }));
    await writeJson(deckResultPath, deckResult({ produced: {} }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [],
        recruits: [],
        attacks: [{ attacker: 'P1-guardian-1', target: 'P2-scout-1', deckDamage: 1 }],
        heals: [],
        upgrades: []
      }
    });

    await expect(
      runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', join(dir, 'result.json')], () => undefined)
    ).rejects.toThrow('exceeding produced damage 0');
  });

  it('recruits base-stat units from post-income supply', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-001.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    const resultPath = join(dir, 'turn-001.board-result.json');
    await writeJson(statePath, boardState({ units: [], supply: [{ player: 'P1', amount: 3 }, { player: 'P2', amount: 0 }] }));
    await writeJson(deckResultPath, deckResult({ produced: {} }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [],
        recruits: [{ unit: 'P1-guardian-1', type: 'guardian', at: { col: 10, row: 1 } }],
        attacks: [],
        heals: [],
        upgrades: []
      }
    });

    await runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', resultPath], () => undefined);

    const saved = JSON.parse(await readFile(statePath, 'utf8')) as BoardState;
    expect(saved.supply.find((entry) => entry.player === 'P1')?.amount).toBe(0);
    expect(saved.units.find((candidate) => candidate.id === 'P1-guardian-1')).toMatchObject({ hp: 16, maxHp: 16, attack: 4 });
  });

  it('rejects duplicate recruits into the same newly occupied home hex', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-001.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    await writeJson(statePath, boardState({ units: [], supply: [{ player: 'P1', amount: 10 }, { player: 'P2', amount: 0 }] }));
    await writeJson(deckResultPath, deckResult({ produced: {} }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [],
        recruits: [
          { unit: 'P1-guardian-1', type: 'guardian', at: { col: 10, row: 1 } },
          { unit: 'P1-scout-1', type: 'scout', at: { col: 10, row: 1 } }
        ],
        attacks: [],
        heals: [],
        upgrades: []
      }
    });

    await expect(
      runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', join(dir, 'result.json')], () => undefined)
    ).rejects.toThrow('entered occupied hex 10,1 containing P1-guardian-1');
  });

  it('rejects multiple recruits under recruitcap rulesets', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-001.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    await writeJson(statePath, boardState({ ruleset: 'territory-v1-cost6-damagecap-recruitcap', units: [], supply: [{ player: 'P1', amount: 12 }, { player: 'P2', amount: 0 }] }));
    await writeJson(deckResultPath, deckResult({ produced: {} }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [],
        recruits: [
          { unit: 'P1-guardian-1', type: 'guardian', at: { col: 10, row: 1 } },
          { unit: 'P1-scout-1', type: 'scout', at: { col: 11, row: 0 } }
        ],
        attacks: [],
        heals: [],
        upgrades: []
      }
    });

    await expect(
      runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', join(dir, 'result.json')], () => undefined)
    ).rejects.toThrow('recruitcap rulesets allow at most 1 recruit per turn');
  });


  it('applies health upgrades to current hp and max hp', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-001.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    const resultPath = join(dir, 'turn-001.board-result.json');
    await writeJson(statePath, boardState({ units: [{ ...unit('P1-guardian-1', 'P1', 'guardian', 10, 1), hp: 10 }] }));
    await writeJson(deckResultPath, deckResult({ produced: { upgradeHealth: 2 } }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [],
        recruits: [],
        attacks: [],
        heals: [],
        upgrades: [{ target: 'P1-guardian-1', attack: 0, maxHp: 2 }]
      }
    });

    await runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', resultPath], () => undefined);

    const saved = JSON.parse(await readFile(statePath, 'utf8')) as BoardState;
    expect(saved.units.find((candidate) => candidate.id === 'P1-guardian-1')).toMatchObject({ hp: 12, maxHp: 18 });
  });

  it('rejects printed healing above one healer phase budget', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-001.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    await writeJson(
      statePath,
      boardState({ units: [unit('P1-healer-1', 'P1', 'healer', 10, 1), { ...unit('P1-guardian-1', 'P1', 'guardian', 10, 2), hp: 10 }] })
    );
    await writeJson(deckResultPath, deckResult({ produced: {} }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
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

    await expect(
      runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', join(dir, 'result.json')], () => undefined)
    ).rejects.toThrow('exceeding printed heal 1');
  });

  it('rejects per-attacker deck damage above damagecap ruleset cap', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-001.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    await writeJson(
      statePath,
      boardState({ ruleset: 'territory-v1-cost6-damagecap', units: [unit('P1-guardian-1', 'P1', 'guardian', 10, 1), unit('P2-scout-1', 'P2', 'scout', 9, 1)] })
    );
    await writeJson(deckResultPath, deckResult({ produced: { damage: 2 } }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [],
        recruits: [],
        attacks: [{ attacker: 'P1-guardian-1', target: 'P2-scout-1', deckDamage: 2 }],
        heals: [],
        upgrades: []
      }
    });

    await expect(
      runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', join(dir, 'result.json')], () => undefined)
    ).rejects.toThrow('used 2 deck damage under damage cap');
  });

  it('rejects movement through an occupied enemy hex when the shortest legal path is blocked', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'turn-001.deck-result.json');
    const actionPath = join(dir, 'turn-001.board.json');
    await writeJson(
      statePath,
      boardState({ units: [unit('P1-raider-1', 'P1', 'raider', 0, 0), unit('P2-scout-1', 'P2', 'scout', 1, 0)] })
    );
    await writeJson(deckResultPath, deckResult({ produced: {} }));
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [{ unit: 'P1-raider-1', from: { col: 0, row: 0 }, to: { col: 2, row: 0 } }],
        recruits: [],
        attacks: [],
        heals: [],
        upgrades: []
      }
    });

    await expect(
      runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', join(dir, 'result.json')], () => undefined)
    ).rejects.toThrow(/movement uses an invalid map path|exceeding movement 2/);
  });

  it('writes board results that assemble into a strict replay bundle', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'board.json');
    const deckResultPath = join(dir, 'results', 'turn-001.deck-result.json');
    const actionPath = join(dir, 'actions', 'turn-001.board.json');
    const boardResultPath = join(dir, 'results', 'turn-001.board-result.json');
    const deck = deckResult({ produced: { damage: 4 } });
    await writeJson(statePath, boardState({ units: [unit('P1-guardian-1', 'P1', 'guardian', 10, 1), unit('P2-scout-1', 'P2', 'scout', 9, 1)] }));
    await writeJson(deckResultPath, deck);
    await writeJson(actionPath, {
      schemaVersion: 1,
      turnId: 'turn-001',
      player: 'P1',
      actions: {
        movements: [],
        recruits: [],
        attacks: [{ attacker: 'P1-guardian-1', target: 'P2-scout-1', deckDamage: 4 }],
        heals: [],
        upgrades: []
      }
    });
    await writeDeckSnapshots(dir, deck);

    await runCli(['board-turn', '--state', statePath, '--deck-result', deckResultPath, '--actions', actionPath, '--result', boardResultPath], () => undefined);

    const boardResult = JSON.parse(await readFile(boardResultPath, 'utf8')) as { before: string; after: string; actions: unknown };
    await writeJson(join(dir, 'timeline.json'), {
      schemaVersion: 1,
      title: 'Structured Board Replay',
      entries: [
        {
          id: 'turn-001',
          player: 'P1',
          round: 1,
          deck: replayDeckSummary(deck),
          board: { before: boardResult.before, after: boardResult.after },
          actions: boardResult.actions,
          summary: 'Structured board turn.',
          reasoning: 'Validator coverage.'
        }
      ]
    });

    await expect(validateReplayBundle(join(dir, 'timeline.json'), { strict: true })).resolves.toMatchObject({ entries: expect.any(Array) });
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckfront-board-turn-'));
  tempDirs.push(dir);
  return dir;
}

function boardState(options: { units: BoardState['units']; ruleset?: string; supply?: BoardState['supply']; supplyControl?: BoardState['supplyControl'] }): BoardState {
  return {
    schemaVersion: 1,
    ruleset: options.ruleset ?? 'territory-v1',
    map: 'sketch-v1',
    turn: { activePlayer: 'P1', round: 1 },
    units: options.units,
    supplyControl:
      options.supplyControl ??
      ['center-northwest', 'center-west-south', 'center-center-north', 'center-center', 'center-center-south', 'center-northeast', 'center-east', 'center-southeast'].map(
        (id) => ({ id, controller: null })
      ),
    supply: options.supply ?? [
      { player: 'P1', amount: 0 },
      { player: 'P2', amount: 0 }
    ],
    notes: []
  };
}

function unit(id: string, player: string, type: string, col: number, row: number): BoardState['units'][number] {
  const stats: Record<string, { hp: number; attack: number }> = {
    guardian: { hp: 16, attack: 4 },
    raider: { hp: 8, attack: 6 },
    marksman: { hp: 8, attack: 4 },
    scout: { hp: 8, attack: 2 },
    druid: { hp: 10, attack: 4 },
    healer: { hp: 4, attack: 1 }
  };
  const stat = stats[type];
  if (!stat) {
    throw new Error(`Unknown test unit type: ${type}`);
  }
  return { id, player, type, col, row, hp: stat.hp, maxHp: stat.hp, attack: stat.attack };
}

function deckResult(options: { turnId?: string; produced: Record<string, number> }) {
  return {
    schemaVersion: 1,
    turnId: options.turnId ?? 'turn-001',
    player: 'P1',
    before: 'snapshots/turn-001.before.deck.json',
    after: 'snapshots/turn-001.after.deck.json',
    actions: [],
    drawnHand: [],
    played: [],
    bought: [],
    produced: options.produced
  };
}

function replayDeckSummary(deck: ReturnType<typeof deckResult>) {
  return {
    before: deck.before,
    after: deck.after,
    drawnHand: deck.drawnHand,
    played: deck.played,
    bought: deck.bought,
    produced: deck.produced,
    actions: deck.actions
  };
}

async function writeDeckSnapshots(dir: string, deck: ReturnType<typeof deckResult>): Promise<void> {
  const snapshot = {
    schemaVersion: 1,
    rngState: 1,
    game: {
      players: [{ id: 'P1' }, { id: 'P2' }],
      activePlayer: 0
    }
  };
  await writeJson(join(dir, deck.before), snapshot);
  await writeJson(join(dir, deck.after), snapshot);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
