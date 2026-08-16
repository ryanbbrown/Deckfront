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
  const app = createHexdeckServer({ dataDirectory: games, strategyDirectory: path.join(root, 'strategies'), distDirectory: path.join(root, 'dist'), ai: { projectRoot: root, traceDirectory: path.join(directory, 'traces'), model: 'fake', effort: 'low', timeoutMilliseconds: 10_000, fakeModel: true } });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  cleanups.push(async () => { await new Promise<void>((resolve) => app.server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, games };
}
describe('distance duel HTTP interface', () => {
  it('returns a specific old-save schema error through HTTP', async () => {
    const { base, games } = await server(); const id = '11111111-1111-4111-8111-111111111111'; await mkdir(games, { recursive: true }); await writeFile(path.join(games, `${id}.json`), JSON.stringify({ schemaVersion: 2 }));
    const response = await fetch(`${base}/api/games/${id}`); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Saved game schema 2 is not supported. Start a new game.' });
  });
  it('revision-locks starting-build updates and exposes only redacted exports', async () => {
    const { base } = await server(); const createdResponse = await fetch(`${base}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed: 1, strategyPresetId: 'close-pressure', strategyMarkdown: '# close', firstPlayerId: 'ochre' }) });
    const created = await createdResponse.json() as { id: string; revision: number };
    const edit = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, definitionIds: ['feint'], complete: false }) }); expect(edit.status).toBe(200);
    const stale = await fetch(`${base}/api/games/${created.id}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: created.revision, definitionIds: [], complete: false }) }); expect(stale.status).toBe(409);
    const exported = await fetch(`${base}/api/games/${created.id}/export`).then((response) => response.json()) as Record<string, unknown>; expect(exported.schemaVersion).toBe(3); expect(JSON.stringify(exported)).not.toContain('committedState');
  });
});
