import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './experimentConfig';
import {
  ConsistencySeedPlanner, lotterySnapshotHash, raceProtocol, reconstructMatrixCache,
  validateConsistencyMatrix,
  validateConsistencySeedPlan, validateProtocolScan
} from './fixedReservoirConsistency';
import type {
  ConsistencySeedPlan, ProtocolScanEvidence, RaceProtocolDefinition
} from './fixedReservoirConsistency';
import { matrixProtocol } from './payoffMatrix';
import type { MatrixSnapshot } from './payoffMatrix';
import { rulesFingerprint } from './rulesFingerprint';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';
import type { OrderedChallengePoolArtifact } from './orderedReservoirChallenge';
import type {
  LegacyFixedReservoirPoolArtifact
} from './legacyFixedReservoirV1';

export const ORDERED_RESERVOIR_ROBUST_VERSION = 'ordered-reservoir-robust-v1' as const;
export const ORDERED_ROBUST_EVALUATION_SEEDS = Object.freeze([9_100_009, 9_200_009, 9_300_009] as const);
export const ORDERED_ROBUST_WORKERS = 4;
export const ORDERED_ROBUST_INITIAL_STRATEGIES = 50;
export const ORDERED_ROBUST_MATRIX_BLOCKS = 25;
export const ORDERED_ROBUST_ORDINARY_CAP = 32;
export const ORDERED_ROBUST_CLOSURE_CAP = 4;
export const ORDERED_ROBUST_RACE_PROTOCOL = 'closure-union-cumulative-v1' as const;

export type RobustNextPhase = 'ordinary-scan' | 'closure-scan' | 'complete' | 'stopped';
export interface RobustRunState {
  ordinaryScans: number;
  cleanStreak: number;
  closureCycles: number;
  nextPhase: RobustNextPhase;
  status: 'running' | 'complete' | 'incomplete';
  stopReason: 'running' | 'clean-closure' | 'ordinary-safety-cap' | 'closure-cycle-cap';
}
export type RobustStateEvent = { kind: 'ordinary'; admitted: number } | { kind: 'closure'; admitted: number };

export function initialRobustRunState(): RobustRunState {
  return { ordinaryScans: 0, cleanStreak: 0, closureCycles: 0, nextPhase: 'ordinary-scan',
    status: 'running', stopReason: 'running' };
}
export function transitionRobustRunState(
  state: RobustRunState, event: RobustStateEvent,
  caps: { ordinary: number; closure: number } = {
    ordinary: ORDERED_ROBUST_ORDINARY_CAP, closure: ORDERED_ROBUST_CLOSURE_CAP
  }
): RobustRunState {
  if (state.status !== 'running') throw new Error('A terminal robust run cannot transition.');
  if (event.kind === 'ordinary') {
    if (state.nextPhase !== 'ordinary-scan') throw new Error('Ordinary scan is out of order.');
    const ordinaryScans = state.ordinaryScans + 1;
    const cleanStreak = event.admitted ? 0 : state.cleanStreak + 1;
    const nextPhase = cleanStreak >= 2 ? 'closure-scan' : 'ordinary-scan';
    if (ordinaryScans >= caps.ordinary && nextPhase === 'ordinary-scan') {
      return { ...state, ordinaryScans, cleanStreak, nextPhase: 'stopped', status: 'incomplete',
        stopReason: 'ordinary-safety-cap' };
    }
    return { ...state, ordinaryScans, cleanStreak, nextPhase };
  }
  if (state.nextPhase !== 'closure-scan') throw new Error('Closure scan is out of order.');
  if (!event.admitted) return { ...state, nextPhase: 'complete', status: 'complete',
    stopReason: 'clean-closure' };
  const closureCycles = state.closureCycles + 1;
  if (closureCycles >= caps.closure) return { ...state, closureCycles, cleanStreak: 0,
    nextPhase: 'stopped', status: 'incomplete', stopReason: 'closure-cycle-cap' };
  return { ...state, closureCycles, cleanStreak: 0, nextPhase: 'ordinary-scan' };
}

