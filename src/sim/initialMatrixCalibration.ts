import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { GAMES_PER_SEED } from './pairing';
import type { SeedEvaluationResult } from './pairing';
import { equilibriumGroupWeightRange, solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { validateTelemetryAggregate } from './lotteryAcquisition';
import { nativeRuleFingerprint } from './nativeGoldfishProtocol';
import {
  ORDERED_PRODUCT_SPACE_COUNT, ORDERED_PRODUCT_SUPPORTED_KINGDOMS,
  orderedProductSeedsValid, orderedProductTarget, validateOrderedProductRankedRecord
} from './orderedGoldfishProduct';
import type { OrderedProductReservoirArtifact } from './orderedGoldfishProduct';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';
import { classifyStrategyDamage } from './strategyDamage';
import type { TelemetryAggregate } from './types';

export const INITIAL_MATRIX_CALIBRATION_VERSION = 'initial-matrix-calibration-v2' as const;
export const INITIAL_MATRIX_STRATEGIES = 50;
export const INITIAL_MATRIX_MAX_SEEDS = 125;
export const OFF_DIAGONAL_PURPOSE = 'off-diagonal-payoff-and-telemetry' as const;
export const DIAGONAL_PURPOSE = 'diagonal-self-play-telemetry' as const;
export type InitialMatrixCellPurpose = typeof OFF_DIAGONAL_PURPOSE | typeof DIAGONAL_PURPOSE;

const SOURCE_KEYS = ['kingdomId', 'rankedSha256', 'reservoirSha256', 'runId', 'productVersion',
  'buildVersion', 'scorerVersion', 'ruleFingerprint', 'candidateProvenanceDigest'] as const;
const PROTOCOL_KEYS = ['version', 'kingdomId', 'rulesFingerprint', 'source', 'strategyCount', 'maxSeedCount',
  'chunkSize', 'seeds', 'turnLimitPerPlayer', 'actionCapPerTurn', 'startingDraftEnabled', 'gamesPerSeed',
  'orientationProtocol', 'earlyStopping', 'cellCoverage', 'offDiagonalPurpose', 'diagonalPurpose'] as const;
const MANIFEST_KEYS = ['schemaVersion', 'experiment', 'protocol', 'strategies', 'evidenceHash'] as const;
const CHUNK_KEYS = ['schemaVersion', 'experiment', 'manifestHash', 'purpose', 'rowIndex', 'columnIndex',
  'rowId', 'columnId', 'rowCanonical', 'columnCanonical', 'startSeedIndex', 'records', 'matches',
  'simulationMs', 'evidenceHash'] as const;
const RECORD_KEYS = ['seed', 'payoffScore', 'played', 'aborted', 'matches', 'telemetry'] as const;

export interface OrderedCalibrationRankedHeader {
  schemaVersion: number;
  version: string;
  runId: string;
  buildVersion: string;
  ruleFingerprint: string;
  scorerVersion: string;
  config: {
    kingdomId: string;
    candidateCount: number;
    retainedCount: number;
    reservoirCount: number;
    seeds: number[];
    turnLimit: number;
    actionCapPerTurn: number;
  };
  candidateSpace: { provenanceDigest: string };
  recordCount: number;
}

export interface InitialMatrixSourceIdentity {
  kingdomId: string;
  rankedSha256: string;
  reservoirSha256: string;
  runId: string;
  productVersion: string;
  buildVersion: string;
  scorerVersion: string;
  ruleFingerprint: string;
  candidateProvenanceDigest: string;
}

export interface InitialMatrixProtocol {
  version: typeof INITIAL_MATRIX_CALIBRATION_VERSION;
  kingdomId: string;
  rulesFingerprint: string;
  source: InitialMatrixSourceIdentity;
  strategyCount: 50;
  maxSeedCount: number;
  chunkSize: number;
  seeds: number[];
  turnLimitPerPlayer: 30;
  actionCapPerTurn: 200;
  startingDraftEnabled: false;
  gamesPerSeed: typeof GAMES_PER_SEED;
  orientationProtocol: 'fixed-seats-alternating-first-player';
  earlyStopping: false;
  cellCoverage: 'upper-triangle-including-diagonal';
  offDiagonalPurpose: typeof OFF_DIAGONAL_PURPOSE;
  diagonalPurpose: typeof DIAGONAL_PURPOSE;
}

export interface InitialMatrixManifest {
  schemaVersion: 2;
  experiment: 'initial-matrix-calibration';
  protocol: InitialMatrixProtocol;
  strategies: Strategy[];
  evidenceHash: string;
}

export interface InitialMatrixSeedRecord {
  seed: number;
  payoffScore: number | null;
  played: typeof GAMES_PER_SEED;
  aborted: 0;
  matches: typeof GAMES_PER_SEED;
  telemetry: TelemetryAggregate;
}

export interface InitialMatrixChunk {
  schemaVersion: 2;
  experiment: 'initial-matrix-calibration-cell-chunk';
  manifestHash: string;
  purpose: InitialMatrixCellPurpose;
  rowIndex: number;
  columnIndex: number;
  rowId: string;
  columnId: string;
  rowCanonical: string;
  columnCanonical: string;
  startSeedIndex: number;
  records: InitialMatrixSeedRecord[];
  matches: number;
  simulationMs: number;
  evidenceHash: string;
}

export interface InitialMatrixCellSeries {
  purpose: InitialMatrixCellPurpose;
  rowIndex: number;
  columnIndex: number;
  records: InitialMatrixSeedRecord[];
}

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function unsignedHash<T extends { evidenceHash: string }>(value: T): string {
  const copy = structuredClone(value) as Partial<T>;
  delete copy.evidenceHash;
  return hash(copy);
}
function exactKeys(value: object, expected: readonly string[]): boolean {
  return exact(Object.keys(value).sort(), [...expected].sort());
}
function uint32(text: string): number {
  return Number.parseInt(createHash('sha256').update(text).digest('hex').slice(0, 8), 16) >>> 0;
}
function validSha256(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }
function purposeFor(rowIndex: number, columnIndex: number): InitialMatrixCellPurpose {
  return rowIndex === columnIndex ? DIAGONAL_PURPOSE : OFF_DIAGONAL_PURPOSE;
}
function exactStrategyKeys(telemetry: TelemetryAggregate, ids: readonly string[]): boolean {
  const expected = [...new Set(ids)].sort();
  return exact(Object.keys(telemetry.acquisitionsByStrategy).sort(), expected)
    && exact(Object.keys(telemetry.planPositionPurchasesByStrategy ?? {}).sort(), expected);
}

export function initialMatrixCalibrationSeeds(source: InitialMatrixSourceIdentity, count: number): number[] {
  if (!validSha256(source.rankedSha256) || !validSha256(source.reservoirSha256)
    || !Number.isSafeInteger(count) || count < 2 || count > INITIAL_MATRIX_MAX_SEEDS) {
    throw new Error('Initial-matrix seed input is invalid.');
  }
  const seeds = Array.from({ length: count }, (_unused, index) => uint32(
    `${INITIAL_MATRIX_CALIBRATION_VERSION}:${source.kingdomId}:${source.rankedSha256}:${source.reservoirSha256}:${index}`
  ));
  if (new Set(seeds).size !== seeds.length) throw new Error('Initial-matrix seed namespace collided.');
  return seeds;
}

export function validateOrderedCalibrationSource(input: {
  kingdomId: string;
  ranked: unknown;
  reservoir: unknown;
  rankedSha256: string;
  reservoirSha256: string;
}): { source: InitialMatrixSourceIdentity; strategies: Strategy[] } {
  if (!ORDERED_PRODUCT_SUPPORTED_KINGDOMS.includes(input.kingdomId)) {
    throw new Error(`Unsupported ordered product kingdom: ${input.kingdomId}`);
  }
  if (!validSha256(input.rankedSha256) || !validSha256(input.reservoirSha256)
    || !input.ranked || typeof input.ranked !== 'object' || !input.reservoir || typeof input.reservoir !== 'object') {
    throw new Error('Ordered calibration source hashes or artifacts are invalid.');
  }
  const ranked = input.ranked as OrderedCalibrationRankedHeader;
  const reservoir = input.reservoir as OrderedProductReservoirArtifact;
  const target = orderedProductTarget(input.kingdomId);
  const expectedRules = nativeRuleFingerprint(input.kingdomId, 30, 200);
  if (ranked.schemaVersion !== 1 || ranked.version !== target.version || ranked.config?.kingdomId !== input.kingdomId
    || ranked.config.candidateCount !== ORDERED_PRODUCT_SPACE_COUNT || ranked.config.retainedCount !== 500_000
    || ranked.recordCount !== ranked.config.retainedCount || ranked.config.reservoirCount !== 20_000
    || !orderedProductSeedsValid(input.kingdomId, ranked.config.seeds) || ranked.config.turnLimit !== 30
    || ranked.config.actionCapPerTurn !== 200 || ranked.ruleFingerprint !== expectedRules
    || ranked.candidateSpace?.provenanceDigest !== target.candidateProvenanceDigest
    || reservoir.schemaVersion !== 1 || reservoir.version !== ranked.version || reservoir.runId !== ranked.runId
    || reservoir.sourceArtifactSha256 !== input.rankedSha256 || reservoir.reservoirCount !== 20_000
    || !Array.isArray(reservoir.entries) || reservoir.entries.length !== 20_000) {
    throw new Error('Ordered calibration source metadata, rules, or 20,000-entry reservoir is stale or invalid.');
  }
  const ids = new Set<string>();
  const canonicals = new Set<string>();
  for (let index = 0; index < reservoir.entries.length; index += 1) {
    const entry = reservoir.entries[index]!;
    if (!validateOrderedProductRankedRecord(entry) || entry.rank !== index + 1
      || ids.has(entry.strategy.id) || canonicals.has(entry.canonicalStrategy)) {
      throw new Error(`Ordered calibration reservoir entry ${index + 1} is invalid or out of order.`);
    }
    ids.add(entry.strategy.id);
    canonicals.add(entry.canonicalStrategy);
  }
  return {
    source: {
      kingdomId: input.kingdomId, rankedSha256: input.rankedSha256,
      reservoirSha256: input.reservoirSha256, runId: ranked.runId,
      productVersion: ranked.version, buildVersion: ranked.buildVersion,
      scorerVersion: ranked.scorerVersion, ruleFingerprint: ranked.ruleFingerprint,
      candidateProvenanceDigest: ranked.candidateSpace.provenanceDigest
    },
    strategies: reservoir.entries.slice(0, INITIAL_MATRIX_STRATEGIES).map((entry) => structuredClone(entry.strategy))
  };
}

export function createInitialMatrixManifest(input: {
  source: InitialMatrixSourceIdentity;
  strategies: readonly Strategy[];
  maxSeedCount: number;
  chunkSize: number;
}): InitialMatrixManifest {
  if (!input.source || !exactKeys(input.source, SOURCE_KEYS) || input.strategies.length !== INITIAL_MATRIX_STRATEGIES
    || new Set(input.strategies.map((strategy) => strategy.id)).size !== INITIAL_MATRIX_STRATEGIES
    || new Set(input.strategies.map(canonicalStrategy)).size !== INITIAL_MATRIX_STRATEGIES
    || !Number.isSafeInteger(input.maxSeedCount) || input.maxSeedCount < 2
    || input.maxSeedCount > INITIAL_MATRIX_MAX_SEEDS
    || !Number.isSafeInteger(input.chunkSize) || input.chunkSize < 1 || input.chunkSize > 25) {
    throw new Error('Initial-matrix manifest input is invalid.');
  }
  const protocol: InitialMatrixProtocol = {
    version: INITIAL_MATRIX_CALIBRATION_VERSION, kingdomId: input.source.kingdomId,
    rulesFingerprint: nativeRuleFingerprint(input.source.kingdomId, 30, 200), source: structuredClone(input.source),
    strategyCount: INITIAL_MATRIX_STRATEGIES, maxSeedCount: input.maxSeedCount, chunkSize: input.chunkSize,
    seeds: initialMatrixCalibrationSeeds(input.source, input.maxSeedCount), turnLimitPerPlayer: 30,
    actionCapPerTurn: 200, startingDraftEnabled: false, gamesPerSeed: GAMES_PER_SEED,
    orientationProtocol: 'fixed-seats-alternating-first-player', earlyStopping: false,
    cellCoverage: 'upper-triangle-including-diagonal', offDiagonalPurpose: OFF_DIAGONAL_PURPOSE,
    diagonalPurpose: DIAGONAL_PURPOSE
  };
  if (protocol.rulesFingerprint !== input.source.ruleFingerprint) {
    throw new Error('Ordered source rule fingerprint is stale.');
  }
  const base = { schemaVersion: 2 as const, experiment: 'initial-matrix-calibration' as const,
    protocol, strategies: input.strategies.map((strategy) => structuredClone(strategy)) };
  return { ...base, evidenceHash: hash(base) };
}

export function validateInitialMatrixManifest(value: unknown, expected?: InitialMatrixManifest): value is InitialMatrixManifest {
  try {
    if (!value || typeof value !== 'object' || !exactKeys(value, MANIFEST_KEYS)) return false;
    const held = value as InitialMatrixManifest;
    if (held.schemaVersion !== 2 || held.experiment !== 'initial-matrix-calibration'
      || !held.protocol || !exactKeys(held.protocol, PROTOCOL_KEYS)
      || !held.protocol.source || !exactKeys(held.protocol.source, SOURCE_KEYS)
      || held.evidenceHash !== unsignedHash(held)) return false;
    const rebuilt = createInitialMatrixManifest({ source: held.protocol.source, strategies: held.strategies,
      maxSeedCount: held.protocol.maxSeedCount, chunkSize: held.protocol.chunkSize });
    return exact(held, rebuilt) && (!expected || exact(held, expected));
  } catch { return false; }
}

export function createInitialMatrixChunk(input: {
  manifest: InitialMatrixManifest;
  rowIndex: number;
  columnIndex: number;
  startSeedIndex: number;
  records: readonly InitialMatrixSeedRecord[];
  simulationMs: number;
}): InitialMatrixChunk {
  const row = input.manifest.strategies[input.rowIndex];
  const column = input.manifest.strategies[input.columnIndex];
  if (!row || !column || input.rowIndex > input.columnIndex || !input.records.length
    || input.records.length > input.manifest.protocol.chunkSize) throw new Error('Initial-matrix chunk bounds are invalid.');
  const base = {
    schemaVersion: 2 as const, experiment: 'initial-matrix-calibration-cell-chunk' as const,
    manifestHash: input.manifest.evidenceHash, purpose: purposeFor(input.rowIndex, input.columnIndex),
    rowIndex: input.rowIndex, columnIndex: input.columnIndex, rowId: row.id, columnId: column.id,
    rowCanonical: canonicalStrategy(row), columnCanonical: canonicalStrategy(column),
    startSeedIndex: input.startSeedIndex, records: input.records.map((record) => structuredClone(record)),
    matches: input.records.length * GAMES_PER_SEED, simulationMs: input.simulationMs
  };
  const artifact = { ...base, evidenceHash: hash(base) };
  if (!validateInitialMatrixChunk(artifact, input.manifest, input.rowIndex, input.columnIndex,
    input.startSeedIndex, input.records.length)) throw new Error('Initial-matrix chunk evidence is invalid.');
  return artifact;
}

export function validateInitialMatrixChunk(
  value: unknown, manifest: InitialMatrixManifest, rowIndex: number, columnIndex: number,
  startSeedIndex: number, count: number
): value is InitialMatrixChunk {
  try {
    if (!validateInitialMatrixManifest(manifest) || !value || typeof value !== 'object'
      || !exactKeys(value, CHUNK_KEYS)) return false;
    const held = value as InitialMatrixChunk;
    const row = manifest.strategies[rowIndex], column = manifest.strategies[columnIndex];
    const expectedSeeds = manifest.protocol.seeds.slice(startSeedIndex, startSeedIndex + count);
    const purpose = purposeFor(rowIndex, columnIndex);
    if (!row || !column || rowIndex > columnIndex || count < 1 || count > manifest.protocol.chunkSize
      || startSeedIndex % manifest.protocol.chunkSize !== 0 || startSeedIndex + count > manifest.protocol.maxSeedCount
      || held.schemaVersion !== 2 || held.experiment !== 'initial-matrix-calibration-cell-chunk'
      || held.manifestHash !== manifest.evidenceHash || held.purpose !== purpose
      || held.rowIndex !== rowIndex || held.columnIndex !== columnIndex || held.rowId !== row.id
      || held.columnId !== column.id || held.rowCanonical !== canonicalStrategy(row)
      || held.columnCanonical !== canonicalStrategy(column) || held.startSeedIndex !== startSeedIndex
      || held.records?.length !== count || held.matches !== count * GAMES_PER_SEED
      || !Number.isFinite(held.simulationMs) || held.simulationMs < 0
      || !exact(held.records.map((record) => record.seed), expectedSeeds)
      || held.evidenceHash !== unsignedHash(held)) return false;
    for (const record of held.records) {
      const validPayoff = purpose === DIAGONAL_PURPOSE ? record.payoffScore === null
        : Number.isFinite(record.payoffScore) && record.payoffScore! >= 0 && record.payoffScore! <= 1;
      if (!record || typeof record !== 'object' || !exactKeys(record, RECORD_KEYS) || !validPayoff
        || record.played !== GAMES_PER_SEED || record.aborted !== 0 || record.matches !== GAMES_PER_SEED
        || !validateTelemetryAggregate(record.telemetry, GAMES_PER_SEED)
        || !exactStrategyKeys(record.telemetry, [row.id, column.id])) return false;
    }
    return true;
  } catch { return false; }
}

export function initialMatrixChunkRelativePath(row: number, column: number, start: number): string {
  return `chunks/cell-${String(row).padStart(2, '0')}-${String(column).padStart(2, '0')}/chunk-${String(start).padStart(6, '0')}.json`;
}

export function expectedInitialMatrixChunkRelativePaths(manifest: InitialMatrixManifest): Set<string> {
  const paths = new Set<string>();
  for (let row = 0; row < manifest.strategies.length; row += 1) {
    for (let column = row; column < manifest.strategies.length; column += 1) {
      for (let start = 0; start < manifest.protocol.maxSeedCount; start += manifest.protocol.chunkSize) {
        paths.add(initialMatrixChunkRelativePath(row, column, start));
      }
    }
  }
  return paths;
}

export function assertInitialMatrixOutputJsonFiles(relativeFiles: readonly string[], manifestExists: boolean,
  manifest?: InitialMatrixManifest): void {
  const normalized = relativeFiles.map((file) => file.replaceAll('\\', '/'));
  if (!manifestExists) {
    if (normalized.length) throw new Error('Initial-matrix output contains evidence without a manifest.');
    return;
  }
  if (!manifest) throw new Error('Initial-matrix output manifest is missing.');
  const allowed = expectedInitialMatrixChunkRelativePaths(manifest);
  allowed.add('manifest.json');
  allowed.add('report.json');
  for (const file of normalized) {
    if (!allowed.has(file)) throw new Error(`Unexpected initial-matrix JSON file ${file}.`);
  }
}

function validateSeries(strategies: readonly Strategy[], cells: readonly InitialMatrixCellSeries[], seedCount: number): void {
  const expected = strategies.length * (strategies.length + 1) / 2;
  if (strategies.length < 2 || cells.length !== expected || !Number.isSafeInteger(seedCount) || seedCount < 1) {
    throw new Error('Initial-matrix cell series is incomplete.');
  }
  const seen = new Set<string>();
  for (const cell of cells) {
    const id = `${cell.rowIndex}:${cell.columnIndex}`;
    const row = strategies[cell.rowIndex], column = strategies[cell.columnIndex];
    const expectedPurpose = purposeFor(cell.rowIndex, cell.columnIndex);
    if (!row || !column || cell.rowIndex > cell.columnIndex || cell.purpose !== expectedPurpose
      || seen.has(id) || cell.records.length !== seedCount) {
      throw new Error('Initial-matrix cell series is invalid.');
    }
    for (const record of cell.records) {
      const validPayoff = expectedPurpose === DIAGONAL_PURPOSE ? record.payoffScore === null
        : Number.isFinite(record.payoffScore) && record.payoffScore! >= 0 && record.payoffScore! <= 1;
      if (!validPayoff || record.played !== GAMES_PER_SEED || record.matches !== GAMES_PER_SEED
        || record.aborted !== 0 || !validateTelemetryAggregate(record.telemetry, GAMES_PER_SEED)
        || !exactStrategyKeys(record.telemetry, [row.id, column.id])) {
        throw new Error('Initial-matrix cell series is invalid.');
      }
    }
    seen.add(id);
  }
}

export interface InitialMatrixGameCosts {
  offDiagonalGames: number;
  diagonalTelemetryGames: number;
  totalGames: number;
}

export function initialMatrixGameCosts(strategyCount: number, seedCount: number): InitialMatrixGameCosts {
  if (!Number.isSafeInteger(strategyCount) || strategyCount < 2
    || !Number.isSafeInteger(seedCount) || seedCount < 1) throw new Error('Initial-matrix cost input is invalid.');
  const offDiagonalGames = strategyCount * (strategyCount - 1) / 2 * seedCount * GAMES_PER_SEED;
  const diagonalTelemetryGames = strategyCount * seedCount * GAMES_PER_SEED;
  return { offDiagonalGames, diagonalTelemetryGames,
    totalGames: offDiagonalGames + diagonalTelemetryGames };
}

interface RangeEvidence {
  matrix: number[][];
  cells: InitialMatrixCellSeries[];
  costs: InitialMatrixGameCosts;
}

function rangeEvidence(strategies: readonly Strategy[], cells: readonly InitialMatrixCellSeries[],
  start: number, end: number): RangeEvidence {
  const matrix = strategies.map(() => strategies.map(() => 0));
  const rangedCells = cells.map((cell) => ({ ...cell, records: cell.records.slice(start, end) }));
  for (const cell of rangedCells) {
    if (cell.rowIndex === cell.columnIndex) continue;
    const played = cell.records.reduce((sum, record) => sum + record.played, 0);
    const score = cell.records.reduce((sum, record) => sum + record.payoffScore! * record.played, 0);
    const centered = played ? 2 * score / played - 1 : 0;
    matrix[cell.rowIndex]![cell.columnIndex] = centered;
    matrix[cell.columnIndex]![cell.rowIndex] = -centered;
  }
  return { matrix, cells: rangedCells, costs: initialMatrixGameCosts(strategies.length, end - start) };
}

export interface InitialMatrixAcquisitionSummary {
  basis: 'selected equilibrium lottery versus itself; diagonal self-play included; rates are copies per player-game';
  feasibleRangeBasis: 'conditional on selected-lottery classifier labels and the discovered matrix';
  strategyAcquisitionRates: Record<string, Record<string, number>>;
  strategyLabels: Record<string, string>;
  selectedArchetypeShares: Record<string, number>;
  feasibleArchetypeRanges: Record<string, { minimum: number; maximum: number }>;
  expectedCopiesPerPlayerGame: Record<string, number>;
}

export function summarizeInitialMatrixAcquisitions(input: {
  strategies: readonly Strategy[];
  cells: readonly InitialMatrixCellSeries[];
  seedCount: number;
  equilibrium: EquilibriumResult;
  centeredPayoffs: readonly (readonly number[])[];
}): InitialMatrixAcquisitionSummary {
  validateSeries(input.strategies, input.cells, input.seedCount);
  const ids = input.strategies.map((strategy) => strategy.id);
  if (!exact([...input.equilibrium.strategyIds].sort(), [...ids].sort())
    || input.centeredPayoffs.length !== ids.length
    || input.centeredPayoffs.some((row) => row.length !== ids.length)) {
    throw new Error('Initial-matrix acquisition analysis input is invalid.');
  }
  const weights = ids.map((id) => input.equilibrium.weights[id] ?? 0);
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)
    || Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-7) {
    throw new Error('Initial-matrix selected lottery is invalid.');
  }
  const cellByIndexes = new Map(input.cells.map((cell) => [`${cell.rowIndex}:${cell.columnIndex}`, cell]));
  const strategyAcquisitionRates: Record<string, Record<string, number>> = {};
  for (let strategyIndex = 0; strategyIndex < ids.length; strategyIndex += 1) {
    const strategyId = ids[strategyIndex]!;
    const rates: Record<string, number> = {};
    for (let opponentIndex = 0; opponentIndex < ids.length; opponentIndex += 1) {
      const row = Math.min(strategyIndex, opponentIndex), column = Math.max(strategyIndex, opponentIndex);
      const cell = cellByIndexes.get(`${row}:${column}`)!;
      const counts: Record<string, number> = {};
      for (const record of cell.records) {
        for (const [cardId, amount] of Object.entries(record.telemetry.acquisitionsByStrategy[strategyId] ?? {})) {
          counts[cardId] = (counts[cardId] ?? 0) + amount;
        }
      }
      const playerGames = input.seedCount * GAMES_PER_SEED * (strategyIndex === opponentIndex ? 2 : 1);
      for (const [cardId, amount] of Object.entries(counts)) {
        rates[cardId] = (rates[cardId] ?? 0) + weights[opponentIndex]! * amount / playerGames;
      }
    }
    strategyAcquisitionRates[strategyId] = rates;
  }
  const strategyLabels = Object.fromEntries(input.strategies.map((strategy) => [strategy.id,
    classifyStrategyDamage({ startingBuild: strategy.startingBuild,
      acquisitionRates: strategyAcquisitionRates[strategy.id] ?? {} })]));
  const labels = [...new Set([...Object.values(strategyLabels), 'Melee', 'Ranged', 'Mage',
    'Melee + Ranged', 'Melee + Mage', 'Ranged + Mage', 'Melee + Ranged + Mage', 'No damage package'])];
  const selectedArchetypeShares: Record<string, number> = {};
  const feasibleArchetypeRanges: Record<string, { minimum: number; maximum: number }> = {};
  for (const label of labels) {
    const groupIds = ids.filter((id) => strategyLabels[id] === label);
    selectedArchetypeShares[label] = groupIds.reduce((sum, id) => sum + (input.equilibrium.weights[id] ?? 0), 0);
    feasibleArchetypeRanges[label] = equilibriumGroupWeightRange(ids, input.centeredPayoffs,
      input.equilibrium.value, groupIds);
  }
  const expectedCopiesPerPlayerGame: Record<string, number> = {};
  for (const id of ids) for (const [cardId, rate] of Object.entries(strategyAcquisitionRates[id]!)) {
    expectedCopiesPerPlayerGame[cardId] = (expectedCopiesPerPlayerGame[cardId] ?? 0)
      + (input.equilibrium.weights[id] ?? 0) * rate;
  }
  return {
    basis: 'selected equilibrium lottery versus itself; diagonal self-play included; rates are copies per player-game',
    feasibleRangeBasis: 'conditional on selected-lottery classifier labels and the discovered matrix',
    strategyAcquisitionRates, strategyLabels, selectedArchetypeShares, feasibleArchetypeRanges,
    expectedCopiesPerPlayerGame
  };
}

