import { test as base, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIABLE_ACTION_IDS, applyCommand, cloneGame, createCard } from '../../src/game';
import { createHexdeckServer } from '../../src/server/httpServer';
import type { AiTrainer } from '../../src/server/aiTrainer';
import { identify } from '../../src/sim/strategy';
import { FileGameRepository } from '../../src/server/persistence';
import type { GameRecord } from '../../src/server/types';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const aiStrategy = identify({ id: '', startingBuild: [], buyAgenda: [], repeatPurchase: 'silver' });
const aiTrainer: AiTrainer = { train: async () => ({
  strategy: aiStrategy, summary: { elapsedMs: 1, matches: 4, strategyId: aiStrategy.id }
}) };
interface Fixtures { baseUrl: string; dataDirectory: string; repository: FileGameRepository; openGame: (page: Page, mutate?: (record: GameRecord) => void) => Promise<GameRecord> }
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  dataDirectory: async ({}, use) => { const data = await mkdtemp(path.join(tmpdir(), 'hexdeck-e2e-')); await use(data); await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); },
  baseUrl: async ({ dataDirectory }, use) => {
    const app = createHexdeckServer({ dataDirectory, distDirectory: path.join(root, 'dist'), aiTrainer });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No address');
    await use(`http://127.0.0.1:${address.port}`); await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  },
  repository: async ({ dataDirectory }, use) => { await use(new FileGameRepository(dataDirectory)); },
  openGame: async ({ baseUrl, repository }, use) => {
    await use(async (page, mutate) => {
      const response = await fetch(`${baseUrl}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed: 7, mode: 'local', variableCardIds: VARIABLE_ACTION_IDS.slice(0, 10) }) });
      if (!response.ok) throw new Error(await response.text()); const created = await response.json() as { id: string }; const record = await repository.load(created.id);
      expect(record.schemaVersion).toBe(13); expect(record.startingDraftEnabled).toBe(true);
      completeSetup(record); mutate?.(record); resetRecord(record); await repository.save(record);
      await page.goto(baseUrl); await page.evaluate((id) => localStorage.setItem('hexdeck.activeGameId', id), created.id); await page.reload(); await expect(page.getByText(/Player [12] (?:action|buy)/)).toBeVisible(); return record;
    });
  }
});
export { expect };
export function seedHand(record: GameRecord, definitions: string[], draw: string[] = []): void {
  const deck = record.state.players.ochre.deck; record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play); deck.draw = draw.map((id) => createCard(record.state, id)); deck.hand = definitions.map((id) => createCard(record.state, id)); deck.discard = []; deck.play = [];
}
export function resetRecord(record: GameRecord): void { record.initialState = cloneGame(record.state); record.committedCommands = []; record.undoHistory = []; record.revision = 0; record.completedActions = 0; }
export function completeSetup(record: GameRecord): void { record.state = applyCommand(record.state, { type: 'submitStartingBuild', playerId: 'ochre', definitionIds: [] }); record.state = applyCommand(record.state, { type: 'submitStartingBuild', playerId: 'indigo', definitionIds: [] }); }
