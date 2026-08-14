import { describe, expect, it } from 'vitest';
import { createGame, findMaximumPoints, replayCommands } from '../src/game';
import { startTurn } from '../src/game/state';
import type { CardInstance, GameCommand, GameState } from '../src/game';
import { ConflictError, GameService } from '../src/server/gameService';
import type { GameRecord, GameRepository } from '../src/server/types';

class MemoryRepository implements GameRepository {
  record: GameRecord | null = null;

  async create(record: GameRecord): Promise<void> {
    this.record = structuredClone(record);
  }

  async load(): Promise<GameRecord> {
    if (!this.record) throw new Error('Game record is not initialized.');
    return structuredClone(this.record);
  }

  async save(record: GameRecord): Promise<void> {
    this.record = structuredClone(record);
  }

  async withLock<T>(_id: string, work: () => Promise<T>): Promise<T> {
    return work();
  }
}

describe('saved match transactions', () => {
  it('preserves a complete five-point match with terminal AI behavior and telemetry', async () => {
    const repository = new MemoryRepository();
    const service = new GameService(repository);
    const created = await service.create({
      seed: indigoFirstSeed(),
      strategyPresetId: 'direct-force',
      strategyMarkdown: '# Direct Force'
    });
    const record = await service.getRecord(created.id);
    const initialState = completeMatchFixture(record.state);
    record.initialState = structuredClone(initialState);
    record.committedState = structuredClone(initialState);
    record.state = structuredClone(initialState);
    record.committedCommands = [];
    record.draft = { baseVersion: initialState.version, baseState: structuredClone(initialState), commands: [] };
    await repository.save(record);

    for (let point = 1; point <= 5; point += 1) {
      const beforeAi = await service.getRecord(created.id);
      expect(beforeAi.state.activePlayerId).toBe('indigo');
      expect(findMaximumPoints(beforeAi.state).points).toBe(1);
      const commands = point === 1
        ? firstScoringTurn(beforeAi.state, point < 5)
        : laterScoringTurn(beforeAi.state, point < 5);
      const afterAi = await service.commitAiTurn(
        created.id,
        beforeAi.revision,
        commands,
        `AI scored point ${point}.`,
        point + 0.25
      );
      expect(afterAi.scores.indigo).toBe(point);
      if (point === 5) {
        expect(afterAi.winner).toBe('indigo');
        expect(afterAi.phase).toBe('ended');
        break;
      }
      await playHumanRespawnTurn(service, afterAi.id);
    }

    const saved = await service.getRecord(created.id);
    expect(saved.state.scores).toEqual({ ochre: 0, indigo: 5 });
    expect(saved.state.winner).toBe('indigo');
    expect(saved.finishedAt).not.toBeNull();
    expect(saved.completedTurns).toBe(9);
    expect(saved.durationSeconds).not.toBeNull();
    expect(Date.parse(saved.finishedAt!)).toBeGreaterThanOrEqual(Date.parse(saved.createdAt));
    expect(saved.state.players.indigo.turnsTaken).toBe(4);
    expect(saved.state.players.ochre.turnsTaken).toBe(4);
    expect(saved.committedCommands.filter((command) => command.type === 'endTurn')).toHaveLength(8);
    expect(saved.state.events.filter((event) => event.type === 'purchase')).toHaveLength(8);
    expect(saved.aiTurns.map((turn) => turn.durationSeconds)).toEqual([1.25, 2.25, 3.25, 4.25, 5.25]);
    expect(saved.aiTurns.at(-1)?.committedRevision).toBe(saved.revision);
    expect(saved.committedCommands.at(-1)?.type).toBe('playShove');
    expect(saved.state.events.at(-1)?.type).toBe('ringOut');
    expect(saved.state.players.indigo.deck.play.at(-1)?.definitionId).toBe('shove');
    expect(saved.state.activePlayerId).toBe('indigo');
    expect(saved.committedState).toEqual(replayCommands(saved.initialState, saved.committedCommands));
    expect(saved.state).toEqual(saved.committedState);
  });

  it('rejects an obsolete AI base revision without changing the saved game', async () => {
    const repository = new MemoryRepository();
    const service = new GameService(repository);
    const created = await service.create({
      seed: indigoFirstSeed(),
      strategyPresetId: 'direct-force',
      strategyMarkdown: '# Direct Force'
    });
    const before = await service.getRecord(created.id);
    await expect(service.commitAiTurn(
      created.id,
      before.revision + 1,
      [{ type: 'enterBuyPhase' }, { type: 'endTurn' }],
      'Stale result.',
      1
    )).rejects.toBeInstanceOf(ConflictError);
    expect(await service.getRecord(created.id)).toEqual(before);
  });
});

