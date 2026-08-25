import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { registerKingdom } from '../src/game';
import { anytimeConfidenceBounds } from '../src/sim/anytimeMeanEvidence';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { equilibriumGroupWeightRange, solveEquilibrium } from '../src/sim/equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import { mixtureSchedule } from '../src/sim/mixtureEvaluation';
import type { MixtureSchedule } from '../src/sim/mixtureEvaluation';
import {
  acquisitionEquivalentClasses, stratifiedOpponentSchedule, summarizeLotteryAcquisitions
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
  transitionFullPsroState, validateOrderedFullPsroCheckpoint, validateOrderedFullPsroSeedPlan
} from '../src/sim/orderedReservoirFullPsro';
import type {
  FullPsroState, FullScreenCandidate, OrderedFullPsroCheckpoint, ShadowEquivalentClass
} from '../src/sim/orderedReservoirFullPsro';
import {
  ORDERED_RESERVOIR_SOURCE, adaptValidatedOrderedReservoir,
  validateOrderedChallengePool
} from '../src/sim/orderedReservoirChallenge';
import type { OrderedChallengePoolArtifact, OrderedRankedManifestHeader } from '../src/sim/orderedReservoirChallenge';
import type { OrderedProductReservoirArtifact } from '../src/sim/orderedGoldfishProduct';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { PairingJob } from '../src/sim/pairingRunner';
import { rulesFingerprint } from '../src/sim/rulesFingerprint';
import { classifyStrategyDamage } from '../src/sim/strategyDamage';
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
  for (const id of ids) {
    const blocks = held.blocks[id];
    if (!blocks || blocks.length !== expected.length || blocks.some((block, index) => block.seed !== expected[index]!.seed
      || block.opponentId !== expected[index]!.opponentId || block.matches !== 4 || block.score < 0 || block.score > 1
      || !block.telemetry.planPositionPurchasesByStrategy)) return false;
  }
  const copy = structuredClone(held) as Partial<ConfirmationChunkArtifact>; delete copy.evidenceHash; delete copy.elapsedMs;
  return held.evidenceHash === confirmationHash(copy as Omit<ConfirmationChunkArtifact, 'evidenceHash' | 'elapsedMs'>);
}

async function confirmCandidates(pool: OrderedChallengePoolArtifact, run: 1 | 2, scan: number,
  snapshotHash: string, candidates: readonly Strategy[], opponents: Map<string, Strategy>, weights: Record<string, number>,
  runner: WorkerPairingRunner): Promise<{ evidence: FullCandidateEvidence[]; decisions: ReturnType<typeof decideConfirmationLook> }> {
  const full = schedule(pool, run, `scan:${scan}:confirmation`, 6_400, weights).blocks;
  const accumulated = new Map(candidates.map((strategy) => [strategy.id, [] as ProductBlockEvidence[]]));
  let field = [...candidates], previous = 0;
  let decisions: ReturnType<typeof decideConfirmationLook> = [];
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
    if (lookIndex < ORDERED_FULL_PSRO_CONTINUATION_WIDTHS.length
      && continuing.size > ORDERED_FULL_PSRO_CONTINUATION_WIDTHS[lookIndex]!) throw new Error('confirmation-width-unresolved');
    field = candidates.filter((strategy) => continuing.has(strategy.id)); previous = look;
    if (!field.length) break;
  }
  return { evidence: candidates.map((strategy) => ({ strategy, blocks: accumulated.get(strategy.id)! })), decisions };
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
function precisionStable(matrix: NestedMatrixEvidence, from: 50 | 100, to: 100 | 200): boolean {
  const left = nestedMatrixSnapshot(matrix, from), right = nestedMatrixSnapshot(matrix, to);
  const leftEq = solveEquilibrium(left.strategies.map((strategy) => strategy.id), left.centeredPayoffs);
  const rightEq = solveEquilibrium(right.strategies.map((strategy) => strategy.id), right.centeredPayoffs);
  const a = provisional(left, leftEq), b = provisional(right, rightEq), names = new Set([...Object.keys(a.selected), ...Object.keys(b.selected)]);
  for (const name of names) if (Math.abs((a.selected[name] ?? 0) - (b.selected[name] ?? 0)) > 0.02
    || Math.abs((a.ranges[name]?.minimum ?? 0) - (b.ranges[name]?.minimum ?? 0)) > 0.02
    || Math.abs((a.ranges[name]?.maximum ?? 0) - (b.ranges[name]?.maximum ?? 0)) > 0.02) return false;
  for (const id of rightEq.strategyIds) if (((rightEq.weights[id] ?? 0) >= 0.005
    || (rightEq.maximumEquilibriumWeight[id] ?? 0) >= 0.005) && a.labels[id] !== b.labels[id]) return false;
  return Math.abs(leftEq.maximumKnownAdvantage - rightEq.maximumKnownAdvantage) <= 0.005;
}

