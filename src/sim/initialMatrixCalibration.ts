import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { GAMES_PER_SEED, emptyAggregate, mergeAggregate } from './pairing';
import type { SeedEvaluationResult } from './pairing';
import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { validateTelemetryAggregate } from './lotteryAcquisition';
import { nativeRuleFingerprint } from './nativeGoldfishProtocol';
import {
  ORDERED_PRODUCT_SEEDS, ORDERED_PRODUCT_SPACE_COUNT, ORDERED_PRODUCT_SUPPORTED_KINGDOMS,
  orderedProductTarget, validateOrderedProductRankedRecord
} from './orderedGoldfishProduct';
import type { OrderedProductReservoirArtifact } from './orderedGoldfishProduct';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';
import { classifyStrategyDamage } from './strategyDamage';
import type { TelemetryAggregate } from './types';

export const INITIAL_MATRIX_CALIBRATION_VERSION = 'initial-matrix-calibration-v1' as const;
export const INITIAL_MATRIX_STRATEGIES = 50;

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
}

export interface InitialMatrixManifest {
  schemaVersion: 1;
  experiment: 'initial-matrix-calibration';
  protocol: InitialMatrixProtocol;
  strategies: Strategy[];
  evidenceHash: string;
}

export interface InitialMatrixSeedRecord {
  seed: number;
  score: number;
  played: typeof GAMES_PER_SEED;
  aborted: 0;
  matches: typeof GAMES_PER_SEED;
  telemetry: TelemetryAggregate;
}

