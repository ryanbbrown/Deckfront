import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Kingdom } from '../game';
import type { GoldfishConfig, MovementAwareGoldfishScore, CompactMovementAwareGoldfishScore } from './goldfish';
import { nativeScoreBatchRequest } from './nativeGoldfishProtocol';
import type { Strategy } from './strategy';

interface NativeResponse {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

export class RustGoldfishScorer {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly lines: string[] = [];
  private readonly waiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  private stderr = '';
  private spawnError: Error | null = null;

  constructor(threads: number, cpuRequest = threads, executable = process.env.HEXDECK_GOLDFISH_BIN
    ?? path.resolve('rust/target/release/hexdeck-goldfish')) {
    if (threads > cpuRequest) throw new Error('Native scorer threads cannot exceed the CPU request.');
    this.process = spawn(executable, ['--threads', String(threads), '--cpu-request', String(cpuRequest)],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    readline.createInterface({ input: this.process.stdout }).on('line', (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(line); else this.lines.push(line);
    });
    this.process.stderr.on('data', (value: Buffer) => { this.stderr += value.toString(); });
    this.process.on('error', (error) => {
      this.spawnError = new Error(`Cannot start native scorer ${executable}: ${error.message}`);
      for (const waiter of this.waiters.splice(0)) waiter.reject(this.spawnError);
    });
  }

  private nextLine(): Promise<string> {
    const held = this.lines.shift();
    if (held !== undefined) return Promise.resolve(held);
    if (this.spawnError) return Promise.reject(this.spawnError);
    return new Promise((resolve, reject) => {
      const onExit = (code: number | null): void => reject(new Error(
        `Native scorer exited ${code ?? 'by signal'}: ${this.stderr}`));
      this.process.once('exit', onExit);
      this.waiters.push({ resolve: (line) => { this.process.off('exit', onExit); resolve(line); }, reject });
    });
  }

  private async request(value: unknown): Promise<Record<string, unknown>> {
    if (this.spawnError) throw this.spawnError;
    this.process.stdin.write(`${JSON.stringify(value)}\n`);
    const response = JSON.parse(await this.nextLine()) as NativeResponse;
    if (!response.ok || !response.result) {
      throw new Error(`${response.error?.code ?? 'native_error'}: ${response.error?.message ?? 'missing result'}`);
    }
    return response.result;
  }

  async shuffle(seed: number, deck: readonly number[]): Promise<number[]> {
    return (await this.request({ type: 'shuffle', seed, deck })).deck as number[];
  }

  async stableHash(text: string): Promise<string> {
    return (await this.request({ type: 'stable_hash', text })).hash as string;
  }

  async compareUtf16(left: string, right: string): Promise<number> {
    return (await this.request({ type: 'compare_utf16', left, right })).sign as number;
  }

  async score(
    kingdom: Kingdom, strategies: readonly Strategy[], config: GoldfishConfig,
    threads: number, mode: 'full'
  ): Promise<MovementAwareGoldfishScore[]>;
  async score(
    kingdom: Kingdom, strategies: readonly Strategy[], config: GoldfishConfig,
    threads: number, mode: 'compact'
  ): Promise<CompactMovementAwareGoldfishScore[]>;
  async score(
    kingdom: Kingdom, strategies: readonly Strategy[], config: GoldfishConfig,
    threads: number, mode: 'full' | 'compact'
  ): Promise<Array<MovementAwareGoldfishScore | CompactMovementAwareGoldfishScore>> {
    const request = nativeScoreBatchRequest(kingdom, strategies, config, threads, mode);
    const result = await this.request(request);
    const scores = result.scores as Array<Record<string, unknown>> | undefined;
    if (!scores) throw new Error('Native scorer returned no scores.');
    if (scores.length !== strategies.length) throw new Error('Native scorer returned the wrong count.');
    return scores.map((raw, index) => {
      if (mode === 'compact') delete raw.profiles;
      else { delete raw.strategyId; delete raw.collisionTieKey; }
      return { ...raw, strategy: strategies[index]! } as unknown as
        MovementAwareGoldfishScore | CompactMovementAwareGoldfishScore;
    });
  }

  async close(): Promise<void> {
    if (this.spawnError) return;
    if (!this.process.stdin.destroyed) this.process.stdin.end();
    if (this.process.exitCode !== null) return;
    await new Promise<void>((resolve) => this.process.once('exit', () => resolve()));
  }
}
