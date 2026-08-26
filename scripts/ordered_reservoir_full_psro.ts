import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { cardDefinition, registerKingdom } from '../src/game';
import { anytimeConfidenceBounds } from '../src/sim/anytimeMeanEvidence';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { equilibriumGroupWeightRange, solveEquilibrium } from '../src/sim/equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import {
  ConsistencySeedPlanner, lotterySnapshotHash, pairingScoreAllocation, raceProtocol,
  runProtocolScan, validateConsistencySeedPlan, validateProtocolScan
} from '../src/sim/fixedReservoirConsistency';
import type { ProtocolScanEvidence } from '../src/sim/fixedReservoirConsistency';
import { mixtureSchedule } from '../src/sim/mixtureEvaluation';
import type { MixtureSchedule } from '../src/sim/mixtureEvaluation';
import {
  acquisitionEquivalentClasses, stratifiedOpponentSchedule, summarizeLotteryAcquisitions,
  validateFullCandidateEvidence
} from '../src/sim/lotteryAcquisition';
import type {
  FullCandidateEvidence, LotteryAcquisitionSummary, ProductBlockEvidence
} from '../src/sim/lotteryAcquisition';
import {
  appendNestedMatrixOutcome, createNestedMatrixEvidence, nestedMatrixSnapshot, nestedMatrixWork,
  validateNestedMatrixEvidence, withNestedMatrixStrategies
} from '../src/sim/nestedPayoffMatrix';
import type { NestedMatrixDepth, NestedMatrixEvidence } from '../src/sim/nestedPayoffMatrix';
import {
  ORDERED_FULL_PSRO_CONFIRMATION_LOOKS, ORDERED_FULL_PSRO_CONTINUATION_WIDTHS,
  ORDERED_FULL_PSRO_MATRIX_WIDTH, ORDERED_FULL_PSRO_RUNS,
  ORDERED_FULL_PSRO_SCREEN_CHUNK, ORDERED_FULL_PSRO_VERSION,
  collapseAcquisitionEquivalentAdmissions, createOrderedFullPsroCheckpoint,
  decideConfirmationLook, initialFullPsroState, orderedFullPsroSeeds, selectFullScreenCandidates,
  shadowAnchorSyntheticId, transitionFullPsroState, validateOrderedFullPsroCheckpointIdentity,
  validateOrderedFullPsroResumeChain, validateOrderedFullPsroSeedPlan
} from '../src/sim/orderedReservoirFullPsro';
import type {
  DeepValidatedResumeTransition, FullPsroState, FullScreenCandidate, OrderedFullPsroCheckpoint,
  ShadowEquivalentClass
} from '../src/sim/orderedReservoirFullPsro';
import {
  ORDERED_RESERVOIR_HISTORICAL_ROOT, ORDERED_RESERVOIR_HISTORICAL_SEEDS,
  ORDERED_RESERVOIR_SOURCE, adaptValidatedOrderedReservoir, validateOrderedChallengePool
} from '../src/sim/orderedReservoirChallenge';
import type { OrderedChallengePoolArtifact, OrderedRankedManifestHeader } from '../src/sim/orderedReservoirChallenge';
import type { OrderedProductReservoirArtifact } from '../src/sim/orderedGoldfishProduct';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { validateLegacyFixedReservoirPoolV1 } from '../src/sim/legacyFixedReservoirV1';
import type { LegacyFixedReservoirPoolArtifact } from '../src/sim/legacyFixedReservoirV1';
import type { PairingJob } from '../src/sim/pairingRunner';
import { rulesFingerprint } from '../src/sim/rulesFingerprint';
import { classifyStrategyDamage, damageFamily } from '../src/sim/strategyDamage';
import { canonicalStrategy, stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';

const ROOT = path.join('.experiments', 'ordered-reservoir-full-psro', ORDERED_FULL_PSRO_VERSION);
const POOL_FILE = path.join(ROOT, 'pool.json');
const KINGDOM_ID = 'deep-beam-tuning-009';
const WORKERS = 4;
const RUNNER_URL = new URL('../src/server/aiWorker.ts', import.meta.url);

function runRoot(run: 1 | 2): string { return path.join(ROOT, `run-${run}`); }
function matrixFile(run: 1 | 2): string { return path.join(runRoot(run), 'matrix.json'); }
function checkpointFile(run: 1 | 2): string { return path.join(runRoot(run), 'checkpoint.json'); }
function terminalFile(run: 1 | 2): string { return path.join(runRoot(run), 'terminal.json'); }
function scanRoot(run: 1 | 2, scan: number): string {
  return path.join(runRoot(run), 'scans', `scan-${String(scan + 1).padStart(2, '0')}`);
}
function screenFile(run: 1 | 2, scan: number, chunk: number): string {
  return path.join(scanRoot(run, scan), 'screen', `chunk-${String(chunk).padStart(3, '0')}.json`);
}
function confirmationFile(run: 1 | 2, scan: number, look: number, chunk: number): string {
  return path.join(scanRoot(run, scan), 'confirmation', `look-${look}`, `chunk-${String(chunk).padStart(3, '0')}.json`);
}
function scanSummaryFile(run: 1 | 2, scan: number): string { return path.join(scanRoot(run, scan), 'summary.json'); }
function anchorFile(run: 1 | 2, scan: number, blocks: number): string {
  return path.join(scanRoot(run, scan), 'confirmation', `anchors-${blocks}.json`);
}
function panelFile(run: 1 | 2, panel: number): string { return path.join(runRoot(run), 'panels', `panel-${panel}.json`); }
function auditFile(run: 1 | 2, historicalPoolSeed: number): string {
  return path.join(runRoot(run), 'historical-audits', `pool-${historicalPoolSeed}.json`);
}
function historicalPoolFile(seed: number): string {
  return path.join(ORDERED_RESERVOIR_HISTORICAL_ROOT, `pool-${seed}.json`);
}
function reportFile(extension: 'json' | 'md'): string { return path.join(ROOT, `report.${extension}`); }
function comparisonFile(): string { return path.join(ROOT, 'comparison.json'); }
function sourceFile(name: string): string { return path.join(ORDERED_RESERVOIR_SOURCE, name); }
function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file);
}
function sha256Text(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function sha256File(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function evidenceHash(value: unknown): string { return stableHash(JSON.stringify(value)); }
function exact(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function kingdom() {
  const held = deepBeamSuite.kingdoms.find((entry) => entry.id === KINGDOM_ID);
  if (!held || held.startingHealth !== 50) throw new Error('Kingdom 009 is missing.');
  registerKingdom(held); return held;
}
function validateSource(): void {
  for (const file of ['ranked.json', 'reservoir.json']) if (!fs.existsSync(sourceFile(file))) {
    throw new Error(`Missing ordered source ${sourceFile(file)}.`);
  }
  const result = spawnSync('npm', ['run', 'goldfish:ordered-product', '--', 'validate-reservoir',
    '--artifact', sourceFile('ranked.json'), '--reservoir', sourceFile('reservoir.json')], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Ordered source validation failed.');
}
function loadOrPreparePool(): OrderedChallengePoolArtifact {
  if (fs.existsSync(POOL_FILE)) {
    const held = readJson<unknown>(POOL_FILE);
    if (!validateOrderedChallengePool(held) || held.source.rankedSha256 !== sha256File(sourceFile('ranked.json'))
      || held.source.reservoirSha256 !== sha256File(sourceFile('reservoir.json'))) {
      throw new Error('Saved full-PSRO pool is invalid.');
    }
    return held;
  }
  validateSource();
  const ranked = fs.readFileSync(sourceFile('ranked.json'), 'utf8');
  const reservoir = fs.readFileSync(sourceFile('reservoir.json'), 'utf8');
  const pool = adaptValidatedOrderedReservoir({ manifest: JSON.parse(ranked) as OrderedRankedManifestHeader,
    reservoir: JSON.parse(reservoir) as OrderedProductReservoirArtifact,
    rankedSha256: sha256Text(ranked), reservoirSha256: sha256Text(reservoir) });
  writeAtomic(POOL_FILE, pool); return pool;
}
function positive(snapshot: ReturnType<typeof nestedMatrixSnapshot>, equilibrium: ReturnType<typeof solveEquilibrium>) {
  const opponents = new Map<string, Strategy>(); const weights: Record<string, number> = {};
  for (const strategy of snapshot.strategies) {
    const weight = equilibrium.weights[strategy.id] ?? 0;
    if (weight > 0) { opponents.set(strategy.id, strategy); weights[strategy.id] = weight; }
  }
  if (!opponents.size) throw new Error('Full PSRO lottery has empty support.');
  return { opponents, weights };
}
function schedule(pool: OrderedChallengePoolArtifact, run: 1 | 2, label: string, count: number,
  weights: Record<string, number>): MixtureSchedule {
  const seeds = orderedFullPsroSeeds(pool.reservoirHash, run, `${label}:blocks`, count);
  const sampling = orderedFullPsroSeeds(pool.reservoirHash, run, `${label}:sampling`, 1)[0]!;
  return mixtureSchedule(weights, seeds, sampling);
}
function createRunner() {
  return new WorkerPairingRunner(WORKERS, RUNNER_URL, { kingdom: kingdom() }, ['--import', 'tsx']);
}

async function fillMatrix(evidence: NestedMatrixEvidence, depth: NestedMatrixDepth,
  runner: WorkerPairingRunner, file: string,
  afterWrite?: (matrix: NestedMatrixEvidence) => void): Promise<NestedMatrixEvidence> {
  let current = evidence;
  for (;;) {
    const work = nestedMatrixWork(current, depth);
    if (!work.length) return current;
    const batch = work.slice(0, 100);
    const jobs: PairingJob[] = batch.map((entry) => ({ candidate: entry.left, opponent: entry.right,
      options: { kingdomId: KINGDOM_ID, seeds: entry.seeds, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
        actionCapPerTurn: ACTION_CAP_PER_TURN, startingDraftEnabled: false, allowEarlyStop: false } }));
    const outcomes = (await runner.run(jobs)).outcomes;
    for (let index = 0; index < batch.length; index += 1) {
      const outcome = outcomes[index]; if (!outcome) throw new Error('Matrix runner returned incomplete evidence.');
      current = appendNestedMatrixOutcome(current, batch[index]!, outcome);
    }
    writeAtomic(file, current); afterWrite?.(current);
  }
}

interface ScreenChunkArtifact {
  schemaVersion: 1; experiment: 'ordered-reservoir-full-screen-chunk'; version: typeof ORDERED_FULL_PSRO_VERSION;
  run: 1 | 2; scan: number; poolHash: string; reservoirHash: string; snapshotHash: string;
  start: number; end: number; laneA: MixtureSchedule; laneB: MixtureSchedule; rows: FullScreenCandidate[]; matches: number; elapsedMs: number; evidenceHash: string;
}
function screenHash(value: Omit<ScreenChunkArtifact, 'evidenceHash' | 'elapsedMs'>): string { return evidenceHash(value); }
function validateScreenChunk(value: unknown, pool: OrderedChallengePoolArtifact, run: 1 | 2, scan: number,
  snapshotHash: string, inactive: readonly { strategy: Strategy; goldfishRank: number }[], laneA: MixtureSchedule,
  laneB: MixtureSchedule, start: number, end: number): value is ScreenChunkArtifact {
  if (!value || typeof value !== 'object') return false; const held = value as ScreenChunkArtifact;
  const expected = inactive.slice(start, end);
  if (held.schemaVersion !== 1 || held.experiment !== 'ordered-reservoir-full-screen-chunk'
    || held.version !== ORDERED_FULL_PSRO_VERSION || held.run !== run || held.scan !== scan
    || held.poolHash !== pool.generatedHash || held.reservoirHash !== pool.reservoirHash
    || held.snapshotHash !== snapshotHash || held.start !== start || held.end !== end
    || !exact(held.laneA, laneA) || !exact(held.laneB, laneB) || held.rows.length !== expected.length
    || held.matches !== expected.length * 50 * 4 || !Number.isFinite(held.elapsedMs)) return false;
  for (let index = 0; index < expected.length; index += 1) {
    const row = held.rows[index]!, source = expected[index]!;
    if (row.strategyId !== source.strategy.id || row.goldfishRank !== source.goldfishRank
      || row.canonicalStrategy !== canonicalStrategy(source.strategy) || row.laneA.length !== 25
      || row.laneB.length !== 25 || [...row.laneA, ...row.laneB].some((score) => score < 0 || score > 1)) return false;
  }
  const copy = structuredClone(held) as Partial<ScreenChunkArtifact>; delete copy.evidenceHash; delete copy.elapsedMs;
  return held.evidenceHash === screenHash(copy as Omit<ScreenChunkArtifact, 'evidenceHash' | 'elapsedMs'>);
}
async function screenCandidates(pool: OrderedChallengePoolArtifact, run: 1 | 2, scan: number,
  inactive: readonly { strategy: Strategy; goldfishRank: number }[], opponents: Map<string, Strategy>,
  weights: Record<string, number>, snapshotHash: string, runner: WorkerPairingRunner): Promise<FullScreenCandidate[]> {
  const laneA = schedule(pool, run, `scan:${scan}:screen:a`, 25, weights);
  const laneB = schedule(pool, run, `scan:${scan}:screen:b`, 25, weights);
  const rows: FullScreenCandidate[] = [];
  for (let start = 0, chunk = 0; start < inactive.length; start += ORDERED_FULL_PSRO_SCREEN_CHUNK, chunk += 1) {
    const end = Math.min(inactive.length, start + ORDERED_FULL_PSRO_SCREEN_CHUNK), file = screenFile(run, scan, chunk);
    if (fs.existsSync(file)) {
      const held = readJson<unknown>(file);
      if (!validateScreenChunk(held, pool, run, scan, snapshotHash, inactive, laneA, laneB, start, end)) {
        throw new Error(`Invalid screen chunk ${file}.`);
      }
      rows.push(...held.rows); continue;
    }
    const started = performance.now(), candidates = inactive.slice(start, end).map((entry) => entry.strategy);
    const options = { kingdomId: KINGDOM_ID, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
      actionCapPerTurn: ACTION_CAP_PER_TURN, startingDraftEnabled: false, scoreOnly: true } as const;
    const { evaluateCandidates } = await import('../src/sim/mixtureEvaluation');
    const a = await evaluateCandidates(candidates, opponents, laneA, runner, options);
    const b = await evaluateCandidates(candidates, opponents, laneB, runner, options);
    const chunkRows = candidates.map((strategy, index): FullScreenCandidate => ({
      goldfishRank: inactive[start + index]!.goldfishRank, strategyId: strategy.id,
      canonicalStrategy: canonicalStrategy(strategy), laneA: a[index]!.blockScores, laneB: b[index]!.blockScores }));
    const base: Omit<ScreenChunkArtifact, 'evidenceHash' | 'elapsedMs'> = { schemaVersion: 1,
      experiment: 'ordered-reservoir-full-screen-chunk', version: ORDERED_FULL_PSRO_VERSION,
      run, scan, poolHash: pool.generatedHash, reservoirHash: pool.reservoirHash,
      snapshotHash, start, end, laneA, laneB, rows: chunkRows, matches: chunkRows.length * 200 };
    const artifact = { ...base, elapsedMs: performance.now() - started, evidenceHash: screenHash(base) };
    writeAtomic(file, artifact); rows.push(...chunkRows);
    console.log(`run ${run} scan ${scan + 1} screen ${end}/${inactive.length}`);
  }
  return rows;
}

async function evaluateFull(candidates: readonly Strategy[], opponents: ReadonlyMap<string, Strategy>,
  blocks: readonly { seed: number; opponentId: string }[], runner: WorkerPairingRunner): Promise<FullCandidateEvidence[]> {
  const jobs: PairingJob[] = candidates.flatMap((candidate) => blocks.map((block) => {
    const opponent = opponents.get(block.opponentId); if (!opponent) throw new Error(`Missing opponent ${block.opponentId}.`);
    return { candidate, opponent, options: { kingdomId: KINGDOM_ID, seeds: [block.seed],
      turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN,
      startingDraftEnabled: false, allowEarlyStop: false } };
  }));
  const batch = await runner.run(jobs); const result: FullCandidateEvidence[] = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const evidence: ProductBlockEvidence[] = [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const outcome = batch.outcomes[candidateIndex * blocks.length + blockIndex], block = blocks[blockIndex]!;
      if (!outcome || outcome.record.aborted || outcome.blocks[0]?.played !== 4
        || !outcome.telemetry.planPositionPurchasesByStrategy) throw new Error('Full telemetry block is invalid.');
      evidence.push({ seed: block.seed, opponentId: block.opponentId, score: outcome.blocks[0]!.score,
        matches: 4, telemetry: outcome.telemetry });
    }
    result.push({ strategy: candidates[candidateIndex]!, blocks: evidence });
  }
  return result;
}

interface ConfirmationChunkArtifact {
  schemaVersion: 1; experiment: 'ordered-reservoir-full-confirmation-chunk'; version: typeof ORDERED_FULL_PSRO_VERSION;
  run: 1 | 2; scan: number; look: number; poolHash: string; reservoirHash: string; snapshotHash: string;
  start: number; end: number; strategyIds: string[]; blocks: Record<string, ProductBlockEvidence[]>; elapsedMs: number; evidenceHash: string;
}
function confirmationHash(value: Omit<ConfirmationChunkArtifact, 'evidenceHash' | 'elapsedMs'>): string { return evidenceHash(value); }
function validConfirmationChunk(value: unknown, pool: OrderedChallengePoolArtifact, run: 1 | 2, scan: number,
  look: number, snapshotHash: string, candidates: readonly Strategy[], start: number, end: number,
  expected: readonly { seed: number; opponentId: string }[]):
  value is ConfirmationChunkArtifact {
  if (!value || typeof value !== 'object') return false; const held = value as ConfirmationChunkArtifact;
  const ids = candidates.slice(start, end).map((strategy) => strategy.id);
  if (held.schemaVersion !== 1 || held.experiment !== 'ordered-reservoir-full-confirmation-chunk'
    || held.version !== ORDERED_FULL_PSRO_VERSION || held.run !== run || held.scan !== scan || held.look !== look
    || held.poolHash !== pool.generatedHash || held.reservoirHash !== pool.reservoirHash
    || held.snapshotHash !== snapshotHash || held.start !== start || held.end !== end
    || !exact(held.strategyIds, ids)) return false;
  if (!Number.isFinite(held.elapsedMs) || held.elapsedMs < 0) return false;
  for (const [index, id] of ids.entries()) {
    const blocks = held.blocks[id], strategy = candidates[start + index]!;
    if (!blocks || !validateFullCandidateEvidence({ strategy, blocks }, { strategy, blocks: expected })) return false;
  }
  const copy = structuredClone(held) as Partial<ConfirmationChunkArtifact>; delete copy.evidenceHash; delete copy.elapsedMs;
  return held.evidenceHash === confirmationHash(copy as Omit<ConfirmationChunkArtifact, 'evidenceHash' | 'elapsedMs'>);
}

interface ConfirmationLookRecord {
  blocks: number;
  activeStrategyIds: string[];
  decisions: ReturnType<typeof decideConfirmationLook>;
  continuingStrategyIds: string[];
  continuationLimit: number | null;
  widthExceeded: boolean;
}

async function confirmCandidates(pool: OrderedChallengePoolArtifact, run: 1 | 2, scan: number,
  snapshotHash: string, candidates: readonly Strategy[], opponents: Map<string, Strategy>, weights: Record<string, number>,
  runner: WorkerPairingRunner): Promise<{ evidence: FullCandidateEvidence[];
    decisions: ReturnType<typeof decideConfirmationLook>; looks: ConfirmationLookRecord[];
    widthFailure: { look: number; continuing: number; maximum: number } | null }> {
  const full = schedule(pool, run, `scan:${scan}:confirmation`, 6_400, weights).blocks;
  const accumulated = new Map(candidates.map((strategy) => [strategy.id, [] as ProductBlockEvidence[]]));
  let field = [...candidates], previous = 0;
  let decisions: ReturnType<typeof decideConfirmationLook> = [];
  const looks: ConfirmationLookRecord[] = [];
  const terminal = new Map<string, ReturnType<typeof decideConfirmationLook>[number]>();
  for (let lookIndex = 0; lookIndex < ORDERED_FULL_PSRO_CONFIRMATION_LOOKS.length; lookIndex += 1) {
    const look = ORDERED_FULL_PSRO_CONFIRMATION_LOOKS[lookIndex]!, suffix = full.slice(previous, look);
    const chunkSize = 16;
    for (let start = 0, chunk = 0; start < field.length; start += chunkSize, chunk += 1) {
      const end = Math.min(field.length, start + chunkSize), file = confirmationFile(run, scan, look, chunk);
      let artifact: ConfirmationChunkArtifact;
      if (fs.existsSync(file)) {
        const held = readJson<unknown>(file);
        if (!validConfirmationChunk(held, pool, run, scan, look, snapshotHash, field, start, end, suffix)) {
          throw new Error(`Invalid confirmation ${file}.`);
        }
        artifact = held;
      } else {
        const started = performance.now(), evaluated = await evaluateFull(field.slice(start, end), opponents, suffix, runner);
        const base: Omit<ConfirmationChunkArtifact, 'evidenceHash' | 'elapsedMs'> = { schemaVersion: 1,
          experiment: 'ordered-reservoir-full-confirmation-chunk', version: ORDERED_FULL_PSRO_VERSION,
          run, scan, look, poolHash: pool.generatedHash, reservoirHash: pool.reservoirHash, snapshotHash,
          start, end, strategyIds: evaluated.map((entry) => entry.strategy.id),
          blocks: Object.fromEntries(evaluated.map((entry) => [entry.strategy.id, entry.blocks])) };
        artifact = { ...base, elapsedMs: performance.now() - started, evidenceHash: confirmationHash(base) };
        writeAtomic(file, artifact);
      }
      for (const id of artifact.strategyIds) accumulated.get(id)!.push(...artifact.blocks[id]!);
    }
    const current = decideConfirmationLook(candidates.map((strategy) => ({ strategyId: strategy.id,
      blockScores: accumulated.get(strategy.id)!.map((block) => block.score) })), look === 6_400);
    for (const decision of current) if (!terminal.has(decision.strategyId) && decision.decision !== 'continue') {
      terminal.set(decision.strategyId, decision);
    }
    decisions = current.map((decision) => terminal.get(decision.strategyId) ?? decision);
    const continuing = new Set(decisions.filter((entry) => entry.decision === 'continue').map((entry) => entry.strategyId));
    const continuationLimit = lookIndex < ORDERED_FULL_PSRO_CONTINUATION_WIDTHS.length
      ? ORDERED_FULL_PSRO_CONTINUATION_WIDTHS[lookIndex]! : null;
    const widthExceeded = continuationLimit !== null && continuing.size > continuationLimit;
    looks.push({ blocks: look, activeStrategyIds: field.map((strategy) => strategy.id), decisions,
      continuingStrategyIds: [...continuing].sort(), continuationLimit, widthExceeded });
    if (widthExceeded) return { evidence: candidates.map((strategy) => ({ strategy,
      blocks: accumulated.get(strategy.id)! })), decisions, looks,
      widthFailure: { look, continuing: continuing.size, maximum: continuationLimit } };
    field = candidates.filter((strategy) => continuing.has(strategy.id)); previous = look;
    if (!field.length) break;
  }
  return { evidence: candidates.map((strategy) => ({ strategy, blocks: accumulated.get(strategy.id)! })),
    decisions, looks, widthFailure: null };
}

function matrixAcquisitions(snapshot: ReturnType<typeof nestedMatrixSnapshot>, strategyId: string): Record<string, number> {
  const result: Record<string, number> = {}; let games = 0;
  for (const cell of snapshot.cells) {
    if (cell.rowId !== strategyId && cell.columnId !== strategyId) continue;
    games += cell.matches;
    for (const [cardId, amount] of Object.entries(cell.telemetry.acquisitionsByStrategy[strategyId] ?? {})) {
      result[cardId] = (result[cardId] ?? 0) + amount;
    }
  }
  return Object.fromEntries(Object.entries(result).map(([cardId, amount]) => [cardId, games ? amount / games : 0]));
}
function provisional(snapshot: ReturnType<typeof nestedMatrixSnapshot>, equilibrium: ReturnType<typeof solveEquilibrium>) {
  const labels = Object.fromEntries(snapshot.strategies.map((strategy) => [strategy.id,
    classifyStrategyDamage({ startingBuild: strategy.startingBuild,
      acquisitionRates: matrixAcquisitions(snapshot, strategy.id) })]));
  const names = [...new Set(Object.values(labels))];
  return { labels, selected: Object.fromEntries(names.map((name) => [name, equilibrium.strategyIds
    .filter((id) => labels[id] === name).reduce((sum, id) => sum + (equilibrium.weights[id] ?? 0), 0)])),
  ranges: Object.fromEntries(names.map((name) => [name, equilibriumGroupWeightRange(equilibrium.strategyIds,
    snapshot.centeredPayoffs, equilibrium.value, equilibrium.strategyIds.filter((id) => labels[id] === name))])) };
}
interface MatrixPrecisionComparison {
  from: 50 | 100;
  to: 100 | 200;
  selectedShareDeltas: Record<string, number>;
  rangeEndpointDeltas: Record<string, { minimum: number; maximum: number }>;
  maximumFeasibleWeightDeltas: Record<string, number>;
  materialLabelChanges: Array<{ strategyId: string; from: string | null; to: string | null;
    selectedWeight: number; maximumFeasibleWeight: number }>;
  maximumKnownAdvantageDelta: number;
  passed: boolean;
}
function precisionComparison(matrix: NestedMatrixEvidence, from: 50 | 100, to: 100 | 200): MatrixPrecisionComparison {
  const left = nestedMatrixSnapshot(matrix, from), right = nestedMatrixSnapshot(matrix, to);
  const leftEq = solveEquilibrium(left.strategies.map((strategy) => strategy.id), left.centeredPayoffs);
  const rightEq = solveEquilibrium(right.strategies.map((strategy) => strategy.id), right.centeredPayoffs);
  const a = provisional(left, leftEq), b = provisional(right, rightEq);
  const names = [...new Set([...Object.keys(a.selected), ...Object.keys(b.selected)])].sort();
  const selectedShareDeltas = Object.fromEntries(names.map((name) =>
    [name, Math.abs((a.selected[name] ?? 0) - (b.selected[name] ?? 0))]));
  const rangeEndpointDeltas = Object.fromEntries(names.map((name) => [name, {
    minimum: Math.abs((a.ranges[name]?.minimum ?? 0) - (b.ranges[name]?.minimum ?? 0)),
    maximum: Math.abs((a.ranges[name]?.maximum ?? 0) - (b.ranges[name]?.maximum ?? 0))
  }]));
  const maximumFeasibleWeightDeltas = Object.fromEntries(rightEq.strategyIds.map((id) =>
    [id, Math.abs((leftEq.maximumEquilibriumWeight[id] ?? 0) - (rightEq.maximumEquilibriumWeight[id] ?? 0))]));
  const materialLabelChanges = rightEq.strategyIds.filter((id) => ((rightEq.weights[id] ?? 0) >= 0.005
    || (rightEq.maximumEquilibriumWeight[id] ?? 0) >= 0.005) && a.labels[id] !== b.labels[id])
    .map((id) => ({ strategyId: id, from: a.labels[id] ?? null, to: b.labels[id] ?? null,
      selectedWeight: rightEq.weights[id] ?? 0,
      maximumFeasibleWeight: rightEq.maximumEquilibriumWeight[id] ?? 0 }));
  const maximumKnownAdvantageDelta = Math.abs(leftEq.maximumKnownAdvantage - rightEq.maximumKnownAdvantage);
  const passed = Object.values(selectedShareDeltas).every((delta) => delta <= 0.02)
    && Object.values(rangeEndpointDeltas).every((delta) => delta.minimum <= 0.02 && delta.maximum <= 0.02)
    && !materialLabelChanges.length && maximumKnownAdvantageDelta <= 0.005;
  return { from, to, selectedShareDeltas, rangeEndpointDeltas, maximumFeasibleWeightDeltas,
    materialLabelChanges, maximumKnownAdvantageDelta, passed };
}

interface ScanSummary {
  schemaVersion: 1; experiment: 'ordered-reservoir-full-scan'; version: typeof ORDERED_FULL_PSRO_VERSION;
  run: 1 | 2; scan: number; snapshotHash: string; selection: ReturnType<typeof selectFullScreenCandidates>;
  decisions: ReturnType<typeof decideConfirmationLook>; looks: ConfirmationLookRecord[];
  classes: ReturnType<typeof acquisitionEquivalentClasses>;
  representatives: string[]; shadows: ShadowEquivalentClass[]; retainedShadowIds: string[];
  divergedShadowIds: string[]; matrixPrecision: MatrixPrecisionComparison | null;
  stateBefore: FullPsroState; stateAfter: FullPsroState; terminalReason: string | null;
  matches: number; children: Array<{ file: string; evidenceHash: string }>;
  evidenceHash: string;
}
function validScanSummary(value: unknown): value is ScanSummary {
  if (!value || typeof value !== 'object') return false; const held = value as ScanSummary;
  if (held.schemaVersion !== 1 || held.experiment !== 'ordered-reservoir-full-scan'
    || held.version !== ORDERED_FULL_PSRO_VERSION || !Array.isArray(held.children)) return false;
  for (const child of held.children) {
    const file = path.join(ROOT, child.file);
    if (!fs.existsSync(file) || readJson<{ evidenceHash?: string }>(file).evidenceHash !== child.evidenceHash) return false;
  }
  const copy = structuredClone(held) as Partial<ScanSummary>; delete copy.evidenceHash;
  return held.evidenceHash === evidenceHash(copy);
}
function scanChildren(run: 1 | 2, scan: number): Array<{ file: string; evidenceHash: string }> {
  const root = scanRoot(run, scan), result: Array<{ file: string; evidenceHash: string }> = [];
  const visit = (directory: string) => {
    for (const name of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, name.name);
      if (name.isDirectory()) visit(file);
      else if (name.name.endsWith('.json') && file !== scanSummaryFile(run, scan)) {
        const hash = readJson<{ evidenceHash?: string }>(file).evidenceHash;
        if (!hash) throw new Error(`Child artifact lacks an evidence hash: ${file}`);
        result.push({ file: path.relative(ROOT, file), evidenceHash: hash });
      }
    }
  };
  visit(root); return result.sort((left, right) => left.file.localeCompare(right.file));
}

function matrixSubset(matrix: NestedMatrixEvidence, strategyIds: readonly string[]): NestedMatrixEvidence {
  const ids = new Set(strategyIds);
  const base: Omit<NestedMatrixEvidence, 'evidenceHash'> = { schemaVersion: 1,
    experiment: 'ordered-reservoir-full-nested-matrix', protocol: structuredClone(matrix.protocol),
    strategies: matrix.strategies.filter((strategy) => ids.has(strategy.id)),
    cells: matrix.cells.filter((cell) => ids.has(cell.rowId) && ids.has(cell.columnId)) };
  return { ...base, evidenceHash: stableHash(JSON.stringify(base)) };
}

function validateScanSummaryDeep(input: {
  value: unknown; pool: OrderedChallengePoolArtifact; run: 1 | 2; scan: number;
  matrix: NestedMatrixEvidence; state: FullPsroState; activeStrategyIds: string[];
  shadowClasses: ShadowEquivalentClass[];
}): { state: FullPsroState; activeStrategyIds: string[]; shadowClasses: ShadowEquivalentClass[] } | null {
  try {
    if (!validScanSummary(input.value)) return null;
    const held = input.value, subset = matrixSubset(input.matrix, input.activeStrategyIds);
    if (!validateNestedMatrixEvidence(subset) || !exact(held.stateBefore, input.state)
      || held.run !== input.run || held.scan !== input.scan || held.stateBefore.scan !== input.scan
      || !exact(held.children, scanChildren(input.run, input.scan))) return null;
    const snapshot = nestedMatrixSnapshot(subset, input.state.matrixDepth);
    if (!snapshot.complete) return null;
    const equilibrium = solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id, ), snapshot.centeredPayoffs);
    const snapshotHash = evidenceHash({ depth: input.state.matrixDepth,
      strategies: snapshot.strategies.map((strategy) => canonicalStrategy(strategy)),
      centeredPayoffs: snapshot.centeredPayoffs, equilibrium });
    if (held.snapshotHash !== snapshotHash) return null;
    const target = positive(snapshot, equilibrium), active = new Set(input.activeStrategyIds);
    const inactive = input.pool.reservoir.filter((entry) => !active.has(entry.strategy.id)).map((entry) => ({
      strategy: entry.strategy, goldfishRank: entry.goldfishRank }));
    const laneA = schedule(input.pool, input.run, `scan:${input.scan}:screen:a`, 25, target.weights);
    const laneB = schedule(input.pool, input.run, `scan:${input.scan}:screen:b`, 25, target.weights);
    const rows: FullScreenCandidate[] = [];
    for (let start = 0, chunk = 0; start < inactive.length; start += ORDERED_FULL_PSRO_SCREEN_CHUNK, chunk += 1) {
      const end = Math.min(inactive.length, start + ORDERED_FULL_PSRO_SCREEN_CHUNK);
      const value = readJson<unknown>(screenFile(input.run, input.scan, chunk));
      if (!validateScreenChunk(value, input.pool, input.run, input.scan, snapshotHash,
        inactive, laneA, laneB, start, end)) return null;
      rows.push(...value.rows);
    }
    const selection = selectFullScreenCandidates(rows, { allowOversize: true });
    if (!exact(held.selection, selection)) return null;
    if (selection.widthExceeded) {
      const next: FullPsroState = { ...input.state, scan: input.state.scan + 1,
        status: 'unresolved', stopReason: 'screen-width-unresolved' };
      return !held.decisions.length && !held.looks.length && !held.representatives.length
        && held.terminalReason === 'screen-width-unresolved' && held.matches === rows.length * 200
        && exact(held.stateAfter, next)
        ? { state: next, activeStrategyIds: input.activeStrategyIds, shadowClasses: input.shadowClasses } : null;
    }
    const byId = new Map(inactive.map((entry) => [entry.strategy.id, entry.strategy]));
    const candidates = selection.strategyIds.map((id) => byId.get(id)!);
    const full = schedule(input.pool, input.run, `scan:${input.scan}:confirmation`, 6_400, target.weights).blocks;
    if (!held.looks.length || held.looks.length > ORDERED_FULL_PSRO_CONFIRMATION_LOOKS.length) return null;
    const accumulated = new Map(candidates.map((strategy) => [strategy.id, [] as ProductBlockEvidence[]]));
    const terminal = new Map<string, ReturnType<typeof decideConfirmationLook>[number]>();
    let field = [...candidates], previous = 0;
    let decisions: ReturnType<typeof decideConfirmationLook> = [];
    let widthFailure: ConfirmationLookRecord | null = null;
    for (let lookIndex = 0; lookIndex < held.looks.length; lookIndex += 1) {
      const record = held.looks[lookIndex]!, look = ORDERED_FULL_PSRO_CONFIRMATION_LOOKS[lookIndex];
      if (!look || record.blocks !== look || !exact(record.activeStrategyIds, field.map((strategy) => strategy.id))) return null;
      const suffix = full.slice(previous, look), chunkSize = 16;
      for (let start = 0, chunk = 0; start < field.length; start += chunkSize, chunk += 1) {
        const end = Math.min(field.length, start + chunkSize), file = confirmationFile(input.run, input.scan, look, chunk);
        if (!fs.existsSync(file)) return null;
        const artifact = readJson<unknown>(file);
        if (!validConfirmationChunk(artifact, input.pool, input.run, input.scan, look, snapshotHash,
          field, start, end, suffix)) return null;
        for (const id of artifact.strategyIds) accumulated.get(id)!.push(...artifact.blocks[id]!);
      }
      const current = decideConfirmationLook(candidates.map((strategy) => ({ strategyId: strategy.id,
        blockScores: accumulated.get(strategy.id)!.map((block) => block.score) })), look === 6_400);
      for (const decision of current) if (!terminal.has(decision.strategyId) && decision.decision !== 'continue') {
        terminal.set(decision.strategyId, decision);
      }
      decisions = current.map((decision) => terminal.get(decision.strategyId) ?? decision);
      const continuing = decisions.filter((entry) => entry.decision === 'continue').map((entry) => entry.strategyId).sort();
      const limit = lookIndex < ORDERED_FULL_PSRO_CONTINUATION_WIDTHS.length
        ? ORDERED_FULL_PSRO_CONTINUATION_WIDTHS[lookIndex]! : null;
      const expectedRecord: ConfirmationLookRecord = { blocks: look,
        activeStrategyIds: field.map((strategy) => strategy.id), decisions,
        continuingStrategyIds: continuing, continuationLimit: limit,
        widthExceeded: limit !== null && continuing.length > limit };
      if (!exact(record, expectedRecord)) return null;
      if (record.widthExceeded) { widthFailure = record; break; }
      const continuingSet = new Set(continuing);
      field = candidates.filter((strategy) => continuingSet.has(strategy.id)); previous = look;
      if (!field.length && lookIndex !== held.looks.length - 1) return null;
    }
    if (!exact(held.decisions, decisions)
      || (!widthFailure && field.length && held.looks.at(-1)?.blocks !== 6_400)) return null;
    const evidence = candidates.map((strategy) => ({ strategy, blocks: accumulated.get(strategy.id)! }));
    const confirmationMatches = evidence.reduce((sum, entry) => sum + entry.blocks.length * 4, 0);
    const admittedIds = new Set(decisions.filter((entry) => entry.decision === 'admitted').map((entry) => entry.strategyId));
    const admitted = evidence.filter((entry) => admittedIds.has(entry.strategy.id));
    const knownShadow = new Set(input.shadowClasses.flatMap((group) => group.shadowIds));
    const confirmedKnown = evidence.filter((entry) => knownShadow.has(entry.strategy.id));
    const anchors = new Map<string, FullCandidateEvidence>(); let anchorMatches = 0;
    for (const length of [...new Set(confirmedKnown.map((entry) => entry.blocks.length))]) {
      const representatives = [...new Set(confirmedKnown.filter((entry) => entry.blocks.length === length).map((entry) =>
        input.shadowClasses.find((group) => group.shadowIds.includes(entry.strategy.id))!.activeRepresentativeId))].sort();
      const file = anchorFile(input.run, input.scan, length); if (!fs.existsSync(file)) return null;
      const artifact = readJson<{ schemaVersion: number; experiment: string; version: string; run: number;
        scan: number; poolHash: string; reservoirHash: string; snapshotHash: string; blocks: number;
        strategyIds: string[]; evidence: FullCandidateEvidence[]; evidenceHash: string }>(file);
      const base = { schemaVersion: 1, experiment: 'ordered-reservoir-full-shadow-anchors',
        version: ORDERED_FULL_PSRO_VERSION, run: input.run, scan: input.scan, poolHash: input.pool.generatedHash,
        reservoirHash: input.pool.reservoirHash, snapshotHash, blocks: length,
        strategyIds: representatives, evidence: artifact.evidence };
      if (!exact(artifact, { ...base, evidenceHash: evidenceHash(base) }) || artifact.evidence.length !== representatives.length) return null;
      for (let index = 0; index < representatives.length; index += 1) {
        const id = representatives[index]!, strategy = subset.strategies.find((entry) => entry.id === id)!;
        const expectedTelemetryId = shadowAnchorSyntheticId({ run: input.run, scan: input.scan,
          representativeId: id, blocks: length });
        const entry = artifact.evidence[index]!;
        if (entry.candidateTelemetryId !== expectedTelemetryId
          || !validateFullCandidateEvidence(entry, { strategy, blocks: full.slice(0, length) })) return null;
        anchors.set(`${id}:${length}`, entry); anchorMatches += entry.blocks.length * 4;
      }
    }
    const collapsed = collapseAcquisitionEquivalentAdmissions({ evidence, admittedIds,
      existingShadows: input.shadowClasses, anchorEvidence: anchors });
    const classes = acquisitionEquivalentClasses(admitted);
    if (!exact(held.classes, classes) || !exact(held.representatives,
      collapsed.representatives.map((entry) => entry.strategy.id)) || !exact(held.shadows, collapsed.shadows)
      || !exact(held.retainedShadowIds, collapsed.retainedShadowIds)
      || !exact(held.divergedShadowIds, collapsed.divergedShadowIds)) return null;
    const diverged = new Set(collapsed.divergedShadowIds);
    const retainedExistingShadows = input.shadowClasses.map((group) => ({ ...group,
      memberIds: group.memberIds.filter((id) => !diverged.has(id)),
      shadowIds: group.shadowIds.filter((id) => !diverged.has(id))
    })).filter((group) => group.shadowIds.length);
    if (widthFailure) {
      const next: FullPsroState = { ...input.state, scan: input.state.scan + 1,
        status: 'unresolved', stopReason: 'confirmation-width-unresolved' };
      return held.terminalReason === 'confirmation-width-unresolved'
        && held.matches === rows.length * 200 + confirmationMatches + anchorMatches && exact(held.stateAfter, next)
        ? { state: next, activeStrategyIds: input.activeStrategyIds, shadowClasses: retainedExistingShadows } : null;
    }
    if (input.activeStrategyIds.length + collapsed.representatives.length > ORDERED_FULL_PSRO_MATRIX_WIDTH) {
      const next: FullPsroState = { ...input.state, scan: input.state.scan + 1,
        status: 'unresolved', stopReason: 'matrix-width-unresolved' };
      return held.terminalReason === 'matrix-width-unresolved'
        && held.matches === rows.length * 200 + confirmationMatches + anchorMatches && exact(held.stateAfter, next)
        ? { state: next, activeStrategyIds: input.activeStrategyIds, shadowClasses: retainedExistingShadows } : null;
    }
    const nextActive = [...input.activeStrategyIds, ...collapsed.representatives.map((entry) => entry.strategy.id)].sort();
    const nextShadows = [...input.shadowClasses.map((group) => ({ ...group,
      memberIds: group.memberIds.filter((id) => !diverged.has(id)),
      shadowIds: group.shadowIds.filter((id) => !diverged.has(id))
    })).filter((group) => group.shadowIds.length), ...collapsed.shadows];
    const unresolved = decisions.filter((entry) => entry.decision === 'unresolved').length;
    const comparison = collapsed.representatives.length || unresolved
      || input.state.matrixDepth === 50 || input.state.cleanAtDepth + 1 < 2 ? null
      : precisionComparison(matrixSubset(input.matrix, nextActive), input.state.matrixDepth === 100 ? 50 : 100,
        input.state.matrixDepth);
    const next = transitionFullPsroState(input.state, { representativeAdmissions: collapsed.representatives.length,
      unresolved, ...(comparison === null ? {} : { precisionStable: comparison.passed }) });
    if (!exact(held.matrixPrecision, comparison) || !exact(held.stateAfter, next)
      || held.terminalReason !== (next.status === 'unresolved' ? next.stopReason : null)
      || held.matches !== rows.length * 200 + confirmationMatches + anchorMatches) return null;
    return { state: next, activeStrategyIds: nextActive, shadowClasses: nextShadows };
  } catch { return null; }
}