export interface OrderedRobustProtocolDefinition {
  race: RaceProtocolDefinition;
  initialStrategies: number;
  matrixBlocks: number;
  ordinarySafetyCap: number;
  closureCycleCap: number;
  startingDraftEnabled: false;
  startingHealth: 50;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  scoreOnlyRace: true;
  workers: 4;
}
export function orderedRobustProtocolDefinition(input: {
  initialStrategies?: number; matrixBlocks?: number;
  ordinarySafetyCap?: number; closureCycleCap?: number;
} = {}): OrderedRobustProtocolDefinition {
  return { race: { ...raceProtocol(ORDERED_ROBUST_RACE_PROTOCOL),
    stageBlocks: [...raceProtocol(ORDERED_ROBUST_RACE_PROTOCOL).stageBlocks] },
    initialStrategies: input.initialStrategies ?? ORDERED_ROBUST_INITIAL_STRATEGIES,
    matrixBlocks: input.matrixBlocks ?? ORDERED_ROBUST_MATRIX_BLOCKS,
    ordinarySafetyCap: input.ordinarySafetyCap ?? ORDERED_ROBUST_ORDINARY_CAP,
    closureCycleCap: input.closureCycleCap ?? ORDERED_ROBUST_CLOSURE_CAP,
    startingDraftEnabled: false, startingHealth: 50,
    turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN,
    scoreOnlyRace: true, workers: ORDERED_ROBUST_WORKERS };
}

export interface RobustScanRecord {
  kind: 'ordinary' | 'closure';
  ordinal: number;
  closureCycle: number;
  scan: ProtocolScanEvidence;
}
export interface RobustAdmission {
  kind: 'ordinary' | 'closure';
  scanIndex: number;
  strategyIds: string[];
}
export interface OrderedRobustCheckpoint {
  schemaVersion: 1;
  experiment: 'ordered-reservoir-robust-checkpoint';
  version: typeof ORDERED_RESERVOIR_ROBUST_VERSION;
  kingdomId: string;
  poolHash: string;
  reservoirHash: string;
  sourceRankedSha256: string;
  rulesFingerprint: ReturnType<typeof rulesFingerprint>;
  evaluationSeed: number;
  protocol: OrderedRobustProtocolDefinition;
  initialStrategyIds: string[];
  seedPlan: ConsistencySeedPlan;
  records: RobustScanRecord[];
  admissions: RobustAdmission[];
  matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult;
  state: RobustRunState;
  elapsedMs: number;
  evidenceHash: string;
}

function exact(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function checkpointHash(value: Omit<OrderedRobustCheckpoint, 'evidenceHash' | 'elapsedMs'>): string {
  return stableHash(JSON.stringify(value));
}
export function createOrderedRobustCheckpoint(
  input: Omit<OrderedRobustCheckpoint, 'schemaVersion' | 'experiment' | 'version' | 'evidenceHash'>
): OrderedRobustCheckpoint {
  const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-robust-checkpoint' as const,
    version: ORDERED_RESERVOIR_ROBUST_VERSION, ...input };
  const held = structuredClone(base) as Partial<typeof base>; delete held.elapsedMs;
  return { ...base, evidenceHash: checkpointHash(
    held as Omit<OrderedRobustCheckpoint, 'evidenceHash' | 'elapsedMs'>) };
}

