import { randomUUID } from 'node:crypto';
import {
  ALWAYS_AVAILABLE_ACTION_IDS, ARENA_MAX, ARENA_MIN, STARTING_BUDGET, STARTING_DECK_COPPER_COUNT, TREASURE_IDS, VARIABLE_ACTION_IDS,
  applyCommand, assertInvariants, CARDS, cloneGame, createGame, kingdomMarket,
  listActionAvailability, listLegalActions, marketCost, opponent, randomKingdom, rangeBand, resolveCard,
  registerKingdom, replayCommands
} from '../game';
import type { GameCommand, GameState, PlayerId } from '../game';
import { tacticalAgent } from '../sim/tacticalAgent';
import type {
  AiDifficulty, BrowserAction, CardActionChoice, CardActionPresentation, GameActionPresentation, GameExport, GameUpdateView, GameView,
  PhaseActionPresentation, PresentationFrame, PresentationState, PresentationTransfer, PublicGameEvent
} from '../shared/api';
import type { GameRecord, GameRepository, UndoHistoryEntry } from './types';
import { PretrainedAiTrainer } from './aiTrainer';
import type { AiTrainer } from './aiTrainer';

export class ConflictError extends Error {}
export class ForbiddenActionError extends Error {}
export class BadBuildError extends Error {}
export class AiAdvanceError extends Error {}
export interface CreateGameInput {
  seed?: number | undefined;
  mode?: 'local' | 'ai' | undefined;
  humanPlayerId?: PlayerId | undefined;
  aiDifficulty?: AiDifficulty | undefined;
  variableCardIds?: string[] | undefined;
  startingDraftEnabled?: boolean | undefined;
}
export class GameService {
  constructor(private readonly repository: GameRepository, private readonly aiTrainer: AiTrainer = new PretrainedAiTrainer()) {}
  async create(input: CreateGameInput): Promise<GameUpdateView> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const seed = input.seed ?? Date.now();
    const mode = input.mode ?? 'local';
    const variableCardIds = input.variableCardIds ?? VARIABLE_ACTION_IDS.slice(0, 10);
    const kingdom = randomKingdom(`random-${id}`, variableCardIds);
    registerKingdom(kingdom);
    const humanPlayerId = mode === 'ai' ? input.humanPlayerId ?? 'ochre' : null;
    const aiPlayerId = humanPlayerId ? opponent(humanPlayerId) : null;
    const aiDifficulty = mode === 'ai' ? input.aiDifficulty ?? 'expert' : null;
    const trained = aiDifficulty ? await this.aiTrainer.train(kingdom, seed, aiDifficulty) : null;
    const startingDraftEnabled = mode === 'ai' ? false : input.startingDraftEnabled ?? false;
    const initialState = createGame({ seed, firstPlayerId: 'ochre', kingdomId: kingdom.id, startingDraftEnabled });
    const record: GameRecord = {
      schemaVersion: 15, id, revision: 0, createdAt: now, updatedAt: now, finishedAt: null,
      completedActions: 0, durationSeconds: null, buildProposal: [], kingdom, startingDraftEnabled, mode, humanPlayerId,
      aiDifficulty,
      aiStrategy: trained?.strategy ?? null, training: trained?.summary ?? null,
      initialState: cloneGame(initialState), committedCommands: [], undoHistory: [], state: initialState
    };
    const frames: PresentationFrame[] = [];
    if (aiPlayerId === 'ochre') this.advanceComputer(record, frames);
    await this.repository.create(record);
    return this.gameUpdate(record, frames);
  }
  async get(id: string): Promise<GameView> { return this.gameView(await this.repository.load(id)); }
  async getRecord(id: string): Promise<GameRecord> { return this.repository.load(id); }
  async updateBuild(id: string, expectedRevision: number, definitionIds: string[], complete: boolean): Promise<GameUpdateView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      const builderId = record.state.activePlayerId;
      if (record.mode === 'ai' && builderId !== record.humanPlayerId) throw new ForbiddenActionError('The AI controls this starting build.');
      if (record.state.phase !== 'startingBuild' || record.state.players[builderId].startingBuild) throw new ForbiddenActionError('This starting build is already complete.');
      for (const definitionId of definitionIds) if (!CARDS[definitionId]) throw new BadBuildError('Starting build contains an unknown card.');
      const forSale = new Set(kingdomMarket(record.state.kingdomId).map((card) => card.id));
      for (const definitionId of definitionIds) if (!forSale.has(definitionId)) throw new BadBuildError('Starting build contains a card this kingdom does not sell.');
      if (complete && marketCost(record.state, definitionIds) > STARTING_BUDGET) throw new BadBuildError(`Starting build costs more than ${STARTING_BUDGET} money.`);
      record.buildProposal = [...definitionIds];
      record.undoHistory = [];
      const frames: PresentationFrame[] = [];
      if (complete) {
        this.commitCommand(record, { type: 'submitStartingBuild', playerId: builderId, definitionIds }, frames);
        record.buildProposal = [];
        this.advanceComputer(record, frames);
      }
      this.touch(record);
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.gameUpdate(record, frames);
    });
  }
  async commitAction(id: string, expectedRevision: number, actionId: string): Promise<GameUpdateView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      if (record.state.winner || record.state.phase === 'startingBuild') throw new ForbiddenActionError('It is not a local player’s turn.');
      if (record.mode === 'ai' && record.state.activePlayerId !== record.humanPlayerId) throw new ForbiddenActionError('The AI controls this turn.');
      const selected = listLegalActions(record.state).find((action) => action.id === actionId);
      if (!selected) throw new ConflictError('That action is no longer legal.');
      record.undoHistory.push(this.historyEntry(record));
      const frames: PresentationFrame[] = [];
      this.commitCommand(record, selected.command, frames);
      record.completedActions += 1;
      this.advanceComputer(record, frames);
      this.touch(record);
      if (record.state.winner) this.finish(record);
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.gameUpdate(record, frames);
    });
  }
  async undoAction(id: string, expectedRevision: number): Promise<GameUpdateView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      const entry = record.undoHistory.pop();
      if (!entry) throw new ForbiddenActionError('There is no action to undo.');
      record.committedCommands = record.committedCommands.slice(0, entry.committedCommandCount);
      record.state = replayCommands(record.initialState, record.committedCommands);
      record.completedActions = entry.completedActions;
      record.finishedAt = entry.finishedAt;
      record.durationSeconds = entry.durationSeconds;
      this.touch(record);
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.gameUpdate(record, []);
    });
  }
  async resetGame(id: string, expectedRevision: number): Promise<GameUpdateView> {
    return this.repository.withLock(id, async () => {
      const record = await this.repository.load(id);
      this.assertRevision(record, expectedRevision);
      const setupCommands: GameCommand[] = [];
      if (record.startingDraftEnabled) {
        const ochreBuild = record.state.players.ochre.startingBuild;
        const indigoBuild = record.state.players.indigo.startingBuild;
        if (!ochreBuild || !indigoBuild) throw new ForbiddenActionError('Complete both starting builds before resetting the game.');
        setupCommands.push(
          { type: 'submitStartingBuild', playerId: 'ochre', definitionIds: [...ochreBuild] },
          { type: 'submitStartingBuild', playerId: 'indigo', definitionIds: [...indigoBuild] }
        );
      }
      record.committedCommands = setupCommands;
      record.state = replayCommands(record.initialState, setupCommands);
      record.buildProposal = [];
      record.undoHistory = [];
      record.completedActions = 0;
      record.finishedAt = null;
      record.durationSeconds = null;
      const frames: PresentationFrame[] = [];
      this.advanceComputer(record, frames);
      this.touch(record);
      this.assertRecordReplay(record);
      await this.repository.save(record);
      return this.gameUpdate(record, frames);
    });
  }
  async exportGame(id: string): Promise<GameExport> {
    return { schemaVersion: 15, exportedAt: new Date().toISOString(), game: this.gameView(await this.repository.load(id)) };
  }
  private advanceComputer(record: GameRecord, frames: PresentationFrame[]): void {
    if (record.mode !== 'ai' || !record.aiStrategy || !record.humanPlayerId) return;
    const aiPlayerId = opponent(record.humanPlayerId);
    const agent = tacticalAgent(record.aiStrategy);
    let actions = 0;
    if (!record.state.winner && record.state.activePlayerId === aiPlayerId && record.state.phase !== 'startingBuild') {
      frames.push(this.presentationFrame(record, aiPlayerId, 'aiTurnStart', []));
    }
    while (!record.state.winner && record.state.activePlayerId === aiPlayerId) {
      if (actions >= 1_000) throw new AiAdvanceError('The AI exceeded its turn action limit.');
      if (record.state.phase === 'startingBuild') {
        this.commitCommand(record, {
          type: 'submitStartingBuild', playerId: aiPlayerId,
          definitionIds: agent.chooseStartingBuild(record.state, aiPlayerId)
        }, frames);
      } else {
        const legal = listLegalActions(record.state);
        const selected = agent.chooseAction(record.state, aiPlayerId, legal);
        this.commitCommand(record, selected.command, frames);
        record.completedActions += 1;
      }
      actions += 1;
    }
  }
  private historyEntry(record: GameRecord): UndoHistoryEntry {
    return { committedCommandCount: record.committedCommands.length, completedActions: record.completedActions, finishedAt: record.finishedAt, durationSeconds: record.durationSeconds };
  }
  private commitCommand(record: GameRecord, command: GameCommand, frames: PresentationFrame[]): void {
    const before = record.state;
    record.state = applyCommand(record.state, command);
    record.committedCommands.push(command);
    frames.push(this.presentationFrame(record, before.activePlayerId, command.type, this.presentationTransfers(before, record.state, command)));
  }
  private presentationTransfers(before: GameState, after: GameState, command: GameCommand): PresentationTransfer[] {
    const transfers: PresentationTransfer[] = [];
    const newEvents = after.events.slice(before.events.length);
    for (const playerId of ['ochre', 'indigo'] as const) {
      const beforeDeck = before.players[playerId].deck;
      const beforeOwned = new Set([...beforeDeck.draw, ...beforeDeck.hand, ...beforeDeck.discard, ...beforeDeck.play].map((card) => card.id));
      const beforeHand = new Map(beforeDeck.hand.map((card) => [card.id, card]));
      const beforePlay = new Set(beforeDeck.play.map((card) => card.id));
      for (const card of after.players[playerId].deck.play) {
        if (!beforePlay.has(card.id) && beforeHand.has(card.id)) transfers.push({ kind: 'handToPlayed', playerId, card: { ...card }, hidden: false });
      }
      const drew = newEvents.some((event) => event.type === 'draw' && event.playerId === playerId);
      if (drew) {
        for (const card of after.players[playerId].deck.hand) {
          if (!beforeHand.has(card.id)) transfers.push({ kind: 'drawToHand', playerId, card: { ...card }, hidden: command.type === 'endBuyPhase' });
        }
      }
      if (command.type === 'buyCard' && playerId === before.activePlayerId) {
        const purchased = after.players[playerId].deck.discard.find((card) => !beforeOwned.has(card.id));
        if (!purchased) throw new Error('A purchased card was not added to the discard pile.');
        transfers.push({ kind: 'purchase', playerId, card: { ...purchased }, hidden: false });
      }
    }
    return transfers;
  }
  private presentationFrame(record: GameRecord, playerId: PlayerId, commandType: string, transfers: PresentationTransfer[]): PresentationFrame {
    return { playerId, commandType, state: this.presentationState(record.state), eventCount: record.state.events.length, transfers };
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
    for (let index = 0; index < record.undoHistory.length; index += 1) {
      const entry = record.undoHistory[index]!;
      if (entry.committedCommandCount >= record.committedCommands.length) throw new Error('Undo history does not precede the saved state.');
      if (index > 0 && record.undoHistory[index - 1]!.committedCommandCount >= entry.committedCommandCount) throw new Error('Undo history is not ordered.');
    }
    assertInvariants(record.state);
  }
  private publicEvents(record: GameRecord): PublicGameEvent[] {
    return record.state.events.map((event) => {
      const detail = event.detail;
      switch (event.type) {
        case 'buildComplete': return { ...event, detail: { count: detail.count, cost: detail.cost } };
        case 'cardPlayed': return { ...event, detail: { definitionId: detail.definitionId } };
        case 'move': return { ...event, detail: { movement: detail.movement, from: detail.from, to: detail.to, source: detail.source } };
        case 'draw': return { ...event, detail: { count: detail.count } };
        case 'condition': return { ...event, detail: { condition: detail.condition, change: detail.change, targetId: detail.targetId } };
        case 'damage': return { ...event, detail: { targetId: detail.targetId, amount: detail.amount, health: detail.health } };
        case 'wallCollision': return { ...event, detail: { direction: detail.direction } };
        case 'trash': case 'discard': return { ...event, detail: { definitionId: detail.definitionId } };
        case 'recover': return { ...event, detail: { definitionId: detail.definitionId, destination: 'hand' } };
        case 'gain': return { ...event, detail: { definitionId: detail.definitionId } };
        case 'phase': return { ...event, detail: { phase: detail.phase, money: detail.money } };
        case 'purchase': return { ...event, detail: { definitionId: detail.definitionId, cost: detail.cost } };
        case 'turn': return { ...event, detail: { turn: detail.turn, activePlayerId: detail.activePlayerId } };
        case 'victory': return { ...event, detail: { winner: detail.winner } };
        case 'mana': return { ...event, detail: { amount: detail.amount, mana: detail.mana } };
      }
    });
  }
  private projectActions(record: GameRecord): GameActionPresentation {
    const state = record.state;
    if (state.winner || state.phase === 'startingBuild' || state.phase === 'ended') {
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
        ? 'movement' : availability.selection === 'targets' ? 'targets' : 'none';
      const choices: CardActionChoice[] = legal.map((action) => {
        let text = action.label;
        let targetCardInstanceIds: string[] = [];
        let destination: number | null = null;
        let intoWall = false;
        const currentPosition = state.fighters[state.activePlayerId].position;
        if (action.command.type === 'playFootwork') {
          text = action.command.movement === 'left' ? 'Left' : action.command.movement === 'right' ? 'Right' : 'Stay';
          destination = currentPosition + (action.command.movement === 'left' ? -1 : action.command.movement === 'right' ? 1 : 0);
        } else if (action.command.type === 'playDrive') {
          const offset = action.command.direction === 'left' ? -1 : 1;
          const proposed = currentPosition + offset;
          intoWall = proposed < ARENA_MIN || proposed > ARENA_MAX;
          destination = intoWall ? currentPosition : proposed;
          text = intoWall ? `Move both ${action.command.direction} into wall` : `Move both ${action.command.direction}`;
        } else if (action.command.type === 'playMoveAction') {
          text = action.command.direction === 'left' ? 'Left' : 'Right';
          destination = currentPosition + (action.command.direction === 'left' ? -1 : 1);
        } else if (action.command.type === 'playTargetedAction') {
          targetCardInstanceIds = [...action.command.targetCardInstanceIds];
        }
        return { ...browserAction(action, text), targetCardInstanceIds, destination, intoWall };
      });
      const definitionId = state.players[state.activePlayerId].deck.hand.find((card) => card.id === availability.cardInstanceId)?.definitionId;
      const canRaiseFollowUp = definitionId ? ['reclaim', 'prism', 'regroup', 'sharpen'].includes(resolveCard(state, definitionId).mechanic) : false;
      return {
        cardInstanceId: availability.cardInstanceId,
        enabled: availability.enabled,
        reason: availability.reason,
        selection,
        eligibleCardInstanceIds: [...availability.eligibleCardInstanceIds],
        minimumTargets: availability.minimumTargets, maximumTargets: availability.maximumTargets,
        actionId: selection === 'none' && legal.length === 1 ? legal[0]!.id
          : selection === 'targets' && availability.minimumTargets === 0 ? legal.find((action) => action.command.type === 'playTargetedAction' && action.command.targetCardInstanceIds.length === 0)?.id ?? null : null,
        batchPlayable: selection === 'none' && !canRaiseFollowUp,
        choices
      };
    });
    const phases: PhaseActionPresentation[] = [];
    for (const action of legalActions) {
      if (action.command.type === 'endActionPhase') phases.push({ id: action.id, kind: 'endAction' });
      if (action.command.type === 'endBuyPhase') phases.push({ id: action.id, kind: 'endBuy' });
    }
    const buys = legalActions.flatMap((action) => action.command.type === 'buyCard'
      ? [{ id: action.id, definitionId: action.command.definitionId }]
      : []);
    const definitionIdFor = (instanceId: string): string => {
      const cards = [
        ...state.players[state.activePlayerId].deck.hand,
        ...state.players[state.activePlayerId].deck.discard,
        ...state.players[state.activePlayerId].deck.play
      ];
      const card = cards.find((candidate) => candidate.id === instanceId);
      if (!card) throw new Error(`Pending choice card ${instanceId} is not visible to its player.`);
      return card.definitionId;
    };
    const selection = state.pendingChoice ? {
      kind: state.pendingChoice.type,
      choices: legalActions.flatMap((action) => {
        if (action.command.type === 'resolveDiscard') {
          return [{ ...browserAction(action), cardInstanceId: action.command.discardInstanceId, definitionId: definitionIdFor(action.command.discardInstanceId) }];
        }
        if (action.command.type === 'resolveRecover') return [{ ...browserAction(action), cardInstanceId: action.command.recoverInstanceId, definitionId: definitionIdFor(action.command.recoverInstanceId) }];
        if (action.command.type === 'resolveOptionalTrash') return [{ ...browserAction(action), cardInstanceId: action.command.trashInstanceId, definitionId: action.command.trashInstanceId ? definitionIdFor(action.command.trashInstanceId) : null }];
        if (action.command.type === 'resolveGain') return [{ ...browserAction(action), cardInstanceId: null, definitionId: action.command.definitionId }];
        return [];
      })
    } : null;
    return { cards, phases, buys, selection };
  }
  private projectPlayers(state: GameState): GameView['players'] {
    return Object.fromEntries((['ochre', 'indigo'] as const).map((playerId) => {
      const player = state.players[playerId];
      const ownedDefinitionIds = state.phase === 'startingBuild'
        ? Array<string>(STARTING_DECK_COPPER_COUNT).fill('copper')
        : [...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play].map((card) => card.definitionId);
      const deckCounts = ownedDefinitionIds.reduce<Record<string, number>>((counts, definitionId) => {
        counts[definitionId] = (counts[definitionId] ?? 0) + 1;
        return counts;
      }, {});
      return [playerId, {
        id: playerId, hand: structuredClone(player.deck.hand), played: structuredClone(player.deck.play),
        discardTop: player.deck.discard.length ? { ...player.deck.discard.at(-1)! } : null,
        zoneCounts: { draw: player.deck.draw.length, hand: player.deck.hand.length, discard: player.deck.discard.length, play: player.deck.play.length },
        deckCounts, money: player.money, mana: player.mana, firstBuyMoney: player.firstBuyMoney, firstBuyPending: player.firstBuyPending,
        purchases: [...player.purchases]
      }];
    })) as GameView['players'];
  }
  private presentationState(state: GameState): PresentationState {
    return {
      activePlayerId: state.activePlayerId, phase: state.phase, turn: state.turn, winner: state.winner,
      fighters: structuredClone(state.fighters), range: rangeBand(state), supply: { ...state.supply },
      players: this.projectPlayers(state), trashCount: state.trash.length
    };
  }
  private gameUpdate(record: GameRecord, frames: PresentationFrame[]): GameUpdateView {
    return { ...this.gameView(record), presentation: { frames } };
  }
  private gameView(record: GameRecord): GameView {
    const state = record.state;
    const players = this.projectPlayers(state);
    const completedBuilds = state.players.ochre.startingBuild && state.players.indigo.startingBuild
      ? { ochre: [...state.players.ochre.startingBuild], indigo: [...state.players.indigo.startingBuild] }
      : null;
    return {
      schemaVersion: 15, id: record.id, revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt,
      elapsedSeconds: Math.max(0, Math.floor((Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / 1000)),
      completedActions: record.completedActions, durationSeconds: record.durationSeconds,
      activePlayerId: state.activePlayerId, selectedFirstPlayerId: state.selectedFirstPlayerId, phase: state.phase,
      turn: state.turn, winner: state.winner, startingDraftEnabled: state.startingDraftEnabled,
      fighters: structuredClone(state.fighters), range: rangeBand(state), supply: { ...state.supply },
      cards: Object.fromEntries(Object.keys(CARDS).map((id) => [id, resolveCard(state, id)])),
      players, trashCount: state.trash.length,
      events: this.publicEvents(record),
      actions: this.projectActions(record),
      canUndo: record.undoHistory.length > 0,
      mode: record.mode, humanPlayerId: record.humanPlayerId, aiDifficulty: record.aiDifficulty,
      aiPlayerId: record.humanPlayerId ? opponent(record.humanPlayerId) : null,
      training: record.training ? { ...record.training } : null,
      fixedCardIds: [...TREASURE_IDS, ...ALWAYS_AVAILABLE_ACTION_IDS],
      variableCardIds: record.kingdom.actionPiles.map((pile) => pile.cardId),
      buildProposal: [...record.buildProposal], completedBuilds
    };
  }
}
