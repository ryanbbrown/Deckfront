import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VARIABLE_ACTION_IDS, resetKingdoms } from '../src/game';
import { ProductionAiTrainer } from '../src/server/aiTrainer';
import type { AiTrainer } from '../src/server/aiTrainer';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';
import type { GameRecord, GameRepository } from '../src/server/types';
import { identify } from '../src/sim/strategy';

class MemoryRepository implements GameRepository {
  record: GameRecord | null = null;
  async create(record: GameRecord) { this.record = structuredClone(record); }
  async load() { if (!this.record) throw new Error('missing'); return structuredClone(this.record); }
  async save(record: GameRecord) { this.record = structuredClone(record); }
  async withLock<T>(_id: string, work: () => Promise<T>) { return work(); }
}
const strategy = identify({ id: '', startingBuild: [], buyAgenda: [], repeatPurchase: 'silver' });
const trainer: AiTrainer = { train: async () => ({ strategy, summary: { elapsedMs: 1, matches: 4, strategyId: strategy.id } }) };
const privateBuildStrategy = identify({ id: '', startingBuild: ['step'], buyAgenda: [], repeatPurchase: 'silver' });
const privateBuildTrainer: AiTrainer = { train: async () => ({ strategy: privateBuildStrategy, summary: { elapsedMs: 1, matches: 4, strategyId: privateBuildStrategy.id } }) };
const market = VARIABLE_ACTION_IDS.slice(0, 10);

function phaseAction(game: Awaited<ReturnType<GameService['create']>>, kind: 'endAction' | 'endBuy') {
  return game.actions.phases.find((action) => action.kind === kind)!.id;
}

