import { createHash } from 'node:crypto';
import { nativeRuleFingerprint } from './nativeGoldfishProtocol';
import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { GAMES_PER_SEED } from './pairing';
import { validateTelemetryAggregate } from './lotteryAcquisition';
import type { InitialMatrixSeedRecord } from './initialMatrixCalibration';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export const STRATEGY_SEARCH_MATRIX_SCHEMA_VERSION = 4 as const;
export const STRATEGY_SEARCH_MATRIX_VERSION = 'strategy-search-matrix-v2' as const;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
function uint32(text: string): number {
  return Number.parseInt(createHash('sha256').update(text).digest('hex').slice(0, 8), 16) >>> 0;
}
function sealField<T extends object>(value: T, field: keyof T): string {
  const copy = structuredClone(value); copy[field] = '' as T[keyof T]; return hash(copy);
}

export interface StrategySearchMatrixSource {
  kingdomId: string; evidenceId: string; reservoirIdentityHash: string; reservoirContentHash: string;
  matrixSeedNamespace: string;
}
export interface StrategySearchMatrixManifest {
  schemaVersion: 4; experiment: 'strategy-search-matrix'; version: typeof STRATEGY_SEARCH_MATRIX_VERSION;
  source: StrategySearchMatrixSource; strategyCount: 50; seedCount: 125; seeds: number[];
  rulesFingerprint: string; trainingPrefixes: [75, 100]; heldOutOrdinals: { start: 101; end: 125 };
  gamesPerSeed: typeof GAMES_PER_SEED; orientationProtocol: 'fixed-seats-alternating-first-player';
  strategies: Strategy[]; evidenceHash: string;
}
export interface StrategySearchMatrixJob {
  slot: number; rowIndex: number; columnIndex: number; startSeedOrdinal: number; endSeedOrdinal: number;
  startSeedIndex: number; count: number; seeds: number[];
}
export interface StrategySearchMatrixChunk {
  schemaVersion: 1; experiment: 'strategy-search-matrix-runtime-chunk'; manifestHash: string;
  rowIndex: number; columnIndex: number; startSeedOrdinal: number; endSeedOrdinal: number;
  records: InitialMatrixSeedRecord[]; contentHash: string;
}
export interface StrategySearchMatrixCell {
  rowIndex: number; columnIndex: number; rowId: string; columnId: string;
  seedRecords: InitialMatrixSeedRecord[];
}
export interface StrategySearchMatrixArtifact {
  schemaVersion: 4; experiment: 'strategy-search-matrix-evidence'; manifestHash: string;
  manifest: StrategySearchMatrixManifest; source: StrategySearchMatrixSource; seedOrdinals: number[]; cells: StrategySearchMatrixCell[];
  centeredPayoffs: number[][]; equilibrium: EquilibriumResult; evidenceHash: string;
}

