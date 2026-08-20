import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCard, kingdomOf, kingdomSupply, registerKingdom, resetKingdoms
} from '../src/game';
import { GameService } from '../src/server/gameService';
import { gameStateSchema } from '../src/server/schemas';
import { FileGameRepository, UnsupportedSchemaError } from '../src/server/persistence';
import type { GameView } from '../src/shared/api';
import type { GameRecord, GameRepository } from '../src/server/types';

class MemoryRepository implements GameRepository {
  record: GameRecord | null = null;
  async create(record: GameRecord) { this.record = structuredClone(record); }
  async load(_id: string) { if (!this.record) throw new Error('missing'); return structuredClone(this.record); }
  async save(record: GameRecord) { this.record = structuredClone(record); }
  async withLock<T>(_id: string, work: () => Promise<T>) { return work(); }
}
async function setup() {
  const repository = new MemoryRepository(); const service = new GameService(repository);
  const game = await service.create({ seed: 3 }); return { repository, service, game };
}
function resetReplay(record: GameRecord): void { record.initialState = structuredClone(record.state); record.committedCommands = []; record.undoHistory = []; }
function seedPlayerHand(record: GameRecord, definitions: string[], draw: string[] = []): void {
  const deck = record.state.players.ochre.deck; record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play);
  deck.draw = draw.map((id) => createCard(record.state, id)); deck.hand = definitions.map((id) => createCard(record.state, id)); deck.discard = []; deck.play = [];
}
async function completeBuilds(service: GameService, id: string, revision: number) {
  const one = await service.updateBuild(id, revision, [], true); return service.updateBuild(id, one.revision, [], true);
}
function phaseAction(game: GameView, kind: 'endAction' | 'endBuy'): string {
  return game.actions.phases.find((action) => action.kind === kind)!.id;
}
function registerProjectionKingdom(): void {
  registerKingdom({
    id: 'action-projection', name: 'Action Projection', startingHealth: 20,
    actionPiles: [
      { cardId: 'prism', count: 10 }, { cardId: 'reclaim', count: 10 }
    ]
  });
}
function useProjectionKingdom(record: GameRecord): void {
  registerProjectionKingdom();
  const kingdom = kingdomOf('action-projection');
  record.state.kingdomId = kingdom.id;
  record.state.startingHealth = kingdom.startingHealth;
  record.state.fighters.ochre.health = kingdom.startingHealth;
  record.state.fighters.indigo.health = kingdom.startingHealth;
  record.state.supply = kingdomSupply(kingdom);
}
function projectedHandCard(view: GameView, record: GameRecord, definitionId: string) {
  const instance = record.state.players.ochre.deck.hand.find((card) => card.definitionId === definitionId);
  if (!instance) throw new Error(`Missing ${definitionId} from prepared hand.`);
  const presentation = view.actions.cards.find((card) => card.cardInstanceId === instance.id);
  if (!presentation) throw new Error(`Missing ${definitionId} action presentation.`);
  return presentation;
}
afterEach(() => resetKingdoms());

