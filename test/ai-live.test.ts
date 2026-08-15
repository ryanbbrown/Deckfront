import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cloneGame, listLegalActions } from '../src/game';
import { ThinHarnessAiRunner } from '../src/server/aiRunner';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5 })));
});

it.skipIf(process.env.HEXDECK_LIVE_AI !== '1')('real cproxy returns and commits exactly one listed Luna action ID', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-live-ai-'));
  directories.push(directory);
  const repository = new FileGameRepository(path.join(directory, 'games'));
  const service = new GameService(repository, { model: 'openai:gpt-5.6-luna', effort: 'low' });
  const view = await service.create({ seed: 11, strategyPresetId: 'direct-force', strategyMarkdown: '# Push toward the edge.' });
  const record = await repository.load(view.id);
  record.state.activePlayerId = record.aiPlayerId;
  record.initialState = cloneGame(record.state);
  record.committedState = cloneGame(record.state);
  record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), command: null };
  await repository.save(record);
  const listed = new Set(listLegalActions(record.state).map((action) => action.id));
  const runner = new ThinHarnessAiRunner({
    projectRoot: process.cwd(), traceDirectory: path.join(directory, 'traces'),
    model: 'openai:gpt-5.6-luna', effort: 'low', timeoutMilliseconds: 240_000
  });
  const result = await runner.run(record);
  expect(listed.has(result.actionId)).toBe(true);
  expect(result.baseRevision).toBe(record.revision);
  const committed = await service.commitAiAction(view.id, result.baseRevision, result.actionId, result.summary, result.durationSeconds);
  expect(committed.revision).toBe(1);
  expect((await repository.load(view.id)).committedCommands).toHaveLength(1);
}, 300_000);
