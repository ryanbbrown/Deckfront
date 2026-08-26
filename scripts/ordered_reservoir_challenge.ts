import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import {
  FIXED_RESERVOIR_CONFIG, scanFixedReservoir, supportEntries,
  runFixedReservoirPsro, validateFixedReservoirPsroArtifact
} from '../src/sim/fixedReservoirPsro';
import type { FixedReservoirPsroArtifact } from '../src/sim/fixedReservoirPsro';
import {
  loadValidatedLegacyFixedReservoirV1
} from '../src/sim/legacyFixedReservoirV1';
import type {
  LegacyFixedReservoirPoolArtifact, LegacyFixedReservoirPsroArtifact
} from '../src/sim/legacyFixedReservoirV1';
import { RandomPsroSeedLedger } from '../src/sim/randomPsro';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import {
  ORDERED_RESERVOIR_CHALLENGE_VERSION, ORDERED_RESERVOIR_COMPARISON_SEED,
  ORDERED_RESERVOIR_CROSS_PLAY_BLOCKS, ORDERED_RESERVOIR_EVALUATION_SEED,
  ORDERED_RESERVOIR_HISTORICAL_ROOT, ORDERED_RESERVOIR_HISTORICAL_SEEDS,
  ORDERED_RESERVOIR_ONE_ROUND_PROTOCOL, ORDERED_RESERVOIR_OUTPUT,
  ORDERED_RESERVOIR_SOURCE, adaptValidatedOrderedReservoir, aggregateComparisons,
  assessOneRound, canonicalOverlap, inactiveAttackStrategies, summarizeAttack,
  validateOrderedChallengePool, wholeLotteryEvidence
} from '../src/sim/orderedReservoirChallenge';
import type {
  LotteryDirectionEvidence, OrderedChallengePoolArtifact, OrderedHistoricalComparison,
  OrderedRankedManifestHeader
} from '../src/sim/orderedReservoirChallenge';
import type { OrderedProductReservoirArtifact } from '../src/sim/orderedGoldfishProduct';
import { headToHead } from './headToHead';

const POOL_FILE = path.join(ORDERED_RESERVOIR_OUTPUT, 'pool.json');
const RUN_FILE = path.join(ORDERED_RESERVOIR_OUTPUT, 'one-round.json');
const REPORT_FILE = path.join(ORDERED_RESERVOIR_OUTPUT, 'report.json');
const REPORT_MARKDOWN = path.join(ORDERED_RESERVOIR_OUTPUT, 'report.md');
const PAIRING_WORKERS = 4;

interface HistoricalUnit {
  pool: LegacyFixedReservoirPoolArtifact;
  run: LegacyFixedReservoirPsroArtifact;
}
interface SeedPlan {
  namespaces: Record<string, number[]>;
  forward: number[]; reverse: number[]; forwardBootstrap: number; reverseBootstrap: number;
  orderedAttack: { race: number[]; confirmation: number[]; sampling: number[]; bootstrap: number[] };
  historicalAttack: { race: number[]; confirmation: number[]; sampling: number[]; bootstrap: number[] };
}
interface ComparisonArtifact extends OrderedHistoricalComparison {
  schemaVersion: 1;
  experiment: 'ordered-reservoir-historical-comparison';
  version: typeof ORDERED_RESERVOIR_CHALLENGE_VERSION;
  kingdomId: string;
  orderedReservoirHash: string;
  historicalReservoirHash: string;
  seedNamespaces: Record<string, number[]>;
  reservoirOverlap: number;
  elapsedMs: number;
}