describe('local GameService', () => {
  it('runs two sequential builds and gives both players complete turns', async () => {
    const { service, game } = await setup(); expect(game.activePlayerId).toBe('ochre');
    const playerOne = await service.updateBuild(game.id, game.revision, ['footwork'], true);
    expect(playerOne).toMatchObject({ phase: 'startingBuild', activePlayerId: 'indigo', buildProposal: [] });
    const playerTwo = await service.updateBuild(game.id, playerOne.revision, ['aim', 'volley'], true);
    expect(playerTwo).toMatchObject({ phase: 'action', activePlayerId: 'ochre' });
    expect(playerTwo.completedBuilds).toEqual({ ochre: ['footwork'], indigo: ['aim', 'volley'] });
    expect(playerTwo.players.ochre.hand).toHaveLength(5); expect(playerTwo.players.indigo.hand).toHaveLength(5);
    const buy = await service.commitAction(game.id, playerTwo.revision, playerTwo.actions.phases.find((action) => action.kind === 'endAction')!.id);
    const next = await service.commitAction(game.id, buy.revision, buy.actions.phases.find((action) => action.kind === 'endBuy')!.id);
    expect(next).toMatchObject({ activePlayerId: 'indigo', phase: 'action', turn: 2 });
  });
  it('keeps both starting builds private until setup is complete', async () => {
    const { service, game } = await setup();
    expect(game.players.ochre.deckCounts).toEqual({ copper: 7 }); expect(game.players.indigo.deckCounts).toEqual({ copper: 7 });
    const playerOne = await service.updateBuild(game.id, game.revision, ['footwork'], true);
    expect(playerOne.players.ochre.deckCounts).toEqual({ copper: 7 }); expect(playerOne.players.indigo.deckCounts).toEqual({ copper: 7 });
    expect(playerOne.players.ochre.deckCounts).not.toHaveProperty('footwork');
    const ready = await service.updateBuild(game.id, playerOne.revision, ['aim', 'volley'], true);
    expect(ready.players.ochre.deckCounts).toEqual({ copper: 7, footwork: 1 });
    expect(ready.players.indigo.deckCounts).toEqual({ copper: 7, aim: 1, volley: 1 });
  });
  it('keeps undo unavailable throughout incomplete starting setup', async () => {
    const { service, game } = await setup(); expect(game.canUndo).toBe(false);
    await expect(service.undoAction(game.id, game.revision)).rejects.toThrow('There is no action to undo.');
    const edited = await service.updateBuild(game.id, game.revision, ['footwork'], false); expect(edited.canUndo).toBe(false);
    await expect(service.undoAction(game.id, edited.revision)).rejects.toThrow('There is no action to undo.');
    const submitted = await service.updateBuild(game.id, edited.revision, ['footwork'], true); expect(submitted.canUndo).toBe(false);
    await expect(service.undoAction(game.id, submitted.revision)).rejects.toThrow('There is no action to undo.');
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
    expect(projectedHandCard(view, record, 'feint')).toMatchObject({
      enabled: false, reason: 'Requires Close range.', selection: 'none'
    });
    const footwork = projectedHandCard(view, record, 'footwork');
    expect(footwork).toMatchObject({ enabled: true, selection: 'movement' });
    expect(footwork.choices.map((choice) => ({ label: choice.label, text: choice.text }))).toEqual([
      { label: 'Play Footwork: Left', text: 'Left' }, { label: 'Play Footwork: Stay', text: 'Stay' },
      { label: 'Play Footwork: Right', text: 'Right' }
    ]);
    expect(JSON.stringify(view.actions)).not.toContain('command');
  });
  it('projects Cull target combinations, phase choices, and market buys by definition id', async () => {
    const { repository, service, game } = await setup(); await completeBuilds(service, game.id, game.revision);
    const record = await repository.load(game.id); seedPlayerHand(record, ['cull', 'copper', 'silver']); resetReplay(record); await repository.save(record);
    const view = await service.get(game.id); const cull = projectedHandCard(view, record, 'cull');
    expect(cull).toMatchObject({ enabled: true, selection: 'trashOneOrTwo' });
    expect(cull.eligibleCardInstanceIds).toEqual(record.state.players.ochre.deck.hand.map((card) => card.id));
    expect(cull.choices.some((choice) => choice.targetCardInstanceIds.length === 1)).toBe(true);
    expect(cull.choices.some((choice) => choice.targetCardInstanceIds.length === 2)).toBe(true);
    const buy = await service.commitAction(game.id, view.revision, view.actions.phases.find((action) => action.kind === 'endAction')!.id);
    expect(buy.actions.phases.map((action) => action.kind)).toEqual(['endBuy']);
    expect(buy.actions.buys.map((action) => action.definitionId)).toContain('copper');
  });
  it('projects direction-only movement with legal Left and Right choices and no Stay', async () => {
    const { repository, service, game } = await setup(); await completeBuilds(service, game.id, game.revision);
    const record = await repository.load(game.id); useProjectionKingdom(record); seedPlayerHand(record, ['step']);
    record.state.fighters.ochre.position = 3; resetReplay(record); await repository.save(record);
    const view = await service.get(game.id); const step = projectedHandCard(view, record, 'step');
    expect(step).toMatchObject({ enabled: true, selection: 'movement', actionId: null });
    expect(step.choices.map((choice) => ({ label: choice.label, text: choice.text }))).toEqual([
      { label: 'Play Step: Left', text: 'Left' }, { label: 'Play Step: Right', text: 'Right' }
    ]);
    expect(step.choices.map((choice) => choice.text)).not.toContain('Stay');
  });
  it('projects each Prism discard and commits one to clear the pending choice', async () => {
    const { repository, service, game } = await setup(); await completeBuilds(service, game.id, game.revision);
    const record = await repository.load(game.id); useProjectionKingdom(record);
    seedPlayerHand(record, ['prism', 'copper'], ['silver']); resetReplay(record); await repository.save(record);
    const before = await service.get(game.id); const prism = projectedHandCard(before, record, 'prism');
    const copperId = record.state.players.ochre.deck.hand.find((card) => card.definitionId === 'copper')!.id;
    const silverId = record.state.players.ochre.deck.draw[0]!.id;
    const pending = await service.commitAction(game.id, before.revision, prism.actionId!);
    expect(pending.actions.phases).toEqual([]); expect(pending.actions.buys).toEqual([]);
    expect(pending.actions.selection).toMatchObject({ kind: 'discard' });
    expect(pending.actions.selection!.choices.map((choice) => choice.cardInstanceId).sort()).toEqual([copperId, silverId].sort());
    const discard = pending.actions.selection!.choices.find((choice) => choice.cardInstanceId === copperId)!;
    const resolved = await service.commitAction(game.id, pending.revision, discard.id);
    expect(resolved.actions.selection).toBeNull();
    expect((await service.getRecord(game.id)).state.players.ochre.deck.discard.map((card) => card.id)).toContain(copperId);
  });
  it('projects Reclaim targets and Recover nothing, then accepts the null choice', async () => {
    const { repository, service, game } = await setup(); await completeBuilds(service, game.id, game.revision);
    const record = await repository.load(game.id); useProjectionKingdom(record);
    seedPlayerHand(record, ['reclaim'], ['copper']);
    const discard = record.state.players.ochre.deck.discard;
    discard.push(createCard(record.state, 'silver'), createCard(record.state, 'gold'));
    const recoverIds = discard.map((card) => card.id); resetReplay(record); await repository.save(record);
    const before = await service.get(game.id); const reclaim = projectedHandCard(before, record, 'reclaim');
    const pending = await service.commitAction(game.id, before.revision, reclaim.actionId!);
    expect(pending.actions.phases).toEqual([]); expect(pending.actions.buys).toEqual([]);
    expect(pending.actions.selection).toMatchObject({ kind: 'recover' });
    expect(pending.actions.selection!.choices.map((choice) => choice.cardInstanceId)).toEqual([...recoverIds, null]);
    const recoverNothing = pending.actions.selection!.choices.find((choice) => choice.cardInstanceId === null)!;
    expect(recoverNothing).toMatchObject({ label: 'Recover nothing', text: 'Recover nothing' });
    const resolved = await service.commitAction(game.id, pending.revision, recoverNothing.id);
    expect(resolved.actions.selection).toBeNull();
    expect((await service.getRecord(game.id)).state.pendingChoice).toBeNull();
  });
  it('undoes three committed actions in order and restores each exact replayed state', async () => {
    const { repository, service, game } = await setup(); await completeBuilds(service, game.id, game.revision);
    const record = await repository.load(game.id); seedPlayerHand(record, ['footwork', 'copper'], ['aim']); resetReplay(record); await repository.save(record);
    const ready = await service.get(game.id); const states = [structuredClone((await service.getRecord(game.id)).state)];
    const footwork = projectedHandCard(ready, record, 'footwork');
    const played = await service.commitAction(game.id, ready.revision, footwork.choices.find((action) => action.text === 'Right')!.id);
    states.push(structuredClone((await service.getRecord(game.id)).state));
    const buy = await service.commitAction(game.id, played.revision, phaseAction(played, 'endAction'));
    states.push(structuredClone((await service.getRecord(game.id)).state));
    const bought = await service.commitAction(game.id, buy.revision, buy.actions.buys.find((action) => action.definitionId === 'copper')!.id);
    expect((await service.getRecord(game.id)).undoHistory).toHaveLength(3);
    let undone = await service.undoAction(game.id, bought.revision);
    expect((await service.getRecord(game.id)).state).toEqual(states[2]); expect(undone.canUndo).toBe(true);
    undone = await service.undoAction(game.id, undone.revision);
    expect((await service.getRecord(game.id)).state).toEqual(states[1]); expect(undone.canUndo).toBe(true);
    undone = await service.undoAction(game.id, undone.revision);
    expect((await service.getRecord(game.id)).state).toEqual(states[0]); expect(undone.canUndo).toBe(false);
  });
  it('undoes local actions across Player 2 and Player 1 turn boundaries', async () => {
    const { service, game } = await setup(); const ready = await completeBuilds(service, game.id, game.revision);
    const playerOneBoundary = structuredClone((await service.getRecord(game.id)).state);
    const playerOneBuy = await service.commitAction(game.id, ready.revision, phaseAction(ready, 'endAction'));
    const playerTwoAction = await service.commitAction(game.id, playerOneBuy.revision, phaseAction(playerOneBuy, 'endBuy'));
    const playerTwoBoundary = structuredClone((await service.getRecord(game.id)).state);
    const playerTwoBuy = await service.commitAction(game.id, playerTwoAction.revision, phaseAction(playerTwoAction, 'endAction'));
    let current = await service.commitAction(game.id, playerTwoBuy.revision, phaseAction(playerTwoBuy, 'endBuy'));
    expect(current).toMatchObject({ activePlayerId: 'ochre', phase: 'action', turn: 3 });
    current = await service.undoAction(game.id, current.revision); expect(current).toMatchObject({ activePlayerId: 'indigo', phase: 'buy', turn: 2, canUndo: true });
    current = await service.undoAction(game.id, current.revision); expect((await service.getRecord(game.id)).state).toEqual(playerTwoBoundary);
    current = await service.undoAction(game.id, current.revision); expect(current).toMatchObject({ activePlayerId: 'ochre', phase: 'buy', turn: 1, canUndo: true });
    current = await service.undoAction(game.id, current.revision); expect((await service.getRecord(game.id)).state).toEqual(playerOneBoundary); expect(current.canUndo).toBe(false);
  });
  it('stops undo at the completed-setup boundary', async () => {
    const { service, game } = await setup(); const ready = await completeBuilds(service, game.id, game.revision);
    const boundary = structuredClone((await service.getRecord(game.id)).state);
    const buy = await service.commitAction(game.id, ready.revision, phaseAction(ready, 'endAction'));
    const restored = await service.undoAction(game.id, buy.revision);
    expect((await service.getRecord(game.id)).state).toEqual(boundary);
    expect(restored).toMatchObject({ phase: 'action', turn: 1, completedBuilds: { ochre: [], indigo: [] }, canUndo: false });
    await expect(service.undoAction(game.id, restored.revision)).rejects.toThrow('There is no action to undo.');
  });
  it('exports the current local game view with schema 12', async () => {
    const { service, game } = await setup(); const exported = await service.exportGame(game.id);
    expect(exported).toMatchObject({ schemaVersion: 12, game: { schemaVersion: 12, id: game.id } });
    expect(JSON.stringify(exported)).not.toMatch(/committedCommands|"command"/);
  });
});

