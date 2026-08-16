import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCard, listLegalActions } from '../src/game';
import { AiTurnCoordinator } from '../src/server/aiCoordinator';
import { GameService } from '../src/server/gameService';
import { FileGameRepository, UnsupportedSchemaError } from '../src/server/persistence';
import type { AiRunResult } from '../src/server/aiRunner';
import type { GameRecord, GameRepository } from '../src/server/types';

class MemoryRepository implements GameRepository {
  record: GameRecord | null = null;
  async create(record: GameRecord) { this.record = structuredClone(record); }
  async load(_id: string) { if (!this.record) throw new Error('missing'); return structuredClone(this.record); }
  async save(record: GameRecord) { this.record = structuredClone(record); }
  async withLock<T>(_id: string, work: () => Promise<T>) { return work(); }
}
async function setup(firstPlayerId: 'ochre' | 'indigo' = 'ochre') {
  const repository = new MemoryRepository(); const service = new GameService(repository); const game = await service.create({ seed: 3, firstPlayerId, strategyPresetId: 'ranged-setup', strategyMarkdown: '# Ranged' });
  return { repository, service, game };
}

describe('GameService setup and privacy', () => {
  it('persists a private proposal, rejects stale and post-completion edits, and reveals only after AI completion', async () => {
    const { service, game } = await setup();
    const edited = await service.updateHumanBuild(game.id, 0, ['aim', 'volley'], false); expect(edited.humanBuildProposal).toEqual(['aim', 'volley']); expect(edited.completedBuilds).toBeNull();
    await expect(service.updateHumanBuild(game.id, 0, [], false)).rejects.toThrow('Expected revision');
    const completed = await service.updateHumanBuild(game.id, edited.revision, ['aim', 'volley'], true); expect(completed.phase).toBe('startingBuild'); expect(completed.completedBuilds).toBeNull();
    await expect(service.updateHumanBuild(game.id, completed.revision, [], false)).rejects.toThrow('already complete');
    const revealed = await service.commitAiBuild(game.id, completed.revision, ['feint', 'drive'], 'close build', 0);
    expect(revealed.completedBuilds).toEqual({ ochre: ['aim', 'volley'], indigo: ['feint', 'drive'] }); expect(revealed.players.indigo.hand).toBeNull(); expect(revealed.players.ochre.hand).toHaveLength(5);
  });
  it('redacts new draw identities in preview, restores undo, and reveals on confirm', async () => {
    const { repository, service, game } = await setup(); const humanBuild = await service.updateHumanBuild(game.id, 0, ['footwork'], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0);
    const record = await repository.load(game.id); const human = record.state.players.ochre; record.state.trash.push(...human.deck.draw, ...human.deck.hand, ...human.deck.discard, ...human.deck.play); human.deck.draw = [createCard(record.state, 'volley')]; human.deck.hand = [createCard(record.state, 'footwork')]; human.deck.discard = []; human.deck.play = [];
    record.initialState = structuredClone(record.state); record.committedState = structuredClone(record.state); record.committedCommands = []; record.draft = { baseVersion: record.state.version, baseState: structuredClone(record.state), command: null }; await repository.save(record);
    const loaded = await service.get(game.id); const footwork = loaded.legalActions.find((action) => action.command.type === 'playFootwork' && action.command.movement === 'advance')!;
    const preview = await service.previewHumanAction(game.id, loaded.revision, footwork.id); expect(preview.previewHidesDraws).toBe(true); expect(preview.players.ochre.hand).toEqual([{ id: expect.stringMatching(/^hidden-/), definitionId: null }]);
    const undone = await service.undoHumanAction(game.id, preview.revision); expect(undone.players.ochre.hand?.[0]?.definitionId).toBe('footwork');
    const previewAgain = await service.previewHumanAction(game.id, undone.revision, undone.legalActions.find((action) => action.command.type === 'playFootwork' && action.command.movement === 'advance')!.id);
    const confirmed = await service.confirmHumanAction(game.id, previewAgain.revision); expect(confirmed.players.ochre.hand?.[0]?.definitionId).toBe('volley');
  });
  it('public export omits sentinel private cards and ordered draw arrays', async () => {
    const { repository, service, game } = await setup(); const humanBuild = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0);
    const record = await repository.load(game.id); record.state.players.indigo.deck.hand[0]!.id = 'AI-PRIVATE-SENTINEL'; record.state.players.indigo.deck.draw[0]!.id = 'AI-DRAW-SENTINEL'; await repository.save(record);
    const exported = JSON.stringify(await service.redactedExport(game.id)); expect(exported).not.toContain('AI-PRIVATE-SENTINEL'); expect(exported).not.toContain('AI-DRAW-SENTINEL');
  });
});

