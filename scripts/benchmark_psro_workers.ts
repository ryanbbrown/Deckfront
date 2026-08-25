import os from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { SeededRandom, registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { mixtureSchedule, evaluateCandidates } from '../src/sim/mixtureEvaluation';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { stoplessRandomDomain } from '../src/sim/randomPsro';
import type { Strategy } from '../src/sim/strategy';

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
}
function positive(name: string, fallback: number): number {
  const value = Number(option(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be positive.`);
  return value;
}

const workers = positive('workers', 10);
const candidateCount = positive('candidates', 30);
const blocks = positive('blocks', 4);
const mode = option('mode', 'score-only');
if (!['full', 'score-only'].includes(mode)) throw new Error('--mode must be full or score-only.');
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
registerKingdom(kingdom);
const domain = stoplessRandomDomain(kingdom.id);
const random = new SeededRandom(0x51_90_009);
const candidates: Strategy[] = Array.from({ length: candidateCount }, () => domain.randomComplete(random));
const opponents = new Map(candidates.slice(0, 3).map((strategy) => [strategy.id, strategy]));
const weights = Object.fromEntries([...opponents].map(([id]) => [id, 1 / opponents.size]));
const schedule = mixtureSchedule(weights,
  Array.from({ length: blocks }, (_unused, index) => 9_100_000 + index), 9_200_000);
const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
  { kingdom }, ['--import', 'tsx']);
try {
  const started = performance.now();
  const results = await evaluateCandidates(candidates, opponents, schedule, runner, {
    kingdomId: kingdom.id, turnLimitPerPlayer: 50, actionCapPerTurn: 200,
    startingDraftEnabled: false, scoreOnly: mode === 'score-only'
  });
  const elapsedMs = performance.now() - started;
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, benchmark: 'fixed-reservoir-psro-workers',
    mode, workers, candidates: candidateCount, blocks, matches: results.reduce((sum, entry) => sum + entry.matches, 0),
    digest: results.map((entry) => `${entry.strategy.id}:${entry.blockScores.join(',')}`).join('|'),
    elapsedMs, candidatesPerSecond: candidateCount / (elapsedMs / 1000), runtime: {
      node: process.version, platform: process.platform, architecture: process.arch,
      logicalCpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? 'unknown'
    } }, null, 2)}\n`);
} finally {
  await runner.close();
}