function initialMatrix(pool: OrderedChallengePoolArtifact, run: 1 | 2): NestedMatrixEvidence {
  return createNestedMatrixEvidence({ version: 'ordered-reservoir-full-nested-matrix-v1', kingdomId: KINGDOM_ID,
    seeds: orderedFullPsroSeeds(pool.reservoirHash, run, 'matrix', 200),
    turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN,
    startingDraftEnabled: false }, pool.reservoir.slice(0, 50).map((entry) => entry.strategy));
}
function loadCheckpoint(pool: OrderedChallengePoolArtifact, run: 1 | 2): OrderedFullPsroCheckpoint | null {
  const file = checkpointFile(run); if (!fs.existsSync(file)) return null;
  const value = readJson<unknown>(file);
  const expectedRules = rulesFingerprint(KINGDOM_ID, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false).hash;
  if (!validateOrderedFullPsroCheckpointIdentity(value, { run, kingdomId: KINGDOM_ID,
    rulesFingerprint: expectedRules, reservoirHash: pool.reservoirHash, poolHash: pool.generatedHash,
    sourceRankedSha256: pool.source.rankedSha256 })) throw new Error(`Run ${run} checkpoint is invalid.`);
  const held = value, matrixPath = matrixFile(run);
  if (!fs.existsSync(matrixPath)) throw new Error(`Run ${run} matrix is missing.`);
  const matrix = readJson<NestedMatrixEvidence>(matrixPath);
  const poolById = new Map(pool.reservoir.map((entry) => [entry.strategy.id, entry.strategy]));
  if (!validateNestedMatrixEvidence(matrix) || held.matrixEvidenceHash !== matrix.evidenceHash
    || !exact(matrix.protocol, initialMatrix(pool, run).protocol)
    || matrix.strategies.some((strategy) => !poolById.has(strategy.id)
      || canonicalStrategy(poolById.get(strategy.id)!) !== canonicalStrategy(strategy))) {
    throw new Error(`Run ${run} checkpoint source or matrix is invalid.`);
  }
  const initialActiveStrategyIds = pool.reservoir.slice(0, 50).map((entry) => entry.strategy.id).sort();
  let replay = { state: initialFullPsroState(), activeStrategyIds: initialActiveStrategyIds,
    shadowClasses: [] as ShadowEquivalentClass[] };
  const transitions: DeepValidatedResumeTransition[] = [];
  for (let index = 0; index < held.scanEvidenceHashes.length; index += 1) {
    const summaryPath = scanSummaryFile(run, index); if (!fs.existsSync(summaryPath)) {
      throw new Error(`Run ${run} scan ${index + 1} is missing.`);
    }
    const summary = readJson<unknown>(summaryPath);
    if (!validScanSummary(summary) || summary.evidenceHash !== held.scanEvidenceHashes[index]) {
      throw new Error(`Run ${run} scan ${index + 1} hash is invalid.`);
    }
    const before = structuredClone(replay);
    const next = validateScanSummaryDeep({ value: summary, pool, run, scan: index, matrix,
      state: replay.state, activeStrategyIds: replay.activeStrategyIds, shadowClasses: replay.shadowClasses });
    if (!next) throw new Error(`Run ${run} scan ${index + 1} evidence is invalid.`);
    transitions.push({ scan: index, summaryHash: summary.evidenceHash,
      childHashes: summary.children.map((child) => child.evidenceHash), stateBefore: before.state,
      stateAfter: next.state, activeStrategyIdsBefore: before.activeStrategyIds,
      activeStrategyIdsAfter: next.activeStrategyIds, shadowClassesBefore: before.shadowClasses,
      shadowClassesAfter: next.shadowClasses });
    replay = next;
  }
  if (!validateOrderedFullPsroResumeChain({ checkpoint: held, initialActiveStrategyIds, transitions })
    || !exact(replay.state, held.state) || !exact(replay.activeStrategyIds, held.activeStrategyIds)
    || !exact(replay.shadowClasses, held.shadowClasses)
    || !exact(matrix.strategies.map((strategy) => strategy.id), held.activeStrategyIds)) {
    throw new Error(`Run ${run} replay state is invalid.`);
  }
  const panels: PanelArtifact[] = [];
  for (let index = 0; index < held.panelEvidenceHashes.length; index += 1) {
    const panelPath = panelFile(run, index + 1); if (!fs.existsSync(panelPath)) throw new Error(`Run ${run} panel is missing.`);
    const panel = readJson<unknown>(panelPath);
    if (!validPanel(panel, held, pool, matrix) || panel.evidenceHash !== held.panelEvidenceHashes[index]) {
      throw new Error(`Run ${run} panel ${index + 1} is invalid.`);
    }
    panels.push(panel);
  }
  if (panels.length) {
    const stable = panelStable(panels);
    const validComplete = held.state.status === 'complete' && (panels.length === 3 || panels.length === 5) && stable;
    const validUnresolved = held.state.stopReason === 'acquisition-panel-unresolved'
      && panels.length === 5 && !stable;
    if (!validComplete && !validUnresolved) throw new Error(`Run ${run} panel gate is invalid.`);
  }
  const audits: HistoricalAuditArtifact[] = [];
  for (let index = 0; index < held.auditEvidenceHashes.length; index += 1) {
    const historicalSeed = ORDERED_RESERVOIR_HISTORICAL_SEEDS[index];
    if (!historicalSeed) throw new Error(`Run ${run} has an extra audit.`);
    const auditPath = auditFile(run, historicalSeed); if (!fs.existsSync(auditPath)) throw new Error(`Run ${run} audit is missing.`);
    const historical = loadHistoricalPool(historicalSeed), audit = readJson<unknown>(auditPath);
    if (!validateHistoricalAudit(audit, pool, held, matrix, historical)
      || audit.evidenceHash !== held.auditEvidenceHashes[index]) throw new Error(`Run ${run} audit ${historicalSeed} is invalid.`);
    audits.push(audit);
  }
  if (!validateAuditSeedUniqueness(pool, audits)) throw new Error(`Run ${run} audit seeds are invalid.`);
  if (held.state.status === 'unresolved') {
    const expectedTerminal = createTerminalArtifact(run, held.state, matrix,
      held.scanEvidenceHashes, held.panelEvidenceHashes, held.auditEvidenceHashes);
    if (!fs.existsSync(terminalFile(run)) || !exact(readJson<unknown>(terminalFile(run)), expectedTerminal)
      || held.terminalEvidenceHash !== expectedTerminal.evidenceHash) {
      throw new Error(`Run ${run} terminal evidence is invalid.`);
    }
  } else if (fs.existsSync(terminalFile(run)) || held.terminalEvidenceHash !== null) {
    throw new Error(`Run ${run} has stale terminal evidence.`);
  }
  if (held.state.status !== 'complete' && held.auditEvidenceHashes.length) {
    throw new Error(`Run ${run} has audit evidence after a non-complete search.`);
  }
  return held;
}
interface TerminalArtifact {
  schemaVersion: 1; experiment: 'ordered-reservoir-full-terminal'; version: typeof ORDERED_FULL_PSRO_VERSION;
  run: 1 | 2; state: FullPsroState; matrixEvidenceHash: string; scanEvidenceHashes: string[];
  panelEvidenceHashes: string[]; auditEvidenceHashes: string[]; details: unknown; evidenceHash: string;
}
function terminalDetails(run: 1 | 2, state: FullPsroState, matrix: NestedMatrixEvidence,
  scanEvidenceHashes: string[], panelEvidenceHashes: string[]): unknown {
  const lastScan = scanEvidenceHashes.length
    ? readJson<ScanSummary>(scanSummaryFile(run, scanEvidenceHashes.length - 1)) : null;
  if (state.stopReason === 'screen-width-unresolved') return { selectedWidth: lastScan?.selection.selectedWidth,
    maximum: 512, summaryHash: lastScan?.evidenceHash };
  if (state.stopReason === 'confirmation-width-unresolved') {
    const look = lastScan?.looks.at(-1);
    return { look: look?.blocks, continuing: look?.continuingStrategyIds.length,
      maximum: look?.continuationLimit, summaryHash: lastScan?.evidenceHash };
  }
  if (state.stopReason === 'matrix-width-unresolved') return { currentWidth: matrix.strategies.length,
    proposedRepresentatives: lastScan?.representatives.length,
    projectedWidth: matrix.strategies.length + (lastScan?.representatives.length ?? 0),
    maximum: ORDERED_FULL_PSRO_MATRIX_WIDTH, summaryHash: lastScan?.evidenceHash };
  if (state.stopReason === 'support-width-unresolved') {
    const snapshot = nestedMatrixSnapshot(matrix, state.matrixDepth);
    const equilibrium = solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
    const supportIds = equilibrium.strategyIds.filter((id) => (equilibrium.weights[id] ?? 0) > 1e-8
      || (equilibrium.maximumEquilibriumWeight[id] ?? 0) >= 0.005);
    return { supportIds, width: supportIds.length, maximum: 32 };
  }
  if (state.stopReason === 'acquisition-panel-unresolved') {
    const panels = panelEvidenceHashes.map((_hash, index) => readJson<PanelArtifact>(panelFile(run, index + 1)));
    return { panels: panels.length, gate: panelStabilityDiagnostics(panels) };
  }
  return { summaryHash: lastScan?.evidenceHash, terminalReason: lastScan?.terminalReason,
    unresolved: lastScan?.decisions.filter((entry) => entry.decision === 'unresolved').length ?? 0,
    matrixPrecision: lastScan?.matrixPrecision ?? null };
}
function createTerminalArtifact(run: 1 | 2, state: FullPsroState, matrix: NestedMatrixEvidence,
  scanEvidenceHashes: string[], panelEvidenceHashes: string[], auditEvidenceHashes: string[]): TerminalArtifact {
  const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-full-terminal' as const,
    version: ORDERED_FULL_PSRO_VERSION, run, state, matrixEvidenceHash: matrix.evidenceHash,
    scanEvidenceHashes, panelEvidenceHashes, auditEvidenceHashes,
    details: terminalDetails(run, state, matrix, scanEvidenceHashes, panelEvidenceHashes) };
  return { ...base, evidenceHash: evidenceHash(base) };
}
function writeCheckpoint(pool: OrderedChallengePoolArtifact, run: 1 | 2, state: FullPsroState,
  activeStrategyIds: string[], shadowClasses: ShadowEquivalentClass[], matrix: NestedMatrixEvidence,
  scanHashes: string[], panelHashes: string[], elapsedMs: number,
  auditHashes: string[] = []): OrderedFullPsroCheckpoint {
  let terminalEvidenceHash: string | null = null;
  if (state.status === 'unresolved') {
    const terminal = createTerminalArtifact(run, state, matrix, scanHashes, panelHashes, auditHashes);
    const file = terminalFile(run);
    if (fs.existsSync(file) && !exact(readJson<unknown>(file), terminal)) {
      throw new Error(`Run ${run} terminal artifact is invalid.`);
    }
    if (!fs.existsSync(file)) writeAtomic(file, terminal);
    terminalEvidenceHash = terminal.evidenceHash;
  }
  const checkpoint = createOrderedFullPsroCheckpoint({ run, kingdomId: KINGDOM_ID,
    rulesFingerprint: rulesFingerprint(KINGDOM_ID, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false).hash,
    reservoirHash: pool.reservoirHash, poolHash: pool.generatedHash,
    sourceRankedSha256: pool.source.rankedSha256, state,
    activeStrategyIds: [...activeStrategyIds].sort(), shadowClasses, matrixEvidenceHash: matrix.evidenceHash,
    scanEvidenceHashes: scanHashes, panelEvidenceHashes: panelHashes,
    auditEvidenceHashes: auditHashes, terminalEvidenceHash, elapsedMs });
  writeAtomic(checkpointFile(run), checkpoint); return checkpoint;
}

