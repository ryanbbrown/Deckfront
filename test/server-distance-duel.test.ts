import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCard, listActionAvailability, listLegalActions } from '../src/game';
import { AiTurnCoordinator } from '../src/server/aiCoordinator';
import { GameService } from '../src/server/gameService';
import { FileGameRepository, UnsupportedSchemaError } from '../src/server/persistence';
import type { AiRunResult } from '../src/server/aiRunner';
import type { OpponentMode } from '../src/shared/api';
import type { GameRecord, GameRepository } from '../src/server/types';

class MemoryRepository implements GameRepository {
  record: GameRecord | null = null;
  async create(record: GameRecord) { this.record = structuredClone(record); }
  async load(_id: string) { if (!this.record) throw new Error('missing'); return structuredClone(this.record); }
  async save(record: GameRecord) { this.record = structuredClone(record); }
  async withLock<T>(_id: string, work: () => Promise<T>) { return work(); }
}
async function setup(firstPlayerId: 'ochre' | 'indigo' = 'ochre', opponentMode: OpponentMode = 'ai') {
  const repository = new MemoryRepository(); const service = new GameService(repository); const game = await service.create({ seed: 3, firstPlayerId, opponentMode, strategyPresetId: 'ranged-setup', strategyMarkdown: '# Ranged' });
  return { repository, service, game };
}
function resetReplay(record: GameRecord): void {
  record.initialState = structuredClone(record.state); record.committedCommands = []; record.undoCheckpoint = null;
}
function seedPlayerHand(record: GameRecord, definitions: string[], draw: string[] = []): void {
  const deck = record.state.players.ochre.deck; record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play);
  deck.draw = draw.map((id) => createCard(record.state, id)); deck.hand = definitions.map((id) => createCard(record.state, id)); deck.discard = []; deck.play = [];
}

