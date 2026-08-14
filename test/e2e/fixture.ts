import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { expect, test as base } from '@playwright/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { GameRecord } from '../../src/server/types';

const executeFile = promisify(execFile);

interface ScenarioRuntime {
  id: string;
  root: string;
  games: string;
  baseURL: string;
  process: ChildProcessWithoutNullStreams;
  output: string[];
}

const runtimes = new Map<string, ScenarioRuntime>();
let currentRuntime: ScenarioRuntime | null = null;
let browserConsole: string[] = [];
let pageErrors: string[] = [];

export interface ScenarioInput {
  cards?: string[];
  aiCards?: string[];
  discardCards?: string[];
  playCards?: string[];
  positions?: Record<string, { q: number; r: number } | null>;
  baselineMoves?: Record<string, number>;
  braced?: string[];
  pinned?: string[];
  scores?: { ochre: number; indigo: number };
  phase?: 'respawn' | 'action' | 'buy' | 'ended';
  activePlayerId?: 'ochre' | 'indigo';
  blocks?: Array<{ id: string; ownerId: 'ochre' | 'indigo'; position: { q: number; r: number }; clearAfterTurn: number }>;
  money?: number;
  buys?: number;
  supply?: Record<string, number>;
  turnsTaken?: { ochre: number; indigo: number };
  pressSetupPieceIds?: string[];
  displacedPieceIds?: string[];
  winner?: 'ochre' | 'indigo' | null;
  aiFailureMode?: 'process' | 'rejected-plan';
}

export const test = base.extend<{ failureEvidence: void }>({
  failureEvidence: [async ({ context }, use, testInfo) => {
    browserConsole = [];
    pageErrors = [];
    await stopAllRuntimes();
    observeContext(context);
    await use();
    if (testInfo.status !== testInfo.expectedStatus) await attachFailureEvidence(testInfo);
    await stopAllRuntimes();
  }, { auto: true }]
});

export { expect };

export async function seedScenario(input: ScenarioInput = {}): Promise<{ id: string }> {
  await stopCurrentRuntime();
  const root = await mkdtemp(path.join(tmpdir(), 'hexdeck-e2e-'));
  const games = path.join(root, 'games');
  const isLive = process.env.HEXDECK_E2E_LIVE === '1';
  const seedInput = { ...input };
  delete seedInput.aiFailureMode;
  const { stdout } = await executeFile(
    path.resolve('node_modules/.bin/tsx'),
    [path.resolve('test/e2e/seed-cli.ts'), JSON.stringify(seedInput)],
    {
      cwd: path.resolve('.'),
      maxBuffer: 1_000_000,
      env: { ...process.env, HEXDECK_E2E_DATA_DIR: games, HEXDECK_E2E_LIVE: isLive ? '1' : '0' }
    }
  );
  const { id } = JSON.parse(stdout) as { id: string };
  const port = await availablePort();
  const output: string[] = [];
  const child = spawn(path.resolve('node_modules/.bin/tsx'), ['src/server/main.ts'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      PORT: String(port),
      HEXDECK_DATA_DIR: games,
      HEXDECK_AI_TRACE_DIR: path.join(root, 'ai-traces'),
      HEXDECK_AI_FAKE: isLive ? '0' : '1',
      HEXDECK_AI_FAKE_FAIL_ONCE: input.aiFailureMode === 'process' ? '1' : '0',
      HEXDECK_AI_FAKE_REJECT_ONCE: input.aiFailureMode === 'rejected-plan' ? '1' : '0'
    },
    stdio: 'pipe'
  });
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  const runtime: ScenarioRuntime = {
    id,
    root,
    games,
    baseURL: `http://127.0.0.1:${port}`,
    process: child,
    output
  };
  currentRuntime = runtime;
  runtimes.set(id, runtime);
  await waitForHealth(runtime);
  return { id };
}

