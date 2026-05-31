import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckbuild-cli-'));
  tempDirs.push(dir);
  return dir;
}
