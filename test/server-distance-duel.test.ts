import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCard } from '../src/game';
import { GameService } from '../src/server/gameService';
import { FileGameRepository, UnsupportedSchemaError } from '../src/server/persistence';
import type { GameRecord, GameRepository } from '../src/server/types';

class MemoryRepository implements GameRepository {
  record: GameRecord | null = null;
  async create(record: GameRecord) { this.record = structuredClone(record); }
  async load(_id: string) { if (!this.record) throw new Error('missing'); return structuredClone(this.record); }
  async save(record: GameRecord) { this.record = structuredClone(record); }
  async withLock<T>(_id: string, work: () => Promise<T>) { return work(); }
}
async function setup(firstPlayerId: 'ochre' | 'indigo' = 'ochre') {
  const repository = new MemoryRepository(); const service = new GameService(repository);
  const game = await service.create({ seed: 3, firstPlayerId }); return { repository, service, game };
}
function resetReplay(record: GameRecord): void { record.initialState = structuredClone(record.state); record.committedCommands = []; record.undoCheckpoint = null; }
function seedPlayerHand(record: GameRecord, definitions: string[], draw: string[] = []): void {
  const deck = record.state.players.ochre.deck; record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play);
  deck.draw = draw.map((id) => createCard(record.state, id)); deck.hand = definitions.map((id) => createCard(record.state, id)); deck.discard = []; deck.play = [];
}
async function completeBuilds(service: GameService, id: string, revision: number) {
  const one = await service.updateBuild(id, revision, [], true); return service.updateBuild(id, one.revision, [], true);
}