export async function loadSaved(id: string, minimumRevision = 1): Promise<GameRecord> {
  const runtime = runtimes.get(id);
  if (!runtime) throw new Error(`Missing isolated runtime for game ${id}.`);
  const deadline = Date.now() + 5_000;
  while (true) {
    const record = JSON.parse(await readFile(path.join(runtime.games, `${id}.json`), 'utf8')) as GameRecord;
    if (record.revision >= minimumRevision) return record;
    if (Date.now() >= deadline) throw new Error(`Game ${id} did not reach revision ${minimumRevision}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export async function openScenario(page: Page, id: string, banner = 'Your action phase'): Promise<void> {
  const runtime = runtimes.get(id);
  if (!runtime) throw new Error(`Missing isolated runtime for game ${id}.`);
  await page.addInitScript((gameId: string) => {
    localStorage.setItem('hexdeck.activeGameId', gameId);
  }, id);
  await page.goto(runtime.baseURL);
  await page.getByText(banner).waitFor();
}

export function piece(page: Page, id: string) {
  return page.locator(`[data-piece-id="${id}"]`);
}

export function hex(page: Page, q: number, r: number) {
  return page.locator(`[data-hex="${q},${r}"]`);
}

export async function playCard(page: Page, name: string): Promise<void> {
  await page.locator('.card').filter({ has: page.getByText(name, { exact: true }) }).click();
}

export function isolatedRuntimeEvidence(id: string): { root: string; baseURL: string } {
  const runtime = runtimes.get(id);
  if (!runtime) throw new Error(`Missing isolated runtime for game ${id}.`);
  return { root: runtime.root, baseURL: runtime.baseURL };
}

function observeContext(context: BrowserContext): void {
  const observePage = (page: Page) => {
    page.on('console', (message) => browserConsole.push(`[${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  };
  context.pages().forEach(observePage);
  context.on('page', observePage);
}

async function attachFailureEvidence(testInfo: TestInfo): Promise<void> {
  await attachFile(testInfo, 'browser-console.txt', browserConsole.join('\n') || '(no browser console messages)');
  await attachFile(testInfo, 'page-errors.txt', pageErrors.join('\n\n') || '(no page errors)');
  await attachFile(testInfo, 'server-output.txt', [...runtimes.values()].map((runtime) => [
      `Game ${runtime.id} at ${runtime.baseURL}`,
      runtime.output.join('') || '(no server output)'
    ].join('\n')).join('\n\n'));
  const records = await Promise.all([...runtimes.values()].map(async (runtime) => ({
    id: runtime.id,
    record: JSON.parse(await readFile(path.join(runtime.games, `${runtime.id}.json`), 'utf8')) as unknown
  })));
  await attachFile(testInfo, 'saved-games.json', JSON.stringify(records, null, 2), 'application/json');
}

async function attachFile(
  testInfo: TestInfo,
  name: string,
  content: string,
  contentType = 'text/plain'
): Promise<void> {
  const attachmentPath = testInfo.outputPath(name);
  await writeFile(attachmentPath, content, 'utf8');
  await testInfo.attach(name, { path: attachmentPath, contentType });
}

async function waitForHealth(runtime: ScenarioRuntime): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (runtime.process.exitCode !== null) {
      throw new Error(`Isolated server exited before health check.\n${runtime.output.join('')}`);
    }
    try {
      const response = await fetch(`${runtime.baseURL}/api/health`);
      if (response.ok) return;
    } catch {
      // The server can refuse connections during startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Isolated server did not pass its health check.\n${runtime.output.join('')}`);
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate an isolated server port.'));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function stopCurrentRuntime(): Promise<void> {
  if (!currentRuntime) return;
  await stopRuntime(currentRuntime);
  currentRuntime = null;
}

async function stopAllRuntimes(): Promise<void> {
  await Promise.all([...runtimes.values()].map(stopRuntime));
  await Promise.all([...runtimes.values()].map((runtime) => rm(runtime.root, { recursive: true, force: true })));
  runtimes.clear();
  currentRuntime = null;
}

async function stopRuntime(runtime: ScenarioRuntime): Promise<void> {
  if (runtime.process.exitCode !== null) return;
  runtime.process.kill('SIGTERM');
  await Promise.race([
    once(runtime.process, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (runtime.process.exitCode === null) runtime.process.kill('SIGKILL');
}