interface PanelArtifact {
  schemaVersion: 1; experiment: 'ordered-reservoir-full-acquisition-panel'; version: typeof ORDERED_FULL_PSRO_VERSION;
  run: 1 | 2; panel: number; targetHash: string; schedule: ReturnType<typeof stratifiedOpponentSchedule>;
  evidence: FullCandidateEvidence[]; summary: LotteryAcquisitionSummary; elapsedMs: number; evidenceHash: string;
}
function panelTargetHash(checkpoint: OrderedFullPsroCheckpoint): string {
  return evidenceHash({ run: checkpoint.run, activeStrategyIds: checkpoint.activeStrategyIds,
    shadowClasses: checkpoint.shadowClasses, matrixEvidenceHash: checkpoint.matrixEvidenceHash,
    scanEvidenceHashes: checkpoint.scanEvidenceHashes });
}
function validPanel(value: unknown, checkpoint: OrderedFullPsroCheckpoint,
  pool: OrderedChallengePoolArtifact, matrix: NestedMatrixEvidence): value is PanelArtifact {
  try {
    if (!value || typeof value !== 'object') return false; const held = value as PanelArtifact;
    if (held.schemaVersion !== 1 || held.experiment !== 'ordered-reservoir-full-acquisition-panel'
      || held.version !== ORDERED_FULL_PSRO_VERSION || held.run !== checkpoint.run
      || held.targetHash !== panelTargetHash(checkpoint) || held.panel < 1 || held.panel > 5
      || !Number.isFinite(held.elapsedMs) || held.elapsedMs < 0) return false;
    const snapshot = nestedMatrixSnapshot(matrix, checkpoint.state.matrixDepth);
    const equilibrium = solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
    const support = snapshot.strategies.filter((strategy) => (equilibrium.weights[strategy.id] ?? 0) > 1e-8
      || (equilibrium.maximumEquilibriumWeight[strategy.id] ?? 0) >= 0.005);
    const weights = Object.fromEntries(support.map((strategy): [string, number] =>
      [strategy.id, equilibrium.weights[strategy.id] ?? 0]));
    const seeds = orderedFullPsroSeeds(pool.reservoirHash, checkpoint.run, `panel:${held.panel}`, 1_000);
    const expectedSchedule = stratifiedOpponentSchedule(weights, seeds, 25);
    if (!exact(held.schedule, expectedSchedule)
      || !exact(held.evidence.map((entry) => entry.strategy.id), support.map((strategy) => strategy.id))) return false;
    for (let index = 0; index < support.length; index += 1) if (!validateFullCandidateEvidence(held.evidence[index],
      { strategy: support[index]!, blocks: expectedSchedule.blocks })) return false;
    const expectedSummary = summarizeLotteryAcquisitions({ strategies: snapshot.strategies, panels: held.evidence,
      equilibrium, centeredPayoffs: snapshot.centeredPayoffs,
      fallbackAcquisitionRates: Object.fromEntries(snapshot.strategies.map((strategy) =>
        [strategy.id, matrixAcquisitions(snapshot, strategy.id)])) });
    if (!exact(held.summary, expectedSummary)) return false;
    const copy = structuredClone(held) as Partial<PanelArtifact>; delete copy.evidenceHash; delete copy.elapsedMs;
    return held.evidenceHash === evidenceHash(copy);
  } catch { return false; }
}
function pooledPanelSummary(matrix: NestedMatrixEvidence, depth: NestedMatrixDepth,
  panels: readonly PanelArtifact[]): LotteryAcquisitionSummary {
  if (!panels.length) throw new Error('Pooled acquisition summary needs panels.');
  const snapshot = nestedMatrixSnapshot(matrix, depth), equilibrium = solveEquilibrium(
    snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
  const byId = new Map<string, FullCandidateEvidence>();
  for (const panel of panels) for (const evidence of panel.evidence) {
    const held = byId.get(evidence.strategy.id);
    if (held) held.blocks.push(...structuredClone(evidence.blocks));
    else byId.set(evidence.strategy.id, structuredClone(evidence));
  }
  return summarizeLotteryAcquisitions({ strategies: snapshot.strategies, panels: [...byId.values()],
    equilibrium, centeredPayoffs: snapshot.centeredPayoffs,
    fallbackAcquisitionRates: Object.fromEntries(snapshot.strategies.map((strategy) =>
      [strategy.id, matrixAcquisitions(snapshot, strategy.id)])) });
}
function panelStabilityDiagnostics(panels: readonly PanelArtifact[]) {
  if (!panels.length) return { archetypeSpans: {}, cardSpans: {}, labelChanges: [], passed: false };
  const summaries = panels.map((panel) => panel.summary);
  const span = (values: number[]) => Math.max(...values) - Math.min(...values);
  const labels = [...new Set(summaries.flatMap((summary) => Object.keys(summary.selectedArchetypeShares)))].sort();
  const archetypeSpans = Object.fromEntries(labels.map((label) => [label,
    span(summaries.map((summary) => summary.selectedArchetypeShares[label] ?? 0))]));
  const cards = [...new Set(summaries.flatMap((summary) => Object.keys(summary.expectedCopiesPerPlayerGame)))].sort();
  const cardSpans = Object.fromEntries(cards.map((card) => {
    const copies = summaries.map((summary) => summary.expectedCopiesPerPlayerGame[card] ?? 0);
    const shares = summaries.map((summary) => summary.normalizedActionCardShares[card] ?? 0);
    return [card, { material: Math.max(...copies) >= 0.02 || Math.max(...shares) >= 0.01,
      copies: span(copies), normalizedShare: span(shares) }];
  }));
  const strategies = [...new Set(summaries.flatMap((summary) => Object.keys(summary.strategyLabels)))].sort();
  const labelChanges = strategies.filter((id) =>
    new Set(summaries.map((summary) => summary.strategyLabels[id])).size !== 1).map((strategyId) => ({
      strategyId, labels: summaries.map((summary) => summary.strategyLabels[strategyId] ?? null) }));
  const passed = Object.values(archetypeSpans).every((value) => value <= 0.02)
    && Object.values(cardSpans).every((value) => !value.material
      || value.copies <= 0.02 && value.normalizedShare <= 0.02) && !labelChanges.length;
  return { archetypeSpans, cardSpans, labelChanges, passed };
}
function panelStable(panels: readonly PanelArtifact[]): boolean { return panelStabilityDiagnostics(panels).passed; }
async function ensurePanels(pool: OrderedChallengePoolArtifact, checkpoint: OrderedFullPsroCheckpoint,
  matrix: NestedMatrixEvidence, runner: WorkerPairingRunner): Promise<{ panels: PanelArtifact[]; passed: boolean }> {
  const snapshot = nestedMatrixSnapshot(matrix, checkpoint.state.matrixDepth), equilibrium = solveEquilibrium(
    snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
  const support = snapshot.strategies.filter((strategy) => (equilibrium.weights[strategy.id] ?? 0) > 1e-8
    || (equilibrium.maximumEquilibriumWeight[strategy.id] ?? 0) >= 0.005);
  if (support.length > 32) throw new Error('support-width-unresolved');
  const opponents = new Map(support.map((strategy) => [strategy.id, strategy]));
  const weights = Object.fromEntries(support.map((strategy): [string, number] =>
    [strategy.id, equilibrium.weights[strategy.id] ?? 0]));
  const panels: PanelArtifact[] = [];
  for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
    const file = panelFile(checkpoint.run, ordinal);
    if (fs.existsSync(file)) {
      const held = readJson<unknown>(file);
      if (!validPanel(held, checkpoint, pool, matrix)) throw new Error(`Invalid panel ${file}.`);
      panels.push(held);
    } else {
      const seeds = orderedFullPsroSeeds(pool.reservoirHash, checkpoint.run, `panel:${ordinal}`, 1_000);
      const panelSchedule = stratifiedOpponentSchedule(weights, seeds, 25), started = performance.now();
      const evidence = await evaluateFull(support, opponents, panelSchedule.blocks, runner);
      const summary = summarizeLotteryAcquisitions({ strategies: snapshot.strategies, panels: evidence,
        equilibrium, centeredPayoffs: snapshot.centeredPayoffs,
        fallbackAcquisitionRates: Object.fromEntries(snapshot.strategies.map((strategy) =>
          [strategy.id, matrixAcquisitions(snapshot, strategy.id)])) });
      const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-full-acquisition-panel' as const,
        version: ORDERED_FULL_PSRO_VERSION, run: checkpoint.run, panel: ordinal,
        targetHash: panelTargetHash(checkpoint), schedule: panelSchedule, evidence, summary };
      const artifact = { ...base, elapsedMs: performance.now() - started, evidenceHash: evidenceHash(base) };
      writeAtomic(file, artifact); panels.push(artifact);
    }
    if (panels.length === 3 && panelStable(panels)) break;
  }
  return { panels, passed: panelStable(panels) };
}

