import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHexdeckServer, type HexdeckServer } from '../src/server/httpServer';

interface RunningServer {
  app: HexdeckServer;
  baseUrl: string;
  dataDirectory: string;
  traceDirectory: string;
}

const running: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map(async ({ app, dataDirectory }) => {
    await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDirectory, { recursive: true, force: true });
  }));
});

async function startServer(): Promise<RunningServer> {
  const projectRoot = path.resolve('.');
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'hexdeck-http-'));
  const traceDirectory = path.join(dataDirectory, 'traces');
  const app = createHexdeckServer({
    dataDirectory,
    strategyDirectory: path.join(projectRoot, 'strategies'),
    distDirectory: path.join(projectRoot, 'dist'),
    ai: {
      projectRoot, traceDirectory, model: 'openai:gpt-5.6-luna', effort: 'low', timeoutMilliseconds: 30_000, fakeModel: true
    }
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server has no address.');
  const result = { app, baseUrl: `http://127.0.0.1:${address.port}`, dataDirectory, traceDirectory };
  running.push(result);
  return result;
}

async function createGame(baseUrl: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seed: 11, strategyPresetId: 'direct-force', strategyMarkdown: '# Test' })
  });
  expect(response.status).toBe(201);
  return await response.json() as Record<string, unknown>;
}

describe('real HTTP API boundaries', () => {
  it('rejects AI start during preview without a runner trace, then starts after confirmation', async () => {
    const { app, baseUrl, dataDirectory, traceDirectory } = await startServer();
    const created = await createGame(baseUrl);
    const id = created.id as string;
    const action = (created.legalActions as Array<{ id: string; command: { type: string } }>).find((candidate) => candidate.command.type === 'baselineMove')!;
    const previewResponse = await fetch(`${baseUrl}/api/games/${id}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, actionId: action.id })
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { revision: number };
    const beforeAiStart = await app.service.getRecord(id);
    const blocked = await fetch(`${baseUrl}/api/games/${id}/ai-turn`, { method: 'POST' });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: 'Confirm or undo the human action preview before starting the AI.' });
    expect(await app.service.getRecord(id)).toEqual(beforeAiStart);
    await expect(readFile(path.join(traceDirectory, id, `${preview.revision}.json`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(path.join(dataDirectory, `${id}.json`), 'utf8'))).toEqual(beforeAiStart);

    const confirm = await fetch(`${baseUrl}/api/games/${id}/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: preview.revision })
    });
    expect(confirm.status).toBe(200);
    const started = await fetch(`${baseUrl}/api/games/${id}/ai-turn`, { method: 'POST' });
    expect(started.status).toBe(202);
    await expect.poll(async () => {
      const response = await fetch(`${baseUrl}/api/games/${id}/ai-turn`);
      return ((await response.json()) as { status: string }).status;
    }).toBe('complete');
    const trace = JSON.parse(await readFile(path.join(traceDirectory, id, '2.json'), 'utf8')) as Record<string, unknown>;
    expect(trace.status).toBe('complete');
    expect(trace.serverOutcome).toEqual({ status: 'complete', committedRevision: 3 });
  });

  it('returns exact errors, redacts private cards, and serializes stale concurrent previews', async () => {
    const { app, baseUrl } = await startServer();
    const invalidJson = await fetch(`${baseUrl}/api/games`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{'
    });
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Request body must be valid JSON.' });
    const missing = await fetch(`${baseUrl}/api/games/00000000-0000-0000-0000-000000000000`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Game not found: 00000000-0000-0000-0000-000000000000' });

    const created = await createGame(baseUrl);
    const id = created.id as string;
    const action = (created.legalActions as Array<{ id: string }>)[0]!;
    const request = () => fetch(`${baseUrl}/api/games/${id}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, actionId: action.id })
    });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const record = await app.service.getRecord(id);
    expect(record.revision).toBe(1);
    expect(record.draft.command).not.toBeNull();

    const redacted = await fetch(`${baseUrl}/api/games/${id}/export?redacted=1`);
    expect(redacted.status).toBe(200);
    expect(redacted.headers.get('content-disposition')).toContain('-redacted.json');
    const body = await redacted.text();
    for (const card of record.state.players[record.aiPlayerId].deck.hand) expect(body).not.toContain(card.id);
    expect(JSON.parse(body)).toMatchObject({ schemaVersion: 2, game: { players: { indigo: { hand: null } } } });
  });
});