export interface InitialMatrixChunk {
  schemaVersion: 1;
  experiment: 'initial-matrix-calibration-pair-chunk';
  version: typeof INITIAL_MATRIX_CALIBRATION_VERSION;
  manifestHash: string;
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
function uint32(text: string): number {
  return Number.parseInt(createHash('sha256').update(text).digest('hex').slice(0, 8), 16) >>> 0;
}
function validSha256(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }

export function initialMatrixCalibrationSeeds(source: InitialMatrixSourceIdentity, count: number): number[] {
  if (!validSha256(source.rankedSha256) || !validSha256(source.reservoirSha256)
    || !Number.isSafeInteger(count) || count < 2) {
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
    || !exact(ranked.config.seeds, ORDERED_PRODUCT_SEEDS) || ranked.config.turnLimit !== 30
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
  if (input.strategies.length !== INITIAL_MATRIX_STRATEGIES
    || new Set(input.strategies.map((strategy) => strategy.id)).size !== INITIAL_MATRIX_STRATEGIES
    || !Number.isSafeInteger(input.maxSeedCount) || input.maxSeedCount < 2
    || !Number.isSafeInteger(input.chunkSize) || input.chunkSize < 1 || input.chunkSize > 25) {
    throw new Error('Initial-matrix manifest input is invalid.');
  }
  const protocol: InitialMatrixProtocol = {
    version: INITIAL_MATRIX_CALIBRATION_VERSION, kingdomId: input.source.kingdomId,
    rulesFingerprint: nativeRuleFingerprint(input.source.kingdomId, 30, 200), source: structuredClone(input.source),
    strategyCount: INITIAL_MATRIX_STRATEGIES, maxSeedCount: input.maxSeedCount, chunkSize: input.chunkSize,
    seeds: initialMatrixCalibrationSeeds(input.source, input.maxSeedCount), turnLimitPerPlayer: 30,
    actionCapPerTurn: 200, startingDraftEnabled: false, gamesPerSeed: GAMES_PER_SEED,
    orientationProtocol: 'fixed-seats-alternating-first-player', earlyStopping: false
  };
  if (protocol.rulesFingerprint !== input.source.ruleFingerprint) {
    throw new Error('Ordered source rule fingerprint is stale.');
  }
  const base = { schemaVersion: 1 as const, experiment: 'initial-matrix-calibration' as const,
    protocol, strategies: input.strategies.map((strategy) => structuredClone(strategy)) };
  return { ...base, evidenceHash: hash(base) };
}

export function validateInitialMatrixManifest(value: unknown, expected?: InitialMatrixManifest): value is InitialMatrixManifest {
  try {
    if (!value || typeof value !== 'object') return false;
    const held = value as InitialMatrixManifest;
    if (held.schemaVersion !== 1 || held.experiment !== 'initial-matrix-calibration'
      || held.protocol?.version !== INITIAL_MATRIX_CALIBRATION_VERSION
      || held.protocol.strategyCount !== INITIAL_MATRIX_STRATEGIES
      || held.strategies?.length !== INITIAL_MATRIX_STRATEGIES
      || new Set(held.strategies.map((strategy) => strategy.id)).size !== INITIAL_MATRIX_STRATEGIES
      || held.protocol.gamesPerSeed !== GAMES_PER_SEED || held.protocol.startingDraftEnabled !== false
      || held.protocol.earlyStopping !== false || held.protocol.maxSeedCount !== held.protocol.seeds?.length
      || held.protocol.chunkSize < 1 || held.protocol.chunkSize > 25
      || held.protocol.rulesFingerprint !== nativeRuleFingerprint(held.protocol.kingdomId, 30, 200)
      || held.protocol.source.ruleFingerprint !== held.protocol.rulesFingerprint
      || !exact(held.protocol.seeds, initialMatrixCalibrationSeeds(held.protocol.source, held.protocol.maxSeedCount))
      || held.evidenceHash !== unsignedHash(held)) return false;
    return !expected || exact(held, expected);
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
  if (!row || !column || input.rowIndex >= input.columnIndex || !input.records.length
    || input.records.length > input.manifest.protocol.chunkSize) throw new Error('Initial-matrix chunk bounds are invalid.');
  const base = {
    schemaVersion: 1 as const, experiment: 'initial-matrix-calibration-pair-chunk' as const,
    version: INITIAL_MATRIX_CALIBRATION_VERSION, manifestHash: input.manifest.evidenceHash,
    rowIndex: input.rowIndex, columnIndex: input.columnIndex, rowId: row.id, columnId: column.id,
    rowCanonical: canonicalStrategy(row), columnCanonical: canonicalStrategy(column),
    startSeedIndex: input.startSeedIndex, records: input.records.map((record) => structuredClone(record)),
    matches: input.records.length * GAMES_PER_SEED, simulationMs: input.simulationMs
  };
  const artifact = { ...base, evidenceHash: hash({ ...base, simulationMs: 0 }) };
  if (!validateInitialMatrixChunk(artifact, input.manifest, input.rowIndex, input.columnIndex,
    input.startSeedIndex, input.records.length)) throw new Error('Initial-matrix chunk evidence is invalid.');
  return artifact;
}

export function validateInitialMatrixChunk(
  value: unknown, manifest: InitialMatrixManifest, rowIndex: number, columnIndex: number,
  startSeedIndex: number, count: number
): value is InitialMatrixChunk {
  try {
    if (!validateInitialMatrixManifest(manifest) || !value || typeof value !== 'object') return false;
    const held = value as InitialMatrixChunk;
    const row = manifest.strategies[rowIndex], column = manifest.strategies[columnIndex];
    const expectedSeeds = manifest.protocol.seeds.slice(startSeedIndex, startSeedIndex + count);
    if (!row || !column || rowIndex >= columnIndex || count < 1 || count > manifest.protocol.chunkSize
      || startSeedIndex % manifest.protocol.chunkSize !== 0 || startSeedIndex + count > manifest.protocol.maxSeedCount
      || held.schemaVersion !== 1 || held.experiment !== 'initial-matrix-calibration-pair-chunk'
      || held.version !== INITIAL_MATRIX_CALIBRATION_VERSION || held.manifestHash !== manifest.evidenceHash
      || held.rowIndex !== rowIndex || held.columnIndex !== columnIndex || held.rowId !== row.id
      || held.columnId !== column.id || held.rowCanonical !== canonicalStrategy(row)
      || held.columnCanonical !== canonicalStrategy(column) || held.startSeedIndex !== startSeedIndex
      || held.records?.length !== count || held.matches !== count * GAMES_PER_SEED
      || !Number.isFinite(held.simulationMs) || held.simulationMs < 0
      || !exact(held.records.map((record) => record.seed), expectedSeeds)) return false;
    for (const record of held.records) {
      if (!Number.isFinite(record.score) || record.score < 0 || record.score > 1
        || record.played !== GAMES_PER_SEED || record.aborted !== 0 || record.matches !== GAMES_PER_SEED
        || !validateTelemetryAggregate(record.telemetry, GAMES_PER_SEED)
        || !record.telemetry.acquisitionsByStrategy[row.id]
        || !record.telemetry.acquisitionsByStrategy[column.id]) return false;
    }
    const copy = structuredClone(held);
    copy.simulationMs = 0;
    return held.evidenceHash === unsignedHash(copy);
  } catch { return false; }
}

export interface InitialMatrixPairSeries {
  rowIndex: number;
  columnIndex: number;
  records: InitialMatrixSeedRecord[];
}

export interface InitialMatrixAcquisitionSummary {
  basis: 'per-strategy averages over distinct matrix opponents; equilibrium weights apply across row strategies';
  strategyAcquisitionRates: Record<string, Record<string, number>>;
  strategyLabels: Record<string, string>;
  selectedArchetypeShares: Record<string, number>;
  equilibriumWeightedExpectedCopiesPerPlayerGame: Record<string, number>;
}

export interface InitialMatrixPrefixAnalysis {
  seedCount: number;
  games: number;
  equilibrium: EquilibriumResult;
  heldOutRestrictedExploitability: { centeredAdvantage: number; score: number; strategyId: string };
  heldOutDirectStrength: { centeredPayoff: number; score: number; opponent: 'held-out restricted equilibrium' };
  acquisitions: InitialMatrixAcquisitionSummary;
}

export interface InitialMatrixAnalysisReport {
  requestedPrefixes: number[];
  heldOut: { startSeedIndex: number; seedCount: number; games: number; equilibrium: EquilibriumResult;
    acquisitions: InitialMatrixAcquisitionSummary };
  prefixes: InitialMatrixPrefixAnalysis[];
  exactGameCount: number;
  simulationMs: number;
  solverMs: number;
  telemetryAvailability: {
    offDiagonalSeedPayoffs: 'available';
    offDiagonalAcquisitions: 'available';
    diagonalSelfPlay: 'unavailable: the matrix evaluates unordered distinct-strategy pairs only';
  };
}

function validateSeries(strategies: readonly Strategy[], pairs: readonly InitialMatrixPairSeries[], seedCount: number): void {
  const expected = strategies.length * (strategies.length - 1) / 2;
  if (strategies.length < 2 || pairs.length !== expected) throw new Error('Initial-matrix pair series is incomplete.');
  const seen = new Set<string>();
  for (const pair of pairs) {
    const id = `${pair.rowIndex}:${pair.columnIndex}`;
    if (pair.rowIndex < 0 || pair.rowIndex >= pair.columnIndex || pair.columnIndex >= strategies.length
      || seen.has(id) || pair.records.length !== seedCount
      || pair.records.some((record) => record.played !== GAMES_PER_SEED || record.matches !== GAMES_PER_SEED
        || record.aborted !== 0 || !validateTelemetryAggregate(record.telemetry, GAMES_PER_SEED))) {
      throw new Error('Initial-matrix pair series is invalid.');
    }
    seen.add(id);
  }
}

function rangeEvidence(
  strategies: readonly Strategy[], pairs: readonly InitialMatrixPairSeries[], start: number, end: number
): { matrix: number[][]; telemetry: TelemetryAggregate; games: number } {
  const matrix = strategies.map(() => strategies.map(() => 0));
  const telemetry = emptyAggregate();
  let games = 0;
  for (const pair of pairs) {
    const records = pair.records.slice(start, end);
    const played = records.reduce((sum, record) => sum + record.played, 0);
    const score = records.reduce((sum, record) => sum + record.score * record.played, 0);
    const centered = played ? 2 * score / played - 1 : 0;
    matrix[pair.rowIndex]![pair.columnIndex] = centered;
    matrix[pair.columnIndex]![pair.rowIndex] = -centered;
    for (const record of records) mergeAggregate(telemetry, record.telemetry);
    games += records.reduce((sum, record) => sum + record.matches, 0);
  }
  return { matrix, telemetry, games };
}

function acquisitionSummary(
  strategies: readonly Strategy[], telemetry: TelemetryAggregate, gamesPerStrategy: number,
  equilibrium: EquilibriumResult
): InitialMatrixAcquisitionSummary {
  const strategyAcquisitionRates: Record<string, Record<string, number>> = {};
  const strategyLabels: Record<string, string> = {};
  const equilibriumWeightedExpectedCopiesPerPlayerGame: Record<string, number> = {};
  for (const strategy of strategies) {
    const rates = Object.fromEntries(Object.entries(telemetry.acquisitionsByStrategy[strategy.id] ?? {})
      .map(([cardId, amount]) => [cardId, gamesPerStrategy ? amount / gamesPerStrategy : 0]));
    strategyAcquisitionRates[strategy.id] = rates;
    strategyLabels[strategy.id] = classifyStrategyDamage({ startingBuild: strategy.startingBuild,
      acquisitionRates: rates });
    const weight = equilibrium.weights[strategy.id] ?? 0;
    for (const [cardId, rate] of Object.entries(rates)) {
      equilibriumWeightedExpectedCopiesPerPlayerGame[cardId] =
        (equilibriumWeightedExpectedCopiesPerPlayerGame[cardId] ?? 0) + weight * rate;
    }
  }
  const selectedArchetypeShares: Record<string, number> = {};
  for (const strategy of strategies) {
    const label = strategyLabels[strategy.id]!;
    selectedArchetypeShares[label] = (selectedArchetypeShares[label] ?? 0)
      + (equilibrium.weights[strategy.id] ?? 0);
  }
  return { basis: 'per-strategy averages over distinct matrix opponents; equilibrium weights apply across row strategies',
    strategyAcquisitionRates, strategyLabels, selectedArchetypeShares,
    equilibriumWeightedExpectedCopiesPerPlayerGame };
}

function weightedPayoff(
  ids: readonly string[], left: EquilibriumResult, matrix: readonly (readonly number[])[], right: EquilibriumResult
): number {
  return ids.reduce((sum, rowId, row) => sum + (left.weights[rowId] ?? 0)
    * ids.reduce((inner, columnId, column) => inner
      + (right.weights[columnId] ?? 0) * matrix[row]![column]!, 0), 0);
}

export function analyzeInitialMatrix(input: {
  strategies: readonly Strategy[];
  pairs: readonly InitialMatrixPairSeries[];
  seedCount: number;
  requestedPrefixes: readonly number[];
  heldOutStartSeedIndex: number;
  simulationMs: number;
}): InitialMatrixAnalysisReport {
  validateSeries(input.strategies, input.pairs, input.seedCount);
  const prefixes = [...input.requestedPrefixes];
  if (!prefixes.length || new Set(prefixes).size !== prefixes.length
    || prefixes.some((count) => !Number.isSafeInteger(count) || count < 1
      || count > input.heldOutStartSeedIndex)
    || !Number.isSafeInteger(input.heldOutStartSeedIndex) || input.heldOutStartSeedIndex < 1
    || input.heldOutStartSeedIndex >= input.seedCount) {
    throw new Error('Training prefixes and held-out boundary must be nonempty and disjoint.');
  }
  prefixes.sort((left, right) => left - right);
  const ids = input.strategies.map((strategy) => strategy.id);
  let solverMs = 0;
  const heldEvidence = rangeEvidence(input.strategies, input.pairs,
    input.heldOutStartSeedIndex, input.seedCount);
  let started = performance.now();
  const heldEquilibrium = solveEquilibrium(ids, heldEvidence.matrix);
  solverMs += performance.now() - started;
  const analyses = prefixes.map((seedCount): InitialMatrixPrefixAnalysis => {
    const evidence = rangeEvidence(input.strategies, input.pairs, 0, seedCount);
    started = performance.now();
    const equilibrium = solveEquilibrium(ids, evidence.matrix);
    solverMs += performance.now() - started;
    const advantages = ids.map((strategyId, row) => ({ strategyId,
      centeredAdvantage: ids.reduce((sum, columnId, column) => sum
        + (equilibrium.weights[columnId] ?? 0) * heldEvidence.matrix[row]![column]!, 0) }));
    advantages.sort((left, right) => right.centeredAdvantage - left.centeredAdvantage
      || left.strategyId.localeCompare(right.strategyId));
    const best = advantages[0]!;
    const direct = weightedPayoff(ids, equilibrium, heldEvidence.matrix, heldEquilibrium);
    const gamesPerStrategy = (input.strategies.length - 1) * seedCount * GAMES_PER_SEED;
    return { seedCount, games: evidence.games, equilibrium,
      heldOutRestrictedExploitability: { centeredAdvantage: best.centeredAdvantage,
        score: (best.centeredAdvantage + 1) / 2, strategyId: best.strategyId },
      heldOutDirectStrength: { centeredPayoff: direct, score: (direct + 1) / 2,
        opponent: 'held-out restricted equilibrium' },
      acquisitions: acquisitionSummary(input.strategies, evidence.telemetry, gamesPerStrategy, equilibrium) };
  });
  const heldOutSeedCount = input.seedCount - input.heldOutStartSeedIndex;
  const heldOutAcquisitions = acquisitionSummary(input.strategies, heldEvidence.telemetry,
    (input.strategies.length - 1) * heldOutSeedCount * GAMES_PER_SEED, heldEquilibrium);
  return { requestedPrefixes: prefixes,
    heldOut: { startSeedIndex: input.heldOutStartSeedIndex,
      seedCount: heldOutSeedCount, games: heldEvidence.games, equilibrium: heldEquilibrium,
      acquisitions: heldOutAcquisitions },
    prefixes: analyses,
    exactGameCount: input.pairs.length * input.seedCount * GAMES_PER_SEED,
    simulationMs: input.simulationMs, solverMs,
    telemetryAvailability: { offDiagonalSeedPayoffs: 'available', offDiagonalAcquisitions: 'available',
      diagonalSelfPlay: 'unavailable: the matrix evaluates unordered distinct-strategy pairs only' } };
}

export function seedRecordFromOutcome(block: SeedEvaluationResult, telemetry: TelemetryAggregate,
  matches: number): InitialMatrixSeedRecord {
  if (block.played !== GAMES_PER_SEED || block.aborted !== 0 || matches !== GAMES_PER_SEED
    || !validateTelemetryAggregate(telemetry, matches)) throw new Error('Initial-matrix seed outcome is invalid.');
  return { seed: block.seed, score: block.score, played: GAMES_PER_SEED, aborted: 0,
    matches: GAMES_PER_SEED, telemetry: structuredClone(telemetry) };
}
