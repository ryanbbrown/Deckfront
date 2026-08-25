import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { SeededRandom, cardDefinition, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import {
  FIXED_RESERVOIR_CONFIG, FIXED_RESERVOIR_VERSION, reservoirHash,
  runFixedReservoirPsro, selectFixedReservoir, supportEntries, validateFixedReservoirPool,
  validateFixedReservoirPsroArtifact
} from '../src/sim/fixedReservoirPsro';
import type {
  FixedReservoirPoolArtifact, FixedReservoirProtocol, FixedReservoirPsroArtifact
} from '../src/sim/fixedReservoirPsro';
import {
  DAMAGE_FAMILIES, FIXED_RESERVOIR_FIVE_RUN_VERSION, FIXED_RESERVOIR_KINGDOMS,
  FIXED_RESERVOIR_POOL_SEEDS, crossPlayMatrix, cumulativeFamilyCoverage, cumulativeMaterialCoverage,
  summarizeFiveRunCards, summarizeRunFamilies, suiteUnitActions
} from '../src/sim/fixedReservoirSuite';
import type {
  CrossPlayCell, DamageFamily, RunAcquisitionEvidence, SupportAcquisitionEvidence, UnitState
} from '../src/sim/fixedReservoirSuite';
import { rankingDigest } from '../src/sim/goldfish';
import type { GoldfishConfig, MovementAwareGoldfishScore } from '../src/sim/goldfish';
import { generatedProvenance } from '../src/sim/nativeStrategySearch';
import { percentileBootstrapMean } from '../src/sim/mixtureEvaluation';
import type { PairingJob } from '../src/sim/pairingRunner';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { stoplessRandomDomain } from '../src/sim/randomPsro';
import { RANDOM_PSRO_KINGDOMS } from '../src/sim/randomPsroSuite';
import { canonicalStrategy, formatSlot } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import type { TelemetryAggregate } from '../src/sim/types';
import { classifyStrategyDamage } from './generate_balance_corpus';
import { headToHead } from './headToHead';

type WorkerScore = Omit<MovementAwareGoldfishScore, 'strategy'>;
interface WorkerReply { id: number; scores?: WorkerScore[]; error?: string; stack?: string }
interface SuiteConfig { kingdom: Kingdom; evaluationSeed: number }

const ROOT = path.join('.experiments', 'fixed-reservoir-psro-five-run', FIXED_RESERVOIR_FIVE_RUN_VERSION);
const RESULT_JSON = path.join(ROOT, 'report.json');
const RESULT_MARKDOWN = path.join('.plans', '47-fixed-reservoir-five-run-results.md');
const LEGACY_ROOT = path.join('.experiments', FIXED_RESERVOIR_VERSION);
const GOLDFISH_SEEDS = Object.freeze([5_200_000, 5_200_001, 5_200_002, 5_200_003]);
const WORKERS = 10;

function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function kingdomDirectory(kingdomId: string): string { return path.join(ROOT, kingdomId); }
function poolPath(kingdomId: string, seed: number): string { return path.join(kingdomDirectory(kingdomId), `pool-${seed}.json`); }
function runPath(kingdomId: string, seed: number): string { return path.join(kingdomDirectory(kingdomId), `run-${seed}.json`); }
function plan(strategy: Strategy): string {
  return strategy.buyPlan.filter((slot) => slot.kind !== 'inactive').map(formatSlot).join(' → ');
}
function configs(): SuiteConfig[] {
  return FIXED_RESERVOIR_KINGDOMS.map((entry) => {
    const kingdom = RANDOM_PSRO_KINGDOMS.find((candidate) => candidate.id === entry.kingdomId);
    if (!kingdom) throw new Error(`Missing ${entry.kingdomId}.`);
    return { kingdom, evaluationSeed: entry.evaluationSeed };
  });
}
function expectation(config: SuiteConfig, seed: number, protocol = FIXED_RESERVOIR_CONFIG) {
  return { kingdomId: config.kingdom.id, poolSeed: seed, generatedCount: protocol.generatedCount,
    goldfishCount: protocol.goldfishCount, randomCount: protocol.randomCount, goldfishSeeds: GOLDFISH_SEEDS };
}
function generate(kingdomId: string, count: number, seed: number) {
  const domain = stoplessRandomDomain(kingdomId), random = new SeededRandom(seed), seen = new Set<string>();
  const identities = new Map<string, string>(), strategies: Strategy[] = [];
  let duplicateCanonicalCount = 0, displayIdCollisionCount = 0;
  while (strategies.length < count) {
    const strategy = domain.randomComplete(random), key = canonicalStrategy(strategy);
    if (seen.has(key)) { duplicateCanonicalCount += 1; continue; }
    seen.add(key); const held = identities.get(strategy.id);
    if (held !== undefined && held !== key) displayIdCollisionCount += 1;
    else identities.set(strategy.id, key);
    strategies.push(strategy);
  }
  return { strategies, duplicateCanonicalCount, displayIdCollisionCount };
}
async function scoreInWorkers(
  strategies: readonly Strategy[], config: GoldfishConfig, kingdom: Kingdom, workers = WORKERS
): Promise<MovementAwareGoldfishScore[]> {
  const pool = Array.from({ length: workers }, () => new Worker(
    new URL('../src/server/goldfishWorker.ts', import.meta.url),
    { workerData: { kingdom }, execArgv: ['--import', 'tsx'] }));
  try {
    const partitions = pool.map((_worker, index) => strategies.slice(
      Math.floor(strategies.length * index / workers), Math.floor(strategies.length * (index + 1) / workers)));
    return (await Promise.all(pool.map((worker, index) => new Promise<MovementAwareGoldfishScore[]>((resolve, reject) => {
      const onError = (error: Error): void => reject(error); worker.once('error', onError);
      worker.once('message', (reply: WorkerReply) => {
        worker.off('error', onError);
        if (reply.error || !reply.scores) { reject(new Error(reply.stack ?? reply.error ?? 'Goldfish worker failed.')); return; }
        resolve(reply.scores.map((score, scoreIndex) => ({ ...score, strategy: partitions[index]![scoreIndex]! })));
      });
      worker.postMessage({ id: index, strategies: partitions[index], config, mode: 'movement-aware' });
    })))).flat();
  } finally { await Promise.all(pool.map((worker) => worker.terminate())); }
}
async function buildPool(
  config: SuiteConfig, poolSeed: number, file: string, protocol = FIXED_RESERVOIR_CONFIG, workers = WORKERS
): Promise<FixedReservoirPoolArtifact> {
  const started = Date.now();
  console.log(`${config.kingdom.id} pool ${poolSeed}: generating ${protocol.generatedCount}`);
  const generation = generate(config.kingdom.id, protocol.generatedCount, poolSeed);
  const generated = generation.strategies;
  console.log(`${config.kingdom.id} pool ${poolSeed}: goldfishing`);
  const scores = await scoreInWorkers(generated, { kingdomId: config.kingdom.id, seeds: GOLDFISH_SEEDS,
    turnLimit: 30, actionCapPerTurn: 200 }, config.kingdom, workers);
  const reservoir = selectFixedReservoir(scores, protocol.goldfishCount, protocol.randomCount, poolSeed);
  const provenance = generatedProvenance(generated, generation.duplicateCanonicalCount,
    generation.displayIdCollisionCount);
  const artifact: FixedReservoirPoolArtifact = { schemaVersion: 2, experiment: 'fixed-reservoir-pool',
    version: FIXED_RESERVOIR_VERSION, kingdomId: config.kingdom.id, poolSeed, goldfishSeeds: [...GOLDFISH_SEEDS],
    generatedCount: generated.length, generatedHash: provenance.generatedIdDigest,
    canonicalProvenanceDigest: provenance.canonicalProvenanceDigest,
    duplicateCanonicalCount: provenance.duplicateCanonicalCount,
    displayIdCollisionCount: provenance.displayIdCollisionCount,
    scoringProtocol: 'typescript-movement-aware-v1', shardProvenance: [{ shardId: 'local-0', startPosition: 0,
      endPosition: generated.length, candidateDigest: provenance.canonicalProvenanceDigest,
      scoreDigest: rankingDigest(scores) }],
    reservoirHash: reservoirHash(reservoir), reservoir, elapsedMs: Date.now() - started };
  writeAtomic(file, artifact);
  console.log(`${config.kingdom.id} pool ${poolSeed}: completed; ${(artifact.elapsedMs / 1000).toFixed(1)}s`);
  return artifact;
}
async function runPsro(
  config: SuiteConfig, pool: FixedReservoirPoolArtifact, file: string,
  protocol = FIXED_RESERVOIR_CONFIG, workers = WORKERS
): Promise<FixedReservoirPsroArtifact> {
  const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom: config.kingdom }, ['--import', 'tsx']);
  try {
    const artifact = await runFixedReservoirPsro(pool, runner, { evaluationSeed: config.evaluationSeed, protocol });
    writeAtomic(file, artifact);
    console.log(`${config.kingdom.id} run ${pool.poolSeed}: ${artifact.status}; ${artifact.rounds.length} rounds; ${(artifact.elapsedMs / 1000).toFixed(1)}s`);
    return artifact;
  } finally { await runner.close(); }
}
function structuralState(config: SuiteConfig, seed: number): { pool: UnitState; run: UnitState } {
  const poolFile = poolPath(config.kingdom.id, seed), runFile = runPath(config.kingdom.id, seed);
  if (!fs.existsSync(poolFile)) return { pool: 'missing', run: fs.existsSync(runFile) ? 'invalid' : 'missing' };
  let pool: FixedReservoirPoolArtifact;
  try {
    const held = readJson(poolFile) as FixedReservoirPoolArtifact;
    if (held.experiment !== 'fixed-reservoir-pool' || held.kingdomId !== config.kingdom.id || held.poolSeed !== seed
      || held.generatedCount !== FIXED_RESERVOIR_CONFIG.generatedCount || held.reservoir?.length !== 20_000) {
      return { pool: 'invalid', run: fs.existsSync(runFile) ? 'invalid' : 'missing' };
    }
    pool = held;
  } catch { return { pool: 'invalid', run: fs.existsSync(runFile) ? 'invalid' : 'missing' }; }
  if (!fs.existsSync(runFile)) return { pool: 'complete', run: 'missing' };
  try {
    const run = readJson(runFile) as FixedReservoirPsroArtifact;
    return { pool: 'complete', run: run.experiment === 'fixed-reservoir-psro'
      && run.kingdomId === config.kingdom.id && run.poolSeed === seed
      && run.evaluationSeed === config.evaluationSeed && run.poolHash === pool.generatedHash
      && run.reservoirHash === pool.reservoirHash ? 'complete' : 'invalid' };
  } catch { return { pool: 'complete', run: 'invalid' }; }
}
function deepLoad(config: SuiteConfig, seed: number): { pool: FixedReservoirPoolArtifact; run: FixedReservoirPsroArtifact } | null {
  const poolFile = poolPath(config.kingdom.id, seed), runFile = runPath(config.kingdom.id, seed);
  if (!fs.existsSync(poolFile) || !fs.existsSync(runFile)) return null;
  const pool = readJson(poolFile);
  if (!validateFixedReservoirPool(pool, expectation(config, seed))) return null;
  const run = readJson(runFile);
  if (!validateFixedReservoirPsroArtifact(run, pool, { evaluationSeed: config.evaluationSeed })) return null;
  return { pool, run: run as FixedReservoirPsroArtifact };
}

