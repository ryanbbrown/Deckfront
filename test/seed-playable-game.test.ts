import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { kingdomOf } from '../src/game';
import { FileGameRepository } from '../src/server/persistence';
import { INFINITE_COUNT, fixedBuyPlan, identify } from '../src/sim/strategy';

const execute = promisify(execFile);

describe('playable-game seed script', () => {
  it('writes a schema-14 draft record that passes repository validation', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-seed-script-'));
    try {
      const games = path.join(directory, 'games');
      const source = path.join(directory, 'source.json');
      const aiStrategy = identify({
        id: '', startingBuild: [],
        buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'silver', desiredCount: INFINITE_COUNT }])
      });
      await writeFile(source, JSON.stringify({
        kingdom: kingdomOf('current-duel'), aiStrategy,
        training: { elapsedMs: 1, matches: 2, strategyId: aiStrategy.id }
      }));
      const { stdout } = await execute(path.resolve('node_modules/.bin/tsx'), [
        'scripts/seed_playable_game.ts', '--from', source, '--data', games, '--url', 'http://example.test'
      ], { cwd: path.resolve('.') });
      const files = await readdir(games);
      expect(files).toHaveLength(1);
      const id = files[0]!.replace(/\.json$/, '');
      const record = await new FileGameRepository(games).load(id);
      expect(record.schemaVersion).toBe(14);
      expect(record.startingDraftEnabled).toBe(true);
      expect(record.initialState.startingDraftEnabled).toBe(true);
      expect(record.state.startingDraftEnabled).toBe(true);
      expect(stdout).toContain(`http://example.test/rematch.html?game=${id}`);
      expect(JSON.parse(await readFile(path.join(games, files[0]!), 'utf8'))).toEqual(record);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
