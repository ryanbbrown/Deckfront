import { GAMES_PER_SEED, emptyAggregate, mergeAggregate } from './pairing';
import { validateTelemetryAggregate } from './lotteryAcquisition';
import type { SeedEvaluationResult, PairingOutcome } from './pairing';
import { matrixProtocol } from './payoffMatrix';
import type { MatrixCell, MatrixSnapshot } from './payoffMatrix';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import type { TelemetryAggregate } from './types';

export const NESTED_MATRIX_DEPTHS = Object.freeze([50, 100, 200] as const);
export type NestedMatrixDepth = typeof NESTED_MATRIX_DEPTHS[number];

export interface NestedMatrixProtocol {
  version: 'ordered-reservoir-full-nested-matrix-v2';
  kingdomId: string;
  seeds: number[];
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  startingDraftEnabled: false;
}

export interface NestedMatrixBatch {
  startBlock: number;
  seeds: number[];
  blocks: SeedEvaluationResult[];
  matches: number;
  telemetry: TelemetryAggregate;
}

export interface NestedMatrixCellEvidence {
  rowId: string;
  columnId: string;
  rowCanonical: string;
  columnCanonical: string;
  batches: NestedMatrixBatch[];
}

export interface NestedMatrixEvidence {
  schemaVersion: 1;
  experiment: 'ordered-reservoir-full-nested-matrix';
  protocol: NestedMatrixProtocol;
  strategies: Strategy[];
  cells: NestedMatrixCellEvidence[];
  evidenceHash: string;
}