describe('AI games', () => {
  it('trains before saving, builds automatically, and returns only human turns', async () => {
    const repository = new MemoryRepository(); const service = new GameService(repository, trainer);
    const created = await service.create({ seed: 3, mode: 'ai', humanPlayerId: 'indigo', aiDifficulty: 'hard', variableCardIds: market });
    expect(created).toMatchObject({ mode: 'ai', humanPlayerId: 'indigo', aiPlayerId: 'ochre',
      aiDifficulty: 'hard', phase: 'startingBuild', activePlayerId: 'indigo' });
    expect(repository.record?.aiDifficulty).toBe('hard');
    expect(created.fighters.ochre.health).toBe(37); expect(created.training?.strategyId).toBe(strategy.id);
    const ready = await service.updateBuild(created.id, created.revision, [], true);
    expect(ready).toMatchObject({ phase: 'action', activePlayerId: 'indigo', turn: 2 });
    expect(ready.completedBuilds).toEqual({ ochre: [], indigo: [] });
  });

  it('defaults an AI game to Expert and leaves local games without AI difficulty', async () => {
    const ai = await new GameService(new MemoryRepository(), trainer).create({
      seed: 3, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market
    });
    const local = await new GameService(new MemoryRepository(), trainer).create({
      seed: 3, mode: 'local', variableCardIds: market
    });
    expect(ai.aiDifficulty).toBe('expert');
    expect(local.aiDifficulty).toBeNull();
  });

  it('uses the selected AI strategy for its private starting build and later turns', async () => {
    const service = new GameService(new MemoryRepository(), privateBuildTrainer);
    const created = await service.create({ seed: 3, mode: 'ai', humanPlayerId: 'indigo', variableCardIds: market });
    expect(created).toMatchObject({ phase: 'startingBuild', activePlayerId: 'indigo' });
    expect(created.players.ochre.deckCounts).toEqual({ copper: 7 }); expect(created.players.indigo.deckCounts).toEqual({ copper: 7 });
    expect(created.players.ochre.deckCounts).not.toHaveProperty('step');
    const ready = await service.updateBuild(created.id, created.revision, ['aim'], true);
    expect(ready.players.ochre.deckCounts).toMatchObject({ copper: 7, step: 1 });
    expect(ready.players.indigo.deckCounts).toEqual({ copper: 7, aim: 1 });
    expect(ready.events.some((event) => event.playerId === 'ochre' && event.type === 'purchase'
      && event.detail.definitionId === 'silver')).toBe(true);
  });

  it('passes the chosen difficulty into training', async () => {
    let received = '';
    const recording: AiTrainer = { train: async (_kingdom, _seed, difficulty) => {
      received = difficulty; return { strategy, summary: { elapsedMs: 1, matches: 4, strategyId: strategy.id } };
    } };
    await new GameService(new MemoryRepository(), recording).create({
      seed: 3, mode: 'ai', humanPlayerId: 'ochre', aiDifficulty: 'easy', variableCardIds: market
    });
    expect(received).toBe('easy');
  });

  it('puts an AI-second game in the correct seats and penalizes the first human player', async () => {
    const service = new GameService(new MemoryRepository(), trainer);
    const created = await service.create({ seed: 9, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market });
    expect(created).toMatchObject({ humanPlayerId: 'ochre', aiPlayerId: 'indigo', selectedFirstPlayerId: 'ochre', activePlayerId: 'ochre' });
    expect(created.fighters.ochre.health).toBe(37); expect(created.fighters.indigo.health).toBe(40);
  });

  it('returns public AI events without hidden hand or draw-order details', async () => {
    const repository = new MemoryRepository(); const service = new GameService(repository, trainer);
    const created = await service.create({ seed: 3, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market });
    const ready = await service.updateBuild(created.id, created.revision, [], true);
    const buy = await service.commitAction(created.id, ready.revision, phaseAction(ready, 'endAction'));
    const returned = await service.commitAction(created.id, buy.revision, phaseAction(buy, 'endBuy'));
    expect(repository.record?.state.events.some((event) => event.playerId === 'indigo' && event.type === 'purchase' && event.detail.definitionId === 'silver')).toBe(true);
    expect(returned.events.some((event) => event.playerId === 'indigo' && event.type === 'turn')).toBe(true);
    expect(returned.events.some((event) => event.playerId === 'indigo' && event.type === 'purchase' && event.detail.definitionId === 'silver')).toBe(true);
    const logData = JSON.stringify(returned.events);
    expect(logData).not.toMatch(/cardInstanceId|recoverInstanceId|discardInstanceId|drawOrder|"hand"/);
    expect(returned.events.filter((event) => event.type === 'recover').every((event) => Object.keys(event.detail).length === 0)).toBe(true);
  });

  it('undoes multiple human turns in order and never returns an intermediate AI state', async () => {
    const service = new GameService(new MemoryRepository(), trainer);
    const created = await service.create({ seed: 4, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market });
    const ready = await service.updateBuild(created.id, created.revision, [], true);
    const firstBuy = await service.commitAction(created.id, ready.revision, phaseAction(ready, 'endAction'));
    const firstReturn = await service.commitAction(created.id, firstBuy.revision, phaseAction(firstBuy, 'endBuy'));
    const secondBuy = await service.commitAction(created.id, firstReturn.revision, phaseAction(firstReturn, 'endAction'));
    const secondReturn = await service.commitAction(created.id, secondBuy.revision, phaseAction(secondBuy, 'endBuy'));
    expect(secondReturn).toMatchObject({ activePlayerId: 'ochre', phase: 'action', turn: 5, canUndo: true });
    const expected = [
      { phase: 'buy', turn: 3, canUndo: true }, { phase: 'action', turn: 3, canUndo: true },
      { phase: 'buy', turn: 1, canUndo: true }, { phase: 'action', turn: 1, canUndo: false }
    ];
    let current = secondReturn;
    for (const state of expected) {
      current = await service.undoAction(created.id, current.revision);
      expect(current).toMatchObject({ activePlayerId: 'ochre', ...state });
    }
  });

  it('reloads an AI game after a registry reset, advances again, and keeps Undo human-safe', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-ai-reload-'));
    try {
      const first = new GameService(new FileGameRepository(directory), trainer);
      const created = await first.create({ seed: 12, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market });
      const ready = await first.updateBuild(created.id, created.revision, [], true);
      const buy = await first.commitAction(created.id, ready.revision, phaseAction(ready, 'endAction'));
      const returned = await first.commitAction(created.id, buy.revision, phaseAction(buy, 'endBuy'));
      expect(returned).toMatchObject({ activePlayerId: 'ochre', phase: 'action', turn: 3 });
      resetKingdoms();
      const restarted = new GameService(new FileGameRepository(directory), trainer);
      const loaded = await restarted.get(created.id);
      const secondBuy = await restarted.commitAction(created.id, loaded.revision, phaseAction(loaded, 'endAction'));
      const secondReturn = await restarted.commitAction(created.id, secondBuy.revision, phaseAction(secondBuy, 'endBuy'));
      expect(secondReturn).toMatchObject({ activePlayerId: 'ochre', phase: 'action', turn: 5 });
      let undone = await restarted.undoAction(created.id, secondReturn.revision);
      expect(undone).toMatchObject({ activePlayerId: 'ochre', phase: 'buy', turn: 3, canUndo: true });
      undone = await restarted.undoAction(created.id, undone.revision);
      expect(undone).toMatchObject({ activePlayerId: 'ochre', phase: 'action', turn: 3, canUndo: true });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('does not save a game when training fails', async () => {
    const repository = new MemoryRepository();
    const failing: AiTrainer = { train: async () => { throw new Error('training failed'); } };
    await expect(new GameService(repository, failing).create({ mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market })).rejects.toThrow('training failed');
    expect(repository.record).toBeNull();
  });

  it('runs a reduced production search for a generated kingdom', { timeout: 30_000 }, async () => {
    resetKingdoms();
    const service = new GameService(new MemoryRepository(), new ProductionAiTrainer({
      restarts: 1, initialStrategies: 2, candidates: 2, iterations: 1,
      seeds: 1, unionIterations: 1, workers: 2, deadlineMinutes: 1, finalSearch: 'none'
    }));
    const created = await service.create({ seed: 19, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market });
    expect(created.training?.matches).toBeGreaterThan(0);
    expect(created.training?.strategyId).toMatch(/^sg-/);
  });
});
