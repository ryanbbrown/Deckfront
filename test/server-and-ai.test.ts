import { describe, expect, it } from 'vitest';
import { applyAction, cloneGame, listLegalActions } from '../src/game';
import type { GameRecord, GameRepository } from '../src/server/types';
import { AiTurnCoordinator } from '../src/server/aiCoordinator';
import { chooseFakeAction } from '../src/server/aiRunner';
import { ConflictError, GameService } from '../src/server/gameService';
import { buildAiBriefing } from '../src/ai/briefing';
import { addCard, clearHands, setPosition } from './helpers';

class MemoryRepository implements GameRepository {
  record: GameRecord | null = null;
  saves = 0;
  async create(record: GameRecord): Promise<void> { this.record = structuredClone(record); }
  async load(): Promise<GameRecord> {
    if (!this.record) throw new Error('missing');
    return structuredClone(this.record);
  }
  async save(record: GameRecord): Promise<void> { this.record = structuredClone(record); this.saves += 1; }
  async withLock<T>(_id: string, work: () => Promise<T>): Promise<T> { return work(); }
  seed(mutator: (record: GameRecord) => void): void {
    if (!this.record) throw new Error('missing');
    mutator(this.record);
  }
}

async function setup() {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const view = await service.create({ seed: 4, strategyPresetId: 'direct-force', strategyMarkdown: '# Win' });
  return { repository, service, view };
}

function syncRecordState(record: GameRecord): void {
  record.initialState = cloneGame(record.state);
  record.committedState = cloneGame(record.state);
  record.committedCommands = [];
  record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), command: null };
}

describe('saved human action previews', () => {
  it('persists the resolved preview and exact round state until confirmation', async () => {
    const { service, view } = await setup();
    const move = view.legalActions.find((action) => action.command.type === 'baselineMove')!;
    const preview = await service.previewHumanAction(view.id, view.revision, move.id);
    expect(preview.revision).toBe(1);
    expect(preview.previewCommand).toEqual(move.command);
    expect(preview.canConfirm).toBe(true);
    expect(preview.canUndo).toBe(true);
    expect(preview.legalActions).toEqual([]);
    expect(preview.round.actionStep).toBe(2);
    expect((await service.get(view.id))).toEqual(preview);

    const confirmed = await service.confirmHumanAction(view.id, preview.revision);
    const record = await service.getRecord(view.id);
    expect(confirmed.revision).toBe(2);
    expect(confirmed.previewCommand).toBeNull();
    expect(record.committedCommands).toEqual([move.command]);
    expect(record.committedState).toEqual(record.state);
    expect(record.completedActions).toBe(1);
  });

  it('undo restores the exact base state and remains restored after refresh', async () => {
    const { service, view } = await setup();
    const before = await service.getRecord(view.id);
    const move = view.legalActions.find((action) => action.command.type === 'baselineMove')!;
    const preview = await service.previewHumanAction(view.id, 0, move.id);
    const undone = await service.undoHumanAction(view.id, preview.revision);
    const after = await service.getRecord(view.id);
    expect(after.state).toEqual(before.state);
    expect(after.draft.command).toBeNull();
    expect(undone.round).toEqual(view.round);
    expect((await service.get(view.id))).toEqual(undone);
  });

  it('rejects stale preview, confirm, and undo revisions without changing the record', async () => {
    const { repository, service, view } = await setup();
    const move = view.legalActions.find((action) => action.command.type === 'baselineMove')!;
    const preview = await service.previewHumanAction(view.id, 0, move.id);
    const snapshot = await service.getRecord(view.id);
    const saves = repository.saves;
    await expect(service.confirmHumanAction(view.id, 0)).rejects.toThrow(ConflictError);
    await expect(service.undoHumanAction(view.id, 0)).rejects.toThrow(ConflictError);
    await expect(service.previewHumanAction(view.id, 0, move.id)).rejects.toThrow(ConflictError);
    expect(repository.saves).toBe(saves);
    expect(await service.getRecord(view.id)).toEqual(snapshot);
    expect(preview.previewCommand).toEqual(move.command);
  });

  it('previews and confirms pass and both purchase choices through the same boundary', async () => {
    const { service, view } = await setup();
    let current = view;
    const humanPass = current.legalActions.find((action) => action.command.type === 'pass')!;
    current = await service.previewHumanAction(view.id, current.revision, humanPass.id);
    current = await service.confirmHumanAction(view.id, current.revision);
    const record = await service.getRecord(view.id);
    const aiPass = listLegalActions(record.state).find((action) => action.command.type === 'pass')!;
    current = await service.commitAiAction(view.id, current.revision, aiPass.id, aiPass.label, 0);
    expect(current.phase).toBe('purchase');
    expect(current.activePlayerId).toBe(current.humanPlayerId);
    const buyNothing = current.legalActions.find((action) => action.command.type === 'skipPurchase')!;
    current = await service.previewHumanAction(view.id, current.revision, buyNothing.id);
    current = await service.confirmHumanAction(view.id, current.revision);
    expect(current.activePlayerId).toBe(current.aiPlayerId);
    const aiRecord = await service.getRecord(view.id);
    const aiPurchase = listLegalActions(aiRecord.state).find((action) => action.command.type === 'skipPurchase')!;
    current = await service.commitAiAction(view.id, current.revision, aiPurchase.id, aiPurchase.label, 0);
    expect(current.round.number).toBe(2);
    expect((await service.getRecord(view.id)).committedCommands.map((command) => command.type)).toEqual([
      'pass', 'pass', 'skipPurchase', 'skipPurchase'
    ]);
  });
});

