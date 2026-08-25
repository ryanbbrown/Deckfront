import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { SeededRandom, cardDefinition, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import {
  FIXED_RESERVOIR_CONFIG, FIXED_RESERVOIR_EVALUATION_SEED, scanFixedReservoir,
  supportEntries, validateFixedReservoirPool, validateFixedReservoirPsroArtifact
} from '../src/sim/fixedReservoirPsro';
import type {
  FixedReservoirPoolArtifact, FixedReservoirPsroArtifact, ReservoirConfirmedCandidate
} from '../src/sim/fixedReservoirPsro';
import {
  DAMAGE_FAMILIES, MATERIAL_ACQUISITIONS_PER_GAME, MATERIAL_EQUILIBRIUM_SHARE,
  summarizeRunFamilies
} from '../src/sim/fixedReservoirSuite';
import type {
  DamageFamily, RunAcquisitionEvidence, SupportAcquisitionEvidence
} from '../src/sim/fixedReservoirSuite';
import {
  GOLDFISH_MOVEMENT_PROFILES, compareMovementAwareGoldfishScores, rankingDigest
} from '../src/sim/goldfish';
import type { GoldfishConfig, MovementAwareGoldfishScore } from '../src/sim/goldfish';
import { percentileBootstrapMean } from '../src/sim/mixtureEvaluation';
import { generatedProvenance } from '../src/sim/nativeStrategySearch';
import type { PairingJob } from '../src/sim/pairingRunner';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { stoplessRandomDomain } from '../src/sim/randomPsro';
import { RANDOM_PSRO_KINGDOMS } from '../src/sim/randomPsroSuite';
import {
  STAGED_GOLDFISH_VERSION, runStagedFixedReservoirPsro, selectStagedReservoirFromEvidence,
  stagedReservoirHash, validateStagedFixedReservoirPool, validateStagedFixedReservoirPsroArtifact
} from '../src/sim/stagedGoldfish';
import type {
  StageOneRankedScore, StagedFixedReservoirPoolArtifact, StagedFixedReservoirPsroArtifact
} from '../src/sim/stagedGoldfish';
import {
  STAGED_GOLDFISH_POOL_SEEDS, parseStagedGoldfishArgs, stagedGoldfishArtifactDirectory,
  stagedGoldfishAttackSeeds, stagedGoldfishEvidenceSeedRoots
} from '../src/sim/stagedGoldfishSuite';
import type {
  StagedGoldfishPoolSeed, StagedGoldfishUnitCommand
} from '../src/sim/stagedGoldfishSuite';
import { canonicalStrategy, formatSlot, stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import { compareUtf16 } from '../src/sim/utf16';
import type { TelemetryAggregate } from '../src/sim/types';
import { classifyStrategyDamage } from './generate_balance_corpus';
import { headToHead } from './headToHead';

const KINGDOM_ID = 'deep-beam-tuning-009';
const GOLDFISH_SEEDS = Object.freeze([5_200_000, 5_200_001, 5_200_002, 5_200_003]);
const FIRST_GOLDFISH_SEED = GOLDFISH_SEEDS[0]!;
const REMAINING_GOLDFISH_SEEDS = GOLDFISH_SEEDS.slice(1);
const PREFILTER_COUNT = 50_000;
const WORKERS = 10;
const LEGACY_ROOT = path.join('.experiments', 'staged-goldfish-ab', STAGED_GOLDFISH_VERSION, KINGDOM_ID);
const BASELINE_ROOT = path.join('.experiments', 'fixed-reservoir-psro-five-run',
  'fixed-reservoir-five-run-v1', KINGDOM_ID);
interface ArtifactPaths {
  root: string; stageOne: string; pool: string; run: string; acquisition: string; lottery: string;
  baselineAttack: string; stagedAttack: string; report: string; reportMarkdown: string;
}
function artifactPaths(poolSeed: StagedGoldfishPoolSeed): ArtifactPaths {
  const root = stagedGoldfishArtifactDirectory(KINGDOM_ID, poolSeed);
  return { root, stageOne: path.join(root, 'stage-one.json'), pool: path.join(root, `pool-${poolSeed}.json`),
    run: path.join(root, `run-${poolSeed}.json`), acquisition: path.join(root, 'acquisition.json'),
    lottery: path.join(root, 'lottery-cross-play.json'),
    baselineAttack: path.join(root, 'baseline-reservoir-vs-staged.json'),
    stagedAttack: path.join(root, 'staged-reservoir-vs-baseline.json'),
    report: path.join(root, 'report.json'), reportMarkdown: path.join(root, 'report.md') };
}
let poolSeed: StagedGoldfishPoolSeed = 5;
let files = artifactPaths(poolSeed);

type WorkerScore = Omit<MovementAwareGoldfishScore, 'strategy'>;
interface WorkerReply { id: number; scores?: WorkerScore[]; error?: string; stack?: string }
interface StageOneArtifact {
  schemaVersion: 1;
  experiment: 'staged-goldfish-stage-one';
  version: typeof STAGED_GOLDFISH_VERSION;
  kingdomId: string;
  poolSeed: number;
  seed: number;
  generatedCount: number;
  generatedHash: string;
  canonicalProvenanceDigest: string;
  prefilterCount: number;
  generationMs: number;
  scoringMs: number;
  scoreDigest: string;
  prefilter: StageOneRankedScore[];
  tailCandidates: StageOneRankedScore[];
}
type AttackDirection = 'baseline-vs-staged' | 'staged-vs-baseline';
interface AttackProvenance {
  reservoir: 'baseline' | 'staged';
  source: 'goldfish' | 'random';
  scoreProvenance: 'baseline-four-seed' | 'combined-four-seed' | 'stage-one-only';
  goldfishRank?: number;
  stageOneGoldfishRank?: number | null;
  fourSeedGoldfishRank?: number;
  randomTailRank?: number;
}
interface AttackCandidate { strategy: Strategy; provenance: AttackProvenance }
interface AttackFinalist extends ReservoirConfirmedCandidate { provenance: AttackProvenance }
interface AttackArtifact {
  schemaVersion: 1;
  experiment: 'staged-goldfish-fixed-reservoir-cross-attack';
  direction: AttackDirection;
  sourceReservoirHash: string;
  targetReservoirHash: string;
  targetRunHash: string;
  candidateHash: string;
  candidateCount: number;
  excludedActiveCount: number;
  seedRoot: number;
  seedNamespaces: Record<string, number[]>;
  protocol: { raceBlocks: number[]; finalists: number; confirmationBlocks: number; chunkSize: number };
  elapsedMs: number;
  finalists: AttackFinalist[];
  strongestStrategyId: string | null;
}

const ATTACK_PROTOCOL = Object.freeze({ raceBlocks: [...FIXED_RESERVOIR_CONFIG.raceBlocks],
  finalists: FIXED_RESERVOIR_CONFIG.finalists,
  confirmationBlocks: FIXED_RESERVOIR_CONFIG.confirmationBlocks,
  chunkSize: FIXED_RESERVOIR_CONFIG.chunkSize });
type RunArtifact = FixedReservoirPsroArtifact | StagedFixedReservoirPsroArtifact;

function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function configurePoolSeed(seed: StagedGoldfishPoolSeed): void { poolSeed = seed; files = artifactPaths(seed); }
function migrateSeedFiveArtifacts(): void {
  const destination = artifactPaths(5);
  const names = ['stage-one.json', 'pool-5.json', 'run-5.json', 'acquisition.json', 'lottery-cross-play.json',
    'baseline-reservoir-vs-staged.json', 'staged-reservoir-vs-baseline.json', 'report.json', 'report.md'];
  fs.mkdirSync(destination.root, { recursive: true });
  for (const name of names) {
    const source = path.join(LEGACY_ROOT, name), target = path.join(destination.root, name);
    if (fs.existsSync(source) && !fs.existsSync(target)) fs.renameSync(source, target);
  }
}
function tailRank(id: string): number {
  return Number.parseInt(stableHash(`reservoir-tail:${poolSeed}:${id}`).slice(0, 8), 16) >>> 0;
}
function generate(count: number) {
  const domain = stoplessRandomDomain(KINGDOM_ID), random = new SeededRandom(poolSeed), seen = new Set<string>();
  const ids = new Map<string, string>(), strategies: Strategy[] = [];
  let duplicateCanonicalCount = 0, displayIdCollisionCount = 0;
  while (strategies.length < count) {
    const strategy = domain.randomComplete(random), key = canonicalStrategy(strategy);
    if (seen.has(key)) { duplicateCanonicalCount += 1; continue; }
    seen.add(key); const held = ids.get(strategy.id);
    if (held !== undefined && held !== key) displayIdCollisionCount += 1; else ids.set(strategy.id, key);
    strategies.push(strategy);
  }
  return { strategies, duplicateCanonicalCount, displayIdCollisionCount };
}
async function scoreInWorkers(
  strategies: readonly Strategy[], config: GoldfishConfig, kingdom: Kingdom
): Promise<MovementAwareGoldfishScore[]> {
  const workers = Array.from({ length: WORKERS }, () => new Worker(
    new URL('../src/server/goldfishWorker.ts', import.meta.url),
    { workerData: { kingdom }, execArgv: ['--import', 'tsx'] }));
  try {
    const partitions = workers.map((_worker, index) => strategies.slice(
      Math.floor(strategies.length * index / workers.length),
      Math.floor(strategies.length * (index + 1) / workers.length)));
    return (await Promise.all(workers.map((worker, index) => new Promise<MovementAwareGoldfishScore[]>((resolve, reject) => {
      const onError = (error: Error): void => reject(error); worker.once('error', onError);
      worker.once('message', (reply: WorkerReply) => {
        worker.off('error', onError);
        if (reply.error || !reply.scores) { reject(new Error(reply.stack ?? reply.error ?? 'Goldfish worker failed.')); return; }
        resolve(reply.scores.map((score, scoreIndex) => ({ ...score, strategy: partitions[index]![scoreIndex]! })));
      });
      worker.postMessage({ id: index, strategies: partitions[index], config, mode: 'movement-aware' });
    })))).flat();
  } finally { await Promise.all(workers.map((worker) => worker.terminate())); }
}
function validStageOne(value: unknown, baseline: FixedReservoirPoolArtifact): value is StageOneArtifact {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<StageOneArtifact>;
  if (artifact.schemaVersion !== 1 || artifact.experiment !== 'staged-goldfish-stage-one'
    || artifact.version !== STAGED_GOLDFISH_VERSION || artifact.kingdomId !== KINGDOM_ID
    || artifact.poolSeed !== poolSeed || artifact.seed !== FIRST_GOLDFISH_SEED
    || artifact.generatedCount !== FIXED_RESERVOIR_CONFIG.generatedCount
    || artifact.prefilterCount !== PREFILTER_COUNT
    || !Array.isArray(artifact.prefilter) || !Array.isArray(artifact.tailCandidates)
    || artifact.generatedHash !== baseline.generatedHash
    || artifact.canonicalProvenanceDigest !== baseline.canonicalProvenanceDigest
    || typeof artifact.scoreDigest !== 'string' || !/^[0-9a-f]{9,}$/.test(artifact.scoreDigest)
    || artifact.prefilter.length !== PREFILTER_COUNT
    || artifact.tailCandidates.length !== FIXED_RESERVOIR_CONFIG.goldfishCount + FIXED_RESERVOIR_CONFIG.randomCount) return false;
  const prefilterIds = artifact.prefilter.map((entry) => entry.score.strategy.id);
  return new Set(prefilterIds).size === prefilterIds.length
    && artifact.prefilter.every((entry) => typeof entry.stageOneGoldfishRank === 'number'
      && entry.stageOneGoldfishRank >= 1 && entry.stageOneGoldfishRank <= artifact.generatedCount!)
    && artifact.tailCandidates.every((entry) => typeof entry.stageOneGoldfishRank === 'number'
      && entry.stageOneGoldfishRank >= 1 && entry.stageOneGoldfishRank <= artifact.generatedCount!);
}
function baselineArtifacts(): { pool: FixedReservoirPoolArtifact; run: FixedReservoirPsroArtifact } {
  const pool = readJson(path.join(BASELINE_ROOT, `pool-${poolSeed}.json`));
  if (!validateFixedReservoirPool(pool, { kingdomId: KINGDOM_ID, poolSeed,
    generatedCount: FIXED_RESERVOIR_CONFIG.generatedCount, goldfishCount: FIXED_RESERVOIR_CONFIG.goldfishCount,
    randomCount: FIXED_RESERVOIR_CONFIG.randomCount, goldfishSeeds: GOLDFISH_SEEDS })) {
    throw new Error('The baseline pool artifact is invalid.');
  }
  const run = readJson(path.join(BASELINE_ROOT, `run-${poolSeed}.json`));
  if (!validateFixedReservoirPsroArtifact(run, pool, { evaluationSeed: FIXED_RESERVOIR_EVALUATION_SEED })) {
    throw new Error('The baseline PSRO artifact is invalid.');
  }
  return { pool, run: run as FixedReservoirPsroArtifact };
}
function stagedPoolExpectation() {
  return { kingdomId: KINGDOM_ID, poolSeed, generatedCount: FIXED_RESERVOIR_CONFIG.generatedCount,
    prefilterCount: PREFILTER_COUNT, goldfishCount: FIXED_RESERVOIR_CONFIG.goldfishCount,
    randomCount: FIXED_RESERVOIR_CONFIG.randomCount, goldfishSeeds: GOLDFISH_SEEDS };
}
async function buildPool(kingdom: Kingdom, baseline: FixedReservoirPoolArtifact): Promise<StagedFixedReservoirPoolArtifact> {
  if (fs.existsSync(files.pool)) {
    const held = readJson(files.pool);
    if (validateStagedFixedReservoirPool(held, stagedPoolExpectation())) {
      console.log('staged pool: skipped valid artifact'); return held;
    }
  }
  const generationStarted = Date.now();
  const generation = generate(FIXED_RESERVOIR_CONFIG.generatedCount), generated = generation.strategies;
  const generationMs = Date.now() - generationStarted;
  const provenance = generatedProvenance(generated, generation.duplicateCanonicalCount,
    generation.displayIdCollisionCount);
  if (provenance.generatedIdDigest !== baseline.generatedHash
    || provenance.canonicalProvenanceDigest !== baseline.canonicalProvenanceDigest) {
    throw new Error(`Pool seed ${poolSeed} did not recreate the baseline raw strategies in order.`);
  }
  let stageOne: StageOneArtifact | null = null;
  if (fs.existsSync(files.stageOne)) {
    const held = readJson(files.stageOne);
    if (validStageOne(held, baseline)) stageOne = held;
  }
  if (!stageOne) {
    console.log(`stage one: scoring ${generated.length.toLocaleString()} strategies on seed ${FIRST_GOLDFISH_SEED}`);
    const started = Date.now();
    const scores = await scoreInWorkers(generated, { kingdomId: KINGDOM_ID, seeds: [FIRST_GOLDFISH_SEED],
      turnLimit: 30, actionCapPerTurn: 200 }, kingdom);
    const scoringMs = Date.now() - started;
    const seenIds = new Set<string>();
    const ranked = [...scores].sort(compareMovementAwareGoldfishScores).filter((entry) => {
      if (seenIds.has(entry.strategy.id)) return false;
      seenIds.add(entry.strategy.id); return true;
    });
    const rankById = new Map(ranked.map((entry, index) => [entry.strategy.id, index + 1]));
    const wrap = (score: MovementAwareGoldfishScore): StageOneRankedScore => ({
      score, stageOneGoldfishRank: rankById.get(score.strategy.id)!
    });
    stageOne = { schemaVersion: 1, experiment: 'staged-goldfish-stage-one', version: STAGED_GOLDFISH_VERSION,
      kingdomId: KINGDOM_ID, poolSeed, seed: FIRST_GOLDFISH_SEED, generatedCount: generated.length,
      generatedHash: provenance.generatedIdDigest,
      canonicalProvenanceDigest: provenance.canonicalProvenanceDigest, prefilterCount: PREFILTER_COUNT,
      generationMs, scoringMs, scoreDigest: rankingDigest(scores),
      prefilter: ranked.slice(0, PREFILTER_COUNT).map(wrap),
      tailCandidates: [...ranked].sort((left, right) => tailRank(left.strategy.id) - tailRank(right.strategy.id)
        || compareUtf16(left.strategy.id, right.strategy.id)
        || compareUtf16(canonicalStrategy(left.strategy), canonicalStrategy(right.strategy)))
        .slice(0, FIXED_RESERVOIR_CONFIG.goldfishCount + FIXED_RESERVOIR_CONFIG.randomCount).map(wrap) };
    writeAtomic(files.stageOne, stageOne);
    console.log(`stage one: completed in ${(scoringMs / 1000).toFixed(1)}s`);
  } else console.log('stage one: skipped valid checkpoint');
  const completedStage = stageOne;
  if (!completedStage) throw new Error('Stage one did not produce evidence.');
  console.log(`rescore: scoring ${completedStage.prefilter.length.toLocaleString()} survivors on three seeds`);
  const rescoreStarted = Date.now();
  const rescored = await scoreInWorkers(completedStage.prefilter.map((entry) => entry.score.strategy),
    { kingdomId: KINGDOM_ID, seeds: REMAINING_GOLDFISH_SEEDS, turnLimit: 30, actionCapPerTurn: 200 }, kingdom);
  const rescoreMs = Date.now() - rescoreStarted;
  const reservoir = selectStagedReservoirFromEvidence(completedStage.prefilter, rescored, completedStage.tailCandidates,
    FIXED_RESERVOIR_CONFIG.goldfishCount, FIXED_RESERVOIR_CONFIG.randomCount);
  const artifact: StagedFixedReservoirPoolArtifact = { schemaVersion: 2,
    experiment: 'staged-fixed-reservoir-pool', version: STAGED_GOLDFISH_VERSION,
    kingdomId: KINGDOM_ID, poolSeed, goldfishSeeds: [...GOLDFISH_SEEDS],
    generatedCount: generated.length, generatedHash: provenance.generatedIdDigest,
    canonicalProvenanceDigest: provenance.canonicalProvenanceDigest,
    duplicateCanonicalCount: provenance.duplicateCanonicalCount,
    displayIdCollisionCount: provenance.displayIdCollisionCount,
    scoringProtocol: 'typescript-staged-movement-aware-v1',
    shardProvenance: [{ shardId: 'stage-one-local-0', startPosition: 0, endPosition: generated.length,
      candidateDigest: provenance.canonicalProvenanceDigest,
      scoreDigest: completedStage.scoreDigest }],
    prefilterCount: PREFILTER_COUNT, scoring: { profiles: [...GOLDFISH_MOVEMENT_PROFILES],
      combination: 'disjoint-seed-sum-v1',
      stageOne: { seeds: [FIRST_GOLDFISH_SEED], scoredCount: generated.length, elapsedMs: completedStage.scoringMs },
      rescore: { seeds: REMAINING_GOLDFISH_SEEDS, scoredCount: rescored.length, elapsedMs: rescoreMs } },
    reservoirHash: stagedReservoirHash(reservoir), reservoir,
    elapsedMs: completedStage.generationMs + completedStage.scoringMs + rescoreMs };
  if (!validateStagedFixedReservoirPool(artifact, stagedPoolExpectation())) {
    throw new Error('The staged pool failed validation.');
  }
  writeAtomic(files.pool, artifact);
  console.log(`rescore: completed in ${(rescoreMs / 1000).toFixed(1)}s`);
  return artifact;
}
async function runPsro(
  kingdom: Kingdom, pool: StagedFixedReservoirPoolArtifact
): Promise<StagedFixedReservoirPsroArtifact> {
  if (fs.existsSync(files.run)) {
    const held = readJson(files.run);
    if (validateStagedFixedReservoirPsroArtifact(held, pool,
      { evaluationSeed: FIXED_RESERVOIR_EVALUATION_SEED })) {
      console.log('staged PSRO: skipped valid artifact'); return held;
    }
  }
  const runner = new WorkerPairingRunner(WORKERS, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  try {
    const artifact = await runStagedFixedReservoirPsro(pool, runner,
      { evaluationSeed: FIXED_RESERVOIR_EVALUATION_SEED });
    if (!validateStagedFixedReservoirPsroArtifact(artifact, pool,
      { evaluationSeed: FIXED_RESERVOIR_EVALUATION_SEED })) throw new Error('The staged PSRO artifact is invalid.');
    writeAtomic(files.run, artifact);
    console.log(`staged PSRO: ${artifact.status}; ${artifact.rounds.length} rounds`);
    return artifact;
  } finally { await runner.close(); }
}
function games(telemetry: TelemetryAggregate): number {
  return Object.values(telemetry.byOrientation).reduce((total, pair) =>
    total + pair.normal.played + pair.swapped.played, 0);
}
function cellTelemetry(artifact: RunArtifact, left: string, right: string): TelemetryAggregate {
  const cell = artifact.matrix.cells.find((candidate) =>
    (candidate.rowId === left && candidate.columnId === right)
    || (candidate.rowId === right && candidate.columnId === left));
  if (!cell) throw new Error(`Missing matrix cell ${left}/${right}.`);
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
async function acquisitionEvidence(artifact: RunArtifact, runner: WorkerPairingRunner): Promise<RunAcquisitionEvidence> {
  const support = supportEntries(artifact);
  const seedRoot = stagedGoldfishEvidenceSeedRoots(poolSeed).acquisition;
  const jobs: PairingJob[] = support.map((entry, index) => ({ candidate: entry.strategy, opponent: entry.strategy,
    options: { kingdomId: artifact.kingdomId, seeds: Array.from({ length: 25 }, (_unused, seedIndex) =>
      seedRoot + index * 100 + seedIndex), turnLimitPerPlayer: 50, actionCapPerTurn: 200,
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
async function ensureAcquisition(
  baseline: FixedReservoirPsroArtifact, staged: StagedFixedReservoirPsroArtifact, runner: WorkerPairingRunner
): Promise<{ baseline: RunAcquisitionEvidence; staged: RunAcquisitionEvidence }> {
  if (fs.existsSync(files.acquisition)) {
    const held = readJson(files.acquisition) as { baselineHash?: string; stagedHash?: string;
      baseline?: RunAcquisitionEvidence; staged?: RunAcquisitionEvidence };
    if (held.baselineHash === baseline.reservoirHash && held.stagedHash === staged.reservoirHash
      && held.baseline && held.staged) return { baseline: held.baseline, staged: held.staged };
  }
  const result = { baseline: await acquisitionEvidence(baseline, runner), staged: await acquisitionEvidence(staged, runner) };
  writeAtomic(files.acquisition, { schemaVersion: 1, experiment: 'staged-goldfish-acquisition',
    baselineHash: baseline.reservoirHash, stagedHash: staged.reservoirHash, ...result });
  return result;
}
async function ensureLottery(
  baseline: FixedReservoirPsroArtifact, staged: StagedFixedReservoirPsroArtifact, runner: WorkerPairingRunner
): Promise<{ baselineVsStaged: number; stagedVsBaseline: number; seeds: number[] }> {
  if (fs.existsSync(files.lottery)) {
    const held = readJson(files.lottery) as { baselineHash?: string; stagedHash?: string;
      baselineVsStaged: number; stagedVsBaseline: number; seeds: number[] };
    if (held.baselineHash === baseline.reservoirHash && held.stagedHash === staged.reservoirHash) return held;
  }
  const evidenceSeeds = stagedGoldfishEvidenceSeedRoots(poolSeed);
  const seeds = Array.from({ length: 200 }, (_unused, index) => evidenceSeeds.lottery + index);
  const baselineRows = await headToHead(runner, KINGDOM_ID, supportEntries(baseline).map((entry) => entry.strategy),
    supportEntries(staged), seeds, 10, undefined, { startingDraftEnabled: false });
  const stagedRows = await headToHead(runner, KINGDOM_ID, supportEntries(staged).map((entry) => entry.strategy),
    supportEntries(baseline), seeds, 10, undefined, { startingDraftEnabled: false });
  const weighted = (rows: typeof baselineRows, run: RunArtifact): number => rows.reduce((sum, row) =>
    sum + row.mean * (run.equilibrium.weights[row.strategy.id] ?? 0), 0);
  const result = { schemaVersion: 1, experiment: 'staged-goldfish-lottery-cross-play',
    baselineHash: baseline.reservoirHash, stagedHash: staged.reservoirHash, seeds,
    baselineVsStaged: weighted(baselineRows, baseline), stagedVsBaseline: weighted(stagedRows, staged),
    baselineInterval95: percentileBootstrapMean(seeds.map((_seed, index) => baselineRows.reduce((sum, row) =>
      sum + row.blockScores[index]! * (baseline.equilibrium.weights[row.strategy.id] ?? 0), 0)),
    evidenceSeeds.lotteryBootstrap[0]),
    stagedInterval95: percentileBootstrapMean(seeds.map((_seed, index) => stagedRows.reduce((sum, row) =>
      sum + row.blockScores[index]! * (staged.equilibrium.weights[row.strategy.id] ?? 0), 0)),
    evidenceSeeds.lotteryBootstrap[1]) };
  writeAtomic(files.lottery, result); return result;
}
function targetRunHash(target: RunArtifact): string {
  return stableHash(JSON.stringify({ evaluationSeed: target.evaluationSeed,
    rulesFingerprint: target.rulesFingerprint, reservoirHash: target.reservoirHash,
    strategyIds: target.matrix.strategies.map((strategy) => strategy.id),
    centeredPayoffs: target.matrix.centeredPayoffs, equilibrium: target.equilibrium }));
}
function reportProvenance(baseline: { pool: FixedReservoirPoolArtifact; run: FixedReservoirPsroArtifact },
  staged: { pool: StagedFixedReservoirPoolArtifact; run: StagedFixedReservoirPsroArtifact }) {
  return { baselineGeneratedHash: baseline.pool.generatedHash,
    baselineReservoirHash: baseline.pool.reservoirHash, baselineRunHash: targetRunHash(baseline.run),
    stagedGeneratedHash: staged.pool.generatedHash, stagedReservoirHash: staged.pool.reservoirHash,
    stagedRunHash: targetRunHash(staged.run) };
}
function attackCandidateHash(candidates: readonly AttackCandidate[]): string {
  return stableHash(candidates.map((entry) => `${entry.strategy.id}:${JSON.stringify(entry.provenance)}`).join('\n'));
}
function expectedFinalistCount(candidateCount: number): number {
  let survivors = candidateCount;
  for (let round = 0; round < ATTACK_PROTOCOL.raceBlocks.length; round += 1) {
    if (!survivors) break;
    survivors = survivors <= 3 ? 1 : Math.max(3, Math.ceil(survivors / 3));
  }
  return Math.min(survivors, ATTACK_PROTOCOL.finalists);
}
function attackSeeds(direction: AttackDirection) {
  return stagedGoldfishAttackSeeds(poolSeed, direction, ATTACK_PROTOCOL);
}
function strongestFinalist(finalists: readonly AttackFinalist[]): AttackFinalist | null {
  return [...finalists].sort((left, right) => right.interval95.lower - left.interval95.lower
    || right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id))[0] ?? null;
}
function assertIndependentAttacks(left: AttackArtifact, right: AttackArtifact): void {
  const leftSeeds = new Set(Object.values(left.seedNamespaces).flat());
  if (Object.values(right.seedNamespaces).flat().some((seed) => leftSeeds.has(seed))) {
    throw new Error('Cross-attack direction seed namespaces overlap.');
  }
}
function validAttackArtifact(value: unknown, direction: AttackDirection, candidates: readonly AttackCandidate[],
  sourceReservoirCount: number, sourceReservoirHash: string, target: RunArtifact): value is AttackArtifact {
  try {
    if (!value || typeof value !== 'object') return false;
    const artifact = value as Partial<AttackArtifact>, seeds = attackSeeds(direction);
    if (artifact.schemaVersion !== 1 || artifact.experiment !== 'staged-goldfish-fixed-reservoir-cross-attack'
      || artifact.direction !== direction || artifact.sourceReservoirHash !== sourceReservoirHash
      || artifact.targetReservoirHash !== target.reservoirHash || artifact.targetRunHash !== targetRunHash(target)
      || artifact.candidateHash !== attackCandidateHash(candidates) || artifact.candidateCount !== candidates.length
      || artifact.excludedActiveCount !== sourceReservoirCount - candidates.length
      || artifact.seedRoot !== seeds.root || JSON.stringify(artifact.seedNamespaces) !== JSON.stringify(seeds.namespaces)
      || JSON.stringify(artifact.protocol) !== JSON.stringify(ATTACK_PROTOCOL)
      || !Number.isFinite(artifact.elapsedMs) || artifact.elapsedMs! < 0
      || !Array.isArray(artifact.finalists)
      || artifact.finalists.length !== expectedFinalistCount(candidates.length)) return false;
    const expected = new Map(candidates.map((entry) => [entry.strategy.id, entry]));
    const seen = new Set<string>();
    for (const finalist of artifact.finalists) {
      const candidate = expected.get(finalist.strategy?.id);
      if (!candidate || seen.has(finalist.strategy.id)
        || JSON.stringify(finalist.strategy) !== JSON.stringify(candidate.strategy)
        || JSON.stringify(finalist.provenance) !== JSON.stringify(candidate.provenance)
        || !Number.isFinite(finalist.mean) || finalist.mean < 0 || finalist.mean > 1
        || !Number.isFinite(finalist.interval95?.lower) || finalist.interval95.lower < 0
        || !Number.isFinite(finalist.interval95?.upper) || finalist.interval95.upper > 1
        || finalist.interval95.lower > finalist.interval95.upper
        || finalist.blocks !== ATTACK_PROTOCOL.confirmationBlocks || finalist.matches !== finalist.blocks * 4) return false;
      seen.add(finalist.strategy.id);
    }
    return artifact.strongestStrategyId === strongestFinalist(artifact.finalists)?.strategy.id
      || (artifact.strongestStrategyId === null && artifact.finalists.length === 0);
  } catch { return false; }
}
async function ensureAttack(direction: AttackDirection, candidates: readonly AttackCandidate[],
  sourceReservoirCount: number, sourceReservoirHash: string, target: RunArtifact,
  runner: WorkerPairingRunner, file: string): Promise<AttackArtifact> {
  if (fs.existsSync(file)) {
    const held = readJson(file);
    if (validAttackArtifact(held, direction, candidates, sourceReservoirCount, sourceReservoirHash, target)) {
      console.log(`${direction}: skipped valid fixed-reservoir cross-attack evidence`);
      return held;
    }
  }
  const seeds = attackSeeds(direction), started = Date.now();
  const confirmed = await scanFixedReservoir({ candidates: candidates.map((entry) => entry.strategy),
    snapshot: target.matrix, equilibrium: target.equilibrium, runner, kingdomId: target.kingdomId,
    raceSeeds: seeds.race, confirmationSeeds: seeds.confirmation, samplingSeeds: seeds.sampling,
    bootstrapSeeds: seeds.bootstrap, raceBlocks: ATTACK_PROTOCOL.raceBlocks,
    finalists: ATTACK_PROTOCOL.finalists, chunkSize: ATTACK_PROTOCOL.chunkSize });
  const provenance = new Map(candidates.map((entry) => [entry.strategy.id, entry.provenance]));
  const finalists: AttackFinalist[] = confirmed.map((entry) => ({ ...entry,
    provenance: provenance.get(entry.strategy.id)! }));
  const artifact: AttackArtifact = { schemaVersion: 1,
    experiment: 'staged-goldfish-fixed-reservoir-cross-attack', direction,
    sourceReservoirHash, targetReservoirHash: target.reservoirHash, targetRunHash: targetRunHash(target),
    candidateHash: attackCandidateHash(candidates), candidateCount: candidates.length,
    excludedActiveCount: sourceReservoirCount - candidates.length,
    seedRoot: seeds.root, seedNamespaces: seeds.namespaces,
    protocol: { ...ATTACK_PROTOCOL, raceBlocks: [...ATTACK_PROTOCOL.raceBlocks] },
    elapsedMs: Date.now() - started, finalists,
    strongestStrategyId: strongestFinalist(finalists)?.strategy.id ?? null };
  if (!validAttackArtifact(artifact, direction, candidates, sourceReservoirCount, sourceReservoirHash, target)) {
    throw new Error(`${direction} produced invalid cross-attack evidence.`);
  }
  writeAtomic(file, artifact);
  return artifact;
}
function plan(strategy: Strategy): string {
  return strategy.buyPlan.filter((slot) => slot.kind !== 'inactive').map(formatSlot).join(' → ');
}
function cards(evidence: RunAcquisitionEvidence, cardIds: readonly string[]) {
  return cardIds.map((cardId) => {
    let expectedCopies = 0, materialSupportShare = 0;
    for (const entry of evidence.support) {
      const rate = entry.acquisitionRates[cardId] ?? 0;
      expectedCopies += entry.weight * rate;
      if (rate >= MATERIAL_ACQUISITIONS_PER_GAME) materialSupportShare += entry.weight;
    }
    return { cardId, expectedCopies, materialSupportShare,
      material: materialSupportShare >= MATERIAL_EQUILIBRIUM_SHARE };
  }).filter((entry) => entry.expectedCopies > 0 || entry.materialSupportShare > 0);
}
function retention(baseline: FixedReservoirPoolArtifact, run: FixedReservoirPsroArtifact,
  staged: StagedFixedReservoirPoolArtifact) {
  const stagedIds = new Set(staged.reservoir.map((entry) => entry.strategy.id));
  const stagedGoldfishIds = new Set(staged.reservoir.filter((entry) => entry.source === 'goldfish')
    .map((entry) => entry.strategy.id));
  const measure = (ids: readonly string[]) => ({ total: ids.length,
    inReservoir: ids.filter((id) => stagedIds.has(id)).length,
    inGoldfish: ids.filter((id) => stagedGoldfishIds.has(id)).length });
  const baselineGoldfish = baseline.reservoir.filter((entry) => entry.source === 'goldfish');
  const materialSupport = supportEntries(run).filter((entry) => entry.weight >= MATERIAL_EQUILIBRIUM_SHARE)
    .map((entry) => entry.strategy.id);
  const admitted = [...new Set(run.rounds.flatMap((round) => round.admittedStrategyIds))];
  return { baselineTop50: measure(baselineGoldfish.slice(0, 50).map((entry) => entry.strategy.id)),
    baselineTop18k: measure(baselineGoldfish.map((entry) => entry.strategy.id)),
    baselineMaterialSupport: measure(materialSupport), baselineAdmitted: measure(admitted) };
}
function overlap(baseline: FixedReservoirPoolArtifact, staged: StagedFixedReservoirPoolArtifact) {
  const rows = (['goldfish', 'random'] as const).flatMap((baselineSource) =>
    (['goldfish', 'random'] as const).map((stagedSource) => {
      const ids = new Set(baseline.reservoir.filter((entry) => entry.source === baselineSource)
        .map((entry) => entry.strategy.id));
      return { baselineSource, stagedSource, count: staged.reservoir.filter((entry) =>
        entry.source === stagedSource && ids.has(entry.strategy.id)).length };
    }));
  return { total: rows.reduce((sum, row) => sum + row.count, 0), bySource: rows };
}
function baselineAttackCandidates(pool: FixedReservoirPoolArtifact, target: RunArtifact): AttackCandidate[] {
  const active = new Set(target.matrix.strategies.map((strategy) => strategy.id));
  return pool.reservoir.filter((entry) => !active.has(entry.strategy.id)).map((entry) => ({ strategy: entry.strategy,
    provenance: { reservoir: 'baseline', source: entry.source, scoreProvenance: 'baseline-four-seed',
      goldfishRank: entry.goldfishRank } }));
}
function stagedAttackCandidates(pool: StagedFixedReservoirPoolArtifact, target: RunArtifact): AttackCandidate[] {
  const active = new Set(target.matrix.strategies.map((strategy) => strategy.id));
  return pool.reservoir.filter((entry) => !active.has(entry.strategy.id)).map((entry) => ({ strategy: entry.strategy,
    provenance: entry.source === 'goldfish'
      ? { reservoir: 'staged', source: entry.source, scoreProvenance: entry.scoreProvenance,
        stageOneGoldfishRank: entry.stageOneGoldfishRank, fourSeedGoldfishRank: entry.fourSeedGoldfishRank }
      : { reservoir: 'staged', source: entry.source, scoreProvenance: entry.scoreProvenance,
        stageOneGoldfishRank: entry.stageOneGoldfishRank, randomTailRank: entry.randomTailRank } }));
}
function attackSummary(artifact: AttackArtifact) {
  const strongest = strongestFinalist(artifact.finalists);
  return { elapsedMs: artifact.elapsedMs, candidateCount: artifact.candidateCount,
    excludedActiveCount: artifact.excludedActiveCount, confirmedFinalistCount: artifact.finalists.length,
    strongest: strongest ? { strategyId: strongest.strategy.id, provenance: strongest.provenance,
      mean: strongest.mean, interval95: strongest.interval95, blocks: strongest.blocks, matches: strongest.matches } : null };
}
async function compareAndReport(kingdom: Kingdom, baseline: { pool: FixedReservoirPoolArtifact;
  run: FixedReservoirPsroArtifact }, staged: { pool: StagedFixedReservoirPoolArtifact;
  run: StagedFixedReservoirPsroArtifact }): Promise<void> {
  const runner = new WorkerPairingRunner(WORKERS, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  try {
    const acquisition = await ensureAcquisition(baseline.run, staged.run, runner);
    const lottery = await ensureLottery(baseline.run, staged.run, runner);
    const baselineCandidates = baselineAttackCandidates(baseline.pool, staged.run);
    const stagedCandidates = stagedAttackCandidates(staged.pool, baseline.run);
    const baselineAttack = await ensureAttack('baseline-vs-staged', baselineCandidates,
      baseline.pool.reservoir.length, baseline.pool.reservoirHash, staged.run, runner, files.baselineAttack);
    const stagedAttack = await ensureAttack('staged-vs-baseline', stagedCandidates,
      staged.pool.reservoir.length, staged.pool.reservoirHash, baseline.run, runner, files.stagedAttack);
    assertIndependentAttacks(baselineAttack, stagedAttack);
    const purchaseIds = stoplessRandomDomain(KINGDOM_ID).purchaseIds;
    const stagedWork = FIXED_RESERVOIR_CONFIG.generatedCount + PREFILTER_COUNT * 3;
    const baselineWork = FIXED_RESERVOIR_CONFIG.generatedCount * GOLDFISH_SEEDS.length;
    const runSummary = (run: RunArtifact) => ({ status: run.status, rounds: run.rounds.length,
      matrixSize: run.matrix.strategies.length, elapsedMs: run.elapsedMs,
      admitted: run.rounds.reduce((sum, round) => sum + round.admittedStrategyIds.length, 0),
      support: supportEntries(run).map((entry) => ({ strategyId: entry.strategy.id,
        weight: entry.weight, plan: plan(entry.strategy) })) });
    const report = { schemaVersion: 1, experiment: 'staged-goldfish-ab-report', version: STAGED_GOLDFISH_VERSION,
      kingdomId: KINGDOM_ID, poolSeed, evaluationSeed: FIXED_RESERVOIR_EVALUATION_SEED,
      provenance: reportProvenance(baseline, staged),
      rawStrategiesMatch: staged.pool.generatedHash === baseline.pool.generatedHash
        && staged.pool.canonicalProvenanceDigest === baseline.pool.canonicalProvenanceDigest,
      runtime: { stageOneMs: staged.pool.scoring.stageOne.elapsedMs,
        rescoreMs: staged.pool.scoring.rescore.elapsedMs, stagedPoolMs: staged.pool.elapsedMs,
        stagedPsroMs: staged.run.elapsedMs, stagedTotalMs: staged.pool.elapsedMs + staged.run.elapsedMs,
        baselinePoolMs: baseline.pool.elapsedMs, baselinePsroMs: baseline.run.elapsedMs,
        baselineTotalMs: baseline.pool.elapsedMs + baseline.run.elapsedMs,
        theoreticalGoldfishSpeedup: baselineWork / stagedWork,
        measuredPoolSpeedup: baseline.pool.elapsedMs / staged.pool.elapsedMs,
        measuredTotalSpeedup: (baseline.pool.elapsedMs + baseline.run.elapsedMs)
          / (staged.pool.elapsedMs + staged.run.elapsedMs) },
      retention: retention(baseline.pool, baseline.run, staged.pool), overlap: overlap(baseline.pool, staged.pool),
      psro: { baseline: runSummary(baseline.run), staged: runSummary(staged.run) },
      usage: { method: 'equilibrium-weighted matrix telemetry plus 25-seed support mirrors',
        baseline: { family: summarizeRunFamilies(acquisition.baseline), cards: cards(acquisition.baseline, purchaseIds) },
        staged: { family: summarizeRunFamilies(acquisition.staged), cards: cards(acquisition.staged, purchaseIds) } },
      heldOutLotteryCrossPlay: lottery,
      fixedReservoirCrossAttacks: { method: 'every non-active reservoir candidate enters a global 1/2/4/8-block staged race; up to 8 global finalists are confirmed on 400 fresh blocks with bootstrap 95% intervals',
        baselineVsStaged: attackSummary(baselineAttack), stagedVsBaseline: attackSummary(stagedAttack) },
      omittedMetrics: [] as string[] };
    writeAtomic(files.report, report);
    const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
    const attackLine = (label: string, artifact: AttackArtifact): string => {
      const strongest = strongestFinalist(artifact.finalists);
      return strongest
        ? `${label}: ${strongest.strategy.id} (${strongest.provenance.source}, ${strongest.provenance.scoreProvenance}) ${percent(strongest.mean)}; 95% interval ${percent(strongest.interval95.lower)}–${percent(strongest.interval95.upper)}.`
        : `${label}: no non-active candidate was available for confirmation.`;
    };
    const lines = [`# Staged goldfish A/B results: pool seed ${poolSeed}`, '',
      `Raw strategy recreation: ${report.rawStrategiesMatch ? 'exact match' : 'MISMATCH'}.`,
      `Stage one: ${(report.runtime.stageOneMs / 1000).toFixed(1)}s. Rescore: ${(report.runtime.rescoreMs / 1000).toFixed(1)}s.`,
      `Pool / PSRO / total: ${(report.runtime.stagedPoolMs / 60000).toFixed(1)}m / ${(report.runtime.stagedPsroMs / 60000).toFixed(1)}m / ${(report.runtime.stagedTotalMs / 60000).toFixed(1)}m.`,
      `Theoretical goldfish speedup: ${report.runtime.theoreticalGoldfishSpeedup.toFixed(2)}×. Measured pool / total speedup: ${report.runtime.measuredPoolSpeedup.toFixed(2)}× / ${report.runtime.measuredTotalSpeedup.toFixed(2)}×.`, '',
      '| Baseline cohort | Total | In staged reservoir | In staged goldfish |', '|---|---:|---:|---:|',
      ...Object.entries(report.retention).map(([name, row]) => `| ${name} | ${row.total} | ${row.inReservoir} | ${row.inGoldfish} |`), '',
      `Reservoir overlap: ${report.overlap.total}/20,000. ${report.overlap.bySource.map((row) => `${row.baselineSource}→${row.stagedSource} ${row.count}`).join('; ')}.`, '',
      `Baseline PSRO: ${report.psro.baseline.rounds} rounds, ${report.psro.baseline.matrixSize} matrix strategies, ${report.psro.baseline.support.length} support strategies.`,
      `Staged PSRO: ${report.psro.staged.rounds} rounds, ${report.psro.staged.matrixSize} matrix strategies, ${report.psro.staged.support.length} support strategies.`, '',
      `Held-out lottery cross-play: baseline→staged ${percent(lottery.baselineVsStaged)}; staged→baseline ${percent(lottery.stagedVsBaseline)}.`,
      'Fixed-reservoir cross-attacks use a global 1/2/4/8-block race and confirm finalists on 400 fresh blocks.',
      attackLine('Baseline→staged strongest confirmed finalist', baselineAttack),
      attackLine('Staged→baseline strongest confirmed finalist', stagedAttack), '',
      'Family and card usage is in report.json. It uses the same acquisition method as the fixed-reservoir five-run report.',
      'No requested metric was omitted.', ''];
    writeAtomic(files.reportMarkdown, `${lines.join('\n')}\n`);
    console.log(`wrote ${files.report} and ${files.reportMarkdown}`);
  } finally { await runner.close(); }
}
function status(baseline: { pool: FixedReservoirPoolArtifact; run: FixedReservoirPsroArtifact }): boolean {
  const stage = fs.existsSync(files.stageOne) && validStageOne(readJson(files.stageOne), baseline.pool);
  const poolValue = fs.existsSync(files.pool) ? readJson(files.pool) : null;
  const pool = validateStagedFixedReservoirPool(poolValue, stagedPoolExpectation()) ? poolValue : null;
  const runValue = pool && fs.existsSync(files.run) ? readJson(files.run) : null;
  const run = pool && validateStagedFixedReservoirPsroArtifact(runValue, pool,
    { evaluationSeed: FIXED_RESERVOIR_EVALUATION_SEED }) ? runValue : null;
  const baselineCandidates = run ? baselineAttackCandidates(baseline.pool, run) : [];
  const stagedCandidates = pool ? stagedAttackCandidates(pool, baseline.run) : [];
  const baselineAttack = run && fs.existsSync(files.baselineAttack)
    && validAttackArtifact(readJson(files.baselineAttack), 'baseline-vs-staged', baselineCandidates,
      baseline.pool.reservoir.length, baseline.pool.reservoirHash, run);
  const stagedAttack = pool && fs.existsSync(files.stagedAttack)
    && validAttackArtifact(readJson(files.stagedAttack), 'staged-vs-baseline', stagedCandidates,
      pool.reservoir.length, pool.reservoirHash, baseline.run);
  let report = false;
  if (pool && run && baselineAttack && stagedAttack && fs.existsSync(files.report)
    && fs.existsSync(files.reportMarkdown)) {
    const value = readJson(files.report) as { experiment?: string; version?: string; poolSeed?: number;
      provenance?: unknown };
    report = value.experiment === 'staged-goldfish-ab-report' && value.version === STAGED_GOLDFISH_VERSION
      && value.poolSeed === poolSeed
      && JSON.stringify(value.provenance) === JSON.stringify(reportProvenance(baseline, { pool, run }));
  }
  const complete = Boolean(stage && pool && run && baselineAttack && stagedAttack && report);
  console.log(`seed ${poolSeed}: stage-one ${stage ? 'complete' : 'missing/invalid'}; pool ${pool ? 'complete' : 'missing/invalid'}; run ${run ? 'complete' : 'missing/invalid'}; attacks ${baselineAttack && stagedAttack ? 'complete' : 'missing/invalid'}; report ${report ? 'complete' : 'missing/invalid'}`);
  return complete;
}

const kingdomEntry = RANDOM_PSRO_KINGDOMS.find((entry) => entry.id === KINGDOM_ID);
if (!kingdomEntry) throw new Error(`Missing ${KINGDOM_ID}.`);
const kingdom: Kingdom = kingdomEntry;
registerKingdom(kingdom);
migrateSeedFiveArtifacts();

async function runUnit(command: StagedGoldfishUnitCommand, seed: StagedGoldfishPoolSeed): Promise<boolean> {
  configurePoolSeed(seed);
  const baseline = baselineArtifacts();
  if (command === 'status') return status(baseline);
  console.log(`seed ${poolSeed}: starting ${command}`);
  if (command === 'run') {
    const pool = await buildPool(kingdom, baseline.pool);
    const run = await runPsro(kingdom, pool);
    await compareAndReport(kingdom, baseline, { pool, run });
  } else if (command === 'pool') await buildPool(kingdom, baseline.pool);
  else if (command === 'psro') {
    const pool = readJson(files.pool);
    if (!validateStagedFixedReservoirPool(pool, stagedPoolExpectation())) {
      throw new Error('A valid staged pool is required.');
    }
    await runPsro(kingdom, pool);
  } else {
    const pool = readJson(files.pool), run = readJson(files.run);
    if (!validateStagedFixedReservoirPool(pool, stagedPoolExpectation())
      || !validateStagedFixedReservoirPsroArtifact(run, pool, { evaluationSeed: FIXED_RESERVOIR_EVALUATION_SEED })) {
      throw new Error('Valid staged pool and run artifacts are required.');
    }
    await compareAndReport(kingdom, baseline, { pool, run });
  }
  return true;
}

const options = parseStagedGoldfishArgs(process.argv.slice(2));
if (options.command === 'suite' || options.command === 'suite-status') {
  let complete = true;
  const command = options.command === 'suite' ? 'run' : 'status';
  for (const seed of STAGED_GOLDFISH_POOL_SEEDS) complete = await runUnit(command, seed) && complete;
  if (!complete) process.exitCode = 1;
} else if (!await runUnit(options.command, options.poolSeed!)) process.exitCode = 1;