function subgame(matrix: MatrixSnapshot, activeIds: readonly string[]): MatrixSnapshot {
  const active = new Set(activeIds);
  const indexes = matrix.strategies.flatMap((strategy, index) => active.has(strategy.id) ? [index] : []);
  if (indexes.length !== active.size) throw new Error('Robust checkpoint matrix is missing an active strategy.');
  return { protocol: matrix.protocol, strategies: indexes.map((index) => matrix.strategies[index]!),
    cells: matrix.cells.filter((cell) => active.has(cell.rowId) && active.has(cell.columnId)), complete: true,
    centeredPayoffs: indexes.map((row) => indexes.map((column) => matrix.centeredPayoffs[row]![column]!)) };
}
function solve(snapshot: MatrixSnapshot): EquilibriumResult {
  return solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
}
function sameEquilibrium(left: EquilibriumResult, right: EquilibriumResult): boolean {
  return exact(left.strategyIds, right.strategyIds)
    && left.strategyIds.every((id) => Math.abs((left.weights[id] ?? 0) - (right.weights[id] ?? 0)) <= 1e-6
      && Math.abs((left.maximumEquilibriumWeight[id] ?? 0) - (right.maximumEquilibriumWeight[id] ?? 0)) <= 1e-6)
    && Math.abs(left.value - right.value) <= 1e-7
    && Math.abs(left.maximumKnownAdvantage - right.maximumKnownAdvantage) <= 1e-6;
}
function expectedCandidates(pool: OrderedChallengePoolArtifact, activeIds: readonly string[]): Strategy[] {
  const active = new Set(activeIds);
  return pool.reservoir.filter((entry) => !active.has(entry.strategy.id)).map((entry) => entry.strategy);
}

