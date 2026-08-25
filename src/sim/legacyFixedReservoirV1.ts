import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import {
  ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER
} from './experimentConfig';
import {
  FIXED_RESERVOIR_CONFIG
} from './fixedReservoirPsro';
import type {
  FixedReservoirProtocol, ReservoirEntry, ReservoirRound
} from './fixedReservoirPsro';
import { matrixProtocol } from './payoffMatrix';
import type { MatrixSnapshot } from './payoffMatrix';
import { RandomPsroSeedLedger } from './randomPsro';
import { rulesFingerprint } from './rulesFingerprint';
import type { RulesFingerprint } from './rulesFingerprint';
import { canonicalStrategy, identify, stableHash } from './strategy';
import { compareUtf16 } from './utf16';

export const LEGACY_FIXED_RESERVOIR_VERSION = 'fixed-reservoir-psro-v1';
export const LEGACY_FIXED_RESERVOIR_EVALUATION_SEED = 7_100_009;
export const LEGACY_FIXED_RESERVOIR_GOLDFISH_SEEDS = [5_200_000, 5_200_001, 5_200_002, 5_200_003] as const;

export interface LegacyFixedReservoirPoolArtifact {
  schemaVersion: 1;
  experiment: 'fixed-reservoir-pool';
  version: typeof LEGACY_FIXED_RESERVOIR_VERSION;
  kingdomId: string;
  poolSeed: number;
  goldfishSeeds: number[];
  generatedCount: number;
  generatedIds: string[];
  generatedHash: string;
  reservoirHash: string;
  reservoir: ReservoirEntry[];
  elapsedMs: number;
}

export interface LegacyFixedReservoirPsroArtifact {
  schemaVersion: 1;
  experiment: 'fixed-reservoir-psro';
  version: typeof LEGACY_FIXED_RESERVOIR_VERSION;
  kingdomId: string;
  poolSeed: number;
  evaluationSeed: number;
  rulesFingerprint: RulesFingerprint;
  poolHash: string;
  reservoirHash: string;
  reservoir: ReservoirEntry[];
  status: 'converged' | 'incomplete';
  stopReason: 'two-clean-full-scans' | 'safety-cap';
  rounds: ReservoirRound[];
  matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult;
  seedNamespaces: Record<string, number[]>;
  elapsedMs: number;
}

export interface LegacyFixedReservoirValidationOptions {
  kingdomId: string;
  poolSeed: number;
  evaluationSeed?: number;
  protocol?: FixedReservoirProtocol;
  goldfishSeeds?: readonly number[];
}

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function near(left: number, right: number, tolerance = 1e-8): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}
function finiteInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

export function legacyGeneratedHash(ids: readonly string[]): string {
  return stableHash(ids.join('\n'));
}
export function legacyReservoirHash(entries: readonly ReservoirEntry[]): string {
  return stableHash(entries.map((entry) => `${entry.source}:${canonicalStrategy(entry.strategy)}`).join('\n'));
}

function reservoirEntryValid(entry: ReservoirEntry, generated: ReadonlySet<string>): boolean {
  return (entry.source === 'goldfish' || entry.source === 'random')
    && finiteInteger(entry.goldfishRank, 1)
    && generated.has(entry.strategy.id)
    && identify({ ...entry.strategy, id: '' }).id === entry.strategy.id
    && Object.values(entry.score).length === 6
    && Object.values(entry.score).every(Number.isFinite);
}

export function validateLegacyFixedReservoirPoolV1(
  value: unknown, options: LegacyFixedReservoirValidationOptions
): value is LegacyFixedReservoirPoolArtifact {
  const protocol = options.protocol ?? FIXED_RESERVOIR_CONFIG;
  const goldfishSeeds = options.goldfishSeeds ?? LEGACY_FIXED_RESERVOIR_GOLDFISH_SEEDS;
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<LegacyFixedReservoirPoolArtifact>;
  if (artifact.schemaVersion !== 1 || artifact.experiment !== 'fixed-reservoir-pool'
    || artifact.version !== LEGACY_FIXED_RESERVOIR_VERSION
    || artifact.kingdomId !== options.kingdomId || artifact.poolSeed !== options.poolSeed
    || artifact.generatedCount !== protocol.generatedCount
    || !Array.isArray(artifact.goldfishSeeds) || !exact(artifact.goldfishSeeds, goldfishSeeds)
    || !Array.isArray(artifact.generatedIds) || artifact.generatedIds.length !== protocol.generatedCount
    || artifact.generatedIds.some((id) => typeof id !== 'string' || !id)
    || legacyGeneratedHash(artifact.generatedIds) !== artifact.generatedHash
    || !Array.isArray(artifact.reservoir)
    || artifact.reservoir.length !== protocol.goldfishCount + protocol.randomCount
    || legacyReservoirHash(artifact.reservoir) !== artifact.reservoirHash
    || !Number.isFinite(artifact.elapsedMs) || artifact.elapsedMs! < 0) return false;
  const generated = new Set(artifact.generatedIds);
  const ids = artifact.reservoir.map((entry) => entry.strategy.id);
  const forms = artifact.reservoir.map((entry) => canonicalStrategy(entry.strategy));
  if (new Set(ids).size !== ids.length || new Set(forms).size !== forms.length
    || artifact.reservoir.some((entry) => !reservoirEntryValid(entry, generated))) return false;
  const goldfish = artifact.reservoir.filter((entry) => entry.source === 'goldfish');
  const random = artifact.reservoir.filter((entry) => entry.source === 'random');
  return goldfish.length === protocol.goldfishCount && random.length === protocol.randomCount
    && goldfish.every((entry, index) => entry.goldfishRank === index + 1)
    && random.every((entry) => entry.goldfishRank <= protocol.generatedCount);
}