interface HistoricalAttackerDiagnostic {
  strategy: Strategy;
  canonicalStrategy: string;
  sourceRank: number;
  mean: number;
  interval95: { lower: number; upper: number };
  evidence: FullCandidateEvidence;
  acquisitionRates: Record<string, number>;
  planPositionRates: Record<string, number>;
  normalizedActionCardShares: Record<string, number>;
  damageFamilyShares: Record<string, number>;
  classifierLabel: string;
  opponentExposure: Record<string, { blocks: number; mean: number }>;
  exposingOpponentIds: string[];
  strongestOpponentExposure: { opponentId: string; blocks: number; mean: number } | null;
}
interface HistoricalAuditArtifact {
  schemaVersion: 1;
  experiment: 'ordered-reservoir-full-historical-audit';
  version: typeof ORDERED_FULL_PSRO_VERSION;
  run: 1 | 2;
  historicalPoolSeed: number;
  historicalPoolHash: string;
  historicalReservoirHash: string;
  targetHash: string;
  targetSnapshotHash: string;
  seedRoot: number;
  seedPlan: ConsistencySeedPlanner['plan'];
  scan: ProtocolScanEvidence;
  confirmedStrategyIds: string[];
  diagnostics: HistoricalAttackerDiagnostic[];
  matches: number;
  elapsedMs: number;
  evidenceHash: string;
}
function historicalAuditHash(value: Omit<HistoricalAuditArtifact, 'evidenceHash' | 'elapsedMs'>): string {
  return evidenceHash(value);
}
function loadHistoricalPool(seed: number): LegacyFixedReservoirPoolArtifact {
  const file = historicalPoolFile(seed);
  if (!fs.existsSync(file)) throw new Error(`Missing historical pool ${seed}.`);
  const held = readJson<unknown>(file);
  if (!validateLegacyFixedReservoirPoolV1(held, { kingdomId: KINGDOM_ID, poolSeed: seed })) {
    throw new Error(`Historical pool ${seed} is invalid.`);
  }
  return held;
}
function reservedFullPsroSeeds(reservoirHash: string): Set<number> {
  const seeds = new Set<number>();
  const add = (run: 1 | 2, label: string, count: number) => orderedFullPsroSeeds(reservoirHash, run, label, count)
    .forEach((seed) => { if (seeds.has(seed)) throw new Error('Full PSRO reserved seed collision.'); seeds.add(seed); });
  for (const run of ORDERED_FULL_PSRO_RUNS) {
    add(run, 'matrix', 200);
    for (let scan = 0; scan < 10; scan += 1) {
      for (const lane of ['a', 'b']) { add(run, `scan:${scan}:screen:${lane}:blocks`, 25); add(run, `scan:${scan}:screen:${lane}:sampling`, 1); }
      add(run, `scan:${scan}:confirmation:blocks`, 6_400); add(run, `scan:${scan}:confirmation:sampling`, 1);
    }
    for (let panel = 1; panel <= 5; panel += 1) add(run, `panel:${panel}`, 1_000);
    for (const historical of ORDERED_RESERVOIR_HISTORICAL_SEEDS) add(run, `audit:historical:${historical}:root`, 1);
  }
  add(1, 'comparison:row:blocks', 10_000); add(1, 'comparison:row:sampling', 1);
  add(2, 'comparison:column:blocks', 10_000); add(2, 'comparison:column:sampling', 1);
  return seeds;
}
function validateAuditSeedUniqueness(pool: OrderedChallengePoolArtifact,
  audits: readonly HistoricalAuditArtifact[]): boolean {
  try {
    const seeds = reservedFullPsroSeeds(pool.reservoirHash);
    for (const audit of audits) for (const namespace of audit.seedPlan.namespaces) for (const seed of namespace.seeds) {
      if (seeds.has(seed)) return false; seeds.add(seed);
    }
    return true;
  } catch { return false; }
}
function auditPlanner(pool: OrderedChallengePoolArtifact, run: 1 | 2, historicalSeed: number) {
  const seedRoot = orderedFullPsroSeeds(pool.reservoirHash, run,
    `audit:historical:${historicalSeed}:root`, 1)[0]!;
  return { seedRoot, planner: new ConsistencySeedPlanner(pool.reservoirHash, seedRoot) };
}
function historicalCandidates(historical: LegacyFixedReservoirPoolArtifact,
  snapshot: ReturnType<typeof nestedMatrixSnapshot>): Strategy[] {
  const active = new Set(snapshot.strategies.map((strategy) => strategy.id));
  return historical.reservoir.filter((entry) => !active.has(entry.strategy.id)).map((entry) => entry.strategy);
}
function attackerDiagnostic(historical: LegacyFixedReservoirPoolArtifact,
  finalist: ProtocolScanEvidence['finalists'][number], evidence: FullCandidateEvidence): HistoricalAttackerDiagnostic {
  const candidateId = evidence.candidateTelemetryId ?? evidence.strategy.id;
  const acquisitions: Record<string, number> = {}, positions: Record<string, number> = {};
  const exposure = new Map<string, number[]>();
  for (const block of evidence.blocks) {
    for (const [id, count] of Object.entries(block.telemetry.acquisitionsByStrategy[candidateId] ?? {})) {
      acquisitions[id] = (acquisitions[id] ?? 0) + count;
    }
    for (const [position, count] of Object.entries(block.telemetry.planPositionPurchasesByStrategy?.[candidateId] ?? {})) {
      positions[position] = (positions[position] ?? 0) + count;
    }
    exposure.set(block.opponentId, [...(exposure.get(block.opponentId) ?? []), block.score]);
  }
  const games = evidence.blocks.length * 4;
  const acquisitionRates = Object.fromEntries(Object.entries(acquisitions).map(([id, count]) => [id, count / games]));
  const planPositionRates = Object.fromEntries(Object.entries(positions).map(([id, count]) => [id, count / games]));
  const action = Object.entries(acquisitionRates).filter(([id]) => cardDefinition(id).type === 'action');
  const actionTotal = action.reduce((sum, [, count]) => sum + count, 0);
  const normalizedActionCardShares = Object.fromEntries(action.map(([id, count]) => [id, actionTotal ? count / actionTotal : 0]));
  const damageTotals: Record<string, number> = { Melee: 0, Ranged: 0, Mage: 0 };
  for (const [id, count] of action) { const family = damageFamily(id); if (family) damageTotals[family] = damageTotals[family]! + count; }
  const damageTotal = Object.values(damageTotals).reduce((sum, count) => sum + count, 0);
  const damageFamilyShares = Object.fromEntries(Object.entries(damageTotals)
    .map(([family, count]) => [family, damageTotal ? count / damageTotal : 0]));
  const source = historical.reservoir.find((entry) => entry.strategy.id === evidence.strategy.id);
  if (!source) throw new Error(`Historical diagnostic source ${evidence.strategy.id} is missing.`);
  const opponentExposure = Object.fromEntries([...exposure].sort(([a], [b]) => a.localeCompare(b)).map(([id, scores]) =>
    [id, { blocks: scores.length, mean: scores.reduce((sum, score) => sum + score, 0) / scores.length }]));
  const rankedExposure = Object.entries(opponentExposure).map(([opponentId, result]) => ({ opponentId, ...result }))
    .sort((left, right) => right.mean - left.mean || left.opponentId.localeCompare(right.opponentId));
  return { strategy: evidence.strategy, canonicalStrategy: canonicalStrategy(evidence.strategy),
    sourceRank: source.goldfishRank, mean: finalist.mean, interval95: finalist.interval95, evidence,
    acquisitionRates, planPositionRates, normalizedActionCardShares, damageFamilyShares,
    classifierLabel: classifyStrategyDamage({ startingBuild: evidence.strategy.startingBuild, acquisitionRates }),
    opponentExposure, exposingOpponentIds: rankedExposure.filter((entry) => entry.mean > 0.5)
      .map((entry) => entry.opponentId), strongestOpponentExposure: rankedExposure[0] ?? null };
}
function validateHistoricalAudit(value: unknown, pool: OrderedChallengePoolArtifact,
  checkpoint: OrderedFullPsroCheckpoint, matrix: NestedMatrixEvidence,
  historical: LegacyFixedReservoirPoolArtifact): value is HistoricalAuditArtifact {
  try {
    if (!value || typeof value !== 'object') return false;
    const held = value as HistoricalAuditArtifact;
    const snapshot = nestedMatrixSnapshot(matrix, checkpoint.state.matrixDepth);
    const equilibrium = solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
    const { seedRoot, planner } = auditPlanner(pool, checkpoint.run, historical.poolSeed);
    const candidates = historicalCandidates(historical, snapshot);
    if (held.schemaVersion !== 1 || held.experiment !== 'ordered-reservoir-full-historical-audit'
      || held.version !== ORDERED_FULL_PSRO_VERSION || held.run !== checkpoint.run
      || held.historicalPoolSeed !== historical.poolSeed || held.historicalPoolHash !== historical.generatedHash
      || held.historicalReservoirHash !== historical.reservoirHash || held.targetHash !== panelTargetHash(checkpoint)
      || held.targetSnapshotHash !== lotterySnapshotHash(snapshot, equilibrium) || held.seedRoot !== seedRoot
      || held.scan.phase !== 'baseline-audit'
      || held.scan.namespace !== `full:run:${checkpoint.run}:historical:${historical.poolSeed}`
      || !exact(held.scan.protocol, raceProtocol('closure-union-cumulative-v1'))
      || !exact(held.scan.enteredStrategyIds, candidates.map((strategy) => strategy.id))
      || !validateProtocolScan(held.scan, snapshot, equilibrium, planner)
      || !validateConsistencySeedPlan(held.seedPlan) || !exact(held.seedPlan, planner.plan)
      || !Number.isFinite(held.elapsedMs) || held.elapsedMs < 0) return false;
    const confirmed = held.scan.finalists.filter((entry) => entry.admitted);
    if (!exact(held.confirmedStrategyIds, confirmed.map((entry) => entry.strategy.id))
      || held.diagnostics.length !== confirmed.length) return false;
    const expectedSchedule = held.scan.confirmationSchedule?.blocks;
    if (!expectedSchedule) return false;
    for (let index = 0; index < confirmed.length; index += 1) {
      const finalist = confirmed[index]!, diagnostic = held.diagnostics[index]!;
      if (diagnostic.strategy.id !== finalist.strategy.id
        || diagnostic.canonicalStrategy !== canonicalStrategy(finalist.strategy)
        || !validateFullCandidateEvidence(diagnostic.evidence,
          { strategy: finalist.strategy, blocks: expectedSchedule })
        || !exact(diagnostic.evidence.blocks.map((block) => block.score), finalist.blockScores)
        || !exact(diagnostic, attackerDiagnostic(historical, finalist, diagnostic.evidence))) return false;
    }
    const expectedMatches = held.scan.matches + held.diagnostics.reduce((sum, entry) =>
      sum + entry.evidence.blocks.length * 4, 0);
    if (held.matches !== expectedMatches) return false;
    const copy = structuredClone(held) as Partial<HistoricalAuditArtifact>;
    delete copy.evidenceHash; delete copy.elapsedMs;
    return held.evidenceHash === historicalAuditHash(
      copy as Omit<HistoricalAuditArtifact, 'evidenceHash' | 'elapsedMs'>);
  } catch { return false; }
}
async function ensureHistoricalAudits(pool: OrderedChallengePoolArtifact,
  checkpoint: OrderedFullPsroCheckpoint, matrix: NestedMatrixEvidence,
  runner: WorkerPairingRunner): Promise<HistoricalAuditArtifact[]> {
  const snapshot = nestedMatrixSnapshot(matrix, checkpoint.state.matrixDepth);
  const equilibrium = solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
  const target = positive(snapshot, equilibrium); const result: HistoricalAuditArtifact[] = [];
  for (const historicalSeed of ORDERED_RESERVOIR_HISTORICAL_SEEDS) {
    const historical = loadHistoricalPool(historicalSeed), file = auditFile(checkpoint.run, historicalSeed);
    if (fs.existsSync(file)) {
      const held = readJson<unknown>(file);
      if (!validateHistoricalAudit(held, pool, checkpoint, matrix, historical)) {
        throw new Error(`Invalid historical audit ${file}.`);
      }
      result.push(held); continue;
    }
    const started = performance.now(); const { seedRoot, planner } = auditPlanner(pool, checkpoint.run, historicalSeed);
    const scan = await runProtocolScan({ protocolId: 'closure-union-cumulative-v1', phase: 'baseline-audit',
      namespace: `full:run:${checkpoint.run}:historical:${historicalSeed}`,
      candidates: historicalCandidates(historical, snapshot), snapshot, equilibrium, planner,
      score: pairingScoreAllocation(runner, KINGDOM_ID) });
    const admitted = scan.finalists.filter((entry) => entry.admitted);
    const telemetry = admitted.length && scan.confirmationSchedule
      ? await evaluateFull(admitted.map((entry) => entry.strategy), target.opponents,
        scan.confirmationSchedule.blocks, runner) : [];
    const diagnostics = admitted.map((entry, index) => attackerDiagnostic(historical, entry, telemetry[index]!));
    const base: Omit<HistoricalAuditArtifact, 'evidenceHash' | 'elapsedMs'> = { schemaVersion: 1,
      experiment: 'ordered-reservoir-full-historical-audit', version: ORDERED_FULL_PSRO_VERSION,
      run: checkpoint.run, historicalPoolSeed: historicalSeed, historicalPoolHash: historical.generatedHash,
      historicalReservoirHash: historical.reservoirHash, targetHash: panelTargetHash(checkpoint),
      targetSnapshotHash: lotterySnapshotHash(snapshot, equilibrium), seedRoot, seedPlan: planner.plan, scan,
      confirmedStrategyIds: admitted.map((entry) => entry.strategy.id), diagnostics,
      matches: scan.matches + telemetry.reduce((sum, entry) => sum + entry.blocks.length * 4, 0) };
    const artifact: HistoricalAuditArtifact = { ...base, elapsedMs: performance.now() - started,
      evidenceHash: historicalAuditHash(base) };
    if (!validateHistoricalAudit(artifact, pool, checkpoint, matrix, historical)) {
      throw new Error(`Generated historical audit ${historicalSeed} is invalid.`);
    }
    writeAtomic(file, artifact); result.push(artifact);
  }
  return result;
}

