/**
 * Measures Action-phase search throughput: wall clock per decision and per match, and the visited
 * states each decision needed. Plan `.plans/10-4-strategies-and-action-search.md` requires these
 * numbers, because every search node clones the whole `GameState` through `applyAction`.
 *
 * Run with: npx tsx scripts/measure_search.ts
 */
import { BASELINE_STRATEGIES } from '../src/sim/baselines';
import { strategyAgent } from '../src/sim/agents/strategyAgent';
import { CURATED_KINGDOM_IDS } from '../src/sim/kingdoms';
import { runMatch } from '../src/sim/match';

const TURN_LIMIT = 100;
const ACTION_CAP = 200;
const SEEDS = [3, 17, 41];

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

const decisionMilliseconds: number[] = [];
const visitedCounts: number[] = [];
const matchMilliseconds: number[] = [];
const outcomes = new Map<string, number>();
let overflow = 0;

for (const kingdomId of CURATED_KINGDOM_IDS) {
  for (const seed of SEEDS) {
    for (const ochre of BASELINE_STRATEGIES) {
      for (const indigo of BASELINE_STRATEGIES) {
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
        outcomes.set(result.reason, (outcomes.get(result.reason) ?? 0) + 1);
        if (result.reason === 'actionSearchOverflow') overflow += 1;
      }
    }
  }
}

console.log(`kingdoms=${CURATED_KINGDOM_IDS.length} seeds=${SEEDS.length} strategies=${BASELINE_STRATEGIES.length}`);
console.log(`matches=${matchMilliseconds.length} turnLimitPerPlayer=${TURN_LIMIT} actionCapPerTurn=${ACTION_CAP}`);
console.log(report('decision ms', decisionMilliseconds));
console.log(report('match ms', matchMilliseconds));
console.log(report('visited states', visitedCounts));
console.log(`stop reasons: ${[...outcomes].map(([reason, count]) => `${reason}=${count}`).join(' ')}`);
console.log(`search overflows: ${overflow}`);