export interface InitialMatrixPrefixAnalysis {
  seedRange: { startOrdinal: 1; endOrdinal: number; count: number };
  evidenceCosts: InitialMatrixGameCosts;
  equilibrium: EquilibriumResult;
  heldOutRestrictedExploitability: { centeredAdvantage: number; score: number; strategyId: string };
  heldOutDirectStrength: { centeredPayoff: number; score: number; opponent: 'held-out restricted equilibrium' };
  heldOutAcquisitionEvaluation: {
    seedRange: { startOrdinal: number; endOrdinal: number; count: number };
    acquisitions: InitialMatrixAcquisitionSummary;
  };
}

export interface InitialMatrixAnalysisReport {
  requestedPrefixes: number[];
  heldOut: {
    seedRange: { startOrdinal: number; endOrdinal: number; count: number };
    evidenceCosts: InitialMatrixGameCosts;
    equilibrium: EquilibriumResult;
    acquisitions: InitialMatrixAcquisitionSummary;
  };
  prefixes: InitialMatrixPrefixAnalysis[];
  evidenceCosts: {
    offDiagonal: { cells: number; games: number; measuredChunkWallMs: number };
    diagonalTelemetry: { cells: number; games: number; measuredChunkWallMs: number };
    total: { cells: number; games: number; measuredChunkWallMs: number };
    solverWallMs: number;
  };
}