describe('GameService setup and privacy', () => {
  it('runs two sequential local builds and gives both local players complete turns', async () => {
    const { service, game } = await setup('indigo', 'local');
    expect(game.opponentMode).toBe('local'); expect(game.viewPlayerId).toBe('ochre');
    const playerOne = await service.updateHumanBuild(game.id, game.revision, ['footwork'], true);
    expect(playerOne.phase).toBe('startingBuild'); expect(playerOne.activePlayerId).toBe('indigo'); expect(playerOne.viewPlayerId).toBe('indigo'); expect(playerOne.humanBuildProposal).toEqual([]);
    const playerTwo = await service.updateHumanBuild(game.id, playerOne.revision, ['aim', 'volley'], true);
    expect(playerTwo.phase).toBe('action'); expect(playerTwo.activePlayerId).toBe('indigo'); expect(playerTwo.viewPlayerId).toBe('indigo'); expect(playerTwo.completedBuilds).toEqual({ ochre: ['footwork'], indigo: ['aim', 'volley'] }); expect(playerTwo.players.ochre.hand).toHaveLength(5); expect(playerTwo.players.indigo.hand).toHaveLength(5);
    const endAction = playerTwo.legalActions.find((action) => action.command.type === 'endActionPhase')!; const buy = await service.commitHumanAction(game.id, playerTwo.revision, endAction.id);
    expect(buy.phase).toBe('buy'); expect(buy.viewPlayerId).toBe('indigo');
    const endBuy = buy.legalActions.find((action) => action.command.type === 'endBuyPhase')!; const nextTurn = await service.commitHumanAction(game.id, buy.revision, endBuy.id);
    expect(nextTurn.activePlayerId).toBe('ochre'); expect(nextTurn.viewPlayerId).toBe('ochre'); expect(nextTurn.phase).toBe('action');
    const coordinator = new AiTurnCoordinator(service, { async run() { throw new Error('must not run'); } }); await expect(coordinator.start(game.id)).rejects.toThrow('no AI player');
  });
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
      [[2, 2], [null, 'NEEDS_NEAR_OR_FAR', null]],
      [[2, 3], ['NEEDS_CLOSE', null, 'NEEDS_CLOSE']],
      [[1, 5], ['NEEDS_CLOSE', null, 'NEEDS_CLOSE']]
    ] as const) {
      const { repository, service, game } = await setup(); const humanBuild = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0); const record = await repository.load(game.id); const deck = record.state.players.ochre.deck;
      record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play); deck.draw = []; deck.discard = []; deck.play = []; deck.hand = ['feint', 'aim', 'drive'].map((id) => createCard(record.state, id)); record.state.fighters.ochre.position = positions[0]; record.state.fighters.indigo.position = positions[1]; record.initialState = structuredClone(record.state); record.committedCommands = []; record.undoCheckpoint = null; await repository.save(record);
      const domain = listActionAvailability(record.state, 'ochre').map((entry) => entry.reasonCode); const safe = (await service.get(game.id)).actionAvailability.map((entry) => entry.reasonCode); expect(domain).toEqual(expected); expect(safe).toEqual(expected);
    }
  });
  it('commits a draw immediately and one-step Undo restores the exact prior state', async () => {
    const { repository, service, game } = await setup(); const humanBuild = await service.updateHumanBuild(game.id, 0, ['footwork'], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0);
    const record = await repository.load(game.id); const human = record.state.players.ochre; record.state.trash.push(...human.deck.draw, ...human.deck.hand, ...human.deck.discard, ...human.deck.play); human.deck.draw = [createCard(record.state, 'volley')]; human.deck.hand = [createCard(record.state, 'footwork')]; human.deck.discard = []; human.deck.play = [];
    record.initialState = structuredClone(record.state); record.committedCommands = []; record.undoCheckpoint = null; await repository.save(record);
    const loaded = await service.get(game.id); const footwork = loaded.legalActions.find((action) => action.command.type === 'playFootwork' && action.command.movement === 'right')!;
    const played = await service.commitHumanAction(game.id, loaded.revision, footwork.id); expect(played.players.ochre.hand?.map((card) => card.definitionId)).toEqual(['volley']); expect(played.canUndo).toBe(true);
    const undone = await service.undoHumanAction(game.id, played.revision); expect(undone.players.ochre.hand?.map((card) => card.definitionId)).toEqual(['footwork']); expect(undone.canUndo).toBe(false);
  });
  it('undoes End Buy exactly and repeats it without a double turn', async () => {
    const { repository, service, game } = await setup('ochre', 'local'); const one = await service.updateHumanBuild(game.id, 0, [], true); const ready = await service.updateHumanBuild(game.id, one.revision, [], true);
    const record = await repository.load(game.id); record.state.phase = 'buy'; record.state.players.ochre.money = 7; record.state.players.ochre.firstBuyPending = false; record.initialState = structuredClone(record.state); record.committedCommands = []; record.undoCheckpoint = null; await repository.save(record);
    const before = await service.get(game.id); const end = before.legalActions.find((entry) => entry.command.type === 'endBuyPhase')!; const switched = await service.commitHumanAction(game.id, before.revision, end.id);
    expect(switched).toMatchObject({ activePlayerId: 'indigo', phase: 'action', turn: 2, canUndo: true }); expect(switched.players.ochre.money).toBe(0);
    const restored = await service.undoHumanAction(game.id, switched.revision); expect(restored).toMatchObject({ activePlayerId: 'ochre', phase: 'buy', turn: 1, canUndo: false }); expect(restored.players.ochre.money).toBe(7);
    const switchedAgain = await service.commitHumanAction(game.id, restored.revision, restored.legalActions.find((entry) => entry.command.type === 'endBuyPhase')!.id); expect(switchedAgain).toMatchObject({ activePlayerId: 'indigo', turn: 2 }); expect(ready.phase).toBe('action');
  });
  it('commits every gameplay command shape immediately with one revision increase and a literal outcome', async () => {
    const commandTypes = ['playFootwork', 'playCull', 'playMuster', 'playFeint', 'playDrive', 'playFlurry', 'playAim', 'playVolley', 'endActionPhase', 'buyCard', 'endBuyPhase'] as const;
    for (const commandType of commandTypes) {
      const { repository, service, game } = await setup('ochre', 'local'); const first = await service.updateHumanBuild(game.id, game.revision, [], true); await service.updateHumanBuild(game.id, first.revision, [], true);
      const record = await repository.load(game.id);
      if (commandType === 'playFootwork') seedPlayerHand(record, ['footwork'], ['aim']);
      if (commandType === 'playCull') seedPlayerHand(record, ['cull', 'copper']);
      if (commandType === 'playMuster') seedPlayerHand(record, ['muster'], ['aim', 'volley']);
      if (commandType === 'playFeint' || commandType === 'playDrive') { seedPlayerHand(record, [commandType === 'playFeint' ? 'feint' : 'drive']); record.state.fighters.indigo.position = 2; }
      if (commandType === 'playFlurry') { seedPlayerHand(record, ['flurry']); record.state.actionsThisTurn = ['aim', 'footwork']; record.state.fighters.indigo.position = 2; }
      if (commandType === 'playAim') seedPlayerHand(record, ['aim'], ['copper']);
      if (commandType === 'playVolley') seedPlayerHand(record, ['volley']);
      if (commandType === 'endActionPhase') { seedPlayerHand(record, ['copper']); record.state.players.ochre.firstBuyPending = false; }
      if (commandType === 'buyCard') { seedPlayerHand(record, []); record.state.phase = 'buy'; record.state.players.ochre.money = 6; record.state.players.ochre.firstBuyPending = false; }
      if (commandType === 'endBuyPhase') { seedPlayerHand(record, []); record.state.phase = 'buy'; record.state.players.ochre.money = 7; record.state.players.ochre.firstBuyPending = false; }
      resetReplay(record); await repository.save(record);
      const before = await service.get(game.id); const selected = before.legalActions.find((entry) => entry.command.type === commandType && (entry.command.type !== 'playFootwork' || entry.command.movement === 'left') && (entry.command.type !== 'playDrive' || entry.command.direction === 'right') && (entry.command.type !== 'buyCard' || entry.command.definitionId === 'gold'))!;
      expect(selected, commandType).toBeDefined(); const after = await service.commitHumanAction(game.id, before.revision, selected.id); expect(after.revision, commandType).toBe(before.revision + 1); expect(after.canUndo, commandType).toBe(true);
      if (commandType === 'playFootwork') { expect(after.fighters.ochre.position).toBe(1); expect(after.players.ochre.hand?.map((card) => card.definitionId)).toEqual(['aim']); }
      if (commandType === 'playCull') expect(after.trashCount).toBe(record.state.trash.length + 1);
      if (commandType === 'playMuster') expect(after.players.ochre.hand?.map((card) => card.definitionId)).toEqual(['aim', 'volley']);
      if (commandType === 'playFeint') expect(after.fighters.indigo.exposed).toBe(true);
      if (commandType === 'playDrive') { expect(after.fighters.indigo.health).toBe(18); expect(after.fighters.indigo.position).toBe(3); expect(after.fighters.ochre.position).toBe(3); }
      if (commandType === 'playFlurry') expect(after.fighters.indigo.health).toBe(18);
      if (commandType === 'playAim') { expect(after.fighters.ochre.aimed).toBe(true); expect(after.players.ochre.hand?.map((card) => card.definitionId)).toEqual(['copper']); }
      if (commandType === 'playVolley') expect(after.fighters.indigo.health).toBe(18);
      if (commandType === 'endActionPhase') { expect(after.phase).toBe('buy'); expect(after.players.ochre.money).toBe(1); }
      if (commandType === 'buyCard') { expect(after.players.ochre.money).toBe(0); expect(after.players.ochre.purchases).toEqual(['gold']); }
      if (commandType === 'endBuyPhase') expect(after).toMatchObject({ activePlayerId: 'indigo', phase: 'action', turn: 2 });
    }
  });
  it('replaces action A with action B in the checkpoint and allows only one Undo', async () => {
    const { repository, service, game } = await setup('ochre', 'local'); const first = await service.updateHumanBuild(game.id, 0, [], true); await service.updateHumanBuild(game.id, first.revision, [], true);
    const record = await repository.load(game.id); seedPlayerHand(record, []); resetReplay(record); await repository.save(record);
    const actionView = await service.get(game.id); const afterA = await service.commitHumanAction(game.id, actionView.revision, actionView.legalActions.find((entry) => entry.command.type === 'endActionPhase')!.id); const stateAfterA = (await service.getRecord(game.id)).state;
    const afterB = await service.commitHumanAction(game.id, afterA.revision, afterA.legalActions.find((entry) => entry.command.type === 'buyCard' && entry.command.definitionId === 'copper')!.id); expect(afterB.revision).toBe(afterA.revision + 1);
    const undone = await service.undoHumanAction(game.id, afterB.revision); expect(undone.revision).toBe(afterB.revision + 1); expect((await service.getRecord(game.id)).state).toEqual(stateAfterA); expect(undone.canUndo).toBe(false);
    await expect(service.undoHumanAction(game.id, undone.revision)).rejects.toThrow('There is no action to undo.');
  });
  it('restores RNG and exact card-instance zones when Undo crosses a reshuffle', async () => {
    const { repository, service, game } = await setup('ochre', 'local'); const first = await service.updateHumanBuild(game.id, 0, [], true); await service.updateHumanBuild(game.id, first.revision, [], true);
    const record = await repository.load(game.id); seedPlayerHand(record, ['muster']); record.state.players.ochre.deck.discard = ['aim', 'volley', 'copper'].map((id) => createCard(record.state, id)); resetReplay(record); await repository.save(record);
    const before = await service.getRecord(game.id); const beforeRandomAndZones = { rngState: before.state.rngState, draw: before.state.players.ochre.deck.draw, hand: before.state.players.ochre.deck.hand, discard: before.state.players.ochre.deck.discard, play: before.state.players.ochre.deck.play };
    const view = await service.get(game.id); const drawn = await service.commitHumanAction(game.id, view.revision, view.legalActions.find((entry) => entry.command.type === 'playMuster')!.id); const firstResult = structuredClone((await service.getRecord(game.id)).state);
    const undone = await service.undoHumanAction(game.id, drawn.revision); const restored = await service.getRecord(game.id); expect({ rngState: restored.state.rngState, draw: restored.state.players.ochre.deck.draw, hand: restored.state.players.ochre.deck.hand, discard: restored.state.players.ochre.deck.discard, play: restored.state.players.ochre.deck.play }).toEqual(beforeRandomAndZones);
    await service.commitHumanAction(game.id, undone.revision, undone.legalActions.find((entry) => entry.command.type === 'playMuster')!.id); expect((await service.getRecord(game.id)).state).toEqual(firstResult);
  });
  it('restores Exposed and Aimed independently when their actions are undone', async () => {
    for (const [definitionId, commandType, fighterId, condition] of [['feint', 'playFeint', 'indigo', 'exposed'], ['aim', 'playAim', 'ochre', 'aimed']] as const) {
      const { repository, service, game } = await setup('ochre', 'local'); const first = await service.updateHumanBuild(game.id, 0, [], true); await service.updateHumanBuild(game.id, first.revision, [], true); const record = await repository.load(game.id); seedPlayerHand(record, [definitionId]); if (definitionId === 'feint') record.state.fighters.indigo.position = 2; resetReplay(record); await repository.save(record);
      const before = await service.get(game.id); expect(before.fighters[fighterId][condition]).toBe(false); const applied = await service.commitHumanAction(game.id, before.revision, before.legalActions.find((entry) => entry.command.type === commandType)!.id); expect(applied.fighters[fighterId][condition]).toBe(true); const undone = await service.undoHumanAction(game.id, applied.revision); expect(undone.fighters[fighterId][condition]).toBe(false);
    }
  });
  it('public export omits sentinel private cards and ordered draw arrays', async () => {
    const { repository, service, game } = await setup(); const humanBuild = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, humanBuild.revision, [], 'build', 0);
    const record = await repository.load(game.id); record.state.players.indigo.deck.hand[0]!.id = 'AI-PRIVATE-SENTINEL'; record.state.players.indigo.deck.draw[0]!.id = 'AI-DRAW-SENTINEL'; await repository.save(record);
    const exported = JSON.stringify(await service.redactedExport(game.id)); expect(exported).not.toContain('AI-PRIVATE-SENTINEL'); expect(exported).not.toContain('AI-DRAW-SENTINEL');
  });
});

