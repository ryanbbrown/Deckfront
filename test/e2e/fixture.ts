import { test as base, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCommand, cloneGame, createCard } from '../../src/game';
import { createHexdeckServer } from '../../src/server/httpServer';
import { FileGameRepository } from '../../src/server/persistence';
import type { GameRecord } from '../../src/server/types';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
interface Fixtures { baseUrl: string; dataDirectory: string; traceDirectory: string; failingAiBaseUrl: string; failingAiDataDirectory: string; repository: FileGameRepository; openGame: (page: Page, mutate?: (record: GameRecord) => void) => Promise<GameRecord> }
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  dataDirectory: async ({}, use) => { const data = await mkdtemp(path.join(tmpdir(), 'hexdeck-e2e-')); await use(data); await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); },
  traceDirectory: async ({ dataDirectory }, use) => { await use(path.join(dataDirectory, 'traces')); },
  baseUrl: async ({ dataDirectory, traceDirectory }, use) => {
    const app = createHexdeckServer({ dataDirectory, strategyDirectory: path.join(root, 'strategies'), distDirectory: path.join(root, 'dist'), ai: { projectRoot: root, traceDirectory, model: process.env.HEXDECK_AI_MODEL ?? 'openai:gpt-5.6-luna', effort: process.env.HEXDECK_AI_EFFORT ?? 'low', timeoutMilliseconds: 240_000, fakeModel: process.env.HEXDECK_E2E_LIVE !== '1' } });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No address');
    await use(`http://127.0.0.1:${address.port}`); await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  },
  // eslint-disable-next-line no-empty-pattern
  failingAiDataDirectory: async ({}, use) => { const data = await mkdtemp(path.join(tmpdir(), 'hexdeck-e2e-fail-')); await use(data); await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); },
  failingAiBaseUrl: async ({ failingAiDataDirectory }, use) => {
    const app = createHexdeckServer({ dataDirectory: failingAiDataDirectory, strategyDirectory: path.join(root, 'strategies'), distDirectory: path.join(root, 'dist'), ai: { projectRoot: root, traceDirectory: path.join(failingAiDataDirectory, 'traces'), model: 'fake', effort: 'low', timeoutMilliseconds: 30_000, fakeModel: true, fakeFailOnce: true } });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No address'); await use(`http://127.0.0.1:${address.port}`); await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  },
  repository: async ({ dataDirectory }, use) => { await use(new FileGameRepository(dataDirectory)); },
  openGame: async ({ baseUrl, repository }, use) => {
    await use(async (page, mutate) => {
      const response = await fetch(`${baseUrl}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed: 7, strategyPresetId: 'ranged-setup', strategyMarkdown: '# Ranged', firstPlayerId: 'ochre' }) });
      if (!response.ok) throw new Error(await response.text()); const created = await response.json() as { id: string }; const record = await repository.load(created.id);
      completeSetup(record); mutate?.(record); resetRecord(record); await repository.save(record);
      await page.goto(baseUrl); await page.evaluate((id) => localStorage.setItem('hexdeck.activeGameId', id), created.id); await page.reload(); await expect(page.getByText(/your action|your buy|Player [12] (?:action|buy)/)).toBeVisible(); return record;
    });
  }
});
export { expect };
export function seedHand(record: GameRecord, definitions: string[], draw: string[] = []): void {
  const deck = record.state.players.ochre.deck; record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play); deck.draw = draw.map((id) => createCard(record.state, id)); deck.hand = definitions.map((id) => createCard(record.state, id)); deck.discard = []; deck.play = [];
}
export function resetRecord(record: GameRecord): void { record.initialState = cloneGame(record.state); record.committedCommands = []; record.undoCheckpoint = null; record.revision = 0; record.completedActions = 0; record.aiActions = []; }
export function completeSetup(record: GameRecord): void { record.state = applyCommand(record.state, { type: 'submitStartingBuild', playerId: 'ochre', definitionIds: [] }); record.state = applyCommand(record.state, { type: 'submitStartingBuild', playerId: 'indigo', definitionIds: [] }); }
