import { randomUUID } from 'node:crypto';
import {
  applyCommand, assertInvariants, cardDefinition, cloneGame, createGame, kingdomMarket,
  listActionAvailability, listLegalActions, marketCost, rangeBand, replayCommands
} from '../game';
import type { CardInstance, GameCommand, GameEvent, GameState, LegalAction, PlayerId } from '../game';
import type { AiTurnRecap, OpponentMode, RedactedExport, SafeGameView } from '../shared/api';
import type { GameRecord, GameRepository, UndoCheckpoint } from './types';

export class ConflictError extends Error {}
export class ForbiddenActionError extends Error {}
export class BadBuildError extends Error {}
export interface CreateGameInput { seed?: number | undefined; strategyPresetId: string; strategyMarkdown: string; firstPlayerId?: PlayerId | undefined; opponentMode?: OpponentMode | undefined }
export class GameService {
  constructor(private readonly repository: GameRepository, private readonly aiRuntime = { model: 'openai:gpt-5.6-luna', effort: 'low' }) {}
  async create(input: CreateGameInput): Promise<SafeGameView> {
    const now = new Date().toISOString(); const initialState = createGame({ seed: input.seed ?? Date.now(), firstPlayerId: input.firstPlayerId });
    const record: GameRecord = {
      schemaVersion: 8, id: randomUUID(), revision: 0, createdAt: now, updatedAt: now, finishedAt: null,
      completedActions: 0, durationSeconds: null, humanPlayerId: 'ochre', aiPlayerId: 'indigo', opponentMode: input.opponentMode ?? 'ai',
      strategy: { presetId: input.strategyPresetId, markdown: input.strategyMarkdown }, aiRuntime: { ...this.aiRuntime },
      humanBuildProposal: [], activeAiTurn: null, lastAiTurnRecap: null, aiActions: [], initialState: cloneGame(initialState), committedCommands: [],
      undoCheckpoint: null, state: initialState
    };
    await this.repository.create(record); return this.safeView(record);
  }
  async get(id: string): Promise<SafeGameView> { return this.safeView(await this.repository.load(id)); }
  async getRecord(id: string): Promise<GameRecord> { return this.repository.load(id); }
  async updateHumanBuild(id: string, expectedRevision: number, definitionIds: string[], complete: boolean): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, expectedRevision);
      const builderId = record.opponentMode === 'local' ? record.state.activePlayerId : record.humanPlayerId;
      if (record.state.phase !== 'startingBuild' || record.state.players[builderId].startingBuild) throw new ForbiddenActionError('This starting build is already complete.');
      if (record.opponentMode === 'ai' && builderId !== record.humanPlayerId) throw new ForbiddenActionError('The human starting build is already complete.');
      try { for (const definitionId of definitionIds) cardDefinition(definitionId); }
      catch { throw new BadBuildError('Starting build contains an unknown card.'); }
      if (complete && marketCost(record.state, definitionIds) > 12) throw new BadBuildError('Starting build costs more than 12 money.');
      record.humanBuildProposal = [...definitionIds]; record.undoCheckpoint = null;
      if (complete) { this.commitCommand(record, { type: 'submitStartingBuild', playerId: builderId, definitionIds }); record.humanBuildProposal = []; }
      this.touch(record); this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async commitAiBuild(id: string, baseRevision: number, definitionIds: string[], summary: string, durationSeconds: number): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, baseRevision);
      if (record.opponentMode !== 'ai') throw new ForbiddenActionError('This game has no AI player.');
      if (record.state.phase !== 'startingBuild' || record.state.activePlayerId !== record.aiPlayerId) throw new ForbiddenActionError('There is no AI starting build to commit.');
      const turn = record.state.turn; const phase = record.state.phase; record.undoCheckpoint = null;
      this.commitCommand(record, { type: 'submitStartingBuild', playerId: record.aiPlayerId, definitionIds });
      this.touch(record); record.aiActions.push({ committedRevision: record.revision, turn, phase, decisionIndex: 0, actionId: 'starting-build', summary: summary.slice(0, 1000), durationSeconds });
      this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async commitHumanAction(id: string, expectedRevision: number, actionId: string): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, expectedRevision); this.assertHumanChoice(record);
      const selected = listLegalActions(record.state).find((action) => action.id === actionId);
      if (!selected) throw new ConflictError('That action is no longer legal.');
      record.undoCheckpoint = this.checkpoint(record); this.commitCommand(record, selected.command);
      record.completedActions += 1; this.touch(record); if (record.state.winner) this.finish(record);
      this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async undoHumanAction(id: string, expectedRevision: number): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, expectedRevision);
      const checkpoint = record.undoCheckpoint; if (!checkpoint) throw new ForbiddenActionError('There is no action to undo.');
      record.committedCommands = record.committedCommands.slice(0, checkpoint.committedCommandCount);
      record.state = replayCommands(record.initialState, record.committedCommands);
      record.completedActions = checkpoint.completedActions; record.finishedAt = checkpoint.finishedAt; record.durationSeconds = checkpoint.durationSeconds;
      record.undoCheckpoint = null; this.touch(record); this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async commitAiAction(id: string, baseRevision: number, actionId: string, summary: string, durationSeconds: number, decisionIndex: number, fallback = false): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id); this.assertRevision(record, baseRevision);
      if (record.opponentMode !== 'ai') throw new ForbiddenActionError('This game has no AI player.');
      if (record.state.activePlayerId !== record.aiPlayerId || record.state.winner || record.state.phase === 'startingBuild') throw new ForbiddenActionError('There is no AI action to commit.');
      const selected = listLegalActions(record.state).find((action) => action.id === actionId);
      if (!selected) throw new ConflictError('The AI returned an unknown or stale action ID.');
      const turn = record.state.turn; const phase = record.state.phase; const before = cloneGame(record.state);
      const audit = this.ensureAiTurn(record, before); const eventStart = before.events.length;
      record.undoCheckpoint = null; this.commitCommand(record, selected.command);
      this.captureAiAction(audit, before, record.state, selected, record.state.events.slice(eventStart));
      if (selected.command.type === 'endBuyPhase' || record.state.winner) {
        if (record.state.winner && !audit.unplayed.length) audit.unplayed = structuredClone(record.state.players[record.aiPlayerId].deck.hand);
        record.lastAiTurnRecap = structuredClone(audit); record.activeAiTurn = null;
      }
      record.completedActions += 1; this.touch(record); if (record.state.winner) this.finish(record);
      record.aiActions.push({ committedRevision: record.revision, turn, phase, decisionIndex, actionId, summary: summary.slice(0, 1000), durationSeconds, ...(fallback ? { fallback: true } : {}) });
      this.assertRecordReplay(record); await this.repository.save(record); return this.safeView(record);
    });
  }
  async redactedExport(id: string): Promise<RedactedExport> { return { schemaVersion: 8, exportedAt: new Date().toISOString(), game: this.safeView(await this.repository.load(id)) }; }
  private ensureAiTurn(record: GameRecord, state: GameState): AiTurnRecap {
    if (record.activeAiTurn?.turn === state.turn) return record.activeAiTurn;
    const player = state.players[record.aiPlayerId];
    record.activeAiTurn = {
      turn: state.turn,
      startingHand: structuredClone(state.phase === 'action' ? player.deck.hand : [...player.deck.play, ...player.deck.hand]),
      draws: [], actions: [], treasures: [], unplayed: [], purchases: [],
      startingMoney: 0, moneyAvailable: player.money, unspentMoney: 0, totalDamage: 0
    };
    return record.activeAiTurn;
  }
  private captureAiAction(audit: AiTurnRecap, before: GameState, after: GameState, selected: LegalAction, events: GameEvent[]): void {
    const playerId = before.activePlayerId; const beforePlayer = before.players[playerId]; const afterPlayer = after.players[playerId];
    const command = selected.command;
    if ('cardInstanceId' in command) {
      const card = beforePlayer.deck.hand.find((candidate) => candidate.id === command.cardInstanceId);
      if (!card) throw new Error('AI recap could not find its played card.');
      const beforeHandIds = new Set(beforePlayer.deck.hand.map((candidate) => candidate.id));
      const drawn = afterPlayer.deck.hand.filter((candidate) => !beforeHandIds.has(candidate.id));
      audit.draws.push(...drawn.map((candidate) => ({ card: structuredClone(candidate), sourceDefinitionId: card.definitionId })));
      const trashed = events.filter((event) => event.type === 'trash').map((event) => this.findCard(after, String(event.detail.cardInstanceId))).filter((candidate): candidate is CardInstance => candidate !== null);
      const damage = events.filter((event) => event.type === 'damage').reduce((total, event) => total + Number(event.detail.amount ?? 0), 0);
      const movements = events.flatMap((event) => {
        if (event.type === 'move') return [`${String(event.detail.movement)} to space ${String(event.detail.to)}`];
        if (event.type === 'wallCollision') return [`wall blocked ${String(event.detail.direction)}`];
        return [];
      });
      audit.actions.push({
        card: structuredClone(card), label: selected.label, damage, movements,
        drawnCardIds: drawn.map((candidate) => candidate.id), trashed: structuredClone(trashed)
      });
      audit.totalDamage += damage;
      return;
    }
    if (command.type === 'endActionPhase') {
      audit.treasures = beforePlayer.deck.hand.filter((card) => cardDefinition(card.definitionId).type === 'treasure').map((card) => ({ card: structuredClone(card), money: cardDefinition(card.definitionId).money ?? 0 }));
      audit.unplayed = structuredClone(beforePlayer.deck.hand.filter((card) => cardDefinition(card.definitionId).type === 'action'));
      const treasureMoney = audit.treasures.reduce((total, treasure) => total + treasure.money, 0);
      audit.moneyAvailable = afterPlayer.money; audit.startingMoney = Math.max(0, afterPlayer.money - treasureMoney);
      return;
    }
    if (command.type === 'buyCard') {
      audit.purchases.push({ definitionId: command.definitionId, cost: cardDefinition(command.definitionId).cost });
      return;
    }
    if (command.type === 'endBuyPhase') audit.unspentMoney = beforePlayer.money;
  }
  private findCard(state: GameState, cardInstanceId: string): CardInstance | null {
    return [...state.trash, ...Object.values(state.players).flatMap((player) => [...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play])].find((card) => card.id === cardInstanceId) ?? null;
  }
  private checkpoint(record: GameRecord): UndoCheckpoint {
    return {
      committedCommandCount: record.committedCommands.length, completedActions: record.completedActions,
      finishedAt: record.finishedAt, durationSeconds: record.durationSeconds
    };
  }
  private commitCommand(record: GameRecord, command: GameCommand): void {
    record.state = applyCommand(record.state, command); record.committedCommands.push(command);
  }
  private assertHumanChoice(record: GameRecord): void {
    const localTurn = record.opponentMode === 'local';
    if ((!localTurn && record.state.activePlayerId !== record.humanPlayerId) || record.state.winner || record.state.phase === 'startingBuild') throw new ForbiddenActionError('It is not a local player’s turn.');
  }
  private touch(record: GameRecord): void { record.revision += 1; record.updatedAt = new Date().toISOString(); }
  private finish(record: GameRecord): void { record.finishedAt = record.updatedAt; record.durationSeconds = Math.max(0, Math.round((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 100) / 10); }
  private assertRevision(record: GameRecord, expected: number): void { if (record.revision !== expected) throw new ConflictError(`Expected revision ${expected}, but current revision is ${record.revision}.`); }
  private assertRecordReplay(record: GameRecord): void {
    const replayed = replayCommands(record.initialState, record.committedCommands);
    if (JSON.stringify(replayed) !== JSON.stringify(record.state)) throw new Error('Committed command replay diverged from the saved state.');
    if (record.undoCheckpoint && record.undoCheckpoint.committedCommandCount >= record.committedCommands.length) throw new Error('Undo checkpoint does not precede the saved state.');
    assertInvariants(record.state);
  }
  private safeView(record: GameRecord): SafeGameView {
    const state = record.state; const local = record.opponentMode === 'local'; const viewPlayerId = local ? state.activePlayerId : record.humanPlayerId;
    const players = Object.fromEntries((['ochre', 'indigo'] as const).map((playerId) => {
      const player = state.players[playerId]; const privateVisible = local || playerId === record.humanPlayerId;
      const allCards = [...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play];
      const deckCounts = privateVisible ? allCards.reduce<Record<string, number>>((counts, card) => { counts[card.definitionId] = (counts[card.definitionId] ?? 0) + 1; return counts; }, {}) : null;
      return [playerId, {
        id: playerId, hand: privateVisible ? structuredClone(player.deck.hand) : null,
        played: privateVisible ? structuredClone(player.deck.play) : null,
        zoneCounts: { draw: player.deck.draw.length, hand: player.deck.hand.length, discard: player.deck.discard.length, play: player.deck.play.length }, deckCounts,
        money: player.money, firstBuyMoney: player.firstBuyMoney, firstBuyPending: player.firstBuyPending, purchases: [...player.purchases]
      }];
    })) as SafeGameView['players'];
    const canChoose = (local || state.activePlayerId === record.humanPlayerId) && !state.winner && state.phase !== 'startingBuild';
    const completedBuilds = state.players.ochre.startingBuild && state.players.indigo.startingBuild ? { ochre: [...state.players.ochre.startingBuild], indigo: [...state.players.indigo.startingBuild] } : null;
    return {
      schemaVersion: 8, id: record.id, revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt,
      elapsedSeconds: Math.max(0, Math.floor((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 1000)), completedActions: record.completedActions,
      durationSeconds: record.durationSeconds, humanPlayerId: record.humanPlayerId, aiPlayerId: record.aiPlayerId,
      opponentMode: record.opponentMode, viewPlayerId,
      activePlayerId: state.activePlayerId, selectedFirstPlayerId: state.selectedFirstPlayerId, phase: state.phase, turn: state.turn, winner: state.winner,
      fighters: structuredClone(state.fighters), range: rangeBand(state), supply: { ...state.supply },
      cards: Object.fromEntries(kingdomMarket(state.kingdomId).map((card) => [card.id, card])), players,
      trashCount: state.trash.length, events: structuredClone(state.events), legalActions: canChoose ? listLegalActions(state) : [], actionAvailability: canChoose ? listActionAvailability(state, viewPlayerId) : [], canUndo: record.undoCheckpoint !== null,
      humanBuildProposal: [...record.humanBuildProposal], completedBuilds, strategy: { ...record.strategy }, aiRuntime: { ...record.aiRuntime },
      lastAiSummary: record.aiActions.at(-1)?.summary ?? null,
      lastAiTurnRecap: record.opponentMode === 'ai' && record.lastAiTurnRecap ? structuredClone(record.lastAiTurnRecap) : null
    };
  }
}
