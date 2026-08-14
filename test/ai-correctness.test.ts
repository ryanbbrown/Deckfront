import { describe, expect, it } from 'vitest';
import { applyCommand, cloneGame, createGame, listLegalActions } from '../src/game';
import type { GameCommand } from '../src/game';
import { AiTurnCoordinator } from '../src/server/aiCoordinator';
import { buildAiBridgeInvocation, repairEmptyTurn } from '../src/server/aiRunner';
import { GameService } from '../src/server/gameService';
import type { GameRecord, GameRepository } from '../src/server/types';

class MemoryRepository implements GameRepository {
  record: GameRecord | null = null;
  async create(record: GameRecord): Promise<void> { this.record = structuredClone(record); }
  async load(): Promise<GameRecord> {
    if (!this.record) throw new Error('Missing record.');
    return structuredClone(this.record);
  }
  async save(record: GameRecord): Promise<void> { this.record = structuredClone(record); }
  async withLock<T>(_id: string, work: () => Promise<T>): Promise<T> { return work(); }
}

describe('AI correctness gates', () => {
  it('routes every real ThinHarness turn through an isolated cproxy process', () => {
    expect(buildAiBridgeInvocation(['run', 'scripts/run_ai_turn.py'], false)).toEqual({
      command: 'cproxy',
      args: ['run', '--port', '0', '--', 'uv', 'run', 'scripts/run_ai_turn.py']
    });
    expect(buildAiBridgeInvocation(['run', 'scripts/run_ai_turn.py', '--fake-model'], true)).toEqual({
      command: 'uv',
      args: ['run', 'scripts/run_ai_turn.py', '--fake-model']
    });
  });

  it('repairs an empty non-scoring opening turn with one legal board action', async () => {
    const { record } = await aiGame();
    const repaired = repairEmptyTurn(record, {
      commands: [{ type: 'enterBuyPhase' }, { type: 'endTurn' }],
      summary: 'AI bought nothing.'
    });
    expect(repaired.commands[0]?.type).toBe('baselineMove');
    expect(repaired.summary).toMatch(/^AI made 1 baseline move with piece [AB]\. AI bought nothing\.$/);
  });

  it('does not replace an empty opening line when a point is available', async () => {
    const { record } = await aiGame();
    record.state.pieces['indigo-a'].position = { q: 2, r: 0 };
    record.state.pieces['ochre-a'].position = { q: 3, r: 0 };
    const shoveIndex = record.state.players.indigo.deck.discard.findIndex((card) => card.definitionId === 'shove');
    record.state.players.indigo.deck.hand.push(...record.state.players.indigo.deck.discard.splice(shoveIndex, 1));
    const result = {
      commands: [{ type: 'enterBuyPhase' }, { type: 'endTurn' }] as GameCommand[],
      summary: 'AI bought nothing.'
    };
    expect(repairEmptyTurn(record, result)).toBe(result);
  });

  it('rejects an empty opening board turn when a legal board action exists', async () => {
    const { service, record } = await aiGame();
    await expect(service.commitAiTurn(
      record.id,
      record.revision,
      [{ type: 'enterBuyPhase' }, { type: 'endTurn' }],
      'AI bought nothing.',
      0.1
    )).rejects.toThrow('AI must take a legal board action before entering the buy phase');
  });

  it('rejects and repairs an empty board turn after the opening turn', async () => {
    const { service, record } = await aiGame();
    record.state.players.indigo.turnsTaken = 2;
    record.initialState = cloneGame(record.state);
    record.committedState = cloneGame(record.state);

    const result = {
      commands: [{ type: 'enterBuyPhase' }, { type: 'endTurn' }] as GameCommand[],
      summary: 'AI bought nothing.'
    };
    const repaired = repairEmptyTurn(record, result);

    expect(repaired.commands.some((command) => command.type === 'baselineMove')).toBe(true);
    await expect(service.commitAiTurn(
      record.id,
      record.revision,
      result.commands,
      result.summary,
      0.1
    )).rejects.toThrow('AI must take a legal board action before entering the buy phase');
  });

  it('can retry after one rejected plan and commits the replacement atomically', async () => {
    const { service, record } = await aiGame();
    let attempts = 0;
    const coordinator = new AiTurnCoordinator(service, {
      run: async () => {
        attempts += 1;
        return {
          baseRevision: record.revision,
          commands: attempts === 1
            ? [{ type: 'enterBuyPhase' }, { type: 'endTurn' }]
            : validOpeningTurn(record),
          summary: attempts === 1 ? 'Invalid plan.' : 'AI made 1 baseline move. AI bought nothing.',
          durationSeconds: 0.1
        };
      }
    });
    await coordinator.start(record.id);
    await waitForStatus(coordinator, record.id, 'error');
    await coordinator.start(record.id);
    const status = await waitForStatus(coordinator, record.id, 'complete');
    expect(status.game?.activePlayerId).toBe('ochre');
    expect(status.game?.lastAiSummary).toContain('baseline move');
    expect(attempts).toBe(2);
  });

  it('can retry after one runner process error', async () => {
    const { service, record } = await aiGame();
    let attempts = 0;
    const coordinator = new AiTurnCoordinator(service, {
      run: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Synthetic process failure.');
        return {
          baseRevision: record.revision,
          commands: validOpeningTurn(record),
          summary: 'AI made 1 baseline move. AI bought nothing.',
          durationSeconds: 0.1
        };
      }
    });
    await coordinator.start(record.id);
    const failed = await waitForStatus(coordinator, record.id, 'error');
    expect(failed.error).toContain('Synthetic process failure');
    await coordinator.start(record.id);
    expect((await waitForStatus(coordinator, record.id, 'complete')).game?.activePlayerId).toBe('ochre');
  });
});

async function aiGame(): Promise<{ service: GameService; record: GameRecord }> {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  let seed = 0;
  while (createGame(seed).activePlayerId !== 'indigo') seed += 1;
  const view = await service.create({
    seed,
    strategyPresetId: 'direct-force',
    strategyMarkdown: '# Direct force'
  });
  const record = await service.getRecord(view.id);
  const aiDeck = record.state.players.indigo.deck;
  aiDeck.discard.push(...aiDeck.hand);
  aiDeck.hand = [];
  record.initialState = cloneGame(record.state);
  record.committedState = cloneGame(record.state);
  record.draft = { baseVersion: record.state.version, baseState: cloneGame(record.state), commands: [] };
  repository.record = structuredClone(record);
  return { service, record };
}

function validOpeningTurn(record: GameRecord): GameCommand[] {
  let state = cloneGame(record.state);
  const move = listLegalActions(state).find((action) => action.command.type === 'baselineMove');
  if (!move) throw new Error('Expected an opening baseline move.');
  const commands: GameCommand[] = [move.command, { type: 'enterBuyPhase' }];
  state = applyCommand(state, move.command);
  state = applyCommand(state, { type: 'enterBuyPhase' });
  const purchase = listLegalActions(state).find((action) => action.command.type === 'buyCard');
  if (purchase?.command.type === 'buyCard') commands.push(purchase.command);
  commands.push({ type: 'endTurn' });
  return commands;
}

async function waitForStatus(
  coordinator: AiTurnCoordinator,
  id: string,
  expected: 'complete' | 'error'
): Promise<Awaited<ReturnType<AiTurnCoordinator['status']>>> {
  for (let count = 0; count < 50; count += 1) {
    const status = await coordinator.status(id);
    if (status.status === expected) return status;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`AI did not reach ${expected}.`);
}
