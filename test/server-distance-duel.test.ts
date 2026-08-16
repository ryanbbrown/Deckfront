import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCard, listActionAvailability, listLegalActions } from '../src/game';
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
  it('rejects an unknown build card without changing proposal, revision, or state', async () => {
    const { service, game } = await setup(); const before = await service.getRecord(game.id);
    await expect(service.updateHumanBuild(game.id, game.revision, ['invented-card'], false)).rejects.toThrow('unknown card');
    const after = await service.getRecord(game.id); expect(after.revision).toBe(before.revision); expect(after.humanBuildProposal).toEqual([]); expect(after.state).toEqual(before.state);
  });
  it('exposes the same availability reason codes through the game module and safe view at every range', async () => {
    for (const [positions, expected] of [
      [[2, 3], [null, 'NEEDS_MID_OR_FAR', null]],
      [[2, 4], ['NEEDS_CLOSE', null, 'NEEDS_CLOSE']],
      [[1, 5], ['NEEDS_CLOSE', null, 'NEEDS_CLOSE']]
    ] as const) {
      const { repository, service, game } = await setup(); const humanBuild = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0); const record = await repository.load(game.id); const deck = record.state.players.ochre.deck;
      record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play); deck.draw = []; deck.discard = []; deck.play = []; deck.hand = ['feint', 'aim', 'vault'].map((id) => createCard(record.state, id)); record.state.fighters.ochre.position = positions[0]; record.state.fighters.indigo.position = positions[1]; record.initialState = structuredClone(record.state); record.committedState = structuredClone(record.state); record.committedCommands = []; record.draft = { baseVersion: record.state.version, baseState: structuredClone(record.state), command: null }; await repository.save(record);
      const domain = listActionAvailability(record.state, 'ochre').map((entry) => entry.reasonCode); const safe = (await service.get(game.id)).actionAvailability.map((entry) => entry.reasonCode); expect(domain).toEqual(expected); expect(safe).toEqual(expected);
    }
  });
  it('continues a seeded persisted fixture while redacting preview draws and preserving replay', async () => {
    const { repository, service, game } = await setup(); const humanBuild = await service.updateHumanBuild(game.id, 0, ['footwork'], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0);
    const record = await repository.load(game.id); const human = record.state.players.ochre; record.state.trash.push(...human.deck.draw, ...human.deck.hand, ...human.deck.discard, ...human.deck.play); human.deck.draw = [createCard(record.state, 'volley')]; human.deck.hand = [createCard(record.state, 'footwork')]; human.deck.discard = []; human.deck.play = [];
    record.initialState = structuredClone(record.state); record.committedState = structuredClone(record.state); record.committedCommands = []; record.draft = { baseVersion: record.state.version, baseState: structuredClone(record.state), command: null }; await repository.save(record);
    const loaded = await service.get(game.id); const footwork = loaded.legalActions.find((action) => action.command.type === 'playFootwork' && action.command.movement === 'advance')!;
    const realDrawId = record.state.players.ochre.deck.draw[0]!.id;
    const preview = await service.previewHumanAction(game.id, loaded.revision, footwork.id); expect(preview.previewHidesDraws).toBe(true); expect(preview.players.ochre.hand).toEqual([{ id: 'hidden-1', definitionId: null }]);
    expect(JSON.stringify(preview)).not.toContain(realDrawId); expect(JSON.stringify(preview.players.ochre.hand)).not.toContain('volley');
    const undone = await service.undoHumanAction(game.id, preview.revision); expect(undone.players.ochre.hand?.[0]?.definitionId).toBe('footwork');
    const previewAgain = await service.previewHumanAction(game.id, undone.revision, undone.legalActions.find((action) => action.command.type === 'playFootwork' && action.command.movement === 'advance')!.id);
    const confirmed = await service.confirmHumanAction(game.id, previewAgain.revision); expect(confirmed.players.ochre.hand?.[0]?.definitionId).toBe('volley');
  });
  it('redacts every Buy-completion draw even when a base-hand card is discarded and redrawn', async () => {
    const { repository, service, game } = await setup(); const humanBuild = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0);
    const record = await repository.load(game.id); const deck = record.state.players.ochre.deck; record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play);
    deck.draw = []; deck.discard = []; deck.play = []; deck.hand = ['aim', 'volley'].map((definitionId, index) => ({ id: `REDRAW-SENTINEL-${index + 1}`, definitionId })); record.state.nextCardSerial += 2;
    record.state.phase = 'buy'; record.initialState = structuredClone(record.state); record.committedState = structuredClone(record.state); record.committedCommands = []; record.draft = { baseVersion: record.state.version, baseState: structuredClone(record.state), command: null }; await repository.save(record);
    const loaded = await service.get(game.id); const end = loaded.legalActions.find((entry) => entry.command.type === 'endBuyPhase')!; const preview = await service.previewHumanAction(game.id, loaded.revision, end.id);
    expect(preview.players.ochre.hand).toEqual([{ id: 'hidden-1', definitionId: null }, { id: 'hidden-2', definitionId: null }]); const serializedHand = JSON.stringify(preview.players.ochre.hand); expect(serializedHand).not.toContain('REDRAW-SENTINEL'); expect(serializedHand).not.toContain('aim'); expect(serializedHand).not.toContain('volley'); await expect(service.previewHumanAction(game.id, preview.revision, end.id)).rejects.toThrow('Confirm or undo');
    const undone = await service.undoHumanAction(game.id, preview.revision); expect(undone.players.ochre.hand?.map((card) => card.id)).toEqual(['REDRAW-SENTINEL-1', 'REDRAW-SENTINEL-2']);
    const previewAgain = await service.previewHumanAction(game.id, undone.revision, undone.legalActions.find((entry) => entry.command.type === 'endBuyPhase')!.id); const confirmed = await service.confirmHumanAction(game.id, previewAgain.revision); expect(confirmed.players.ochre.hand?.map((card) => card.definitionId).sort()).toEqual(['aim', 'volley']);
  });
  it('uses the same opaque placeholder shape for different underlying draws', async () => {
    const placeholders: unknown[] = [];
    for (const definitionId of ['aim', 'volley']) {
      const { repository, service, game } = await setup(); const humanBuild = await service.updateHumanBuild(game.id, 0, ['footwork'], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0);
      const record = await repository.load(game.id); const deck = record.state.players.ochre.deck; record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play); deck.draw = [createCard(record.state, definitionId)]; deck.hand = [createCard(record.state, 'footwork')]; deck.discard = []; deck.play = []; record.initialState = structuredClone(record.state); record.committedState = structuredClone(record.state); record.committedCommands = []; record.draft = { baseVersion: record.state.version, baseState: structuredClone(record.state), command: null }; await repository.save(record);
      const loaded = await service.get(game.id); const action = loaded.legalActions.find((entry) => entry.command.type === 'playFootwork' && entry.command.movement === 'advance')!; placeholders.push((await service.previewHumanAction(game.id, loaded.revision, action.id)).players.ochre.hand);
    }
    expect(placeholders[0]).toEqual(placeholders[1]); expect(placeholders[0]).toEqual([{ id: 'hidden-1', definitionId: null }]);
  });
  it('public export omits sentinel private cards and ordered draw arrays', async () => {
    const { repository, service, game } = await setup(); const humanBuild = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0);
    const record = await repository.load(game.id); record.state.players.indigo.deck.hand[0]!.id = 'AI-PRIVATE-SENTINEL'; record.state.players.indigo.deck.draw[0]!.id = 'AI-DRAW-SENTINEL'; await repository.save(record);
    const exported = JSON.stringify(await service.redactedExport(game.id)); expect(exported).not.toContain('AI-PRIVATE-SENTINEL'); expect(exported).not.toContain('AI-DRAW-SENTINEL');
  });
});

