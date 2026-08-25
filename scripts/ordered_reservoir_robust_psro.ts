import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { solveEquilibrium } from '../src/sim/equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import {
  ConsistencySeedPlanner, lotterySnapshotHash, lotteryTotalVariation,
  pairingScoreAllocation, raceProtocol, runProtocolScan, supportIdentity, supportJaccard
} from '../src/sim/fixedReservoirConsistency';
import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean } from '../src/sim/mixtureEvaluation';
import { createMatrixCellCache, matrixProtocol, PayoffMatrix } from '../src/sim/payoffMatrix';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import {
  ORDERED_RESERVOIR_HISTORICAL_ROOT, ORDERED_RESERVOIR_HISTORICAL_SEEDS,
  ORDERED_RESERVOIR_RUN_ID, ORDERED_RESERVOIR_SOURCE, adaptValidatedOrderedReservoir,
  validateOrderedChallengePool
} from '../src/sim/orderedReservoirChallenge';
import type {
  OrderedChallengePoolArtifact, OrderedRankedManifestHeader
} from '../src/sim/orderedReservoirChallenge';
import {
  ORDERED_RESERVOIR_ROBUST_VERSION, ORDERED_ROBUST_CLOSURE_CAP,
  ORDERED_ROBUST_EVALUATION_SEEDS, ORDERED_ROBUST_INITIAL_STRATEGIES,
  ORDERED_ROBUST_MATRIX_BLOCKS, ORDERED_ROBUST_ORDINARY_CAP,
  ORDERED_ROBUST_RACE_PROTOCOL, ORDERED_ROBUST_WORKERS,
  createHistoricalAuditArtifact, createOrderedRobustCheckpoint,
  historicalAuditCandidates, initialRobustRunState, orderedRobustProtocolDefinition,
  reconstructRobustMatrixCache,
  transitionRobustRunState, validateHistoricalAuditArtifact, validateOrderedRobustCheckpoint
} from '../src/sim/orderedReservoirRobustPsro';
import type {
  HistoricalAuditArtifact, OrderedRobustCheckpoint, RobustAdmission, RobustScanRecord
} from '../src/sim/orderedReservoirRobustPsro';
import type { OrderedProductReservoirArtifact } from '../src/sim/orderedGoldfishProduct';
import {
  diagnoseOrderedCandidateMembership, lookupSplitRankedStrategies, nearestOrderedAnalogs,
  strategyMechanicSummary
} from '../src/sim/orderedStrategyDiagnostics';
import type { RankedLookup } from '../src/sim/orderedStrategyDiagnostics';
import {
  validateLegacyFixedReservoirPoolV1
} from '../src/sim/legacyFixedReservoirV1';
import type { LegacyFixedReservoirPoolArtifact } from '../src/sim/legacyFixedReservoirV1';
import { rulesFingerprint } from '../src/sim/rulesFingerprint';
import { canonicalStrategy, stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';

const ROOT = path.join('.experiments', 'ordered-reservoir-robust-psro', ORDERED_RESERVOIR_ROBUST_VERSION);
const POOL_FILE = path.join(ROOT, 'pool.json');
const DIAGNOSTICS_FILE = path.join(ROOT, 'historical-attacker-diagnostics.json');
const REPORT_JSON = path.join(ROOT, 'report.json');
const REPORT_MD = path.join(ROOT, 'report.md');
const UNIT_TIMEOUT_MS = 30 * 60_000;
const CLOSURE_TIMEOUT_MS = 20 * 60_000;
const KINGDOM_ID = 'deep-beam-tuning-009';

interface DirectAnalogEvidence {
  targetEvaluationSeed: number;
  targetSnapshotHash: string;
  historicalPoolSeed: number;
  attackerStrategyId: string;
  strategy: Strategy;
  namespace: string;
  seedPlan: ConsistencySeedPlanner['plan'];
  schedule: ReturnType<typeof mixtureSchedule>;
  bootstrapSeed: number;
  blockScores: number[];
  mean: number;
  interval95: { lower: number; upper: number };
  matches: number;
}
interface AttackerDiagnostic {
  targetEvaluationSeed: number;
  historicalPoolSeed: number;
  attacker: Strategy;
  attackMean: number;
  attackInterval95: { lower: number; upper: number };
  plan: ReturnType<typeof strategyMechanicSummary>;
  membership: ReturnType<typeof diagnoseOrderedCandidateMembership>;
  exactRanked: RankedLookup | null;
  analogs: Array<{ strategy: Strategy; changes: string[]; ranked: RankedLookup | null }>;
  selectedAnalog: Strategy;
  selectedAnalogRanked: RankedLookup | null;
  directEvidence: DirectAnalogEvidence;
}
interface DiagnosticsArtifact {
  schemaVersion: 1;
  experiment: 'ordered-reservoir-historical-attacker-diagnostics';
  version: typeof ORDERED_RESERVOIR_ROBUST_VERSION;
  sourceRunId: string;
  status: 'running' | 'complete';
  entries: AttackerDiagnostic[];
  elapsedMs: number;
  evidenceHash: string;
}

function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file);
}
function sha256Text(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function sha256File(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sourceFile(name: string): string { return path.join(ORDERED_RESERVOIR_SOURCE, name); }
function diagnosticsHash(value: Omit<DiagnosticsArtifact, 'evidenceHash' | 'elapsedMs'>): string {
  return stableHash(JSON.stringify(value));
}
function createDiagnosticsArtifact(
  status: DiagnosticsArtifact['status'], entries: AttackerDiagnostic[], elapsedMs: number
): DiagnosticsArtifact {
  const base = { schemaVersion: 1 as const,
    experiment: 'ordered-reservoir-historical-attacker-diagnostics' as const,
    version: ORDERED_RESERVOIR_ROBUST_VERSION, sourceRunId: ORDERED_RESERVOIR_RUN_ID,
    status, entries, elapsedMs };
  const held = structuredClone(base) as Partial<typeof base>; delete held.elapsedMs;
  return { ...base, evidenceHash: diagnosticsHash(
    held as Omit<DiagnosticsArtifact, 'evidenceHash' | 'elapsedMs'>) };
}
function runFile(seed: number): string { return path.join(ROOT, 'runs', `evaluation-${seed}.json`); }
function auditFile(evaluationSeed: number, poolSeed: number): string {
  return path.join(ROOT, 'audits', `evaluation-${evaluationSeed}`, `historical-${poolSeed}.json`);
}
function historicalPoolFile(seed: number): string {
  return path.join(ORDERED_RESERVOIR_HISTORICAL_ROOT, `pool-${seed}.json`);
}
function commandPolicy(command: string): void {
  const record = { command, workers: ORDERED_ROBUST_WORKERS, ordinarySafetyCap: ORDERED_ROBUST_ORDINARY_CAP,
    closureCycleCap: ORDERED_ROBUST_CLOSURE_CAP, ordinaryUnitTimeoutMs: UNIT_TIMEOUT_MS,
    closureUnitTimeoutMs: CLOSURE_TIMEOUT_MS, externalCostUsd: 0, modal: false,
    recordedAt: new Date().toISOString() };
  console.log(JSON.stringify(record)); fs.mkdirSync(ROOT, { recursive: true });
  fs.appendFileSync(path.join(ROOT, 'command-log.ndjson'), `${JSON.stringify(record)}\n`);
}
function kingdom() {
  const held = deepBeamSuite.kingdoms.find((entry) => entry.id === KINGDOM_ID);
  if (!held || held.startingHealth !== 50) throw new Error('The 50-health Kingdom 009 definition is missing.');
  registerKingdom(held); return held;
}
function validateOrderedSource(): void {
  for (const name of ['ranked.json', 'reservoir.json']) if (!fs.existsSync(sourceFile(name))) {
    throw new Error(`Missing corrected ordered source ${sourceFile(name)}.`);
  }
  const result = spawnSync('npm', ['run', 'goldfish:ordered-product', '--', 'validate-reservoir',
    '--artifact', sourceFile('ranked.json'), '--reservoir', sourceFile('reservoir.json')],
  { cwd: process.cwd(), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Ordered-product source validation failed.');
}
function loadOrPreparePool(): OrderedChallengePoolArtifact {
  if (fs.existsSync(POOL_FILE)) {
    const held = readJson<unknown>(POOL_FILE);
    if (validateOrderedChallengePool(held)
      && held.source.rankedSha256 === sha256File(sourceFile('ranked.json'))
      && held.source.reservoirSha256 === sha256File(sourceFile('reservoir.json'))) return held;
  }
  validateOrderedSource();
  const ranked = fs.readFileSync(sourceFile('ranked.json'), 'utf8');
  const reservoir = fs.readFileSync(sourceFile('reservoir.json'), 'utf8');
  const pool = adaptValidatedOrderedReservoir({ manifest: JSON.parse(ranked) as OrderedRankedManifestHeader,
    reservoir: JSON.parse(reservoir) as OrderedProductReservoirArtifact,
    rankedSha256: sha256Text(ranked), reservoirSha256: sha256Text(reservoir) });
  writeAtomic(POOL_FILE, pool); return pool;
}
function loadHistoricalPool(seed: number): LegacyFixedReservoirPoolArtifact {
  const file = historicalPoolFile(seed);
  if (!fs.existsSync(file)) throw new Error(`Missing historical pool ${seed}.`);
  const value = readJson<unknown>(file);
  if (!validateLegacyFixedReservoirPoolV1(value, { kingdomId: KINGDOM_ID, poolSeed: seed })) {
    throw new Error(`Historical pool ${seed} failed read-only v1 validation.`);
  }
  return value;
}
function solve(matrix: ReturnType<PayoffMatrix['snapshot']>) {
  return solveEquilibrium(matrix.strategies.map((strategy) => strategy.id), matrix.centeredPayoffs);
}
function restorePlanner(plan: ConsistencySeedPlanner['plan']): ConsistencySeedPlanner {
  const planner = new ConsistencySeedPlanner(plan.reservoirHash, plan.evaluationSeed);
  for (const namespace of plan.namespaces) {
    const colon = namespace.label.indexOf(':');
    const phase = namespace.label.slice(0, colon) as Parameters<ConsistencySeedPlanner['derive']>[0];
    const label = namespace.label.slice(colon + 1);
    if (planner.derive(phase, label, namespace.seeds.length).join('|') !== namespace.seeds.join('|')) {
      throw new Error(`Saved seed namespace changed: ${namespace.label}`);
    }
  }
  return planner;
}
async function runOrderedSeed(
  pool: OrderedChallengePoolArtifact, evaluationSeed: number,
  runner: WorkerPairingRunner
): Promise<OrderedRobustCheckpoint> {
  const file = runFile(evaluationSeed);
  let checkpoint: OrderedRobustCheckpoint | null = null;
  if (fs.existsSync(file)) {
    const held = readJson<unknown>(file);
    if (validateOrderedRobustCheckpoint(held, pool)) checkpoint = held;
  }
  let planner: ConsistencySeedPlanner;
  let matrix: PayoffMatrix;
  const started = performance.now();
  if (checkpoint) {
    if (checkpoint.state.status !== 'running') return checkpoint;
    planner = restorePlanner(checkpoint.seedPlan);
    matrix = new PayoffMatrix(checkpoint.matrix.protocol, runner, reconstructRobustMatrixCache(checkpoint));
    checkpoint.matrix.strategies.forEach((strategy) => matrix.addStrategy(strategy));
  } else {
    planner = new ConsistencySeedPlanner(pool.reservoirHash, evaluationSeed);
    const matrixSeeds = planner.derive('search', 'robust:matrix', ORDERED_ROBUST_MATRIX_BLOCKS);
    matrix = new PayoffMatrix(matrixProtocol(KINGDOM_ID, matrixSeeds,
      TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false), runner, createMatrixCellCache());
    pool.reservoir.slice(0, ORDERED_ROBUST_INITIAL_STRATEGIES).forEach((entry) => matrix.addStrategy(entry.strategy));
    await matrix.fillAll(false, Date.now() + UNIT_TIMEOUT_MS);
    const snapshot = matrix.snapshot();
    checkpoint = createOrderedRobustCheckpoint({ kingdomId: KINGDOM_ID, poolHash: pool.generatedHash,
      reservoirHash: pool.reservoirHash, sourceRankedSha256: pool.source.rankedSha256,
      rulesFingerprint: rulesFingerprint(KINGDOM_ID,
        TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false), evaluationSeed,
      protocol: orderedRobustProtocolDefinition(),
      initialStrategyIds: pool.reservoir.slice(0, ORDERED_ROBUST_INITIAL_STRATEGIES).map((entry) => entry.strategy.id),
      seedPlan: planner.plan, records: [], admissions: [], matrix: snapshot, equilibrium: solve(snapshot),
      state: initialRobustRunState(), elapsedMs: performance.now() - started });
    if (!validateOrderedRobustCheckpoint(checkpoint, pool)) throw new Error('Initial robust checkpoint is invalid.');
    writeAtomic(file, checkpoint);
  }
  while (checkpoint.state.status === 'running') {
    const phaseStarted = performance.now();
    const state = checkpoint.state; const snapshot = matrix.snapshot(), equilibrium = solve(snapshot);
    const active = new Set(snapshot.strategies.map((strategy) => strategy.id));
    const candidates = pool.reservoir.filter((entry) => !active.has(entry.strategy.id)).map((entry) => entry.strategy);
    const kind = state.nextPhase === 'closure-scan' ? 'closure' as const : 'ordinary' as const;
    const phase = kind === 'ordinary' ? 'search' as const : 'selected-closure' as const;
    const namespace = kind === 'ordinary'
      ? `robust:ordinary:${state.ordinaryScans}` : `robust:closure:${state.closureCycles}`;
    const timeout = kind === 'closure' ? CLOSURE_TIMEOUT_MS : UNIT_TIMEOUT_MS;
    const scan = await runProtocolScan({ protocolId: ORDERED_ROBUST_RACE_PROTOCOL, phase, namespace,
      candidates, snapshot, equilibrium, planner,
      score: pairingScoreAllocation(runner, KINGDOM_ID, Date.now() + timeout) });
    const admitted = scan.finalists.filter((entry) => entry.admitted).map((entry) => entry.strategy);
    admitted.forEach((strategy) => matrix.addStrategy(strategy));
    if (admitted.length) await matrix.fillAll(false, Date.now() + UNIT_TIMEOUT_MS);
    const records: RobustScanRecord[] = [...checkpoint.records, { kind,
      ordinal: kind === 'ordinary' ? state.ordinaryScans : state.closureCycles,
      closureCycle: state.closureCycles, scan }];
    const admissions: RobustAdmission[] = [...checkpoint.admissions];
    if (admitted.length) admissions.push({ kind, scanIndex: records.length - 1,
      strategyIds: admitted.map((strategy) => strategy.id) });
    const finalMatrix = matrix.snapshot();
    checkpoint = createOrderedRobustCheckpoint({ kingdomId: KINGDOM_ID, poolHash: pool.generatedHash,
      reservoirHash: pool.reservoirHash, sourceRankedSha256: pool.source.rankedSha256,
      rulesFingerprint: rulesFingerprint(KINGDOM_ID,
        TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false), evaluationSeed,
      protocol: orderedRobustProtocolDefinition(),
      initialStrategyIds: checkpoint.initialStrategyIds, seedPlan: planner.plan, records, admissions,
      matrix: finalMatrix, equilibrium: solve(finalMatrix),
      state: transitionRobustRunState(state, { kind, admitted: admitted.length }),
      elapsedMs: checkpoint.elapsedMs + performance.now() - phaseStarted });
    if (!validateOrderedRobustCheckpoint(checkpoint, pool)) throw new Error(`Robust checkpoint ${evaluationSeed} is invalid.`);
    writeAtomic(file, checkpoint);
  }
  return checkpoint;
}

async function auditHistoricalPool(
  target: OrderedRobustCheckpoint, historicalPool: LegacyFixedReservoirPoolArtifact,
  runner: WorkerPairingRunner
): Promise<HistoricalAuditArtifact> {
  const file = auditFile(target.evaluationSeed, historicalPool.poolSeed);
  if (fs.existsSync(file)) {
    const held = readJson<unknown>(file);
    if (validateHistoricalAuditArtifact(held, historicalPool, target)) return held;
  }
  if (target.state.status !== 'complete') throw new Error(`Ordered run ${target.evaluationSeed} is not complete.`);
  const planner = new ConsistencySeedPlanner(target.reservoirHash, target.evaluationSeed);
  const started = performance.now();
  const scan = await runProtocolScan({ protocolId: ORDERED_ROBUST_RACE_PROTOCOL, phase: 'baseline-audit',
    namespace: `robust:audit:historical:${historicalPool.poolSeed}`,
    candidates: historicalAuditCandidates(historicalPool, target), snapshot: target.matrix,
    equilibrium: target.equilibrium, planner,
    score: pairingScoreAllocation(runner, KINGDOM_ID, Date.now() + CLOSURE_TIMEOUT_MS) });
  const confirmed = scan.finalists.filter((entry) => entry.admitted).map((entry) => entry.strategy.id);
  const strongest = scan.finalists.filter((entry) => entry.admitted).sort((left, right) =>
    right.interval95.lower - left.interval95.lower || right.mean - left.mean
    || left.strategy.id.localeCompare(right.strategy.id))[0]?.strategy.id ?? null;
  const artifact = createHistoricalAuditArtifact({ targetEvaluationSeed: target.evaluationSeed,
    targetCheckpointHash: target.evidenceHash, targetSnapshotHash: lotterySnapshotHash(target.matrix, target.equilibrium),
    historicalPoolSeed: historicalPool.poolSeed, historicalReservoirHash: historicalPool.reservoirHash,
    seedPlan: planner.plan, scan, confirmedStrategyIds: confirmed, strongestStrategyId: strongest,
    elapsedMs: performance.now() - started });
  if (!validateHistoricalAuditArtifact(artifact, historicalPool, target)) throw new Error('Historical audit is invalid.');
  writeAtomic(file, artifact); return artifact;
}

function positiveMixture(target: OrderedRobustCheckpoint) {
  const opponents = new Map<string, Strategy>(); const weights: Record<string, number> = {};
  for (const strategy of target.matrix.strategies) {
    const weight = target.equilibrium.weights[strategy.id] ?? 0;
    if (weight > 0) { opponents.set(strategy.id, strategy); weights[strategy.id] = weight; }
  }
  return { opponents, weights };
}
async function testAnalog(
  target: OrderedRobustCheckpoint, historicalPoolSeed: number, attacker: Strategy,
  analog: Strategy, runner: WorkerPairingRunner
): Promise<DirectAnalogEvidence> {
  const planner = new ConsistencySeedPlanner(target.reservoirHash, target.evaluationSeed);
  const label = `robust:analog:historical:${historicalPoolSeed}:attacker:${stableHash(canonicalStrategy(attacker))}`;
  const seeds = planner.derive('selected-direct', `${label}:confirmation`, 400);
  const sampling = planner.derive('selected-direct', `${label}:confirmation:sampling`, 1)[0]!;
  const bootstrapSeed = planner.derive('selected-direct', `${label}:bootstrap`, 1)[0]!;
  const { opponents, weights } = positiveMixture(target);
  const schedule = mixtureSchedule(weights, seeds, sampling);
  const row = (await evaluateCandidates([analog], opponents, schedule, runner, { kingdomId: KINGDOM_ID,
    turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN,
    startingDraftEnabled: false, scoreOnly: true,
    deadline: Date.now() + UNIT_TIMEOUT_MS }))[0]!;
  return { targetEvaluationSeed: target.evaluationSeed,
    targetSnapshotHash: lotterySnapshotHash(target.matrix, target.equilibrium), historicalPoolSeed,
    attackerStrategyId: attacker.id, strategy: analog, namespace: label,
    seedPlan: planner.plan, schedule,
    bootstrapSeed, blockScores: row.blockScores, mean: row.mean,
    interval95: percentileBootstrapMean(row.blockScores, bootstrapSeed), matches: row.matches };
}

function validDiagnostics(
  value: unknown, targets: readonly OrderedRobustCheckpoint[], audits: readonly HistoricalAuditArtifact[]
): value is DiagnosticsArtifact {
  try {
    if (!value || typeof value !== 'object') return false;
    const artifact = value as DiagnosticsArtifact;
    if (artifact.schemaVersion !== 1
      || artifact.experiment !== 'ordered-reservoir-historical-attacker-diagnostics'
      || artifact.version !== ORDERED_RESERVOIR_ROBUST_VERSION
      || artifact.sourceRunId !== ORDERED_RESERVOIR_RUN_ID
      || !['running', 'complete'].includes(artifact.status) || !Array.isArray(artifact.entries)
      || !Number.isFinite(artifact.elapsedMs) || artifact.elapsedMs < 0) return false;
    const expected = audits.flatMap((audit) => audit.scan.finalists.filter((entry) => entry.admitted)
      .map((entry) => ({ audit, finalist: entry,
        target: targets.find((target) => target.evaluationSeed === audit.targetEvaluationSeed)! })));
    if (artifact.status === 'complete' && artifact.entries.length !== expected.length
      || artifact.entries.length > expected.length) return false;
    const keys = new Set<string>();
    for (const entry of artifact.entries) {
      const key = `${entry.targetEvaluationSeed}:${entry.historicalPoolSeed}:${canonicalStrategy(entry.attacker)}`;
      if (keys.has(key)) return false; keys.add(key);
      const source = expected.find((held) => held.target.evaluationSeed === entry.targetEvaluationSeed
        && held.audit.historicalPoolSeed === entry.historicalPoolSeed
        && canonicalStrategy(held.finalist.strategy) === canonicalStrategy(entry.attacker));
      if (!source || entry.attackMean !== source.finalist.mean
        || JSON.stringify(entry.attackInterval95) !== JSON.stringify(source.finalist.interval95)
        || JSON.stringify(entry.membership) !== JSON.stringify(diagnoseOrderedCandidateMembership(entry.attacker))
        || JSON.stringify(entry.plan) !== JSON.stringify(strategyMechanicSummary(entry.attacker))) return false;
      const analogs = nearestOrderedAnalogs(entry.attacker);
      const expectedAnalogForms = new Set(analogs.map((analog) => canonicalStrategy(analog.strategy)));
      if (!entry.analogs.length || entry.analogs.some((analog) => !expectedAnalogForms.has(canonicalStrategy(analog.strategy)))
        || !entry.analogs.some((analog) => canonicalStrategy(analog.strategy)
          === canonicalStrategy(entry.selectedAnalog))
        || !diagnoseOrderedCandidateMembership(entry.selectedAnalog).representable) return false;
      const direct = entry.directEvidence;
      const targetSnapshotHash = lotterySnapshotHash(source.target.matrix, source.target.equilibrium);
      const planner = new ConsistencySeedPlanner(source.target.reservoirHash, source.target.evaluationSeed);
      const seeds = planner.derive('selected-direct', `${direct.namespace}:confirmation`, 400);
      const sampling = planner.derive('selected-direct', `${direct.namespace}:confirmation:sampling`, 1)[0]!;
      const bootstrap = planner.derive('selected-direct', `${direct.namespace}:bootstrap`, 1)[0]!;
      const { weights } = positiveMixture(source.target);
      if (direct.targetSnapshotHash !== targetSnapshotHash
        || direct.historicalPoolSeed !== entry.historicalPoolSeed
        || direct.attackerStrategyId !== entry.attacker.id
        || canonicalStrategy(direct.strategy) !== canonicalStrategy(entry.selectedAnalog)
        || JSON.stringify(direct.seedPlan) !== JSON.stringify(planner.plan)
        || JSON.stringify(direct.schedule) !== JSON.stringify(mixtureSchedule(weights, seeds, sampling))
        || direct.bootstrapSeed !== bootstrap || direct.blockScores.length !== 400 || direct.matches !== 1600
        || direct.mean !== direct.blockScores.reduce((sum, score) => sum + score, 0) / 400
        || JSON.stringify(direct.interval95) !== JSON.stringify(
          percentileBootstrapMean(direct.blockScores, bootstrap))) return false;
    }
    const copy = structuredClone(artifact) as Partial<DiagnosticsArtifact>;
    delete copy.evidenceHash; delete copy.elapsedMs;
    return artifact.evidenceHash === diagnosticsHash(
      copy as Omit<DiagnosticsArtifact, 'evidenceHash' | 'elapsedMs'>);
  } catch { return false; }
}

async function diagnostics(
  targets: readonly OrderedRobustCheckpoint[], audits: readonly HistoricalAuditArtifact[],
  runner: WorkerPairingRunner
): Promise<DiagnosticsArtifact> {
  const started = performance.now();
  let previous: DiagnosticsArtifact | null = null;
  if (fs.existsSync(DIAGNOSTICS_FILE)) {
    const held = readJson<unknown>(DIAGNOSTICS_FILE);
    if (validDiagnostics(held, targets, audits)) previous = held;
    if (previous?.status === 'complete') return previous;
  }
  const inputs = audits.flatMap((audit) => audit.scan.finalists.filter((entry) => entry.admitted).map((entry) => ({
    audit, finalist: entry, target: targets.find((target) => target.evaluationSeed === audit.targetEvaluationSeed)! })));
  const prepared = inputs.map((input) => ({ ...input,
    membership: diagnoseOrderedCandidateMembership(input.finalist.strategy),
    analogs: nearestOrderedAnalogs(input.finalist.strategy) }));
  const queries = new Set<string>();
  for (const entry of prepared) {
    if (entry.membership.representable) queries.add(canonicalStrategy(entry.finalist.strategy));
    entry.analogs.forEach((analog) => queries.add(canonicalStrategy(analog.strategy)));
  }
  const ranked = queries.size ? await lookupSplitRankedStrategies(sourceFile('ranked.json'), queries) : new Map<string, RankedLookup>();
  const entries: AttackerDiagnostic[] = [...(previous?.entries ?? [])];
  const completed = new Set(entries.map((entry) =>
    `${entry.targetEvaluationSeed}:${entry.historicalPoolSeed}:${canonicalStrategy(entry.attacker)}`));
  for (const entry of prepared) {
    const key = `${entry.target.evaluationSeed}:${entry.audit.historicalPoolSeed}:${canonicalStrategy(entry.finalist.strategy)}`;
    if (completed.has(key)) continue;
    const rankedAnalogs = entry.analogs.map((analog) => ({ strategy: analog.strategy, changes: analog.changes,
      ranked: ranked.get(canonicalStrategy(analog.strategy)) ?? null }));
    rankedAnalogs.sort((left, right) => {
      if (left.ranked && right.ranked) return left.ranked.rank - right.ranked.rank;
      if (left.ranked) return -1; if (right.ranked) return 1;
      return 0;
    });
    const selected = rankedAnalogs[0];
    if (!selected) throw new Error(`No representable analog for ${entry.finalist.strategy.id}.`);
    const directEvidence = await testAnalog(entry.target, entry.audit.historicalPoolSeed,
      entry.finalist.strategy, selected.strategy, runner);
    entries.push({ targetEvaluationSeed: entry.target.evaluationSeed,
      historicalPoolSeed: entry.audit.historicalPoolSeed, attacker: entry.finalist.strategy,
      attackMean: entry.finalist.mean, attackInterval95: entry.finalist.interval95,
      plan: strategyMechanicSummary(entry.finalist.strategy), membership: entry.membership,
      exactRanked: ranked.get(canonicalStrategy(entry.finalist.strategy)) ?? null,
      analogs: rankedAnalogs, selectedAnalog: selected.strategy,
      selectedAnalogRanked: selected.ranked, directEvidence });
    const partial = createDiagnosticsArtifact('running', entries,
      (previous?.elapsedMs ?? 0) + performance.now() - started);
    if (!validDiagnostics(partial, targets, audits)) throw new Error('Partial diagnostics checkpoint is invalid.');
    writeAtomic(DIAGNOSTICS_FILE, partial);
  }
  const artifact = createDiagnosticsArtifact('complete', entries,
    (previous?.elapsedMs ?? 0) + performance.now() - started);
  if (!validDiagnostics(artifact, targets, audits)) throw new Error('Diagnostics artifact is invalid.');
  writeAtomic(DIAGNOSTICS_FILE, artifact); return artifact;
}

function loadValidRuns(pool: OrderedChallengePoolArtifact): OrderedRobustCheckpoint[] {
  return ORDERED_ROBUST_EVALUATION_SEEDS.map((seed) => {
    const value = fs.existsSync(runFile(seed)) ? readJson<unknown>(runFile(seed)) : null;
    if (!validateOrderedRobustCheckpoint(value, pool)) throw new Error(`Run ${seed} is missing or invalid.`);
    return value;
  });
}
function loadValidAudits(targets: readonly OrderedRobustCheckpoint[]): HistoricalAuditArtifact[] {
  return targets.flatMap((target) => ORDERED_RESERVOIR_HISTORICAL_SEEDS.map((seed) => {
    const pool = loadHistoricalPool(seed), file = auditFile(target.evaluationSeed, seed);
    const value = fs.existsSync(file) ? readJson<unknown>(file) : null;
    if (!validateHistoricalAuditArtifact(value, pool, target)) {
      throw new Error(`Audit ${target.evaluationSeed}/${seed} is missing or invalid.`);
    }
    return value;
  }));
}
function report(pool: OrderedChallengePoolArtifact): void {
  const runs = loadValidRuns(pool), audits = loadValidAudits(runs);
  const diagnosticsArtifact = readJson<DiagnosticsArtifact>(DIAGNOSTICS_FILE);
  if (!validDiagnostics(diagnosticsArtifact, runs, audits) || diagnosticsArtifact.status !== 'complete') {
    throw new Error('Historical attacker diagnostics are missing or invalid.');
  }
  const pairs = runs.flatMap((left, index) => runs.slice(index + 1).map((right) => ({
    evaluationSeeds: [left.evaluationSeed, right.evaluationSeed],
    supportJaccard: supportJaccard(supportIdentity(left.equilibrium), supportIdentity(right.equilibrium)),
    totalVariation: lotteryTotalVariation(left.equilibrium.weights, right.equilibrium.weights) })));
  const confirmed = audits.flatMap((audit) => audit.scan.finalists.filter((entry) => entry.admitted)
    .map((entry) => ({ targetEvaluationSeed: audit.targetEvaluationSeed,
      historicalPoolSeed: audit.historicalPoolSeed, strategy: entry.strategy,
      mean: entry.mean, interval95: entry.interval95 })));
  const strongestHistoricalCounterByTarget = runs.map((run) => ({ evaluationSeed: run.evaluationSeed,
    counter: confirmed.filter((entry) => entry.targetEvaluationSeed === run.evaluationSeed)
      .sort((left, right) => right.interval95.lower - left.interval95.lower
        || right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id))[0] ?? null }));
  const counterConsistency = [...new Set(confirmed.map((entry) => canonicalStrategy(entry.strategy)))].map((form) => {
    const rows = confirmed.filter((entry) => canonicalStrategy(entry.strategy) === form);
    return { strategyId: rows[0]!.strategy.id,
      targetEvaluationSeeds: [...new Set(rows.map((entry) => entry.targetEvaluationSeed))].sort(),
      historicalPoolSeeds: [...new Set(rows.map((entry) => entry.historicalPoolSeed))].sort() };
  });
  const data = { schemaVersion: 1, experiment: 'ordered-reservoir-robust-report',
    version: ORDERED_RESERVOIR_ROBUST_VERSION, source: pool.source,
    protocol: { ordinary: raceProtocol(ORDERED_ROBUST_RACE_PROTOCOL),
      closure: raceProtocol(ORDERED_ROBUST_RACE_PROTOCOL), initialStrategies: ORDERED_ROBUST_INITIAL_STRATEGIES,
      matrixBlocks: ORDERED_ROBUST_MATRIX_BLOCKS, draft: false, health: 50 },
    runs: runs.map((run) => ({ evaluationSeed: run.evaluationSeed, status: run.state.status,
      stopReason: run.state.stopReason, scans: run.records.length, admissions: run.admissions,
      matrixSize: run.matrix.strategies.length, support: supportIdentity(run.equilibrium), elapsedMs: run.elapsedMs })),
    pairwise: pairs, strongestHistoricalCounterByTarget, counterConsistency,
    audits: audits.map((audit) => ({ targetEvaluationSeed: audit.targetEvaluationSeed,
      historicalPoolSeed: audit.historicalPoolSeed, scanned: audit.scan.completeCandidateCoverage,
      finalists: audit.scan.finalists.map((entry) => ({ id: entry.strategy.id, mean: entry.mean,
        interval95: entry.interval95, confirmed: entry.admitted })),
      strongestStrategyId: audit.strongestStrategyId, elapsedMs: audit.elapsedMs })),
    diagnostics: { path: DIAGNOSTICS_FILE, entries: diagnosticsArtifact.entries.length }, externalCostUsd: 0 };
  writeAtomic(REPORT_JSON, data);
  const markdown = ['# Ordered-reservoir robust PSRO report', '',
    `Source: \`${ORDERED_RESERVOIR_SOURCE}\`.`, '',
    '| Evaluation seed | Status | Ordinary + closure scans | Matrix | Support |',
    '|---:|---|---:|---:|---:|', ...runs.map((run) => `| ${run.evaluationSeed} | ${run.state.stopReason} | ${run.records.length} | ${run.matrix.strategies.length} | ${supportIdentity(run.equilibrium).length} |`), '',
    '| Target seed | Historical pool | Scanned | Confirmed old attackers | Strongest |',
    '|---:|---:|---:|---:|---|', ...audits.map((audit) => `| ${audit.targetEvaluationSeed} | ${audit.historicalPoolSeed} | ${audit.scan.completeCandidateCoverage} | ${audit.confirmedStrategyIds.length} | ${audit.strongestStrategyId ?? 'none'} |`), '',
    ...strongestHistoricalCounterByTarget.map((entry) => entry.counter
      ? `Strongest confirmed historical counter for ${entry.evaluationSeed}: ${entry.counter.strategy.id}, ${(entry.counter.mean * 100).toFixed(2)}%, 95% interval ${(entry.counter.interval95.lower * 100).toFixed(2)}%–${(entry.counter.interval95.upper * 100).toFixed(2)}%.`
      : `Strongest confirmed historical counter for ${entry.evaluationSeed}: none.`), '',
    `Detailed generation and analog evidence: \`${DIAGNOSTICS_FILE}\`.`, '',
    'Historical strategies are audit-only. Every ordered matrix contains only strategies from the corrected ordered 20,000 reservoir.', ''].join('\n');
  fs.writeFileSync(REPORT_MD, `${markdown}\n`);
}

function status(pool: OrderedChallengePoolArtifact): boolean {
  let complete = true; const runs: OrderedRobustCheckpoint[] = [];
  for (const seed of ORDERED_ROBUST_EVALUATION_SEEDS) {
    const value = fs.existsSync(runFile(seed)) ? readJson<unknown>(runFile(seed)) : null;
    const valid = validateOrderedRobustCheckpoint(value, pool);
    console.log(`run ${seed}: ${valid ? value.state.status : 'missing/invalid'}`);
    complete &&= valid && value.state.status === 'complete'; if (valid) runs.push(value);
  }
  if (runs.length === 3) for (const target of runs) for (const seed of ORDERED_RESERVOIR_HISTORICAL_SEEDS) {
    const historicalPool = loadHistoricalPool(seed);
    const value = fs.existsSync(auditFile(target.evaluationSeed, seed))
      ? readJson<unknown>(auditFile(target.evaluationSeed, seed)) : null;
    const valid = validateHistoricalAuditArtifact(value, historicalPool, target);
    console.log(`audit ${target.evaluationSeed}/${seed}: ${valid ? 'complete' : 'missing/invalid'}`);
    complete &&= valid;
  } else complete = false;
  const diagnosticsValue = fs.existsSync(DIAGNOSTICS_FILE) ? readJson<unknown>(DIAGNOSTICS_FILE) : null;
  const diagnosticsComplete = validDiagnostics(diagnosticsValue, runs, runs.length === 3
    ? loadValidAudits(runs) : []) && diagnosticsValue.status === 'complete';
  console.log(`diagnostics: ${diagnosticsComplete ? 'complete' : 'missing/invalid'}`);
  complete &&= diagnosticsComplete; return complete;
}

async function run(): Promise<void> {
  const pool = loadOrPreparePool(); const heldKingdom = kingdom();
  const runner = new WorkerPairingRunner(ORDERED_ROBUST_WORKERS,
    new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom: heldKingdom }, ['--import', 'tsx']);
  try {
    const targets = [] as OrderedRobustCheckpoint[];
    for (const seed of ORDERED_ROBUST_EVALUATION_SEEDS) targets.push(await runOrderedSeed(pool, seed, runner));
    if (targets.some((target) => target.state.status !== 'complete')) {
      throw new Error('At least one ordered run hit a cap. Audit did not start.');
    }
    const audits = [] as HistoricalAuditArtifact[];
    for (const target of targets) for (const seed of ORDERED_RESERVOIR_HISTORICAL_SEEDS) {
      audits.push(await auditHistoricalPool(target, loadHistoricalPool(seed), runner));
    }
    await diagnostics(targets, audits, runner); report(pool);
  } finally { await runner.close(); }
}

const command = process.argv[2] ?? '--run'; commandPolicy(command);
kingdom();
if (command === '--run') await run();
else {
  const pool = loadOrPreparePool();
  if (command === '--status') { if (!status(pool)) process.exitCode = 1; }
  else if (command === '--report') report(pool);
  else throw new Error(`Unknown ordered robust command ${command}.`);
}