function completeMatchFixture(state: GameState): GameState {
  const fixture = structuredClone(state);
  fixture.activePlayerId = 'indigo';
  fixture.phase = 'action';
  fixture.scores = { ochre: 0, indigo: 0 };
  fixture.winner = null;
  fixture.events = [];
  fixture.version = 0;
  fixture.pieces['ochre-a'].position = { q: -1, r: 0 };
  fixture.pieces['ochre-a'].needsRespawn = false;
  fixture.pieces['ochre-b'].position = { q: -1, r: 1 };
  fixture.pieces['indigo-a'].position = { q: 0, r: 0 };
  fixture.pieces['indigo-b'].position = { q: 2, r: -2 };
  fixture.players.ochre.turnsTaken = 0;
  fixture.players.indigo.turnsTaken = 0;
  fixture.players.indigo.deck = {
    hand: cards(['drive', 'shove', 'copper', 'copper', 'copper'], 100),
    draw: Array.from({ length: 4 }, (_, batch) =>
      cards(['shove', 'copper', 'copper', 'copper', 'copper'], 200 + batch * 10)
    ).flat(),
    discard: [],
    play: []
  };
  fixture.nextCardSerial = 36;
  startTurn(fixture);
  return fixture;
}

function cards(definitionIds: string[], firstSerial: number): CardInstance[] {
  return definitionIds.map((definitionId, index) => ({ id: `fixture-${firstSerial + index}`, definitionId }));
}

function firstScoringTurn(state: GameState, continueMatch: boolean): GameCommand[] {
  const drive = state.players.indigo.deck.hand.find((card) => card.definitionId === 'drive');
  const shove = state.players.indigo.deck.hand.find((card) => card.definitionId === 'shove');
  if (!drive || !shove) throw new Error('First scoring hand is incomplete.');
  return [
    { type: 'playDrive', cardInstanceId: drive.id, actorId: 'indigo-a', targetId: 'ochre-a', follow: true },
    { type: 'playShove', cardInstanceId: shove.id, actorId: 'indigo-a', targetId: 'ochre-a' },
    ...(continueMatch ? buyCopperAndEnd() : [])
  ];
}

function laterScoringTurn(state: GameState, continueMatch: boolean): GameCommand[] {
  const shove = state.players.indigo.deck.hand.find((card) => card.definitionId === 'shove');
  if (!shove) throw new Error('Later scoring hand is incomplete.');
  return [
    { type: 'playShove', cardInstanceId: shove.id, actorId: 'indigo-a', targetId: 'ochre-a' },
    ...(continueMatch ? buyCopperAndEnd() : [])
  ];
}

function buyCopperAndEnd(): GameCommand[] {
  return [{ type: 'enterBuyPhase' }, { type: 'buyCard', definitionId: 'copper' }, { type: 'endTurn' }];
}

async function playHumanRespawnTurn(service: GameService, id: string): Promise<void> {
  let view = await service.get(id);
  const respawn = view.legalActions.find((action) =>
    action.command.type === 'respawn'
    && action.command.pieceId === 'ochre-a'
    && action.command.destination.q === -2
    && action.command.destination.r === 0
  );
  if (!respawn) throw new Error('Expected the nearest open respawn at -2,0.');
  view = await service.applyHumanAction(id, view.revision, respawn.id);
  for (const type of ['enterBuyPhase', 'buyCard', 'endTurn'] as const) {
    const action = view.legalActions.find((candidate) => candidate.command.type === type
      && (type !== 'buyCard' || (candidate.command.type === 'buyCard' && candidate.command.definitionId === 'copper')));
    if (!action) throw new Error(`Expected human ${type}.`);
    view = await service.applyHumanAction(id, view.revision, action.id);
  }
}

function indigoFirstSeed(): number {
  for (let seed = 0; seed < 10_000; seed += 1) {
    if (createGame(seed).activePlayerId === 'indigo') return seed;
  }
  throw new Error('Could not find an Indigo-first seed.');
}