async function runOne(pool: OrderedChallengePoolArtifact, run: 1 | 2, runner: WorkerPairingRunner): Promise<OrderedFullPsroCheckpoint> {
  let lastRecorded = performance.now(); let checkpoint = loadCheckpoint(pool, run);
  let matrix: NestedMatrixEvidence;
  if (checkpoint) {
    matrix = readJson<NestedMatrixEvidence>(matrixFile(run));
    if (!validateNestedMatrixEvidence(matrix)) throw new Error(`Run ${run} matrix is invalid.`);
    if (checkpoint.state.status === 'unresolved'
      || (checkpoint.state.status === 'complete' && checkpoint.panelEvidenceHashes.length
        && checkpoint.auditEvidenceHashes.length === ORDERED_RESERVOIR_HISTORICAL_SEEDS.length)) return checkpoint;
  } else {
    matrix = initialMatrix(pool, run); writeAtomic(matrixFile(run), matrix);
    checkpoint = writeCheckpoint(pool, run, initialFullPsroState(), matrix.strategies.map((strategy) => strategy.id),
      [], matrix, [], [], 0);
  }
  let state = checkpoint.state, shadowClasses = [...checkpoint.shadowClasses];
  const scanHashes = [...checkpoint.scanEvidenceHashes];
  while (state.status === 'running') {
    matrix = await fillMatrix(matrix, state.matrixDepth, runner, matrixFile(run), (saved) => {
      checkpoint = writeCheckpoint(pool, run, state, saved.strategies.map((strategy) => strategy.id),
        shadowClasses, saved, scanHashes, checkpoint!.panelEvidenceHashes, checkpoint!.elapsedMs);
    });
    const snapshot = nestedMatrixSnapshot(matrix, state.matrixDepth);
    if (!snapshot.complete) throw new Error('Full PSRO matrix is incomplete.');
    const equilibrium = solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
    const target = positive(snapshot, equilibrium), snapshotHash = evidenceHash({ depth: state.matrixDepth,
      strategies: snapshot.strategies.map((strategy) => canonicalStrategy(strategy)),
      centeredPayoffs: snapshot.centeredPayoffs, equilibrium });
    const active = new Set(matrix.strategies.map((strategy) => strategy.id));
    const inactive = pool.reservoir.filter((entry) => !active.has(entry.strategy.id)).map((entry) => ({
      strategy: entry.strategy, goldfishRank: entry.goldfishRank }));
    const rows = await screenCandidates(pool, run, state.scan, inactive, target.opponents, target.weights,
      snapshotHash, runner);
    const selection = selectFullScreenCandidates(rows, { allowOversize: true });
    if (selection.widthExceeded) {
      const next: FullPsroState = { ...state, scan: state.scan + 1,
        status: 'unresolved', stopReason: 'screen-width-unresolved' };
      const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-full-scan' as const,
        version: ORDERED_FULL_PSRO_VERSION, run, scan: state.scan, snapshotHash, selection,
        decisions: [], looks: [], classes: [], representatives: [], shadows: [], retainedShadowIds: [],
        divergedShadowIds: [], matrixPrecision: null, stateBefore: state, stateAfter: next,
        terminalReason: 'screen-width-unresolved', matches: rows.length * 200,
        children: scanChildren(run, state.scan) };
      const summary: ScanSummary = { ...base, evidenceHash: evidenceHash(base) };
      writeAtomic(scanSummaryFile(run, state.scan), summary); scanHashes.push(summary.evidenceHash);
      state = next; break;
    }
    const byId = new Map(inactive.map((entry) => [entry.strategy.id, entry.strategy]));
    const candidates = selection.strategyIds.map((id) => byId.get(id)!);
    const confirmed = await confirmCandidates(pool, run, state.scan, snapshotHash, candidates,
      target.opponents, target.weights, runner);
    const admittedIds = new Set(confirmed.decisions.filter((entry) => entry.decision === 'admitted')
      .map((entry) => entry.strategyId));
    const admitted = confirmed.evidence.filter((entry) => admittedIds.has(entry.strategy.id));
    const knownShadow = new Set(shadowClasses.flatMap((group) => group.shadowIds));
    const confirmedKnown = confirmed.evidence.filter((entry) => knownShadow.has(entry.strategy.id));
    const anchorEvidence = new Map<string, FullCandidateEvidence>(); let anchorMatches = 0;
    if (confirmedKnown.length) {
      const blocksByLength = new Map<number, string[]>();
      for (const evidence of confirmedKnown) {
        const representative = shadowClasses.find((group) => group.shadowIds.includes(evidence.strategy.id))!.activeRepresentativeId;
        blocksByLength.set(evidence.blocks.length, [...(blocksByLength.get(evidence.blocks.length) ?? []), representative]);
      }
      for (const [length, ids] of blocksByLength) {
        const representatives = [...new Set(ids)].sort();
        const strategies = representatives.map((id) => {
          const source = matrix.strategies.find((strategy) => strategy.id === id);
          if (!source) throw new Error(`Missing active shadow representative ${id}.`);
          return { ...source, id: shadowAnchorSyntheticId({ run, scan: state.scan,
            representativeId: id, blocks: length }) };
        });
        const blocks = schedule(pool, run, `scan:${state.scan}:confirmation`, 6_400, target.weights).blocks.slice(0, length);
        const file = anchorFile(run, state.scan, length); let anchors: FullCandidateEvidence[];
        if (fs.existsSync(file)) {
          const held = readJson<{ evidence: FullCandidateEvidence[]; evidenceHash: string }>(file);
          const copy = { schemaVersion: 1, experiment: 'ordered-reservoir-full-shadow-anchors',
            version: ORDERED_FULL_PSRO_VERSION, run, scan: state.scan, poolHash: pool.generatedHash,
            reservoirHash: pool.reservoirHash, snapshotHash, blocks: length,
            strategyIds: representatives, evidence: held.evidence };
          if (held.evidenceHash !== evidenceHash(copy)) throw new Error(`Invalid shadow anchors ${file}.`);
          anchors = held.evidence;
        } else {
          anchors = (await evaluateFull(strategies, target.opponents, blocks, runner)).map((entry, index) => ({
            ...entry, strategy: matrix.strategies.find((strategy) => strategy.id === representatives[index])!,
            candidateTelemetryId: entry.strategy.id
          }));
          const base = { schemaVersion: 1, experiment: 'ordered-reservoir-full-shadow-anchors',
            version: ORDERED_FULL_PSRO_VERSION, run, scan: state.scan, poolHash: pool.generatedHash,
            reservoirHash: pool.reservoirHash, snapshotHash, blocks: length,
            strategyIds: representatives, evidence: anchors };
          writeAtomic(file, { ...base, evidenceHash: evidenceHash(base) });
        }
        anchors.forEach((entry) => {
          anchorEvidence.set(`${entry.strategy.id}:${length}`, entry); anchorMatches += entry.blocks.length * 4;
        });
      }
      if (confirmedKnown.some((entry) => {
        const representative = shadowClasses.find((group) => group.shadowIds.includes(entry.strategy.id))!.activeRepresentativeId;
        return !anchorEvidence.has(`${representative}:${entry.blocks.length}`);
      })) throw new Error('Shadow anchor evidence is incomplete.');
    }
    const collapsed = collapseAcquisitionEquivalentAdmissions({ evidence: confirmed.evidence, admittedIds,
      existingShadows: shadowClasses, anchorEvidence });
    const diverged = new Set(collapsed.divergedShadowIds);
    const retainedExistingShadows = shadowClasses.map((group) => ({ ...group,
      memberIds: group.memberIds.filter((id) => !diverged.has(id)),
      shadowIds: group.shadowIds.filter((id) => !diverged.has(id))
    })).filter((group) => group.shadowIds.length);
    if (confirmed.widthFailure) {
      const next: FullPsroState = { ...state, scan: state.scan + 1,
        status: 'unresolved', stopReason: 'confirmation-width-unresolved' };
      const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-full-scan' as const,
        version: ORDERED_FULL_PSRO_VERSION, run, scan: state.scan, snapshotHash, selection,
        decisions: confirmed.decisions, looks: confirmed.looks, classes: acquisitionEquivalentClasses(admitted),
        representatives: collapsed.representatives.map((entry) => entry.strategy.id), shadows: collapsed.shadows,
        retainedShadowIds: collapsed.retainedShadowIds, divergedShadowIds: collapsed.divergedShadowIds,
        matrixPrecision: null, stateBefore: state, stateAfter: next,
        terminalReason: 'confirmation-width-unresolved',
        matches: rows.length * 200 + confirmed.evidence.reduce((sum, entry) => sum + entry.blocks.length * 4, 0)
          + anchorMatches, children: scanChildren(run, state.scan) };
      const summary: ScanSummary = { ...base, evidenceHash: evidenceHash(base) };
      writeAtomic(scanSummaryFile(run, state.scan), summary); scanHashes.push(summary.evidenceHash);
      shadowClasses = retainedExistingShadows; state = next; break;
    }
    if (matrix.strategies.length + collapsed.representatives.length > ORDERED_FULL_PSRO_MATRIX_WIDTH) {
      const next: FullPsroState = { ...state, scan: state.scan + 1,
        status: 'unresolved', stopReason: 'matrix-width-unresolved' };
      const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-full-scan' as const,
        version: ORDERED_FULL_PSRO_VERSION, run, scan: state.scan, snapshotHash, selection,
        decisions: confirmed.decisions, looks: confirmed.looks, classes: acquisitionEquivalentClasses(admitted),
        representatives: collapsed.representatives.map((entry) => entry.strategy.id), shadows: collapsed.shadows,
        retainedShadowIds: collapsed.retainedShadowIds, divergedShadowIds: collapsed.divergedShadowIds,
        matrixPrecision: null, stateBefore: state, stateAfter: next, terminalReason: 'matrix-width-unresolved',
        matches: rows.length * 200 + confirmed.evidence.reduce((sum, entry) => sum + entry.blocks.length * 4, 0)
          + anchorMatches, children: scanChildren(run, state.scan) };
      const summary: ScanSummary = { ...base, evidenceHash: evidenceHash(base) };
      writeAtomic(scanSummaryFile(run, state.scan), summary); scanHashes.push(summary.evidenceHash);
      shadowClasses = retainedExistingShadows; state = next; break;
    }
    const classes = acquisitionEquivalentClasses(admitted);
    shadowClasses = [...retainedExistingShadows, ...collapsed.shadows];
    if (collapsed.representatives.length) {
      matrix = withNestedMatrixStrategies(matrix, collapsed.representatives.map((entry) => entry.strategy));
      writeAtomic(matrixFile(run), matrix);
    }
    const unresolved = confirmed.decisions.filter((entry) => entry.decision === 'unresolved').length;
    const precision = collapsed.representatives.length || unresolved
      || state.matrixDepth === 50 || state.cleanAtDepth + 1 < 2 ? null
      : precisionComparison(matrix, state.matrixDepth === 100 ? 50 : 100, state.matrixDepth);
    const next = transitionFullPsroState(state, { representativeAdmissions: collapsed.representatives.length,
      unresolved, ...(precision === null ? {} : { precisionStable: precision.passed }) });
    const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-full-scan' as const,
      version: ORDERED_FULL_PSRO_VERSION, run, scan: state.scan, snapshotHash, selection,
      decisions: confirmed.decisions, looks: confirmed.looks, classes,
      representatives: collapsed.representatives.map((entry) => entry.strategy.id),
      shadows: collapsed.shadows, retainedShadowIds: collapsed.retainedShadowIds,
      divergedShadowIds: collapsed.divergedShadowIds, matrixPrecision: precision,
      stateBefore: state, stateAfter: next, terminalReason: next.status === 'unresolved' ? next.stopReason : null,
      matches: rows.length * 200 + confirmed.evidence.reduce((sum, entry) => sum + entry.blocks.length * 4, 0)
        + anchorMatches,
      children: scanChildren(run, state.scan) };
    const summary: ScanSummary = { ...base, evidenceHash: evidenceHash(base) };
    writeAtomic(scanSummaryFile(run, state.scan), summary); scanHashes.push(summary.evidenceHash);
    state = next;
    const recorded = performance.now();
    checkpoint = writeCheckpoint(pool, run, state, matrix.strategies.map((strategy) => strategy.id),
      shadowClasses, matrix, scanHashes, [], checkpoint.elapsedMs + recorded - lastRecorded);
    lastRecorded = recorded;
  }
  const searchRecorded = performance.now();
  checkpoint = writeCheckpoint(pool, run, state, matrix.strategies.map((strategy) => strategy.id),
    shadowClasses, matrix, scanHashes, checkpoint.panelEvidenceHashes,
    checkpoint.elapsedMs + searchRecorded - lastRecorded);
  lastRecorded = searchRecorded;
  if (state.status === 'complete') {
    try {
      const panelResult = await ensurePanels(pool, checkpoint, matrix, runner);
      if (!panelResult.passed) {
        state = { ...state, status: 'unresolved', stopReason: 'acquisition-panel-unresolved' };
        checkpoint = writeCheckpoint(pool, run, state, matrix.strategies.map((strategy) => strategy.id), shadowClasses,
          matrix, scanHashes, panelResult.panels.map((panel) => panel.evidenceHash),
          checkpoint.elapsedMs + performance.now() - lastRecorded);
      } else {
        checkpoint = writeCheckpoint(pool, run, state, matrix.strategies.map((strategy) => strategy.id), shadowClasses,
          matrix, scanHashes, panelResult.panels.map((panel) => panel.evidenceHash),
          checkpoint.elapsedMs + performance.now() - lastRecorded, checkpoint.auditEvidenceHashes);
        lastRecorded = performance.now();
        const audits = await ensureHistoricalAudits(pool, checkpoint, matrix, runner);
        checkpoint = writeCheckpoint(pool, run, state, matrix.strategies.map((strategy) => strategy.id), shadowClasses,
          matrix, scanHashes, panelResult.panels.map((panel) => panel.evidenceHash),
          checkpoint.elapsedMs + performance.now() - lastRecorded, audits.map((audit) => audit.evidenceHash));
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      if (reason !== 'support-width-unresolved') throw error;
      state = { ...state, status: 'unresolved', stopReason: reason };
      checkpoint = writeCheckpoint(pool, run, state, matrix.strategies.map((strategy) => strategy.id), shadowClasses,
        matrix, scanHashes, [], checkpoint.elapsedMs + performance.now() - lastRecorded);
    }
  }
  return checkpoint;
}

