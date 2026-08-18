import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { buildAiBriefing, buildAiStartingBuildBriefing } from '../ai/briefing';
import { listLegalActions } from '../game';
import type { GameRecord } from './types';

const actionOutput = z.object({ schemaVersion: z.literal(2), kind: z.literal('action'), baseRevision: z.number().int().nonnegative(), actionId: z.string(), summary: z.string().min(1).max(500) });
const buildOutput = z.object({ schemaVersion: z.literal(2), kind: z.literal('build'), baseRevision: z.number().int().nonnegative(), definitionIds: z.array(z.string()), summary: z.string().min(1).max(500) });
const outputSchema = z.discriminatedUnion('kind', [actionOutput, buildOutput]);
export interface AiRunnerConfig { projectRoot: string; traceDirectory: string; model: string; effort: string; timeoutMilliseconds: number; fakeModel?: boolean; fakeFailOnce?: boolean; fakeRejectOnce?: boolean }
export type AiRunResult = (z.infer<typeof actionOutput> | z.infer<typeof buildOutput>) & { durationSeconds: number; tracePath?: string };
export type AiFinalOutcome = { status: 'complete'; committedRevision: number } | { status: 'error'; failure: string };
export class ThinHarnessAiRunner {
  private failedOnce = false; private rejectedOnce = false;
  constructor(private readonly config: AiRunnerConfig) {}
  async run(record: GameRecord): Promise<AiRunResult> {
    const traceDirectory = path.join(this.config.traceDirectory, record.id); await mkdir(traceDirectory, { recursive: true });
    const tracePath = path.join(traceDirectory, `${record.revision}.json`);
    if (this.config.fakeFailOnce && !this.failedOnce) { this.failedOnce = true; throw new Error('Synthetic one-time AI process failure.'); }
    if (this.config.fakeRejectOnce && !this.rejectedOnce && record.state.phase !== 'startingBuild') {
      this.rejectedOnce = true; return { schemaVersion: 2, kind: 'action', baseRevision: record.revision, actionId: 'invented-action', summary: 'Invalid fixture action.', durationSeconds: 0, tracePath };
    }
    const isBuild = record.state.phase === 'startingBuild'; const started = performance.now();
    const working = await mkdtemp(path.join(tmpdir(), 'hexdeck-ai-')); const snapshotPath = path.join(working, 'snapshot.json');
    const strategyPath = path.join(working, 'strategy.md'); const outputPath = path.join(working, 'result.json');
    const briefing = isBuild ? buildAiStartingBuildBriefing(record.state.kingdomId) : buildAiBriefing(record.state, record.aiPlayerId);
    const recommended = this.config.fakeModel ? (isBuild ? chooseFakeBuild(record) : chooseFakeAction(record)) : null;
    const recommendedSummary = this.config.fakeModel ? (isBuild ? 'Built the requested strategy package.' : 'Selected the next deterministic strategy action.') : null;
    await writeFile(snapshotPath, JSON.stringify({ schemaVersion: 2, mode: isBuild ? 'build' : 'action', gameId: record.id, baseRevision: record.revision, turn: record.state.turn, phase: record.state.phase, recommended, recommendedSummary, briefing }), { mode: 0o600 });
    await writeFile(strategyPath, record.strategy.markdown, { mode: 0o600 });
    const args = ['run', 'scripts/run_ai_action.py', '--snapshot', snapshotPath, '--strategy', strategyPath, '--output', outputPath, '--trace', tracePath, '--model', this.config.model, '--effort', this.config.effort, '--timeout-seconds', String(Math.ceil(this.config.timeoutMilliseconds / 1000))];
    if (this.config.fakeModel) args.push('--fake-model');
    try {
      const invocation = buildAiBridgeInvocation(args, Boolean(this.config.fakeModel)); await execute(invocation.command, invocation.args, this.config.projectRoot, this.config.timeoutMilliseconds);
      const parsed = outputSchema.parse(JSON.parse(await readFile(outputPath, 'utf8')));
      return { ...parsed, durationSeconds: Math.round((performance.now() - started) / 100) / 10, tracePath };
    } finally { await rm(working, { recursive: true, force: true }); }
  }
  async finalize(result: AiRunResult, outcome: AiFinalOutcome): Promise<void> {
    if (!result.tracePath) return;
    let trace: Record<string, unknown> = {};
    try { trace = JSON.parse(await readFile(result.tracePath, 'utf8')) as Record<string, unknown>; } catch { trace = {}; }
    trace.status = outcome.status; trace.serverOutcome = outcome;
    if (outcome.status === 'error') trace.failure = outcome.failure;
    await writeFile(result.tracePath, `${JSON.stringify(trace, null, 2)}\n`);
  }
}
export function chooseFakeBuild(record: GameRecord): string[] {
  return record.strategy.presetId.includes('ranged') ? ['footwork', 'aim', 'volley'] : ['footwork', 'feint', 'drive'];
}
export function chooseFakeAction(record: GameRecord): string {
  const actions = listLegalActions(record.state);
  if (record.state.phase === 'buy') return actions.find((action) => action.command.type === 'endBuyPhase')?.id ?? actions[0]?.id ?? fail();
  if (record.state.pendingChoice) return actions[0]?.id ?? fail();
  const action = actions.find((candidate) => 'cardInstanceId' in candidate.command) ?? actions.find((candidate) => candidate.command.type === 'endActionPhase');
  return action?.id ?? fail();
}
function fail(): never { throw new Error('AI has no legal action.'); }
export function buildAiBridgeInvocation(args: string[], fakeModel: boolean): { command: string; args: string[] } { return fakeModel ? { command: 'uv', args } : { command: 'cproxy', args: ['run', '--port', '0', '--', 'uv', ...args] }; }
async function execute(command: string, args: string[], cwd: string, timeout: number): Promise<void> {
  await new Promise<void>((resolve, reject) => execFile(command, args, { cwd, timeout, maxBuffer: 2_000_000 }, (error, stdout, stderr) => {
    if (!error) return resolve(); const output = stderr || stdout || error.message;
    const detail = output.match(/cproxy: error: ([^\n]+)/)?.[1] ?? output.match(/provider error \d+: ([^\n]+)/)?.[1] ?? (error.killed ? 'The AI request timed out.' : output.slice(0, 500));
    reject(new Error(`AI action failed. ${detail}`));
  }));
}
