import fs from 'node:fs';
import path from 'node:path';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { PairingJob } from '../src/sim/pairingRunner';
import { GAMES_PER_SEED } from '../src/sim/pairing';
import { seedRecordFromOutcome } from '../src/sim/initialMatrixCalibration';
import {
  createStrategySearchMatrixChunk, reduceStrategySearchMatrix, strategySearchMatrixChunkPath,
  strategySearchMatrixJobs, validateStrategySearchMatrixChunk, validateStrategySearchMatrixManifest
} from '../src/sim/strategySearchMatrix';
import type { StrategySearchMatrixChunk } from '../src/sim/strategySearchMatrix';
import { createStrategySearchContext } from '../src/sim/strategySearchContext';
import { createCampaignStageControlMarker } from '../src/sim/strategySearchStages';

function option(name: string): string { const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`); return value; }
function integer(name: string): number { const value = Number(option(name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be positive.`); return value; }
function writeAtomic(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file); }
const manifestFile = path.resolve(option('manifest')), outputRoot = path.resolve(option('out')),
  controlRoot = path.resolve(option('control')), workers = integer('workers'),
  jobsPerBatch = integer('jobs-per-batch'), runtimeChunkSize = integer('runtime-chunk-size'),
  shutdownAtMs = Number(option('shutdown-at-ms'));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as unknown;
if (!validateStrategySearchMatrixManifest(manifest) || !Number.isSafeInteger(shutdownAtMs)) {
  throw new Error('Matrix execution input is invalid.');
}
const { kingdom } = createStrategySearchContext(manifest.source.kingdomId);
if (shutdownAtMs <= Date.now()) throw new Error('Matrix execution input is invalid.');
const jobs = strategySearchMatrixJobs(manifest, runtimeChunkSize);
const chunks = new Map<number, StrategySearchMatrixChunk>();
for (const job of jobs) {
  const file = path.join(outputRoot, strategySearchMatrixChunkPath(job));
  if (!fs.existsSync(file)) continue;
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (validateStrategySearchMatrixChunk(value, manifest, job)) chunks.set(job.slot, value); }
  catch { /* Invalid runtime chunks are replaced atomically. */ }
}
const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
  { kingdom }, ['--import', 'tsx']);
try {
  const missing = jobs.filter((job) => !chunks.has(job.slot));
  for (let start = 0; start < missing.length; start += jobsPerBatch) {
    if (Date.now() >= shutdownAtMs) throw new Error('strategy-search-matrix-shutdown-margin');
    const batch = missing.slice(start, start + jobsPerBatch), pairingJobs: PairingJob[] = [];
    for (const job of batch) {
      const row = manifest.strategies[job.rowIndex]!, column = manifest.strategies[job.columnIndex]!;
      for (const seed of job.seeds) pairingJobs.push({ candidate: row, opponent: column,
        options: { kingdomId: manifest.source.kingdomId, seeds: [seed], turnLimitPerPlayer: 30,
          actionCapPerTurn: 200, startingDraftEnabled: false, allowEarlyStop: false } });
    }
    const result = await runner.run(pairingJobs, { deadline: shutdownAtMs });
    if (result.submitted !== pairingJobs.length) throw new Error('strategy-search-matrix-shutdown-margin');
    let cursor = 0;
    for (const job of batch) {
      const records = job.seeds.map(() => { const outcome = result.outcomes[cursor++];
        if (!outcome || outcome.record.aborted || outcome.stopReason !== 'maximum'
          || outcome.matches !== GAMES_PER_SEED || outcome.blocks.length !== 1) throw new Error('Matrix pairing result is invalid.');
        return seedRecordFromOutcome(outcome.blocks[0]!, outcome.telemetry, outcome.matches,
          job.rowIndex === job.columnIndex ? 'diagonal-self-play-telemetry' : 'off-diagonal-payoff-and-telemetry'); });
      const chunk = createStrategySearchMatrixChunk({ manifest, job, records });
      writeAtomic(path.join(outputRoot, strategySearchMatrixChunkPath(job)), chunk); chunks.set(job.slot, chunk);
    }
    process.stdout.write(`${JSON.stringify({ type: 'strategy-search-checkpoint', stage: 'matrix',
      completedChunks: chunks.size, totalChunks: jobs.length })}\n`);
  }
} finally { await runner.close(); }
if (chunks.size !== jobs.length) throw new Error('Matrix runtime coverage is incomplete.');
const artifact = reduceStrategySearchMatrix({ manifest, chunks: jobs.map((job) => chunks.get(job.slot)!) });
const artifactFile = path.join(outputRoot, 'evidence.json'); writeAtomic(artifactFile, artifact);
const artifactHash = await import('node:crypto').then(({ createHash }) =>
  createHash('sha256').update(fs.readFileSync(artifactFile)).digest('hex'));
const marker = createCampaignStageControlMarker({ stage: 'matrix', evidenceId: manifest.source.evidenceId,
  status: 'complete', artifactHashes: { 'output/evidence.json': artifactHash } });
writeAtomic(path.join(controlRoot, 'complete.json'), marker);
process.stdout.write(`${JSON.stringify({ type: 'strategy-search-stage-stop', stage: 'matrix', status: 'complete',
  markerHash: marker.markerHash, evidenceHash: artifact.evidenceHash })}\n`);
