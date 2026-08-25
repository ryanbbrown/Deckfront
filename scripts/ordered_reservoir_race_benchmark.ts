import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { solveEquilibrium } from '../src/sim/equilibrium';
import { evaluateCandidates } from '../src/sim/mixtureEvaluation';
import { createMatrixCellCache, matrixProtocol, PayoffMatrix } from '../src/sim/payoffMatrix';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import {
  ORDERED_RESERVOIR_RUN_ID, ORDERED_RESERVOIR_SOURCE, adaptValidatedOrderedReservoir,
  validateOrderedChallengePool
} from '../src/sim/orderedReservoirChallenge';
import type {
  OrderedChallengePoolArtifact, OrderedRankedManifestHeader
} from '../src/sim/orderedReservoirChallenge';
import type { OrderedProductReservoirArtifact } from '../src/sim/orderedGoldfishProduct';
import {
  ORDERED_RACE_BENCHMARK_KINGDOM, ORDERED_RACE_BENCHMARK_PROTOCOL,
  ORDERED_RACE_BENCHMARK_VERSION, benchmarkChunkBounds, benchmarkChunkCount,
  benchmarkPoolSlices, benchmarkTrialSchedule, createOrderedRaceBenchmarkChunkArtifact,
  createOrderedRaceBenchmarkMatrixArtifact, createOrderedRaceBenchmarkReport,
  orderedRaceBenchmarkSeedPlan, validateOrderedRaceBenchmarkChunkArtifact,
  validateOrderedRaceBenchmarkMatrixArtifact, validateOrderedRaceBenchmarkReport
} from '../src/sim/orderedReservoirRaceBenchmark';
import type {
  OrderedRaceBenchmarkChunkArtifact, OrderedRaceBenchmarkMatrixArtifact,
  OrderedRaceBenchmarkReport
} from '../src/sim/orderedReservoirRaceBenchmark';
import { canonicalStrategy } from '../src/sim/strategy';

const ROOT = path.join('.experiments', 'ordered-reservoir-race-benchmark', ORDERED_RACE_BENCHMARK_VERSION);
const POOL_FILE = path.join(ROOT, 'pool.json');
const MATRIX_FILE = path.join(ROOT, 'matrix.json');
const REPORT_JSON = path.join(ROOT, 'report.json');
const REPORT_MD = path.join(ROOT, 'report.md');