function runReport(pool: OrderedChallengePoolArtifact, tolerateInvalid = false): { runs: unknown[] } {
  const runs = ORDERED_FULL_PSRO_RUNS.map((run) => {
    let checkpoint: OrderedFullPsroCheckpoint | null;
    try { checkpoint = loadCheckpoint(pool, run); } catch (error) {
      if (!tolerateInvalid) throw error;
      return { run, status: 'invalid', error: error instanceof Error ? error.message : String(error) };
    }
    if (!checkpoint) return { run, status: 'missing' };
    const scans = checkpoint.scanEvidenceHashes.map((_hash, index) => readJson<ScanSummary>(scanSummaryFile(run, index)));
    const panels = checkpoint.panelEvidenceHashes.map((_hash, index) => readJson<PanelArtifact>(panelFile(run, index + 1)));
    const audits = checkpoint.auditEvidenceHashes.map((_hash, index) =>
      readJson<HistoricalAuditArtifact>(auditFile(run, ORDERED_RESERVOIR_HISTORICAL_SEEDS[index]!)));
    const matrix = readJson<NestedMatrixEvidence>(matrixFile(run));
    const snapshot = nestedMatrixSnapshot(matrix, checkpoint.state.matrixDepth);
    const equilibrium = snapshot.complete ? solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id),
      snapshot.centeredPayoffs) : null;
    const classWeights = checkpoint.shadowClasses.map((group) => ({ representativeId: group.activeRepresentativeId,
      memberIds: group.memberIds, shadowIds: group.shadowIds,
      weight: equilibrium?.weights[group.activeRepresentativeId] ?? null,
      maximumFeasibleWeight: equilibrium?.maximumEquilibriumWeight[group.activeRepresentativeId] ?? null }));
    const matrixGames = matrix.cells.reduce((sum, cell) => sum
      + cell.batches.reduce((batchSum, batch) => batchSum + batch.matches, 0), 0);
    const scanGames = scans.reduce((sum, scan) => sum + scan.matches, 0);
    const panelGames = panels.reduce((sum, panel) => sum
      + panel.evidence.reduce((panelSum, evidence) => panelSum + evidence.blocks.length * 4, 0), 0);
    const finished = checkpoint.state.status === 'unresolved' || (checkpoint.state.status === 'complete'
      && panels.length > 0 && audits.length === ORDERED_RESERVOIR_HISTORICAL_SEEDS.length);
    return { run, status: finished ? checkpoint.state.status : 'running', stopReason: checkpoint.state.stopReason,
      matrixDepth: checkpoint.state.matrixDepth, matrixWidth: checkpoint.activeStrategyIds.length,
      games: { matrix: matrixGames, scans: scanGames, panels: panelGames,
        audits: audits.reduce((sum, audit) => sum + audit.matches, 0),
        total: matrixGames + scanGames + panelGames + audits.reduce((sum, audit) => sum + audit.matches, 0) },
      scans: scans.map((scan) => {
        const strongest = [...scan.decisions].sort((a, b) => b.mean - a.mean)[0] ?? null;
        const strongestRetired = [...scan.decisions].filter((entry) => entry.decision === 'retired')
          .sort((a, b) => b.bounds95.upper - a.bounds95.upper || b.mean - a.mean)[0] ?? null;
        return { advanced: scan.selection.strategyIds.length, boundaries: scan.selection.boundaries,
          tieWidths: scan.selection.tieWidths,
          scoreEquivalentGroups: scan.selection.scoreEquivalentGroups.length,
          looks: scan.looks.map((look) => ({ blocks: look.blocks, active: look.activeStrategyIds.length,
            retired: look.decisions.filter((entry) => entry.decision === 'retired').length,
            continued: look.decisions.filter((entry) => entry.decision === 'continue').length,
            admitted: look.decisions.filter((entry) => entry.decision === 'admitted').length,
            unresolved: look.decisions.filter((entry) => entry.decision === 'unresolved').length,
            continuationLimit: look.continuationLimit, widthExceeded: look.widthExceeded })),
          admittedIds: scan.decisions.filter((entry) => entry.decision === 'admitted').length,
          representatives: scan.representatives.length,
          shadows: scan.shadows.reduce((sum, group) => sum + group.shadowIds.length, 0),
          retainedShadowIds: scan.retainedShadowIds, divergedShadowIds: scan.divergedShadowIds,
          unresolved: scan.decisions.filter((entry) => entry.decision === 'unresolved').length,
          strongest, strongestRetired, matrixPrecision: scan.matrixPrecision,
          stateBefore: scan.stateBefore, stateAfter: scan.stateAfter, terminalReason: scan.terminalReason };
      }),
      classWeights, strategyWeights: equilibrium ? equilibrium.strategyIds.map((id) => ({ strategyId: id,
        selectedWeight: equilibrium.weights[id] ?? 0,
        maximumFeasibleWeight: equilibrium.maximumEquilibriumWeight[id] ?? 0 })) : [],
      panelRanges: panels.map((panel) => panel.summary), panelGate: panelStabilityDiagnostics(panels),
      historicalAudits: audits.map((audit) => ({ poolSeed: audit.historicalPoolSeed,
        scanned: audit.scan.completeCandidateCoverage, confirmedStrategyIds: audit.confirmedStrategyIds,
        diagnostics: audit.diagnostics, matches: audit.matches })),
      final: panels.length ? pooledPanelSummary(matrix, checkpoint.state.matrixDepth, panels) : null,
      elapsedMs: checkpoint.elapsedMs, checkpointHash: checkpoint.evidenceHash };
  });
  return { runs };
}
function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  const intersection = [...left].filter((id) => right.has(id)).sort();
  const union = [...new Set([...left, ...right])].sort();
  return { intersection, union, jaccard: union.length ? intersection.length / union.length : 1 };
}
function comparisonBase(pool: OrderedChallengePoolArtifact, checkpoints: readonly OrderedFullPsroCheckpoint[],
  schedules: { run1Candidates: MixtureSchedule; run2Opponents: MixtureSchedule },
  blockScores: readonly number[]) {
  if (checkpoints.length !== 2 || blockScores.length !== 10_000
    || blockScores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
    throw new Error('Comparison evidence is incomplete.');
  }
  const lotteries = checkpoints.map((checkpoint) => {
    const matrix = readJson<NestedMatrixEvidence>(matrixFile(checkpoint.run));
    const snapshot = nestedMatrixSnapshot(matrix, checkpoint.state.matrixDepth);
    const equilibrium = solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
    const panels = checkpoint.panelEvidenceHashes.map((_hash, index) =>
      readJson<PanelArtifact>(panelFile(checkpoint.run, index + 1)));
    const scans = checkpoint.scanEvidenceHashes.map((_hash, index) => readJson<ScanSummary>(scanSummaryFile(checkpoint.run, index)));
    return { checkpoint, equilibrium, positive: positive(snapshot, equilibrium),
      panel: pooledPanelSummary(matrix, checkpoint.state.matrixDepth, panels), scans };
  });
  const expectedSchedules = { run1Candidates: schedule(pool, 1, 'comparison:row', 10_000,
    lotteries[0]!.positive.weights), run2Opponents: schedule(pool, 2, 'comparison:column', 10_000,
    lotteries[1]!.positive.weights) };
  if (!exact(schedules, expectedSchedules)) throw new Error('Comparison schedule is invalid.');
  const score = blockScores.reduce((sum, value) => sum + value, 0) / blockScores.length;
  const bounds95 = anytimeConfidenceBounds(blockScores), panels = lotteries.map((lottery) => lottery.panel);
  const cards = [...new Set(panels.flatMap((panel) => Object.keys(panel.normalizedActionCardShares)))].sort();
  const totalVariation = cards.reduce((sum, card) => sum + Math.abs(
    (panels[0]!.normalizedActionCardShares[card] ?? 0) - (panels[1]!.normalizedActionCardShares[card] ?? 0)), 0) / 2;
  const archetypes = [...new Set(panels.flatMap((panel) => Object.keys(panel.selectedArchetypeShares)))].sort();
  const archetypeGates = Object.fromEntries(archetypes.map((name) => {
    const selectedDelta = Math.abs((panels[0]!.selectedArchetypeShares[name] ?? 0)
      - (panels[1]!.selectedArchetypeShares[name] ?? 0));
    const minimumDelta = Math.abs((panels[0]!.feasibleArchetypeRanges[name]?.minimum ?? 0)
      - (panels[1]!.feasibleArchetypeRanges[name]?.minimum ?? 0));
    const maximumDelta = Math.abs((panels[0]!.feasibleArchetypeRanges[name]?.maximum ?? 0)
      - (panels[1]!.feasibleArchetypeRanges[name]?.maximum ?? 0));
    return [name, { selectedDelta, minimumDelta, maximumDelta,
      passed: selectedDelta <= 0.02 && minimumDelta <= 0.02 && maximumDelta <= 0.02 }];
  }));
  const cardGates = Object.fromEntries(cards.map((card) => {
    const material = Math.max(panels[0]!.normalizedActionCardShares[card] ?? 0,
      panels[1]!.normalizedActionCardShares[card] ?? 0) >= 0.01
      || Math.max(panels[0]!.expectedCopiesPerPlayerGame[card] ?? 0,
        panels[1]!.expectedCopiesPerPlayerGame[card] ?? 0) >= 0.02;
    const shareDelta = Math.abs((panels[0]!.normalizedActionCardShares[card] ?? 0)
      - (panels[1]!.normalizedActionCardShares[card] ?? 0));
    const copiesDelta = Math.abs((panels[0]!.expectedCopiesPerPlayerGame[card] ?? 0)
      - (panels[1]!.expectedCopiesPerPlayerGame[card] ?? 0));
    return [card, { material, shareDelta, copiesDelta, passed: !material || shareDelta <= 0.02 && copiesDelta <= 0.02 }];
  }));
  const gates = { directScore: { value: score, minimum: 0.49, maximum: 0.51,
      passed: score >= 0.49 && score <= 0.51 },
    intervalContainsHalf: { lower: bounds95.lower, upper: bounds95.upper,
      passed: bounds95.lower <= 0.5 && bounds95.upper >= 0.5 },
    totalVariation: { value: totalVariation, maximum: 0.05, passed: totalVariation <= 0.05 },
    archetypes: archetypeGates, cards: cardGates };
  const passed = gates.directScore.passed && gates.intervalContainsHalf.passed && gates.totalVariation.passed
    && Object.values(archetypeGates).every((gate) => gate.passed)
    && Object.values(cardGates).every((gate) => gate.passed);
  const supportSets = lotteries.map((lottery) => new Set(lottery.equilibrium.strategyIds.filter((id) =>
    (lottery.equilibrium.weights[id] ?? 0) > 1e-8)));
  const admittedSets = lotteries.map((lottery) => new Set(lottery.scans.flatMap((scan) => scan.decisions
    .filter((entry) => entry.decision === 'admitted').map((entry) => entry.strategyId))));
  const scoreClassSets = lotteries.map((lottery) => new Set(lottery.scans.flatMap((scan) =>
    scan.selection.scoreEquivalentGroups.map((ids) => [...ids].sort().join('|')))));
  const acquisitionClassSets = lotteries.map((lottery) => new Set(lottery.scans.flatMap((scan) =>
    scan.classes.map((group) => [...group.memberIds].sort().join('|')))));
  const exactIds = new Set(lotteries.flatMap((lottery) => lottery.equilibrium.strategyIds));
  const exactIdTotalVariation = [...exactIds].reduce((sum, id) => sum + Math.abs(
    (lotteries[0]!.equilibrium.weights[id] ?? 0) - (lotteries[1]!.equilibrium.weights[id] ?? 0)), 0) / 2;
  return { schemaVersion: 1, experiment: 'ordered-reservoir-full-comparison',
    version: ORDERED_FULL_PSRO_VERSION, checkpointHashes: checkpoints.map((entry) => entry.evidenceHash),
    schedules, blockScores: [...blockScores], blocks: blockScores.length, score, bounds95, gates, passed,
    decision: passed ? 'run-1-representative' : 'two-run-inconsistent', totalVariation,
    diagnostics: { admittedIds: overlap(admittedSets[0]!, admittedSets[1]!),
      selectedSupport: overlap(supportSets[0]!, supportSets[1]!),
      scoreEquivalenceClasses: overlap(scoreClassSets[0]!, scoreClassSets[1]!),
      acquisitionEquivalenceClasses: overlap(acquisitionClassSets[0]!, acquisitionClassSets[1]!),
      exactIdTotalVariation,
      strategyWeights: lotteries.map((lottery) => Object.fromEntries(lottery.equilibrium.strategyIds.map((id) =>
        [id, { selected: lottery.equilibrium.weights[id] ?? 0,
          maximumFeasible: lottery.equilibrium.maximumEquilibriumWeight[id] ?? 0 }]))) } };
}
function validComparison(value: unknown, pool: OrderedChallengePoolArtifact,
  checkpoints: readonly OrderedFullPsroCheckpoint[]): boolean {
  try {
    if (!value || typeof value !== 'object') return false;
    const held = value as ReturnType<typeof comparisonBase> & { evidenceHash: string };
    const expected = comparisonBase(pool, checkpoints, held.schedules, held.blockScores);
    return exact(held, { ...expected, evidenceHash: evidenceHash(expected) });
  } catch { return false; }
}

