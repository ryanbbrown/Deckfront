import { afterEach, describe, expect, it } from 'vitest';
import { applyCommand, createGame, findMaximumPoints, listLegalActions } from '../src/game';
import type { GameCommand, PlayerId } from '../src/game';
import { AiTurnCoordinator } from '../src/server/aiCoordinator';
import { GameService } from '../src/server/gameService';
import type { GameRecord, GameRepository } from '../src/server/types';

class GatedRepository implements GameRepository {
  private record: GameRecord | null = null;
  private blockSave = false;
  private savePublished: (() => void) | null = null;
  private releaseBlockedSave: (() => void) | null = null;
  private publishedPromise = Promise.resolve();

  async create(record: GameRecord): Promise<void> {
    this.record = structuredClone(record);
  }

  async load(): Promise<GameRecord> {
    if (!this.record) throw new Error('Game record is not initialized.');
    return structuredClone(this.record);
  }

  async save(record: GameRecord): Promise<void> {
    this.record = structuredClone(record);
    if (!this.blockSave) return;
    this.savePublished?.();
    await new Promise<void>((resolve) => { this.releaseBlockedSave = resolve; });
    this.blockSave = false;
  }

  async withLock<T>(_id: string, work: () => Promise<T>): Promise<T> {
    return work();
  }

  gateNextSave(): void {
    this.blockSave = true;
    this.publishedPromise = new Promise<void>((resolve) => { this.savePublished = resolve; });
  }

  waitForPublishedSave(): Promise<void> {
    return this.publishedPromise;
  }

  releaseSave(): void {
    this.releaseBlockedSave?.();
  }
}

describe('AI turn coordinator', () => {
  const repositories: GatedRepository[] = [];

  afterEach(() => {
    for (const repository of repositories) repository.releaseSave();
    repositories.length = 0;
  });

  it('keeps a job running while its committed revision is visible but its save has not returned', async () => {
    const repository = new GatedRepository();
    repositories.push(repository);
    const service = new GameService(repository);
    const created = await service.create({
      seed: seedFor('indigo'),
      strategyPresetId: 'direct-force',
      strategyMarkdown: '# Direct Force'
    });
    const record = await service.getRecord(created.id);
    expect(findMaximumPoints(record.state).points).toBe(0);
    const commands = quietTurn(record);
    const runner = {
      run: async () => ({
        baseRevision: record.revision,
        commands,
        summary: 'AI bought nothing.',
        durationSeconds: 0.1
      })
    };
    const coordinator = new AiTurnCoordinator(service, runner);
    repository.gateNextSave();

    expect(await coordinator.start(created.id)).toEqual({ status: 'running' });
    await repository.waitForPublishedSave();
    expect((await service.getRecord(created.id)).revision).toBe(1);
    expect(await coordinator.status(created.id)).toEqual({ status: 'running' });

    repository.releaseSave();
    await new Promise((resolve) => setImmediate(resolve));
    const status = await coordinator.status(created.id);
    expect(status.status).toBe('complete');
    expect(status.game?.revision).toBe(1);
  });
});

function quietTurn(record: GameRecord): GameCommand[] {
  const enterBuy: GameCommand = { type: 'enterBuyPhase' };
  const commands: GameCommand[] = [enterBuy];
  let state = applyCommand(record.state, enterBuy);
  const purchase = listLegalActions(state).find((action) => action.command.type === 'buyCard');
  if (purchase?.command.type === 'buyCard') {
    commands.push(purchase.command);
    state = applyCommand(state, purchase.command);
  }
  commands.push({ type: 'endTurn' });
  return commands;
}

function seedFor(playerId: PlayerId): number {
  for (let seed = 0; seed < 10_000; seed += 1) {
    if (createGame(seed).activePlayerId === playerId) return seed;
  }
  throw new Error(`Could not find a ${playerId}-first seed.`);
}
