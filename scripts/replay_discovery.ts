/**
 * Replays the exact PSRO run that produced a saved game, recording every candidate it ever
 * generated, then scores those candidates against the strategy the run chose.
 *
 * It separates the two ways discovery can fail. If no recorded candidate beats the chosen strategy,
 * the better deck was never generated and the fix belongs in candidate generation. If several do,
 * generation was fine and the screen threw them away, so the fix belongs in evaluation depth and
 * admission.
 *
 *   npx tsx scripts/replay_discovery.ts --game .data/games/<id>.json --seed <psro seed>
 */
import fs from 'node:fs';
import process from 'node:process';
import { registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { ACTION_CAP_PER_TURN, EXPERIMENT_DEFAULTS, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import { runFinalSearch } from '../src/sim/finalSearch';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { runPsro } from '../src/sim/psro';
import type { IterationEvent } from '../src/sim/psro';
import { randomUniqueStrategies } from '../src/sim/randomStrategy';
import { generateResponseBatch, runResponseSearch } from '../src/sim/responseOracle';
import { canonicalStrategy, formatRung, formatStrategy } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import { headToHead, seedRange } from './headToHead';

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

const gameFile = option('game') ?? (() => { throw new Error('Pass --game <game.json>.'); })();
const seed = Number(option('seed') ?? (() => { throw new Error('Pass --seed <psro seed>.'); })());
const outFile = option('out') ?? '.data/replay.json';
const workers = Number(option('workers') ?? '12');
const record = JSON.parse(fs.readFileSync(gameFile, 'utf8')) as { kingdom: Kingdom; aiStrategy: Strategy };
registerKingdom(record.kingdom);
const kingdomId = record.kingdom.id;
const limits = EXPERIMENT_DEFAULTS.full;

const runner = new WorkerPairingRunner(
  workers, new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom: record.kingdom }, ['--import', 'tsx']
);

/** Every candidate the run considered, by canonical form, with where it came from. */
const considered = new Map<string, { strategy: Strategy; source: 'global' | 'final' }>();
const remember = (strategy: Strategy, source: 'global' | 'final'): void => {
  const form = canonicalStrategy(strategy);
  if (!considered.has(form)) considered.set(form, { strategy, source });
};

const events: IterationEvent[] = [];
const started = Date.now();
const result = await runPsro({
  kingdomId, seed, restarts: limits.restarts, initialStrategies: limits.initialStrategies,
  candidates: limits.candidates, iterations: limits.iterations, seeds: limits.seeds,
  unionIterations: limits.unionIterations, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
  actionCapPerTurn: ACTION_CAP_PER_TURN,
  searchDeadline: started + limits.deadlineMinutes * 60_000,
  finalDeadline: started + limits.deadlineMinutes * 60_000,
  onEvent: (event) => events.push(event),
  responseSearch: (options) => runResponseSearch({ ...options, batchFactory: (batchOptions) => {
    const batch = generateResponseBatch(batchOptions);
    for (const candidate of batch.candidates) remember(candidate, 'global');
    return batch;
  } }),
  // The final search takes no factory. Its candidate set is a pure function of its seeds, so the
  // same call reproduces exactly what it screened.
  finalSearch: (options) => {
    const generated = randomUniqueStrategies(kingdomId, options.seeds.candidate[0]!, 3_000,
      new Set(options.strategies.map(canonicalStrategy)));
    for (const candidate of generated.strategies) remember(candidate, 'final');
    return runFinalSearch(options);
  }
}, runner);
const elapsed = Date.now() - started;

if (!result.equilibrium) throw new Error(`The replay produced no equilibrium: ${result.stopReason}.`);
const weights = result.equilibrium.weights;
const ranked = result.strategies
  .map((strategy) => ({ strategy, weight: weights[strategy.id] ?? 0 }))
  .sort((left, right) => right.weight - left.weight || left.strategy.id.localeCompare(right.strategy.id));
const chosen = ranked[0]!.strategy;

console.log(`kingdom: ${kingdomId}  seed: ${seed}`);
console.log(`replay: ${result.strategies.length} strategies, ${result.matches.toLocaleString()} matches,`
  + ` ${(elapsed / 1000).toFixed(0)}s, stop ${result.stopReason}`);
console.log(`support: ${ranked.filter((entry) => entry.weight > 1e-6).length} of ${ranked.length}`);
console.log(`chosen\n${formatStrategy(chosen)}`);
console.log(`saved game strategy: ${record.aiStrategy.id}`
  + `  ${chosen.id === record.aiStrategy.id ? 'REPRODUCED' : 'DIFFERENT'}`);

console.log('\n=== iterations ===');
for (const event of events) {
  const response = event.response;
  const interval = response?.interval;
  console.log(`${String(event.restart).padStart(5)} #${String(event.attempt).padStart(2)}`
    + ` size=${String(event.matrixSize).padStart(3)}`
    + ` screen=${response ? response.bestTrainingMean.toFixed(4) : '  -   '}`
    + ` confirm=${response?.heldOutMean != null ? response.heldOutMean.toFixed(4) : '  -   '}`
    + ` interval=${interval ? `[${interval.lower.toFixed(3)}, ${interval.upper.toFixed(3)}]` : '   -   '}`
    + ` admitted=${event.admittedStrategyId ? 'yes' : 'no '}`
    + ` candidates=${response?.sources.actual ?? 0}`);
}

console.log(`\n=== ${considered.size} candidates ever considered, scored against the chosen strategy ===`);
const everyCandidate = [...considered.values()].map((entry) => entry.strategy);
const screened = await headToHead(runner, kingdomId, everyCandidate, chosen, seedRange(2001, 25), 20_000,
  (done, total) => process.stdout.write(`\r  screen ${done}/${total}   `));
process.stdout.write('\n');
screened.sort((left, right) => right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
const deep = await headToHead(runner, kingdomId, screened.slice(0, 100).map((entry) => entry.strategy), chosen,
  seedRange(3001, 200), 100, (done, total) => process.stdout.write(`\r  confirm ${done}/${total}   `));
process.stdout.write('\n');
deep.sort((left, right) => right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));

const sourceOf = (strategy: Strategy): string => considered.get(canonicalStrategy(strategy))!.source;
for (const entry of deep.slice(0, 20)) {
  const plan = entry.strategy.buyPlan.map(formatRung).join(' -> ') || 'none';
  console.log(`${entry.mean.toFixed(4)}  ${sourceOf(entry.strategy).padEnd(6)}`
    + `  build: ${entry.strategy.startingBuild.join(',') || 'none'}  plan: ${plan}`);
}
const beating = deep.filter((entry) => entry.mean > 0.55).length;
console.log(`\n${beating} of the top 100 considered candidates score above 0.55 against the chosen strategy.`);

fs.writeFileSync(outFile, `${JSON.stringify({
  kingdomId, seed, chosen, reproduced: chosen.id === record.aiStrategy.id,
  matches: result.matches, elapsedMs: elapsed, stopReason: result.stopReason,
  support: ranked.filter((entry) => entry.weight > 1e-6),
  events, consideredCount: considered.size,
  considered: [...considered.values()].map((entry) => ({ ...entry.strategy, source: entry.source })),
  deep: deep.map((entry) => ({ strategy: entry.strategy, mean: entry.mean, source: sourceOf(entry.strategy) }))
}, null, 2)}\n`);
console.log(`written: ${outFile}`);
await runner.close();
