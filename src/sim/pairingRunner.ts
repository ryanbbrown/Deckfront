import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { playPairing, playPairingScoreOnly } from './pairing';
import type { PairingOptions, PairingOutcome } from './pairing';
import type { Strategy } from './strategy';

export interface PairingJob {
  candidate: Strategy;
  opponent: Strategy;
  options: PairingOptions;
  scoreOnly?: boolean;
}

export interface PairingBatchResult {
  /** Submission-order slots. Null means the deadline prevented submission. */
  outcomes: readonly (PairingOutcome | null)[];
  submitted: number;
}

export interface PairingRunOptions {
  deadline?: number | undefined;
  now?: (() => number) | undefined;
}

export interface PairingRunner {
  run(jobs: readonly PairingJob[], options?: PairingRunOptions): Promise<PairingBatchResult>;
  close(): Promise<void>;
}

export class InlinePairingRunner implements PairingRunner {
  async run(jobs: readonly PairingJob[], options: PairingRunOptions = {}): Promise<PairingBatchResult> {
    const outcomes: (PairingOutcome | null)[] = Array(jobs.length).fill(null);
    const now = options.now ?? Date.now;
    let submitted = 0;
    for (let index = 0; index < jobs.length; index += 1) {
      if (options.deadline !== undefined && now() >= options.deadline) break;
      const job = jobs[index]!;
      outcomes[index] = job.scoreOnly
        ? playPairingScoreOnly(job.candidate, job.opponent, job.options)
        : playPairing(job.candidate, job.opponent, job.options);
      submitted += 1;
    }
    return { outcomes, submitted };
  }

  async close(): Promise<void> {}
}

interface CompactWorkerItem {
  id: number;
  candidate: number;
  opponent: number;
  options: number;
  scoreOnly: boolean;
}
interface WorkerRequest {
  kind: 'pairing-batch-v2';
  candidates: readonly Strategy[];
  opponents: readonly Strategy[];
  options: readonly PairingOptions[];
  items: readonly CompactWorkerItem[];
}
interface WorkerSuccess { kind: 'pairing-results'; outcomes: readonly { id: number; outcome: PairingOutcome }[] }
interface WorkerFailure { kind: 'pairing-error'; name: string; message: string; stack?: string | undefined }
type WorkerResponse = WorkerSuccess | WorkerFailure;

interface PoolWorker { worker: Worker; busy: boolean }

/** A persistent bounded worker pool. One batch runs at a time and folds results in submission order. */
export class WorkerPairingRunner implements PairingRunner {
  private readonly pool: PoolWorker[];
  private closed = false;

