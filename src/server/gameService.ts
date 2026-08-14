import { randomUUID } from 'node:crypto';
import {
  CARDS, applyAction, applyCommand, assertInvariants, cloneGame, createGame, listLegalActions,
  findMaximumPoints, opponent, replayCommands, undoPreviewAction
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
      schemaVersion: 1,
      id: randomUUID(),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      completedTurns: 0,
      durationSeconds: null,
      humanPlayerId,
      aiPlayerId: opponent(humanPlayerId),
      strategy: { presetId: input.strategyPresetId, markdown: input.strategyMarkdown },
      aiRuntime: { ...this.aiRuntime },
      aiTurns: [],
      initialState: cloneGame(initialState),
      committedCommands: [],
      committedState: cloneGame(initialState),
      draft: { baseVersion: initialState.version, baseState: cloneGame(initialState), commands: [] },
      state: initialState
    };
    await this.repository.create(record);
    return this.safeView(record);
  }

  async get(id: string): Promise<SafeGameView> {
    return this.safeView(await this.repository.load(id));
  }

  async getRecord(id: string): Promise<GameRecord> {
    return this.repository.load(id);
  }

  async applyHumanAction(id: string, expectedRevision: number, selectedActionId: string): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      if (record.state.activePlayerId !== record.humanPlayerId || record.state.winner) {
        throw new ForbiddenActionError('It is not the human player’s turn.');
      }
      const selected = listLegalActions(record.state).find((action) => action.id === selectedActionId);
      if (!selected) throw new ConflictError('That action is no longer legal.');
      record.state = applyAction(record.state, selected.id);
      record.draft.commands.push(selected.command);
      record.revision += 1;
      record.updatedAt = new Date().toISOString();
      if (selected.command.type === 'endTurn' || record.state.winner) {
        this.commitDraft(record);
        record.completedTurns += 1;
      }
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
      if (record.state.activePlayerId !== record.humanPlayerId || record.state.phase !== 'action') {
        throw new ForbiddenActionError('Undo is available only during the human action phase.');
      }
      if (record.draft.commands.length === 0) throw new ForbiddenActionError('There is no action to undo.');
      const preview = undoPreviewAction({
        baseState: record.draft.baseState,
        commands: record.draft.commands,
        state: record.state
      });
      record.state = preview.state;
      record.draft.commands = preview.commands;
      record.revision += 1;
      record.updatedAt = new Date().toISOString();
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.safeView(record);
    });
  }

  async commitAiTurn(
    id: string,
    baseRevision: number,
    commands: GameCommand[],
    summary: string,
    durationSeconds: number
  ): Promise<SafeGameView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, baseRevision);
      if (record.state.activePlayerId !== record.aiPlayerId || record.state.winner) {
        throw new ForbiddenActionError('It is not the AI player’s turn.');
      }
      if (record.draft.commands.length > 0) throw new ConflictError('The AI turn did not start from a clean draft.');
      const initialScore = record.state.scores[record.aiPlayerId];
      const maximumPoints = findMaximumPoints(record.state).points;
      let state = cloneGame(record.state);
      for (const command of commands) {
        if (state.activePlayerId !== record.aiPlayerId && !state.winner) {
          throw new ConflictError('AI commands continued after its turn ended.');
        }
        state = applyCommand(state, command);
      }
      const scored = state.scores[record.aiPlayerId] - initialScore;
      if (scored < maximumPoints) {
        throw new ConflictError(`AI scored ${scored}, but ${maximumPoints} point(s) were available.`);
      }
      if (!state.winner && state.activePlayerId === record.aiPlayerId) {
        throw new ConflictError('AI command transaction did not finish the turn.');
      }
      record.state = state;
      record.committedCommands.push(...commands);
      record.committedState = cloneGame(state);
      record.draft = { baseVersion: state.version, baseState: cloneGame(state), commands: [] };
      record.revision += 1;
      record.updatedAt = new Date().toISOString();
      record.completedTurns += 1;
      if (state.winner) this.finishMatch(record);
      record.aiTurns.push({
        committedRevision: record.revision,
        summary: summary.slice(0, 1000),
        durationSeconds
      });
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.safeView(record);
    });
  }

  async fullExport(id: string): Promise<GameRecord> {
    return this.repository.load(id);
  }

  async redactedExport(id: string): Promise<RedactedExport> {
    const record = await this.repository.load(id);
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), game: this.safeView(record) };
  }

  private commitDraft(record: GameRecord): void {
    record.committedCommands.push(...record.draft.commands);
    record.committedState = cloneGame(record.state);
    record.draft = {
      baseVersion: record.state.version,
      baseState: cloneGame(record.state),
      commands: []
    };
  }

  private finishMatch(record: GameRecord): void {
    record.finishedAt = record.updatedAt;
    record.durationSeconds = Math.max(
      0,
      Math.round((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 100) / 10
    );
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
    const current = replayCommands(record.committedState, record.draft.commands);
    if (JSON.stringify(current) !== JSON.stringify(record.state)) {
      throw new Error('Draft command replay diverged from the saved state.');
    }
    assertInvariants(record.state);
  }

  private safeView(record: GameRecord): SafeGameView {
    const state = record.state;
    const safePlayers = Object.fromEntries(
      (['ochre', 'indigo'] as const).map((playerId) => {
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
          turnsTaken: player.turnsTaken
        }];
      })
    ) as SafeGameView['players'];
    const pieces = Object.fromEntries(Object.values(state.pieces).map((piece) => [piece.id, {
      ...structuredClone(piece),
      pinned: piece.pinned !== null
    }])) as SafeGameView['pieces'];
    const humanCanAct = state.activePlayerId === record.humanPlayerId && !state.winner;
    const legalActions: LegalAction[] = humanCanAct ? listLegalActions(state) : [];
    return {
      id: record.id,
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      elapsedSeconds: Math.max(0, Math.floor((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 1000)),
      completedTurns: record.completedTurns,
      durationSeconds: record.durationSeconds,
      humanPlayerId: record.humanPlayerId,
      aiPlayerId: record.aiPlayerId,
      activePlayerId: state.activePlayerId,
      phase: state.phase,
      scores: { ...state.scores },
      winner: state.winner,
      pieces,
      blocks: structuredClone(state.blocks),
      supply: { ...state.supply },
      cards: structuredClone(CARDS),
      players: safePlayers,
      trashCount: state.trash.length,
      events: structuredClone(state.events),
      draftEventStart: record.draft.baseState.events.length,
      legalActions,
      canUndo: humanCanAct && state.phase === 'action' && record.draft.commands.length > 0,
      strategy: { ...record.strategy },
      aiRuntime: { ...record.aiRuntime },
      lastAiSummary: record.aiTurns.at(-1)?.summary ?? null
    };
  }
}

export function commandFromAction(actions: LegalAction[], id: string): GameCommand | null {
  return actions.find((action) => action.id === id)?.command ?? null;
}
