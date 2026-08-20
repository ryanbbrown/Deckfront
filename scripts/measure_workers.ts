import process from 'node:process';
import { diagnosticStrategies } from '../src/sim/baselines';
import { InlinePairingRunner, WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { PairingJob, PairingRunner } from '../src/sim/pairingRunner';

function option(name: string, fallback: number, minimum: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`--${name} needs a whole number of at least ${minimum}.`);
  return value;
}

const workers = option('workers', 4, 0);
const jobs = option('jobs', 1000, 1);
const seedsPerJob = option('seeds', 8, 1);
if (workers > 16) throw new Error('--workers may be at most 16.');
if (seedsPerJob > 25) throw new Error('--seeds may be at most 25.');
const strategies = diagnosticStrategies('current-duel');
const work: PairingJob[] = Array.from({ length: jobs }, (_, index) => ({
  candidate: strategies[index % strategies.length]!,
  opponent: strategies[(index + 1) % strategies.length]!,
  options: {
    kingdomId: 'current-duel',
    seeds: Array.from({ length: seedsPerJob }, (_unused, block) => index * seedsPerJob + block + 1),
    turnLimitPerPlayer: 30, actionCapPerTurn: 200, allowEarlyStop: false
  }
}));
const runner: PairingRunner = workers === 0
  ? new InlinePairingRunner()
  : new WorkerPairingRunner(workers, new URL('../dist-sim/experiment.mjs', import.meta.url));
const started = performance.now();
const result = await runner.run(work);
await runner.close();
const seconds = (performance.now() - started) / 1000;
const matches = result.outcomes.reduce((total, outcome) => total + (outcome?.matches ?? 0), 0);
console.log(`workers=${workers === 0 ? 'inline' : workers} jobs=${jobs} matches=${matches}`
  + ` seconds=${seconds.toFixed(3)} gamesPerSecond=${(matches / seconds).toFixed(1)}`);
