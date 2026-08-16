import { randomUUID } from 'node:crypto';
import {
  CARDS, applyAction, applyCommand, assertInvariants, cardDefinition, cloneGame, createGame,
  listActionAvailability, listLegalActions, marketCost, rangeBand, replayCommands
} from '../game';
import type { GameCommand, LegalAction, PlayerId } from '../game';
import type { RedactedExport, SafeCardInstance, SafeGameView } from '../shared/api';
import type { GameRecord, GameRepository } from './types';

export class ConflictError extends Error {}
export class ForbiddenActionError extends Error {}
export class BadBuildError extends Error {}
export interface CreateGameInput { seed?: number | undefined; strategyPresetId: string; strategyMarkdown: string; firstPlayerId?: PlayerId | undefined }
export class GameService {
  constructor(private readonly repository: GameRepository, private readonly aiRuntime = { model: 'openai:gpt-5.6-luna', effort: 'low' }) {}
  async create(input: CreateGameInput): Promise<SafeGameView> {
    const now = new Date().toISOString(); const initialState = createGame({ seed: input.seed ?? Date.now(), firstPlayerId: input.firstPlayerId });
    const record: GameRecord = {
      schemaVersion: 3, id: randomUUID(), revision: 0, createdAt: now, updatedAt: now, finishedAt: null,
      completedActions: 0, durationSeconds: null, humanPlayerId: 'ochre', aiPlayerId: 'indigo',
      strategy: { presetId: input.strategyPresetId, markdown: input.strategyMarkdown }, aiRuntime: { ...this.aiRuntime },
      humanBuildProposal: [], aiActions: [], initialState: cloneGame(initialState), committedCommands: [],
      committedState: cloneGame(initialState), draft: { baseVersion: 0, baseState: cloneGame(initialState), command: null }, state: initialState
    };
    await this.repository.create(record); return this.safeView(record);
  }
  async get(id: string): Promise<SafeGameView> { return this.safeView(await this.repository.load(id)); }
  async getRecord(id: string): Promise<GameRecord> { return this.repository.load(id); }
  async updateHumanBuild(id: string, expectedRevision: number, definitionIds: string[], complete: boolean): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, expectedRevision);
      if (record.state.phase !== 'startingBuild' || record.state.players.ochre.startingBuild) throw new ForbiddenActionError('The human starting build is already complete.');
      for (const definitionId of definitionIds) cardDefinition(definitionId);
      if (complete && marketCost(definitionIds) > 12) throw new BadBuildError('Starting build costs more than 12 money.');
      record.humanBuildProposal = [...definitionIds];
      if (complete) this.commitCommand(record, { type: 'submitStartingBuild', playerId: record.humanPlayerId, definitionIds });
      this.touch(record); this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async commitAiBuild(id: string, baseRevision: number, definitionIds: string[], summary: string, durationSeconds: number): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, baseRevision);
      if (record.state.phase !== 'startingBuild' || record.state.activePlayerId !== record.aiPlayerId) throw new ForbiddenActionError('There is no AI starting build to commit.');
      const turn = record.state.turn; const phase = record.state.phase;
      this.commitCommand(record, { type: 'submitStartingBuild', playerId: record.aiPlayerId, definitionIds });
      this.touch(record); record.aiActions.push({ committedRevision: record.revision, turn, phase, decisionIndex: 0, actionId: 'starting-build', summary: summary.slice(0, 1000), durationSeconds });
      this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async previewHumanAction(id: string, expectedRevision: number, actionId: string): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, expectedRevision); this.assertHumanChoice(record);
      if (record.draft.command) throw new ForbiddenActionError('Confirm or undo the current preview first.');
      const selected = listLegalActions(record.state).find((action) => action.id === actionId);
      if (!selected) throw new ConflictError('That action is no longer legal.');
      record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), command: selected.command };
      record.state = applyAction(record.state, selected.id); this.touch(record); this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async confirmHumanAction(id: string, expectedRevision: number): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, expectedRevision);
      if (!record.draft.command) throw new ForbiddenActionError('There is no action to confirm.');
      record.committedCommands.push(record.draft.command); record.committedState = cloneGame(record.state);
      record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), command: null };
      record.completedActions += 1; this.touch(record); if (record.state.winner) this.finish(record);
      this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async undoHumanAction(id: string, expectedRevision: number): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, expectedRevision);
      if (!record.draft.command) throw new ForbiddenActionError('There is no action to undo.');
      record.state = cloneGame(record.draft.baseState); record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), command: null };
      this.touch(record); this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async commitAiAction(id: string, baseRevision: number, actionId: string, summary: string, durationSeconds: number, decisionIndex: number, fallback = false): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, baseRevision);
      if (record.state.activePlayerId !== record.aiPlayerId || record.state.winner || record.state.phase === 'startingBuild') throw new ForbiddenActionError('There is no AI action to commit.');
      if (record.draft.command) throw new ConflictError('The AI action did not start at a confirmation boundary.');
      const selected = listLegalActions(record.state).find((action) => action.id === actionId);
      if (!selected) throw new ConflictError('The AI returned an unknown or stale action ID.');
      const turn = record.state.turn; const phase = record.state.phase; this.commitCommand(record, selected.command);
      record.completedActions += 1; this.touch(record); if (record.state.winner) this.finish(record);
      record.aiActions.push({ committedRevision: record.revision, turn, phase, decisionIndex, actionId, summary: summary.slice(0, 1000), durationSeconds, ...(fallback ? { fallback: true } : {}) });
      this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async redactedExport(id: string): Promise<RedactedExport> { return { schemaVersion: 3, exportedAt: new Date().toISOString(), game: this.safeView(await this.repository.load(id)) }; }
  private commitCommand(record: GameRecord, command: GameCommand): void {
    record.state = applyCommand(record.state, command); record.committedCommands.push(command); record.committedState = cloneGame(record.state);
    record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), command: null };
  }
  private assertHumanChoice(record: GameRecord): void {
    if (record.state.activePlayerId !== record.humanPlayerId || record.state.winner || record.state.phase === 'startingBuild') throw new ForbiddenActionError('It is not the human player’s turn.');
  }
  private touch(record: GameRecord): void { record.revision += 1; record.updatedAt = new Date().toISOString(); }
  private finish(record: GameRecord): void { record.finishedAt = record.updatedAt; record.durationSeconds = Math.max(0, Math.round((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 100) / 10); }
  private assertRevision(record: GameRecord, expected: number): void { if (record.revision !== expected) throw new ConflictError(`Expected revision ${expected}, but current revision is ${record.revision}.`); }
  private assertRecordReplay(record: GameRecord): void {
    if (record.draft.baseVersion !== record.committedState.version) throw new Error('Draft base version does not match committed state.');
    const committed = replayCommands(record.initialState, record.committedCommands);
    if (JSON.stringify(committed) !== JSON.stringify(record.committedState)) throw new Error('Committed command replay diverged from the saved state.');
    const current = record.draft.command ? applyCommand(record.committedState, record.draft.command) : cloneGame(record.committedState);
    if (JSON.stringify(current) !== JSON.stringify(record.state)) throw new Error('Action preview diverged from the saved state.');
    assertInvariants(record.state);
  }
  private safeView(record: GameRecord): SafeGameView {
    const state = record.state; const preview = record.draft.command !== null; const baseHandIds = new Set(record.draft.baseState.players[record.humanPlayerId].deck.hand.map((card) => card.id));
    const players = Object.fromEntries((['ochre', 'indigo'] as const).map((playerId) => {
      const player = state.players[playerId];
      const hand: SafeCardInstance[] | null = playerId === record.humanPlayerId ? player.deck.hand.map((card) => preview && !baseHandIds.has(card.id) ? { id: `hidden-${card.id}`, definitionId: null } : { ...card }) : null;
      return [playerId, { id: playerId, hand, zoneCounts: { draw: player.deck.draw.length, hand: player.deck.hand.length, discard: player.deck.discard.length, play: player.deck.play.length }, money: player.money, firstBuyMoney: player.firstBuyMoney, firstBuyPending: player.firstBuyPending, purchases: [...player.purchases] }];
    })) as SafeGameView['players'];
    const canChoose = state.activePlayerId === record.humanPlayerId && !state.winner && !record.draft.command && state.phase !== 'startingBuild';
    const completedBuilds = state.players.ochre.startingBuild && state.players.indigo.startingBuild ? { ochre: [...state.players.ochre.startingBuild], indigo: [...state.players.indigo.startingBuild] } : null;
    return {
      schemaVersion: 3, id: record.id, revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt,
      elapsedSeconds: Math.max(0, Math.floor((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 1000)), completedActions: record.completedActions,
      durationSeconds: record.durationSeconds, humanPlayerId: record.humanPlayerId, aiPlayerId: record.aiPlayerId,
      activePlayerId: state.activePlayerId, selectedFirstPlayerId: state.selectedFirstPlayerId, phase: state.phase, turn: state.turn, winner: state.winner,
      fighters: structuredClone(state.fighters), range: rangeBand(state), supply: { ...state.supply }, cards: structuredClone(CARDS), players,
      trashCount: state.trash.length, events: structuredClone(state.events), draftEventStart: record.draft.baseState.events.length,
      legalActions: canChoose ? listLegalActions(record.draft.baseState) : [], actionAvailability: canChoose ? listActionAvailability(record.draft.baseState, record.humanPlayerId) : [],
      previewCommand: record.draft.command ? structuredClone(record.draft.command) : null, canUndo: preview, canConfirm: preview,
      previewHidesDraws: preview && players[record.humanPlayerId].hand?.some((card) => card.definitionId === null) === true,
      humanBuildProposal: [...record.humanBuildProposal], completedBuilds, strategy: { ...record.strategy }, aiRuntime: { ...record.aiRuntime },
      lastAiSummary: record.aiActions.at(-1)?.summary ?? null
    };
  }
}
export function commandFromAction(actions: LegalAction[], id: string): GameCommand | null { return actions.find((action) => action.id === id)?.command ?? null; }
