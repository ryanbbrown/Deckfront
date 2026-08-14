import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { findMaximumPoints, listLegalActions } from '../game';
import type { GameCommand } from '../game';
import { gameCommandSchema } from './schemas';
import type { GameRecord } from './types';

const bridgeOutputSchema = z.object({
  schemaVersion: z.literal(1),
  baseRevision: z.number().int().nonnegative(),
  commands: z.array(gameCommandSchema),
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
  commands: GameCommand[];
  summary: string;
  durationSeconds: number;
}

export class ThinHarnessAiRunner {
  private failedOnce = false;
  private rejectedOnce = false;

  constructor(private readonly config: AiRunnerConfig) {}

  async run(record: GameRecord): Promise<AiRunResult> {
    if (this.config.fakeFailOnce && !this.failedOnce) {
      this.failedOnce = true;
      throw new Error('Synthetic one-time AI process failure.');
    }
    if (this.config.fakeRejectOnce && !this.rejectedOnce) {
      this.rejectedOnce = true;
      return {
        baseRevision: record.revision,
        commands: [{ type: 'enterBuyPhase' }, { type: 'endTurn' }],
        summary: 'AI bought nothing.',
        durationSeconds: 0
      };
    }
    const started = performance.now();
    const workingDirectory = await mkdtemp(path.join(tmpdir(), 'hexdeck-ai-'));
    const snapshotPath = path.join(workingDirectory, 'private-snapshot.json');
    const sessionPath = path.join(workingDirectory, 'preview-session.json');
    const strategyPath = path.join(workingDirectory, 'strategy.md');
    const outputPath = path.join(workingDirectory, 'result.json');
    const traceDirectory = path.join(this.config.traceDirectory, record.id);
    const tracePath = path.join(traceDirectory, `${record.revision}.json`);
    await mkdir(traceDirectory, { recursive: true });
    await writeFile(snapshotPath, JSON.stringify({
      schemaVersion: 1,
      gameId: record.id,
      baseRevision: record.revision,
      aiPlayerId: record.aiPlayerId,
      state: record.state
    }), { encoding: 'utf8', mode: 0o600 });
    await writeFile(strategyPath, record.strategy.markdown, { encoding: 'utf8', mode: 0o600 });
    const args = [
      'run', 'scripts/run_ai_turn.py',
      '--snapshot', snapshotPath,
      '--session', sessionPath,
      '--strategy', strategyPath,
      '--output', outputPath,
      '--trace', tracePath,
      '--model', this.config.model,
      '--effort', this.config.effort,
      '--timeout-seconds', String(Math.ceil(this.config.timeoutMilliseconds / 1000))
    ];
    if (this.config.fakeModel) args.push('--fake-model');
    try {
      const invocation = buildAiBridgeInvocation(args, Boolean(this.config.fakeModel));
      await execute(invocation.command, invocation.args, this.config.projectRoot, this.config.timeoutMilliseconds);
      const parsed = bridgeOutputSchema.parse(JSON.parse(await readFile(outputPath, 'utf8')));
      const repaired = repairEmptyTurn(record, {
        commands: parsed.commands as GameCommand[],
        summary: parsed.summary
      });
      return {
        baseRevision: parsed.baseRevision,
        commands: repaired.commands,
        summary: repaired.summary,
        durationSeconds: Math.round((performance.now() - started) / 100) / 10
      };
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }
}

export function buildAiBridgeInvocation(args: string[], fakeModel: boolean): { command: string; args: string[] } {
  return fakeModel
    ? { command: 'uv', args }
    : { command: 'cproxy', args: ['run', '--port', '0', '--', 'uv', ...args] };
}

export function repairEmptyTurn(
  record: GameRecord,
  result: { commands: GameCommand[]; summary: string }
): { commands: GameCommand[]; summary: string } {
  const hasBoardAction = result.commands.some(isBoardCommand);
  if (hasBoardAction || findMaximumPoints(record.state).points > 0) return result;
  const boardAction = listLegalActions(record.state)
    .filter((action) => isBoardCommand(action.command))
    .sort((left, right) => boardActionPriority(left.command) - boardActionPriority(right.command))[0];
  if (!boardAction) return result;
  return {
    commands: [boardAction.command, ...result.commands],
    summary: `${describeRepair(boardAction.command)} ${result.summary}`.trim()
  };
}

function boardActionPriority(command: GameCommand): number {
  if (command.type === 'respawn') return 0;
  if (['playShove', 'playDrive', 'playBreaker', 'playPress', 'playPull', 'playSweep', 'playCorner']
    .includes(command.type)) return 1;
  if (command.type === 'playPin') return 2;
  if (command.type === 'baselineMove') return 3;
  return 4;
}

function isBoardCommand(command: GameCommand): boolean {
  return command.type === 'respawn'
    || command.type === 'baselineMove'
    || command.type.startsWith('play');
}

function describeRepair(command: GameCommand): string {
  if (command.type === 'baselineMove') {
    return `AI made 1 baseline move with piece ${command.pieceId.endsWith('-a') ? 'A' : 'B'}.`;
  }
  if (command.type === 'respawn') {
    return `AI respawned piece ${command.pieceId.endsWith('-a') ? 'A' : 'B'}.`;
  }
  return 'AI played 1 action card.';
}

async function execute(command: string, args: string[], cwd: string, timeout: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { cwd, timeout, maxBuffer: 2_000_000 }, (error, stdout, stderr) => {
      if (error) {
        const output = stderr || stdout || error.message;
        const detail = output.match(/cproxy: error: ([^\n]+)/)?.[1]
          ?? output.match(/provider error \d+: ([^\n]+)/)?.[1]
          ?? (error.killed ? 'The AI request timed out.' : 'Review the saved AI trace.');
        reject(new Error(`AI turn failed. ${detail}`));
        return;
      }
      resolve();
    });
  });
}
