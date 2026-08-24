import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { SeededRandom, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { compareGoldfishScores } from '../src/sim/goldfish';
import type { GoldfishConfig, GoldfishScore } from '../src/sim/goldfish';
import { percentileBootstrapMean } from '../src/sim/mixtureEvaluation';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { RandomPsroArtifact } from '../src/sim/randomPsro';
import { supportStrategies } from '../src/sim/randomPsro';
import { ResponsePolicyDomain } from '../src/sim/responsePolicyGrammar';
import { canonicalStrategy, formatSlot } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import { headToHead } from './headToHead';

type WorkerScore = Omit<GoldfishScore, 'strategy'>;
interface WorkerReply { id: number; scores?: WorkerScore[]; error?: string; stack?: string }
interface LotteryResult { version: string; seed: number; score: number; interval95: { lower: number; upper: number }; matches: number }

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
function artifacts(): { path: string; artifact: RandomPsroArtifact }[] {
  const root = '.experiments/random-psro-consistency';
  return ['random-psro-v4', 'random-psro-v5', 'random-psro-v6'].flatMap((version) =>
    filesBelow(path.join(root, version)).filter((file) => /deep-beam-tuning-009-seed-3500[12]\.json$/.test(file))
      .map((file) => ({ path: file, artifact: JSON.parse(fs.readFileSync(file, 'utf8')) as RandomPsroArtifact })))
    .sort((left, right) => left.artifact.suiteVersion.localeCompare(right.artifact.suiteVersion)
      || left.artifact.runSeed - right.artifact.runSeed);
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
  kingdom: Kingdom, workers: number): Promise<GoldfishScore[]> {
  const pool = Array.from({ length: workers }, () => new Worker(
    new URL('../src/server/goldfishWorker.ts', import.meta.url),
    { workerData: { kingdom }, execArgv: ['--import', 'tsx'] }));
  try {
    const partitions = pool.map((_worker, workerIndex) => {
      const start = Math.floor(strategies.length * workerIndex / workers);
      const end = Math.floor(strategies.length * (workerIndex + 1) / workers);
      return strategies.slice(start, end);
    });
    const results = await Promise.all(pool.map((worker, index) => new Promise<GoldfishScore[]>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      worker.once('error', onError);
      worker.once('message', (reply: WorkerReply) => {
        worker.off('error', onError);
        if (reply.error || !reply.scores) { reject(new Error(reply.stack ?? reply.error ?? 'Goldfish worker failed.')); return; }
        resolve(reply.scores.map((score, scoreIndex) => ({ ...score, strategy: partitions[index]![scoreIndex]! })));
      });
      worker.postMessage({ id: index, strategies: partitions[index], config });
    })));
    return results.flat();
  } finally { await Promise.all(pool.map((worker) => worker.terminate())); }
}
function plan(strategy: Strategy): string {
  return strategy.buyPlan.filter((slot) => slot.kind !== 'inactive').map(formatSlot).join(' → ');
}

const requested = option('count', 200_000); const workers = Math.min(option('workers', 10), 16);
const shuffleSeeds = option('shuffle-seeds', 4); const proposalSeed = option('seed', 40_009);
const saved = artifacts();
if (!saved.length) throw new Error('No saved Kingdom 009 lotteries were found.');
const kingdom = saved[0]!.artifact.kingdom as Kingdom; registerKingdom(kingdom);
const domain = new ResponsePolicyDomain(kingdom.id,
  { maxActiveSlots: 8, allowStopTokens: false, allowNoBuyFloor: false });
const config: GoldfishConfig = { kingdomId: kingdom.id,
  seeds: Array.from({ length: shuffleSeeds }, (_unused, index) => 4_100_000 + index),
  turnLimit: 30, actionCapPerTurn: 200 };