describe('one enumerated AI action per decision', () => {
  it('briefs at least 40 complete opaque choices without exposing command construction', async () => {
    const { repository, service, view } = await setup();
    repository.seed((record) => {
      record.state.activePlayerId = record.aiPlayerId;
      clearHands(record.state);
      for (let index = 0; index < 10; index += 1) addCard(record.state, record.aiPlayerId, index < 3 ? 'cull' : 'copper');
      syncRecordState(record);
    });
    const record = await service.getRecord(view.id);
    const briefing = buildAiBriefing(record.state, record.aiPlayerId);
    expect(briefing.legalActions.length).toBeGreaterThanOrEqual(40);
    expect(briefing.legalActions[0]).toEqual({ id: expect.stringMatching(/^v\d+-action-\d+$/), summary: expect.any(String) });
    expect(Object.keys(briefing.legalActions[0]!)).toEqual(['id', 'summary']);
  });

  it('rejects an old, missing, or invented action ID without changing saved state', async () => {
    const { repository, service, view } = await setup();
    repository.seed((record) => { record.state.activePlayerId = record.aiPlayerId; syncRecordState(record); });
    const before = await service.getRecord(view.id);
    await expect(service.commitAiAction(view.id, before.revision, 'invented-action', '', 0)).rejects.toThrow('unknown or stale');
    await expect(service.commitAiAction(view.id, before.revision + 1, listLegalActions(before.state)[0]!.id, '', 0)).rejects.toThrow(ConflictError);
    expect(await service.getRecord(view.id)).toEqual(before);
  });

  it('forces an immediate point and an immediate match win', async () => {
    const { repository, service, view } = await setup();
    repository.seed((record) => {
      record.state.activePlayerId = record.aiPlayerId; clearHands(record.state); addCard(record.state, record.aiPlayerId, 'shove');
      setPosition(record.state, 'indigo-a', 2, 0); setPosition(record.state, 'ochre-a', 3, 0);
      setPosition(record.state, 'indigo-b', -2, 0); setPosition(record.state, 'ochre-b', 0, 2);
      syncRecordState(record);
    });
    let record = await service.getRecord(view.id);
    const pass = listLegalActions(record.state).find((action) => action.command.type === 'pass')!;
    await expect(service.commitAiAction(view.id, record.revision, pass.id, '', 0)).rejects.toThrow('immediate point');
    const scoring = listLegalActions(record.state).find((action) => {
      const next = applyAction(record.state, action.id);
      return next.scores.indigo === 1;
    })!;
    await service.commitAiAction(view.id, record.revision, scoring.id, scoring.label, 0);

    repository.seed((saved) => {
      saved.state.activePlayerId = saved.aiPlayerId; saved.state.scores.indigo = 4;
      clearHands(saved.state); addCard(saved.state, saved.aiPlayerId, 'shove');
      setPosition(saved.state, 'indigo-a', 2, 0); setPosition(saved.state, 'ochre-a', 3, 0);
      setPosition(saved.state, 'indigo-b', -2, 0); setPosition(saved.state, 'ochre-b', 0, 2);
      syncRecordState(saved);
    });
    record = await service.getRecord(view.id);
    const nonWin = listLegalActions(record.state).find((action) => applyAction(record.state, action.id).winner !== 'indigo')!;
    await expect(service.commitAiAction(view.id, record.revision, nonWin.id, '', 0)).rejects.toThrow('match win');
  });

  it('can pass with no point, acts repeatedly after human passes, and purchases exactly once', async () => {
    const { repository, service, view } = await setup();
    repository.seed((record) => { record.state.activePlayerId = record.aiPlayerId; syncRecordState(record); });
    let record = await service.getRecord(view.id);
    const pass = listLegalActions(record.state).find((action) => action.command.type === 'pass')!;
    const passed = await service.commitAiAction(view.id, record.revision, pass.id, pass.label, 0);
    expect(passed.round.passedPlayerIds).toContain(passed.aiPlayerId);

    repository.seed((saved) => {
      saved.state = cloneGame(saved.initialState);
      saved.state.activePlayerId = saved.aiPlayerId;
      saved.state.round.passedPlayerIds = ['ochre'];
      syncRecordState(saved);
    });
    record = await service.getRecord(view.id);
    const firstId = chooseFakeAction(record);
    const first = await service.commitAiAction(view.id, record.revision, firstId, 'first', 0);
    expect(first.activePlayerId).toBe(first.aiPlayerId);
    expect(first.round.passedPlayerIds).toEqual(['ochre']);
    record = await service.getRecord(view.id);
    const secondId = chooseFakeAction(record);
    const second = await service.commitAiAction(view.id, record.revision, secondId, 'second', 0);
    expect(second.activePlayerId).toBe(second.aiPlayerId);

    repository.seed((saved) => {
      saved.state.phase = 'purchase'; saved.state.activePlayerId = saved.aiPlayerId;
      saved.state.round.purchaseOrder = [saved.aiPlayerId, saved.humanPlayerId]; saved.state.round.purchaseIndex = 0;
      saved.state.players[saved.aiPlayerId].money = 3; saved.state.players[saved.aiPlayerId].buys = 1;
      syncRecordState(saved);
    });
    record = await service.getRecord(view.id);
    const buy = listLegalActions(record.state).find((action) => action.command.type === 'buyCard' && action.command.definitionId === 'silver')!;
    const bought = await service.commitAiAction(view.id, record.revision, buy.id, buy.label, 0);
    expect(bought.activePlayerId).toBe(bought.humanPlayerId);
    expect((await service.getRecord(view.id)).committedCommands.at(-1)).toEqual({ type: 'buyCard', definitionId: 'silver' });
  });

  it('coordinator exposes a retryable error and leaves the game unchanged', async () => {
    const { repository, service, view } = await setup();
    repository.seed((record) => { record.state.activePlayerId = record.aiPlayerId; syncRecordState(record); });
    const before = await service.getRecord(view.id);
    let fail = true;
    const coordinator = new AiTurnCoordinator(service, {
      run: async (record) => {
        if (fail) { fail = false; throw new Error('model unavailable'); }
        return { baseRevision: record.revision, actionId: chooseFakeAction(record), summary: 'recovered', durationSeconds: 0 };
      }
    });
    await coordinator.start(view.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await coordinator.status(view.id)).toEqual({ status: 'error', error: 'model unavailable' });
    expect(await service.getRecord(view.id)).toEqual(before);
    await coordinator.start(view.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await coordinator.status(view.id)).status).toBe('complete');
    expect((await coordinator.status(view.id)).status).toBe('idle');
    expect((await service.getRecord(view.id)).committedCommands).toHaveLength(1);
  });
});