async function prepare(): Promise<void> {
  const config = configs().find((entry) => entry.kingdom.id === 'deep-beam-tuning-009')!;
  registerKingdom(config.kingdom);
  for (const seed of [1, 2]) {
    const oldPool = path.join(LEGACY_ROOT, `pool-${seed}.json`), oldRun = path.join(LEGACY_ROOT, `run-${seed}.json`);
    if (!fs.existsSync(oldPool) || !fs.existsSync(oldRun)) throw new Error(`Missing legacy seed ${seed} artifacts.`);
    const pool = readJson(oldPool);
    if (!validateFixedReservoirPool(pool, expectation(config, seed))) throw new Error(`Legacy pool ${seed} is invalid.`);
    const run = readJson(oldRun);
    if (!validateFixedReservoirPsroArtifact(run, pool, { evaluationSeed: config.evaluationSeed })) {
      throw new Error(`Legacy run ${seed} is invalid.`);
    }
    fs.mkdirSync(kingdomDirectory(config.kingdom.id), { recursive: true });
    fs.copyFileSync(oldPool, poolPath(config.kingdom.id, seed));
    fs.copyFileSync(oldRun, runPath(config.kingdom.id, seed));
    if (!deepLoad(config, seed)) throw new Error(`Prepared seed ${seed} failed validation.`);
    console.log(`prepared ${config.kingdom.id} seed ${seed}`);
  }
}
async function runSuite(): Promise<void> {
  let index = 0;
  for (const config of configs()) {
    registerKingdom(config.kingdom);
    for (const seed of FIXED_RESERVOIR_POOL_SEEDS) {
      index += 1;
      let loaded = deepLoad(config, seed);
      if (loaded) { console.log(`[${index}/10] ${config.kingdom.id} seed ${seed}: skipped valid`); continue; }
      const poolFile = poolPath(config.kingdom.id, seed), runFile = runPath(config.kingdom.id, seed);
      let pool: FixedReservoirPoolArtifact | null = null;
      if (fs.existsSync(poolFile)) {
        const held = readJson(poolFile);
        if (validateFixedReservoirPool(held, expectation(config, seed))) pool = held;
      }
      if (!pool) pool = await buildPool(config, seed, poolFile);
      const run = await runPsro(config, pool, runFile);
      if (!validateFixedReservoirPsroArtifact(run, pool, { evaluationSeed: config.evaluationSeed })) {
        throw new Error(`${config.kingdom.id} seed ${seed} wrote an invalid run.`);
      }
      loaded = { pool, run };
      console.log(`[${index}/10] ${config.kingdom.id} seed ${seed}: ${loaded.run.status}`);
    }
  }
}
function status(): void {
  let complete = 0;
  for (const config of configs()) for (const seed of FIXED_RESERVOIR_POOL_SEEDS) {
    const state = structuralState(config, seed), actions = suiteUnitActions(state);
    if (actions[0] === 'skip') complete += 1;
    console.log(`${config.kingdom.id} seed ${seed}: pool ${state.pool}; run ${state.run}`);
  }
  console.log(`${complete}/10 structurally complete`);
  if (complete !== 10) process.exitCode = 1;
}