function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function sha256(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function sha256File(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function positiveInteger(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer.`);
  return value;
}
function comparisonFile(seed: number): string {
  return path.join(ORDERED_RESERVOIR_OUTPUT, `comparison-${seed}.json`);
}
function sourceFile(name: string): string { return path.join(ORDERED_RESERVOIR_SOURCE, name); }
function historicalFile(kind: 'pool' | 'run', seed: number): string {
  return path.join(ORDERED_RESERVOIR_HISTORICAL_ROOT, `${kind}-${seed}.json`);
}

function assertOrderedSourceExists(): void {
  for (const name of ['ranked.json', 'reservoir.json']) {
    if (!fs.existsSync(sourceFile(name))) {
      throw new Error(`Missing final ordered product ${sourceFile(name)}. The command does not search for or accept another native run.`);
    }
  }
}
function validateOrderedSource(): void {
  assertOrderedSourceExists();
  console.log(`source: validating ${ORDERED_RESERVOIR_SOURCE}`);
  const result = spawnSync('npm', ['run', 'goldfish:ordered-product', '--', 'validate-reservoir',
    '--artifact', sourceFile('ranked.json'), '--reservoir', sourceFile('reservoir.json')], {
    cwd: process.cwd(), stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('The ordered-product validation CLI rejected the source.');
}

function loadOrAdaptPool(): OrderedChallengePoolArtifact {
  assertOrderedSourceExists();
  if (fs.existsSync(POOL_FILE)) {
    const held = readJson<unknown>(POOL_FILE);
    if (validateOrderedChallengePool(held)
      && held.source.rankedSha256 === sha256File(sourceFile('ranked.json'))
      && held.source.reservoirSha256 === sha256File(sourceFile('reservoir.json'))) {
      console.log('pool: resumed validated adaptation');
      return held;
    }
    console.log('pool: invalid or source bytes changed; rebuilding from validated source');
  }
  validateOrderedSource();
  const rankedText = fs.readFileSync(sourceFile('ranked.json'), 'utf8');
  const reservoirText = fs.readFileSync(sourceFile('reservoir.json'), 'utf8');
  const pool = adaptValidatedOrderedReservoir({
    manifest: JSON.parse(rankedText) as OrderedRankedManifestHeader,
    reservoir: JSON.parse(reservoirText) as OrderedProductReservoirArtifact,
    rankedSha256: sha256(rankedText), reservoirSha256: sha256(reservoirText)
  });
  writeAtomic(POOL_FILE, pool);
  console.log(`pool: wrote ${POOL_FILE}`);
  return pool;
}

function loadHistorical(): HistoricalUnit[] {
  return ORDERED_RESERVOIR_HISTORICAL_SEEDS.map((seed) => {
    const poolFile = historicalFile('pool', seed), runFile = historicalFile('run', seed);
    if (!fs.existsSync(poolFile) || !fs.existsSync(runFile)) {
      throw new Error(`Missing saved historical fixed-reservoir seed ${seed}.`);
    }
    return loadValidatedLegacyFixedReservoirV1(readJson<unknown>(poolFile), readJson<unknown>(runFile), {
      kingdomId: 'deep-beam-tuning-009', poolSeed: seed
    });
  });
}

function planSeeds(): Map<number, SeedPlan> {
  const ledger = new RandomPsroSeedLedger(ORDERED_RESERVOIR_COMPARISON_SEED);
  const result = new Map<number, SeedPlan>();
  const reserveAttack = (label: string) => ({
    race: ledger.reserve(`${label}:race`, FIXED_RESERVOIR_CONFIG.raceBlocks.reduce((sum, value) => sum + value, 0)),
    confirmation: ledger.reserve(`${label}:confirmation`, FIXED_RESERVOIR_CONFIG.confirmationBlocks),
    sampling: ledger.reserve(`${label}:sampling`, FIXED_RESERVOIR_CONFIG.raceBlocks.length + 1),
    bootstrap: ledger.reserve(`${label}:bootstrap`, FIXED_RESERVOIR_CONFIG.finalists)
  });
  for (const seed of ORDERED_RESERVOIR_HISTORICAL_SEEDS) {
    const prefix = `historical:${seed}`;
    const forward = ledger.reserve(`${prefix}:cross-play:ordered-row`, ORDERED_RESERVOIR_CROSS_PLAY_BLOCKS);
    const reverse = ledger.reserve(`${prefix}:cross-play:historical-row`, ORDERED_RESERVOIR_CROSS_PLAY_BLOCKS);
    const forwardBootstrap = ledger.reserve(`${prefix}:cross-play:ordered-bootstrap`, 1)[0]!;
    const reverseBootstrap = ledger.reserve(`${prefix}:cross-play:historical-bootstrap`, 1)[0]!;
    const orderedAttack = reserveAttack(`${prefix}:attack:ordered-pool`);
    const historicalAttack = reserveAttack(`${prefix}:attack:historical-pool`);
    const labels = Object.keys(ledger.namespaces).filter((label) => label.startsWith(prefix));
    result.set(seed, { namespaces: Object.fromEntries(labels.map((label) => [label, ledger.namespaces[label]!])),
      forward, reverse, forwardBootstrap, reverseBootstrap, orderedAttack, historicalAttack });
  }
  ledger.validate();
  return result;
}

function assertFreshComparisonSeeds(
  plans: ReadonlyMap<number, SeedPlan>, orderedRun: FixedReservoirPsroArtifact,
  historical: readonly HistoricalUnit[]
): void {
  const prior = new Set<number>([
    ...Object.values(orderedRun.seedNamespaces).flat(),
    ...historical.flatMap((unit) => Object.values(unit.run.seedNamespaces).flat())
  ]);
  const held = new Set<number>();
  for (const plan of plans.values()) for (const seed of Object.values(plan.namespaces).flat()) {
    if (prior.has(seed)) throw new Error(`Fresh comparison seed ${seed} overlaps saved PSRO evidence.`);
    if (held.has(seed)) throw new Error(`Fresh comparison seed ${seed} appears in two namespaces.`);
    held.add(seed);
  }
}

async function loadOrRunOneRound(
  pool: OrderedChallengePoolArtifact, runner: WorkerPairingRunner
): Promise<FixedReservoirPsroArtifact> {
  if (fs.existsSync(RUN_FILE)) {
    const held = readJson<unknown>(RUN_FILE);
    if (validateFixedReservoirPsroArtifact(held, pool, {
      evaluationSeed: ORDERED_RESERVOIR_EVALUATION_SEED,
      protocol: ORDERED_RESERVOIR_ONE_ROUND_PROTOCOL
    })) {
      const run = held as FixedReservoirPsroArtifact;
      assessOneRound(run);
      console.log('one round: resumed validated checkpoint');
      return run;
    }
    console.log('one round: invalid checkpoint; rerunning');
  }
  console.log('one round: building the 50-strategy matrix and scanning the remaining ordered reservoir once');
  const run = await runFixedReservoirPsro(pool, runner, {
    evaluationSeed: ORDERED_RESERVOIR_EVALUATION_SEED,
    protocol: ORDERED_RESERVOIR_ONE_ROUND_PROTOCOL
  });
  assessOneRound(run);
  if (!validateFixedReservoirPsroArtifact(run, pool, {
    evaluationSeed: ORDERED_RESERVOIR_EVALUATION_SEED,
    protocol: ORDERED_RESERVOIR_ONE_ROUND_PROTOCOL
  })) throw new Error('The one-round checkpoint failed deep validation.');
  writeAtomic(RUN_FILE, run);
  console.log(`one round: wrote ${RUN_FILE}`);
  return run;
}

async function lotteryDirection(
  runner: WorkerPairingRunner, row: ReturnType<typeof supportEntries>,
  column: ReturnType<typeof supportEntries>, seeds: readonly number[], bootstrapSeed: number
): Promise<LotteryDirectionEvidence> {
  const scores = await headToHead(runner, 'deep-beam-tuning-009', row.map((entry) => entry.strategy),
    column, seeds, 10, undefined, { startingDraftEnabled: false });
  return wholeLotteryEvidence(scores.map((score, index) => ({ strategyId: score.strategy.id,
    weight: row[index]!.weight, blockScores: score.blockScores, matches: score.matches })), bootstrapSeed);
}

function comparisonValid(
  value: unknown, historicalSeed: number, orderedHash: string, historicalHash: string,
  orderedScannedCount: number, historicalScannedCount: number, plan: SeedPlan
): value is ComparisonArtifact {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<ComparisonArtifact>;
  if (artifact.schemaVersion !== 1 || artifact.experiment !== 'ordered-reservoir-historical-comparison'
    || artifact.version !== ORDERED_RESERVOIR_CHALLENGE_VERSION
    || artifact.kingdomId !== 'deep-beam-tuning-009' || artifact.historicalPoolSeed !== historicalSeed
    || artifact.orderedReservoirHash !== orderedHash || artifact.historicalReservoirHash !== historicalHash
    || JSON.stringify(artifact.seedNamespaces) !== JSON.stringify(plan.namespaces)
    || artifact.orderedAsRow?.blocks !== ORDERED_RESERVOIR_CROSS_PLAY_BLOCKS
    || artifact.historicalAsRow?.blocks !== ORDERED_RESERVOIR_CROSS_PLAY_BLOCKS
    || artifact.orderedAttack?.scannedCount !== orderedScannedCount
    || artifact.historicalAttack?.scannedCount !== historicalScannedCount) return false;
  try {
    const direction = (held: LotteryDirectionEvidence, bootstrapSeed: number): boolean => {
      const rebuilt = wholeLotteryEvidence([{ strategyId: 'saved-lottery', weight: 1,
        blockScores: held.blockScores, matches: held.matches }], bootstrapSeed);
      return JSON.stringify(rebuilt) === JSON.stringify(held);
    };
    return direction(artifact.orderedAsRow, plan.forwardBootstrap)
      && direction(artifact.historicalAsRow, plan.reverseBootstrap)
      && JSON.stringify(summarizeAttack(orderedScannedCount, artifact.orderedAttack.finalists))
        === JSON.stringify(artifact.orderedAttack)
      && JSON.stringify(summarizeAttack(historicalScannedCount, artifact.historicalAttack.finalists))
        === JSON.stringify(artifact.historicalAttack);
  } catch { return false; }
}

async function loadOrCompare(
  pool: OrderedChallengePoolArtifact, orderedRun: FixedReservoirPsroArtifact,
  historical: HistoricalUnit, plan: SeedPlan, runner: WorkerPairingRunner
): Promise<ComparisonArtifact> {
  const seed = historical.pool.poolSeed, file = comparisonFile(seed);
  const orderedCandidates = inactiveAttackStrategies(
    pool.reservoir.map((entry) => entry.strategy), historical.run.matrix.strategies);
  const historicalCandidates = inactiveAttackStrategies(
    historical.pool.reservoir.map((entry) => entry.strategy), orderedRun.matrix.strategies);
  if (fs.existsSync(file)) {
    const held = readJson<unknown>(file);
    if (comparisonValid(held, seed, pool.reservoirHash, historical.pool.reservoirHash,
      orderedCandidates.length, historicalCandidates.length, plan)) {
      console.log(`comparison ${seed}: resumed validated checkpoint`);
      return held;
    }
    console.log(`comparison ${seed}: invalid checkpoint; rerunning`);
  }
  const started = Date.now();
  const orderedSupport = supportEntries(orderedRun), historicalSupport = supportEntries(historical.run);
  console.log(`comparison ${seed}: whole-lottery cross-play in both directions`);
  const orderedAsRow = await lotteryDirection(runner, orderedSupport, historicalSupport,
    plan.forward, plan.forwardBootstrap);
  const historicalAsRow = await lotteryDirection(runner, historicalSupport, orderedSupport,
    plan.reverse, plan.reverseBootstrap);
  console.log(`comparison ${seed}: ordered pool attack against historical lottery`);
  const orderedFinalists = await scanFixedReservoir({ candidates: orderedCandidates,
    snapshot: historical.run.matrix, equilibrium: historical.run.equilibrium, runner,
    kingdomId: pool.kingdomId, raceSeeds: plan.orderedAttack.race,
    confirmationSeeds: plan.orderedAttack.confirmation, samplingSeeds: plan.orderedAttack.sampling,
    bootstrapSeeds: plan.orderedAttack.bootstrap });
  console.log(`comparison ${seed}: historical pool attack against ordered lottery`);
  const historicalFinalists = await scanFixedReservoir({
    candidates: historicalCandidates,
    snapshot: orderedRun.matrix, equilibrium: orderedRun.equilibrium, runner,
    kingdomId: pool.kingdomId, raceSeeds: plan.historicalAttack.race,
    confirmationSeeds: plan.historicalAttack.confirmation, samplingSeeds: plan.historicalAttack.sampling,
    bootstrapSeeds: plan.historicalAttack.bootstrap });
  const artifact: ComparisonArtifact = { schemaVersion: 1,
    experiment: 'ordered-reservoir-historical-comparison', version: ORDERED_RESERVOIR_CHALLENGE_VERSION,
    kingdomId: pool.kingdomId, historicalPoolSeed: seed,
    orderedReservoirHash: pool.reservoirHash, historicalReservoirHash: historical.pool.reservoirHash,
    seedNamespaces: plan.namespaces, orderedAsRow, historicalAsRow,
    orderedAttack: summarizeAttack(orderedCandidates.length, orderedFinalists),
    historicalAttack: summarizeAttack(historicalCandidates.length, historicalFinalists),
    reservoirOverlap: canonicalOverlap(pool.reservoir.map((entry) => entry.strategy),
      historical.pool.reservoir.map((entry) => entry.strategy)), elapsedMs: Date.now() - started };
  writeAtomic(file, artifact);
  console.log(`comparison ${seed}: wrote ${file}`);
  return artifact;
}

function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function renderReport(
  pool: OrderedChallengePoolArtifact, run: FixedReservoirPsroArtifact,
  comparisons: readonly ComparisonArtifact[]
): { json: unknown; markdown: string } {
  const assessment = assessOneRound(run), aggregate = aggregateComparisons(comparisons);
  const json = { schemaVersion: 1, experiment: 'ordered-reservoir-challenge-report',
    version: ORDERED_RESERVOIR_CHALLENGE_VERSION, kingdomId: pool.kingdomId,
    source: pool.source, protocol: { ...ORDERED_RESERVOIR_ONE_ROUND_PROTOCOL },
    oneRound: { assessment, rounds: run.rounds.length, matrixSize: run.matrix.strategies.length,
      supportSize: supportEntries(run).length, elapsedMs: run.elapsedMs }, comparisons, aggregate };
  const markdown = [`# Ordered reservoir one-round challenge`, '', assessment.message, '',
    `Source: \`${ORDERED_RESERVOIR_SOURCE}\`. The ordered-product validation CLI validated the ranked artifact and its exact 20,000-entry prefix before adaptation.`, '',
    `The response protocol kept draft off, 50 health, race seed evaluations ${FIXED_RESERVOIR_CONFIG.raceBlocks.join('/')}, ${FIXED_RESERVOIR_CONFIG.confirmationBlocks} confirmation shuffle seeds, and ${FIXED_RESERVOIR_CONFIG.matrixBlocks} matrix shuffle seeds. It stopped after exactly one response round.`, '',
    '| Historical pool | Ordered row score | Historical row score | Ordered-pool exploits | Historical-pool exploits | Overlap |',
    '|---:|---:|---:|---:|---:|---:|',
    ...comparisons.map((entry) => `| ${entry.historicalPoolSeed} | ${percent(entry.orderedAsRow.score)} (${percent(entry.orderedAsRow.interval95.lower)}–${percent(entry.orderedAsRow.interval95.upper)}) | ${percent(entry.historicalAsRow.score)} (${percent(entry.historicalAsRow.interval95.lower)}–${percent(entry.historicalAsRow.interval95.upper)}) | ${entry.orderedAttack.exploitStrategyIds.length} | ${entry.historicalAttack.exploitStrategyIds.length} | ${entry.reservoirOverlap} |`), '',
    `Aggregate assessment: **${aggregate.assessment}**. The ordered-score range across both independent directions is ${percent(aggregate.minimumOrderedScore)}–${percent(aggregate.maximumOrderedScore)} with mean ${percent(aggregate.meanOrderedScore)}.`, '',
    `Attack evidence: ${aggregate.orderedExploitCount} confirmed ordered-pool exploit results and ${aggregate.historicalExploitCount} confirmed historical-pool exploit results across the five pairwise comparisons. A confirmed exploit has a fresh held-out 95% lower bound above 50%.`, '',
    'Whole-lottery directions use separate fresh 200-seed namespaces. Each attack uses separate fresh race, confirmation, sampling, and bootstrap namespaces. No comparison seed appears in the saved PSRO evidence.', ''].join('\n');
  return { json, markdown };
}

function status(): void {
  const files = [POOL_FILE, RUN_FILE, ...ORDERED_RESERVOIR_HISTORICAL_SEEDS.map(comparisonFile), REPORT_FILE];
  for (const file of files) console.log(`${fs.existsSync(file) ? 'complete' : 'missing'} ${file}`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--status')) { status(); return; }
  const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009');
  if (!kingdom) throw new Error('Kingdom 009 is missing.');
  registerKingdom(kingdom);
  if (kingdom.startingHealth !== 50) throw new Error('Kingdom 009 must use 50 health.');
  const workers = positiveInteger('--workers', PAIRING_WORKERS);
  const pool = loadOrAdaptPool();
  const historical = loadHistorical();
  const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  try {
    const run = await loadOrRunOneRound(pool, runner);
    const plans = planSeeds();
    assertFreshComparisonSeeds(plans, run, historical);
    const comparisons: ComparisonArtifact[] = [];
    for (let index = 0; index < historical.length; index += 1) {
      const seed = ORDERED_RESERVOIR_HISTORICAL_SEEDS[index]!;
      comparisons.push(await loadOrCompare(pool, run, historical[index]!, plans.get(seed)!, runner));
    }
    const report = renderReport(pool, run, comparisons);
    writeAtomic(REPORT_FILE, report.json); writeAtomic(REPORT_MARKDOWN, `${report.markdown}\n`);
    console.log(`report: wrote ${REPORT_FILE} and ${REPORT_MARKDOWN}`);
  } finally { await runner.close(); }
}

await main();