describe('server-owned AI sequence', () => {
  it('chooses an independent build and finishes a full AI turn without a browser', async () => {
    const { service, game } = await setup('indigo'); const humanDone = await service.updateHumanBuild(game.id, 0, ['aim', 'volley'], true); const calls: string[] = [];
    const runner = { async run(record: GameRecord): Promise<AiRunResult> {
      calls.push(record.state.phase);
      if (record.state.phase === 'startingBuild') return { schemaVersion: 2, kind: 'build', baseRevision: record.revision, definitionIds: ['footwork', 'feint', 'drive'], summary: 'close', durationSeconds: 0 };
      const desired = record.state.phase === 'action' ? 'endActionPhase' : 'endBuyPhase'; const selected = listLegalActions(record.state).find((action) => action.command.type === desired)!;
      return { schemaVersion: 2, kind: 'action', baseRevision: record.revision, actionId: selected.id, summary: desired, durationSeconds: 0 };
    } };
    const coordinator = new AiTurnCoordinator(service, runner); await coordinator.start(game.id);
    let status = await coordinator.status(game.id); for (let count = 0; status.status === 'running' && count < 50; count += 1) { await new Promise((resolve) => setTimeout(resolve, 2)); status = await coordinator.status(game.id); }
    expect(status.status).toBe('complete'); expect(status.game?.activePlayerId).toBe('ochre'); expect(status.game?.turn).toBe(2); expect(calls).toEqual(['startingBuild', 'action', 'buy']); expect(humanDone.completedBuilds).toBeNull();
  });
  it('limits a free-Copper loop and deterministically ends the phase', async () => {
    const { repository, service, game } = await setup('indigo'); const humanBuild = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0);
    const record = await repository.load(game.id); record.state.phase = 'buy'; record.state.activePlayerId = 'indigo'; record.initialState = structuredClone(record.state); record.committedState = structuredClone(record.state); record.committedCommands = []; record.draft = { baseVersion: record.state.version, baseState: structuredClone(record.state), command: null }; record.aiActions = []; await repository.save(record);
    const runner = { async run(current: GameRecord): Promise<AiRunResult> { const copper = listLegalActions(current.state).find((action) => action.command.type === 'buyCard' && action.command.definitionId === 'copper')!; return { schemaVersion: 2, kind: 'action', baseRevision: current.revision, actionId: copper.id, summary: 'buy copper', durationSeconds: 0 }; } };
    const coordinator = new AiTurnCoordinator(service, runner); await coordinator.start(game.id); let status = await coordinator.status(game.id); for (let count = 0; status.status === 'running' && count < 100; count += 1) { await new Promise((resolve) => setTimeout(resolve, 2)); status = await coordinator.status(game.id); }
    expect(status.status).toBe('complete'); const saved = await service.getRecord(game.id); expect(saved.state.activePlayerId).toBe('ochre'); expect(saved.state.players.indigo.purchases.filter((id) => id === 'copper')).toHaveLength(30); expect(saved.aiActions.at(-1)?.fallback).toBe(true);
  });

  it('preserves earlier commits when a later AI decision fails', async () => {
    const { service, game } = await setup('indigo'); const humanBuild = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0); let calls = 0;
    const runner = { async run(record: GameRecord): Promise<AiRunResult> { calls += 1; if (calls === 2) throw new Error('later failure'); const end = listLegalActions(record.state).find((action) => action.command.type === 'endActionPhase')!; return { schemaVersion: 2, kind: 'action', baseRevision: record.revision, actionId: end.id, summary: 'end actions', durationSeconds: 0 }; } };
    const coordinator = new AiTurnCoordinator(service, runner); await coordinator.start(game.id); let status = await coordinator.status(game.id); for (let count = 0; status.status === 'running' && count < 50; count += 1) { await new Promise((resolve) => setTimeout(resolve, 2)); status = await coordinator.status(game.id); }
    expect(status.status).toBe('error'); const record = await service.getRecord(game.id); expect(record.state.phase).toBe('buy'); expect(record.committedCommands.at(-1)?.type).toBe('endActionPhase');
  });
});

describe('persistence schema', () => {
  it('rejects an old save with a specific version message', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-old-')); const id = '11111111-1111-4111-8111-111111111111';
    try { await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ schemaVersion: 2 })); await expect(new FileGameRepository(directory).load(id)).rejects.toBeInstanceOf(UnsupportedSchemaError); await expect(new FileGameRepository(directory).load(id)).rejects.toThrow('schema 2 is not supported'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
