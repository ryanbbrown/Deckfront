import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { nativeRuleFingerprint } from './nativeGoldfishProtocol';
import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { GAMES_PER_SEED } from './pairing';
import { validateTelemetryAggregate } from './lotteryAcquisition';
import {
  DIAGONAL_PURPOSE, INITIAL_MATRIX_MAX_SEEDS, INITIAL_MATRIX_STRATEGIES, OFF_DIAGONAL_PURPOSE
} from './initialMatrixCalibration';
import type { InitialMatrixCellPurpose, InitialMatrixSeedRecord } from './initialMatrixCalibration';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

export const STRATEGY_SEARCH_MATRIX_SCHEMA_VERSION = 3 as const;
export const STRATEGY_SEARCH_MATRIX_VERSION = 'campaign-initial-matrix-v1' as const;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: object, keys: readonly string[]): boolean =>
  exact(Object.keys(value).sort(), [...keys].sort());
const CHUNK_KEYS = ['schemaVersion', 'experiment', 'manifestHash', 'slot', 'purpose', 'rowIndex',
  'columnIndex', 'rowId', 'columnId', 'rowCanonical', 'columnCanonical', 'startSeedIndex', 'records',
  'matches', 'evidenceHash'] as const;
const BATCH_TIMING_KEYS = ['schemaVersion', 'experiment', 'manifestHash', 'batchIndex', 'firstSlot',
  'lastSlot', 'slots', 'workerCount', 'simulationMs', 'evidenceHash'] as const;
function unsigned<T extends { evidenceHash: string }>(value: T): string {
  const copy = structuredClone(value); copy.evidenceHash = ''; return hash(copy);
}
function uint32(text: string): number {
  return Number.parseInt(createHash('sha256').update(text).digest('hex').slice(0, 8), 16) >>> 0;
}

export interface StrategySearchMatrixSource {
  kingdomId: string; orderedProductIdentityHash: string; rankedSha256: string; reservoirSha256: string;
}
export interface StrategySearchMatrixManifest {
  schemaVersion: 3; experiment: 'strategy-search-campaign-matrix'; version: typeof STRATEGY_SEARCH_MATRIX_VERSION;
  stageId: string; source: StrategySearchMatrixSource; strategyCount: 50; maxSeedCount: 125; chunkSize: 25;
  seeds: number[]; rulesFingerprint: string; trainingPrefixes: [75, 100];
  heldOutOrdinals: { start: 101; end: 125 };
  gamesPerSeed: typeof GAMES_PER_SEED; orientationProtocol: 'fixed-seats-alternating-first-player';
  cellCoverage: 'upper-triangle-including-diagonal'; earlyStopping: false; strategies: Strategy[];
  evidenceHash: string;
}
export interface StrategySearchMatrixChunk {
  schemaVersion: 3; experiment: 'strategy-search-campaign-matrix-chunk'; manifestHash: string;
  slot: number; purpose: InitialMatrixCellPurpose; rowIndex: number; columnIndex: number;
  rowId: string; columnId: string; rowCanonical: string; columnCanonical: string;
  startSeedIndex: number; records: InitialMatrixSeedRecord[]; matches: number; evidenceHash: string;
}
export interface StrategySearchMatrixJob {
  slot: number; rowIndex: number; columnIndex: number; startSeedIndex: number; count: number; seeds: number[];
}
export interface StrategySearchMatrixBatchTiming {
  schemaVersion: 3; experiment: 'strategy-search-campaign-matrix-batch-timing'; manifestHash: string;
  batchIndex: number; firstSlot: number; lastSlot: number; slots: number[]; workerCount: number;
  simulationMs: number; evidenceHash: string;
}
export interface StrategySearchMatrixCheckpointEvent {
  type: 'strategy-search-checkpoint'; stage: 'matrix'; manifestHash: string; batchIndex: number;
  chunkHashes: Array<{ slot: number; path: string; sha256: string }>;
  timing: { path: string; sha256: string }; eventHash: string;
}
export interface StrategySearchMatrixCommandTiming {
  schemaVersion: 3; experiment: 'strategy-search-campaign-matrix-command-timing'; manifestHash: string;
  workerCount: number; commandWallMs: number; batchTimingHashes: string[]; evidenceHash: string;
}
export interface StrategySearchMatrixP75Source {
  schemaVersion: 3; experiment: 'strategy-search-campaign-matrix-p75'; manifestHash: string;
  seedOrdinals: { start: 1; end: 75; count: 75 }; centeredPayoffs: number[][];
  equilibrium: EquilibriumResult; cellChunkHashes: string[]; evidenceHash: string;
}

