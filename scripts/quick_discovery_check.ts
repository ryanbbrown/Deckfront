/**
 * Ten-minute discovery check on one saved kingdom.
 *
 * Runs current PSRO, then uses the independent staged sweep to look for an exploiter. This is a
 * fast gate, not the final multi-kingdom calibration.
 *
 *   npx tsx scripts/quick_discovery_check.ts --game .data/games/<id>.json --seed 123
 */
import fs from 'node:fs';
import process from 'node:process';
import { SeededRandom, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { ACTION_CAP_PER_TURN, EXPERIMENT_DEFAULTS, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { runPsro } from '../src/sim/psro';
import { formatStrategy } from '../src/sim/strategy';
import { sweepAgainst } from './sweep';

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

const gameFile = option('game') ?? (() => { throw new Error('Pass --game <game.json>.'); })();
const seed = Number(option('seed') ?? (() => { throw new Error('Pass --seed <psro seed>.'); })());
const outFile = option('out') ?? '.data/quick-discovery-check.json';
const workers = Number(option('workers') ?? '12');
const discoveryMinutes = Number(option('discovery-minutes') ?? '4');
const record = JSON.parse(fs.readFileSync(gameFile, 'utf8')) as { kingdom: Kingdom };
registerKingdom(record.kingdom);
const kingdomId = record.kingdom.id;
const limits = EXPERIMENT_DEFAULTS.full;

function bootstrap(values: readonly number[]): { lower: number; upper: number } {
  const random = new SeededRandom(0x5eed1234);
  const means = Array.from({ length: 2_000 }, () => {
    let total = 0;
    for (let index = 0; index < values.length; index += 1)
      total += values[random.nextInt(values.length)]!;
    return total / values.length;
  }).sort((left, right) => left - right);
  return { lower: means[Math.floor(means.length * 0.025)]!,
    upper: means[Math.floor(means.length * 0.975)]! };
}

const runner = new WorkerPairingRunner(
  workers, new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom: record.kingdom }, ['--import', 'tsx']
);
const started = Date.now();
try {
  console.log(`kingdom: ${kingdomId}`);
  console.log(`market: ${record.kingdom.actionPiles.map((pile) => pile.cardId).join(', ')}`);
  console.log(`PSRO seed: ${seed}`);
  const discoveryDeadline = Date.now() + discoveryMinutes * 60_000;
  const discovery = await runPsro({
    kingdomId, seed, restarts: limits.restarts, initialStrategies: limits.initialStrategies,
    candidates: limits.candidates, iterations: limits.iterations, seeds: limits.seeds,
    unionIterations: limits.unionIterations, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
    actionCapPerTurn: ACTION_CAP_PER_TURN, searchDeadline: discoveryDeadline,
    finalDeadline: discoveryDeadline,
    onEvent: (event) => {
      const response = event.response;
      console.log(`  search ${event.restart}:${event.attempt} matrix=${event.matrixSize}`
        + ` candidates=${response?.sources.actual ?? 0}`
        + ` confirm=${response?.heldOutMean?.toFixed(3) ?? '-'}`
        + ` admitted=${event.admittedStrategyId ? 'yes' : 'no'}`);
    }
  }, runner);
  if (!discovery.equilibrium) throw new Error(`Discovery produced no equilibrium: ${discovery.stopReason}.`);
  const weights = discovery.equilibrium.weights;
  const ranked = discovery.strategies
    .map((strategy) => ({ strategy, weight: weights[strategy.id] ?? 0 }))
    .sort((left, right) => right.weight - left.weight || left.strategy.id.localeCompare(right.strategy.id));
  const support = ranked.filter((entry) => entry.weight > 1e-6);
  const target = ranked[0]!.strategy;
  const targetMixture = support.map((entry) => ({ strategy: entry.strategy, weight: entry.weight }));
  const discoveryElapsedMs = Date.now() - started;
  console.log(`\ndiscovery: ${discovery.strategies.length} strategies,`
    + ` support ${support.length},`
    + ` ${discovery.matches.toLocaleString()} matches, ${(discoveryElapsedMs / 1000).toFixed(1)}s`);
  for (const entry of support) {
    console.log(`weight ${entry.weight.toFixed(4)}\n${formatStrategy(entry.strategy)}`);
  }

  const sweepStarted = Date.now();
  const sweep = await sweepAgainst(runner, kingdomId, targetMixture, bootstrap,
    (message) => console.log(`  sweep: ${message}`));
  const sweepElapsedMs = Date.now() - sweepStarted;
  const best = sweep.ranked[0]!;
  console.log(`\nexploitability: ${sweep.exploitability.toFixed(4)}`
    + ` [${best.interval.lower.toFixed(4)}, ${best.interval.upper.toFixed(4)}]`);
  console.log(`independent sweep: ${sweep.matches.toLocaleString()} matches,`
    + ` ${(sweepElapsedMs / 1000).toFixed(1)}s`);
  console.log(`best challenger\n${formatStrategy(best.strategy)}`);
  console.log(`total elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);

  fs.writeFileSync(outFile, `${JSON.stringify({
    kingdomId, seed, target, targetMixture, equilibrium: discovery.equilibrium,
    discovery: { strategies: discovery.strategies.length, matches: discovery.matches,
      elapsedMs: discoveryElapsedMs, stopReason: discovery.stopReason },
    sweep: { ...sweep, elapsedMs: sweepElapsedMs }
  }, null, 2)}\n`);
  console.log(`written: ${outFile}`);
} finally {
  await runner.close();
}
