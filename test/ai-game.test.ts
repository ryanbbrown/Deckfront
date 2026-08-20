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
const market = VARIABLE_ACTION_IDS.slice(0, 10);

function phaseAction(game: Awaited<ReturnType<GameService['create']>>, kind: 'endAction' | 'endBuy') {
  return game.actions.phases.find((action) => action.kind === kind)!.id;
}

describe('AI games', () => {
  it('trains before saving, builds automatically, and returns only human turns', async () => {
    const repository = new MemoryRepository(); const service = new GameService(repository, trainer);
    const created = await service.create({ seed: 3, mode: 'ai', humanPlayerId: 'indigo', variableCardIds: market });
    expect(created).toMatchObject({ mode: 'ai', humanPlayerId: 'indigo', aiPlayerId: 'ochre', phase: 'startingBuild', activePlayerId: 'indigo' });
    expect(created.fighters.ochre.health).toBe(37); expect(created.training?.strategyId).toBe(strategy.id);
    const ready = await service.updateBuild(created.id, created.revision, [], true);
    expect(ready).toMatchObject({ phase: 'action', activePlayerId: 'indigo', turn: 2 });
    expect(ready.completedBuilds).toEqual({ ochre: [], indigo: [] });
  });

  it('puts an AI-second game in the correct seats and penalizes the first human player', async () => {
    const service = new GameService(new MemoryRepository(), trainer);
    const created = await service.create({ seed: 9, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market });
    expect(created).toMatchObject({ humanPlayerId: 'ochre', aiPlayerId: 'indigo', selectedFirstPlayerId: 'ochre', activePlayerId: 'ochre' });
    expect(created.fighters.ochre.health).toBe(37); expect(created.fighters.indigo.health).toBe(40);
  });

  it('omits a non-empty AI turn from browser events while keeping it in the saved record', async () => {
    const repository = new MemoryRepository(); const service = new GameService(repository, trainer);
    const created = await service.create({ seed: 3, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market });
    const ready = await service.updateBuild(created.id, created.revision, [], true);
    const buy = await service.commitAction(created.id, ready.revision, phaseAction(ready, 'endAction'));
    const returned = await service.commitAction(created.id, buy.revision, phaseAction(buy, 'endBuy'));
    expect(repository.record?.state.events.some((event) => event.playerId === 'indigo' && event.type === 'purchase' && event.detail.definitionId === 'silver')).toBe(true);
    expect(returned.events.some((event) => event.playerId === 'indigo')).toBe(false);
    expect(returned.events.some((event) => event.type === 'purchase' && event.detail.definitionId === 'silver')).toBe(false);
  });

  it('rolls a complete automatic AI turn into the human Undo checkpoint', async () => {
    const service = new GameService(new MemoryRepository(), trainer);
    const created = await service.create({ seed: 4, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market });
    const ready = await service.updateBuild(created.id, created.revision, [], true);
    const buy = await service.commitAction(created.id, ready.revision, phaseAction(ready, 'endAction'));
    const returned = await service.commitAction(created.id, buy.revision, phaseAction(buy, 'endBuy'));
    expect(returned).toMatchObject({ activePlayerId: 'ochre', phase: 'action', turn: 3, canUndo: true });
    const undone = await service.undoAction(created.id, returned.revision);
    expect(undone).toMatchObject({ activePlayerId: 'ochre', phase: 'buy', turn: 1, canUndo: false });
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
      const undone = await restarted.undoAction(created.id, secondReturn.revision);
      expect(undone).toMatchObject({ activePlayerId: 'ochre', phase: 'buy', turn: 3, canUndo: false });
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
