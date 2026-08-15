import { randomUUID } from 'node:crypto';
import {
  CARDS, applyAction, applyCommand, assertInvariants, cloneGame, createGame,
  listLegalActions, opponent, replayCommands
} from '../game';
import type { GameCommand, LegalAction } from '../game';
import type { RedactedExport, SafeGameView } from '../shared/api';
import type { GameRecord, GameRepository } from './types';

export class ConflictError extends Error {}
export class ForbiddenActionError extends Error {}

export interface CreateGameInput {
  seed?: number | undefined;
  strategyPresetId: string;
  strategyMarkdown: string;
}

export class GameService {
  constructor(
    private readonly repository: GameRepository,
    private readonly aiRuntime = { model: 'openai:gpt-5.6-luna', effort: 'low' }
  ) {}

  async create(input: CreateGameInput): Promise<SafeGameView> {
    const now = new Date().toISOString();
    const initialState = createGame(input.seed ?? Date.now());
    const humanPlayerId = 'ochre' as const;
    const record: GameRecord = {
      schemaVersion: 2,
      id: randomUUID(),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      completedActions: 0,
      durationSeconds: null,
      humanPlayerId,
      aiPlayerId: opponent(humanPlayerId),
      strategy: { presetId: input.strategyPresetId, markdown: input.strategyMarkdown },
      aiRuntime: { ...this.aiRuntime },
      aiActions: [],
      initialState: cloneGame(initialState),
      committedCommands: [],
      committedState: cloneGame(initialState),
      draft: { baseVersion: initialState.version, baseState: cloneGame(initialState), command: null },
      state: initialState
    };
    await this.repository.create(record);
    return this.safeView(record);
  }

  async get(id: string): Promise<SafeGameView> { return this.safeView(await this.repository.load(id)); }
  async getRecord(id: string): Promise<GameRecord> { return this.repository.load(id); }

