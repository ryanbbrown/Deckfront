import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { SeededRandom, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import {
  selectEnrichmentCohorts, summarizeCompetitiveGoldfishEntries
} from '../src/sim/goldfish';
import type {
  CompetitiveGoldfishEntry, CompetitiveGoldfishSummary, GoldfishConfig, MovementAwareGoldfishScore
} from '../src/sim/goldfish';
import { percentileBootstrapMean } from '../src/sim/mixtureEvaluation';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { RandomPsroArtifact } from '../src/sim/randomPsro';
import { supportStrategies } from '../src/sim/randomPsro';
import { ResponsePolicyDomain } from '../src/sim/responsePolicyGrammar';
import { canonicalStrategy, formatSlot } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import { headToHead } from './headToHead';

type WorkerScore = Omit<MovementAwareGoldfishScore, 'strategy'>;
interface WorkerReply { id: number; scores?: WorkerScore[]; error?: string; stack?: string }
interface Lottery { id: string; artifact: RandomPsroArtifact }
interface ConfirmedCandidate {
  strategyId: string;
  plan: string;
  mean: number;
  interval95: { lower: number; upper: number };
  perLottery: Record<string, number>;
}

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer.`);
  return value;
}
function filesBelow(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const held = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(held) : [held];
  });
}
function lotteries(): Lottery[] {
  const root = '.experiments/random-psro-consistency';
  return ['random-psro-v4', 'random-psro-v5', 'random-psro-v6'].flatMap((version) =>
    filesBelow(path.join(root, version)).filter((file) =>
      /deep-beam-tuning-009-seed-3500[12]\.json$/.test(file)).map((file) => {
      const artifact = JSON.parse(fs.readFileSync(file, 'utf8')) as RandomPsroArtifact;
      return { id: `${artifact.suiteVersion}/seed-${artifact.runSeed}`, artifact };
    })).sort((left, right) => left.id.localeCompare(right.id));
}
function generate(domain: ResponsePolicyDomain, count: number, seed: number): Strategy[] {
  const random = new SeededRandom(seed); const seen = new Set<string>(); const result: Strategy[] = [];
  while (result.length < count) {
    const strategy = domain.randomComplete(random); const key = canonicalStrategy(strategy);
    if (seen.has(key)) continue;
    seen.add(key); result.push(strategy);
  }
  return result;
}
async function scoreInWorkers(strategies: readonly Strategy[], config: GoldfishConfig,
  kingdom: Kingdom, workers: number): Promise<MovementAwareGoldfishScore[]> {
  const pool = Array.from({ length: workers }, () => new Worker(
    new URL('../src/server/goldfishWorker.ts', import.meta.url),
    { workerData: { kingdom }, execArgv: ['--import', 'tsx'] }));
  try {
    const partitions = pool.map((_worker, workerIndex) => strategies.slice(
      Math.floor(strategies.length * workerIndex / workers),
      Math.floor(strategies.length * (workerIndex + 1) / workers)));
    const results = await Promise.all(pool.map((worker, index) => new Promise<MovementAwareGoldfishScore[]>((resolve, reject) => {
      const onError = (error: Error): void => reject(error); worker.once('error', onError);
      worker.once('message', (reply: WorkerReply) => {
        worker.off('error', onError);
        if (reply.error || !reply.scores) { reject(new Error(reply.stack ?? reply.error ?? 'Goldfish worker failed.')); return; }
        resolve(reply.scores.map((score, scoreIndex) => ({ ...score, strategy: partitions[index]![scoreIndex]! })));
      });
      worker.postMessage({ id: index, strategies: partitions[index], config, mode: 'movement-aware' });
    })));
    return results.flat();
  } finally { await Promise.all(pool.map((worker) => worker.terminate())); }
}
function plan(strategy: Strategy): string {
  return strategy.buyPlan.filter((slot) => slot.kind !== 'inactive').map(formatSlot).join(' → ');
}
async function screen(runner: WorkerPairingRunner, kingdomId: string, candidates: readonly Strategy[],
  saved: readonly Lottery[], seeds: readonly number[]): Promise<CompetitiveGoldfishEntry[]> {
  const entries: CompetitiveGoldfishEntry[] = [];
  for (const lottery of saved) {
    const rows = await headToHead(runner, kingdomId, candidates, supportStrategies(lottery.artifact),
      seeds, 20, undefined, { startingDraftEnabled: false });
    for (const row of rows) entries.push({ strategyId: row.strategy.id, lotteryId: lottery.id, score: row.mean });
  }
  return entries;
}
async function confirm(runner: WorkerPairingRunner, kingdomId: string, candidates: readonly Strategy[],
  saved: readonly Lottery[], seeds: readonly number[], bootstrapSeed: number): Promise<ConfirmedCandidate[]> {
  const blocks = new Map(candidates.map((strategy) => [strategy.id, Array<number>(seeds.length).fill(0)]));
  const perLottery = new Map(candidates.map((strategy) => [strategy.id, {} as Record<string, number>]));
  for (const lottery of saved) {
    const rows = await headToHead(runner, kingdomId, candidates, supportStrategies(lottery.artifact),
      seeds, 10, undefined, { startingDraftEnabled: false });
    for (const row of rows) {
      const combined = blocks.get(row.strategy.id)!;
      row.blockScores.forEach((score, index) => { combined[index]! += score / saved.length; });
      perLottery.get(row.strategy.id)![lottery.id] = row.mean;
    }
  }
  return candidates.map((strategy, index) => {
    const values = blocks.get(strategy.id)!;
    return { strategyId: strategy.id, plan: plan(strategy),
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      interval95: percentileBootstrapMean(values, bootstrapSeed + index),
      perLottery: perLottery.get(strategy.id)! };
  }).sort((left, right) => right.mean - left.mean || left.strategyId.localeCompare(right.strategyId));
}

const experimentStarted = Date.now();
const requested = option('count', 200_000); const workers = Math.min(option('workers', 10), 16);
const proposalSeed = option('seed', 40_009); const shuffleSeedCount = option('shuffle-seeds', 4);
const saved = lotteries(); if (saved.length !== 6) throw new Error(`Expected six saved lotteries, found ${saved.length}.`);
const kingdom = saved[0]!.artifact.kingdom as Kingdom; registerKingdom(kingdom);
const domain = new ResponsePolicyDomain(kingdom.id,
  { maxActiveSlots: 8, allowStopTokens: false, allowNoBuyFloor: false });
const config: GoldfishConfig = { kingdomId: kingdom.id,
  seeds: Array.from({ length: shuffleSeedCount }, (_unused, index) => 4_100_000 + index),
  turnLimit: 30, actionCapPerTurn: 200 };
const benchmarkCount = Math.min(2_000, requested);
const policies = generate(domain, requested, proposalSeed);
const benchmarkStarted = Date.now();
await scoreInWorkers(policies.slice(0, benchmarkCount), config, kingdom, workers);
const benchmarkMs = Math.max(1, Date.now() - benchmarkStarted);
const estimatedCapacity = Math.max(benchmarkCount, Math.floor(benchmarkCount * 300_000 / benchmarkMs * 0.8));
const proposalCount = Math.min(requested, estimatedCapacity);
console.log(`Benchmark: ${benchmarkCount} policies in ${(benchmarkMs / 1000).toFixed(2)}s; running ${proposalCount}.`);
const goldfishStarted = Date.now();
const scores = await scoreInWorkers(policies.slice(0, proposalCount), config, kingdom, workers);
const goldfishMs = Date.now() - goldfishStarted;
console.log(`Movement-aware goldfish: ${proposalCount} policies in ${(goldfishMs / 1000).toFixed(2)}s.`);
const cohorts = selectEnrichmentCohorts(scores, 100, 42_009);
const candidates = [...cohorts.selected, ...cohorts.controls].map((entry) => entry.strategy);
const groupById = new Map([
  ...cohorts.selected.map((entry) => [entry.strategy.id, 'goldfish'] as const),
  ...cohorts.controls.map((entry) => [entry.strategy.id, 'control'] as const)
]);
const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
  { kingdom }, ['--import', 'tsx']);
let selectedSummary: CompetitiveGoldfishSummary; let controlSummary: CompetitiveGoldfishSummary;
let selectedConfirmed: ConfirmedCandidate[]; let controlConfirmed: ConfirmedCandidate[];
let screenMs = 0; let confirmationMs = 0;
const screenSeeds = Array.from({ length: 32 }, (_unused, index) => 4_800_000 + index);
const confirmSeeds = Array.from({ length: 400 }, (_unused, index) => 4_900_000 + index);
try {
  const screenStarted = Date.now();
  const entries = await screen(runner, kingdom.id, candidates, saved, screenSeeds);
  screenMs = Date.now() - screenStarted;
  selectedSummary = summarizeCompetitiveGoldfishEntries(entries.filter((entry) => groupById.get(entry.strategyId) === 'goldfish'));
  controlSummary = summarizeCompetitiveGoldfishEntries(entries.filter((entry) => groupById.get(entry.strategyId) === 'control'));
  const byId = new Map(candidates.map((strategy) => [strategy.id, strategy]));
  const selectedTop = selectedSummary.candidateScores.slice(0, 5).map((entry) => byId.get(entry.strategyId)!);
  const controlTop = controlSummary.candidateScores.slice(0, 5).map((entry) => byId.get(entry.strategyId)!);
  const confirmationStarted = Date.now();
  selectedConfirmed = await confirm(runner, kingdom.id, selectedTop, saved, confirmSeeds, 5_000_000);
  controlConfirmed = await confirm(runner, kingdom.id, controlTop, saved, confirmSeeds, 5_100_000);
  confirmationMs = Date.now() - confirmationStarted;
} finally { await runner.close(); }
const totalMs = Date.now() - experimentStarted;
const result = { schemaVersion: 1, experiment: 'movement-goldfish-enrichment', createdAt: new Date().toISOString(),
  kingdom, config: { requested, proposalCount, proposalSeed, shuffleSeeds: config.seeds,
    profiles: ['stationary', 'chaser', 'kiter'], turnLimit: config.turnLimit, workers,
    benchmarkCount, benchmarkMs, goldfishMs, screenMs, confirmationMs, totalMs,
    screenBlocks: screenSeeds.length, confirmBlocks: confirmSeeds.length,
    ranking: ['worst-profile completions descending', 'total completions descending',
      'worst-profile penalized turns ascending', 'total penalized turns ascending',
      'worst-profile damage area descending', 'total damage area descending',
      'money spent descending', 'strategy ID ascending'] },
  cohorts: { goldfish: { summary: selectedSummary, confirmed: selectedConfirmed },
    control: { summary: controlSummary, confirmed: controlConfirmed } } };
const outDir = '.experiments/goldfish-k009'; fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'enrichment.json'), `${JSON.stringify(result, null, 2)}\n`);
const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const summaryRow = (name: string, summary: CompetitiveGoldfishSummary): string =>
  `| ${name} | ${percent(summary.mean)} | ${percent(summary.median)} | ${percent(summary.maximum)} | ${summary.above40} | ${summary.above50} | ${summary.above55} |`;
const confirmedRows = (name: string, rows: readonly ConfirmedCandidate[]): string[] => rows.map((row, index) =>
  `| ${name} | ${index + 1} | ${row.plan} | ${percent(row.mean)} | ${percent(row.interval95.lower)}–${percent(row.interval95.upper)} |`);
const lines = ['# Movement-aware goldfish enrichment', '',
  `Goldfished ${proposalCount.toLocaleString()} strategies across three movement profiles in ${(goldfishMs / 1000).toFixed(2)} seconds.`, '',
  '| Cohort | Mean | Median | Maximum | ≥40% | ≥50% | ≥55% |', '|---|---:|---:|---:|---:|---:|---:|',
  summaryRow('Goldfish top 100', selectedSummary), summaryRow('Random control 100', controlSummary), '',
  '| Cohort | Rank | Plan | Held-out mean | 95% interval |', '|---|---:|---|---:|---:|',
  ...confirmedRows('Goldfish', selectedConfirmed), ...confirmedRows('Control', controlConfirmed), ''];
fs.writeFileSync(path.join(outDir, 'enrichment.md'), `${lines.join('\n')}\n`);
console.log(`Wrote ${outDir}/enrichment.{json,md}.`);
