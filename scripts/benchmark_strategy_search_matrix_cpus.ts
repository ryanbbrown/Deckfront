import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { PairingJob } from '../src/sim/pairingRunner';
import type { Strategy } from '../src/sim/strategy';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';
import { strategySearchMatrixSeeds } from '../src/sim/strategySearchMatrix';

function option(name: string, fallback: string): string { const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? fallback : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`); return value; }
const source = path.resolve(option('source',
  '.experiments/k007-threshold-racing-double-oracle/goldfish-rep1/v1/run-1/checkpoint.json'));
const workerShapes = option('workers', '4,8').split(',').map(Number);
if (workerShapes.some((value) => !Number.isSafeInteger(value) || value < 1)) throw new Error('Worker shapes are invalid.');
const checkpoint = JSON.parse(fs.readFileSync(source, 'utf8')) as { matrix?: { strategies?: Strategy[] } };
const strategies = checkpoint.matrix?.strategies?.slice(0, 50);
if (!strategies || strategies.length !== 50) throw new Error('Matrix benchmark source needs 50 strategies.');
const kingdomId = 'deep-beam-tuning-007', kingdom = strategySearchKingdom(kingdomId);
const seeds = strategySearchMatrixSeeds({ kingdomId, evidenceId: 'a'.repeat(64),
  reservoirIdentityHash: 'b'.repeat(64), reservoirContentHash: 'c'.repeat(64),
  matrixSeedNamespace: 'strategy-search-matrix-v2' });
const cells = strategies.flatMap((row, rowIndex) => strategies.slice(rowIndex).map((column, offset) =>
  ({ row, column, rowIndex, columnIndex: rowIndex + offset })));
const results = [];
for (const workers of workerShapes) {
  const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  const started = performance.now(); let submitted = 0;
  try {
    for (let start = 0; start < cells.length; start += workers) {
      const jobs: PairingJob[] = cells.slice(start, start + workers).flatMap((cell) => seeds.map((seed) => ({
        candidate: cell.row, opponent: cell.column,
        options: { kingdomId, seeds: [seed], turnLimitPerPlayer: 30, actionCapPerTurn: 200,
          startingDraftEnabled: false, allowEarlyStop: false }
      })));
      const result = await runner.run(jobs); submitted += result.submitted;
      if (result.submitted !== jobs.length || result.outcomes.some((outcome) => !outcome || outcome.record.aborted)) {
        throw new Error('Matrix CPU benchmark pairing failed.');
      }
    }
  } finally { await runner.close(); }
  const elapsedMs = performance.now() - started;
  results.push({ workers, cells: cells.length, seeds: seeds.length, pairingJobs: submitted,
    games: submitted * 2, elapsedMs, gamesPerSecond: submitted * 2 / (elapsedMs / 1000) });
}
const report = { schemaVersion: 1, benchmark: 'strategy-search-matrix-cpu-shapes', kingdomId,
  source, runtime: { node: process.version, platform: process.platform, architecture: process.arch,
    logicalCpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model }, results };
const output = path.resolve(option('out', '.data/compact-benchmark/matrix-cpu-shapes.json'));
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
