import type { AiTurnStatus, SafeGameView } from '../shared/api';
import type { AiFinalOutcome, AiRunResult } from './aiRunner';
import { ConflictError, ForbiddenActionError } from './gameService';
import type { GameRecord } from './types';

interface AiTurnService {
  getRecord(id: string): Promise<GameRecord>;
  commitAiAction(
    id: string,
    baseRevision: number,
    actionId: string,
    summary: string,
    durationSeconds: number
  ): Promise<SafeGameView>;
}

interface AiTurnRunner {
  run(record: GameRecord): Promise<AiRunResult>;
  finalize?(result: AiRunResult, outcome: AiFinalOutcome): Promise<void>;
}

interface Job {
  baseRevision: number;
  status: 'running' | 'complete' | 'error';
  game?: SafeGameView | undefined;
  error?: string | undefined;
}

export class AiTurnCoordinator {
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly service: AiTurnService,
    private readonly runner: AiTurnRunner
  ) {}

  async start(id: string): Promise<AiTurnStatus> {
    const record = await this.service.getRecord(id);
    if (record.state.activePlayerId !== record.aiPlayerId || record.state.winner) {
      throw new ForbiddenActionError('There is no AI action to run.');
    }
    if (record.draft.command) {
      throw new ForbiddenActionError('Confirm or undo the human action preview before starting the AI.');
    }
    const existing = this.jobs.get(id);
    if (existing?.status === 'running' && existing.baseRevision === record.revision) return { status: 'running' };
    const job: Job = { baseRevision: record.revision, status: 'running' };
    this.jobs.set(id, job);
    void this.run(id, record.revision, job);
    return { status: 'running' };
  }

  async status(id: string): Promise<AiTurnStatus> {
    const job = this.jobs.get(id);
    if (!job) return { status: 'idle' };
    if (job.status === 'running') return { status: 'running' };
    if (job.status === 'error') return { status: 'error', error: job.error };
    const record = await this.service.getRecord(id);
    if (job.status === 'complete' && job.game?.revision === record.revision) {
      this.jobs.delete(id);
      return { status: 'complete', game: job.game };
    }
    this.jobs.delete(id);
    return { status: 'idle' };
  }

  private async run(id: string, revision: number, job: Job): Promise<void> {
    let result: AiRunResult | undefined;
    try {
      const record = await this.service.getRecord(id);
      if (record.revision !== revision) throw new ConflictError('Game changed before the AI bridge started.');
      result = await this.runner.run(record);
      job.game = await this.service.commitAiAction(
        id,
        result.baseRevision,
        result.actionId,
        result.summary,
        result.durationSeconds
      );
      await this.runner.finalize?.(result, { status: 'complete', committedRevision: job.game.revision });
      job.status = 'complete';
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : 'AI action failed.';
      if (result) {
        try {
          await this.runner.finalize?.(result, { status: 'error', failure: job.error });
        } catch (traceError) {
          const detail = traceError instanceof Error ? traceError.message : 'Unknown trace error.';
          job.error = `${job.error} Trace finalization failed: ${detail}`;
        }
      }
    }
  }
}