function writeReport(pool: OrderedChallengePoolArtifact): void {
  let comparison: Record<string, unknown> | null = null;
  if (fs.existsSync(comparisonFile())) {
    const held = readJson<Record<string, unknown>>(comparisonFile());
    const checkpoints = ORDERED_FULL_PSRO_RUNS.map((run) => loadCheckpoint(pool, run));
    if (checkpoints.some((entry) => !entry) || !validComparison(held, pool,
      checkpoints as OrderedFullPsroCheckpoint[])) throw new Error('Comparison report evidence is invalid.');
    comparison = held;
  }
  const report = { schemaVersion: 1, experiment: 'ordered-reservoir-full-psro-report',
    version: ORDERED_FULL_PSRO_VERSION, ...runReport(pool), comparison };
  writeAtomic(reportFile('json'), report);
  const lines = ['# Ordered-reservoir full PSRO report', '', ...report.runs.flatMap((entry) => {
    const run = entry as { run: number; status: string; stopReason?: string; matrixWidth?: number; matrixDepth?: number;
      games?: { matrix: number; scans: number; panels: number; audits: number; total: number };
      scans?: Array<{ advanced: number; admittedIds: number; representatives: number; shadows: number; unresolved: number;
        tieWidths: { laneA: number; laneB: number; pooled: number; boundaryAudit: number };
        looks: Array<{ blocks: number; retired: number; continued: number; admitted: number; unresolved: number }>;
        strongest: { mean: number; bounds95: { lower: number; upper: number } } | null;
        strongestRetired: { mean: number; bounds95: { upper: number } } | null }>;
      classWeights?: Array<{ representativeId: string; memberIds: string[]; weight: number | null }>;
      historicalAudits?: Array<{ poolSeed: number; scanned: number; confirmedStrategyIds: string[];
        diagnostics: HistoricalAttackerDiagnostic[] }>;
      final?: LotteryAcquisitionSummary | null };
    const result = [`## Run ${run.run}`, '', `Status: ${run.status}${run.stopReason ? ` (${run.stopReason})` : ''}.`,
      ...(run.matrixWidth ? [`Matrix: ${run.matrixWidth} representatives at ${run.matrixDepth} blocks.`] : []),
      ...(run.games ? [`Games: ${run.games.total.toLocaleString()} total (${run.games.matrix.toLocaleString()} matrix, `
        + `${run.games.scans.toLocaleString()} screen/confirmation, ${run.games.panels.toLocaleString()} panels, `
        + `${run.games.audits.toLocaleString()} historical audit).`] : [])];
    if (run.scans?.length) result.push('', '| Scan | Advanced | Boundary ties A/B/pooled/audit | Per-ID admissions | Representatives | Shadows | Unresolved | Strongest mean (95% anytime) |',
      '|---:|---:|---|---:|---:|---:|---:|---|', ...run.scans.map((scan, index) =>
        `| ${index + 1} | ${scan.advanced} | ${scan.tieWidths.laneA}/${scan.tieWidths.laneB}/${scan.tieWidths.pooled}/${scan.tieWidths.boundaryAudit} | ${scan.admittedIds} | ${scan.representatives} | ${scan.shadows} | ${scan.unresolved} | ${scan.strongest ? `${(100 * scan.strongest.mean).toFixed(2)}% (${(100 * scan.strongest.bounds95.lower).toFixed(2)}%–${(100 * scan.strongest.bounds95.upper).toFixed(2)}%)` : 'none'} |`),
      '', '| Scan/look | Retire | Continue | Admit | Unresolved |', '|---|---:|---:|---:|---:|',
      ...run.scans.flatMap((scan, index) => scan.looks.map((look) =>
        `| ${index + 1}/${look.blocks} | ${look.retired} | ${look.continued} | ${look.admitted} | ${look.unresolved} |`)));
    if (run.classWeights?.length) result.push('', 'Acquisition-equivalent classes:',
      ...run.classWeights.map((group) => `- ${group.representativeId}: ${(100 * (group.weight ?? 0)).toFixed(3)}% class weight; `
        + `${group.memberIds.length} members.`));
    if (run.historicalAudits?.length) result.push('', 'Historical audits:',
      ...run.historicalAudits.flatMap((audit) => [`- Pool ${audit.poolSeed}: ${audit.scanned} scanned; `
        + `${audit.confirmedStrategyIds.length} confirmed attacks.`, ...audit.diagnostics.map((diagnostic) =>
        `  - ${diagnostic.strategy.id} at historical rank ${diagnostic.sourceRank}: ${(100 * diagnostic.mean).toFixed(2)}% `
          + `(${(100 * diagnostic.interval95.lower).toFixed(2)}%–${(100 * diagnostic.interval95.upper).toFixed(2)}%); `
          + `${diagnostic.classifierLabel}; acquisitions ${JSON.stringify(diagnostic.acquisitionRates)}.`)]));
    if (run.final) {
      result.push('', 'Selected archetype shares:', ...Object.entries(run.final.selectedArchetypeShares)
        .map(([label, share]) => `- ${label}: ${(100 * share).toFixed(3)}% `
          + `(${(100 * run.final!.feasibleArchetypeRanges[label]!.minimum).toFixed(3)}%–`
          + `${(100 * run.final!.feasibleArchetypeRanges[label]!.maximum).toFixed(3)}% feasible).`),
      '', 'Material acquired cards:', ...Object.entries(run.final.expectedCopiesPerPlayerGame)
        .filter(([id, copies]) => copies >= 0.02 || (run.final!.normalizedActionCardShares[id] ?? 0) >= 0.01)
        .sort((left, right) => right[1] - left[1]).map(([id, copies]) =>
          `- ${id}: ${copies.toFixed(4)} copies/player-game; `
          + `${(100 * (run.final!.normalizedActionCardShares[id] ?? 0)).toFixed(2)}% of action acquisitions.`));
    }
    return [...result, ''];
  })];
  if (comparison) lines.push('## Two-run comparison', '',
    `Decision: ${String(comparison.decision)}.`,
    `Direct cross-play: ${(100 * Number(comparison.score)).toFixed(3)}% `
      + `(${(100 * Number((comparison.bounds95 as { lower: number }).lower)).toFixed(3)}%–`
      + `${(100 * Number((comparison.bounds95 as { upper: number }).upper)).toFixed(3)}%).`,
    `Acquisition-vector total variation: ${Number(comparison.totalVariation).toFixed(4)}.`,
    `Gate deltas: ${JSON.stringify(comparison.gates)}.`,
    `Overlap and maximum-weight diagnostics: ${JSON.stringify(comparison.diagnostics)}.`, '');
  fs.writeFileSync(reportFile('md'), `${lines.join('\n')}\n`); console.log(reportFile('md'));
}

