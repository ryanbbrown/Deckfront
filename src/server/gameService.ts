import { randomUUID } from 'node:crypto';
import {
  applyCommand, assertInvariants, CARDS, cloneGame, createGame, kingdomMarket,
  listActionAvailability, listLegalActions, marketCost, rangeBand, replayCommands
} from '../game';
import type { GameCommand, PlayerId } from '../game';
import type {
  BrowserAction, CardActionChoice, CardActionPresentation, GameActionPresentation, GameExport, GameView,
  PhaseActionPresentation
} from '../shared/api';
import type { GameRecord, GameRepository, UndoCheckpoint } from './types';

export class ConflictError extends Error {}
export class ForbiddenActionError extends Error {}
export class BadBuildError extends Error {}
export interface CreateGameInput { seed?: number | undefined; firstPlayerId?: PlayerId | undefined }
export class GameService {
  constructor(private readonly repository: GameRepository) {}
  async create(input: CreateGameInput): Promise<GameView> {
    const now = new Date().toISOString();
    const initialState = createGame({ seed: input.seed ?? Date.now(), firstPlayerId: input.firstPlayerId });
    const record: GameRecord = {
      schemaVersion: 9, id: randomUUID(), revision: 0, createdAt: now, updatedAt: now, finishedAt: null,
      completedActions: 0, durationSeconds: null, buildProposal: [], initialState: cloneGame(initialState),
      committedCommands: [], undoCheckpoint: null, state: initialState
    };
    await this.repository.create(record);
    return this.gameView(record);
  }
  async get(id: string): Promise<GameView> { return this.gameView(await this.repository.load(id)); }
  async getRecord(id: string): Promise<GameRecord> { return this.repository.load(id); }
  async updateBuild(id: string, expectedRevision: number, definitionIds: string[], complete: boolean): Promise<GameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      const builderId = record.state.activePlayerId;
      if (record.state.phase !== 'startingBuild' || record.state.players[builderId].startingBuild) throw new ForbiddenActionError('This starting build is already complete.');
      for (const definitionId of definitionIds) if (!CARDS[definitionId]) throw new BadBuildError('Starting build contains an unknown card.');
      const forSale = new Set(kingdomMarket(record.state.kingdomId).map((card) => card.id));
      for (const definitionId of definitionIds) if (!forSale.has(definitionId)) throw new BadBuildError('Starting build contains a card this kingdom does not sell.');
      if (complete && marketCost(record.state, definitionIds) > 12) throw new BadBuildError('Starting build costs more than 12 money.');
      record.buildProposal = [...definitionIds];
      record.undoCheckpoint = null;
      if (complete) {
        this.commitCommand(record, { type: 'submitStartingBuild', playerId: builderId, definitionIds });
        record.buildProposal = [];
      }
      this.touch(record);
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.gameView(record);
    });
  }
  async commitAction(id: string, expectedRevision: number, actionId: string): Promise<GameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      if (record.state.winner || record.state.phase === 'startingBuild') throw new ForbiddenActionError('It is not a local player’s turn.');
      const selected = listLegalActions(record.state).find((action) => action.id === actionId);
      if (!selected) throw new ConflictError('That action is no longer legal.');
      record.undoCheckpoint = this.checkpoint(record);
      this.commitCommand(record, selected.command);
      record.completedActions += 1;
      this.touch(record);
      if (record.state.winner) this.finish(record);
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.gameView(record);
    });
  }
  async undoAction(id: string, expectedRevision: number): Promise<GameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      const checkpoint = record.undoCheckpoint;
      if (!checkpoint) throw new ForbiddenActionError('There is no action to undo.');
      record.committedCommands = record.committedCommands.slice(0, checkpoint.committedCommandCount);
      record.state = replayCommands(record.initialState, record.committedCommands);
      record.completedActions = checkpoint.completedActions;
      record.finishedAt = checkpoint.finishedAt;
      record.durationSeconds = checkpoint.durationSeconds;
      record.undoCheckpoint = null;
      this.touch(record);
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.gameView(record);
    });
  }
  async exportGame(id: string): Promise<GameExport> {
    return { schemaVersion: 10, exportedAt: new Date().toISOString(), game: this.gameView(await this.repository.load(id)) };
  }
  private checkpoint(record: GameRecord): UndoCheckpoint {
    return { committedCommandCount: record.committedCommands.length, completedActions: record.completedActions, finishedAt: record.finishedAt, durationSeconds: record.durationSeconds };
  }
  private commitCommand(record: GameRecord, command: GameCommand): void {
    record.state = applyCommand(record.state, command);
    record.committedCommands.push(command);
  }
  private touch(record: GameRecord): void { record.revision += 1; record.updatedAt = new Date().toISOString(); }
  private finish(record: GameRecord): void {
    record.finishedAt = record.updatedAt;
    record.durationSeconds = Math.max(0, Math.round((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 100) / 10);
  }
  private assertRevision(record: GameRecord, expected: number): void {
    if (record.revision !== expected) throw new ConflictError(`Expected revision ${expected}, but current revision is ${record.revision}.`);
  }
  private assertRecordReplay(record: GameRecord): void {
    const replayed = replayCommands(record.initialState, record.committedCommands);
    if (JSON.stringify(replayed) !== JSON.stringify(record.state)) throw new Error('Committed command replay diverged from the saved state.');
    if (record.undoCheckpoint && record.undoCheckpoint.committedCommandCount >= record.committedCommands.length) throw new Error('Undo checkpoint does not precede the saved state.');
    assertInvariants(record.state);
  }
  private projectActions(record: GameRecord): GameActionPresentation {
    const state = record.state;
    if (state.winner || state.phase === 'startingBuild') {
      return { cards: [], phases: [], buys: [], selection: null };
    }
    const legalActions = listLegalActions(state);
    const browserAction = (action: (typeof legalActions)[number], text = action.label): BrowserAction => ({
      id: action.id, label: action.label, text
    });
    const cardActions = new Map<string, (typeof legalActions)[number][]>();
    for (const action of legalActions) {
      if (!('cardInstanceId' in action.command)) continue;
      const actions = cardActions.get(action.command.cardInstanceId) ?? [];
      actions.push(action);
      cardActions.set(action.command.cardInstanceId, actions);
    }
    const cards: CardActionPresentation[] = listActionAvailability(state, state.activePlayerId).map((availability) => {
      const legal = cardActions.get(availability.cardInstanceId) ?? [];
      const selection: CardActionPresentation['selection'] = availability.selection === 'movement' || availability.selection === 'direction'
        ? 'movement'
        : availability.selection === 'trashOneOrTwo' ? 'trashOneOrTwo' : 'none';
      const choices: CardActionChoice[] = legal.map((action) => {
        let text = action.label;
        let targetCardInstanceIds: string[] = [];
        if (action.command.type === 'playFootwork') {
          text = action.command.movement === 'left' ? 'Left' : action.command.movement === 'right' ? 'Right' : 'Stay';
        } else if (action.command.type === 'playDrive') {
          text = action.command.direction === 'left' ? 'Move both left' : 'Move both right';
        } else if (action.command.type === 'playMoveAction') {
          text = action.command.direction === 'left' ? 'Left' : 'Right';
        } else if (action.command.type === 'playCull') {
          targetCardInstanceIds = [...action.command.trashInstanceIds];
        }
        return { ...browserAction(action, text), targetCardInstanceIds };
      });
      return {
        cardInstanceId: availability.cardInstanceId,
        enabled: availability.enabled,
        reason: availability.reason,
        selection,
        eligibleCardInstanceIds: [...availability.eligibleCardInstanceIds],
        actionId: selection === 'none' && legal.length === 1 ? legal[0]!.id : null,
        choices
      };
    });
    const phases: PhaseActionPresentation[] = [];
    for (const action of legalActions) {
      if (action.command.type === 'endActionPhase') phases.push({ ...browserAction(action, 'End Action phase'), kind: 'endAction' });
      if (action.command.type === 'endBuyPhase') phases.push({ ...browserAction(action, 'End Buy phase'), kind: 'endBuy' });
    }
    const buys = legalActions.flatMap((action) => action.command.type === 'buyCard'
      ? [{ ...browserAction(action, action.label), definitionId: action.command.definitionId }]
      : []);
    const selection = state.pendingChoice ? {
      kind: state.pendingChoice.type,
      choices: legalActions.flatMap((action) => {
        if (action.command.type === 'resolveDiscard') {
          return [{ ...browserAction(action), cardInstanceId: action.command.discardInstanceId }];
        }
        if (action.command.type === 'resolveRecover') {
          return [{ ...browserAction(action), cardInstanceId: action.command.recoverInstanceId }];
        }
        return [];
      })
    } : null;
    return { cards, phases, buys, selection };
  }
  private gameView(record: GameRecord): GameView {
    const state = record.state;
    const players = Object.fromEntries((['ochre', 'indigo'] as const).map((playerId) => {
      const player = state.players[playerId];
      const allCards = [...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play];
      const deckCounts = allCards.reduce<Record<string, number>>((counts, card) => {
        counts[card.definitionId] = (counts[card.definitionId] ?? 0) + 1;
        return counts;
      }, {});
      return [playerId, {
        id: playerId, hand: structuredClone(player.deck.hand), played: structuredClone(player.deck.play),
        zoneCounts: { draw: player.deck.draw.length, hand: player.deck.hand.length, discard: player.deck.discard.length, play: player.deck.play.length },
        deckCounts, money: player.money, firstBuyMoney: player.firstBuyMoney, firstBuyPending: player.firstBuyPending,
        purchases: [...player.purchases]
      }];
    })) as GameView['players'];
    const canChoose = !state.winner && state.phase !== 'startingBuild';
    const completedBuilds = state.players.ochre.startingBuild && state.players.indigo.startingBuild
      ? { ochre: [...state.players.ochre.startingBuild], indigo: [...state.players.indigo.startingBuild] }
      : null;
    return {
      schemaVersion: 10, id: record.id, revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt,
      elapsedSeconds: Math.max(0, Math.floor((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 1000)),
      completedActions: record.completedActions, durationSeconds: record.durationSeconds,
      activePlayerId: state.activePlayerId, selectedFirstPlayerId: state.selectedFirstPlayerId, phase: state.phase,
      turn: state.turn, winner: state.winner, fighters: structuredClone(state.fighters), range: rangeBand(state),
      supply: { ...state.supply }, cards: Object.fromEntries(kingdomMarket(state.kingdomId).map((card) => [card.id, card])),
      players, trashCount: state.trash.length, events: structuredClone(state.events),
      actions: canChoose ? this.projectActions(record) : { cards: [], phases: [], buys: [], selection: null },
      canUndo: record.undoCheckpoint !== null, buildProposal: [...record.buildProposal], completedBuilds
    };
  }
}
