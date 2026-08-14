import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
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
}

export interface AiRunResult {
  baseRevision: number;
  commands: GameCommand[];
  summary: string;
  durationSeconds: number;
}

export class ThinHarnessAiRunner {
  constructor(private readonly config: AiRunnerConfig) {}

  async run(record: GameRecord): Promise<AiRunResult> {
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
      await execute('uv', args, this.config.projectRoot, this.config.timeoutMilliseconds);
      const parsed = bridgeOutputSchema.parse(JSON.parse(await readFile(outputPath, 'utf8')));
      return {
        baseRevision: parsed.baseRevision,
        commands: parsed.commands as GameCommand[],
        summary: parsed.summary,
        durationSeconds: Math.round((performance.now() - started) / 100) / 10
      };
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }
}

async function execute(command: string, args: string[], cwd: string, timeout: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { cwd, timeout, maxBuffer: 2_000_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`AI bridge failed: ${(stderr || stdout || error.message).slice(-4000)}`));
        return;
      }
      resolve();
    });
  });
}
