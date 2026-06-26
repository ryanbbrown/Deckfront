import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';
import type { PersistedGame } from '../../src/cli/persistence';

const tempDirs: string[] = [];

describe('CLI state persistence', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('saves after accepted actions and resumes from the saved state', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'deck.json');
    const firstScriptPath = join(dir, 'first.script');
    const secondScriptPath = join(dir, 'second.script');
    await writeFile(firstScriptPath, '1\n');
    await writeFile(secondScriptPath, '2\n1\n1\n');

    const interrupted = await runCli(
      ['--config', 'tests/fixtures/multi-player.yaml', '--script', firstScriptPath, '--seed', '1', '--state', statePath, '--max-actions', '1'],
      () => undefined
    );
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as PersistedGame;

    expect(interrupted.phase).toBe('buy');
    expect(saved.game.phase).toBe('buy');
    expect(saved.game.activePlayer).toBe(0);

    const resumed = await runCli(
      ['--config', 'tests/fixtures/multi-player.yaml', '--script', secondScriptPath, '--seed', '999', '--state', statePath],
      () => undefined
    );
    const uninterrupted = await runCli(
      ['--config', 'tests/fixtures/multi-player.yaml', '--script', 'tests/fixtures/multi-player.script', '--seed', '1'],
      () => undefined
    );

    expect(resumed).toEqual(uninterrupted);
  });

  it('applies starting deck overrides only when creating a new state', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'deck.json');

    await runCli(
      [
        '--config',
        'tests/fixtures/multi-player.yaml',
        '--seed',
        '1',
        '--state',
        statePath,
        '--max-actions',
        '0',
        '--starting-deck',
        'P1=copper,copper,province',
        '--starting-deck',
        'P2=copper,estate,estate'
      ],
      () => undefined
    );

    const saved = JSON.parse(await readFile(statePath, 'utf8')) as PersistedGame;
    const playerOneCards = [...saved.game.players[0]!.hand, ...saved.game.players[0]!.draw].sort();
    const playerTwoCards = [...saved.game.players[1]!.hand, ...saved.game.players[1]!.draw].sort();

    expect(playerOneCards).toEqual(['copper', 'copper', 'province']);
    expect(playerTwoCards).toEqual(['copper', 'estate', 'estate']);
  });

  it('applies draft overrides as seven copper plus budgeted cards', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'deck.json');

    await runCli(
      [
        '--config',
        'tests/fixtures/multi-player.yaml',
        '--seed',
        '1',
        '--state',
        statePath,
        '--max-actions',
        '0',
        '--draft',
        'P1=province',
        '--draft',
        'P2=estate'
      ],
      () => undefined
    );

    const saved = JSON.parse(await readFile(statePath, 'utf8')) as PersistedGame;
    const playerOneCards = [...saved.game.players[0]!.hand, ...saved.game.players[0]!.draw].sort();
    const playerTwoCards = [...saved.game.players[1]!.hand, ...saved.game.players[1]!.draw].sort();

    expect(playerOneCards).toEqual(['copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'province']);
    expect(playerTwoCards).toEqual(['copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'estate']);
    expect(saved.game.players[0]!.money).toBe(4);
    expect(saved.game.players[0]!.draftCarryoverMoney).toBeUndefined();
    expect(saved.game.players[1]!.money).toBe(0);
    expect(saved.game.players[1]!.draftCarryoverMoney).toBe(12);
  });

  it('spends draft carryover on the drafted player first turn only', async () => {
    const dir = await makeTempDir();
    const statePath = join(dir, 'deck.json');
    const actionPath = join(dir, 'actions', 'turn-001.deck.json');
    const resultPath = join(dir, 'results', 'turn-001.deck-result.json');
    await mkdir(join(dir, 'actions'), { recursive: true });
    await writeFile(
      actionPath,
      `${JSON.stringify({ schemaVersion: 1, turnId: 'turn-001', player: 'P1', actions: [{ type: 'moveToBuy' }, { type: 'endTurn' }] }, null, 2)}\n`
    );

    await runCli(
      [
        'deck-turn',
        '--config',
        'tests/fixtures/multi-player.yaml',
        '--seed',
        '1',
        '--state',
        statePath,
        '--draft',
        'P1=province',
        '--draft',
        'P2=estate',
        '--actions',
        actionPath,
        '--result',
        resultPath
      ],
      () => undefined
    );

    const saved = JSON.parse(await readFile(statePath, 'utf8')) as PersistedGame;

    expect(saved.game.players[1]!.money).toBe(12);
    expect(saved.game.players[1]!.draftCarryoverMoney).toBeUndefined();
  });

  it('rejects drafts over the 12-coin budget', async () => {
    const dir = await makeTempDir();

    await expect(
      runCli(
        [
          '--config',
          'tests/fixtures/multi-player.yaml',
          '--seed',
          '1',
          '--state',
          join(dir, 'deck.json'),
          '--max-actions',
          '0',
          '--draft',
          'P1=province,province'
        ],
        () => undefined
      )
    ).rejects.toThrow('exceeding budget 12');
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckfront-'));
  tempDirs.push(dir);
  return dir;
}