export function strategySearchMatrixSeeds(source: StrategySearchMatrixSource, stageId: string): number[] {
  if (!source.kingdomId || !sha(source.orderedProductIdentityHash) || !sha(source.rankedSha256)
    || !sha(source.reservoirSha256) || !sha(stageId)) throw new Error('Campaign Matrix seed source is invalid.');
  const seeds = Array.from({ length: INITIAL_MATRIX_MAX_SEEDS }, (_unused, index) => uint32(
    `${STRATEGY_SEARCH_MATRIX_VERSION}:${stageId}:${source.kingdomId}:${source.orderedProductIdentityHash}:`
      + `${source.rankedSha256}:${source.reservoirSha256}:${index}`));
  if (new Set(seeds).size !== seeds.length) throw new Error('Campaign Matrix seed namespace collided.');
  return seeds;
}
export function createStrategySearchMatrixManifest(input: { stageId: string; source: StrategySearchMatrixSource;
  strategies: readonly Strategy[] }): StrategySearchMatrixManifest {
  if (!sha(input.stageId) || input.strategies.length !== INITIAL_MATRIX_STRATEGIES
    || new Set(input.strategies.map((strategy) => strategy.id)).size !== INITIAL_MATRIX_STRATEGIES
    || new Set(input.strategies.map(canonicalStrategy)).size !== INITIAL_MATRIX_STRATEGIES
    || nativeRuleFingerprint(input.source.kingdomId, 30, 200).length < 9) {
    throw new Error('Campaign Matrix manifest input is invalid.');
  }
  const base = { schemaVersion: 3 as const, experiment: 'strategy-search-campaign-matrix' as const,
    version: STRATEGY_SEARCH_MATRIX_VERSION, stageId: input.stageId, source: structuredClone(input.source),
    strategyCount: 50 as const, maxSeedCount: 125 as const, chunkSize: 25 as const,
    seeds: strategySearchMatrixSeeds(input.source, input.stageId),
    rulesFingerprint: nativeRuleFingerprint(input.source.kingdomId, 30, 200),
    trainingPrefixes: [75, 100] as [75, 100],
    heldOutOrdinals: { start: 101 as const, end: 125 as const }, gamesPerSeed: GAMES_PER_SEED,
    orientationProtocol: 'fixed-seats-alternating-first-player' as const,
    cellCoverage: 'upper-triangle-including-diagonal' as const, earlyStopping: false as const,
    strategies: input.strategies.map((strategy) => structuredClone(strategy)), evidenceHash: '' };
  return { ...base, evidenceHash: unsigned(base) };
}
export function validateStrategySearchMatrixManifest(value: unknown,
  expected?: StrategySearchMatrixManifest): value is StrategySearchMatrixManifest {
  if (!object(value)) return false;
  try {
    const held = value as unknown as StrategySearchMatrixManifest;
    const rebuilt = createStrategySearchMatrixManifest({ stageId: held.stageId, source: held.source,
      strategies: held.strategies });
    return exact(held, rebuilt) && (!expected || exact(held, expected));
  } catch { return false; }
}

