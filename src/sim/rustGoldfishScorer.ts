import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Kingdom } from '../game';
import type { GoldfishConfig, MovementAwareGoldfishScore, CompactMovementAwareGoldfishScore } from './goldfish';
import { nativeCompetitiveFixtureRequest, nativeCompetitiveLoadRequest,
  nativeCompetitiveScoreRequest, nativeSeatBiasScoreRequest } from './nativeCompetitiveProtocol';
import type { CompetitiveBlock, CompetitiveKernelConfig } from './nativeCompetitiveProtocol';
import { nativeScoreBatchRequest } from './nativeGoldfishProtocol';
import type { Strategy } from './strategy';

interface NativeResponse {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

export interface NativeCompetitiveScore {
  scoreBytes: Uint8Array;
  played: Uint8Array;
  aborts: Array<{ blockIndex: number; orientationIndex: number; reason: string }>;
}

export interface NativeCompetitiveFixture {
  outcome: 'ochre' | 'indigo' | 'draw' | 'aborted';
  reason: 'victory' | 'turnLimit' | 'actionCap' | 'actionSearchOverflow';
  turns: number;
}

export interface NativeSeatBiasPenaltyScore {
  penalty: number;
  outcomes: Uint8Array;
  aborts: Array<{ blockIndex: number; orientationIndex: number; reason: string }>;
}

export interface NativeSeatBiasScore {
  penalties: NativeSeatBiasPenaltyScore[];
}

export class RustGoldfishScorer {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly lines: string[] = [];
  private readonly waiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  private stderr = '';
  private spawnError: Error | null = null;
  private exitState: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

  constructor(threads: number, cpuRequest = threads, executable = process.env.HEXDECK_GOLDFISH_BIN
    ?? path.resolve('rust/target/release/hexdeck-goldfish')) {
    if (threads > cpuRequest) throw new Error('Native scorer threads cannot exceed the CPU request.');
    this.process = spawn(executable, ['--threads', String(threads), '--cpu-request', String(cpuRequest)],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise((resolve) => {
      this.process.once('exit', (code, signal) => {
        this.exitState = { code, signal };
        const error = this.exitError('before returning a response');
        for (const waiter of this.waiters.splice(0)) waiter.reject(error);
        resolve(this.exitState);
      });
    });
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

  private exitError(context: string): Error {
    if (this.spawnError) return this.spawnError;
    const state = this.exitState ?? { code: this.process.exitCode, signal: this.process.signalCode };
    const status = state.signal ? `by signal ${state.signal}` : `with code ${state.code ?? 'unknown'}`;
    return new Error(`Native scorer exited ${status} ${context}: ${this.stderr}`);
  }

  private nextLine(): Promise<string> {
    const held = this.lines.shift();
    if (held !== undefined) return Promise.resolve(held);
    if (this.spawnError) return Promise.reject(this.spawnError);
    if (this.exitState || this.process.exitCode !== null || this.process.signalCode !== null) {
      return Promise.reject(this.exitError('before returning a response'));
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private async request(value: unknown): Promise<Record<string, unknown>> {
    if (this.spawnError) throw this.spawnError;
    if (this.exitState || this.process.exitCode !== null || this.process.signalCode !== null) {
      throw this.exitError('before accepting a request');
    }
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

  async loadCompetitive(
    kingdom: Kingdom, strategies: readonly Strategy[], config: CompetitiveKernelConfig,
    threads: number, cpuRequest = threads
  ): Promise<string> {
    const request = nativeCompetitiveLoadRequest(kingdom, strategies, config, threads, cpuRequest);
    const result = await this.request(request);
    if (result.loadId !== request.payload.loadId || result.strategyCount !== strategies.length) {
      throw new Error('Native competitive scorer loaded the wrong strategy table.');
    }
    return request.payload.loadId;
  }

  async scoreCompetitive(
    loadId: string, blocks: readonly CompetitiveBlock[]
  ): Promise<NativeCompetitiveScore> {
    const result = await this.request(nativeCompetitiveScoreRequest(loadId, blocks));
    const scoreBytes = Uint8Array.from(result.scoreBytes as number[] ?? []);
    const played = Uint8Array.from(result.played as number[] ?? []);
    const aborts = result.aborts as NativeCompetitiveScore['aborts'] | undefined;
    if (scoreBytes.length !== blocks.length || played.length !== blocks.length || !Array.isArray(aborts)
      || scoreBytes.some((value) => value > 4) || played.some((value) => value > 2)) {
      throw new Error('Native competitive scorer returned an invalid compact result.');
    }
    return { scoreBytes, played, aborts };
  }

  async scoreSeatBias(
    loadId: string, blocks: readonly CompetitiveBlock[], penalties: readonly number[]
  ): Promise<NativeSeatBiasScore> {
    const result = await this.request(nativeSeatBiasScoreRequest(loadId, blocks, penalties));
    const raw = result.penalties as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(raw) || raw.length !== penalties.length) {
      throw new Error('Native seat-bias scorer returned the wrong penalty count.');
    }
    const scored = raw.map((entry, index): NativeSeatBiasPenaltyScore => {
      const outcomes = Uint8Array.from(entry.outcomes as number[] ?? []);
      const aborts = entry.aborts as NativeSeatBiasPenaltyScore['aborts'] | undefined;
      if (entry.penalty !== penalties[index] || outcomes.length !== blocks.length * 2
        || outcomes.some((value) => value > 3) || !Array.isArray(aborts)
        || outcomes.filter((value) => value === 3).length !== aborts.length) {
        throw new Error('Native seat-bias scorer returned an invalid result.');
      }
      return { penalty: entry.penalty as number, outcomes, aborts };
    });
    return { penalties: scored };
  }

  async fixtureCompetitive(
    loadId: string, block: CompetitiveBlock, firstPlayer: 'ochre' | 'indigo'
  ): Promise<NativeCompetitiveFixture> {
    const result = await this.request(nativeCompetitiveFixtureRequest(loadId, block, firstPlayer));
    if (!['ochre', 'indigo', 'draw', 'aborted'].includes(String(result.outcome))
      || !['victory', 'turnLimit', 'actionCap', 'actionSearchOverflow'].includes(String(result.reason))
      || !Number.isSafeInteger(result.turns)) {
      throw new Error('Native competitive scorer returned an invalid fixture result.');
    }
    return result as unknown as NativeCompetitiveFixture;
  }

  async close(): Promise<void> {
    if (this.spawnError) return;
    if (!this.exitState && this.process.exitCode === null && this.process.signalCode === null
      && !this.process.stdin.destroyed) this.process.stdin.end();
    const state = this.exitState ?? (this.process.exitCode !== null || this.process.signalCode !== null
      ? { code: this.process.exitCode, signal: this.process.signalCode }
      : await this.exited);
    if (state.signal !== null || (state.code !== null && state.code !== 0)) {
      throw this.exitError('during cleanup');
    }
  }
}