function solveSubgame(matrix: MatrixSnapshot, ids: readonly string[]): EquilibriumResult {
  const indexes = ids.map((id) => matrix.strategies.findIndex((strategy) => strategy.id === id));
  if (indexes.some((index) => index < 0)) throw new Error('Legacy matrix is missing a strategy.');
  return solveEquilibrium([...ids], indexes.map((row) => indexes.map((column) =>
    matrix.centeredPayoffs[row]![column]!)));
}

function equilibriumEqual(left: EquilibriumResult, right: EquilibriumResult): boolean {
  if (!exact(left.strategyIds, right.strategyIds) || !near(left.value, right.value)
    || !near(left.maximumKnownAdvantage, right.maximumKnownAdvantage)) return false;
  const ids = right.strategyIds;
  return ids.every((id) => near(left.weights[id] ?? Number.NaN, right.weights[id] ?? Number.NaN, 1e-6)
    && near(left.maximumEquilibriumWeight[id] ?? Number.NaN,
      right.maximumEquilibriumWeight[id] ?? Number.NaN, 1e-6))
    && Object.keys(right.residuals).every((key) => near(
      left.residuals[key as keyof EquilibriumResult['residuals']] ?? Number.NaN,
      right.residuals[key as keyof EquilibriumResult['residuals']] ?? Number.NaN, 1e-6));
}

function finalistValid(entry: ReservoirRound['finalists'][number], blocks: number): boolean {
  return identify({ ...entry.strategy, id: '' }).id === entry.strategy.id
    && Number.isFinite(entry.mean) && entry.mean >= 0 && entry.mean <= 1
    && Number.isFinite(entry.interval95?.lower) && Number.isFinite(entry.interval95?.upper)
    && entry.interval95.lower >= 0 && entry.interval95.upper <= 1
    && entry.interval95.lower <= entry.interval95.upper
    && entry.blocks === blocks && entry.matches === blocks * 4;
}