export function strategySearchMatrixJobs(manifest: StrategySearchMatrixManifest): StrategySearchMatrixJob[] {
  if (!validateStrategySearchMatrixManifest(manifest)) throw new Error('Campaign Matrix manifest is invalid.');
  const jobs: StrategySearchMatrixJob[] = []; let slot = 0;
  for (let rowIndex = 0; rowIndex < manifest.strategyCount; rowIndex += 1) {
    for (let columnIndex = rowIndex; columnIndex < manifest.strategyCount; columnIndex += 1) {
      for (let startSeedIndex = 0; startSeedIndex < manifest.maxSeedCount;
        startSeedIndex += manifest.chunkSize) {
        const count = Math.min(manifest.chunkSize, manifest.maxSeedCount - startSeedIndex);
        jobs.push({ slot, rowIndex, columnIndex, startSeedIndex, count,
          seeds: manifest.seeds.slice(startSeedIndex, startSeedIndex + count) });
        slot += 1;
      }
    }
  }
  return jobs;
}
export function strategySearchMatrixChunkPath(job: Pick<StrategySearchMatrixJob,
  'rowIndex' | 'columnIndex' | 'startSeedIndex'>): string {
  return `chunks/cell-${String(job.rowIndex).padStart(2, '0')}-${String(job.columnIndex).padStart(2, '0')}`
    + `/chunk-${String(job.startSeedIndex).padStart(6, '0')}.json`;
}
export function strategySearchMatrixTimingPath(batchIndex: number): string {
  return `timing/batch-${String(batchIndex).padStart(6, '0')}.json`;
}
function recordValid(record: InitialMatrixSeedRecord, expectedSeed: number,
  purpose: InitialMatrixCellPurpose, rowId: string, columnId: string): boolean {
  const expectedIds = [...new Set([rowId, columnId])].sort();
  return record.seed === expectedSeed && record.played === GAMES_PER_SEED && record.matches === GAMES_PER_SEED
    && validateTelemetryAggregate(record.telemetry, GAMES_PER_SEED)
    && record.aborted === 0 && (purpose === DIAGONAL_PURPOSE ? record.payoffScore === null
      : typeof record.payoffScore === 'number' && record.payoffScore >= 0 && record.payoffScore <= 1)
    && exact(Object.keys(record.telemetry.acquisitionsByStrategy).sort(), expectedIds)
    && exact(Object.keys(record.telemetry.planPositionPurchasesByStrategy ?? {}).sort(), expectedIds);
}
export function createStrategySearchMatrixChunk(input: { manifest: StrategySearchMatrixManifest;
  job: StrategySearchMatrixJob; records: readonly InitialMatrixSeedRecord[] }): StrategySearchMatrixChunk {
  const row = input.manifest.strategies[input.job.rowIndex], column = input.manifest.strategies[input.job.columnIndex];
  const expected = strategySearchMatrixJobs(input.manifest)[input.job.slot];
  if (!row || !column || !expected || !exact(input.job, expected) || input.records.length !== input.job.count) {
    throw new Error('Campaign Matrix chunk input is invalid.');
  }
  const purpose = input.job.rowIndex === input.job.columnIndex ? DIAGONAL_PURPOSE : OFF_DIAGONAL_PURPOSE;
  const base = { schemaVersion: 3 as const, experiment: 'strategy-search-campaign-matrix-chunk' as const,
    manifestHash: input.manifest.evidenceHash, slot: input.job.slot, purpose,
    rowIndex: input.job.rowIndex, columnIndex: input.job.columnIndex, rowId: row.id, columnId: column.id,
    rowCanonical: canonicalStrategy(row), columnCanonical: canonicalStrategy(column),
    startSeedIndex: input.job.startSeedIndex, records: input.records.map((record) => structuredClone(record)),
    matches: input.records.length * GAMES_PER_SEED, evidenceHash: '' };
  const artifact = { ...base, evidenceHash: unsigned(base) };
  if (!validateStrategySearchMatrixChunk(artifact, input.manifest, input.job)) {
    throw new Error('Campaign Matrix chunk evidence is invalid.');
  }
  return artifact;
}
export function validateStrategySearchMatrixChunk(value: unknown, manifest: StrategySearchMatrixManifest,
  job: StrategySearchMatrixJob): value is StrategySearchMatrixChunk {
  if (!validateStrategySearchMatrixManifest(manifest) || !object(value) || !exactKeys(value, CHUNK_KEYS)) return false;
  const held = value as unknown as StrategySearchMatrixChunk;
  const row = manifest.strategies[job.rowIndex], column = manifest.strategies[job.columnIndex];
  const purpose = job.rowIndex === job.columnIndex ? DIAGONAL_PURPOSE : OFF_DIAGONAL_PURPOSE;
  return Boolean(row && column && exact(strategySearchMatrixJobs(manifest)[job.slot], job)
    && held.schemaVersion === 3 && held.experiment === 'strategy-search-campaign-matrix-chunk'
    && held.manifestHash === manifest.evidenceHash && held.slot === job.slot && held.purpose === purpose
    && held.rowIndex === job.rowIndex && held.columnIndex === job.columnIndex
    && held.rowId === row.id && held.columnId === column.id && held.rowCanonical === canonicalStrategy(row)
    && held.columnCanonical === canonicalStrategy(column) && held.startSeedIndex === job.startSeedIndex
    && held.records?.length === job.count && held.matches === job.count * GAMES_PER_SEED
    && held.records.every((record, index) => recordValid(record, job.seeds[index]!, purpose, row.id, column.id))
    && held.evidenceHash === unsigned(held));
}
export function createStrategySearchMatrixBatchTiming(input: { manifest: StrategySearchMatrixManifest;
  batchIndex: number; jobs: readonly StrategySearchMatrixJob[]; workerCount: number; simulationMs: number
}): StrategySearchMatrixBatchTiming {
  if (!input.jobs.length || input.jobs.some((job, index) => index && job.slot !== input.jobs[index - 1]!.slot + 1)
    || !Number.isSafeInteger(input.workerCount) || input.workerCount < 1
    || !Number.isFinite(input.simulationMs) || input.simulationMs < 0) {
    throw new Error('Campaign Matrix batch timing input is invalid.');
  }
  const slots = input.jobs.map((job) => job.slot);
  const base = { schemaVersion: 3 as const, experiment: 'strategy-search-campaign-matrix-batch-timing' as const,
    manifestHash: input.manifest.evidenceHash, batchIndex: input.batchIndex, firstSlot: slots[0]!,
    lastSlot: slots.at(-1)!, slots, workerCount: input.workerCount, simulationMs: input.simulationMs,
    evidenceHash: '' };
  return { ...base, evidenceHash: unsigned(base) };
}
export function validateStrategySearchMatrixBatchTiming(value: unknown, manifest: StrategySearchMatrixManifest,
  expectedSlots: readonly number[]): value is StrategySearchMatrixBatchTiming {
  if (!object(value) || !exactKeys(value, BATCH_TIMING_KEYS)) return false;
  const held = value as unknown as StrategySearchMatrixBatchTiming;
  return held.schemaVersion === 3 && held.experiment === 'strategy-search-campaign-matrix-batch-timing'
    && held.manifestHash === manifest.evidenceHash && exact(held.slots, expectedSlots)
    && held.firstSlot === expectedSlots[0] && held.lastSlot === expectedSlots.at(-1)
    && Number.isSafeInteger(held.workerCount) && held.workerCount >= 1
    && Number.isFinite(held.simulationMs) && held.simulationMs >= 0 && held.evidenceHash === unsigned(held);
}

