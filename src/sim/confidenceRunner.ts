import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { anytimeConfidenceBounds } from './anytimeMeanEvidence';

export interface ConfidenceJob {
  values: readonly number[];
  alpha: number;
}

export interface ConfidenceBounds { lower: number; upper: number }

export interface ConfidenceRunner {
  run(jobs: readonly ConfidenceJob[]): Promise<ConfidenceBounds[]>;
  close(): Promise<void>;
}

export class InlineConfidenceRunner implements ConfidenceRunner {
  async run(jobs: readonly ConfidenceJob[]): Promise<ConfidenceBounds[]> {
    return jobs.map((job) => anytimeConfidenceBounds(job.values, job.alpha));
  }

  async close(): Promise<void> {}
}

interface WorkerRequest {
  kind: 'confidence-v1';
  jobs: readonly { id: number; values: readonly number[]; alpha: number }[];
}
interface WorkerSuccess {
  kind: 'confidence-results';
  bounds: readonly { id: number; value: ConfidenceBounds }[];
}
interface WorkerFailure { kind: 'confidence-error'; name: string; message: string; stack?: string | undefined }
type WorkerResponse = WorkerSuccess | WorkerFailure;
interface PoolWorker { worker: Worker; busy: boolean }

export class WorkerConfidenceRunner implements ConfidenceRunner {
  private readonly pool: PoolWorker[];
  private closed = false;

  constructor(workerCount: number, workerUrl: URL, workerExecArgv?: string[]) {
    if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 192) {
      throw new Error(`workers must be an integer from 1 to 192, not ${workerCount}.`);
    }
    this.pool = Array.from({ length: workerCount }, () => ({
      worker: new Worker(workerUrl, workerExecArgv ? { execArgv: workerExecArgv } : {}), busy: false
    }));
  }

  async run(jobs: readonly ConfidenceJob[]): Promise<ConfidenceBounds[]> {
    if (this.closed) throw new Error('The confidence runner is closed.');
    if (this.pool.some((entry) => entry.busy)) throw new Error('The confidence runner already has an active batch.');
    if (!jobs.length) return [];
    const chunks: WorkerRequest['jobs'][] = [];
    for (let next = 0; next < jobs.length;) {
      const chunk: Array<{ id: number; values: readonly number[]; alpha: number }> = [];
      let observations = 0;
      while (next < jobs.length && chunk.length < 64 && (chunk.length === 0 || observations < 8192)) {
        const job = jobs[next]!;
        chunk.push({ id: next, values: job.values, alpha: job.alpha });
        observations += job.values.length;
        next += 1;
      }
      chunks.push(chunk);
    }
    const bounds: Array<ConfidenceBounds | undefined> = Array(jobs.length);
    let nextChunk = 0;
    let active = 0;
    let settled = false;
    return new Promise<ConfidenceBounds[]>((resolve, reject) => {
      const cleanups = new Map<PoolWorker, () => void>();
      const cleanup = (): void => {
        for (const remove of cleanups.values()) remove();
        cleanups.clear();
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        void this.close().finally(() => reject(error));
      };
      const finish = (): void => {
        if (settled || active !== 0 || nextChunk < chunks.length) return;
        if (bounds.some((value) => value === undefined)) {
          fail(new Error('A confidence worker returned an incomplete batch.'));
          return;
        }
        settled = true;
        cleanup();
        resolve(bounds as ConfidenceBounds[]);
      };
      const dispatch = (entry: PoolWorker): void => {
        if (settled || nextChunk >= chunks.length) { finish(); return; }
        const chunk = chunks[nextChunk++]!;
        entry.busy = true;
        active += 1;
        entry.worker.postMessage({ kind: 'confidence-v1', jobs: chunk } satisfies WorkerRequest);
      };
      for (const entry of this.pool) {
        const onMessage = (response: WorkerResponse): void => {
          if (!entry.busy || settled) return;
          entry.busy = false;
          active -= 1;
          if (response.kind === 'confidence-error') {
            const error = new Error(response.message);
            error.name = response.name;
            if (response.stack) error.stack = response.stack;
            fail(error);
            return;
          }
          for (const result of response.bounds) bounds[result.id] = result.value;
          dispatch(entry);
          finish();
        };
        const onError = (error: Error): void => fail(error);
        const onExit = (code: number): void => {
          if (!this.closed && code !== 0) fail(new Error(`Confidence worker exited with code ${code}.`));
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

export function runConfidenceWorker(): void {
  if (isMainThread || !parentPort) throw new Error('The confidence worker needs a worker thread.');
  parentPort.on('message', (request: WorkerRequest) => {
    if (request.kind !== 'confidence-v1') return;
    try {
      const bounds = request.jobs.map((job) => ({
        id: job.id, value: anytimeConfidenceBounds(job.values, job.alpha)
      }));
      parentPort!.postMessage({ kind: 'confidence-results', bounds } satisfies WorkerSuccess);
    } catch (error) {
      const value = error instanceof Error ? error : new Error(String(error));
      parentPort!.postMessage({
        kind: 'confidence-error', name: value.name, message: value.message, stack: value.stack
      } satisfies WorkerFailure);
    }
  });
}
