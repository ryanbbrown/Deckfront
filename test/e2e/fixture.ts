import { test as base, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneGame } from '../../src/game';
import { createHexdeckServer } from '../../src/server/httpServer';
import { FileGameRepository } from '../../src/server/persistence';
import type { GameRecord } from '../../src/server/types';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface Fixtures {
  baseUrl: string;
  dataDirectory: string;
  openGame: (page: Page, mutate?: (record: GameRecord) => void) => Promise<GameRecord>;
  repository: FileGameRepository;
}

export const test = base.extend<Fixtures>({
  // Playwright requires fixture dependencies to use object destructuring.
  // eslint-disable-next-line no-empty-pattern
  dataDirectory: async ({}, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-e2e-'));
    await use(directory);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  },
  baseUrl: async ({ dataDirectory }, use) => {
    const app = createHexdeckServer({
      dataDirectory,
      strategyDirectory: path.join(projectRoot, 'strategies'),
      distDirectory: path.join(projectRoot, 'dist'),
      ai: {
        projectRoot,
        traceDirectory: path.join(dataDirectory, 'traces'),
        model: 'openai:gpt-5.6-luna',
        effort: 'low',
        timeoutMilliseconds: 30_000,
        fakeModel: process.env.HEXDECK_E2E_LIVE !== '1',
        fakeFailOnce: process.env.HEXDECK_E2E_LIVE !== '1'
      }
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('No server address.');
    await use(`http://127.0.0.1:${address.port}`);
    await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  },
  repository: async ({ dataDirectory }, use) => { await use(new FileGameRepository(dataDirectory)); },
  openGame: async ({ baseUrl, repository }, use) => {
    await use(async (page, mutate) => {
      const response = await fetch(`${baseUrl}/api/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seed: 7, strategyPresetId: 'direct-force', strategyMarkdown: '# Push toward the edge.' })
      });
      if (!response.ok) throw new Error(await response.text());
      const created = await response.json() as { id: string };
      const record = await repository.load(created.id);
      mutate?.(record);
      record.initialState = cloneGame(record.state);
      record.committedState = cloneGame(record.state);
      record.committedCommands = [];
      record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), command: null };
      record.revision = 0;
      record.completedActions = 0;
      record.aiActions = [];
      await repository.save(record);
      await page.goto(baseUrl);
      await page.evaluate((id) => localStorage.setItem('hexdeck.activeGameId', id), created.id);
      await page.reload();
      await expect(page.getByText('Action step 1')).toBeVisible();
      return record;
    });
  }
});

export { expect };
