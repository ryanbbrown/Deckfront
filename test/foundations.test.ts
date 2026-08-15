import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, checkInvariants, createGame, findMaximumPoints, listLegalActions } from '../src/game';
import { FileGameRepository } from '../src/server/persistence';
import { GameService } from '../src/server/gameService';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('state foundations under alternating actions', () => {
  it('keeps physical cards conserved and unique through legal atomic actions', () => {
    let state = createGame(17);
    for (let step = 0; step < 30 && !state.winner; step += 1) {
      const actions = listLegalActions(state);
      expect(actions.length).toBeGreaterThan(0);
      const selected = actions.find((action) => action.command.type === 'pass' || action.command.type === 'skipPurchase') ?? actions[0]!;
      state = applyAction(state, selected.id);
      assertInvariants(state);
    }
    const ids = [
      ...state.trash,
      ...Object.values(state.players).flatMap((player) => [
        ...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play
      ])
    ].map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(state.nextCardSerial - 1);
  });

  it('keeps tactical search deterministic and limited to the current atomic action step', () => {
    const state = createGame(23);
    const first = findMaximumPoints(state);
    const second = findMaximumPoints(structuredClone(state));
    expect(second).toEqual(first);
    expect(first.exploredStates).toBe(listLegalActions(state).length + 1);
    expect(first.actions.every((action) => listLegalActions(state).some((candidate) => candidate.id === action.id))).toBe(true);
  });

  it('reports corrupt round, overlap, resource, and card-conservation state', () => {
    const state = createGame(1);
    state.round.actionStep = 0;
    state.pieces['ochre-a'].position = state.pieces['ochre-b'].position;
    state.players.ochre.money = -1;
    state.players.ochre.deck.hand.pop();
    const errors = checkInvariants(state);
    expect(errors).toEqual(expect.arrayContaining([
      'Round counters must be positive.',
      expect.stringContaining('overlaps'),
      'ochre has invalid resources.',
      expect.stringContaining('physical cards')
    ]));
  });
});

describe('schema-v2 persistence and redaction', () => {
  it('round-trips the exact preview and rejects complete-turn schema-v1 saves', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-persistence-'));
    directories.push(directory);
    const repository = new FileGameRepository(directory);
    const service = new GameService(repository);
    const view = await service.create({ seed: 3, strategyPresetId: 'direct-force', strategyMarkdown: '# Test' });
    const move = view.legalActions.find((action) => action.command.type === 'baselineMove')!;
    const preview = await service.previewHumanAction(view.id, view.revision, move.id);
    expect((await repository.load(view.id)).state).toEqual((await service.getRecord(view.id)).state);
    expect((await service.get(view.id)).previewCommand).toEqual(preview.previewCommand);

    const pathName = path.join(directory, `${view.id}.json`);
    const raw = JSON.parse(await readFile(pathName, 'utf8')) as Record<string, unknown>;
    raw.schemaVersion = 1;
    await writeFile(pathName, JSON.stringify(raw), 'utf8');
    await expect(repository.load(view.id)).rejects.toThrow();
  });

  it('never exposes the AI hand in views or redacted exports', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-redaction-'));
    directories.push(directory);
    const service = new GameService(new FileGameRepository(directory));
    const view = await service.create({ seed: 9, strategyPresetId: 'direct-force', strategyMarkdown: '# Test' });
    expect(view.players[view.aiPlayerId].hand).toBeNull();
    const exported = await service.redactedExport(view.id);
    expect(exported.game.players[view.aiPlayerId].hand).toBeNull();
    const privateCardIds = (await service.getRecord(view.id)).state.players[view.aiPlayerId].deck.hand.map((card) => card.id);
    for (const cardId of privateCardIds) expect(JSON.stringify(exported)).not.toContain(cardId);
  });

  it('serializes concurrent writes through the repository lock', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-lock-'));
    directories.push(directory);
    const repository = new FileGameRepository(directory);
    const order: string[] = [];
    await Promise.all([
      repository.withLock('game', async () => { order.push('first-start'); await new Promise((resolve) => setTimeout(resolve, 10)); order.push('first-end'); }),
      repository.withLock('game', async () => { order.push('second'); })
    ]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });
});
