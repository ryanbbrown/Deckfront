/**
 * Sweeps for the best deck that beats one target strategy, and prints the ranking.
 *
 * Use it to check a claim discovery is making. If the equilibrium puts full weight on one strategy,
 * anything the sweep beats it with contradicts that, and the equilibrium is wrong.
 *
 *   npx tsx scripts/sweep_strategies.ts --kingdom-file k.json --target t.json --out .data/sweep.json
 */
import fs from 'node:fs';
import process from 'node:process';
import { SeededRandom, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { repairStrategy } from '../src/sim/mutation';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { formatStrategy } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import { sweepAgainst } from './sweep';

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

const kingdomFile = option('kingdom-file') ?? (() => { throw new Error('Pass --kingdom-file <kingdom.json>.'); })();
const targetFile = option('target') ?? (() => { throw new Error('Pass --target <strategy.json>.'); })();
const outFile = option('out') ?? '.data/sweep.json';
const workers = Number(option('workers') ?? '12');

const kingdom = JSON.parse(fs.readFileSync(kingdomFile, 'utf8')) as Kingdom;
registerKingdom(kingdom);
const target = repairStrategy(kingdom.id,
  { id: '', ...JSON.parse(fs.readFileSync(targetFile, 'utf8')) as Omit<Strategy, 'id'> });

function bootstrap(values: readonly number[]): { lower: number; upper: number } {
  const random = new SeededRandom(0x5eed1234);
  const means = Array.from({ length: 2000 }, () => {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[random.nextInt(values.length)]!;
    return total / values.length;
  }).sort((left, right) => left - right);
  return { lower: means[Math.floor(means.length * 0.025)]!, upper: means[Math.floor(means.length * 0.975)]! };
}

console.log(`kingdom: ${kingdom.id}`);
console.log(`market: ${kingdom.actionPiles.map((pile) => pile.cardId).join(', ')}`);
console.log(`target\n${formatStrategy(target)}`);

const runner = new WorkerPairingRunner(
  workers, new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom }, ['--import', 'tsx']
);
try {
  const sweep = await sweepAgainst(runner, kingdom.id, target, bootstrap,
    (message) => console.log(`  ${message}`));
  console.log(`\n=== ranked against the target, ${sweep.matches.toLocaleString()} matches ===`);
  for (const entry of sweep.ranked.slice(0, 25)) {
    console.log(`${entry.mean.toFixed(4)} [${entry.interval.lower.toFixed(4)}, ${entry.interval.upper.toFixed(4)}]`
      + `  ${formatStrategy(entry.strategy).split('\n').slice(1).join('  ').replace(/\s+/g, ' ')}`);
  }
  console.log(`\nEXPLOITABILITY ${sweep.exploitability.toFixed(4)}`);
  fs.writeFileSync(outFile, `${JSON.stringify({ kingdomId: kingdom.id, target, ...sweep }, null, 2)}\n`);
  console.log(`written: ${outFile}`);
} finally { await runner.close(); }
