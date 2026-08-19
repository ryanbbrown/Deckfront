/**
 * Measures Action-phase search throughput: wall clock per decision and per match, and the visited
 * states each decision needed. Plan `.plans/10-4-strategies-and-action-search.md` requires these
 * numbers, because every search node clones the whole `GameState` through `applyAction`.
 *
 * The same timing path serves the profiling of `.plans/10-8-profiling.md`, so a before-and-after
 * pair cannot come from two disagreeing measurements. Bound the workload with the options and
 * profile it in one process:
 *
 *   npx tsx scripts/measure_search.ts
 *   npx tsx scripts/measure_search.ts --kingdom rigged-melee --seeds 3 --repeats 5
 *   node --cpu-prof --cpu-prof-dir .experiments/profiles --import tsx scripts/measure_search.ts \
 *     --kingdom rigged-melee --seeds 3
 */
import os from 'node:os';
import process from 'node:process';
import { strategyAgent } from '../src/sim/agents/strategyAgent';
import { CURATED_KINGDOM_IDS } from '../src/sim/kingdoms';
import { runMatch } from '../src/sim/match';
import { diagnosticStrategies } from '../src/sim/baselines';

const TURN_LIMIT = 30;
const ACTION_CAP = 200;

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

const kingdomOption = option('kingdom');
if (kingdomOption && !CURATED_KINGDOM_IDS.includes(kingdomOption)) {
  throw new Error(`Unknown kingdom ${kingdomOption}. Choose one of: ${CURATED_KINGDOM_IDS.join(', ')}.`);
}
const kingdoms = kingdomOption ? [kingdomOption] : CURATED_KINGDOM_IDS;
const seeds = (option('seeds') ?? '3,17,41').split(',').map((raw) => {
  const seed = Number(raw);
  if (!Number.isInteger(seed) || seed < 1) throw new Error(`--seeds takes positive whole numbers, not ${raw}.`);
  return seed;
});
const repeats = Number(option('repeats') ?? '1');
if (!Number.isInteger(repeats) || repeats < 1) throw new Error('--repeats takes a positive whole number.');

function quantile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}
function report(name: string, samples: number[]): string {
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = samples.reduce((total, value) => total + value, 0) / (samples.length || 1);
  return `${name}: n=${samples.length} mean=${mean.toFixed(3)} p50=${quantile(sorted, 0.5).toFixed(3)}`
    + ` p95=${quantile(sorted, 0.95).toFixed(3)} max=${(sorted.at(-1) ?? 0).toFixed(3)}`;
}

// Pooled across repeats: every repeat plays the same deterministic matches, so the distributions
// describe the same workload and only the wall clock differs.
const decisionMilliseconds: number[] = [];
const visitedCounts: number[] = [];
const matchMilliseconds: number[] = [];
const outcomes = new Map<string, number>();
const throughput: number[] = [];
let overflow = 0;

for (let repeat = 0; repeat < repeats; repeat += 1) {
  const repeatStarted = performance.now();
  let matches = 0;
  for (const kingdomId of kingdoms) {
    const strategies = diagnosticStrategies(kingdomId);
    for (const seed of seeds) {
      for (const ochre of strategies) {
        for (const indigo of strategies) {
          const onSearch = (entry: { visited: number; milliseconds: number }): void => {
            decisionMilliseconds.push(entry.milliseconds);
            visitedCounts.push(entry.visited);
          };
          const started = performance.now();
          const result = runMatch({
            kingdomId, seed, firstPlayerId: 'ochre', swapSides: false,
            turnLimitPerPlayer: TURN_LIMIT, actionCapPerTurn: ACTION_CAP,
            agents: { ochre: strategyAgent(ochre, { onSearch }), indigo: strategyAgent(indigo, { onSearch }) }
          });
          matchMilliseconds.push(performance.now() - started);
          matches += 1;
          outcomes.set(result.reason, (outcomes.get(result.reason) ?? 0) + 1);
          if (result.reason === 'actionSearchOverflow') overflow += 1;
        }
      }
    }
  }
  const rate = matches / ((performance.now() - repeatStarted) / 1000);
  throughput.push(rate);
  console.log(`repeat ${repeat + 1}/${repeats}: ${matches} matches at ${rate.toFixed(1)} per second`);
}

const sortedThroughput = [...throughput].sort((left, right) => left - right);
console.log(`node=${process.version} arch=${os.arch()} cpu=${os.cpus()[0]?.model ?? 'unknown'}`);
console.log(`kingdoms=${kingdoms.join(',')} seeds=${seeds.join(',')} strategies=5`);
console.log(`matches=${matchMilliseconds.length} turnLimitPerPlayer=${TURN_LIMIT} actionCapPerTurn=${ACTION_CAP}`);
console.log(`matches per second: median=${quantile(sortedThroughput, 0.5).toFixed(1)}`
  + ` min=${(sortedThroughput[0] ?? 0).toFixed(1)} max=${(sortedThroughput.at(-1) ?? 0).toFixed(1)}`);
console.log(report('decision ms', decisionMilliseconds));
console.log(report('match ms', matchMilliseconds));
console.log(report('visited states', visitedCounts));
console.log(`stop reasons: ${[...outcomes].map(([reason, count]) => `${reason}=${count}`).join(' ')}`);
console.log(`search overflows: ${overflow}`);