describe('local GameService', () => {
  it('runs two sequential builds and gives both players complete turns', async () => {
    const { service, game } = await setup('indigo'); expect(game.activePlayerId).toBe('ochre');
    const playerOne = await service.updateBuild(game.id, game.revision, ['footwork'], true);
    expect(playerOne).toMatchObject({ phase: 'startingBuild', activePlayerId: 'indigo', buildProposal: [] });
    const playerTwo = await service.updateBuild(game.id, playerOne.revision, ['aim', 'volley'], true);
    expect(playerTwo).toMatchObject({ phase: 'action', activePlayerId: 'indigo' });
    expect(playerTwo.completedBuilds).toEqual({ ochre: ['footwork'], indigo: ['aim', 'volley'] });
    expect(playerTwo.players.ochre.hand).toHaveLength(5); expect(playerTwo.players.indigo.hand).toHaveLength(5);
    const buy = await service.commitAction(game.id, playerTwo.revision, playerTwo.actions.phases.find((action) => action.kind === 'endAction')!.id);
    const next = await service.commitAction(game.id, buy.revision, buy.actions.phases.find((action) => action.kind === 'endBuy')!.id);
    expect(next).toMatchObject({ activePlayerId: 'ochre', phase: 'action', turn: 2 });
  });
  it('persists build edits and rejects stale, unknown, unavailable, and completed edits', async () => {
    const { service, game } = await setup(); const edited = await service.updateBuild(game.id, 0, ['aim', 'volley'], false);
    expect(edited.buildProposal).toEqual(['aim', 'volley']);
    await expect(service.updateBuild(game.id, 0, [], false)).rejects.toThrow('Expected revision');
    await expect(service.updateBuild(game.id, edited.revision, ['invented-card'], false)).rejects.toThrow('unknown card');
    await expect(service.updateBuild(game.id, edited.revision, ['starfire'], false)).rejects.toThrow('does not sell');
    const completed = await service.updateBuild(game.id, edited.revision, ['aim'], true);
    await service.updateBuild(game.id, completed.revision, [], true);
    await expect(service.updateBuild(game.id, completed.revision + 1, [], false)).rejects.toThrow('already complete');
  });
  it('projects disabled reasons and renderable movement choices without engine commands', async () => {
    const { repository, service, game } = await setup(); await completeBuilds(service, game.id, game.revision);
    const record = await repository.load(game.id); seedPlayerHand(record, ['feint', 'footwork', 'drive']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; resetReplay(record); await repository.save(record);
    const view = await service.get(game.id); expect(view.players.ochre.hand.map((card) => card.definitionId)).toEqual(['feint', 'footwork', 'drive']);
    expect(view.players.indigo.hand).toHaveLength(5);
    expect(view.actions.cards[0]).toMatchObject({ enabled: false, reason: 'Requires Close range.', selection: 'none' });
    expect(view.actions.cards[1]).toMatchObject({ enabled: true, selection: 'movement' });
    expect(view.actions.cards[1]!.choices.map((choice) => ({ label: choice.label, text: choice.text }))).toEqual([
      { label: 'Play Footwork: Left', text: 'Left' }, { label: 'Play Footwork: Stay', text: 'Stay' },
      { label: 'Play Footwork: Right', text: 'Right' }
    ]);
    expect(JSON.stringify(view.actions)).not.toContain('command');
  });
  it('projects Cull target combinations, phase choices, and market buys by definition id', async () => {
    const { repository, service, game } = await setup(); await completeBuilds(service, game.id, game.revision);
    const record = await repository.load(game.id); seedPlayerHand(record, ['cull', 'copper', 'silver']); resetReplay(record); await repository.save(record);
    const view = await service.get(game.id); const cull = view.actions.cards[0]!;
    expect(cull).toMatchObject({ enabled: true, selection: 'trashOneOrTwo' });
    expect(cull.eligibleCardInstanceIds).toEqual(record.state.players.ochre.deck.hand.map((card) => card.id));
    expect(cull.choices.some((choice) => choice.targetCardInstanceIds.length === 1)).toBe(true);
    expect(cull.choices.some((choice) => choice.targetCardInstanceIds.length === 2)).toBe(true);
    const buy = await service.commitAction(game.id, view.revision, view.actions.phases.find((action) => action.kind === 'endAction')!.id);
    expect(buy.actions.phases.map((action) => action.kind)).toEqual(['endBuy']);
    expect(buy.actions.buys.map((action) => action.definitionId)).toContain('copper');
  });
  it('commits an action, persists replay data, and restores the exact state with one undo', async () => {
    const { repository, service, game } = await setup(); await completeBuilds(service, game.id, game.revision);
    const record = await repository.load(game.id); seedPlayerHand(record, ['footwork'], ['aim']); resetReplay(record); await repository.save(record);
    const before = await service.get(game.id); const footwork = before.actions.cards[0]!;
    const actionId = footwork.choices.find((action) => action.text === 'Right')!.id;
    const played = await service.commitAction(game.id, before.revision, actionId);
    expect(played.players.ochre.hand.map((card) => card.definitionId)).toEqual(['aim']); expect(played.canUndo).toBe(true);
    await expect(service.commitAction(game.id, played.revision, actionId)).rejects.toThrow('That action is no longer legal.');
    const undone = await service.undoAction(game.id, played.revision); expect(undone.players.ochre.hand.map((card) => card.definitionId)).toEqual(['footwork']); expect(undone.canUndo).toBe(false);
    await expect(service.undoAction(game.id, undone.revision)).rejects.toThrow('There is no action to undo.');
  });
  it('exports the current local game view with schema 10', async () => {
    const { service, game } = await setup(); const exported = await service.exportGame(game.id);
    expect(exported).toMatchObject({ schemaVersion: 10, game: { schemaVersion: 10, id: game.id } });
    expect(JSON.stringify(exported)).not.toMatch(/committedCommands|"command"/);
  });
});

describe('persistence schema', () => {
  it('round-trips a replay-based undo checkpoint without a redundant state copy', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-checkpoint-'));
    try {
      const repository = new FileGameRepository(directory); const service = new GameService(repository); const created = await service.create({ seed: 8 }); const ready = await completeBuilds(service, created.id, created.revision);
      const after = await service.commitAction(created.id, ready.revision, ready.actions.phases.find((entry) => entry.kind === 'endAction')!.id);
      const saved = await repository.load(created.id); expect(Object.keys(saved.undoCheckpoint!).sort()).toEqual(['committedCommandCount', 'completedActions', 'durationSeconds', 'finishedAt']); expect('state' in saved.undoCheckpoint!).toBe(false);
      expect((await service.undoAction(created.id, after.revision))).toMatchObject({ phase: 'action', canUndo: false });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('serializes concurrent file writes and leaves valid schema 9 state', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-lock-'));
    try {
      const repository = new FileGameRepository(directory); const service = new GameService(repository); const created = await service.create({ seed: 8 });
      await Promise.all([1, 2].map((marker) => repository.withLock(created.id, async () => { const record = await repository.load(created.id); await new Promise((resolve) => setTimeout(resolve, marker === 1 ? 5 : 0)); record.revision += 1; await repository.save(record); })));
      const saved = await repository.load(created.id); expect(saved.revision).toBe(2); expect(saved.schemaVersion).toBe(9);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects an older save with a specific message', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-old-')); const id = '11111111-1111-4111-8111-111111111111';
    try { await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ schemaVersion: 8 })); await expect(new FileGameRepository(directory).load(id)).rejects.toBeInstanceOf(UnsupportedSchemaError); await expect(new FileGameRepository(directory).load(id)).rejects.toThrow('schema 8 is not supported'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
