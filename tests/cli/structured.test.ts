import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';
import type { PersistedGame } from '../../src/cli/persistence';

const tempDirs: string[] = [];

describe('structured deck CLI', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('prints legal actions as JSON and persists initialized state', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'deck.json');
    const output: string[] = [];

    await runCli(['legal-actions', '--config', 'tests/fixtures/multi-player.yaml', '--state', statePath, '--seed', '1', '--json'], (line) =>
      output.push(line)
    );

    const parsed = JSON.parse(output.join('\n')) as { activePlayer: string; actions: Array<{ description: string; action: unknown }> };
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as PersistedGame;

    expect(parsed.activePlayer).toBe('P1');
    expect(parsed.actions.map((action) => action.description)).toContain('Move to buy phase');
    expect(saved.game.players[0]?.hand).toEqual(['copper']);
  });

  it('initializes structured deck commands with draft overrides', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'deck.json');

    await runCli(['legal-actions', '--config', 'tests/fixtures/multi-player.yaml', '--state', statePath, '--seed', '1', '--draft', 'P1=province', '--json'], () =>
      undefined
    );

    const saved = JSON.parse(await readFile(statePath, 'utf8')) as PersistedGame;
    const playerOneCards = [...saved.game.players[0]!.hand, ...saved.game.players[0]!.draw].sort();
    const playerTwoCards = [...saved.game.players[1]!.hand, ...saved.game.players[1]!.draw].sort();

    expect(playerOneCards).toEqual(['copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'province']);
    expect(playerTwoCards).toEqual(['copper']);
    expect(saved.game.supply.province).toBe(0);
  });

  it('executes one structured deck turn and derives result fields from engine state', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'deck.json');
    const actionPath = join(dir, 'actions', 'turn-001.deck.json');
    const resultPath = join(dir, 'results', 'turn-001.deck-result.json');
    await mkdir(join(dir, 'actions'), { recursive: true });
    await writeFile(
      actionPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          turnId: 'turn-001',
          player: 'P1',
          actions: [{ type: 'moveToBuy' }, { type: 'endTurn' }]
        },
        null,
        2
      )}\n`
    );

    await runCli(['deck-turn', '--config', 'tests/fixtures/multi-player.yaml', '--state', statePath, '--seed', '1', '--actions', actionPath, '--result', resultPath], () => undefined);

    const result = JSON.parse(await readFile(resultPath, 'utf8')) as {
      before: string;
      after: string;
      drawnHand: string[];
      played: string[];
      bought: string[];
      produced: Record<string, number>;
    };
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as PersistedGame;
    const afterSnapshot = JSON.parse(await readFile(join(dir, result.after), 'utf8')) as PersistedGame;

    expect(result.before).toBe('snapshots/turn-001.before.deck.json');
    expect(result.after).toBe('snapshots/turn-001.after.deck.json');
    expect(result.drawnHand).toEqual(['copper']);
    expect(result.played).toEqual([]);
    expect(result.bought).toEqual([]);
    expect(result.produced).toEqual({ money: 1 });
    expect(saved.rngState).toBe(afterSnapshot.rngState);
    expect(saved.game.players[saved.game.activePlayer]?.id).toBe('P2');
    await expect(readFile(join(dir, result.before), 'utf8')).resolves.toContain('"schemaVersion": 1');
    await expect(readFile(join(dir, result.after), 'utf8')).resolves.toContain('"schemaVersion": 1');
  });

  it('plays recursively drawn actions before optionally trashing copper', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'deck.json');
    const actionPath = join(dir, 'actions', 'turn-008.deck.json');
    const resultPath = join(dir, 'results', 'turn-008.deck-result.json');
    await runCli(['legal-actions', '--config', 'game/deck.yaml', '--state', statePath, '--seed', '1', '--json'], () => undefined);
    const state = JSON.parse(await readFile(statePath, 'utf8')) as PersistedGame;
    const player = state.game.players[0]!;
    player.hand = ['ranging', 'copper'];
    player.draw = ['ranging'];
    player.discard = [];
    player.play = [];
    player.attributes = { ...state.game.config.setup.attributes };
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await mkdir(join(dir, 'actions'), { recursive: true });
    await writeFile(
      actionPath,
      `${JSON.stringify({
        schemaVersion: 1,
        turnId: 'turn-008',
        player: 'P1',
        actions: [
          { type: 'playAll' },
          { type: 'trashCardIfPresent', cardId: 'copper' },
          { type: 'moveToBuy' },
          { type: 'endTurn' }
        ]
      }, null, 2)}\n`
    );

    await runCli(['deck-turn', '--config', 'game/deck.yaml', '--state', statePath, '--actions', actionPath, '--result', resultPath], () => undefined);

    const result = JSON.parse(await readFile(resultPath, 'utf8')) as {
      played: string[];
      produced: Record<string, number>;
      actions: unknown[];
    };
    const after = JSON.parse(await readFile(statePath, 'utf8')) as PersistedGame;
    expect(result.played).toEqual(['ranging', 'ranging']);
    expect(result.produced).toEqual({ archerRange: 2 });
    expect(result.actions).toEqual([
      { type: 'playAction', handIndex: 0 },
      { type: 'playAction', handIndex: 1 },
      { type: 'trashCard', handIndex: 0 },
      { type: 'moveToBuy' },
      { type: 'endTurn' }
    ]);
    expect(after.game.trash).toEqual(['copper']);
  });

  it('prints human-readable legal actions without the JSON flag', async () => {
    const dir = await makeTempDir();
    const output: string[] = [];

    await runCli(['legal-actions', '--config', 'tests/fixtures/multi-player.yaml', '--state', join(dir, 'deck.json'), '--seed', '1'], (line) =>
      output.push(line)
    );

    expect(output.join('\n')).toContain('Active: P1');
    expect(output.join('\n')).toContain('Move to buy phase');
  });

  it('rejects non-terminal structured deck turns', async () => {
    const dir = await makeTempDir();
    const actionPath = join(dir, 'turn-001.deck.json');
    await writeFile(
      actionPath,
      `${JSON.stringify({ schemaVersion: 1, turnId: 'turn-001', player: 'P1', actions: [{ type: 'moveToBuy' }] }, null, 2)}\n`
    );

    await expect(
      runCli(
        ['deck-turn', '--config', 'tests/fixtures/multi-player.yaml', '--state', join(dir, 'deck.json'), '--seed', '1', '--actions', actionPath, '--result', join(dir, 'result.json')],
        () => undefined
      )
    ).rejects.toThrow('deck actions did not complete');
  });

  it('rejects structured deck turns for the wrong active player', async () => {
    const dir = await makeTempDir();
    const actionPath = join(dir, 'turn-001.deck.json');
    await writeFile(
      actionPath,
      `${JSON.stringify({ schemaVersion: 1, turnId: 'turn-001', player: 'P2', actions: [{ type: 'moveToBuy' }, { type: 'endTurn' }] }, null, 2)}\n`
    );

    await expect(
      runCli(
        ['deck-turn', '--config', 'tests/fixtures/multi-player.yaml', '--state', join(dir, 'deck.json'), '--seed', '1', '--actions', actionPath, '--result', join(dir, 'result.json')],
        () => undefined
      )
    ).rejects.toThrow('expected P2');
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckfront-structured-'));
  tempDirs.push(dir);
  return dir;
}
