import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCard, resetKingdoms } from '../src/game';
import type { AiTrainer } from '../src/server/aiTrainer';
import { pretrainedVariableCardSets } from '../src/server/pretrainedCatalog';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';
import type { GameRecord, GameRepository } from '../src/server/types';
import type { GameView } from '../src/shared/api';
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
const market = ['cull','footwork','aim','volley','muster','feint','drive','channel','arcBolt','reclaim'];

function phaseAction(game: GameView, kind: 'endAction' | 'endBuy') {
  return game.actions.phases.find((action) => action.kind === kind)!.id;
}

describe('AI games', () => {
  it('selects before saving, advances automatically, and returns only human turns', async () => {
    const repository = new MemoryRepository(); const service = new GameService(repository, trainer);
    const created = await service.create({ seed: 3, mode: 'ai', humanPlayerId: 'indigo', aiDifficulty: 'hard', variableCardIds: market });
    expect(created).toMatchObject({ mode: 'ai', humanPlayerId: 'indigo', aiPlayerId: 'ochre',
      aiDifficulty: 'hard', startingDraftEnabled: false, phase: 'action', activePlayerId: 'indigo', turn: 2 });
    expect(repository.record?.aiDifficulty).toBe('hard');
    expect(created.fighters.ochre.health).toBe(47); expect(created.training?.strategyId).toBe(strategy.id);
    expect(created.completedBuilds).toBeNull();
    expect(created.presentation.frames[0]).toMatchObject({ playerId: 'ochre', commandType: 'aiTurnStart' });
    expect(created.presentation.frames.at(-1)?.state).toMatchObject({ activePlayerId: created.activePlayerId, phase: created.phase, turn: created.turn });
  });

  it('defaults an AI game to Expert and leaves local games without AI difficulty', async () => {
    const ai = await new GameService(new MemoryRepository(), trainer).create({
      seed: 3, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market
    });
    const local = await new GameService(new MemoryRepository(), trainer).create({
      seed: 3, mode: 'local', variableCardIds: market, startingDraftEnabled: true
    });
    expect(ai.aiDifficulty).toBe('expert');
    expect(local.aiDifficulty).toBeNull();
    expect(local.startingDraftEnabled).toBe(true);
  });

  it('ignores saved starting builds but uses the selected purchase plan', async () => {
    const service = new GameService(new MemoryRepository(), privateBuildTrainer);
    const created = await service.create({ seed: 3, mode: 'ai', humanPlayerId: 'indigo', variableCardIds: market });
    expect(created).toMatchObject({ startingDraftEnabled: false, phase: 'action', activePlayerId: 'indigo' });
    expect(created.players.ochre.deckCounts).not.toHaveProperty('step');
    expect(created.players.ochre.deckCounts).toMatchObject({ copper: 7, scrap: 3, silver: 1 });
    expect(created.players.indigo.deckCounts).toEqual({ copper: 7, scrap: 3 });
    expect(created.events.some((event) => event.playerId === 'ochre' && event.type === 'purchase'
      && event.detail.definitionId === 'silver')).toBe(true);
  });

  it('forces AI games draft-off even when the request enables the draft', async () => {
    const repository = new MemoryRepository(); const service = new GameService(repository, privateBuildTrainer);
    const view = await service.create({ seed: 3, mode: 'ai', humanPlayerId: 'indigo', variableCardIds: market, startingDraftEnabled: true });
    expect(view).toMatchObject({ startingDraftEnabled: false, phase: 'action', activePlayerId: 'indigo' });
    const record = repository.record!;
    expect(record.state.players.ochre.startingBuild).toBeNull(); expect(record.state.players.indigo.startingBuild).toBeNull();
    expect(record.state.players.ochre.firstBuyPending).toBe(false); expect(view.completedBuilds).toBeNull();
    expect(view.players.ochre.deckCounts).toMatchObject({ copper: 7, scrap: 3 });
  });

  it('resets an AI-first game to the same human boundary without selecting again', async () => {
    let trainingCalls = 0;
    const recordingTrainer: AiTrainer = { train: async () => {
      trainingCalls += 1;
      return { strategy, summary: { elapsedMs: 7, matches: 0, strategyId: strategy.id } };
    } };
    const repository = new MemoryRepository(); const service = new GameService(repository, recordingTrainer);
    const created = await service.create({ seed: 17, mode: 'ai', humanPlayerId: 'indigo', aiDifficulty: 'hard', variableCardIds: market, startingDraftEnabled: true });
    const boundary = structuredClone(repository.record!);
    const buy = await service.commitAction(created.id, created.revision, phaseAction(created, 'endAction'));
    const progressed = await service.commitAction(created.id, buy.revision, phaseAction(buy, 'endBuy'));
    repository.record!.finishedAt = '2026-01-01T00:00:00.000Z'; repository.record!.durationSeconds = 12;

    const reset = await service.resetGame(created.id, progressed.revision);
    const saved = repository.record!;
    expect(trainingCalls).toBe(1);
    expect(saved.state).toEqual(boundary.state);
    expect(saved.committedCommands).toEqual(boundary.committedCommands);
    expect(saved.completedActions).toBe(boundary.completedActions);
    expect(saved.undoHistory).toEqual([]); expect(saved.finishedAt).toBeNull(); expect(saved.durationSeconds).toBeNull(); expect(saved.buildProposal).toEqual([]);
    expect(saved).toMatchObject({ id: boundary.id, createdAt: boundary.createdAt, kingdom: boundary.kingdom, mode: 'ai', humanPlayerId: 'indigo', aiDifficulty: 'hard', aiStrategy: boundary.aiStrategy, training: boundary.training, initialState: boundary.initialState });
    expect(reset).toMatchObject({ id: created.id, activePlayerId: 'indigo', phase: 'action', turn: 2, canUndo: false, completedBuilds: null });
    expect(reset.revision).toBe(progressed.revision + 1);
    expect(reset.presentation.frames.some((frame) => frame.commandType === 'aiTurnStart')).toBe(true);
  });

  it('executes trained strategies with the simulator tactical policy', async () => {
    const repository = new MemoryRepository(); const service = new GameService(repository, trainer);
    const created = await service.create({ seed: 3, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market });
    const record = repository.record!; const aiDeck = record.state.players.indigo.deck;
    record.state.trash.push(...aiDeck.draw, ...aiDeck.hand, ...aiDeck.discard, ...aiDeck.play);
    aiDeck.hand = [createCard(record.state, 'volley'), createCard(record.state, 'muster')];
    aiDeck.draw = [createCard(record.state, 'copper')]; aiDeck.discard = []; aiDeck.play = [];
    record.state.activePlayerId = 'ochre'; record.state.phase = 'buy'; record.state.pendingChoice = null;
    record.state.events = []; record.state.turnState.cardsPlayed = []; record.state.players.ochre.money = 0;
    record.initialState = structuredClone(record.state); record.committedCommands = []; record.undoHistory = []; record.completedActions = 0;
    const buy = await service.get(created.id);
    const returned = await service.commitAction(created.id, buy.revision, phaseAction(buy, 'endBuy'));
    const played = returned.events.filter((event) => event.playerId === 'indigo' && event.type === 'cardPlayed')
      .map((event) => event.detail.definitionId);
    expect(played.slice(0, 2)).toEqual(['muster', 'volley']);
  });

  it('passes the chosen difficulty into selection', async () => {
    let received = '';
    const recording: AiTrainer = { train: async (_kingdom, _seed, difficulty) => {
      received = difficulty; return { strategy, summary: { elapsedMs: 1, matches: 0, strategyId: strategy.id } };
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
    expect(created.fighters.ochre.health).toBe(47); expect(created.fighters.indigo.health).toBe(50);
  });

  it('returns public AI events without hidden hand or draw-order details', async () => {
    const repository = new MemoryRepository(); const service = new GameService(repository, trainer);
    const created = await service.create({ seed: 3, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market });
    const buy = await service.commitAction(created.id, created.revision, phaseAction(created, 'endAction'));
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
    const firstBuy = await service.commitAction(created.id, created.revision, phaseAction(created, 'endAction'));
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
      const buy = await first.commitAction(created.id, created.revision, phaseAction(created, 'endAction'));
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

  it('does not save a game when selection fails', async () => {
    const repository = new MemoryRepository();
    const failing: AiTrainer = { train: async () => { throw new Error('selection failed'); } };
    await expect(new GameService(repository, failing).create({ mode: 'ai', humanPlayerId: 'ochre', variableCardIds: market })).rejects.toThrow('selection failed');
    expect(repository.record).toBeNull();
  });

  it('completes a real catalog-backed AI game without worker matches', async () => {
    resetKingdoms();
    const repository = new MemoryRepository();
    const service = new GameService(repository);
    let view = await service.create({
      seed: 19, mode: 'ai', humanPlayerId: 'ochre', variableCardIds: pretrainedVariableCardSets()[0]!
    });
    expect(view).toMatchObject({ startingDraftEnabled: false, phase: 'action', training: { matches: 0 } });
    expect(view.training?.strategyId).toMatch(/^gf-/);

    for (let actionCount = 0; view.phase !== 'ended' && actionCount < 400; actionCount += 1) {
      const kind = view.phase === 'action' ? 'endAction' : 'endBuy';
      view = await service.commitAction(view.id, view.revision, phaseAction(view, kind));
    }

    expect(view.phase).toBe('ended');
    expect(view.winner).toBe('indigo');
    expect(view.events.some((event) => event.playerId === 'indigo' && event.type === 'cardPlayed')).toBe(true);
    expect(repository.record?.training?.matches).toBe(0);
  });
});
