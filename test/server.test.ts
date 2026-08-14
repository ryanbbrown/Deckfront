import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame, replayCommands } from '../src/game';
import type { GameCommand, PlayerId } from '../src/game';
import type { AiTurnStatus, SafeGameView } from '../src/shared/api';
import { createHexdeckServer, type HexdeckServer } from '../src/server/httpServer';
import { FileGameRepository } from '../src/server/persistence';
import type { GameRecord } from '../src/server/types';

const projectRoot = path.resolve(import.meta.dirname, '..');
let temporaryDirectory = '';
let application: HexdeckServer;
let origin = '';

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'hexdeck-test-'));
  application = createHexdeckServer({
    dataDirectory: path.join(temporaryDirectory, 'games'),
    strategyDirectory: path.join(projectRoot, 'strategies'),
    distDirectory: path.join(projectRoot, 'dist'),
    ai: {
      projectRoot,
      traceDirectory: path.join(temporaryDirectory, 'traces'),
      model: 'fake:test',
      effort: 'low',
      timeoutMilliseconds: 30_000,
      fakeModel: true
    }
  });
  await new Promise<void>((resolve) => application.server.listen(0, '127.0.0.1', resolve));
  const address = application.server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => application.server.close((error) => error ? reject(error) : resolve()));
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function json<T>(url: string, options?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${origin}${url}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers }
  });
  return { status: response.status, body: await response.json() as T };
}

function seedFor(playerId: PlayerId, minimumCopper = 0): number {
  for (let seed = 0; seed < 10_000; seed += 1) {
    const state = createGame(seed);
    const copper = state.players[playerId].deck.hand.filter((card) => card.definitionId === 'copper').length;
    if (state.activePlayerId === playerId && copper >= minimumCopper) return seed;
  }
  throw new Error('Could not find a suitable test seed.');
}

