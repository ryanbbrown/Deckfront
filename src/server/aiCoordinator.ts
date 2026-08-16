import { listLegalActions } from '../game';
import type { AiTurnStatus, SafeGameView } from '../shared/api';
import type { AiFinalOutcome, AiRunResult } from './aiRunner';
import { ConflictError, ForbiddenActionError } from './gameService';
import type { GameRecord } from './types';

interface AiTurnService {
  get(id: string): Promise<SafeGameView>;
  getRecord(id: string): Promise<GameRecord>;
  commitAiBuild(id: string, baseRevision: number, definitionIds: string[], summary: string, durationSeconds: number): Promise<SafeGameView>;
  commitAiAction(id: string, baseRevision: number, actionId: string, summary: string, durationSeconds: number, decisionIndex: number, fallback?: boolean): Promise<SafeGameView>;
}
interface AiTurnRunner { run(record: GameRecord): Promise<AiRunResult>; finalize?(result: AiRunResult, outcome: AiFinalOutcome): Promise<void> }
interface Job { status: 'running' | 'complete' | 'error'; game?: SafeGameView; error?: string }
export class AiTurnCoordinator {
  private readonly jobs = new Map<string, Job>();
  constructor(private readonly service: AiTurnService, private readonly runner: AiTurnRunner) {}
  async start(id: string): Promise<AiTurnStatus> {
    const record = await this.service.getRecord(id);
    if (record.state.activePlayerId !== record.aiPlayerId || record.state.winner) throw new ForbiddenActionError('There is no AI decision to run.');
    if (record.draft.command) throw new ForbiddenActionError('Confirm or undo the human preview before starting the AI.');
    const existing = this.jobs.get(id); if (existing?.status === 'running') return { status: 'running' };
    const job: Job = { status: 'running' }; this.jobs.set(id, job); void this.run(id, job); return { status: 'running' };
  }
  async status(id: string): Promise<AiTurnStatus> {
    const job = this.jobs.get(id); if (!job) return { status: 'idle' }; if (job.status === 'running') return { status: 'running' };
    if (job.status === 'error') return { status: 'error', error: job.error ?? 'AI decision failed.' };
    const current = await this.service.get(id);
    if (job.game?.revision === current.revision) { this.jobs.delete(id); return { status: 'complete', game: job.game }; }
    this.jobs.delete(id); return { status: 'idle' };
  }
  private async run(id: string, job: Job): Promise<void> {
    try {
      const startingRecord = await this.service.getRecord(id);
      let decisions = startingRecord.aiActions.filter((entry) => entry.turn === startingRecord.state.turn && entry.phase !== 'startingBuild').length;
      while (true) {
        const record = await this.service.getRecord(id);
        if (record.state.activePlayerId !== record.aiPlayerId || record.state.winner) {
          job.game = job.game ?? await this.service.get(id);
          job.status = 'complete';
          return;
        }
        if (record.state.phase === 'startingBuild') {
          const result = await this.runner.run(record);
          if (result.kind !== 'build') throw new ConflictError('AI bridge returned an action during starting build.');
          try {
            job.game = await this.service.commitAiBuild(id, result.baseRevision, result.definitionIds, result.summary, result.durationSeconds);
            await this.runner.finalize?.(result, { status: 'complete', committedRevision: job.game.revision });
          } catch (error) { await this.finishError(result, error); throw error; }
          continue;
        }
        if (decisions >= 30) {
          const phaseEnd = listLegalActions(record.state).find((action) => action.command.type === (record.state.phase === 'action' ? 'endActionPhase' : 'endBuyPhase'));
          if (!phaseEnd) throw new Error('AI fallback has no phase-ending action.');
          job.game = await this.service.commitAiAction(id, record.revision, phaseEnd.id, 'Decision limit reached; ended phase.', 0, decisions, true);
          decisions += 1;
          continue;
        }
        const result = await this.runner.run(record);
        if (result.kind !== 'action') throw new ConflictError('AI bridge returned a build during a normal turn.');
        try {
          job.game = await this.service.commitAiAction(id, result.baseRevision, result.actionId, result.summary, result.durationSeconds, decisions);
          await this.runner.finalize?.(result, { status: 'complete', committedRevision: job.game.revision });
        } catch (error) { await this.finishError(result, error); throw error; }
        decisions += 1;
      }
    } catch (error) {
      job.status = 'error'; job.error = error instanceof Error ? error.message : 'AI decision failed.';
    }
  }
  private async finishError(result: AiRunResult, error: unknown): Promise<void> {
    try { await this.runner.finalize?.(result, { status: 'error', failure: error instanceof Error ? error.message : 'Unknown failure.' }); } catch { /* original error is authoritative */ }
  }
}