interface ScanSummary {
  schemaVersion: 1; experiment: 'ordered-reservoir-full-scan'; version: typeof ORDERED_FULL_PSRO_VERSION;
  run: 1 | 2; scan: number; snapshotHash: string; selection: ReturnType<typeof selectFullScreenCandidates>;
  decisions: ReturnType<typeof decideConfirmationLook>; classes: ReturnType<typeof acquisitionEquivalentClasses>;
  representatives: string[]; shadows: ShadowEquivalentClass[]; retainedShadowIds: string[];
  divergedShadowIds: string[]; matches: number; children: Array<{ file: string; evidenceHash: string }>;
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

function initialMatrix(pool: OrderedChallengePoolArtifact, run: 1 | 2): NestedMatrixEvidence {
  return createNestedMatrixEvidence({ version: 'ordered-reservoir-full-nested-matrix-v1', kingdomId: KINGDOM_ID,
    seeds: orderedFullPsroSeeds(pool.reservoirHash, run, 'matrix', 200),
    turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN,
    startingDraftEnabled: false }, pool.reservoir.slice(0, 50).map((entry) => entry.strategy));
}
function loadCheckpoint(pool: OrderedChallengePoolArtifact, run: 1 | 2): OrderedFullPsroCheckpoint | null {
  const file = checkpointFile(run); if (!fs.existsSync(file)) return null;
  const held = readJson<unknown>(file);
  if (!validateOrderedFullPsroCheckpoint(held) || held.run !== run || held.poolHash !== pool.generatedHash
    || held.reservoirHash !== pool.reservoirHash || held.sourceRankedSha256 !== pool.source.rankedSha256
    || held.rulesFingerprint !== rulesFingerprint(KINGDOM_ID, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false).hash
    || held.matrixEvidenceHash !== readJson<NestedMatrixEvidence>(matrixFile(run)).evidenceHash
    || held.scanEvidenceHashes.some((hash, index) => {
      const file = scanSummaryFile(run, index); if (!fs.existsSync(file)) return true;
      const summary = readJson<unknown>(file); return !validScanSummary(summary) || summary.evidenceHash !== hash;
    }) || held.panelEvidenceHashes.some((hash, index) => {
      const file = panelFile(run, index + 1); if (!fs.existsSync(file)) return true;
      const panel = readJson<unknown>(file); return !validPanel(panel, held) || panel.evidenceHash !== hash;
    })) throw new Error(`Run ${run} checkpoint is invalid.`);
  return held;
}
function writeCheckpoint(pool: OrderedChallengePoolArtifact, run: 1 | 2, state: FullPsroState,
  activeStrategyIds: string[], shadowClasses: ShadowEquivalentClass[], matrix: NestedMatrixEvidence,
  scanHashes: string[], panelHashes: string[], elapsedMs: number): OrderedFullPsroCheckpoint {
  const checkpoint = createOrderedFullPsroCheckpoint({ run, kingdomId: KINGDOM_ID,
    rulesFingerprint: rulesFingerprint(KINGDOM_ID, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false).hash,
    reservoirHash: pool.reservoirHash, poolHash: pool.generatedHash,
    sourceRankedSha256: pool.source.rankedSha256, state,
    activeStrategyIds: [...activeStrategyIds].sort(), shadowClasses, matrixEvidenceHash: matrix.evidenceHash,
    scanEvidenceHashes: scanHashes, panelEvidenceHashes: panelHashes, elapsedMs });
  writeAtomic(checkpointFile(run), checkpoint); return checkpoint;
}

interface PanelArtifact {
  schemaVersion: 1; experiment: 'ordered-reservoir-full-acquisition-panel'; version: typeof ORDERED_FULL_PSRO_VERSION;
  run: 1 | 2; panel: number; targetHash: string; schedule: ReturnType<typeof stratifiedOpponentSchedule>;
  evidence: FullCandidateEvidence[]; summary: LotteryAcquisitionSummary; elapsedMs: number; evidenceHash: string;
}
function panelTargetHash(checkpoint: OrderedFullPsroCheckpoint): string {
  return evidenceHash({ run: checkpoint.run, state: checkpoint.state, activeStrategyIds: checkpoint.activeStrategyIds,
    shadowClasses: checkpoint.shadowClasses, matrixEvidenceHash: checkpoint.matrixEvidenceHash,
    scanEvidenceHashes: checkpoint.scanEvidenceHashes });
}
function validPanel(value: unknown, checkpoint: OrderedFullPsroCheckpoint): value is PanelArtifact {
  if (!value || typeof value !== 'object') return false; const held = value as PanelArtifact;
  if (held.schemaVersion !== 1 || held.experiment !== 'ordered-reservoir-full-acquisition-panel'
    || held.version !== ORDERED_FULL_PSRO_VERSION || held.run !== checkpoint.run
    || held.targetHash !== panelTargetHash(checkpoint)) return false;
  const copy = structuredClone(held) as Partial<PanelArtifact>; delete copy.evidenceHash; delete copy.elapsedMs;
  return held.evidenceHash === evidenceHash(copy);
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
function panelStable(panels: readonly PanelArtifact[]): boolean {
  const summaries = panels.map((panel) => panel.summary);
  const span = (values: number[]) => Math.max(...values) - Math.min(...values);
  const labels = new Set(summaries.flatMap((summary) => Object.keys(summary.selectedArchetypeShares)));
  if ([...labels].some((label) => span(summaries.map((summary) => summary.selectedArchetypeShares[label] ?? 0)) > 0.02)) return false;
  const cards = new Set(summaries.flatMap((summary) => Object.keys(summary.expectedCopiesPerPlayerGame)));
  for (const card of cards) {
    const copies = summaries.map((summary) => summary.expectedCopiesPerPlayerGame[card] ?? 0);
    const shares = summaries.map((summary) => summary.normalizedActionCardShares[card] ?? 0);
    if ((Math.max(...copies) >= 0.02 || Math.max(...shares) >= 0.01) && (span(copies) > 0.02 || span(shares) > 0.02)) return false;
  }
  const strategies = new Set(summaries.flatMap((summary) => Object.keys(summary.strategyLabels)));
  return [...strategies].every((id) => new Set(summaries.map((summary) => summary.strategyLabels[id])).size === 1);
}
async function ensurePanels(pool: OrderedChallengePoolArtifact, checkpoint: OrderedFullPsroCheckpoint,
  matrix: NestedMatrixEvidence, runner: WorkerPairingRunner): Promise<PanelArtifact[]> {
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
      const held = readJson<unknown>(file); if (!validPanel(held, checkpoint)) throw new Error(`Invalid panel ${file}.`);
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
  if (!panelStable(panels)) throw new Error('acquisition-panel-unresolved');
  return panels;
}

async function runOne(pool: OrderedChallengePoolArtifact, run: 1 | 2, runner: WorkerPairingRunner): Promise<OrderedFullPsroCheckpoint> {
  let lastRecorded = performance.now(); let checkpoint = loadCheckpoint(pool, run);
  let matrix: NestedMatrixEvidence;
  if (checkpoint) {
    matrix = readJson<NestedMatrixEvidence>(matrixFile(run));
    if (!validateNestedMatrixEvidence(matrix)) throw new Error(`Run ${run} matrix is invalid.`);
    if (checkpoint.state.status === 'unresolved'
      || (checkpoint.state.status === 'complete' && checkpoint.panelEvidenceHashes.length)) return checkpoint;
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
    const target = positive(snapshot, equilibrium), snapshotHash = evidenceHash({ matrix: matrix.evidenceHash,
      depth: state.matrixDepth, equilibrium });
    const active = new Set(matrix.strategies.map((strategy) => strategy.id));
    const inactive = pool.reservoir.filter((entry) => !active.has(entry.strategy.id)).map((entry) => ({
      strategy: entry.strategy, goldfishRank: entry.goldfishRank }));
    const rows = await screenCandidates(pool, run, state.scan, inactive, target.opponents, target.weights,
      snapshotHash, runner);
    let selection;
    try { selection = selectFullScreenCandidates(rows); } catch (error) {
      if (error instanceof Error && error.message === 'screen-width-unresolved') {
        state = { ...state, status: 'unresolved', stopReason: 'screen-width-unresolved' }; break;
      }
      throw error;
    }
    const byId = new Map(inactive.map((entry) => [entry.strategy.id, entry.strategy]));
    const candidates = selection.strategyIds.map((id) => byId.get(id)!);
    let confirmed;
    try { confirmed = await confirmCandidates(pool, run, state.scan, snapshotHash, candidates,
      target.opponents, target.weights, runner); } catch (error) {
      if (error instanceof Error && error.message === 'confirmation-width-unresolved') {
        state = { ...state, status: 'unresolved', stopReason: 'confirmation-width-unresolved' }; break;
      }
      throw error;
    }
    const decisions = new Map(confirmed.decisions.map((entry) => [entry.strategyId, entry]));
    const admitted = confirmed.evidence.filter((entry) => decisions.get(entry.strategy.id)?.decision === 'admitted');
    const knownShadow = new Set(shadowClasses.flatMap((group) => group.shadowIds));
    const admittedKnown = admitted.filter((entry) => knownShadow.has(entry.strategy.id));
    const anchorEvidence = new Map<string, FullCandidateEvidence>(); let anchorMatches = 0;
    if (admittedKnown.length) {
      const representatives = [...new Set(admittedKnown.map((entry) => shadowClasses.find((group) =>
        group.shadowIds.includes(entry.strategy.id))!.activeRepresentativeId))];
      const blocksByLength = new Map<number, string[]>();
      for (const evidence of admittedKnown) {
        const representative = shadowClasses.find((group) => group.shadowIds.includes(evidence.strategy.id))!.activeRepresentativeId;
        blocksByLength.set(evidence.blocks.length, [...(blocksByLength.get(evidence.blocks.length) ?? []), representative]);
      }
      for (const [length, ids] of blocksByLength) {
        const strategies = [...new Set(ids)].map((id) => matrix.strategies.find((strategy) => strategy.id === id)!);
        const blocks = schedule(pool, run, `scan:${state.scan}:confirmation`, 6_400, target.weights).blocks.slice(0, length);
        const file = anchorFile(run, state.scan, length); let anchors: FullCandidateEvidence[];
        if (fs.existsSync(file)) {
          const held = readJson<{ evidence: FullCandidateEvidence[]; evidenceHash: string }>(file);
          const copy = { schemaVersion: 1, experiment: 'ordered-reservoir-full-shadow-anchors',
            version: ORDERED_FULL_PSRO_VERSION, run, scan: state.scan, poolHash: pool.generatedHash,
            reservoirHash: pool.reservoirHash, snapshotHash, blocks: length,
            strategyIds: strategies.map((strategy) => strategy.id), evidence: held.evidence };
          if (held.evidenceHash !== evidenceHash(copy)) throw new Error(`Invalid shadow anchors ${file}.`);
          anchors = held.evidence;
        } else {
          anchors = await evaluateFull(strategies, target.opponents, blocks, runner);
          const base = { schemaVersion: 1, experiment: 'ordered-reservoir-full-shadow-anchors',
            version: ORDERED_FULL_PSRO_VERSION, run, scan: state.scan, poolHash: pool.generatedHash,
            reservoirHash: pool.reservoirHash, snapshotHash, blocks: length,
            strategyIds: strategies.map((strategy) => strategy.id), evidence: anchors };
          writeAtomic(file, { ...base, evidenceHash: evidenceHash(base) });
        }
        anchors.forEach((entry) => { anchorEvidence.set(entry.strategy.id, entry); anchorMatches += entry.blocks.length * 4; });
      }
      if (representatives.some((id) => !anchorEvidence.has(id))) throw new Error('Shadow anchor evidence is incomplete.');
    }
    const collapsed = collapseAcquisitionEquivalentAdmissions({ admitted, existingShadows: shadowClasses,
      anchorEvidence });
    if (matrix.strategies.length + collapsed.representatives.length > ORDERED_FULL_PSRO_MATRIX_WIDTH) {
      state = { ...state, status: 'unresolved', stopReason: 'matrix-width-unresolved' }; break;
    }
    const classes = acquisitionEquivalentClasses(admitted), diverged = new Set(collapsed.divergedShadowIds);
    shadowClasses = [...shadowClasses.map((group) => ({ ...group,
      memberIds: group.memberIds.filter((id) => !diverged.has(id)),
      shadowIds: group.shadowIds.filter((id) => !diverged.has(id))
    })).filter((group) => group.shadowIds.length), ...collapsed.shadows];
    if (collapsed.representatives.length) {
      matrix = withNestedMatrixStrategies(matrix, collapsed.representatives.map((entry) => entry.strategy));
      writeAtomic(matrixFile(run), matrix);
    }
    const unresolved = confirmed.decisions.filter((entry) => entry.decision === 'unresolved').length;
    const precision = state.matrixDepth === 50 ? undefined : state.cleanAtDepth + 1 >= 2
      ? precisionStable(matrix, state.matrixDepth === 100 ? 50 : 100, state.matrixDepth) : undefined;
    const next = transitionFullPsroState(state, { representativeAdmissions: collapsed.representatives.length,
      unresolved, ...(precision === undefined ? {} : { precisionStable: precision }) });
    const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-full-scan' as const,
      version: ORDERED_FULL_PSRO_VERSION, run, scan: state.scan, snapshotHash, selection,
      decisions: confirmed.decisions, classes, representatives: collapsed.representatives.map((entry) => entry.strategy.id),
      shadows: collapsed.shadows, retainedShadowIds: collapsed.retainedShadowIds,
      divergedShadowIds: collapsed.divergedShadowIds,
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
      const panels = await ensurePanels(pool, checkpoint, matrix, runner);
      checkpoint = writeCheckpoint(pool, run, state, matrix.strategies.map((strategy) => strategy.id), shadowClasses,
        matrix, scanHashes, panels.map((panel) => panel.evidenceHash),
        checkpoint.elapsedMs + performance.now() - lastRecorded);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      if (reason !== 'support-width-unresolved' && reason !== 'acquisition-panel-unresolved') throw error;
      state = { ...state, status: 'unresolved', stopReason: reason };
      checkpoint = writeCheckpoint(pool, run, state, matrix.strategies.map((strategy) => strategy.id), shadowClasses,
        matrix, scanHashes, [], checkpoint.elapsedMs + performance.now() - lastRecorded);
    }
  }
  return checkpoint;
}

function runReport(pool: OrderedChallengePoolArtifact): { runs: unknown[] } {
  const runs = ORDERED_FULL_PSRO_RUNS.map((run) => {
    const checkpoint = loadCheckpoint(pool, run);
    if (!checkpoint) return { run, status: 'missing' };
    const scans = checkpoint.scanEvidenceHashes.map((_hash, index) => readJson<ScanSummary>(scanSummaryFile(run, index)));
    const panels = checkpoint.panelEvidenceHashes.map((_hash, index) => readJson<PanelArtifact>(panelFile(run, index + 1)));
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
    return { run, status: checkpoint.state.status, stopReason: checkpoint.state.stopReason,
      matrixDepth: checkpoint.state.matrixDepth, matrixWidth: checkpoint.activeStrategyIds.length,
      games: { matrix: matrixGames, scans: scanGames, panels: panelGames,
        total: matrixGames + scanGames + panelGames },
      scans: scans.map((scan) => ({ advanced: scan.selection.strategyIds.length,
        admittedIds: scan.decisions.filter((entry) => entry.decision === 'admitted').length,
        representatives: scan.representatives.length, shadows: scan.shadows.reduce((sum, group) => sum + group.shadowIds.length, 0),
        unresolved: scan.decisions.filter((entry) => entry.decision === 'unresolved').length })),
      classWeights, panelRanges: panels.map((panel) => panel.summary),
      final: panels.length ? pooledPanelSummary(matrix, checkpoint.state.matrixDepth, panels) : null,
      elapsedMs: checkpoint.elapsedMs, checkpointHash: checkpoint.evidenceHash };
  });
  return { runs };
}
function writeReport(pool: OrderedChallengePoolArtifact): void {
  let comparison: Record<string, unknown> | null = null;
  if (fs.existsSync(comparisonFile())) {
    const held = readJson<Record<string, unknown> & { evidenceHash?: string }>(comparisonFile());
    const copy = { ...held }; delete copy.evidenceHash;
    const checkpoints = ORDERED_FULL_PSRO_RUNS.map((run) => loadCheckpoint(pool, run)?.evidenceHash ?? null);
    if (held.evidenceHash !== evidenceHash(copy) || !exact(held.checkpointHashes, checkpoints)) {
      throw new Error('Comparison report evidence is invalid.');
    }
    comparison = held;
  }
  const report = { schemaVersion: 1, experiment: 'ordered-reservoir-full-psro-report',
    version: ORDERED_FULL_PSRO_VERSION, ...runReport(pool), comparison };
  writeAtomic(reportFile('json'), report);
  const lines = ['# Ordered-reservoir full PSRO report', '', ...report.runs.flatMap((entry) => {
    const run = entry as { run: number; status: string; stopReason?: string; matrixWidth?: number; matrixDepth?: number;
      games?: { matrix: number; scans: number; panels: number; total: number };
      scans?: Array<{ advanced: number; admittedIds: number; representatives: number; shadows: number; unresolved: number }>;
      classWeights?: Array<{ representativeId: string; memberIds: string[]; weight: number | null }>;
      final?: LotteryAcquisitionSummary | null };
    const result = [`## Run ${run.run}`, '', `Status: ${run.status}${run.stopReason ? ` (${run.stopReason})` : ''}.`,
      ...(run.matrixWidth ? [`Matrix: ${run.matrixWidth} representatives at ${run.matrixDepth} blocks.`] : []),
      ...(run.games ? [`Games: ${run.games.total.toLocaleString()} total (${run.games.matrix.toLocaleString()} matrix, `
        + `${run.games.scans.toLocaleString()} screen/confirmation, ${run.games.panels.toLocaleString()} panels).`] : [])];
    if (run.scans?.length) result.push('', '| Scan | Advanced | Per-ID admissions | Representatives | Shadows | Unresolved |',
      '|---:|---:|---:|---:|---:|---:|', ...run.scans.map((scan, index) =>
        `| ${index + 1} | ${scan.advanced} | ${scan.admittedIds} | ${scan.representatives} | ${scan.shadows} | ${scan.unresolved} |`));
    if (run.classWeights?.length) result.push('', 'Acquisition-equivalent classes:',
      ...run.classWeights.map((group) => `- ${group.representativeId}: ${(100 * (group.weight ?? 0)).toFixed(3)}% class weight; `
        + `${group.memberIds.length} members.`));
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
    `Acquisition-vector total variation: ${Number(comparison.totalVariation).toFixed(4)}.`, '');
  fs.writeFileSync(reportFile('md'), `${lines.join('\n')}\n`); console.log(reportFile('md'));
}

async function compareRuns(pool: OrderedChallengePoolArtifact, runner: WorkerPairingRunner): Promise<void> {
  const checkpoints = ORDERED_FULL_PSRO_RUNS.map((run) => loadCheckpoint(pool, run));
  if (checkpoints.some((entry) => !entry || entry.state.status !== 'complete')) {
    throw new Error('Comparison needs two deeply valid complete runs.');
  }
  if (fs.existsSync(comparisonFile())) {
    const held = readJson<Record<string, unknown> & { evidenceHash?: string; checkpointHashes?: unknown }>(comparisonFile());
    const copy = { ...held }; delete copy.evidenceHash;
    if (held.evidenceHash !== evidenceHash(copy)
      || !exact(held.checkpointHashes, checkpoints.map((entry) => entry!.evidenceHash))) {
      throw new Error('Saved comparison artifact is invalid.');
    }
    console.log(comparisonFile()); return;
  }
  const lotteries = checkpoints.map((checkpoint) => {
    const matrix = readJson<NestedMatrixEvidence>(matrixFile(checkpoint!.run));
    const snapshot = nestedMatrixSnapshot(matrix, checkpoint!.state.matrixDepth);
    const equilibrium = solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
    return { checkpoint: checkpoint!, snapshot, equilibrium, positive: positive(snapshot, equilibrium) };
  });
  const row = schedule(pool, 1, 'comparison:row', 10_000, lotteries[0]!.positive.weights).blocks;
  const column = schedule(pool, 2, 'comparison:column', 10_000, lotteries[1]!.positive.weights).blocks;
  const jobs: PairingJob[] = row.map((block, index) => ({ candidate: lotteries[0]!.positive.opponents.get(block.opponentId)!,
    opponent: lotteries[1]!.positive.opponents.get(column[index]!.opponentId)!, options: { kingdomId: KINGDOM_ID,
      seeds: [block.seed], turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN,
      startingDraftEnabled: false, allowEarlyStop: false } }));
  const outcome = await runner.run(jobs), scores = outcome.outcomes.map((entry) => {
    if (!entry || entry.record.aborted || entry.blocks[0]?.played !== 4) throw new Error('Cross-play block is invalid.');
    return entry.blocks[0].score;
  });
  const panels = checkpoints.map((checkpoint, index) => {
    const artifacts = checkpoint!.panelEvidenceHashes.map((_hash, panel) =>
      readJson<PanelArtifact>(panelFile(checkpoint!.run, panel + 1)));
    const matrix = readJson<NestedMatrixEvidence>(matrixFile(checkpoint!.run));
    return pooledPanelSummary(matrix, lotteries[index]!.checkpoint.state.matrixDepth, artifacts);
  });
  const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const bounds = anytimeConfidenceBounds(scores), cards = new Set(panels.flatMap((panel) =>
    Object.keys(panel.normalizedActionCardShares)));
  const totalVariation = [...cards].reduce((sum, card) => sum + Math.abs(
    (panels[0]!.normalizedActionCardShares[card] ?? 0) - (panels[1]!.normalizedActionCardShares[card] ?? 0)), 0) / 2;
  const archetypes = new Set(panels.flatMap((panel) => Object.keys(panel.selectedArchetypeShares)));
  let passed = score >= 0.49 && score <= 0.51 && bounds.lower <= 0.5 && bounds.upper >= 0.5 && totalVariation <= 0.05;
  for (const name of archetypes) {
    passed &&= Math.abs((panels[0]!.selectedArchetypeShares[name] ?? 0)
      - (panels[1]!.selectedArchetypeShares[name] ?? 0)) <= 0.02;
    passed &&= Math.abs((panels[0]!.feasibleArchetypeRanges[name]?.minimum ?? 0)
      - (panels[1]!.feasibleArchetypeRanges[name]?.minimum ?? 0)) <= 0.02
      && Math.abs((panels[0]!.feasibleArchetypeRanges[name]?.maximum ?? 0)
        - (panels[1]!.feasibleArchetypeRanges[name]?.maximum ?? 0)) <= 0.02;
  }
  for (const card of cards) {
    const material = Math.max(panels[0]!.normalizedActionCardShares[card] ?? 0,
      panels[1]!.normalizedActionCardShares[card] ?? 0) >= 0.01
      || Math.max(panels[0]!.expectedCopiesPerPlayerGame[card] ?? 0,
        panels[1]!.expectedCopiesPerPlayerGame[card] ?? 0) >= 0.02;
    if (material) passed &&= Math.abs((panels[0]!.normalizedActionCardShares[card] ?? 0)
      - (panels[1]!.normalizedActionCardShares[card] ?? 0)) <= 0.02
      && Math.abs((panels[0]!.expectedCopiesPerPlayerGame[card] ?? 0)
        - (panels[1]!.expectedCopiesPerPlayerGame[card] ?? 0)) <= 0.02;
  }
  const supportSets = lotteries.map((lottery) => new Set(lottery.equilibrium.strategyIds.filter((id) =>
    (lottery.equilibrium.weights[id] ?? 0) > 1e-8)));
  const supportIntersection = [...supportSets[0]!].filter((id) => supportSets[1]!.has(id)).length;
  const supportUnion = new Set([...supportSets[0]!, ...supportSets[1]!]).size;
  const exactIds = new Set(lotteries.flatMap((lottery) => lottery.equilibrium.strategyIds));
  const exactIdTotalVariation = [...exactIds].reduce((sum, id) => sum + Math.abs(
    (lotteries[0]!.equilibrium.weights[id] ?? 0) - (lotteries[1]!.equilibrium.weights[id] ?? 0)), 0) / 2;
  const base = { schemaVersion: 1, experiment: 'ordered-reservoir-full-comparison',
    version: ORDERED_FULL_PSRO_VERSION, checkpointHashes: checkpoints.map((entry) => entry!.evidenceHash),
    blocks: 10_000, score, bounds95: bounds, totalVariation, supportIntersection, supportUnion,
    supportJaccard: supportUnion ? supportIntersection / supportUnion : 1, exactIdTotalVariation, passed,
    decision: passed ? 'run-1-representative' : 'two-run-inconsistent' };
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
  console.log(JSON.stringify(runReport(pool), null, 2));
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
        if (!first || first.state.status === 'running') throw new Error('Run 1 must be terminal before Run 2 starts.');
      }
      const checkpoint = await runOne(pool, number, runner);
      console.log(JSON.stringify({ run: number, status: checkpoint.state.status,
        stopReason: checkpoint.state.stopReason, checkpointHash: checkpoint.evidenceHash }, null, 2));
      writeReport(pool);
    }
  } finally { await runner.close(); }
}