export async function executeStrategySearchMatrixBatches(input: {
  manifest: StrategySearchMatrixManifest; jobs?: readonly StrategySearchMatrixJob[]; jobsPerBatch: number;
  workerCount: number; runBatch: (jobs: readonly StrategySearchMatrixJob[]) => Promise<readonly {
    slot: number; records: readonly InitialMatrixSeedRecord[] }[]>;
  checkpoint: (event: StrategySearchMatrixCheckpointEvent, chunks: readonly StrategySearchMatrixChunk[],
    timing: StrategySearchMatrixBatchTiming) => Promise<void> | void;
}): Promise<{ chunks: StrategySearchMatrixChunk[]; timings: StrategySearchMatrixBatchTiming[];
  commandTiming: StrategySearchMatrixCommandTiming }> {
  const commandStarted = performance.now();
  const jobs = [...(input.jobs ?? strategySearchMatrixJobs(input.manifest))].sort((left, right) => left.slot - right.slot);
  if (!Number.isSafeInteger(input.jobsPerBatch) || input.jobsPerBatch < 1
    || jobs.some((job, index) => index && job.slot !== jobs[index - 1]!.slot + 1)) {
    throw new Error('Campaign Matrix deterministic batch plan is invalid.');
  }
  const chunks: StrategySearchMatrixChunk[] = [], timings: StrategySearchMatrixBatchTiming[] = [];
  for (let start = 0, batchIndex = 0; start < jobs.length; start += input.jobsPerBatch, batchIndex += 1) {
    const batch = jobs.slice(start, start + input.jobsPerBatch); const started = performance.now();
    const results = await input.runBatch(batch); const simulationMs = performance.now() - started;
    const bySlot = new Map(results.map((result) => [result.slot, result]));
    if (bySlot.size !== batch.length) throw new Error('Campaign Matrix batch returned duplicate or missing result slots.');
    const batchChunks = batch.map((job) => {
      const result = bySlot.get(job.slot);
      if (!result) throw new Error(`Campaign Matrix batch is missing result slot ${job.slot}.`);
      return createStrategySearchMatrixChunk({ manifest: input.manifest, job, records: result.records });
    });
    const timing = createStrategySearchMatrixBatchTiming({ manifest: input.manifest, batchIndex,
      jobs: batch, workerCount: input.workerCount, simulationMs });
    const eventBase = { type: 'strategy-search-checkpoint' as const, stage: 'matrix' as const,
      manifestHash: input.manifest.evidenceHash, batchIndex,
      chunkHashes: batch.map((job, index) => ({ slot: job.slot, path: strategySearchMatrixChunkPath(job),
        sha256: batchChunks[index]!.evidenceHash })),
      timing: { path: strategySearchMatrixTimingPath(batchIndex), sha256: timing.evidenceHash } };
    const event = { ...eventBase, eventHash: hash(eventBase) };
    await input.checkpoint(event, batchChunks, timing);
    chunks.push(...batchChunks); timings.push(timing);
  }
  const timingBase = { schemaVersion: 3 as const,
    experiment: 'strategy-search-campaign-matrix-command-timing' as const,
    manifestHash: input.manifest.evidenceHash, workerCount: input.workerCount,
    commandWallMs: performance.now() - commandStarted,
    batchTimingHashes: timings.map((timing) => timing.evidenceHash), evidenceHash: '' };
  return { chunks, timings, commandTiming: { ...timingBase, evidenceHash: unsigned(timingBase) } };
}