async function compareRuns(pool: OrderedChallengePoolArtifact, runner: WorkerPairingRunner): Promise<void> {
  const values = ORDERED_FULL_PSRO_RUNS.map((run) => loadCheckpoint(pool, run));
  if (values.some((entry) => !entry || entry.state.status !== 'complete'
    || !entry.panelEvidenceHashes.length
    || entry.auditEvidenceHashes.length !== ORDERED_RESERVOIR_HISTORICAL_SEEDS.length)) {
    throw new Error('Comparison needs two deeply valid complete runs.');
  }
  const checkpoints = values as OrderedFullPsroCheckpoint[];
  if (fs.existsSync(comparisonFile())) {
    const held = readJson<unknown>(comparisonFile());
    if (!validComparison(held, pool, checkpoints)) throw new Error('Saved comparison artifact is invalid.');
    console.log(comparisonFile()); return;
  }
  const lotteries = checkpoints.map((checkpoint) => {
    const matrix = readJson<NestedMatrixEvidence>(matrixFile(checkpoint.run));
    const snapshot = nestedMatrixSnapshot(matrix, checkpoint.state.matrixDepth);
    const equilibrium = solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
    return { equilibrium, positive: positive(snapshot, equilibrium) };
  });
  const schedules = { run1Candidates: schedule(pool, 1, 'comparison:row', 10_000,
    lotteries[0]!.positive.weights), run2Opponents: schedule(pool, 2, 'comparison:column', 10_000,
    lotteries[1]!.positive.weights) };
  const jobs: PairingJob[] = schedules.run1Candidates.blocks.map((block, index) => ({
    candidate: lotteries[0]!.positive.opponents.get(block.opponentId)!,
    opponent: lotteries[1]!.positive.opponents.get(schedules.run2Opponents.blocks[index]!.opponentId)!,
    options: { kingdomId: KINGDOM_ID, seeds: [block.seed], turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
      actionCapPerTurn: ACTION_CAP_PER_TURN, startingDraftEnabled: false, allowEarlyStop: false } }));
  const outcome = await runner.run(jobs), blockScores = outcome.outcomes.map((entry) => {
    if (!entry || entry.record.aborted || entry.blocks[0]?.played !== 4) throw new Error('Cross-play block is invalid.');
    return entry.blocks[0].score;
  });
  const base = comparisonBase(pool, checkpoints, schedules, blockScores);
  writeAtomic(comparisonFile(), { ...base, evidenceHash: evidenceHash(base) }); console.log(comparisonFile());
}

const runArgument = process.argv.indexOf('--run');
const mode = runArgument >= 0 ? 'run' : process.argv.includes('--status') ? 'status'
  : process.argv.includes('--report') ? 'report' : process.argv.includes('--compare') ? 'compare' : null;
if (!mode) throw new Error('Use --run 1, --run 2, --status, --report, or --compare.');
kingdom();
const pool = loadOrPreparePool();
if (!validateOrderedFullPsroSeedPlan(pool.reservoirHash)) throw new Error('Full PSRO seed plan is invalid.');
if (mode === 'status') {
  console.log(JSON.stringify(runReport(pool, true), null, 2));
} else if (mode === 'report') {
  writeReport(pool);
} else {
  const runner = createRunner();
  try {
    if (mode === 'compare') { await compareRuns(pool, runner); writeReport(pool); }
    else {
      const number = Number(process.argv[runArgument + 1]);
      if (number !== 1 && number !== 2) throw new Error('Full PSRO accepts only run 1 or run 2.');
      if (number === 2) {
        const first = loadCheckpoint(pool, 1);
        if (!first || (first.state.status !== 'unresolved' && (first.state.status !== 'complete'
          || !first.panelEvidenceHashes.length
          || first.auditEvidenceHashes.length !== ORDERED_RESERVOIR_HISTORICAL_SEEDS.length))) {
          throw new Error('Run 1 must be terminal before Run 2 starts.');
        }
      }
      const checkpoint = await runOne(pool, number, runner);
      console.log(JSON.stringify({ run: number, status: checkpoint.state.status,
        stopReason: checkpoint.state.stopReason, checkpointHash: checkpoint.evidenceHash }, null, 2));
      writeReport(pool);
    }
  } finally { await runner.close(); }
}
