import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cloneGame, createGame } from '../src/game';
import { ThinHarnessAiRunner } from '../src/server/aiRunner';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';
import { clearHand, giveCard, setPosition } from './helpers';

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
  const model = process.env.HEXDECK_AI_MODEL ?? 'openai:gpt-5.6-terra';
  const effort = process.env.HEXDECK_AI_EFFORT ?? 'medium';
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

liveIt('attacks from the observed non-opening position instead of buying immediately', async () => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the live AI tactical test.');
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'hexdeck-live-ai-'));
  const repository = new FileGameRepository(path.join(temporaryDirectory, 'games'));
  const model = process.env.HEXDECK_AI_MODEL ?? 'openai:gpt-5.6-terra';
  const effort = process.env.HEXDECK_AI_EFFORT ?? 'medium';
  const service = new GameService(repository, { model, effort });
  const strategy = await readFile(path.join(projectRoot, 'strategies/direct-force.md'), 'utf8');
  const created = await service.create({
    seed: seedForIndigo(),
    strategyPresetId: 'direct-force',
    strategyMarkdown: strategy
  });
  const record = await service.getRecord(created.id);
  const state = record.state;
  state.players.indigo.turnsTaken = 2;
  clearHand(state, 'indigo');
  for (const cardId of ['brace', 'copper', 'dash', 'shove', 'copper']) giveCard(state, cardId, 'indigo');
  setPosition(state, 'ochre-a', { q: 0, r: -1 });
  setPosition(state, 'ochre-b', { q: 0, r: 0 });
  setPosition(state, 'indigo-a', { q: 2, r: -2 });
  setPosition(state, 'indigo-b', { q: 1, r: 0 });
  state.pieces['ochre-a'].braced = true;
  state.pieces['ochre-b'].braced = false;
  state.pieces['indigo-a'].braced = false;
  state.pieces['indigo-b'].braced = false;
  record.initialState = cloneGame(state);
  record.committedState = cloneGame(state);
  record.draft = { baseVersion: state.version, baseState: cloneGame(state), commands: [] };
  await repository.save(record);

  const runner = new ThinHarnessAiRunner({
    projectRoot,
    traceDirectory: path.join(temporaryDirectory, 'traces'),
    model,
    effort,
    timeoutMilliseconds: 240_000
  });
  const result = await runner.run(record);

  expect(result.commands.some((command) => command.type === 'playShove')).toBe(true);
  expect(result.commands.some((command) => command.type === 'baselineMove')).toBe(true);
}, 300_000);

function seedForIndigo(): number {
  for (let seed = 0; seed < 10_000; seed += 1) {
    if (createGame(seed).activePlayerId === 'indigo') return seed;
  }
  throw new Error('Could not find an Indigo-first seed.');
}
