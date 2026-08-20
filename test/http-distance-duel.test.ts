import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { VARIABLE_ACTION_IDS } from '../src/game';
import { ProductionAiTrainer } from '../src/server/aiTrainer';
import type { AiTrainer } from '../src/server/aiTrainer';
import { createHexdeckServer } from '../src/server/httpServer';
import type { GameView } from '../src/shared/api';
import type { PairingRunner } from '../src/sim/pairingRunner';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });
async function server(aiTrainer?: AiTrainer) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-http-')); const games = path.join(directory, 'games');
  const app = createHexdeckServer({ dataDirectory: games, distDirectory: path.join(root, 'dist'), aiTrainer });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  cleanups.push(async () => { await new Promise<void>((resolve) => app.server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, games };
}
async function create(base: string, body: Record<string, unknown> = {}) {
  return fetch(`${base}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed: 2, mode: 'local', variableCardIds: VARIABLE_ACTION_IDS.slice(0, 10), ...body }) });
}
describe('local game HTTP interface', () => {
  it('serves the setup catalog with fixed and variable cards separated', async () => {
    const { base } = await server(); const response = await fetch(`${base}/api/setup`);
    const setup = await response.json() as { fixedCardIds: string[]; variableCardIds: string[]; cards: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(setup.fixedCardIds).toEqual(['copper', 'silver', 'gold', 'step', 'cull', 'focus']);
    expect(setup.variableCardIds).toContain('footwork'); expect(setup.variableCardIds).not.toContain('step');
    expect(Object.keys(setup.cards)).toContain('starfire');
  });
  it('creates a game and accepts both sequential builds', async () => {
    const { base } = await server(); const createdResponse = await create(base); expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string; revision: number; schemaVersion: number; activePlayerId: string };
    expect(created).toMatchObject({ schemaVersion: 11, activePlayerId: 'ochre' });
    const playerOne = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, definitionIds: ['footwork'], complete: true }) }).then((response) => response.json()) as { revision: number; activePlayerId: string; phase: string };
    expect(playerOne).toMatchObject({ activePlayerId: 'indigo', phase: 'startingBuild' });
    const playerTwo = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: playerOne.revision, definitionIds: ['aim'], complete: true }) }).then((response) => response.json()) as { phase: string; completedBuilds: Record<string, string[]> };
    expect(playerTwo.phase).toBe('action'); expect(playerTwo.completedBuilds).toEqual({ ochre: ['footwork'], indigo: ['aim'] });
  });
  it('returns a specific old-save schema error', async () => {
    const { base, games } = await server(); const id = '11111111-1111-4111-8111-111111111111'; await mkdir(games, { recursive: true }); await writeFile(path.join(games, `${id}.json`), JSON.stringify({ schemaVersion: 10 }));
    const response = await fetch(`${base}/api/games/${id}`); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Saved game schema 10 is not supported. Start a new game.' });
  });
  it('rejects malformed random markets and unknown create-game fields', async () => {
    const { base } = await server();
    for (const body of [
      { removedField: true },
      { variableCardIds: VARIABLE_ACTION_IDS.slice(0, 9) },
      { variableCardIds: [...VARIABLE_ACTION_IDS.slice(0, 9), VARIABLE_ACTION_IDS[0]] },
      { variableCardIds: [...VARIABLE_ACTION_IDS.slice(0, 9), 'step'] },
      { variableCardIds: [...VARIABLE_ACTION_IDS.slice(0, 9), 'copper'] },
      { variableCardIds: [...VARIABLE_ACTION_IDS.slice(0, 9), 'invented-card'] }
    ]) {
      const response = await create(base, body); expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid request.' });
    }
  });
  it('returns public AI action events without hidden log details', async () => {
    const strategy = { id: 'http-ai', startingBuild: [], buyAgenda: [], repeatPurchase: 'silver' };
    const aiTrainer: AiTrainer = { train: async () => ({ strategy, summary: { elapsedMs: 1, matches: 1, strategyId: strategy.id } }) };
    const { base } = await server(aiTrainer);
    const created = await (await create(base, { mode: 'ai', humanPlayerId: 'ochre' })).json() as GameView;
    let view = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, definitionIds: [], complete: true }) }).then((response) => response.json()) as GameView;
    for (const kind of ['endAction', 'endBuy'] as const) {
      const actionId = view.actions.phases.find((action) => action.kind === kind)!.id;
      view = await fetch(`${base}/api/games/${created.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: view.revision, actionId }) }).then((response) => response.json()) as GameView;
    }
    expect(view.events.some((event) => event.playerId === 'indigo' && event.type === 'purchase' && event.detail.definitionId === 'silver')).toBe(true);
    expect(JSON.stringify(view.events)).not.toMatch(/cardInstanceId|recoverInstanceId|discardInstanceId|drawOrder|"hand"/);
  });
  it('returns a training-specific 503 and saves nothing after an unexpected production search failure', async () => {
    let closed = false;
    const runner: PairingRunner = {
      run: async () => { throw new Error('runner should not receive work'); },
      close: async () => { closed = true; }
    };
    const trainer = new ProductionAiTrainer({
      restarts: 1, initialStrategies: 2, candidates: 2, iterations: 1,
      seeds: 1, unionIterations: 1, workers: 1, deadlineMinutes: 1, finalSearch: 'none'
    }, {
      createRunner: () => runner,
      runSearch: async () => { throw new Error('unexpected search failure'); }
    });
    const { base, games } = await server(trainer);
    const response = await fetch(`${base}/api/games`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 2, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: VARIABLE_ACTION_IDS.slice(0, 10) })
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'AI training failed: unexpected search failure' });
    expect(closed).toBe(true); expect(await readdir(games).catch(() => [])).toEqual([]);
  });
  it('returns 400 for an unknown build card without changing revision or proposal', async () => {
    const { base } = await server(); const created = await (await create(base)).json() as { id: string; revision: number; buildProposal: string[] };
    const bad = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, definitionIds: ['invented-card'], complete: false }) }); expect(bad.status).toBe(400);
    const after = await fetch(`${base}/api/games/${created.id}`).then((response) => response.json()) as { revision: number; buildProposal: string[] }; expect(after.revision).toBe(created.revision); expect(after.buildProposal).toEqual([]);
  });
  it('revision-locks build updates and exports the local game view', async () => {
    const { base } = await server(); const created = await (await create(base)).json() as { id: string; revision: number };
    const edit = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, definitionIds: ['feint'], complete: false }) }); expect(edit.status).toBe(200);
    const stale = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, definitionIds: [], complete: false }) }); expect(stale.status).toBe(409);
    const exported = await fetch(`${base}/api/games/${created.id}/export`).then((response) => response.json()) as Record<string, unknown>; expect(exported.schemaVersion).toBe(11); expect(JSON.stringify(exported)).not.toMatch(/committedCommands|"command"/);
  });
});