function games(telemetry: TelemetryAggregate): number {
  return Object.values(telemetry.byOrientation).reduce((total, pair) =>
    total + pair.normal.played + pair.swapped.played, 0);
}
function cellTelemetry(artifact: FixedReservoirPsroArtifact, left: string, right: string): TelemetryAggregate {
  const cell = artifact.matrix.cells.find((candidate) =>
    (candidate.rowId === left && candidate.columnId === right)
    || (candidate.rowId === right && candidate.columnId === left));
  if (!cell) throw new Error(`Missing cell ${left}/${right}.`);
  return cell.telemetry;
}
function damageFamily(cardId: string): DamageFamily | null {
  const mechanic = cardDefinition(cardId).mechanic;
  if (['melee', 'drive', 'flurry', 'openingStrike', 'rally', 'bullRush'].includes(mechanic)) return 'Melee';
  if (['ranged', 'repellingShot', 'volley', 'longshot', 'salvageShot', 'precisionShot'].includes(mechanic)) return 'Ranged';
  if (['spell', 'discharge', 'cascade', 'overload'].includes(mechanic)) return 'Mage';
  return null;
}
function damageAmounts(strategy: Strategy, acquisitionRates: Record<string, number>): Record<DamageFamily, number> {
  const amounts = Object.fromEntries(DAMAGE_FAMILIES.map((family) => [family, 0])) as Record<DamageFamily, number>;
  for (const cardId of strategy.startingBuild) { const family = damageFamily(cardId); if (family) amounts[family] += 1; }
  for (const [cardId, rate] of Object.entries(acquisitionRates)) { const family = damageFamily(cardId); if (family) amounts[family] += rate; }
  const improvise = strategy.startingBuild.filter((cardId) => cardId === 'improvise').length + (acquisitionRates.improvise ?? 0);
  if (improvise > 0) {
    const ids = [...strategy.startingBuild, ...Object.entries(acquisitionRates).filter(([, rate]) => rate > 0).map(([id]) => id)];
    const owned = new Set(ids.flatMap((id) => cardDefinition(id).family === 'melee' ? ['Melee' as const]
      : cardDefinition(id).family === 'ranged' ? ['Ranged' as const]
        : cardDefinition(id).family === 'mana' ? ['Mage' as const] : []));
    for (const family of owned) amounts[family] += improvise;
  }
  return amounts;
}
async function acquisitionEvidence(
  artifact: FixedReservoirPsroArtifact, runner: WorkerPairingRunner
): Promise<RunAcquisitionEvidence> {
  const support = supportEntries(artifact);
  const jobs: PairingJob[] = support.map((entry, index) => ({ candidate: entry.strategy, opponent: entry.strategy,
    options: { kingdomId: artifact.kingdomId, seeds: Array.from({ length: 25 }, (_unused, seedIndex) =>
      8_100_000 + index * 100 + seedIndex), turnLimitPerPlayer: 50, actionCapPerTurn: 200,
    startingDraftEnabled: false, allowEarlyStop: false } }));
  const batch = await runner.run(jobs);
  const self = new Map(support.map((entry, index) => [entry.strategy.id, batch.outcomes[index]!.telemetry]));
  const evidence: SupportAcquisitionEvidence[] = [];
  for (const entry of support) {
    const totals: Record<string, number> = {}; let weightedGames = 0;
    for (const opponent of support) {
      const mirror = entry.strategy.id === opponent.strategy.id;
      const telemetry = mirror ? self.get(entry.strategy.id)! : cellTelemetry(artifact, entry.strategy.id, opponent.strategy.id);
      const divisor = mirror ? 2 : 1;
      weightedGames += games(telemetry) / divisor * opponent.weight;
      for (const [cardId, amount] of Object.entries(telemetry.acquisitionsByStrategy[entry.strategy.id] ?? {})) {
        totals[cardId] = (totals[cardId] ?? 0) + amount / divisor * opponent.weight;
      }
    }
    const acquisitionRates = Object.fromEntries(Object.entries(totals).map(([cardId, amount]) =>
      [cardId, amount / weightedGames]));
    evidence.push({ strategyId: entry.strategy.id, weight: entry.weight,
      archetype: classifyStrategyDamage({ startingBuild: entry.strategy.startingBuild, acquisitionRates }),
      acquisitionRates, damageAmounts: damageAmounts(entry.strategy, acquisitionRates) });
  }
  return { poolSeed: artifact.poolSeed, support: evidence };
}
async function crossPlay(
  runs: readonly FixedReservoirPsroArtifact[], runner: WorkerPairingRunner
): Promise<CrossPlayCell[]> {
  const seeds = Array.from({ length: 200 }, (_unused, index) => 8_200_000 + index);
  const cells: CrossPlayCell[] = [];
  for (const row of runs) for (const column of runs) {
    const rowSupport = supportEntries(row), columnSupport = supportEntries(column);
    const scores = await headToHead(runner, row.kingdomId, rowSupport.map((entry) => entry.strategy),
      columnSupport, seeds, 10, undefined, { startingDraftEnabled: false });
    const blocks = seeds.map((_seed, index) => scores.reduce((sum, score, strategyIndex) =>
      sum + score.blockScores[index]! * rowSupport[strategyIndex]!.weight, 0));
    cells.push({ rowSeed: row.poolSeed, columnSeed: column.poolSeed,
      score: blocks.reduce((sum, value) => sum + value, 0) / blocks.length,
      interval95: percentileBootstrapMean(blocks, 8_300_000 + row.poolSeed * 10 + column.poolSeed) });
  }
  return cells;
}
function overlaps(pools: readonly FixedReservoirPoolArtifact[]) {
  const rows = [];
  for (let left = 0; left < pools.length; left += 1) for (let right = left + 1; right < pools.length; right += 1) {
    const ids = new Set(pools[left]!.reservoir.map((entry) => canonicalStrategy(entry.strategy)));
    rows.push({ leftSeed: pools[left]!.poolSeed, rightSeed: pools[right]!.poolSeed,
      overlap: pools[right]!.reservoir.filter((entry) => ids.has(canonicalStrategy(entry.strategy))).length });
  }
  return rows;
}
function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
async function report(): Promise<void> {
  const model: { version: string; kingdoms: unknown[] } = { version: FIXED_RESERVOIR_FIVE_RUN_VERSION, kingdoms: [] };
  const markdown = ['# Fixed-reservoir five-run results', '',
    'A card is material in a strategy at 0.1 acquired copies per game. A card appears in a run when those strategies hold at least 1% total equilibrium weight.', ''];
  for (const config of configs()) {
    registerKingdom(config.kingdom);
    const loaded = FIXED_RESERVOIR_POOL_SEEDS.map((seed) => deepLoad(config, seed));
    if (loaded.some((entry) => !entry)) throw new Error(`${config.kingdom.id} does not have five valid runs.`);
    const units = loaded as Array<{ pool: FixedReservoirPoolArtifact; run: FixedReservoirPsroArtifact }>;
    const runner = new WorkerPairingRunner(WORKERS, new URL('../src/server/aiWorker.ts', import.meta.url),
      { kingdom: config.kingdom }, ['--import', 'tsx']);
    try {
      const evidence = [] as RunAcquisitionEvidence[];
      for (const unit of units) evidence.push(await acquisitionEvidence(unit.run, runner));
      const family = evidence.map(summarizeRunFamilies);
      const cards = summarizeFiveRunCards(evidence, stoplessRandomDomain(config.kingdom.id).purchaseIds);
      const coverage = cumulativeMaterialCoverage(cards);
      const familyCoverage = cumulativeFamilyCoverage(family);
      const cells = await crossPlay(units.map((unit) => unit.run), runner);
      const matrix = crossPlayMatrix(cells, FIXED_RESERVOIR_POOL_SEEDS);
      const overlap = overlaps(units.map((unit) => unit.pool));
      const runRows = units.map((unit, index) => ({ poolSeed: unit.pool.poolSeed,
        poolMs: unit.pool.elapsedMs, psroMs: unit.run.elapsedMs, status: unit.run.status,
        rounds: unit.run.rounds.length, matrixSize: unit.run.matrix.strategies.length,
        supports: supportEntries(unit.run).filter((entry) => entry.weight >= 0.001).map((entry) =>
          ({ id: entry.strategy.id, weight: entry.weight, plan: plan(entry.strategy) })), family: family[index] }));
      model.kingdoms.push({ kingdomId: config.kingdom.id, evaluationSeed: config.evaluationSeed,
        runs: runRows, cards, coverage, familyCoverage, overlap, crossPlay: { cells, matrix } });
      markdown.push(`## ${config.kingdom.id}`, '',
        '| Seed | Pool | PSRO | Rounds | Matrix | Archetypes | Continuous Melee / Ranged / Mage |',
        '|---:|---:|---:|---:|---:|---|---|',
        ...runRows.map((row) => `| ${row.poolSeed} | ${(row.poolMs / 60000).toFixed(1)}m | ${(row.psroMs / 60000).toFixed(1)}m | ${row.rounds} | ${row.matrixSize} | ${Object.entries(row.family!.archetypes).map(([name, share]) => `${name} ${percent(share)}`).join('; ')} | ${percent(row.family!.continuous.Melee)} / ${percent(row.family!.continuous.Ranged)} / ${percent(row.family!.continuous.Mage)} |`), '',
        '| Card | Mean copies | Min–max | Material runs |', '|---|---:|---:|---:|',
        ...cards.filter((card) => card.materialRuns > 0).sort((left, right) => right.mean - left.mean)
          .map((card) => `| ${card.cardId} | ${card.mean.toFixed(2)} | ${card.minimum.toFixed(2)}–${card.maximum.toFixed(2)} | ${card.materialRuns}/5 |`), '',
        `Reservoir overlap: ${Math.min(...overlap.map((entry) => entry.overlap))}–${Math.max(...overlap.map((entry) => entry.overlap))} of 20,000 across run pairs.`, '',
        `Cumulative material families after runs 1–5: ${familyCoverage.map((entry) => `${entry.afterRuns}:${entry.families.join('+') || 'none'}`).join(', ')}.`,
        `Cumulative material cards after runs 1–5: ${coverage.map((entry) => `${entry.afterRuns}:${entry.cards.length}`).join(', ')}.`, '');
    } finally { await runner.close(); }
  }
  markdown.push('These results describe the fixed searched reservoirs. They do not prove global card balance or strategy coverage.', '');
  writeAtomic(RESULT_JSON, model);
  writeAtomic(RESULT_MARKDOWN, `${markdown.join('\n')}\n`);
  console.log(`wrote ${RESULT_JSON} and ${RESULT_MARKDOWN}`);
}
async function smoke(): Promise<void> {
  const config = configs().find((entry) => entry.kingdom.id === 'deep-beam-tuning-009')!;
  registerKingdom(config.kingdom);
  const protocol: FixedReservoirProtocol = { generatedCount: 200, goldfishCount: 18, randomCount: 2,
    initialStrategies: 5, raceBlocks: [1], finalists: 2, confirmationBlocks: 4, matrixBlocks: 2,
    cleanScansRequired: 2, safetyCap: 4, admissionLowerBound: 0.5, chunkSize: 50 };
  const directory = path.join(ROOT, 'smoke'); fs.mkdirSync(directory, { recursive: true });
  const pool = await buildPool(config, 991, path.join(directory, 'pool.json'), protocol, 2);
  const run = await runPsro(config, pool, path.join(directory, 'run.json'), protocol, 2);
  if (!validateFixedReservoirPool(pool, expectation(config, 991, protocol))
    || !validateFixedReservoirPsroArtifact(run, pool, { evaluationSeed: config.evaluationSeed, protocol })) {
    throw new Error('Smoke artifacts failed validation.');
  }
  console.log('smoke completed');
}

const command = process.argv[2] ?? '--run';
if (command === '--prepare') await prepare();
else if (command === '--status') status();
else if (command === '--report') await report();
else if (command === '--smoke') await smoke();
else if (command === '--run') await runSuite();
else throw new Error(`Unknown command ${command}.`);