const benchmarkCount = Math.min(2_000, requested);
const benchmarkStrategies = generate(domain, benchmarkCount, proposalSeed);
const benchmarkStarted = Date.now();
await scoreInWorkers(benchmarkStrategies, config, kingdom, workers);
const benchmarkMs = Math.max(1, Date.now() - benchmarkStarted);
const estimatedCapacity = Math.max(benchmarkCount, Math.floor(benchmarkCount * 300_000 / benchmarkMs * 0.8));
const proposalCount = Math.min(requested, estimatedCapacity);
console.log(`Benchmark: ${benchmarkCount} policies in ${(benchmarkMs / 1000).toFixed(2)}s; running ${proposalCount}.`);

const policies = generate(domain, proposalCount, proposalSeed);
const goldfishStarted = Date.now();
const scores = await scoreInWorkers(policies, config, kingdom, workers);
scores.sort(compareGoldfishScores);
const goldfishMs = Date.now() - goldfishStarted;
const top = scores.slice(0, 5);
console.log(`Goldfish: ${proposalCount} policies in ${(goldfishMs / 1000).toFixed(2)}s.`);

const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
  { kingdom }, ['--import', 'tsx']);
const confirmationSeeds = Array.from({ length: 400 }, (_unused, index) => 4_200_000 + index);
const lotteryScores: Record<string, LotteryResult[]> = Object.fromEntries(top.map((entry) => [entry.strategy.id, []]));
try {
  for (const { artifact } of saved) {
    const rows = await headToHead(runner, kingdom.id, top.map((entry) => entry.strategy),
      supportStrategies(artifact), confirmationSeeds, 5, undefined, { startingDraftEnabled: false });
    for (let index = 0; index < rows.length; index += 1) lotteryScores[rows[index]!.strategy.id]!.push({
      version: artifact.suiteVersion, seed: artifact.runSeed, score: rows[index]!.mean,
      interval95: percentileBootstrapMean(rows[index]!.blockScores, 4_300_000 + saved.indexOf(saved.find((entry) => entry.artifact === artifact)!) * 10 + index),
      matches: rows[index]!.matches
    });
  }
} finally { await runner.close(); }

const result = { schemaVersion: 1, experiment: 'goldfish-random-pilot', createdAt: new Date().toISOString(),
  kingdom, config: { requested, proposalCount, proposalSeed, shuffleSeeds: config.seeds, turnLimit: config.turnLimit,
    workers, benchmarkCount, benchmarkMs, goldfishMs,
    ranking: ['completions descending', 'total turns to 50 ascending', 'cumulative damage area descending',
      'money spent descending', 'strategy ID ascending'] },
  top: top.map((entry) => ({ ...entry, plan: plan(entry.strategy), lotteries: lotteryScores[entry.strategy.id] })) };
const outDir = '.experiments/goldfish-k009'; fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'pilot.json'), `${JSON.stringify(result, null, 2)}\n`);
const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const lines = ['# Kingdom 009 goldfish pilot', '',
  `Goldfished ${proposalCount.toLocaleString()} unrestricted random policies on ${shuffleSeeds} shared shuffle seeds in ${(goldfishMs / 1000).toFixed(2)} seconds.`, '',
  '| Rank | Plan | Kills | Mean turns | Mean damage |', '|---:|---|---:|---:|---:|',
  ...top.map((entry, index) => `| ${index + 1} | ${plan(entry.strategy)} | ${entry.completions}/${entry.trials} | ${entry.meanTurnsTo50?.toFixed(2) ?? '—'} | ${entry.meanDamage.toFixed(1)} |`), '',
  '| Rank | Lottery | Score | 95% interval |', '|---:|---|---:|---:|',
  ...top.flatMap((entry, index) => lotteryScores[entry.strategy.id]!.map((row) =>
    `| ${index + 1} | ${row.version} seed ${row.seed} | ${percent(row.score)} | ${percent(row.interval95.lower)}–${percent(row.interval95.upper)} |`)), ''];
fs.writeFileSync(path.join(outDir, 'pilot.md'), `${lines.join('\n')}\n`);
console.log(`Wrote ${outDir}/pilot.{json,md}.`);
