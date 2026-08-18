import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createHexdeckServer } from '../src/server/httpServer';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });
async function server() {
  const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-http-')); const games = path.join(directory, 'games');
  const app = createHexdeckServer({ dataDirectory: games, distDirectory: path.join(root, 'dist') });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  cleanups.push(async () => { await new Promise<void>((resolve) => app.server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, games };
}
async function create(base: string, body: Record<string, unknown> = {}) {
  return fetch(`${base}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed: 2, firstPlayerId: 'ochre', ...body }) });
}
describe('local game HTTP interface', () => {
  it('creates a game and accepts both sequential builds', async () => {
    const { base } = await server(); const createdResponse = await create(base); expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string; revision: number; schemaVersion: number; activePlayerId: string };
    expect(created).toMatchObject({ schemaVersion: 9, activePlayerId: 'ochre' });
    const playerOne = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, definitionIds: ['footwork'], complete: true }) }).then((response) => response.json()) as { revision: number; activePlayerId: string; phase: string };
    expect(playerOne).toMatchObject({ activePlayerId: 'indigo', phase: 'startingBuild' });
    const playerTwo = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: playerOne.revision, definitionIds: ['aim'], complete: true }) }).then((response) => response.json()) as { phase: string; completedBuilds: Record<string, string[]> };
    expect(playerTwo.phase).toBe('action'); expect(playerTwo.completedBuilds).toEqual({ ochre: ['footwork'], indigo: ['aim'] });
  });
  it('returns a specific old-save schema error', async () => {
    const { base, games } = await server(); const id = '11111111-1111-4111-8111-111111111111'; await mkdir(games, { recursive: true }); await writeFile(path.join(games, `${id}.json`), JSON.stringify({ schemaVersion: 8 }));
    const response = await fetch(`${base}/api/games/${id}`); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Saved game schema 8 is not supported. Start a new game.' });
  });
  it('rejects unknown create-game fields instead of ignoring them', async () => {
    const { base } = await server(); const response = await create(base, { removedField: true });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Invalid request.' });
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
    const exported = await fetch(`${base}/api/games/${created.id}/export`).then((response) => response.json()) as Record<string, unknown>; expect(exported.schemaVersion).toBe(9); expect(JSON.stringify(exported)).not.toContain('committedCommands');
  });
});
