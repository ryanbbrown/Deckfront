import fs from 'node:fs';
import path from 'node:path';
import { registerKingdom } from '../src/game';
import {
  runFixedReservoirPsro, validateFixedReservoirPool, validateFixedReservoirPsroArtifact
} from '../src/sim/fixedReservoirPsro';
import type { FixedReservoirPoolArtifact } from '../src/sim/fixedReservoirPsro';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { RANDOM_PSRO_KINGDOMS } from '../src/sim/randomPsroSuite';

const KINGDOM_ID = 'deep-beam-tuning-009';
const POOL_SEEDS = [1, 3, 4] as const;
const EVALUATION_SEEDS = [7_100_009, 7_200_009, 7_300_009] as const;
const BASELINE_ROOT = path.join('.experiments', 'fixed-reservoir-psro-five-run',
  'fixed-reservoir-five-run-v1', KINGDOM_ID);
const ROOT = path.join('.experiments', 'fixed-reservoir-psro-evaluation-variance-v1', KINGDOM_ID);
const WORKERS = 10;

function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function poolPath(poolSeed: number): string { return path.join(BASELINE_ROOT, `pool-${poolSeed}.json`); }
function baselineRunPath(poolSeed: number): string { return path.join(BASELINE_ROOT, `run-${poolSeed}.json`); }
function outputPath(poolSeed: number, evaluationSeed: number): string {
  return path.join(ROOT, `pool-${poolSeed}`, `evaluation-${evaluationSeed}.json`);
}
function loadPool(poolSeed: number): FixedReservoirPoolArtifact {
  const value = readJson(poolPath(poolSeed));
  if (!validateFixedReservoirPool(value, { kingdomId: KINGDOM_ID, poolSeed,
    generatedCount: 500_000, goldfishCount: 18_000, randomCount: 2_000,
    goldfishSeeds: [5_200_000, 5_200_001, 5_200_002, 5_200_003] })) {
    throw new Error(`Pool ${poolSeed} is invalid.`);
  }
  return value;
}
function validRun(file: string, pool: FixedReservoirPoolArtifact, evaluationSeed: number): boolean {
  if (!fs.existsSync(file)) return false;
  return validateFixedReservoirPsroArtifact(readJson(file), pool, { evaluationSeed });
}

const kingdom = RANDOM_PSRO_KINGDOMS.find((entry) => entry.id === KINGDOM_ID);
if (!kingdom) throw new Error(`Missing ${KINGDOM_ID}.`);
registerKingdom(kingdom);
const command = process.argv[2] ?? '--run';
if (command === '--status') {
  let complete = 0;
  for (const poolSeed of POOL_SEEDS) {
    const pool = loadPool(poolSeed);
    for (const evaluationSeed of EVALUATION_SEEDS) {
      const valid = validRun(outputPath(poolSeed, evaluationSeed), pool, evaluationSeed);
      if (valid) complete += 1;
      console.log(`pool ${poolSeed} evaluation ${evaluationSeed}: ${valid ? 'complete' : 'missing/invalid'}`);
    }
  }
  console.log(`${complete}/9 complete`);
  if (complete !== 9) process.exitCode = 1;
} else if (command === '--run') {
  const runner = new WorkerPairingRunner(WORKERS, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  try {
    for (const poolSeed of POOL_SEEDS) {
      const pool = loadPool(poolSeed);
      for (const evaluationSeed of EVALUATION_SEEDS) {
        const file = outputPath(poolSeed, evaluationSeed);
        if (validRun(file, pool, evaluationSeed)) {
          console.log(`pool ${poolSeed} evaluation ${evaluationSeed}: skipped valid`);
          continue;
        }
        if (evaluationSeed === 7_100_009) {
          const baseline = readJson(baselineRunPath(poolSeed));
          if (!validateFixedReservoirPsroArtifact(baseline, pool, { evaluationSeed })) {
            throw new Error(`Baseline run ${poolSeed} is invalid.`);
          }
          writeAtomic(file, baseline);
          console.log(`pool ${poolSeed} evaluation ${evaluationSeed}: reused baseline`);
          continue;
        }
        console.log(`pool ${poolSeed} evaluation ${evaluationSeed}: starting`);
        const run = await runFixedReservoirPsro(pool, runner, { evaluationSeed });
        if (!validateFixedReservoirPsroArtifact(run, pool, { evaluationSeed })) {
          throw new Error(`Pool ${poolSeed} evaluation ${evaluationSeed} produced an invalid run.`);
        }
        writeAtomic(file, run);
        console.log(`pool ${poolSeed} evaluation ${evaluationSeed}: ${run.status}; ${run.rounds.length} rounds; ${(run.elapsedMs / 1000).toFixed(1)}s`);
      }
    }
  } finally { await runner.close(); }
} else throw new Error(`Unknown command ${command}.`);
