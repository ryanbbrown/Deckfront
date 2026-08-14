import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createGame } from '../src/game';
import { ThinHarnessAiRunner } from '../src/server/aiRunner';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';

const projectRoot = path.resolve(import.meta.dirname, '..');
const liveIt = process.env.HEXDECK_LIVE_AI === '1' ? it : it.skip;
let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = '';
});

liveIt('completes one real ThinHarness turn and commits its exact command transaction', async () => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the live AI smoke test.');
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'hexdeck-live-ai-'));
  const repository = new FileGameRepository(path.join(temporaryDirectory, 'games'));
  const model = process.env.HEXDECK_AI_MODEL ?? 'openai:gpt-5.6-luna';
  const effort = process.env.HEXDECK_AI_EFFORT ?? 'low';
  const service = new GameService(repository, { model, effort });
  const strategy = await readFile(path.join(projectRoot, 'strategies/direct-force.md'), 'utf8');
  const created = await service.create({
    seed: seedForIndigo(),
    strategyPresetId: 'direct-force',
    strategyMarkdown: strategy
  });
  const record = await service.getRecord(created.id);
  const runner = new ThinHarnessAiRunner({
    projectRoot,
    traceDirectory: path.join(temporaryDirectory, 'traces'),
    model,
    effort,
    timeoutMilliseconds: 240_000
  });

  const result = await runner.run(record);
  const committed = await service.commitAiTurn(
    record.id,
    result.baseRevision,
    result.commands,
    result.summary,
    result.durationSeconds
  );
  expect(committed.activePlayerId).toBe('ochre');
  expect(committed.revision).toBe(1);
  expect(committed.lastAiSummary).toBe(result.summary);
}, 300_000);

function seedForIndigo(): number {
  for (let seed = 0; seed < 10_000; seed += 1) {
    if (createGame(seed).activePlayerId === 'indigo') return seed;
  }
  throw new Error('Could not find an Indigo-first seed.');
}