async function newGame(seed = seedFor('ochre')): Promise<SafeGameView> {
  const strategy = await readFile(path.join(projectRoot, 'strategies/direct-force.md'), 'utf8');
  const response = await json<SafeGameView>('/api/games', {
    method: 'POST',
    body: JSON.stringify({ seed, strategyPresetId: 'direct-force', strategyMarkdown: strategy })
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function action(game: SafeGameView, actionId: string): Promise<{ status: number; body: SafeGameView }> {
  return json(`/api/games/${game.id}/actions`, {
    method: 'POST',
    body: JSON.stringify({ expectedRevision: game.revision, actionId })
  });
}

describe('authoritative game API', () => {
  it('loads tracked strategies and stores exact edited Markdown', async () => {
    const presets = await json<{ strategies: Array<{ id: string; markdown: string }> }>('/api/strategies');
    expect(presets.status).toBe(200);
    expect(presets.body.strategies.map((strategy) => strategy.id)).toEqual([
      'confinement', 'direct-force', 'flexible-economy', 'geometry'
    ]);
    const edited = `${presets.body.strategies[1]!.markdown}\nPrefer Shove on ties.\n`;
    const created = await json<SafeGameView>('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        seed: seedFor('ochre'), strategyPresetId: 'direct-force', strategyMarkdown: edited
      })
    });
    expect(created.body.strategy.markdown).toBe(edited);
  });

  it('redacts both draw orders and the AI hand from human state', async () => {
    const game = await newGame();
    expect(game.players.ochre.hand).toHaveLength(5);
    expect(game.players.indigo.hand).toBeNull();
    expect(game.players.ochre).not.toHaveProperty('deck');
    expect(game.players.indigo).not.toHaveProperty('deck');
    const redacted = await json<{ game: SafeGameView }>(`/api/games/${game.id}/export?redacted=1`);
    expect(redacted.body.game.players.indigo.hand).toBeNull();
    const full = await json<GameRecord>(`/api/games/${game.id}/export`);
    expect(full.body.state.players.indigo.deck.hand).toHaveLength(5);
  });

  it('persists one action and restores it through a new repository instance', async () => {
    let game = await newGame();
    const move = game.legalActions.find((candidate) => candidate.command.type === 'baselineMove');
    if (!move) throw new Error('Expected a baseline move.');
    game = (await action(game, move.id)).body;
    const savedPosition = game.pieces[move.command.type === 'baselineMove' ? move.command.pieceId : 'ochre-a'].position;

    const secondApplication = createHexdeckServer({
      dataDirectory: path.join(temporaryDirectory, 'games'),
      strategyDirectory: path.join(projectRoot, 'strategies'),
      distDirectory: path.join(projectRoot, 'dist'),
      ai: {
        projectRoot,
        traceDirectory: path.join(temporaryDirectory, 'traces'),
        model: 'fake:test',
        effort: 'low',
        timeoutMilliseconds: 30_000,
        fakeModel: true
      }
    });
    const restored = await secondApplication.service.get(game.id);
    expect(restored.revision).toBe(1);
    expect(restored.pieces[move.command.type === 'baselineMove' ? move.command.pieceId : 'ochre-a'].position).toEqual(savedPosition);
  });

  it('undoes an action by replaying the remaining draft without state drift', async () => {
    const initial = await newGame();
    const move = initial.legalActions.find((candidate) => candidate.command.type === 'baselineMove');
    if (!move || move.command.type !== 'baselineMove') throw new Error('Expected a baseline move.');
    const moved = (await action(initial, move.id)).body;
    expect(moved.pieces[move.command.pieceId].position).not.toEqual(initial.pieces[move.command.pieceId].position);
    const undone = await json<SafeGameView>(`/api/games/${initial.id}/undo`, {
      method: 'POST', body: JSON.stringify({ expectedRevision: moved.revision })
    });
    expect(undone.status).toBe(200);
    expect(undone.body.revision).toBe(2);
    expect(undone.body.pieces[move.command.pieceId].position).toEqual(initial.pieces[move.command.pieceId].position);
    expect(undone.body.events).toEqual(initial.events);
  });

  it('serializes concurrent writes and rejects the stale request', async () => {
    const game = await newGame();
    const move = game.legalActions.find((candidate) => candidate.command.type === 'baselineMove');
    if (!move) throw new Error('Expected a baseline move.');
    const [left, right] = await Promise.all([action(game, move.id), action(game, move.id)]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const restored = await json<SafeGameView>(`/api/games/${game.id}`);
    expect(restored.body.revision).toBe(1);
  });

  it('commits a purchase and produces an exact replayable turn', async () => {
    let game = await newGame(seedFor('ochre', 2));
    const enterBuy = game.legalActions.find((candidate) => candidate.command.type === 'enterBuyPhase');
    if (!enterBuy) throw new Error('Expected buy phase action.');
    game = (await action(game, enterBuy.id)).body;
    expect(game.phase).toBe('buy');
    expect(game.canUndo).toBe(false);
    const purchase = game.legalActions.find((candidate) =>
      candidate.command.type === 'buyCard' && candidate.command.definitionId === 'shove'
    );
    if (!purchase) throw new Error('Expected affordable Shove.');
    const supplyBefore = game.supply.shove ?? 0;
    game = (await action(game, purchase.id)).body;
    expect(game.supply.shove).toBe(supplyBefore - 1);
    const endTurn = game.legalActions.find((candidate) => candidate.command.type === 'endTurn');
    if (!endTurn) throw new Error('Expected end turn.');
    game = (await action(game, endTurn.id)).body;
    expect(game.activePlayerId).toBe('indigo');
    expect(game.legalActions).toEqual([]);

    const full = await application.service.getRecord(game.id);
    const replayed = replayCommands(full.initialState, full.committedCommands as GameCommand[]);
    expect(replayed).toEqual(full.committedState);
    expect(full.draft.commands).toEqual([]);
    const files = await readdir(path.join(temporaryDirectory, 'games'));
    expect(files).toEqual([`${game.id}.json`]);
  });

  it('rejects undo after entering the buy phase', async () => {
    let game = await newGame();
    const enterBuy = game.legalActions.find((candidate) => candidate.command.type === 'enterBuyPhase');
    if (!enterBuy) throw new Error('Expected buy phase action.');
    game = (await action(game, enterBuy.id)).body;
    const response = await json<{ error: string }>(`/api/games/${game.id}/undo`, {
      method: 'POST', body: JSON.stringify({ expectedRevision: game.revision })
    });
    expect(response.status).toBe(403);
  });

  it('runs a fake bridge turn through the public API and commits it atomically', async () => {
    const game = await newGame(seedFor('indigo'));
    expect(game.activePlayerId).toBe('indigo');
    const before = await application.service.getRecord(game.id);
    const publicEvents = Array.from({ length: 35 }, (_, sequence) => ({
      sequence,
      type: 'baselineMove' as const,
      playerId: sequence % 2 === 0 ? 'ochre' as const : 'indigo' as const,
      detail: { marker: `public-${sequence}` }
    }));
    before.initialState.events = structuredClone(publicEvents);
    before.committedState.events = structuredClone(publicEvents);
    before.draft.baseState.events = structuredClone(publicEvents);
    before.state.events = structuredClone(publicEvents);
    await new FileGameRepository(path.join(temporaryDirectory, 'games')).save(before);
    const started = await json<AiTurnStatus>(`/api/games/${game.id}/ai-turn`, { method: 'POST' });
    expect(started.status).toBe(202);
    expect(started.body.status).toBe('running');

    let status: AiTurnStatus = { status: 'running' };
    for (let attempt = 0; attempt < 100 && status.status === 'running'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = (await json<AiTurnStatus>(`/api/games/${game.id}/ai-turn`)).body;
    }
    expect(status.status).toBe('complete');
    expect(status.game?.activePlayerId).toBe('ochre');
    expect(status.game?.revision).toBe(1);
    expect(status.game?.lastAiSummary).toMatch(/^AI bought (.+|nothing)\.$/);

    const saved = await application.service.getRecord(game.id);
    expect(saved.committedCommands.map((command) => command.type)).toContain('enterBuyPhase');
    expect(saved.committedCommands.at(-1)?.type).toBe('endTurn');
    expect(saved.committedState).toEqual(replayCommands(saved.initialState, saved.committedCommands));
    expect(saved.aiTurns).toEqual([expect.objectContaining({ committedRevision: 1 })]);

    const trace = await readFile(path.join(temporaryDirectory, 'traces', game.id, '0.json'), 'utf8');
    const parsedTrace = JSON.parse(trace) as {
      initialBriefing: { publicEvents: Array<{ detail: { marker?: string } }> };
    };
    expect(parsedTrace.initialBriefing.publicEvents[0]?.detail.marker).toBe('public-0');
    expect(parsedTrace.initialBriefing.publicEvents[34]?.detail.marker).toBe('public-34');
    expect(parsedTrace.initialBriefing).not.toHaveProperty('recentPublicEvents');
    for (const card of [...before.state.players.ochre.deck.draw, ...before.state.players.ochre.deck.hand]) {
      expect(trace).not.toContain(`"id":"${card.id}"`);
    }

    let next = status.game!;
    const enterBuy = next.legalActions.find((candidate) => candidate.command.type === 'enterBuyPhase');
    if (!enterBuy) throw new Error('Expected the next human buy phase.');
    next = (await action(next, enterBuy.id)).body;
    const endTurn = next.legalActions.find((candidate) => candidate.command.type === 'endTurn');
    if (!endTurn) throw new Error('Expected the next human end turn.');
    next = (await action(next, endTurn.id)).body;
    expect(next.activePlayerId).toBe('indigo');
    expect((await json<AiTurnStatus>(`/api/games/${game.id}/ai-turn`)).body.status).toBe('idle');
  }, 20_000);
});