export function validateStrategySearchMatrixCommandTiming(value: unknown,
  manifest: StrategySearchMatrixManifest): value is StrategySearchMatrixCommandTiming {
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'experiment', 'manifestHash', 'workerCount',
    'commandWallMs', 'batchTimingHashes', 'evidenceHash'])) return false;
  const held = value as unknown as StrategySearchMatrixCommandTiming;
  return held.schemaVersion === 3 && held.experiment === 'strategy-search-campaign-matrix-command-timing'
    && held.manifestHash === manifest.evidenceHash && Number.isSafeInteger(held.workerCount) && held.workerCount >= 1
    && Number.isFinite(held.commandWallMs) && held.commandWallMs >= 0
    && held.batchTimingHashes.every((digest) => sha(digest)) && held.evidenceHash === unsigned(held);
}

export function createStrategySearchMatrixP75Source(manifest: StrategySearchMatrixManifest,
  chunks: readonly StrategySearchMatrixChunk[]): StrategySearchMatrixP75Source {
  const jobs = strategySearchMatrixJobs(manifest);
  if (chunks.length !== jobs.length) throw new Error('Campaign Matrix P75 source needs every chunk.');
  const bySlot = new Map(chunks.map((chunk) => [chunk.slot, chunk]));
  if (bySlot.size !== jobs.length || jobs.some((job) => !validateStrategySearchMatrixChunk(bySlot.get(job.slot), manifest, job))) {
    throw new Error('Campaign Matrix P75 source has missing, stale, or corrupt chunks.');
  }
  const matrix = manifest.strategies.map(() => manifest.strategies.map(() => 0));
  for (let row = 0; row < manifest.strategyCount; row += 1) for (let column = row + 1;
    column < manifest.strategyCount; column += 1) {
    const records = jobs.filter((job) => job.rowIndex === row && job.columnIndex === column)
      .flatMap((job) => bySlot.get(job.slot)!.records).slice(0, 75);
    const centered = 2 * records.reduce((sum, record) => sum + record.payoffScore!, 0) / records.length - 1;
    matrix[row]![column] = centered; matrix[column]![row] = -centered;
  }
  const equilibrium = solveEquilibrium(manifest.strategies.map((strategy) => strategy.id), matrix);
  const base = { schemaVersion: 3 as const, experiment: 'strategy-search-campaign-matrix-p75' as const,
    manifestHash: manifest.evidenceHash, seedOrdinals: { start: 1 as const, end: 75 as const, count: 75 as const },
    centeredPayoffs: matrix, equilibrium, cellChunkHashes: jobs.map((job) => bySlot.get(job.slot)!.evidenceHash),
    evidenceHash: '' };
  return { ...base, evidenceHash: unsigned(base) };
}