describe('server-owned AI sequence', () => {
  it('clears human Undo when the AI commits its first decision', async () => {
    const { service, game } = await setup(); const human = await service.updateHumanBuild(game.id, 0, [], true); let view = await service.commitAiBuild(game.id, human.revision, [], 'build', 0);
    view = await service.commitHumanAction(game.id, view.revision, view.legalActions.find((entry) => entry.command.type === 'endActionPhase')!.id);
    view = await service.commitHumanAction(game.id, view.revision, view.legalActions.find((entry) => entry.command.type === 'endBuyPhase')!.id); expect(view.canUndo).toBe(true); expect(view.activePlayerId).toBe('indigo');
    const record = await service.getRecord(game.id); const aiEnd = listLegalActions(record.state).find((entry) => entry.command.type === 'endActionPhase')!; const afterAi = await service.commitAiAction(game.id, record.revision, aiEnd.id, 'end', 0, 0); expect(afterAi.canUndo).toBe(false);
  });
  it('discards an in-flight AI result after Undo and starts the next AI turn fresh', async () => {
    const { service, game } = await setup(); const human = await service.updateHumanBuild(game.id, 0, [], true); let view = await service.commitAiBuild(game.id, human.revision, [], 'build', 0);
    view = await service.commitHumanAction(game.id, view.revision, view.legalActions.find((entry) => entry.command.type === 'endActionPhase')!.id);
    view = await service.commitHumanAction(game.id, view.revision, view.legalActions.find((entry) => entry.command.type === 'endBuyPhase')!.id);
    let releaseFirst = (): void => undefined; let reportStarted = (): void => undefined; const firstStarted = new Promise<void>((resolve) => { reportStarted = resolve; }); const release = new Promise<void>((resolve) => { releaseFirst = resolve; }); let calls = 0;
    const runner = { async run(record: GameRecord): Promise<AiRunResult> { calls += 1; if (calls === 1) { reportStarted(); await release; } const selected = listLegalActions(record.state).find((entry) => entry.command.type === (record.state.phase === 'action' ? 'endActionPhase' : 'endBuyPhase'))!; return { schemaVersion: 2, kind: 'action', baseRevision: record.revision, actionId: selected.id, summary: 'end phase', durationSeconds: 0 }; } };
    const coordinator = new AiTurnCoordinator(service, runner); await coordinator.start(game.id); await firstStarted;
    const undone = await coordinator.undoHumanAction(game.id, view.revision); expect(undone).toMatchObject({ activePlayerId: 'ochre', phase: 'buy', canUndo: false });
    releaseFirst(); await new Promise((resolve) => setTimeout(resolve, 5)); expect(await coordinator.status(game.id)).toEqual({ status: 'idle' }); expect((await service.get(game.id)).activePlayerId).toBe('ochre');
    const aiAgain = await service.commitHumanAction(game.id, undone.revision, undone.legalActions.find((entry) => entry.command.type === 'endBuyPhase')!.id); expect(aiAgain.activePlayerId).toBe('indigo'); await coordinator.start(game.id);
    let status = await coordinator.status(game.id); for (let count = 0; status.status === 'running' && count < 50; count += 1) { await new Promise((resolve) => setTimeout(resolve, 2)); status = await coordinator.status(game.id); }
    expect(status.status).toBe('complete'); expect(status.status === 'complete' ? status.game?.activePlayerId : null).toBe('ochre'); expect(calls).toBe(3);
  });
  it('rejects invented and stale AI action IDs without changing committed state', async () => {
    const { service, game } = await setup('indigo'); const human = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, human.revision, [], 'build', 0);
    const beforeInvented = await service.getRecord(game.id); await expect(service.commitAiAction(game.id, beforeInvented.revision, 'invented-action', 'bad', 0, 0)).rejects.toThrow('unknown or stale'); const afterInvented = await service.getRecord(game.id);
    expect(afterInvented.revision).toBe(beforeInvented.revision); expect(afterInvented.state).toEqual(beforeInvented.state); expect(afterInvented.committedCommands).toEqual(beforeInvented.committedCommands);
    const staleAction = listLegalActions(afterInvented.state).find((entry) => entry.command.type === 'endActionPhase')!; await service.commitAiAction(game.id, afterInvented.revision, staleAction.id, 'end', 0, 0); const beforeStale = await service.getRecord(game.id);
    await expect(service.commitAiAction(game.id, beforeStale.revision, staleAction.id, 'stale', 0, 1)).rejects.toThrow('unknown or stale'); const afterStale = await service.getRecord(game.id); expect(afterStale.revision).toBe(beforeStale.revision); expect(afterStale.state).toEqual(beforeStale.state); expect(afterStale.committedCommands).toEqual(beforeStale.committedCommands);
  });
  it('persists an exact completed AI turn recap without exposing the live hand', async () => {
    const { repository, service, game } = await setup('indigo'); const human = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, human.revision, [], 'build', 0);
    const record = await repository.load(game.id); const deck = record.state.players.indigo.deck;
    record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play);
    deck.hand = ['muster', 'volley', 'copper', 'copper'].map((id) => createCard(record.state, id)); deck.draw = [createCard(record.state, 'aim')]; deck.discard = []; deck.play = [];
    record.state.players.indigo.firstBuyMoney = 0; record.state.players.indigo.firstBuyPending = false; record.state.players.indigo.purchases = [];
    record.activeAiTurn = null; record.lastAiTurnRecap = null; record.aiActions = []; resetReplay(record); await repository.save(record);
    let current = await service.getRecord(game.id); const muster = listLegalActions(current.state).find((action) => action.command.type === 'playMuster')!;
    let view = await service.commitAiAction(game.id, current.revision, muster.id, 'draw', 0, 0);
    expect(view.lastAiTurnRecap).toBeNull(); expect(view.players.indigo.hand).toBeNull();
    current = await service.getRecord(game.id); const endAction = listLegalActions(current.state).find((action) => action.command.type === 'endActionPhase')!;
    view = await service.commitAiAction(game.id, current.revision, endAction.id, 'buy', 0, 1);
    current = await service.getRecord(game.id); const buyCopper = listLegalActions(current.state).find((action) => action.command.type === 'buyCard' && action.command.definitionId === 'copper')!;
    view = await service.commitAiAction(game.id, current.revision, buyCopper.id, 'free copper', 0, 2);
    current = await service.getRecord(game.id); const endBuy = listLegalActions(current.state).find((action) => action.command.type === 'endBuyPhase')!;
    view = await service.commitAiAction(game.id, current.revision, endBuy.id, 'done', 0, 3);
    expect(view.lastAiTurnRecap).toMatchObject({ turn: 1, startingMoney: 0, moneyAvailable: 2, unspentMoney: 2, totalDamage: 0, purchases: [{ definitionId: 'copper', cost: 0 }] });
    expect(view.lastAiTurnRecap?.startingHand.map((card) => card.definitionId)).toEqual(['muster', 'volley', 'copper', 'copper']);
    expect(view.lastAiTurnRecap?.draws.map((draw) => [draw.card.definitionId, draw.sourceDefinitionId])).toEqual([['aim', 'muster']]);
    expect(view.lastAiTurnRecap?.actions.map((action) => [action.card.definitionId, action.label, action.drawnCardIds.length])).toEqual([['muster', 'Play Muster', 1]]);
    expect(view.lastAiTurnRecap?.treasures.map((treasure) => [treasure.card.definitionId, treasure.money])).toEqual([['copper', 1], ['copper', 1]]);
    expect(view.lastAiTurnRecap?.unplayed.map((card) => card.definitionId)).toEqual(['volley', 'aim']);
    expect((await service.get(game.id)).lastAiTurnRecap).toEqual(view.lastAiTurnRecap);
    const saved = await repository.load(game.id); expect(saved.activeAiTurn).toBeNull(); expect(saved.lastAiTurnRecap).toEqual(view.lastAiTurnRecap);
  });
  it('replans after a draw, plays another Action, buys several paid cards, and ends one server-owned turn', async () => {
    const { repository, service, game } = await setup('indigo'); const human = await service.updateHumanBuild(game.id, 0, [], true); await service.commitAiBuild(game.id, human.revision, [], 'build', 0); const record = await repository.load(game.id); const deck = record.state.players.indigo.deck;
    record.state.trash.push(...deck.draw, ...deck.hand, ...deck.discard, ...deck.play); deck.hand = ['muster', 'copper', 'copper', 'copper', 'copper', 'copper', 'copper'].map((id) => createCard(record.state, id)); deck.draw = [createCard(record.state, 'aim')]; deck.discard = []; deck.play = []; record.state.players.indigo.firstBuyMoney = 0; record.state.players.indigo.firstBuyPending = false; record.state.players.indigo.purchases = []; record.initialState = structuredClone(record.state); record.committedCommands = []; record.undoCheckpoint = null; record.aiActions = []; await repository.save(record);
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
    const record = await repository.load(game.id); record.state.phase = 'buy'; record.state.activePlayerId = 'indigo'; record.initialState = structuredClone(record.state); record.committedCommands = []; record.undoCheckpoint = null; record.aiActions = []; await repository.save(record);
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
  it('round-trips one replay-based Undo checkpoint without redundant state copies', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-checkpoint-'));
    try {
      const repository = new FileGameRepository(directory); const service = new GameService(repository); const created = await service.create({ seed: 8, opponentMode: 'local', strategyPresetId: 'close-pressure', strategyMarkdown: '# close' }); const first = await service.updateHumanBuild(created.id, created.revision, [], true); const ready = await service.updateHumanBuild(created.id, first.revision, [], true); const after = await service.commitHumanAction(created.id, ready.revision, ready.legalActions.find((entry) => entry.command.type === 'endActionPhase')!.id);
      const saved = await repository.load(created.id); expect(Object.keys(saved.undoCheckpoint!).sort()).toEqual(['committedCommandCount', 'completedActions', 'durationSeconds', 'finishedAt']); expect('committedState' in saved).toBe(false); expect('state' in saved.undoCheckpoint!).toBe(false);
      const undone = await service.undoHumanAction(created.id, after.revision); expect(undone).toMatchObject({ phase: 'action', canUndo: false });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('serializes concurrent file writes and leaves valid state', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-lock-'));
    try {
      const repository = new FileGameRepository(directory); const service = new GameService(repository); const created = await service.create({ seed: 8, strategyPresetId: 'close-pressure', strategyMarkdown: '# close' });
      await Promise.all([1, 2].map((marker) => repository.withLock(created.id, async () => { const record = await repository.load(created.id); await new Promise((resolve) => setTimeout(resolve, marker === 1 ? 5 : 0)); record.revision += 1; record.updatedAt = new Date(Date.parse(record.updatedAt) + marker * 1000).toISOString(); await repository.save(record); })));
      const saved = await repository.load(created.id); expect(saved.revision).toBe(2); expect(saved.schemaVersion).toBe(8); expect(saved.state.phase).toBe('startingBuild');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects an old save with a specific version message', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-old-')); const id = '11111111-1111-4111-8111-111111111111';
    try { await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ schemaVersion: 7 })); await expect(new FileGameRepository(directory).load(id)).rejects.toBeInstanceOf(UnsupportedSchemaError); await expect(new FileGameRepository(directory).load(id)).rejects.toThrow('schema 7 is not supported'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