function weightedPayoff(ids: readonly string[], left: EquilibriumResult,
  matrix: readonly (readonly number[])[], right: EquilibriumResult): number {
  return ids.reduce((sum, rowId, row) => sum + (left.weights[rowId] ?? 0)
    * ids.reduce((inner, columnId, column) => inner
      + (right.weights[columnId] ?? 0) * matrix[row]![column]!, 0), 0);
}

export function analyzeInitialMatrix(input: {
  strategies: readonly Strategy[];
  cells: readonly InitialMatrixCellSeries[];
  seedCount: number;
  requestedPrefixes: readonly number[];
  heldOutStartSeedIndex: number;
  measuredChunkWallMs: { offDiagonal: number; diagonalTelemetry: number };
}): InitialMatrixAnalysisReport {
  validateSeries(input.strategies, input.cells, input.seedCount);
  const prefixes = [...input.requestedPrefixes];
  if (!prefixes.length || new Set(prefixes).size !== prefixes.length
    || prefixes.some((count) => !Number.isSafeInteger(count) || count < 1
      || count > input.heldOutStartSeedIndex)
    || !Number.isSafeInteger(input.heldOutStartSeedIndex) || input.heldOutStartSeedIndex < 1
    || input.heldOutStartSeedIndex >= input.seedCount
    || !Number.isFinite(input.measuredChunkWallMs.offDiagonal) || input.measuredChunkWallMs.offDiagonal < 0
    || !Number.isFinite(input.measuredChunkWallMs.diagonalTelemetry) || input.measuredChunkWallMs.diagonalTelemetry < 0) {
    throw new Error('Initial-matrix analysis configuration is invalid.');
  }
  prefixes.sort((left, right) => left - right);
  const ids = input.strategies.map((strategy) => strategy.id);
  let solverWallMs = 0;
  const heldEvidence = rangeEvidence(input.strategies, input.cells,
    input.heldOutStartSeedIndex, input.seedCount);
  const heldOutSeedCount = input.seedCount - input.heldOutStartSeedIndex;
  const heldOutSeedRange = { startOrdinal: input.heldOutStartSeedIndex + 1,
    endOrdinal: input.seedCount, count: heldOutSeedCount };
  let started = performance.now();
  const heldEquilibrium = solveEquilibrium(ids, heldEvidence.matrix);
  solverWallMs += performance.now() - started;
  const analyses = prefixes.map((seedCount): InitialMatrixPrefixAnalysis => {
    const evidence = rangeEvidence(input.strategies, input.cells, 0, seedCount);
    started = performance.now();
    const equilibrium = solveEquilibrium(ids, evidence.matrix);
    solverWallMs += performance.now() - started;
    const advantages = ids.map((strategyId, row) => ({ strategyId,
      centeredAdvantage: ids.reduce((sum, columnId, column) => sum
        + (equilibrium.weights[columnId] ?? 0) * heldEvidence.matrix[row]![column]!, 0) }));
    advantages.sort((left, right) => right.centeredAdvantage - left.centeredAdvantage
      || left.strategyId.localeCompare(right.strategyId));
    const best = advantages[0]!;
    const direct = weightedPayoff(ids, equilibrium, heldEvidence.matrix, heldEquilibrium);
    return {
      seedRange: { startOrdinal: 1, endOrdinal: seedCount, count: seedCount },
      evidenceCosts: evidence.costs, equilibrium,
      heldOutRestrictedExploitability: { centeredAdvantage: best.centeredAdvantage,
        score: (best.centeredAdvantage + 1) / 2, strategyId: best.strategyId },
      heldOutDirectStrength: { centeredPayoff: direct, score: (direct + 1) / 2,
        opponent: 'held-out restricted equilibrium' },
      heldOutAcquisitionEvaluation: {
        seedRange: heldOutSeedRange,
        acquisitions: summarizeInitialMatrixAcquisitions({ strategies: input.strategies,
          cells: heldEvidence.cells, seedCount: heldOutSeedCount, equilibrium,
          centeredPayoffs: evidence.matrix })
      }
    };
  });
  const fullCosts = initialMatrixGameCosts(input.strategies.length, input.seedCount);
  const offDiagonalCells = input.strategies.length * (input.strategies.length - 1) / 2;
  const diagonalCells = input.strategies.length;
  return {
    requestedPrefixes: prefixes,
    heldOut: {
      seedRange: heldOutSeedRange,
      evidenceCosts: heldEvidence.costs, equilibrium: heldEquilibrium,
      acquisitions: summarizeInitialMatrixAcquisitions({ strategies: input.strategies,
        cells: heldEvidence.cells, seedCount: heldOutSeedCount, equilibrium: heldEquilibrium,
        centeredPayoffs: heldEvidence.matrix })
    },
    prefixes: analyses,
    evidenceCosts: {
      offDiagonal: { cells: offDiagonalCells, games: fullCosts.offDiagonalGames,
        measuredChunkWallMs: input.measuredChunkWallMs.offDiagonal },
      diagonalTelemetry: { cells: diagonalCells, games: fullCosts.diagonalTelemetryGames,
        measuredChunkWallMs: input.measuredChunkWallMs.diagonalTelemetry },
      total: { cells: offDiagonalCells + diagonalCells, games: fullCosts.totalGames,
        measuredChunkWallMs: input.measuredChunkWallMs.offDiagonal + input.measuredChunkWallMs.diagonalTelemetry },
      solverWallMs
    }
  };
}

export function seedRecordFromOutcome(block: SeedEvaluationResult, telemetry: TelemetryAggregate,
  matches: number, purpose: InitialMatrixCellPurpose): InitialMatrixSeedRecord {
  if (block.played !== GAMES_PER_SEED || block.aborted !== 0 || matches !== GAMES_PER_SEED
    || !validateTelemetryAggregate(telemetry, matches)
    || (purpose !== OFF_DIAGONAL_PURPOSE && purpose !== DIAGONAL_PURPOSE)) {
    throw new Error('Initial-matrix seed outcome is invalid.');
  }
  return { seed: block.seed, payoffScore: purpose === OFF_DIAGONAL_PURPOSE ? block.score : null,
    played: GAMES_PER_SEED, aborted: 0, matches: GAMES_PER_SEED, telemetry: structuredClone(telemetry) };
}
