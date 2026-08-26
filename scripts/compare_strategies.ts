/**
 * Plays two strategies head to head and reports which is stronger, with an interval.
 *
 * Every shuffle seed runs twice without changing seats or positions. The left strategy moves first
 * once, and the right strategy moves first once. The reported figure is a mean score with a
 * percentile bootstrap over shuffle seeds, because a strong deck
 * still loses individual games to the shuffle and single matches prove nothing.
 *
 * Use it to check a claim the payoff matrix is making. If the equilibrium puts full weight on one
 * strategy, any strategy that beats it here contradicts that, and the equilibrium is wrong.
 *
 *   npx tsx scripts/compare_strategies.ts --kingdom <id> --left left.json --right right.json
 *   npx tsx scripts/compare_strategies.ts --game .data/games/<id>.json --left mine.json
 *
 * A strategy file is `{ startingBuild, buyPlan }`, with exactly ten discriminated ladder slots. With `--game`, the saved game
 * supplies the kingdom and its stored `aiStrategy` becomes the right-hand side.
 */
import fs from 'node:fs';
import process from 'node:process';
import { SeededRandom, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { repairStrategy } from '../src/sim/mutation';
import { playPairing } from '../src/sim/pairing';
import { formatStrategy } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';

const TURN_LIMIT = 30;
const ACTION_CAP = 200;

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

const seedCount = Number(option('seeds') ?? '200');
const gameFile = option('game');
let kingdomId = option('kingdom');
let right: Strategy | null = null;

if (gameFile) {
  const record = JSON.parse(fs.readFileSync(gameFile, 'utf8')) as { kingdom: Kingdom; aiStrategy: Strategy };
  registerKingdom(record.kingdom);
  kingdomId = record.kingdom.id;
  right = record.aiStrategy;
}
const kingdomFile = option('kingdom-file');
if (kingdomFile) {
  const kingdom = JSON.parse(fs.readFileSync(kingdomFile, 'utf8')) as Kingdom;
  registerKingdom(kingdom);
  kingdomId = kingdom.id;
}
if (!kingdomId) throw new Error('Pass --game, --kingdom-file, or --kingdom.');

const load = (file: string): Strategy =>
  repairStrategy(kingdomId!, { id: '', ...JSON.parse(fs.readFileSync(file, 'utf8')) as Omit<Strategy, 'id'> });

const leftFile = option('left');
if (!leftFile) throw new Error('Pass --left <strategy.json>.');
const left = load(leftFile);
const rightFile = option('right');
if (rightFile) right = load(rightFile);
if (!right) throw new Error('Pass --right <strategy.json>, or --game to take it from a saved game.');
right = repairStrategy(kingdomId, right);

console.log(`kingdom: ${kingdomId}`);
console.log(`LEFT\n${formatStrategy(left)}`);
console.log(`RIGHT\n${formatStrategy(right)}`);

const perSeed: number[] = [];
let matches = 0;
let draws = 0;

for (let seed = 1; seed <= seedCount; seed += 1) {
  const result = playPairing(left, right, {
    kingdomId, seeds: [seed], turnLimitPerPlayer: TURN_LIMIT, actionCapPerTurn: ACTION_CAP,
    allowEarlyStop: false
  });
  perSeed.push(result.blocks[0]!.score);
  matches += result.matches;
  draws += result.record.draws;
}

const mean = perSeed.reduce((sum, value) => sum + value, 0) / perSeed.length;

// A shuffle seed, not either game inside its evaluation, is the bootstrap unit.
const random = new SeededRandom(0x5eed1234);
const means: number[] = [];
for (let sample = 0; sample < 2000; sample += 1) {
  let total = 0;
  for (let pick = 0; pick < perSeed.length; pick += 1) total += perSeed[random.nextInt(perSeed.length)]!;
  means.push(total / perSeed.length);
}
means.sort((a, b) => a - b);
const lower = means[Math.floor(means.length * 0.025)]!;
const upper = means[Math.floor(means.length * 0.975)]!;

console.log(`\nmatches=${matches} seeds=${seedCount} draws=${draws} (${((draws / matches) * 100).toFixed(2)}%)`);
console.log(`LEFT mean score=${mean.toFixed(4)}  95% interval=[${lower.toFixed(4)}, ${upper.toFixed(4)}]`);
console.log(`verdict: ${lower > 0.5 ? 'LEFT STRONGER' : upper < 0.5 ? 'RIGHT STRONGER' : 'INCONCLUSIVE'}`);
