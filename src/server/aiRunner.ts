import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { buildAiBriefing } from '../ai/briefing';
import { applyAction, listLegalActions } from '../game';
import type { GameRecord } from './types';

const bridgeOutputSchema = z.object({
  schemaVersion: z.literal(2),
  baseRevision: z.number().int().nonnegative(),
  actionId: z.string().min(1),
  summary: z.string()
});

export interface AiRunnerConfig {
  projectRoot: string;
  traceDirectory: string;
  model: string;
  effort: string;
  timeoutMilliseconds: number;
  fakeModel?: boolean | undefined;
  fakeFailOnce?: boolean | undefined;
  fakeRejectOnce?: boolean | undefined;
}

export interface AiRunResult {
  baseRevision: number;
  actionId: string;
  summary: string;
  durationSeconds: number;
  tracePath?: string | undefined;
}

export type AiFinalOutcome =
  | { status: 'complete'; committedRevision: number }
  | { status: 'error'; failure: string };

export class ThinHarnessAiRunner {
  private failedOnce = false;
  private rejectedOnce = false;

  constructor(private readonly config: AiRunnerConfig) {}

  async run(record: GameRecord): Promise<AiRunResult> {
    const traceDirectory = path.join(this.config.traceDirectory, record.id);
    const tracePath = path.join(traceDirectory, `${record.revision}.json`);
    await mkdir(traceDirectory, { recursive: true });
    if (this.config.fakeFailOnce && !this.failedOnce) {
      this.failedOnce = true;
      await writeFile(tracePath, `${JSON.stringify({
        schemaVersion: 2,
        round: record.state.round.number,
        actionStep: record.state.round.actionStep,
        revision: record.revision,
        model: 'fake',
        effort: this.config.effort,
        prompt: { strategy: record.strategy.markdown, briefing: buildAiBriefing(record.state, record.aiPlayerId) },
        tools: ['choose_action'],
        status: 'error',
        durationSeconds: 0,
        failure: 'Synthetic one-time AI process failure.'
      }, null, 2)}\n`, 'utf8');
      throw new Error('Synthetic one-time AI process failure.');
    }
    if (this.config.fakeRejectOnce && !this.rejectedOnce) {
      this.rejectedOnce = true;
      await writeFile(tracePath, `${JSON.stringify({
        schemaVersion: 2,
        round: record.state.round.number,
        actionStep: record.state.round.actionStep,
        revision: record.revision,
        model: 'fake',
        effort: this.config.effort,
        prompt: { strategy: record.strategy.markdown, briefing: buildAiBriefing(record.state, record.aiPlayerId) },
        tools: ['choose_action'],
        status: 'awaiting-server-validation',
        durationSeconds: 0,
        result: { actionId: 'invented-action' }
      }, null, 2)}\n`, 'utf8');
      return { baseRevision: record.revision, actionId: 'invented-action', summary: 'Invalid fixture action.', durationSeconds: 0, tracePath };
    }
    const started = performance.now();
    const workingDirectory = await mkdtemp(path.join(tmpdir(), 'hexdeck-ai-'));
    const snapshotPath = path.join(workingDirectory, 'private-snapshot.json');
    const strategyPath = path.join(workingDirectory, 'strategy.md');
    const outputPath = path.join(workingDirectory, 'result.json');
    await writeFile(snapshotPath, JSON.stringify({
      schemaVersion: 2,
      gameId: record.id,
      baseRevision: record.revision,
      round: record.state.round.number,
      actionStep: record.state.round.actionStep,
      recommendedActionId: chooseFakeAction(record),
      briefing: buildAiBriefing(record.state, record.aiPlayerId)
    }), { encoding: 'utf8', mode: 0o600 });
    await writeFile(strategyPath, record.strategy.markdown, { encoding: 'utf8', mode: 0o600 });
    const args = [
      'run', 'scripts/run_ai_action.py', '--snapshot', snapshotPath, '--strategy', strategyPath,
      '--output', outputPath, '--trace', tracePath, '--model', this.config.model,
      '--effort', this.config.effort, '--timeout-seconds', String(Math.ceil(this.config.timeoutMilliseconds / 1000))
    ];
    if (this.config.fakeModel) args.push('--fake-model');
    try {
      const invocation = buildAiBridgeInvocation(args, Boolean(this.config.fakeModel));
      await execute(invocation.command, invocation.args, this.config.projectRoot, this.config.timeoutMilliseconds);
      const parsed = bridgeOutputSchema.parse(JSON.parse(await readFile(outputPath, 'utf8')));
      return {
        baseRevision: parsed.baseRevision,
        actionId: parsed.actionId,
        summary: parsed.summary,
        durationSeconds: Math.round((performance.now() - started) / 100) / 10,
        tracePath
      };
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  async finalize(result: AiRunResult, outcome: AiFinalOutcome): Promise<void> {
    if (!result.tracePath) return;
    const trace = JSON.parse(await readFile(result.tracePath, 'utf8')) as Record<string, unknown>;
    trace.status = outcome.status;
    trace.serverOutcome = outcome;
    if (outcome.status === 'error') trace.failure = outcome.failure;
    await writeFile(result.tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  }
}

export function chooseFakeAction(record: GameRecord): string {
  const actions = listLegalActions(record.state);
  const playerId = record.aiPlayerId;
  const ranked = actions.map((action) => {
    const next = applyAction(record.state, action.id);
    return {
      action,
      win: next.winner === playerId ? 1 : 0,
      points: next.scores[playerId] - record.state.scores[playerId],
      pass: action.command.type === 'pass' || action.command.type === 'skipPurchase' ? 1 : 0
    };
  }).sort((left, right) => right.win - left.win || right.points - left.points || left.pass - right.pass || left.action.id.localeCompare(right.action.id));
  const selected = ranked[0]?.action.id;
  if (!selected) throw new Error('AI has no legal action.');
  return selected;
}

export function buildAiBridgeInvocation(args: string[], fakeModel: boolean): { command: string; args: string[] } {
  return fakeModel ? { command: 'uv', args } : { command: 'cproxy', args: ['run', '--port', '0', '--', 'uv', ...args] };
}

async function execute(command: string, args: string[], cwd: string, timeout: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { cwd, timeout, maxBuffer: 2_000_000 }, (error, stdout, stderr) => {
      if (!error) { resolve(); return; }
      const output = stderr || stdout || error.message;
      const detail = output.match(/cproxy: error: ([^\n]+)/)?.[1]
        ?? output.match(/provider error \d+: ([^\n]+)/)?.[1]
        ?? (error.killed ? 'The AI request timed out.' : 'Review the saved AI trace.');
      reject(new Error(`AI action failed. ${detail}`));
    });
  });
}
