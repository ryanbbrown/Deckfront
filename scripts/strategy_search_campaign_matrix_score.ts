import fs from 'node:fs';
import path from 'node:path';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { PairingJob } from '../src/sim/pairingRunner';
import { GAMES_PER_SEED } from '../src/sim/pairing';
import { seedRecordFromOutcome } from '../src/sim/initialMatrixCalibration';
import {
  createStrategySearchMatrixChunk, createStrategySearchMatrixScoreTaskChunk,
  strategySearchMatrixScoreTasks, validateStrategySearchMatrixManifest
} from '../src/sim/strategySearchMatrix';
import type { StrategySearchMatrixChunk } from '../src/sim/strategySearchMatrix';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

function option(name: string): string { const index = process.argv.indexOf(`--${name}`), value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`--${name} is required.`); return value; }
function integer(name: string, minimum = 0): number { const value = Number(option(name));
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`--${name} is invalid.`); return value; }
function writeAtomic(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  fs.renameSync(temporary, file); }
const manifest = JSON.parse(fs.readFileSync(path.resolve(option('manifest')), 'utf8')) as unknown;
if (!validateStrategySearchMatrixManifest(manifest)) throw new Error('Matrix score manifest is invalid.');
const tasks = strategySearchMatrixScoreTasks(manifest, { targetTasks: integer('task-count', 1) });
const task = tasks[integer('task-index')];
if (!task) throw new Error('Matrix score task does not exist.');
const workers = integer('workers', 1), kingdom = strategySearchKingdom(manifest.source.kingdomId);
const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
  { kingdom }, ['--import', 'tsx']);
const chunks: StrategySearchMatrixChunk[] = [];
try {
  for (let start = 0; start < task.jobs.length; start += workers * 4) {
    const batch = task.jobs.slice(start, start + workers * 4), pairingJobs: PairingJob[] = [];
    for (const job of batch) for (const seed of job.seeds) pairingJobs.push({
      candidate: manifest.strategies[job.rowIndex]!, opponent: manifest.strategies[job.columnIndex]!,
      options: { kingdomId: manifest.source.kingdomId, seeds: [seed], turnLimitPerPlayer: 30,
        actionCapPerTurn: 200, startingDraftEnabled: false, allowEarlyStop: false } });
    const result = await runner.run(pairingJobs);
    if (result.outcomes.length !== pairingJobs.length) throw new Error('Matrix score task returned incomplete work.');
    let cursor = 0;
    batch.forEach((job) => {
      const records = job.seeds.map(() => {
        const outcome = result.outcomes[cursor++];
        if (!outcome || outcome.record.aborted || outcome.stopReason !== 'maximum'
          || outcome.matches !== GAMES_PER_SEED || outcome.blocks.length !== 1) {
          throw new Error('Matrix score task returned invalid pairing evidence.');
        }
        return seedRecordFromOutcome(outcome.blocks[0]!, outcome.telemetry, GAMES_PER_SEED,
          job.rowIndex === job.columnIndex ? 'diagonal-self-play-telemetry' : 'off-diagonal-payoff-and-telemetry');
      });
      chunks.push(createStrategySearchMatrixChunk({ manifest, job, records }));
    });
  }
} finally { await runner.close(); }
writeAtomic(path.resolve(option('out')), createStrategySearchMatrixScoreTaskChunk({ manifest, task, chunks }));