function exact(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function baseHash(value: Omit<NestedMatrixEvidence, 'evidenceHash'>): string { return stableHash(JSON.stringify(value)); }
function pair(left: Strategy, right: Strategy): [Strategy, Strategy] {
  return left.id < right.id ? [left, right] : [right, left];
}
function cellId(left: Strategy, right: Strategy): string { const [a, b] = pair(left, right); return `${a.id}|${b.id}`; }
function completedBlocks(cell: NestedMatrixCellEvidence): number {
  return cell.batches.reduce((sum, batch) => sum + batch.blocks.length, 0);
}

export function createNestedMatrixEvidence(protocol: NestedMatrixProtocol, strategies: readonly Strategy[] = []): NestedMatrixEvidence {
  if (protocol.seeds.length !== 200 || new Set(protocol.seeds).size !== 200) {
    throw new Error('Nested matrix needs 200 unique seeds.');
  }
  const base: Omit<NestedMatrixEvidence, 'evidenceHash'> = { schemaVersion: 1,
    experiment: 'ordered-reservoir-full-nested-matrix', protocol: { ...protocol, seeds: [...protocol.seeds] },
    strategies: [...strategies].sort((a, b) => a.id.localeCompare(b.id)), cells: [] };
  return { ...base, evidenceHash: baseHash(base) };
}

export function withNestedMatrixStrategies(
  evidence: NestedMatrixEvidence, additions: readonly Strategy[]
): NestedMatrixEvidence {
  if (!validateNestedMatrixEvidence(evidence)) throw new Error('Cannot extend invalid nested matrix evidence.');
  const byId = new Map(evidence.strategies.map((strategy) => [strategy.id, strategy]));
  for (const strategy of additions) {
    const held = byId.get(strategy.id);
    if (held && canonicalStrategy(held) !== canonicalStrategy(strategy)) throw new Error(`Strategy collision ${strategy.id}.`);
    byId.set(strategy.id, strategy);
  }
  const base: Omit<NestedMatrixEvidence, 'evidenceHash'> = { schemaVersion: evidence.schemaVersion,
    experiment: evidence.experiment, protocol: structuredClone(evidence.protocol),
    strategies: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    cells: evidence.cells.map((cell) => structuredClone(cell)) };
  return { ...base, evidenceHash: baseHash(base) };
}

export interface NestedMatrixWork {
  left: Strategy;
  right: Strategy;
  startBlock: number;
  seeds: number[];
}

export function nestedMatrixWork(evidence: NestedMatrixEvidence, depth: NestedMatrixDepth): NestedMatrixWork[] {
  if (!validateNestedMatrixEvidence(evidence) || !NESTED_MATRIX_DEPTHS.includes(depth)) {
    throw new Error('Nested matrix work input is invalid.');
  }
  const cells = new Map(evidence.cells.map((cell) => [`${cell.rowId}|${cell.columnId}`, cell]));
  const work: NestedMatrixWork[] = [];
  for (let row = 0; row < evidence.strategies.length; row += 1) for (let column = row + 1;
    column < evidence.strategies.length; column += 1) {
    const [left, right] = pair(evidence.strategies[row]!, evidence.strategies[column]!);
    let start = cells.has(cellId(left, right)) ? completedBlocks(cells.get(cellId(left, right))!) : 0;
    while (start < depth) {
      const count = Math.min(25, depth - start);
      work.push({ left, right, startBlock: start, seeds: evidence.protocol.seeds.slice(start, start + count) });
      start += count;
    }
  }
  return work;
}

export function appendNestedMatrixOutcome(
  evidence: NestedMatrixEvidence, work: NestedMatrixWork, outcome: PairingOutcome
): NestedMatrixEvidence {
  if (!validateNestedMatrixEvidence(evidence) || outcome.record.aborted || outcome.blocks.length !== work.seeds.length
    || outcome.matches !== work.seeds.length * GAMES_PER_SEED || !exact(outcome.blocks.map((block) => block.seed), work.seeds)
    || outcome.blocks.some((block) => block.played !== GAMES_PER_SEED || block.aborted)) {
    throw new Error('Nested matrix outcome is invalid.');
  }
  const [left, right] = pair(work.left, work.right);
  const cells = evidence.cells.map((cell) => structuredClone(cell));
  let cell = cells.find((entry) => entry.rowId === left.id && entry.columnId === right.id);
  if (!cell) {
    cell = { rowId: left.id, columnId: right.id, rowCanonical: canonicalStrategy(left),
      columnCanonical: canonicalStrategy(right), batches: [] };
    cells.push(cell);
  }
  if (completedBlocks(cell) !== work.startBlock) throw new Error('Nested matrix batch is out of order.');
  cell.batches.push({ startBlock: work.startBlock, seeds: [...work.seeds], blocks: structuredClone(outcome.blocks),
    matches: outcome.matches, telemetry: structuredClone(outcome.telemetry) });
  cells.sort((a, b) => a.rowId.localeCompare(b.rowId) || a.columnId.localeCompare(b.columnId));
  const base: Omit<NestedMatrixEvidence, 'evidenceHash'> = { schemaVersion: evidence.schemaVersion,
    experiment: evidence.experiment, protocol: structuredClone(evidence.protocol),
    strategies: structuredClone(evidence.strategies), cells };
  return { ...base, evidenceHash: baseHash(base) };
}

function payoff(blocks: readonly SeedEvaluationResult[]): number {
  const games = blocks.reduce((sum, block) => sum + block.played, 0);
  return games ? 2 * blocks.reduce((sum, block) => sum + block.score * block.played, 0) / games - 1 : 0;
}

export function nestedMatrixSnapshot(evidence: NestedMatrixEvidence, depth: NestedMatrixDepth): MatrixSnapshot {
  if (!validateNestedMatrixEvidence(evidence)) throw new Error('Nested matrix evidence is invalid.');
  const strategies = [...evidence.strategies];
  const cellsById = new Map(evidence.cells.map((cell) => [`${cell.rowId}|${cell.columnId}`, cell]));
  const cells: MatrixCell[] = [];
  const centeredPayoffs = strategies.map((row, rowIndex) => strategies.map((column, columnIndex) => {
    if (rowIndex === columnIndex) return 0;
    const [left, right] = pair(row, column), source = cellsById.get(cellId(left, right));
    if (!source || completedBlocks(source) < depth) return Number.NaN;
    const batches = source.batches.filter((batch) => batch.startBlock < depth);
    const blocks = batches.flatMap((batch) => batch.blocks).slice(0, depth);
    const telemetry = emptyAggregate();
    for (const batch of batches) mergeAggregate(telemetry, batch.telemetry);
    if (rowIndex < columnIndex) cells.push({ rowId: left.id, columnId: right.id,
      key: stableHash(JSON.stringify({ protocol: evidence.protocol, left: source.rowCanonical,
        right: source.columnCanonical, depth })), blocks, complete: blocks.length === depth,
      centeredPayoff: payoff(blocks), matches: blocks.length * GAMES_PER_SEED, telemetry });
    const value = payoff(blocks);
    return row.id === left.id ? value : -value;
  }));
  cells.sort((a, b) => a.rowId.localeCompare(b.rowId) || a.columnId.localeCompare(b.columnId));
  return { protocol: matrixProtocol(evidence.protocol.kingdomId, evidence.protocol.seeds.slice(0, depth),
    evidence.protocol.turnLimitPerPlayer, evidence.protocol.actionCapPerTurn, false),
    strategies, cells, complete: cells.length === strategies.length * (strategies.length - 1) / 2
      && cells.every((cell) => cell.complete), centeredPayoffs };
}

export function validateNestedMatrixEvidence(value: unknown): value is NestedMatrixEvidence {
  try {
    if (!value || typeof value !== 'object') return false;
    const evidence = value as NestedMatrixEvidence;
    if (evidence.schemaVersion !== 1 || evidence.experiment !== 'ordered-reservoir-full-nested-matrix'
      || evidence.protocol?.version !== 'ordered-reservoir-full-nested-matrix-v2'
      || evidence.protocol.seeds?.length !== 200 || new Set(evidence.protocol.seeds).size !== 200
      || evidence.protocol.startingDraftEnabled !== false || !Array.isArray(evidence.strategies)
      || !Array.isArray(evidence.cells) || new Set(evidence.strategies.map((strategy) => strategy.id)).size !== evidence.strategies.length
      || !exact(evidence.strategies, [...evidence.strategies].sort((a, b) => a.id.localeCompare(b.id)))) return false;
    const byId = new Map(evidence.strategies.map((strategy) => [strategy.id, strategy]));
    const seen = new Set<string>();
    for (const cell of evidence.cells) {
      const left = byId.get(cell.rowId), right = byId.get(cell.columnId), id = `${cell.rowId}|${cell.columnId}`;
      if (!left || !right || cell.rowId >= cell.columnId || seen.has(id) || !Array.isArray(cell.batches)
        || cell.rowCanonical !== canonicalStrategy(left) || cell.columnCanonical !== canonicalStrategy(right)) return false;
      seen.add(id); let start = 0;
      for (const batch of cell.batches) {
        if (batch.startBlock !== start || !batch.seeds.length || batch.seeds.length > 25
          || !exact(batch.seeds, evidence.protocol.seeds.slice(start, start + batch.seeds.length))
          || !exact(batch.blocks.map((block) => block.seed), batch.seeds)
          || batch.blocks.some((block) => block.played !== GAMES_PER_SEED || block.aborted || block.score < 0 || block.score > 1)
          || batch.matches !== batch.seeds.length * GAMES_PER_SEED
          || !validateTelemetryAggregate(batch.telemetry, batch.matches)) return false;
        start += batch.seeds.length;
      }
      if (start > 200 || start % 25 !== 0) return false;
    }
    const copy = structuredClone(evidence) as Partial<NestedMatrixEvidence>; delete copy.evidenceHash;
    return evidence.evidenceHash === baseHash(copy as Omit<NestedMatrixEvidence, 'evidenceHash'>);
  } catch { return false; }
}