export function strategySearchMatrixSeeds(source: StrategySearchMatrixSource): number[] {
  if (!source.kingdomId || !source.matrixSeedNamespace || !sha(source.evidenceId)
    || !sha(source.reservoirIdentityHash) || !sha(source.reservoirContentHash)) {
    throw new Error('Matrix semantic seed source is invalid.');
  }
  const seeds = Array.from({ length: 125 }, (_unused, index) => uint32(
    `${source.matrixSeedNamespace}:${source.reservoirIdentityHash}:${source.reservoirContentHash}:${index + 1}`));
  if (new Set(seeds).size !== seeds.length) throw new Error('Matrix seed namespace collided.');
  return seeds;
}
export function createStrategySearchMatrixManifest(input: { source: StrategySearchMatrixSource;
  strategies: readonly Strategy[] }): StrategySearchMatrixManifest {
  if (input.strategies.length !== 50 || new Set(input.strategies.map((entry) => entry.id)).size !== 50
    || new Set(input.strategies.map(canonicalStrategy)).size !== 50) throw new Error('Matrix needs 50 unique strategies.');
  const base = { schemaVersion: 4 as const, experiment: 'strategy-search-matrix' as const,
    version: STRATEGY_SEARCH_MATRIX_VERSION, source: structuredClone(input.source), strategyCount: 50 as const,
    seedCount: 125 as const, seeds: strategySearchMatrixSeeds(input.source),
    rulesFingerprint: nativeRuleFingerprint(input.source.kingdomId, 30, 200),
    trainingPrefixes: [75, 100] as [75, 100], heldOutOrdinals: { start: 101 as const, end: 125 as const },
    gamesPerSeed: GAMES_PER_SEED, orientationProtocol: 'fixed-seats-alternating-first-player' as const,
    strategies: input.strategies.map((entry) => structuredClone(entry)), evidenceHash: '' };
  return { ...base, evidenceHash: sealField(base, 'evidenceHash') };
}
export function validateStrategySearchMatrixManifest(value: unknown,
  expected?: StrategySearchMatrixManifest): value is StrategySearchMatrixManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const held = value as StrategySearchMatrixManifest;
    const rebuilt = createStrategySearchMatrixManifest({ source: held.source, strategies: held.strategies });
    return exact(held, rebuilt) && (!expected || exact(held, expected));
  } catch { return false; }
}
export function strategySearchMatrixJobs(manifest: StrategySearchMatrixManifest,
  runtimeChunkSize = 25): readonly StrategySearchMatrixJob[] {
  if (!validateStrategySearchMatrixManifest(manifest) || !Number.isSafeInteger(runtimeChunkSize)
    || runtimeChunkSize < 1) throw new Error('Matrix runtime topology is invalid.');
  const jobs: StrategySearchMatrixJob[] = []; let slot = 0;
  for (let rowIndex = 0; rowIndex < 50; rowIndex += 1) {
    for (let columnIndex = rowIndex; columnIndex < 50; columnIndex += 1) {
      for (let start = 1; start <= 125; start += runtimeChunkSize) {
        const end = Math.min(start + runtimeChunkSize, 126);
        jobs.push({ slot, rowIndex, columnIndex, startSeedOrdinal: start, endSeedOrdinal: end,
          startSeedIndex: start - 1, count: end - start, seeds: manifest.seeds.slice(start - 1, end - 1) });
        slot += 1;
      }
    }
  }
  return jobs;
}
export function strategySearchMatrixChunkPath(job: Pick<StrategySearchMatrixJob, 'rowIndex' | 'columnIndex'
  | 'startSeedOrdinal' | 'endSeedOrdinal'>): string {
  return `runtime/cell-${String(job.rowIndex).padStart(2, '0')}-${String(job.columnIndex).padStart(2, '0')}`
    + `/seeds-${String(job.startSeedOrdinal).padStart(3, '0')}-${String(job.endSeedOrdinal - 1).padStart(3, '0')}.json`;
}
function recordValid(record: InitialMatrixSeedRecord, seed: number, diagonal: boolean,
  rowId: string, columnId: string): boolean {
  const expectedIds = [...new Set([rowId, columnId])].sort();
  return record.seed === seed && record.played === GAMES_PER_SEED && record.matches === GAMES_PER_SEED
    && record.aborted === 0 && validateTelemetryAggregate(record.telemetry, GAMES_PER_SEED)
    && (diagonal ? record.payoffScore === null
      : typeof record.payoffScore === 'number' && record.payoffScore >= 0 && record.payoffScore <= 1)
    && exact(Object.keys(record.telemetry.acquisitionsByStrategy).sort(), expectedIds)
    && exact(Object.keys(record.telemetry.planPositionPurchasesByStrategy ?? {}).sort(), expectedIds);
}
export function createStrategySearchMatrixChunk(input: { manifest: StrategySearchMatrixManifest;
  job: StrategySearchMatrixJob; records: readonly InitialMatrixSeedRecord[] }): StrategySearchMatrixChunk {
  const { job, manifest } = input, row = manifest.strategies[job.rowIndex], column = manifest.strategies[job.columnIndex];
  const count = job.endSeedOrdinal - job.startSeedOrdinal;
  if (!row || !column || job.columnIndex < job.rowIndex || job.startSeedOrdinal < 1 || job.endSeedOrdinal > 126
    || count < 1 || input.records.length !== count || input.records.some((record, index) => !recordValid(record,
      manifest.seeds[job.startSeedOrdinal + index - 1]!, job.rowIndex === job.columnIndex, row.id, column.id))) {
    throw new Error('Matrix runtime chunk input is invalid.');
  }
  const base = { schemaVersion: 1 as const, experiment: 'strategy-search-matrix-runtime-chunk' as const,
    manifestHash: manifest.evidenceHash, rowIndex: job.rowIndex, columnIndex: job.columnIndex,
    startSeedOrdinal: job.startSeedOrdinal, endSeedOrdinal: job.endSeedOrdinal,
    records: input.records.map((record) => structuredClone(record)), contentHash: '' };
  return { ...base, contentHash: sealField(base, 'contentHash') };
}
export function validateStrategySearchMatrixChunk(value: unknown, manifest: StrategySearchMatrixManifest,
  job?: StrategySearchMatrixJob): value is StrategySearchMatrixChunk {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const held = value as StrategySearchMatrixChunk;
    const expectedJob = job ?? { slot: 0, rowIndex: held.rowIndex, columnIndex: held.columnIndex,
      startSeedOrdinal: held.startSeedOrdinal, endSeedOrdinal: held.endSeedOrdinal,
      startSeedIndex: held.startSeedOrdinal - 1, count: held.endSeedOrdinal - held.startSeedOrdinal,
      seeds: manifest.seeds.slice(held.startSeedOrdinal - 1, held.endSeedOrdinal - 1) };
    return exact(held, createStrategySearchMatrixChunk({ manifest, job: expectedJob, records: held.records }));
  } catch { return false; }
}
export function reduceStrategySearchMatrix(input: { manifest: StrategySearchMatrixManifest;
  chunks: readonly StrategySearchMatrixChunk[] }): StrategySearchMatrixArtifact {
  if (!validateStrategySearchMatrixManifest(input.manifest)) throw new Error('Matrix manifest is invalid.');
  const recordsByCell = new Map<string, Map<number, InitialMatrixSeedRecord>>();
  for (const chunk of input.chunks) {
    if (!validateStrategySearchMatrixChunk(chunk, input.manifest)) throw new Error('Matrix runtime chunk is invalid.');
    const key = `${chunk.rowIndex}:${chunk.columnIndex}`, ordinals = recordsByCell.get(key) ?? new Map();
    chunk.records.forEach((record, index) => {
      const ordinal = chunk.startSeedOrdinal + index;
      if (ordinals.has(ordinal)) throw new Error('Matrix runtime chunks overlap.');
      ordinals.set(ordinal, record);
    }); recordsByCell.set(key, ordinals);
  }
  const cells: StrategySearchMatrixCell[] = [], centeredPayoffs = Array.from({ length: 50 }, () => Array(50).fill(0));
  for (let rowIndex = 0; rowIndex < 50; rowIndex += 1) for (let columnIndex = rowIndex;
    columnIndex < 50; columnIndex += 1) {
    const ordinals = recordsByCell.get(`${rowIndex}:${columnIndex}`);
    if (!ordinals || ordinals.size !== 125) throw new Error('Matrix semantic cell coverage is incomplete.');
    const seedRecords = Array.from({ length: 125 }, (_unused, index) => ordinals.get(index + 1)!);
    const row = input.manifest.strategies[rowIndex]!, column = input.manifest.strategies[columnIndex]!;
    cells.push({ rowIndex, columnIndex, rowId: row.id, columnId: column.id, seedRecords });
    if (rowIndex !== columnIndex) {
      const first75 = seedRecords.slice(0, 75), centered = 2 * first75.reduce((sum, record) =>
        sum + record.payoffScore!, 0) / 75 - 1;
      centeredPayoffs[rowIndex]![columnIndex] = centered; centeredPayoffs[columnIndex]![rowIndex] = -centered;
    }
  }
  cells.sort((left, right) => left.rowIndex - right.rowIndex || left.columnIndex - right.columnIndex
    || compareUtf16(left.rowId, right.rowId) || compareUtf16(left.columnId, right.columnId));
  const equilibrium = solveEquilibrium(input.manifest.strategies.map((entry) => entry.id), centeredPayoffs);
  const base = { schemaVersion: 4 as const, experiment: 'strategy-search-matrix-evidence' as const,
    manifestHash: input.manifest.evidenceHash, manifest: structuredClone(input.manifest),
    source: structuredClone(input.manifest.source),
    seedOrdinals: Array.from({ length: 125 }, (_unused, index) => index + 1), cells,
    centeredPayoffs, equilibrium, evidenceHash: '' };
  return { ...base, evidenceHash: sealField(base, 'evidenceHash') };
}
export function validateStrategySearchMatrixArtifact(value: unknown,
  manifest: StrategySearchMatrixManifest): value is StrategySearchMatrixArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const held = value as StrategySearchMatrixArtifact;
    return exact(held, reduceStrategySearchMatrix({ manifest, chunks: held.cells.flatMap((cell) => [{
      schemaVersion: 1 as const, experiment: 'strategy-search-matrix-runtime-chunk' as const,
      manifestHash: manifest.evidenceHash, rowIndex: cell.rowIndex, columnIndex: cell.columnIndex,
      startSeedOrdinal: 1, endSeedOrdinal: 126, records: cell.seedRecords, contentHash: ''
    }]).map((chunk) => createStrategySearchMatrixChunk({ manifest, job: { slot: 0, rowIndex: chunk.rowIndex,
      columnIndex: chunk.columnIndex, startSeedOrdinal: 1, endSeedOrdinal: 126, startSeedIndex: 0,
      count: 125, seeds: manifest.seeds }, records: chunk.records })) }));
  } catch { return false; }
}
