import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { VARIABLE_ACTION_IDS } from '../src/game';
import type { AiTrainer } from '../src/server/aiTrainer';
import { createHexdeckServer } from '../src/server/httpServer';
import type { GameUpdateView, GameView } from '../src/shared/api';
import rawBalanceSuite from '../src/sim/balance-suite-manifest.json' with { type: 'json' };
import { fixedBuyPlan } from '../src/sim/strategy';
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
const TEST_MARKET = ['cull','footwork','feint','drive','aim','volley','muster','prism','reclaim','starfire'];
async function create(base: string, body: Record<string, unknown> = {}) {
  return fetch(`${base}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed: 2, mode: 'local', variableCardIds: TEST_MARKET, startingDraftEnabled: true, ...body }) });
}
describe('local game HTTP interface', () => {
  it('reports server health', async () => {
    const { base } = await server(); const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
  it('serves the setup catalog with fixed and variable cards separated', async () => {
    const { base } = await server(); const response = await fetch(`${base}/api/setup`);
    const setup = await response.json() as { fixedCardIds: string[]; variableCardIds: string[]; trainedVariableCardSets: string[][]; cards: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(setup.fixedCardIds).toEqual(['copper', 'silver', 'gold', 'step', 'focus']);
    expect(setup.variableCardIds).toContain('footwork'); expect(setup.variableCardIds).not.toContain('step');
    expect(Object.keys(setup.cards)).toContain('starfire');
    expect(setup.trainedVariableCardSets.map((cards) => [...cards].sort().join('|'))).toEqual(
      rawBalanceSuite.kingdoms.map((kingdom) => kingdom.actionPiles.map((pile) => pile.cardId).sort().join('|'))
    );
    expect(setup.trainedVariableCardSets).toHaveLength(160);
    expect(new Set(setup.trainedVariableCardSets.map((cards) => [...cards].sort().join('|'))).size).toBe(160);
    expect(setup.trainedVariableCardSets.every((cards) => cards.length === 10 && new Set(cards).size === 10
      && cards.every((cardId) => setup.variableCardIds.includes(cardId)))).toBe(true);
  });
  it('creates a game and accepts both sequential builds', async () => {
    const { base } = await server(); const createdResponse = await create(base); expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as GameUpdateView;
    expect(created).toMatchObject({ schemaVersion: 15, activePlayerId: 'ochre', aiDifficulty: null, presentation: { frames: [] } });
    const playerOne = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, definitionIds: ['footwork'], complete: true }) }).then((response) => response.json()) as { revision: number; activePlayerId: string; phase: string };
    expect(playerOne).toMatchObject({ activePlayerId: 'indigo', phase: 'startingBuild' });
    const playerTwo = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: playerOne.revision, definitionIds: ['aim'], complete: true }) }).then((response) => response.json()) as { phase: string; completedBuilds: Record<string, string[]> };
    expect(playerTwo.phase).toBe('action'); expect(playerTwo.completedBuilds).toEqual({ ochre: ['footwork'], indigo: ['aim'] });
    const loaded = await fetch(`${base}/api/games/${created.id}`).then((response) => response.json()) as Record<string, unknown>;
    expect(loaded).not.toHaveProperty('presentation');
  });
  it('defaults an omitted draft setting to off in direct API requests', async () => {
    const { base } = await server();
    const response = await fetch(`${base}/api/games`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 2, mode: 'local', variableCardIds: TEST_MARKET })
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ startingDraftEnabled: false, phase: 'action', turn: 1 });
  });
  it('accepts the strict draft toggle and starts draft-off without build endpoints', async () => {
    const { base } = await server(); const response = await create(base,{ startingDraftEnabled:false }); expect(response.status).toBe(201);
    const view = await response.json() as GameView; expect(view).toMatchObject({ startingDraftEnabled:false, phase:'action', turn:1 });
    expect(view.players.ochre.deckCounts).toEqual({ copper:7, scrap:3 }); expect(view.cards.scrap).toBeDefined();
    const build = await fetch(`${base}/api/games/${view.id}/build`,{ method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ expectedRevision:view.revision, definitionIds:[], complete:true }) });
    expect(build.status).toBe(403);
  });
  it('returns a specific old-save schema error', async () => {
    const { base, games } = await server(); const id = '11111111-1111-4111-8111-111111111111'; await mkdir(games, { recursive: true }); await writeFile(path.join(games, `${id}.json`), JSON.stringify({ schemaVersion: 14 }));
    const response = await fetch(`${base}/api/games/${id}`); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Saved game schema 14 is not supported. Start a new game.' });
  });
  it('rejects malformed random markets and unknown create-game fields', async () => {
    const { base } = await server();
    for (const body of [
      { removedField: true },
      { mode: 'ai', humanPlayerId: 'ochre', aiDifficulty: 'impossible' },
      { aiDifficulty: 'easy' },
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
    const strategy = { id: 'http-ai', startingBuild: [], buyPlan: fixedBuyPlan([
      { kind: 'buy' as const, cardId: 'silver', desiredCount: 99 }
    ]) };
    const aiTrainer: AiTrainer = { train: async () => ({ strategy, summary: { elapsedMs: 1, matches: 1, strategyId: strategy.id } }) };
    const { base } = await server(aiTrainer);
    const created = await (await create(base, { mode: 'ai', humanPlayerId: 'ochre', aiDifficulty: 'normal', startingDraftEnabled: true })).json() as GameView;
    expect(created).toMatchObject({ aiDifficulty: 'normal', startingDraftEnabled: false, phase: 'action' });
    let view = created;
    for (const kind of ['endAction', 'endBuy'] as const) {
      const actionId = view.actions.phases.find((action) => action.kind === kind)!.id;
      view = await fetch(`${base}/api/games/${created.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: view.revision, actionId }) }).then((response) => response.json()) as GameView;
    }
    expect(view.events.some((event) => event.playerId === 'indigo' && event.type === 'purchase' && event.detail.definitionId === 'silver')).toBe(true);
    expect(JSON.stringify(view.events)).not.toMatch(/cardInstanceId|recoverInstanceId|discardInstanceId|drawOrder|"hand"/);
  });
  it('returns a selection-specific 503 and saves nothing for an untrained kingdom', async () => {
    const { base, games } = await server();
    const response = await fetch(`${base}/api/games`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 2, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: VARIABLE_ACTION_IDS.slice(0, 10) })
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'This kingdom has no pretrained AI opponent.' });
    expect(await readdir(games).catch(() => [])).toEqual([]);
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
    const exported = await fetch(`${base}/api/games/${created.id}/export`).then((response) => response.json()) as Record<string, unknown>; expect(exported.schemaVersion).toBe(15); expect(JSON.stringify(exported)).not.toMatch(/committedCommands|"command"/);
  });
  it('exposes a revision-locked reset endpoint for the persisted game', async () => {
    const { base } = await server(); const created = await (await create(base, { startingDraftEnabled: false })).json() as GameView;
    const buy = await fetch(`${base}/api/games/${created.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, actionId: created.actions.phases.find((action) => action.kind === 'endAction')!.id }) }).then((response) => response.json()) as GameView;
    const response = await fetch(`${base}/api/games/${created.id}/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: buy.revision }) });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ id: created.id, revision: buy.revision + 1, turn: 1, phase: 'action', completedActions: 0, canUndo: false });
    const stale = await fetch(`${base}/api/games/${created.id}/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: buy.revision }) });
    expect(stale.status).toBe(409);
  });
});