export interface RobustValidationOptions {
  caps?: { ordinary: number; closure: number };
  initialStrategies?: number;
  matrixBlocks?: number;
  evaluationSeeds?: readonly number[];
}
export function validateOrderedRobustCheckpoint(
  value: unknown, pool: OrderedChallengePoolArtifact, options: RobustValidationOptions = {}
): value is OrderedRobustCheckpoint {
  try {
    const caps = options.caps ?? { ordinary: ORDERED_ROBUST_ORDINARY_CAP,
      closure: ORDERED_ROBUST_CLOSURE_CAP };
    const initialStrategies = options.initialStrategies ?? ORDERED_ROBUST_INITIAL_STRATEGIES;
    const matrixBlocks = options.matrixBlocks ?? ORDERED_ROBUST_MATRIX_BLOCKS;
    const evaluationSeeds = options.evaluationSeeds ?? ORDERED_ROBUST_EVALUATION_SEEDS;
    const expectedProtocol = orderedRobustProtocolDefinition({ initialStrategies, matrixBlocks,
      ordinarySafetyCap: caps.ordinary, closureCycleCap: caps.closure });
    if (!value || typeof value !== 'object') return false;
    const checkpoint = value as OrderedRobustCheckpoint;
    const expectedRules = rulesFingerprint(pool.kingdomId, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false);
    if (checkpoint.schemaVersion !== 1 || checkpoint.experiment !== 'ordered-reservoir-robust-checkpoint'
      || checkpoint.version !== ORDERED_RESERVOIR_ROBUST_VERSION || checkpoint.kingdomId !== pool.kingdomId
      || checkpoint.poolHash !== pool.generatedHash || checkpoint.reservoirHash !== pool.reservoirHash
      || checkpoint.sourceRankedSha256 !== pool.source.rankedSha256
      || !evaluationSeeds.includes(checkpoint.evaluationSeed)
      || !exact(checkpoint.protocol, expectedProtocol)
      || !exact(checkpoint.rulesFingerprint, expectedRules) || !Array.isArray(checkpoint.records)
      || !Array.isArray(checkpoint.admissions) || !validateConsistencyMatrix(checkpoint.matrix)
      || !Number.isFinite(checkpoint.elapsedMs) || checkpoint.elapsedMs < 0) return false;
    const planner = new ConsistencySeedPlanner(pool.reservoirHash, checkpoint.evaluationSeed);
    const matrixSeeds = planner.derive('search', 'robust:matrix', matrixBlocks);
    if (!exact(checkpoint.matrix.protocol, matrixProtocol(pool.kingdomId, matrixSeeds,
      TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false))) return false;
    const initial = pool.reservoir.slice(0, initialStrategies).map((entry) => entry.strategy.id);
    if (!exact(checkpoint.initialStrategyIds, initial)) return false;
    const poolById = new Map(pool.reservoir.map((entry) => [entry.strategy.id, entry.strategy]));
    if (checkpoint.matrix.strategies.some((strategy) => {
      const held = poolById.get(strategy.id);
      return !held || canonicalStrategy(held) !== canonicalStrategy(strategy);
    })) return false;
    let state = initialRobustRunState();
    let active = [...initial];
    const admissions: RobustAdmission[] = [];
    for (let index = 0; index < checkpoint.records.length; index += 1) {
      const record = checkpoint.records[index]!;
      if ((state.nextPhase === 'ordinary-scan' && record.kind !== 'ordinary')
        || (state.nextPhase === 'closure-scan' && record.kind !== 'closure')
        || record.ordinal !== (record.kind === 'ordinary' ? state.ordinaryScans : state.closureCycles)
        || record.closureCycle !== state.closureCycles) return false;
      const held = subgame(checkpoint.matrix, active), equilibrium = solve(held);
      const candidates = expectedCandidates(pool, active);
      const phase = record.kind === 'ordinary' ? 'search' as const : 'selected-closure' as const;
      const namespace = record.kind === 'ordinary'
        ? `robust:ordinary:${state.ordinaryScans}` : `robust:closure:${state.closureCycles}`;
      if (record.scan.phase !== phase || record.scan.namespace !== namespace
        || record.scan.protocol.id !== ORDERED_ROBUST_RACE_PROTOCOL
        || !exact(record.scan.enteredStrategyIds, candidates.map((strategy) => strategy.id))
        || !validateProtocolScan(record.scan, held, equilibrium, planner)) return false;
      const admitted = record.scan.admittedStrategyIds;
      if (admitted.some((id) => active.includes(id) || !poolById.has(id))) return false;
      if (admitted.length) admissions.push({ kind: record.kind, scanIndex: index, strategyIds: [...admitted] });
      active = [...active, ...admitted].sort(compareUtf16);
      state = transitionRobustRunState(state, { kind: record.kind, admitted: admitted.length }, caps);
      if (state.status !== 'running' && index !== checkpoint.records.length - 1) return false;
    }
    if (!exact(admissions, checkpoint.admissions) || !exact(state, checkpoint.state)
      || !exact([...active].sort(compareUtf16), checkpoint.matrix.strategies.map((entry) => entry.id).sort(compareUtf16))
      || !sameEquilibrium(checkpoint.equilibrium, solve(checkpoint.matrix))
      || !validateConsistencySeedPlan(checkpoint.seedPlan)
      || !exact(checkpoint.seedPlan, planner.plan)) return false;
    const copy = structuredClone(checkpoint) as Partial<OrderedRobustCheckpoint>;
    delete copy.evidenceHash; delete copy.elapsedMs;
    return checkpoint.evidenceHash === checkpointHash(
      copy as Omit<OrderedRobustCheckpoint, 'evidenceHash' | 'elapsedMs'>);
  } catch { return false; }
}