function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function sha256Text(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function sha256File(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sourceFile(name: string): string { return path.join(ORDERED_RESERVOIR_SOURCE, name); }
function chunkFile(trial: number, chunk: number): string {
  return path.join(ROOT, 'trials', `trial-${trial + 1}`, `chunk-${String(chunk).padStart(2, '0')}.json`);
}
function kingdom() {
  const held = deepBeamSuite.kingdoms.find((entry) => entry.id === ORDERED_RACE_BENCHMARK_KINGDOM);
  if (!held || held.startingHealth !== 50) throw new Error('The 50-health Kingdom 009 definition is missing.');
  registerKingdom(held);
  return held;
}
function validateOrderedSource(): void {
  if (!fs.existsSync(ORDERED_RESERVOIR_SOURCE)) {
    throw new Error(`Missing corrected ordered source ${ORDERED_RESERVOIR_SOURCE}.`);
  }
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
  const pool = adaptValidatedOrderedReservoir({
    manifest: JSON.parse(ranked) as OrderedRankedManifestHeader,
    reservoir: JSON.parse(reservoir) as OrderedProductReservoirArtifact,
    rankedSha256: sha256Text(ranked), reservoirSha256: sha256Text(reservoir)
  });
  writeAtomic(POOL_FILE, pool);
  return pool;
}
function loadPool(): OrderedChallengePoolArtifact {
  if (!fs.existsSync(POOL_FILE)) throw new Error(`Missing benchmark pool ${POOL_FILE}. Run the benchmark first.`);
  const pool = readJson<unknown>(POOL_FILE);
  if (!validateOrderedChallengePool(pool)) throw new Error('Saved benchmark pool is invalid.');
  return pool;
}

async function loadOrBuildMatrix(
  pool: OrderedChallengePoolArtifact, runner: WorkerPairingRunner
): Promise<OrderedRaceBenchmarkMatrixArtifact> {
  if (fs.existsSync(MATRIX_FILE)) {
    const held = readJson<unknown>(MATRIX_FILE);
    if (validateOrderedRaceBenchmarkMatrixArtifact(held, pool)) return held;
    throw new Error(`Saved matrix failed validation: ${MATRIX_FILE}`);
  }
  const started = performance.now();
  const seedPlan = orderedRaceBenchmarkSeedPlan(pool.reservoirHash);
  const matrix = new PayoffMatrix(matrixProtocol(pool.kingdomId, seedPlan.matrixSeeds,
    ORDERED_RACE_BENCHMARK_PROTOCOL.turnLimitPerPlayer,
    ORDERED_RACE_BENCHMARK_PROTOCOL.actionCapPerTurn, false), runner, createMatrixCellCache());
  const { initial } = benchmarkPoolSlices(pool);
  initial.forEach((strategy) => matrix.addStrategy(strategy));
  await matrix.fillAll(false);
  const snapshot = matrix.snapshot();
  const artifact = createOrderedRaceBenchmarkMatrixArtifact({
    poolHash: pool.generatedHash, reservoirHash: pool.reservoirHash,
    sourceRankedSha256: pool.source.rankedSha256, protocol: { ...ORDERED_RACE_BENCHMARK_PROTOCOL },
    seedPlan, matrix: snapshot,
    equilibrium: solveEquilibrium(snapshot.strategies.map((entry) => entry.id), snapshot.centeredPayoffs),
    elapsedMs: performance.now() - started
  });
  if (!validateOrderedRaceBenchmarkMatrixArtifact(artifact, pool)) {
    throw new Error('Generated benchmark matrix failed validation.');
  }
  writeAtomic(MATRIX_FILE, artifact);
  return artifact;
}

function loadChunks(
  pool: OrderedChallengePoolArtifact, matrix: OrderedRaceBenchmarkMatrixArtifact,
  requireComplete: boolean
): OrderedRaceBenchmarkChunkArtifact[] {
  const chunks: OrderedRaceBenchmarkChunkArtifact[] = [];
  for (let trial = 0; trial < ORDERED_RACE_BENCHMARK_PROTOCOL.evaluationTrials; trial += 1) {
    for (let chunk = 0; chunk < benchmarkChunkCount(); chunk += 1) {
      const file = chunkFile(trial, chunk);
      if (!fs.existsSync(file)) {
        if (requireComplete) throw new Error(`Missing benchmark chunk ${file}.`);
        continue;
      }
      const value = readJson<unknown>(file);
      if (!validateOrderedRaceBenchmarkChunkArtifact(value, pool, matrix)) {
        throw new Error(`Saved benchmark chunk failed validation: ${file}`);
      }
      chunks.push(value);
    }
  }
  return chunks;
}

async function runChunks(
  pool: OrderedChallengePoolArtifact, matrix: OrderedRaceBenchmarkMatrixArtifact,
  runner: WorkerPairingRunner
): Promise<OrderedRaceBenchmarkChunkArtifact[]> {
  const opponents = new Map(matrix.matrix.strategies.map((strategy) => [strategy.id, strategy]));
  for (let trial = 0; trial < ORDERED_RACE_BENCHMARK_PROTOCOL.evaluationTrials; trial += 1) {
    const schedule = benchmarkTrialSchedule(matrix, trial);
    for (let chunk = 0; chunk < benchmarkChunkCount(); chunk += 1) {
      const file = chunkFile(trial, chunk);
      if (fs.existsSync(file)) {
        const held = readJson<unknown>(file);
        if (validateOrderedRaceBenchmarkChunkArtifact(held, pool, matrix)) continue;
        throw new Error(`Saved benchmark chunk failed validation: ${file}`);
      }
      const { startRank, endRank } = benchmarkChunkBounds(chunk);
      const candidates = pool.reservoir.slice(startRank - 1, endRank).map((entry) => entry.strategy);
      const started = performance.now();
      const evaluations = await evaluateCandidates(candidates, opponents, schedule, runner, {
        kingdomId: pool.kingdomId,
        turnLimitPerPlayer: ORDERED_RACE_BENCHMARK_PROTOCOL.turnLimitPerPlayer,
        actionCapPerTurn: ORDERED_RACE_BENCHMARK_PROTOCOL.actionCapPerTurn,
        startingDraftEnabled: false, scoreOnly: true
      });
      const artifact = createOrderedRaceBenchmarkChunkArtifact({
        matrixEvidenceHash: matrix.evidenceHash, trial, chunk, startRank, endRank, schedule,
        candidates: evaluations.map((entry, index) => ({
          goldfishRank: startRank + index, strategyId: entry.strategy.id,
          canonicalStrategy: canonicalStrategy(entry.strategy), blockScores: entry.blockScores,
          matches: entry.matches
        })),
        elapsedMs: performance.now() - started
      });
      if (!validateOrderedRaceBenchmarkChunkArtifact(artifact, pool, matrix)) {
        throw new Error(`Generated benchmark chunk ${trial}:${chunk} failed validation.`);
      }
      writeAtomic(file, artifact);
      console.log(`trial ${trial + 1}/3 chunk ${chunk + 1}/${benchmarkChunkCount()} ranks ${startRank}-${endRank}`);
    }
  }
  return loadChunks(pool, matrix, true);
}

function percentage(value: number): string { return `${(100 * value).toFixed(1)}%`; }
function renderReport(report: OrderedRaceBenchmarkReport, matrix: OrderedRaceBenchmarkMatrixArtifact): string {
  const lines = [
    '# Ordered-reservoir early-race consistency benchmark', '',
    '## Protocol', '',
    `The benchmark uses ordered reservoir ranks 1–${report.protocol.rankLimit.toLocaleString()}. `
      + `Ranks 1–${report.protocol.initialStrategies} form one fixed ${report.protocol.matrixBlocks}-block matrix and lottery.`,
    '',
    `Each of ranks ${report.protocol.initialStrategies + 1}–${report.protocol.rankLimit.toLocaleString()} is evaluated `
      + `${report.protocol.evaluationTrials} times. Each evaluation uses ${report.protocol.candidateBlocks} blocks with no elimination. `
      + `One block is ${report.protocol.gamesPerBlock} total balanced games against one opponent sampled from the fixed weighted lottery.`,
    '',
    `Candidate schedules are independent between trials. The matrix is never rebuilt and no strategy is admitted. `
      + `The matrix lottery has ${matrix.equilibrium.strategyIds.filter((id) => (matrix.equilibrium.weights[id] ?? 0) > 1e-6).length} material support strategies.`,
    '',
    '## Runtime', '',
    `Matrix: ${(report.elapsedMs.matrix / 1000).toFixed(1)} s. Candidate evaluations: `
      + `${(report.elapsedMs.candidateEvaluation / 1000).toFixed(1)} s. Recorded simulation total: `
      + `${(report.elapsedMs.total / 1000).toFixed(1)} s.`,
    '',
    `${report.matches.toLocaleString()} candidate games were played. Matrix games are separate.`, '',
    '## Independent-trial consistency', ''
  ];
  for (const depth of report.depths) {
    lines.push(`### Rankings after ${depth.blocks} block${depth.blocks === 1 ? '' : 's'}`, '',
      '| Cutoff | Pair overlaps | Pair Jaccards | Triple overlap | Triple Jaccard |',
      '|---:|---|---|---:|---:|');
    for (const cutoff of depth.cutoffs) {
      lines.push(`| ${cutoff.cutoff} | ${cutoff.pairwise.map((pair) => `${pair.intersection}/${cutoff.cutoff}`).join(', ')} `
        + `| ${cutoff.pairwise.map((pair) => percentage(pair.jaccard)).join(', ')} `
        + `| ${cutoff.triple.intersection}/${cutoff.cutoff} | ${percentage(cutoff.triple.jaccard)} |`);
    }
    lines.push('', `Tie-adjusted Spearman correlations over all ${report.candidateCount.toLocaleString()} candidates: `
      + depth.rankCorrelations.map((entry) => entry.tieAdjustedSpearman?.toFixed(3) ?? 'undefined').join(', '), '');
    const ties = depth.cutoffs.map((cutoff) => `${cutoff.cutoff}: `
      + cutoff.boundaryTies.map((entry) => `${entry.selectedAtScore}/${entry.tiedAtScore} at ${(100 * entry.score).toFixed(1)}%`).join(', '));
    lines.push(`Boundary ties, shown as selected/tied for trials 1–3: ${ties.join('; ')}.`, '');
  }
  lines.push('## One-block to eight-block retention', '',
    '| Trial | Cutoff | Overlap | Jaccard |', '|---:|---:|---:|---:|');
  for (const entry of report.oneVersusEight) {
    lines.push(`| ${entry.trial + 1} | ${entry.cutoff} | ${entry.intersection}/${entry.cutoff} | ${percentage(entry.jaccard)} |`);
  }
  lines.push('',
    'Top-cutoff overlap measures selection stability. Tie-adjusted Spearman uses average ranks for equal scores, so it does not invent an order inside score ties.',
    '', `Detailed JSON: \`${REPORT_JSON}\`. Per-candidate block scores: \`${path.join(ROOT, 'trials')}\`.`, '');
  return `${lines.join('\n')}\n`;
}
function writeReport(
  pool: OrderedChallengePoolArtifact, matrix: OrderedRaceBenchmarkMatrixArtifact,
  chunks: OrderedRaceBenchmarkChunkArtifact[]
): OrderedRaceBenchmarkReport {
  for (const chunk of chunks) if (!validateOrderedRaceBenchmarkChunkArtifact(chunk, pool, matrix)) {
    throw new Error('Cannot report an invalid benchmark chunk.');
  }
  const report = createOrderedRaceBenchmarkReport({ matrix, chunks });
  if (!validateOrderedRaceBenchmarkReport(report, matrix, chunks)) throw new Error('Generated benchmark report is invalid.');
  writeAtomic(REPORT_JSON, report);
  fs.writeFileSync(REPORT_MD, renderReport(report, matrix));
  return report;
}
function printSummary(report: OrderedRaceBenchmarkReport): void {
  console.log(`complete: ${report.candidateCount} candidates, ${report.matches} candidate games, `
    + `${(report.elapsedMs.total / 1000).toFixed(1)} recorded seconds`);
  for (const depth of report.depths) for (const cutoff of depth.cutoffs) {
    console.log(`${depth.blocks} block top ${cutoff.cutoff}: pair overlaps `
      + `${cutoff.pairwise.map((entry) => entry.intersection).join('/')}; triple ${cutoff.triple.intersection}; `
      + `triple Jaccard ${cutoff.triple.jaccard.toFixed(3)}`);
  }
  console.log(REPORT_MD);
}

const mode = process.argv.includes('--status') ? 'status'
  : process.argv.includes('--report') ? 'report'
    : process.argv.includes('--run') ? 'run' : null;
if (!mode) throw new Error('Use --run, --status, or --report.');
kingdom();
if (mode === 'status') {
  const expected = ORDERED_RACE_BENCHMARK_PROTOCOL.evaluationTrials * benchmarkChunkCount();
  const held = fs.existsSync(MATRIX_FILE) ? 'present' : 'missing';
  const chunks = Array.from({ length: ORDERED_RACE_BENCHMARK_PROTOCOL.evaluationTrials }, (_unused, trial) =>
    Array.from({ length: benchmarkChunkCount() }, (_chunk, chunk) => fs.existsSync(chunkFile(trial, chunk))))
    .flat().filter(Boolean).length;
  console.log(JSON.stringify({ sourceRunId: ORDERED_RESERVOIR_RUN_ID, root: ROOT,
    matrix: held, chunks: `${chunks}/${expected}`, report: fs.existsSync(REPORT_JSON) ? 'present' : 'missing' }, null, 2));
} else if (mode === 'report') {
  const pool = loadPool();
  const matrixValue = fs.existsSync(MATRIX_FILE) ? readJson<unknown>(MATRIX_FILE) : null;
  if (!validateOrderedRaceBenchmarkMatrixArtifact(matrixValue, pool)) throw new Error('Saved benchmark matrix is invalid.');
  const report = writeReport(pool, matrixValue, loadChunks(pool, matrixValue, true));
  printSummary(report);
} else {
  const wallStarted = performance.now();
  const pool = loadOrPreparePool();
  const runner = new WorkerPairingRunner(ORDERED_RACE_BENCHMARK_PROTOCOL.workers,
    new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom: deepBeamSuite.kingdoms.find(
      (entry) => entry.id === ORDERED_RACE_BENCHMARK_KINGDOM)! }, ['--import', 'tsx']);
  try {
    const matrix = await loadOrBuildMatrix(pool, runner);
    const chunks = await runChunks(pool, matrix, runner);
    const report = writeReport(pool, matrix, chunks);
    printSummary(report);
    console.log(`command wall time: ${((performance.now() - wallStarted) / 1000).toFixed(1)} s`);
  } finally {
    await runner.close();
  }
}