  constructor(
    workerCount: number, workerUrl: URL, extraWorkerData: Record<string, unknown> = {},
    workerExecArgv?: string[]
  ) {
    if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 192) {
      throw new Error(`workers must be an integer from 1 to 192, not ${workerCount}.`);
    }
    this.pool = Array.from({ length: workerCount }, () => ({
      worker: new Worker(workerUrl, {
        workerData: { ...extraWorkerData, kind: 'pairing-worker' },
        ...(workerExecArgv ? { execArgv: workerExecArgv } : {})
      }),
      busy: false
    }));
  }

  async run(jobs: readonly PairingJob[], options: PairingRunOptions = {}): Promise<PairingBatchResult> {
    if (this.closed) throw new Error('The pairing runner is closed.');
    if (this.pool.some((entry) => entry.busy)) throw new Error('The pairing runner already has an active batch.');
    if (!jobs.length) return { outcomes: [], submitted: 0 };

    const outcomes: (PairingOutcome | null)[] = Array(jobs.length).fill(null);
    const now = options.now ?? Date.now;
    let next = 0;
    let active = 0;
    let submitted = 0;
    let settled = false;

    return new Promise<PairingBatchResult>((resolve, reject) => {
      const cleanups = new Map<PoolWorker, () => void>();
      const cleanup = (): void => {
        for (const remove of cleanups.values()) remove();
        cleanups.clear();
      };
      const finish = (): void => {
        if (settled || active !== 0) return;
        settled = true;
        cleanup();
        resolve({ outcomes, submitted });
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        void this.close().finally(() => reject(error));
      };
      const dispatch = (entry: PoolWorker): void => {
        if (settled) return;
        if (next >= jobs.length || (options.deadline !== undefined && now() >= options.deadline)) {
          finish();
          return;
        }
        const jobsInBatch: Array<{ id: number; job: PairingJob }> = [];
        let estimatedGames = 0;
        const targetGames = options.now ? 1 : 32;
        while (next < jobs.length && jobsInBatch.length < 8 && estimatedGames < targetGames) {
          const id = next;
          const job = jobs[id]!;
          jobsInBatch.push({ id, job });
          estimatedGames += job.options.seeds.length * 4;
          next += 1;
        }
        submitted += jobsInBatch.length;
        active += 1;
        entry.busy = true;
        const candidates: Strategy[] = [];
        const opponents: Strategy[] = [];
        const compactOptions: PairingOptions[] = [];
        const candidateIndex = new Map<string, number>();
        const opponentIndex = new Map<string, number>();
        const optionsIndex = new Map<string, number>();
        const internStrategy = (strategy: Strategy, values: Strategy[], held: Map<string, number>): number => {
          const key = JSON.stringify(strategy);
          const existing = held.get(key);
          if (existing !== undefined) return existing;
          const index = values.length; values.push(strategy); held.set(key, index); return index;
        };
        const items = jobsInBatch.map(({ id, job }): CompactWorkerItem => {
          const optionsKey = JSON.stringify(job.options);
          let heldOptions = optionsIndex.get(optionsKey);
          if (heldOptions === undefined) {
            heldOptions = compactOptions.length; compactOptions.push(job.options); optionsIndex.set(optionsKey, heldOptions);
          }
          return { id, candidate: internStrategy(job.candidate, candidates, candidateIndex),
            opponent: internStrategy(job.opponent, opponents, opponentIndex), options: heldOptions,
            scoreOnly: job.scoreOnly ?? false };
        });
        entry.worker.postMessage({ kind: 'pairing-batch-v2', candidates, opponents,
          options: compactOptions, items } satisfies WorkerRequest);
      };

      for (const entry of this.pool) {
        const onMessage = (response: WorkerResponse): void => {
          if (!entry.busy || settled) return;
          entry.busy = false;
          active -= 1;
          if (response.kind === 'pairing-error') {
            const error = new Error(response.message);
            error.name = response.name;
            if (response.stack) error.stack = response.stack;
            fail(error);
            return;
          }
          for (const result of response.outcomes) outcomes[result.id] = result.outcome;
          dispatch(entry);
          finish();
        };
        const onError = (error: Error): void => fail(error);
        const onExit = (code: number): void => {
          if (!this.closed && code !== 0) fail(new Error(`Pairing worker exited with code ${code}.`));
        };
        entry.worker.on('message', onMessage);
        entry.worker.on('error', onError);
        entry.worker.on('exit', onExit);
        cleanups.set(entry, () => {
          entry.worker.off('message', onMessage);
          entry.worker.off('error', onError);
          entry.worker.off('exit', onExit);
        });
      }
      for (const entry of this.pool) dispatch(entry);
      finish();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(this.pool.map(async (entry) => {
      entry.busy = false;
      await entry.worker.terminate();
    }));
  }
}

/** Runs inside the compiled CLI bundle when workerData.kind is `pairing-worker`. */
export function runPairingWorker(): void {
  if (isMainThread || !parentPort) throw new Error('The pairing worker handler needs a worker thread.');
  parentPort.on('message', (request: WorkerRequest) => {
    if (request.kind !== 'pairing-batch-v2') return;
    try {
      const outcomes = request.items.map((item) => {
        const candidate = request.candidates[item.candidate]!;
        const opponent = request.opponents[item.opponent]!;
        const options = request.options[item.options]!;
        const outcome = item.scoreOnly ? playPairingScoreOnly(candidate, opponent, options)
          : playPairing(candidate, opponent, options);
        return { id: item.id, outcome };
      });
      parentPort!.postMessage({ kind: 'pairing-results', outcomes } satisfies WorkerSuccess);
    } catch (error) {
      const value = error instanceof Error ? error : new Error(String(error));
      parentPort!.postMessage({
        kind: 'pairing-error', name: value.name, message: value.message, stack: value.stack
      } satisfies WorkerFailure);
    }
  });
}