describe('server-owned AI sequence', () => {
  it('rejects invented and stale AI action IDs without changing committed state', async () => {
    const { service, game } = await setup('indigo'); const human = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, human.revision, [], 'build', 0);
    const beforeInvented = await service.getRecord(game.id); await expect(service.commitAiAction(game.id, beforeInvented.revision, 'invented-action', 'bad', 0, 0)).rejects.toThrow('unknown or stale'); const afterInvented = await service.getRecord(game.id);
    expect(afterInvented.revision).toBe(beforeInvented.revision); expect(afterInvented.state).toEqual(beforeInvented.state); expect(afterInvented.committedCommands).toEqual(beforeInvented.committedCommands);
    const staleAction = listLegalActions(afterInvented.state).find((entry) => entry.command.type === 'endActionPhase')!; await service.commitAiAction(game.id, afterInvented.revision, staleAction.id, 'end', 0, 0); const beforeStale = await service.getRecord(game.id);
    await expect(service.commitAiAction(game.id, beforeStale.revision, staleAction.id, 'stale', 0, 1)).rejects.toThrow('unknown or stale'); const afterStale = await service.getRecord(game.id); expect(afterStale.revision).toBe(beforeStale.revision); expect(afterStale.state).toEqual(beforeStale.state); expect(afterStale.committedCommands).toEqual(beforeStale.committedCommands);
  });
  it('replans after a draw, plays another Action, buys several paid cards, and ends one server-owned turn', async () => {
    const { repository, service, game } = await setup('indigo'); const human = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, human.revision, [], 'build', 0); const record = await repository.load(game.id); const deck = record.state.players.indigo.deck;
    record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play); deck.hand = ['muster', 'copper', 'copper', 'copper', 'copper', 'copper'].map((id) => createCard(record.state, id)); deck.draw = [createCard(record.state, 'aim')]; deck.discard = []; deck.play = []; record.state.players.indigo.firstBuyMoney = 0; record.state.players.indigo.firstBuyPending = false; record.state.players.indigo.purchases = []; record.initialState = structuredClone(record.state); record.committedState = structuredClone(record.state); record.committedCommands = []; record.draft = { baseVersion: record.state.version, baseState: structuredClone(record.state), command: null }; record.aiActions = []; await repository.save(record);
    const observedHands: string[][] = []; const runner = { async run(current: GameRecord): Promise<AiRunResult> {
      observedHands.push(current.state.players.indigo.deck.hand.map((card) => card.definitionId)); const actions = listLegalActions(current.state); let selected;
      if (current.state.phase === 'action') selected = actions.find((entry) => entry.command.type === (current.state.players.indigo.deck.hand.some((card) => card.definitionId === 'muster') ? 'playMuster' : current.state.players.indigo.deck.hand.some((card) => card.definitionId === 'aim') ? 'playAim' : 'endActionPhase'));
      else selected = actions.find((entry) => entry.command.type === 'buyCard' && entry.command.definitionId === (!current.state.players.indigo.purchases.includes('silver') ? 'silver' : !current.state.players.indigo.purchases.includes('footwork') ? 'footwork' : '')) ?? actions.find((entry) => entry.command.type === 'endBuyPhase');
      return { schemaVersion: 2, kind: 'action', baseRevision: current.revision, actionId: selected!.id, summary: 'scripted replan', durationSeconds: 0 };
    } };
    const coordinator = new AiTurnCoordinator(service, runner); await coordinator.start(game.id); let status = await coordinator.status(game.id); for (let count = 0; status.status === 'running' && count < 100; count += 1) { await new Promise((resolve) => setTimeout(resolve, 2)); status = await coordinator.status(game.id); }
    expect(status.status).toBe('complete'); expect(observedHands[1]).toContain('aim'); const saved = await service.getRecord(game.id); expect(saved.state.players.indigo.purchases).toEqual(['silver', 'footwork']); expect(saved.state.activePlayerId).toBe('ochre'); expect(saved.committedCommands.map((command) => command.type)).toEqual(['playMuster', 'playAim', 'endActionPhase', 'buyCard', 'buyCard', 'endBuyPhase']);
  });
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

  it('preserves earlier commits and resumes a failed turn without duplicate commands', async () => {
    const { service, game } = await setup('indigo'); const humanBuild = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0); let calls = 0;
    const runner = { async run(record: GameRecord): Promise<AiRunResult> { calls += 1; if (calls === 2) throw new Error('later failure'); const end = listLegalActions(record.state).find((action) => action.command.type === (record.state.phase === 'action' ? 'endActionPhase' : 'endBuyPhase'))!; return { schemaVersion: 2, kind: 'action', baseRevision: record.revision, actionId: end.id, summary: 'end current phase', durationSeconds: 0 }; } };
    const coordinator = new AiTurnCoordinator(service, runner); await coordinator.start(game.id); let status = await coordinator.status(game.id); for (let count = 0; status.status === 'running' && count < 50; count += 1) { await new Promise((resolve) => setTimeout(resolve, 2)); status = await coordinator.status(game.id); }
    expect(status.status).toBe('error'); const failed = await service.getRecord(game.id); expect(failed.state.phase).toBe('buy'); expect(failed.committedCommands.map((command) => command.type).slice(-1)).toEqual(['endActionPhase']);
    await coordinator.start(game.id); status = await coordinator.status(game.id); for (let count = 0; status.status === 'running' && count < 50; count += 1) { await new Promise((resolve) => setTimeout(resolve, 2)); status = await coordinator.status(game.id); }
    expect(status.status).toBe('complete'); const recovered = await service.getRecord(game.id); expect(recovered.state.activePlayerId).toBe('ochre'); expect(recovered.committedCommands.map((command) => command.type).slice(-2)).toEqual(['endActionPhase', 'endBuyPhase']);
  });
});

describe('persistence schema', () => {
  it('serializes concurrent file writes and leaves valid state', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-lock-'));
    try {
      const repository = new FileGameRepository(directory); const service = new GameService(repository); const created = await service.create({ seed: 8, strategyPresetId: 'close-pressure', strategyMarkdown: '# close' });
      await Promise.all([1, 2].map((marker) => repository.withLock(created.id, async () => { const record = await repository.load(created.id); await new Promise((resolve) => setTimeout(resolve, marker === 1 ? 5 : 0)); record.revision += 1; record.updatedAt = new Date(Date.parse(record.updatedAt) + marker * 1000).toISOString(); await repository.save(record); })));
      const saved = await repository.load(created.id); expect(saved.revision).toBe(2); expect(saved.schemaVersion).toBe(3); expect(saved.state.phase).toBe('startingBuild');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects an old save with a specific version message', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-old-')); const id = '11111111-1111-4111-8111-111111111111';
    try { await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ schemaVersion: 2 })); await expect(new FileGameRepository(directory).load(id)).rejects.toBeInstanceOf(UnsupportedSchemaError); await expect(new FileGameRepository(directory).load(id)).rejects.toThrow('schema 2 is not supported'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