export function validateLegacyFixedReservoirRunV1(
  value: unknown, pool: LegacyFixedReservoirPoolArtifact,
  options: LegacyFixedReservoirValidationOptions
): value is LegacyFixedReservoirPsroArtifact {
  try {
    const protocol = options.protocol ?? FIXED_RESERVOIR_CONFIG;
    const evaluationSeed = options.evaluationSeed ?? LEGACY_FIXED_RESERVOIR_EVALUATION_SEED;
    if (!value || typeof value !== 'object') return false;
    const artifact = value as LegacyFixedReservoirPsroArtifact;
    const expectedRules = rulesFingerprint(options.kingdomId,
      TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false);
    if (artifact.schemaVersion !== 1 || artifact.experiment !== 'fixed-reservoir-psro'
      || artifact.version !== LEGACY_FIXED_RESERVOIR_VERSION
      || artifact.kingdomId !== options.kingdomId || artifact.poolSeed !== options.poolSeed
      || artifact.evaluationSeed !== evaluationSeed || !exact(artifact.rulesFingerprint, expectedRules)
      || artifact.poolHash !== pool.generatedHash || artifact.reservoirHash !== pool.reservoirHash
      || !exact(artifact.reservoir, pool.reservoir)
      || !Array.isArray(artifact.rounds) || artifact.rounds.length < 1
      || artifact.rounds.length > protocol.safetyCap || !artifact.matrix || !artifact.equilibrium
      || !artifact.seedNamespaces || !Number.isFinite(artifact.elapsedMs) || artifact.elapsedMs < 0) return false;

    const ledger = new RandomPsroSeedLedger(evaluationSeed);
    const matrixSeeds = ledger.reserve('matrix', protocol.matrixBlocks);
    if (!exact(artifact.matrix.protocol, matrixProtocol(options.kingdomId, matrixSeeds,
      TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false)) || !artifact.matrix.complete) return false;
    const matrix = artifact.matrix;
    const strategies = matrix.strategies;
    const ids = strategies.map((strategy) => strategy.id);
    if (new Set(ids).size !== ids.length || !exact(ids, [...ids].sort(compareUtf16))) return false;
    const poolById = new Map(pool.reservoir.map((entry) => [entry.strategy.id, entry.strategy]));
    if (strategies.some((strategy) => !poolById.has(strategy.id)
      || canonicalStrategy(poolById.get(strategy.id)!) !== canonicalStrategy(strategy))) return false;
    if (matrix.centeredPayoffs.length !== strategies.length
      || matrix.centeredPayoffs.some((row) => row.length !== strategies.length)
      || matrix.cells.length !== strategies.length * (strategies.length - 1) / 2) return false;
    const indexById = new Map(strategies.map((strategy, index) => [strategy.id, index]));
    const pairs = new Set<string>();
    for (const cell of matrix.cells) {
      const row = indexById.get(cell.rowId), column = indexById.get(cell.columnId);
      const pair = `${cell.rowId}|${cell.columnId}`;
      if (row === undefined || column === undefined || row >= column || pairs.has(pair)
        || !cell.complete || cell.blocks.length !== protocol.matrixBlocks
        || !exact(cell.blocks.map((block) => block.seed), matrixSeeds)
        || cell.blocks.some((block) => block.played !== 4 || block.aborted !== 0
          || !Number.isFinite(block.score) || block.score < 0 || block.score > 1)
        || cell.matches !== protocol.matrixBlocks * 4) return false;
      pairs.add(pair);
      const centered = 2 * cell.blocks.reduce((sum, block) => sum + block.score, 0) / cell.blocks.length - 1;
      if (!near(cell.centeredPayoff, centered)
        || !near(matrix.centeredPayoffs[row]![column]!, centered)
        || !near(matrix.centeredPayoffs[column]![row]!, -centered)) return false;
    }

    let active = pool.reservoir.filter((entry) => entry.source === 'goldfish')
      .slice(0, protocol.initialStrategies).map((entry) => entry.strategy.id).sort(compareUtf16);
    let cleanStreak = 0;
    const admittedAll = new Set<string>();
    for (let index = 0; index < artifact.rounds.length; index += 1) {
      const round = artifact.rounds[index]!;
      const race = ledger.reserve(`round:${index}:race`, protocol.raceBlocks.reduce((sum, count) => sum + count, 0));
      const confirmation = ledger.reserve(`round:${index}:confirmation`, protocol.confirmationBlocks);
      ledger.reserve(`round:${index}:sampling`, protocol.raceBlocks.length + 1);
      ledger.reserve(`round:${index}:bootstrap`, protocol.finalists);
      const before = solveSubgame(matrix, active);
      if (round.round !== index || round.scannedCount !== pool.reservoir.length - active.length
        || !exact(round.raceSeeds, race) || !exact(round.confirmationSeeds, confirmation)
        || !equilibriumEqual({ ...before, weights: round.targetWeights }, before)
        || round.finalists.length > protocol.finalists) return false;
      const activeSet = new Set(active);
      const finalistIds = new Set<string>();
      for (const finalist of round.finalists) {
        const poolStrategy = poolById.get(finalist.strategy.id);
        if (!finalistValid(finalist, protocol.confirmationBlocks) || !poolStrategy
          || activeSet.has(finalist.strategy.id) || finalistIds.has(finalist.strategy.id)
          || canonicalStrategy(poolStrategy) !== canonicalStrategy(finalist.strategy)) return false;
        finalistIds.add(finalist.strategy.id);
      }
      const admitted = round.finalists.filter((entry) => entry.interval95.lower > protocol.admissionLowerBound)
        .map((entry) => entry.strategy.id);
      if (!exact(round.admittedStrategyIds, admitted)
        || admitted.some((id) => admittedAll.has(id))) return false;
      admitted.forEach((id) => admittedAll.add(id));
      active = [...active, ...admitted].sort(compareUtf16);
      const after = solveSubgame(matrix, active);
      if (!equilibriumEqual(round.equilibriumAfter, after)) return false;
      cleanStreak = admitted.length ? 0 : cleanStreak + 1;
      if (round.cleanStreak !== cleanStreak
        || (cleanStreak >= protocol.cleanScansRequired && index !== artifact.rounds.length - 1)) return false;
    }
    ledger.validate();
    if (!exact(artifact.seedNamespaces, ledger.namespaces)
      || !exact(active, ids) || !equilibriumEqual(artifact.equilibrium, solveSubgame(matrix, active))) return false;
    const converged = cleanStreak >= protocol.cleanScansRequired;
    return artifact.status === (converged ? 'converged' : 'incomplete')
      && artifact.stopReason === (converged ? 'two-clean-full-scans' : 'safety-cap');
  } catch { return false; }
}

export function loadValidatedLegacyFixedReservoirV1(
  poolValue: unknown, runValue: unknown, options: LegacyFixedReservoirValidationOptions
): { pool: LegacyFixedReservoirPoolArtifact; run: LegacyFixedReservoirPsroArtifact } {
  if (!validateLegacyFixedReservoirPoolV1(poolValue, options)) {
    throw new Error(`Historical fixed-reservoir v1 pool ${options.poolSeed} failed deep validation.`);
  }
  if (!validateLegacyFixedReservoirRunV1(runValue, poolValue, options)) {
    throw new Error(`Historical fixed-reservoir v1 run ${options.poolSeed} failed deep validation.`);
  }
  return { pool: poolValue, run: runValue };
}
