/**
 * Fast proof that one discovery response can repair the known bad strategy.
 *
 * It runs one generated-and-raced response search, confirms that response against the incumbent,
 * then tests the previously exhaustive-sweep winner against the response on 100 held-out seeds.
 */
import fs from 'node:fs';
import process from 'node:process';
import { registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import { repairStrategy } from '../src/sim/mutation';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { runResponseSearch } from '../src/sim/responseOracle';
import { INFINITE_COUNT, fixedBuyPlan, formatStrategy } from '../src/sim/strategy';
import { headToHead, seedRange } from './headToHead';

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

const gameFile = option('game') ?? (() => { throw new Error('Pass --game <game.json>.'); })();
const workers = Number(option('workers') ?? '12');
const record = JSON.parse(fs.readFileSync(gameFile, 'utf8')) as { kingdom: Kingdom };
registerKingdom(record.kingdom);
const kingdomId = record.kingdom.id;

const incumbent = repairStrategy(kingdomId, {
  id: '', startingBuild: ['cull', 'steadyShot', 'step'], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: 'heavyBlow', desiredCount: 7 },
    { kind: 'buy', cardId: 'drive', desiredCount: 2 },
    { kind: 'buy', cardId: 'cull', desiredCount: INFINITE_COUNT }
  ])
});
const previousSweepWinner = repairStrategy(kingdomId, {
  id: '', startingBuild: ['cull', 'steadyShot', 'steadyShot', 'step'], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: 'step', desiredCount: 2 },
    { kind: 'buy', cardId: 'adapt', desiredCount: 1 },
    { kind: 'buy', cardId: 'heavyBlow', desiredCount: INFINITE_COUNT }
  ])
});

const runner = new WorkerPairingRunner(
  workers, new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom: record.kingdom }, ['--import', 'tsx']
);
const started = Date.now();
try {
  let current = incumbent;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await runResponseSearch({
      objective: 'global', kingdomId, runSeed: 1369963998, restart: 0, attempt,
      strategies: [current], targetWeights: { [current.id]: 1 },
      candidateCount: 20, blocks: 8, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
      actionCapPerTurn: ACTION_CAP_PER_TURN, runner
    });
    if (!response.candidate || !response.result) throw new Error('The response search returned no candidate.');
    const candidate = response.candidate;
    const improvement = (await headToHead(runner, kingdomId, [candidate], current,
      seedRange(5_001 + attempt * 100, 100), 1))[0]!;
    console.log(`\nstep ${attempt + 1}: ${response.result.sources.actual} candidates; race `
      + response.result.rounds.map((round) => `${round.entered}->${round.survivors}`).join(', '));
    console.log(`held-out ${response.result.heldOutMean?.toFixed(4)}; deep improvement ${improvement.mean.toFixed(4)}`);
    console.log(formatStrategy(candidate));
    if (improvement.mean <= 0.55)
      throw new Error(`Smoke failed: step ${attempt + 1} only scored ${improvement.mean.toFixed(4)}.`);
    current = candidate;
  }

  const originalCheck = (await headToHead(runner, kingdomId, [current], incumbent,
    seedRange(7_001, 100), 1))[0]!;
  const challengerCheck = (await headToHead(runner, kingdomId, [previousSweepWinner], current,
    seedRange(8_001, 100), 1))[0]!;
  console.log(`\nfinal response vs original incumbent: ${originalCheck.mean.toFixed(4)} (400 matches)`);
  console.log(`old exhaustive winner vs final response: ${challengerCheck.mean.toFixed(4)} (400 matches)`);
  console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (challengerCheck.mean > 0.55)
    throw new Error(`Smoke failed: old sweep winner still scored ${challengerCheck.mean.toFixed(4)}.`);
} finally {
  await runner.close();
}