export interface HistoricalAuditArtifact {
  schemaVersion: 1;
  experiment: 'ordered-reservoir-historical-audit';
  version: typeof ORDERED_RESERVOIR_ROBUST_VERSION;
  targetEvaluationSeed: number;
  targetCheckpointHash: string;
  targetSnapshotHash: string;
  historicalPoolSeed: number;
  historicalReservoirHash: string;
  seedPlan: ConsistencySeedPlan;
  scan: ProtocolScanEvidence;
  confirmedStrategyIds: string[];
  strongestStrategyId: string | null;
  elapsedMs: number;
  evidenceHash: string;
}
function auditHash(value: Omit<HistoricalAuditArtifact, 'evidenceHash' | 'elapsedMs'>): string {
  return stableHash(JSON.stringify(value));
}
export function createHistoricalAuditArtifact(
  input: Omit<HistoricalAuditArtifact, 'schemaVersion' | 'experiment' | 'version' | 'evidenceHash'>
): HistoricalAuditArtifact {
  const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-historical-audit' as const,
    version: ORDERED_RESERVOIR_ROBUST_VERSION, ...input };
  const copy = structuredClone(base) as Partial<typeof base>; delete copy.elapsedMs;
  return { ...base, evidenceHash: auditHash(
    copy as Omit<HistoricalAuditArtifact, 'evidenceHash' | 'elapsedMs'>) };
}
export function historicalAuditCandidates(
  pool: LegacyFixedReservoirPoolArtifact, target: OrderedRobustCheckpoint
): Strategy[] {
  const active = new Set(target.matrix.strategies.map((strategy) => strategy.id));
  return pool.reservoir.filter((entry) => !active.has(entry.strategy.id)).map((entry) => entry.strategy);
}
export function validateHistoricalAuditArtifact(
  value: unknown, historicalPool: LegacyFixedReservoirPoolArtifact,
  target: OrderedRobustCheckpoint
): value is HistoricalAuditArtifact {
  try {
    if (!value || typeof value !== 'object') return false;
    const audit = value as HistoricalAuditArtifact;
    if (audit.schemaVersion !== 1 || audit.experiment !== 'ordered-reservoir-historical-audit'
      || audit.version !== ORDERED_RESERVOIR_ROBUST_VERSION
      || target.state.status !== 'complete' || audit.targetEvaluationSeed !== target.evaluationSeed
      || audit.targetCheckpointHash !== target.evidenceHash
      || audit.targetSnapshotHash !== lotterySnapshotHash(target.matrix, target.equilibrium)
      || audit.historicalPoolSeed !== historicalPool.poolSeed
      || audit.historicalReservoirHash !== historicalPool.reservoirHash
      || audit.scan.phase !== 'baseline-audit'
      || audit.scan.namespace !== `robust:audit:historical:${historicalPool.poolSeed}`
      || audit.scan.protocol.id !== ORDERED_ROBUST_RACE_PROTOCOL
      || !Number.isFinite(audit.elapsedMs) || audit.elapsedMs < 0) return false;
    const candidates = historicalAuditCandidates(historicalPool, target);
    const planner = new ConsistencySeedPlanner(target.reservoirHash, target.evaluationSeed);
    if (!exact(audit.scan.enteredStrategyIds, candidates.map((strategy) => strategy.id))
      || !validateProtocolScan(audit.scan, target.matrix, target.equilibrium, planner)
      || !exact(audit.seedPlan, planner.plan)) return false;
    const confirmed = audit.scan.finalists.filter((entry) => entry.admitted).map((entry) => entry.strategy.id);
    const strongest = audit.scan.finalists.filter((entry) => entry.admitted).sort((left, right) =>
      right.interval95.lower - left.interval95.lower || right.mean - left.mean
      || compareUtf16(left.strategy.id, right.strategy.id))[0]?.strategy.id ?? null;
    if (!exact(audit.confirmedStrategyIds, confirmed) || audit.strongestStrategyId !== strongest
      || audit.scan.admittedStrategyIds.some((id) => target.matrix.strategies.some((entry) => entry.id === id))) return false;
    const copy = structuredClone(audit) as Partial<HistoricalAuditArtifact>;
    delete copy.evidenceHash; delete copy.elapsedMs;
    return audit.evidenceHash === auditHash(copy as Omit<HistoricalAuditArtifact, 'evidenceHash' | 'elapsedMs'>);
  } catch { return false; }
}

export function reconstructRobustMatrixCache(checkpoint: OrderedRobustCheckpoint) {
  return reconstructMatrixCache(checkpoint.matrix);
}
