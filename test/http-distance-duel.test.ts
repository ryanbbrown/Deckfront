import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { VARIABLE_ACTION_IDS, kingdomOf, resetKingdoms } from '../src/game';
import type { AiTrainer } from '../src/server/aiTrainer';
import { createHexdeckServer } from '../src/server/httpServer';
import type { GameUpdateView, GameView } from '../src/shared/api';
import rawBalanceSuite from '../src/sim/balance-suite-manifest.json' with { type: 'json' };
import { fixedBuyPlan } from '../src/sim/strategy';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); resetKingdoms(); });
async function server(aiTrainer?: AiTrainer, gameExportToken?: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-http-')); const games = path.join(directory, 'games');
  const app = createHexdeckServer({ dataDirectory: games, distDirectory: path.join(root, 'dist'), aiTrainer, gameExportToken });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  cleanups.push(async () => { await new Promise<void>((resolve) => app.server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, games };
}
const TEST_MARKET = ['cull','footwork','feint','drive','aim','volley','muster','prism','reclaim','starfire'];
async function writeStatisticsRecord(games: string, input: {
  id?: string; seriesId?: string; attemptNumber?: number; previousAttemptId?: string | null; nextAttemptId?: string | null;
  schemaVersion?: number; mode?: 'local' | 'ai'; aiDifficulty?: unknown; humanPlayerId?: 'ochre' | 'indigo' | null;
  finishedAt?: string | null; winner?: 'ochre' | 'indigo' | null; fileName?: string;
} = {}): Promise<string> {
  const id = input.id ?? randomUUID(); const attemptNumber = input.attemptNumber ?? 1;
  await mkdir(games, { recursive: true });
  await writeFile(path.join(games, input.fileName ?? `${id}.json`), JSON.stringify({
    schemaVersion: input.schemaVersion ?? 16, id, seriesId: input.seriesId ?? id, attemptNumber,
    previousAttemptId: input.previousAttemptId ?? (attemptNumber === 1 ? null : randomUUID()), nextAttemptId: input.nextAttemptId ?? null,
    mode: input.mode ?? 'ai', aiDifficulty: input.aiDifficulty === undefined ? 'expert' : input.aiDifficulty,
    humanPlayerId: input.humanPlayerId === undefined ? 'ochre' : input.humanPlayerId,
    finishedAt: input.finishedAt === undefined ? '2026-01-01T00:00:00.000Z' : input.finishedAt,
    state: { winner: input.winner === undefined ? 'ochre' : input.winner },
    kingdom: { id: 'statistics-must-not-register', name: 'Statistics only', startingHealth: 50, actionPiles: [] }
  }));
  return id;
}
async function create(base: string, body: Record<string, unknown> = {}) {
  return fetch(`${base}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed: 2, mode: 'local', variableCardIds: TEST_MARKET, startingDraftEnabled: true, ...body }) });
}
describe('local game HTTP interface', () => {
  it('reports server health', async () => {
    const { base } = await server(); const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
  it('requires a bearer token and streams every raw saved record', async () => {
    const disabled = await server();
    expect((await fetch(`${disabled.base}/api/admin/games/export`)).status).toBe(404);

    const token = 'test-game-export-token';
    const { base, games } = await server(undefined, token);
    const created = await (await create(base, { startingDraftEnabled: false })).json() as { id: string };
    const legacyId = '11111111-1111-4111-8111-111111111111';
    await writeFile(path.join(games, `${legacyId}.json`), JSON.stringify({ schemaVersion: 14, id: legacyId, legacy: true }));

    for (const authorization of [undefined, 'Basic credentials', 'Bearer wrong-token']) {
      const denied = await fetch(`${base}/api/admin/games/export`,
        authorization ? { headers: { authorization } } : undefined);
      expect(denied.status).toBe(401);
      expect(denied.headers.get('www-authenticate')).toBe('Bearer');
    }

    const response = await fetch(`${base}/api/admin/games/export`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="deckfront-game-records.ndjson"');
    const records = (await response.text()).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.map((record) => record.id)).toEqual([legacyId, created.id].sort());
    expect(records.find((record) => record.id === legacyId)).toEqual({ schemaVersion: 14, id: legacyId, legacy: true });
    expect(records.find((record) => record.id === created.id)).toHaveProperty('committedCommands');
  });
  it('serves every public route and the play route through the client app', async () => {
    const { base } = await server();
    for (const route of ['/', '/rules', '/about', '/play', '/play/42']) {
      const response = await fetch(`${base}${route}`);
      expect(response.status, route).toBe(200);
      expect(response.headers.get('content-type'), route).toBe('text/html; charset=utf-8');
      expect(await response.text(), route).toContain('<div id="root"></div>');
    }
  });
  it('serves card art with its JPEG body and one-day cache headers', async () => {
    const { base } = await server();
    const artPath = path.join(root, 'dist/card-art/drive.jpg');
    const response = await fetch(`${base}/card-art/drive.jpg`);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(['content-type', 'cache-control', 'last-modified'].map((name) => [name, response.headers.get(name)]))).toEqual({
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=86400',
      'last-modified': (await stat(artPath)).mtime.toUTCString()
    });
    expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(artPath));
  });
  it('returns no card-art body when If-Modified-Since matches', async () => {
    const { base } = await server();
    const lastModified = (await stat(path.join(root, 'dist/card-art/drive.jpg'))).mtime.toUTCString();
    const response = await fetch(`${base}/card-art/drive.jpg`, { headers: { 'if-modified-since': lastModified } });
    expect(response.status).toBe(304);
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(response.headers.get('last-modified')).toBe(lastModified);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });
  it('serves the setup catalog with fixed and variable cards separated', async () => {
    const { base } = await server(); const response = await fetch(`${base}/api/setup`);
    const setup = await response.json() as { fixedCardIds: string[]; variableCardIds: string[]; battlefields: Array<{ number: number; variableCardIds: string[] }>; cards: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(setup.fixedCardIds).toEqual(['copper', 'silver', 'gold', 'step', 'focus', 'scrap']);
    expect(setup.variableCardIds).toContain('footwork'); expect(setup.variableCardIds).not.toContain('step');
    expect(Object.keys(setup.cards)).toContain('starfire');
    expect(setup.battlefields.map((battlefield) => battlefield.number)).toEqual(Array.from({ length: 160 }, (_, index) => index + 1));
    expect(setup.battlefields.map((battlefield) => [...battlefield.variableCardIds].sort().join('|'))).toEqual(
      rawBalanceSuite.kingdoms.map((kingdom) => kingdom.actionPiles.map((pile) => pile.cardId).sort().join('|'))
    );
    expect(setup.battlefields).toHaveLength(160);
    expect(new Set(setup.battlefields.map((battlefield) => [...battlefield.variableCardIds].sort().join('|'))).size).toBe(160);
    expect(setup.battlefields.every((battlefield) => battlefield.variableCardIds.length === 10
      && new Set(battlefield.variableCardIds).size === 10
      && battlefield.variableCardIds.every((cardId) => setup.variableCardIds.includes(cardId)))).toBe(true);
  });
  it('creates a game and accepts both sequential builds', async () => {
    const { base } = await server(); const createdResponse = await create(base); expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as GameUpdateView;
    expect(created).toMatchObject({ schemaVersion: 16, seriesId: created.id, attemptNumber: 1, previousAttemptId: null, nextAttemptId: null, activePlayerId: 'ochre', aiDifficulty: null, presentation: { frames: [] } });
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
    const exported = await fetch(`${base}/api/games/${created.id}/export`).then((response) => response.json()) as Record<string, unknown>; expect(exported.schemaVersion).toBe(16); expect(JSON.stringify(exported)).not.toMatch(/committedCommands|"command"/);
  });
  it('returns exact ordered aggregate statistics and no game metadata', async () => {
    const { base, games } = await server();
    await writeStatisticsRecord(games, { aiDifficulty: 'easy', humanPlayerId: 'ochre', winner: 'ochre' });
    await writeStatisticsRecord(games, { aiDifficulty: 'normal', humanPlayerId: 'indigo', winner: 'ochre' });
    await writeStatisticsRecord(games, { aiDifficulty: 'hard', finishedAt: null, winner: null });
    await writeStatisticsRecord(games, { aiDifficulty: 'hard', winner: null });
    await writeStatisticsRecord(games, { mode: 'local', aiDifficulty: null, humanPlayerId: null });
    await writeStatisticsRecord(games, { schemaVersion: 14 });
    await writeStatisticsRecord(games, { schemaVersion: 15 });
    const response = await fetch(`${base}/api/stats`); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ difficulties: [
      { difficulty: 'easy', gamesPlayed: 1, humanWins: 1, aiWins: 0 },
      { difficulty: 'normal', gamesPlayed: 1, humanWins: 0, aiWins: 1 },
      { difficulty: 'hard', gamesPlayed: 0, humanWins: 0, aiWins: 0 },
      { difficulty: 'expert', gamesPlayed: 0, humanWins: 0, aiWins: 0 }
    ] });
    expect(JSON.stringify(body)).not.toMatch(/"(?:id|seriesId|attemptNumber|createdAt|updatedAt|finishedAt|kingdom|market|players|state)"/);
  });
  it('counts only the unique latest attempt in each series', async () => {
    const { base, games } = await server();
    const unfinishedSeries = randomUUID(); const unfinishedChild = randomUUID();
    await writeStatisticsRecord(games, { id: unfinishedSeries, seriesId: unfinishedSeries, nextAttemptId: unfinishedChild, aiDifficulty: 'easy' });
    await writeStatisticsRecord(games, { id: unfinishedChild, seriesId: unfinishedSeries, attemptNumber: 2, previousAttemptId: unfinishedSeries, finishedAt: null, winner: null, aiDifficulty: 'easy' });
    const completedSeries = randomUUID(); const second = randomUUID(); const third = randomUUID();
    await writeStatisticsRecord(games, { id: completedSeries, seriesId: completedSeries, nextAttemptId: second, aiDifficulty: 'expert', winner: 'ochre' });
    await writeStatisticsRecord(games, { id: second, seriesId: completedSeries, attemptNumber: 2, previousAttemptId: completedSeries, nextAttemptId: third, aiDifficulty: 'expert', winner: 'ochre' });
    await writeStatisticsRecord(games, { id: third, seriesId: completedSeries, attemptNumber: 3, previousAttemptId: second, aiDifficulty: 'expert', winner: 'indigo' });
    expect(await fetch(`${base}/api/stats`).then((response) => response.json())).toEqual({ difficulties: [
      { difficulty: 'easy', gamesPlayed: 0, humanWins: 0, aiWins: 0 },
      { difficulty: 'normal', gamesPlayed: 0, humanWins: 0, aiWins: 0 },
      { difficulty: 'hard', gamesPlayed: 0, humanWins: 0, aiWins: 0 },
      { difficulty: 'expert', gamesPlayed: 1, humanWins: 0, aiWins: 1 }
    ] });
  });
  it('rescans metadata-only files and fails malformed schema 16 data without affecting other routes', async () => {
    const { base, games } = await server();
    const empty = await fetch(`${base}/api/stats`).then((response) => response.json());
    expect(empty.difficulties.every((entry: { gamesPlayed: number }) => entry.gamesPlayed === 0)).toBe(true);
    await mkdir(games, { recursive: true });
    await writeFile(path.join(games, 'notes.json'), '{not json');
    await writeFile(path.join(games, `${randomUUID()}.json.tmp`), '{not json');
    await writeStatisticsRecord(games, { aiDifficulty: 'hard', humanPlayerId: 'indigo', winner: 'indigo' });
    resetKingdoms();
    const current = await fetch(`${base}/api/stats`).then((response) => response.json());
    expect(current.difficulties[2]).toEqual({ difficulty: 'hard', gamesPlayed: 1, humanWins: 1, aiWins: 0 });
    expect(() => kingdomOf('statistics-must-not-register')).toThrow();
    await writeStatisticsRecord(games, { aiDifficulty: 'invalid' });
    const malformed = await fetch(`${base}/api/stats`); expect(malformed.status).toBe(500);
    expect(await malformed.json()).toEqual({ error: 'Internal server error.' });
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
  it('exposes a revision-locked reset endpoint that returns a linked child game', async () => {
    const { base, games } = await server(); const created = await (await create(base, { startingDraftEnabled: false })).json() as GameView;
    const buy = await fetch(`${base}/api/games/${created.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, actionId: created.actions.phases.find((action) => action.kind === 'endAction')!.id }) }).then((response) => response.json()) as GameView;
    const response = await fetch(`${base}/api/games/${created.id}/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: buy.revision }) });
    expect(response.status).toBe(200); const child = await response.json() as GameView;
    expect(child).toMatchObject({ seriesId: created.id, attemptNumber: 2, previousAttemptId: created.id, nextAttemptId: null, revision: 0, turn: 1, phase: 'action', completedActions: 0, canUndo: false });
    expect(child.id).not.toBe(created.id); expect((await readdir(games)).filter((name) => name.endsWith('.json'))).toHaveLength(2);
    const parent = await fetch(`${base}/api/games/${created.id}`).then((loaded) => loaded.json()) as GameView;
    expect(parent).toMatchObject({ id: created.id, nextAttemptId: child.id, revision: buy.revision + 1, phase: 'buy' });
    const repeated = await fetch(`${base}/api/games/${created.id}/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: parent.revision }) });
    expect(repeated.status).toBe(409); expect(await repeated.json()).toEqual({ error: 'This game has already been reset.' });
  });
});