  async previewHumanAction(id: string, expectedRevision: number, actionId: string): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      this.assertHumanChoice(record);
      if (record.draft.command) throw new ForbiddenActionError('Confirm or undo the current preview first.');
      const selected = listLegalActions(record.state).find((action) => action.id === actionId);
      if (!selected) throw new ConflictError('That action is no longer legal.');
      record.draft = {
        baseVersion: record.state.version,
        baseState: cloneGame(record.state),
        command: selected.command
      };
      record.state = applyAction(record.state, selected.id);
      this.touch(record);
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.safeView(record);
    });
  }

  async confirmHumanAction(id: string, expectedRevision: number): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      const command = record.draft.command;
      if (!command) throw new ForbiddenActionError('There is no action to confirm.');
      record.committedCommands.push(command);
      record.committedState = cloneGame(record.state);
      record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), command: null };
      record.completedActions += 1;
      this.touch(record);
      if (record.state.winner) this.finishMatch(record);
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.safeView(record);
    });
  }

  async undoHumanAction(id: string, expectedRevision: number): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      if (!record.draft.command) throw new ForbiddenActionError('There is no action to undo.');
      record.state = cloneGame(record.draft.baseState);
      record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), command: null };
      this.touch(record);
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.safeView(record);
    });
  }

  async commitAiAction(
    id: string,
    baseRevision: number,
    actionId: string,
    summary: string,
    durationSeconds: number
  ): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, baseRevision);
      if (record.state.activePlayerId !== record.aiPlayerId || record.state.winner) {
        throw new ForbiddenActionError('There is no AI action to commit.');
      }
      if (record.draft.command) throw new ConflictError('The AI action did not start at a confirmation boundary.');
      const actions = listLegalActions(record.state);
      const selected = actions.find((action) => action.id === actionId);
      if (!selected) throw new ConflictError('The AI returned an unknown or stale action ID.');
      this.assertAiCorrectness(record, actions, selected);
      const round = record.state.round.number;
      const actionStep = record.state.round.actionStep;
      record.state = applyAction(record.state, selected.id);
      record.committedCommands.push(selected.command);
      record.committedState = cloneGame(record.state);
      record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), command: null };
      record.completedActions += 1;
      this.touch(record);
      if (record.state.winner) this.finishMatch(record);
      record.aiActions.push({
        committedRevision: record.revision,
        round,
        actionStep,
        actionId,
        summary: summary.slice(0, 1000),
        durationSeconds
      });
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.safeView(record);
    });
  }

  async fullExport(id: string): Promise<GameRecord> { return this.repository.load(id); }

  async redactedExport(id: string): Promise<RedactedExport> {
    const record = await this.repository.load(id);
    return { schemaVersion: 2, exportedAt: new Date().toISOString(), game: this.safeView(record) };
  }

  private assertHumanChoice(record: GameRecord): void {
    if (record.state.activePlayerId !== record.humanPlayerId || record.state.winner) {
      throw new ForbiddenActionError('It is not the human player’s action step.');
    }
  }

  private assertAiCorrectness(record: GameRecord, actions: LegalAction[], selected: LegalAction): void {
    const playerId = record.aiPlayerId;
    const outcomes = actions.map((action) => ({ action, state: applyAction(record.state, action.id) }));
    const winning = outcomes.filter((outcome) => outcome.state.winner === playerId);
    if (winning.length && !winning.some((outcome) => outcome.action.id === selected.id)) {
      throw new ConflictError('AI must take an immediate match win.');
    }
    const maximumPointGain = Math.max(0, ...outcomes.map((outcome) => outcome.state.scores[playerId] - record.state.scores[playerId]));
    if (maximumPointGain > 0 && selected.command.type === 'pass') {
      throw new ConflictError('AI cannot pass when an immediate point is available.');
    }
  }

  private touch(record: GameRecord): void {
    record.revision += 1;
    record.updatedAt = new Date().toISOString();
  }

  private finishMatch(record: GameRecord): void {
    record.finishedAt = record.updatedAt;
    record.durationSeconds = Math.max(0, Math.round((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 100) / 10);
  }

  private assertRevision(record: GameRecord, expectedRevision: number): void {
    if (record.revision !== expectedRevision) {
      throw new ConflictError(`Expected revision ${expectedRevision}, but current revision is ${record.revision}.`);
    }
  }

  private assertRecordReplay(record: GameRecord): void {
    if (record.draft.baseVersion !== record.committedState.version) {
      throw new Error('Draft base version does not match committed state.');
    }
    const committed = replayCommands(record.initialState, record.committedCommands);
    if (JSON.stringify(committed) !== JSON.stringify(record.committedState)) {
      throw new Error('Committed command replay diverged from the saved state.');
    }
    const current = record.draft.command
      ? applyCommand(record.committedState, record.draft.command)
      : cloneGame(record.committedState);
    if (JSON.stringify(current) !== JSON.stringify(record.state)) {
      throw new Error('Action preview diverged from the saved state.');
    }
    assertInvariants(record.state);
  }

  private safeView(record: GameRecord): SafeGameView {
    const state = record.state;
    const players = Object.fromEntries((['ochre', 'indigo'] as const).map((playerId) => {
      const player = state.players[playerId];
      return [playerId, {
        id: playerId,
        hand: playerId === record.humanPlayerId ? structuredClone(player.deck.hand) : null,
        zoneCounts: {
          draw: player.deck.draw.length,
          hand: player.deck.hand.length,
          discard: player.deck.discard.length,
          play: player.deck.play.length
        },
        money: player.money,
        buys: player.buys,
        roundsCompleted: player.roundsCompleted
      }];
    })) as SafeGameView['players'];
    const pieces = Object.fromEntries(Object.values(state.pieces).map((piece) => [piece.id, {
      ...structuredClone(piece), pinned: piece.pinned !== null
    }])) as SafeGameView['pieces'];
    const canChoose = state.activePlayerId === record.humanPlayerId && !state.winner && !record.draft.command;
    return {
      id: record.id,
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      elapsedSeconds: Math.max(0, Math.floor((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 1000)),
      completedActions: record.completedActions,
      durationSeconds: record.durationSeconds,
      humanPlayerId: record.humanPlayerId,
      aiPlayerId: record.aiPlayerId,
      activePlayerId: state.activePlayerId,
      phase: state.phase,
      round: structuredClone(state.round),
      scores: { ...state.scores },
      winner: state.winner,
      pieces,
      blocks: structuredClone(state.blocks),
      supply: { ...state.supply },
      cards: structuredClone(CARDS),
      players,
      trashCount: state.trash.length,
      events: structuredClone(state.events),
      draftEventStart: record.draft.baseState.events.length,
      legalActions: canChoose ? listLegalActions(record.draft.baseState) : [],
      previewCommand: record.draft.command ? structuredClone(record.draft.command) : null,
      canUndo: record.draft.command !== null,
      canConfirm: record.draft.command !== null,
      strategy: { ...record.strategy },
      aiRuntime: { ...record.aiRuntime },
      lastAiSummary: record.aiActions.at(-1)?.summary ?? null
    };
  }
}

export function commandFromAction(actions: LegalAction[], id: string): GameCommand | null {
  return actions.find((action) => action.id === id)?.command ?? null;
}
