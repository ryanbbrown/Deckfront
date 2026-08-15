import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, cloneGame, listLegalActions } from '../src/game';
import type { GameRecord, GameRepository } from '../src/server/types';
import { AiTurnCoordinator } from '../src/server/aiCoordinator';
import { chooseFakeAction, ThinHarnessAiRunner } from '../src/server/aiRunner';
import { ConflictError, GameService } from '../src/server/gameService';
import { buildAiBriefing } from '../src/ai/briefing';
import { addCard, clearHands, setPosition } from './helpers';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

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

  it('persists a passed owner respawn through purchases and refresh until its next action', async () => {
    const { repository, service, view } = await setup();
    repository.seed((record) => {
      clearHands(record.state); addCard(record.state, 'indigo', 'shove');
      setPosition(record.state, 'indigo-a', 2, 0); setPosition(record.state, 'ochre-a', 3, 0);
      setPosition(record.state, 'indigo-b', -2, 0); setPosition(record.state, 'ochre-b', 0, 2);
      syncRecordState(record);
    });
    let current = await service.get(view.id);
    const humanPass = current.legalActions.find((action) => action.command.type === 'pass')!;
    current = await service.previewHumanAction(view.id, current.revision, humanPass.id);
    current = await service.confirmHumanAction(view.id, current.revision);
    let record = await service.getRecord(view.id);
    const shove = listLegalActions(record.state).find((action) => action.command.type === 'playShove' && action.command.targetId === 'ochre-a')!;
    current = await service.commitAiAction(view.id, current.revision, shove.id, shove.label, 0);
    record = await service.getRecord(view.id);
    const aiPass = listLegalActions(record.state).find((action) => action.command.type === 'pass')!;
    current = await service.commitAiAction(view.id, current.revision, aiPass.id, aiPass.label, 0);
    expect(current.phase).toBe('purchase');
    expect(current.pieces['ochre-a'].needsRespawn).toBe(true);
    expect((await service.get(view.id)).pieces['ochre-a'].needsRespawn).toBe(true);
    const humanSkip = current.legalActions.find((action) => action.command.type === 'skipPurchase')!;
    current = await service.previewHumanAction(view.id, current.revision, humanSkip.id);
    current = await service.confirmHumanAction(view.id, current.revision);
    record = await service.getRecord(view.id);
    const aiSkip = listLegalActions(record.state).find((action) => action.command.type === 'skipPurchase')!;
    current = await service.commitAiAction(view.id, current.revision, aiSkip.id, aiSkip.label, 0);
    expect(current.round.number).toBe(2);
    expect(current.pieces['ochre-a'].needsRespawn).toBe(true);
    record = await service.getRecord(view.id);
    const aiMove = listLegalActions(record.state).find((action) => action.command.type === 'baselineMove')!;
    current = await service.commitAiAction(view.id, current.revision, aiMove.id, aiMove.label, 0);
    expect(current.activePlayerId).toBe(current.humanPlayerId);
    expect(current.pieces['ochre-a'].needsRespawn).toBe(false);
    expect(current.pieces['ochre-a'].baselineMoves).toBe(1);
    expect((await service.get(view.id)).pieces['ochre-a']).toEqual(current.pieces['ochre-a']);
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

  it('accepts a zero-point non-pass action when another action can score', async () => {
    const { repository, service, view } = await setup();
    repository.seed((record) => {
      record.state.activePlayerId = record.aiPlayerId; clearHands(record.state); addCard(record.state, record.aiPlayerId, 'shove');
      setPosition(record.state, 'indigo-a', 2, 0); setPosition(record.state, 'ochre-a', 3, 0);
      setPosition(record.state, 'indigo-b', -2, 0); setPosition(record.state, 'ochre-b', 0, 2);
      syncRecordState(record);
    });
    const record = await service.getRecord(view.id);
    const zeroPointMove = listLegalActions(record.state).find((action) => {
      if (action.command.type !== 'baselineMove' || action.command.pieceId !== 'indigo-b') return false;
      return applyAction(record.state, action.id).scores.indigo === record.state.scores.indigo;
    })!;
    const committed = await service.commitAiAction(view.id, record.revision, zeroPointMove.id, zeroPointMove.label, 0);
    expect(committed.scores.indigo).toBe(0);
    expect((await service.getRecord(view.id)).committedCommands).toEqual([zeroPointMove.command]);
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

  it('does not invoke the AI runner while a human preview awaits confirmation', async () => {
    const { service, view } = await setup();
    const move = view.legalActions.find((action) => action.command.type === 'baselineMove')!;
    const preview = await service.previewHumanAction(view.id, view.revision, move.id);
    let calls = 0;
    const coordinator = new AiTurnCoordinator(service, {
      run: async (record) => {
        calls += 1;
        return { baseRevision: record.revision, actionId: chooseFakeAction(record), summary: 'confirmed boundary', durationSeconds: 0 };
      }
    });
    await expect(coordinator.start(view.id)).rejects.toThrow('Confirm or undo');
    expect(calls).toBe(0);
    expect((await service.getRecord(view.id)).draft.command).toEqual(move.command);
    await service.confirmHumanAction(view.id, preview.revision);
    await expect(coordinator.start(view.id)).resolves.toEqual({ status: 'running' });
    await expect.poll(async () => (await coordinator.status(view.id)).status).toBe('complete');
    expect(calls).toBe(1);
  });
});

describe('AI traces report the final server outcome', () => {
  async function traceRunner(fakeRejectOnce = false): Promise<{ directory: string; runner: ThinHarnessAiRunner }> {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-traces-'));
    temporaryDirectories.push(directory);
    return {
      directory,
      runner: new ThinHarnessAiRunner({
        projectRoot: path.resolve('.'), traceDirectory: directory, model: 'openai:gpt-5.6-luna', effort: 'low',
        timeoutMilliseconds: 30_000, fakeModel: true, fakeRejectOnce
      })
    };
  }

  async function waitForTerminal(coordinator: AiTurnCoordinator, id: string): Promise<'complete' | 'error'> {
    let status = await coordinator.status(id);
    for (let attempt = 0; attempt < 100 && status.status === 'running'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      status = await coordinator.status(id);
    }
    if (status.status !== 'complete' && status.status !== 'error') throw new Error(`Unexpected AI status ${status.status}.`);
    return status.status;
  }

  async function readTrace(directory: string, id: string, revision = 0): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(path.join(directory, id, `${revision}.json`), 'utf8')) as Record<string, unknown>;
  }

  it('marks an unknown action trace as a server error', async () => {
    const { repository, service, view } = await setup();
    repository.seed((record) => { record.state.activePlayerId = record.aiPlayerId; syncRecordState(record); });
    const { directory, runner } = await traceRunner(true);
    const coordinator = new AiTurnCoordinator(service, runner);
    await coordinator.start(view.id);
    expect(await waitForTerminal(coordinator, view.id)).toBe('error');
    const trace = await readTrace(directory, view.id);
    expect(trace.status).toBe('error');
    expect(trace.failure).toBe('The AI returned an unknown or stale action ID.');
    expect(trace.serverOutcome).toEqual({ status: 'error', failure: trace.failure });
    expect((await service.getRecord(view.id)).committedCommands).toEqual([]);
  });

  it('marks a stale choice trace as an error', async () => {
    const { repository, service, view } = await setup();
    repository.seed((record) => { record.state.activePlayerId = record.aiPlayerId; syncRecordState(record); });
    const { directory, runner: finalizer } = await traceRunner();
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const coordinator = new AiTurnCoordinator(service, {
      run: async (record) => {
        const tracePath = path.join(directory, record.id, `${record.revision}.json`);
        await mkdir(path.dirname(tracePath), { recursive: true });
        await writeFile(tracePath, JSON.stringify({ schemaVersion: 2, round: record.state.round.number, actionStep: record.state.round.actionStep, revision: record.revision, prompt: {}, tools: ['choose_action'], result: { actionId: chooseFakeAction(record) }, durationSeconds: 0, status: 'awaiting-server-validation' }));
        await paused;
        return { baseRevision: record.revision, actionId: chooseFakeAction(record), summary: 'stale', durationSeconds: 0, tracePath };
      },
      finalize: finalizer.finalize.bind(finalizer)
    });
    await coordinator.start(view.id);
    repository.seed((record) => { record.revision += 1; });
    release();
    expect(await waitForTerminal(coordinator, view.id)).toBe('error');
    const trace = await readTrace(directory, view.id);
    expect(trace.status).toBe('error');
    expect(trace.failure).toContain('Expected revision 0, but current revision is 1');
    expect((trace.serverOutcome as { status: string }).status).toBe('error');
  });

  it('marks correctness rejection as an error and one committed choice as complete', async () => {
    for (const rejectPass of [true, false]) {
      const { repository, service, view } = await setup();
      repository.seed((record) => {
        record.state.activePlayerId = record.aiPlayerId; clearHands(record.state); addCard(record.state, record.aiPlayerId, 'shove');
        setPosition(record.state, 'indigo-a', 2, 0); setPosition(record.state, 'ochre-a', 3, 0);
        setPosition(record.state, 'indigo-b', -2, 0); setPosition(record.state, 'ochre-b', 0, 2);
        syncRecordState(record);
      });
      const { directory, runner: finalizer } = await traceRunner();
      const coordinator = new AiTurnCoordinator(service, {
        run: async (record) => {
          const action = rejectPass
            ? listLegalActions(record.state).find((candidate) => candidate.command.type === 'pass')!
            : listLegalActions(record.state).find((candidate) => applyAction(record.state, candidate.id).scores.indigo === 1)!;
          const tracePath = path.join(directory, record.id, `${record.revision}.json`);
          await mkdir(path.dirname(tracePath), { recursive: true });
          await writeFile(tracePath, JSON.stringify({ schemaVersion: 2, round: record.state.round.number, actionStep: record.state.round.actionStep, revision: record.revision, prompt: {}, tools: ['choose_action'], result: { actionId: action.id }, durationSeconds: 0, status: 'awaiting-server-validation' }));
          return { baseRevision: record.revision, actionId: action.id, summary: action.label, durationSeconds: 0, tracePath };
        },
        finalize: finalizer.finalize.bind(finalizer)
      });
      await coordinator.start(view.id);
      expect(await waitForTerminal(coordinator, view.id)).toBe(rejectPass ? 'error' : 'complete');
      const trace = await readTrace(directory, view.id);
      if (rejectPass) {
        expect(trace.status).toBe('error');
        expect(trace.failure).toBe('AI cannot pass when an immediate point is available.');
        expect((await service.getRecord(view.id)).committedCommands).toEqual([]);
      } else {
        expect(trace.status).toBe('complete');
        expect(trace.serverOutcome).toEqual({ status: 'complete', committedRevision: 1 });
        expect((await service.getRecord(view.id)).committedCommands).toHaveLength(1);
      }
    }
  });
});