describe('persistence schema', () => {
  it('rejects unknown persisted event types', async () => {
    const { service, game } = await setup(); await completeBuilds(service, game.id, game.revision);
    const state = (await service.getRecord(game.id)).state;
    const events = state.events as unknown as Array<{ sequence: number; type: string; playerId: string; detail: Record<string, unknown> }>;
    events.push({ sequence: events.length, type: 'inventedEvent', playerId: 'ochre', detail: {} });
    const result = gameStateSchema.safeParse(state); expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.join('.') === `events.${events.length - 1}.type`)).toBe(true);
  });
  it('rejects malformed player references in persisted event details', async () => {
    const { service, game } = await setup(); await completeBuilds(service, game.id, game.revision);
    const state = (await service.getRecord(game.id)).state;
    const turn = state.events.find((event) => event.type === 'turn')!; turn.detail.activePlayerId = 'observer';
    const result = gameStateSchema.safeParse(state); expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.join('.').endsWith('detail.activePlayerId'))).toBe(true);
  });
  it('reloads several replay-based undo entries and continues undoing exact states', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-history-'));
    try {
      const repository = new FileGameRepository(directory); const service = new GameService(repository); const created = await service.create({ seed: 8 }); const ready = await completeBuilds(service, created.id, created.revision);
      const states = [structuredClone((await service.getRecord(created.id)).state)];
      const buy = await service.commitAction(created.id, ready.revision, phaseAction(ready, 'endAction')); states.push(structuredClone((await service.getRecord(created.id)).state));
      const bought = await service.commitAction(created.id, buy.revision, buy.actions.buys.find((entry) => entry.definitionId === 'copper')!.id); states.push(structuredClone((await service.getRecord(created.id)).state));
      const next = await service.commitAction(created.id, bought.revision, phaseAction(bought, 'endBuy'));
      const saved = await repository.load(created.id); expect(saved.undoHistory).toHaveLength(3);
      expect(Object.keys(saved.undoHistory[0]!).sort()).toEqual(['committedCommandCount', 'completedActions', 'durationSeconds', 'finishedAt']);
      expect(saved.undoHistory.some((entry) => 'state' in entry)).toBe(false);
      const restarted = new GameService(new FileGameRepository(directory));
      let undone = await restarted.undoAction(created.id, next.revision); expect((await restarted.getRecord(created.id)).state).toEqual(states[2]); expect(undone.canUndo).toBe(true);
      undone = await restarted.undoAction(created.id, undone.revision); expect((await restarted.getRecord(created.id)).state).toEqual(states[1]); expect(undone.canUndo).toBe(true);
      undone = await restarted.undoAction(created.id, undone.revision); expect((await restarted.getRecord(created.id)).state).toEqual(states[0]); expect(undone.canUndo).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('serializes concurrent file writes and leaves valid schema 12 state', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-lock-'));
    try {
      const repository = new FileGameRepository(directory); const service = new GameService(repository); const created = await service.create({ seed: 8 });
      await Promise.all([1, 2].map((marker) => repository.withLock(created.id, async () => { const record = await repository.load(created.id); await new Promise((resolve) => setTimeout(resolve, marker === 1 ? 5 : 0)); record.revision += 1; await repository.save(record); })));
      const saved = await repository.load(created.id); expect(saved.revision).toBe(2); expect(saved.schemaVersion).toBe(12);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects an older save with a specific message', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-old-')); const id = '11111111-1111-4111-8111-111111111111';
    try { await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ schemaVersion: 10 })); await expect(new FileGameRepository(directory).load(id)).rejects.toBeInstanceOf(UnsupportedSchemaError); await expect(new FileGameRepository(directory).load(id)).rejects.toThrow('schema 10 is not supported'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
