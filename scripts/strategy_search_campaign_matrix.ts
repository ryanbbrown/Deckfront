import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { GAMES_PER_SEED } from '../src/sim/pairing';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { PairingJob } from '../src/sim/pairingRunner';
import { seedRecordFromOutcome } from '../src/sim/initialMatrixCalibration';
import {
  createStrategySearchMatrixCommandTiming, createStrategySearchMatrixP75Source,
  executeStrategySearchMatrixBatches, reconcileStrategySearchMatrixResume,
  runStrategySearchMatrixPairingBatch, strategySearchMatrixChunkPath, strategySearchMatrixJobs,
  strategySearchMatrixTimingPath, validateStrategySearchMatrixBatchTiming,
  validateStrategySearchMatrixChunk, validateStrategySearchMatrixCommandTiming,
  validateStrategySearchMatrixManifest, validateStrategySearchMatrixP75Source
} from '../src/sim/strategySearchMatrix';
import type {
  StrategySearchMatrixBatchTiming, StrategySearchMatrixChunk, StrategySearchMatrixCommandTiming,
  StrategySearchMatrixJob, StrategySearchMatrixManifest
} from '../src/sim/strategySearchMatrix';
import {
  createCampaignStageControlMarker, validateCampaignMatrixStage
} from '../src/sim/strategySearchStages';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`), value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}
function integer(name: string): number {
  const value = Number(option(name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer.`);
  return value;
}
function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function sha256File(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file);
}
function preserveCorrupt(file: string): void {
  const relative = path.relative(outputRoot, file);
  if (relative.startsWith('..')) throw new Error(`Corrupt Matrix path escaped output root: ${file}`);
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const destination = path.join(controlRoot, 'corrupt', `${relative}.${digest}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) fs.unlinkSync(file); else fs.renameSync(file, destination);
}
function allFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  const visit = (directory: string): void => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Campaign Matrix output contains a symlink: ${file}`);
    if (entry.isDirectory()) visit(file); else result.push(file);
  } };
  visit(root); return result;
}
function jsonFiles(root: string): string[] { return allFiles(root).filter((file) => file.endsWith('.json')); }

const campaignRoot = path.resolve(option('campaign-root'));
function confined(file: string): string {
  const resolved = path.resolve(file);
  if (resolved === campaignRoot || !resolved.startsWith(`${campaignRoot}${path.sep}`)) {
    throw new Error(`Campaign Matrix path escapes its root: ${file}`);
  }
  return resolved;
}
const manifestFile = confined(option('manifest')), outputRoot = confined(option('out'));
const controlRoot = confined(option('control')), workers = integer('workers'), jobsPerBatch = integer('jobs-per-batch');
const shutdownAtMs = Number(option('shutdown-at-ms'));
if (!Number.isSafeInteger(shutdownAtMs) || shutdownAtMs <= Date.now() || outputRoot === controlRoot
  || outputRoot.startsWith(`${controlRoot}${path.sep}`) || controlRoot.startsWith(`${outputRoot}${path.sep}`)) {
  throw new Error('Campaign Matrix roots or shutdown margin are invalid.');
}
const manifest = readJson<unknown>(manifestFile);
if (!validateStrategySearchMatrixManifest(manifest)) throw new Error('Campaign Matrix manifest is invalid.');
const heldManifest: StrategySearchMatrixManifest = manifest;
const kingdom = strategySearchKingdom(heldManifest.source.kingdomId);
fs.mkdirSync(outputRoot, { recursive: true }); fs.mkdirSync(controlRoot, { recursive: true });
const savedManifest = path.join(outputRoot, 'manifest.json');
if (fs.existsSync(savedManifest)
  && !validateStrategySearchMatrixManifest(readJson<unknown>(savedManifest), heldManifest)) {
  preserveCorrupt(savedManifest);
}
writeAtomic(savedManifest, heldManifest);
const jobs = strategySearchMatrixJobs(heldManifest), chunks = new Map<number, StrategySearchMatrixChunk>();
const expectedChunks = new Set(jobs.map((job) => strategySearchMatrixChunkPath(job)));
for (const file of allFiles(outputRoot)) {
  const relative = path.relative(outputRoot, file).split(path.sep).join('/');
  const allowed = relative === 'manifest.json' || relative === 'p75.json' || expectedChunks.has(relative)
    || /^timing\/batch-[0-9a-f]{64}\.json$/.test(relative)
    || /^commands\/[0-9a-f]{64}\.json$/.test(relative);
  if (!allowed) preserveCorrupt(file);
}
for (const job of jobs) {
  const file = path.join(outputRoot, strategySearchMatrixChunkPath(job));
  if (!fs.existsSync(file)) continue;
  try {
    const chunk = readJson<unknown>(file);
    if (!validateStrategySearchMatrixChunk(chunk, heldManifest, job)) throw new Error('invalid chunk');
    chunks.set(job.slot, chunk);
  } catch { preserveCorrupt(file); }
}
let timings: StrategySearchMatrixBatchTiming[] = [];
const timingCovered = new Set<number>();
for (const file of jsonFiles(path.join(outputRoot, 'timing')).filter((entry) => path.basename(entry).startsWith('batch-'))) {
  let timing: unknown;
  try { timing = readJson<unknown>(file); } catch { preserveCorrupt(file); continue; }
  if (!timing || typeof timing !== 'object' || !Array.isArray((timing as { slots?: unknown }).slots)) {
    preserveCorrupt(file); continue;
  }
  const held = timing as StrategySearchMatrixBatchTiming, timingJobs = held.slots.map((slot) => jobs[slot]);
  const structurallyValid = !timingJobs.some((job) => !job)
    && validateStrategySearchMatrixBatchTiming(held, heldManifest,
      { batchIndex: held.batchIndex, jobs: timingJobs as StrategySearchMatrixJob[], workerCount: held.workerCount })
    && file === path.join(outputRoot, strategySearchMatrixTimingPath(held.batchIdentity));
  if (!structurallyValid || held.slots.some((slot) => !chunks.has(slot))) {
    preserveCorrupt(file);
    for (const slot of held.slots) {
      const job = jobs[slot], chunkFile = job && path.join(outputRoot, strategySearchMatrixChunkPath(job));
      if (chunkFile && fs.existsSync(chunkFile)) preserveCorrupt(chunkFile);
      chunks.delete(slot);
    }
    continue;
  }
  if (held.slots.some((slot) => timingCovered.has(slot))) { preserveCorrupt(file); continue; }
  held.slots.forEach((slot) => timingCovered.add(slot)); timings.push(held);
}
const reconciliation = reconcileStrategySearchMatrixResume({ manifest: heldManifest,
  chunks: [...chunks.values()], timings });
for (const slot of reconciliation.quarantineChunkSlots) {
  const file = path.join(outputRoot, strategySearchMatrixChunkPath(jobs[slot]!));
  if (fs.existsSync(file)) preserveCorrupt(file);
  chunks.delete(slot);
}
for (const digest of reconciliation.quarantineTimingHashes) {
  const timing = timings.find((entry) => entry.evidenceHash === digest);
  if (!timing) continue;
  const file = path.join(outputRoot, strategySearchMatrixTimingPath(timing.batchIdentity));
  if (fs.existsSync(file)) preserveCorrupt(file);
}
const acceptedTimingHashes = new Set(reconciliation.acceptedTimingHashes);
timings = timings.filter((timing) => acceptedTimingHashes.has(timing.evidenceHash));
const recoveryStarted = performance.now();
const commandTimings: StrategySearchMatrixCommandTiming[] = [], claimedTimingHashes = new Set<string>();
const availableTimingHashes = new Set(timings.map((timing) => timing.evidenceHash));
for (const file of jsonFiles(path.join(outputRoot, 'commands'))) {
  let timing: unknown;
  try { timing = readJson<unknown>(file); } catch { preserveCorrupt(file); continue; }
  if (!validateStrategySearchMatrixCommandTiming(timing, heldManifest)
    || timing.batchTimingHashes.some((digest) => !availableTimingHashes.has(digest)
      || claimedTimingHashes.has(digest))) {
    preserveCorrupt(file); continue;
  }
  timing.batchTimingHashes.forEach((digest) => claimedTimingHashes.add(digest));
  commandTimings.push(timing);
}
const orphanTimingHashes = timings.map((timing) => timing.evidenceHash)
  .filter((digest) => !claimedTimingHashes.has(digest));
if (orphanTimingHashes.length) {
  const recovered = createStrategySearchMatrixCommandTiming({ manifest: heldManifest, workerCount: workers,
    commandWallMs: performance.now() - recoveryStarted, batchTimingHashes: orphanTimingHashes });
  writeAtomic(path.join(outputRoot, 'commands', `${recovered.evidenceHash}.json`), recovered);
  commandTimings.push(recovered);
}
const missing = jobs.filter((job) => !chunks.has(job.slot));
const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
  { kingdom }, ['--import', 'tsx']);
const started = performance.now(), commandTimingHashes: string[] = [];
let stopReason: string | null = null;
try {
  if (missing.length) {
    const output = await executeStrategySearchMatrixBatches({ manifest: heldManifest, jobs: missing,
      jobsPerBatch, workerCount: workers, async runBatch(batch) {
        if (Date.now() >= shutdownAtMs) throw new Error('campaign-matrix-shutdown-margin');
        const pairingJobs: PairingJob[] = [];
        for (const job of batch) {
          const row = heldManifest.strategies[job.rowIndex]!, column = heldManifest.strategies[job.columnIndex]!;
          for (const seed of job.seeds) pairingJobs.push({ candidate: row, opponent: column,
            options: { kingdomId: heldManifest.source.kingdomId, seeds: [seed], turnLimitPerPlayer: 30,
              actionCapPerTurn: 200, startingDraftEnabled: false, allowEarlyStop: false } });
        }
        const batchResult = await runStrategySearchMatrixPairingBatch(runner, pairingJobs, shutdownAtMs);
        const outcomes = batchResult.outcomes; let cursor = 0;
        return batch.map((job) => ({ slot: job.slot, records: job.seeds.map((_seed) => {
          const outcome = outcomes[cursor++];
          if (!outcome || outcome.record.aborted !== 0 || outcome.stopReason !== 'maximum'
            || outcome.seedsEvaluated !== 1 || outcome.matches !== GAMES_PER_SEED || outcome.blocks.length !== 1) {
            throw new Error(`Campaign Matrix slot ${job.slot} returned invalid evidence.`);
          }
          const purpose = job.rowIndex === job.columnIndex
            ? 'diagonal-self-play-telemetry' : 'off-diagonal-payoff-and-telemetry';
          return seedRecordFromOutcome(outcome.blocks[0]!, outcome.telemetry, outcome.matches, purpose);
        }) }));
      }, checkpoint(event, batchChunks, timing) {
        for (const chunk of batchChunks) {
          const job = jobs[chunk.slot]!; writeAtomic(path.join(outputRoot, strategySearchMatrixChunkPath(job)), chunk);
          chunks.set(chunk.slot, chunk);
        }
        writeAtomic(path.join(outputRoot, strategySearchMatrixTimingPath(timing.batchIdentity)), timing);
        timings.push(timing); commandTimingHashes.push(timing.evidenceHash);
        process.stdout.write(`${JSON.stringify(event)}\n`);
      } });
    const command = output.commandTiming; writeAtomic(path.join(outputRoot, 'commands', `${command.evidenceHash}.json`), command);
    commandTimings.push(command);
  }
} catch (error) {
  stopReason = error instanceof Error ? error.message : String(error);
  if (commandTimingHashes.length) {
    const command = createStrategySearchMatrixCommandTiming({ manifest: heldManifest, workerCount: workers,
      commandWallMs: performance.now() - started, batchTimingHashes: commandTimingHashes });
    writeAtomic(path.join(outputRoot, 'commands', `${command.evidenceHash}.json`), command); commandTimings.push(command);
  }
} finally { await runner.close(); }
if (stopReason) {
  const available: Record<string, string> = { 'output/manifest.json': sha256File(savedManifest) };
  for (const chunk of chunks.values()) {
    const relative = strategySearchMatrixChunkPath(jobs[chunk.slot]!);
    available[`output/${relative}`] = sha256File(path.join(outputRoot, relative));
  }
  for (const timing of timings) {
    const relative = strategySearchMatrixTimingPath(timing.batchIdentity);
    available[`output/${relative}`] = sha256File(path.join(outputRoot, relative));
  }
  for (const timing of commandTimings) {
    const relative = `commands/${timing.evidenceHash}.json`;
    available[`output/${relative}`] = sha256File(path.join(outputRoot, relative));
  }
  const marker = createCampaignStageControlMarker({ stage: 'matrix', stageId: heldManifest.stageId,
    status: 'incomplete', artifactHashes: available, reason: stopReason });
  writeAtomic(path.join(controlRoot, 'incomplete.json'), marker);
  process.stdout.write(`${JSON.stringify({ type: 'strategy-search-stage-stop', stage: 'matrix',
    status: 'incomplete', markerHash: marker.markerHash })}\n`);
  process.exitCode = 2;
} else {
  if (chunks.size !== jobs.length) throw new Error('Campaign Matrix ended without exact chunk coverage.');
  const p75Chunks = jobs.filter((job) => job.startSeedIndex < 75).map((job) => chunks.get(job.slot)!);
  const p75File = path.join(outputRoot, 'p75.json');
  if (fs.existsSync(p75File) && !validateStrategySearchMatrixP75Source(readJson<unknown>(p75File),
    heldManifest, p75Chunks)) preserveCorrupt(p75File);
  const p75 = createStrategySearchMatrixP75Source(heldManifest, p75Chunks);
  writeAtomic(p75File, p75);
  const artifactHashes: Record<string, string> = { 'output/manifest.json': sha256File(savedManifest),
    'output/p75.json': sha256File(p75File) };
  for (const chunk of chunks.values()) {
    const relative = strategySearchMatrixChunkPath(jobs[chunk.slot]!);
    artifactHashes[`output/${relative}`] = sha256File(path.join(outputRoot, relative));
  }
  for (const timing of timings) {
    const relative = strategySearchMatrixTimingPath(timing.batchIdentity);
    artifactHashes[`output/${relative}`] = sha256File(path.join(outputRoot, relative));
  }
  for (const timing of commandTimings) {
    const relative = `commands/${timing.evidenceHash}.json`;
    artifactHashes[`output/${relative}`] = sha256File(path.join(outputRoot, relative));
  }
  const marker = createCampaignStageControlMarker({ stage: 'matrix', stageId: heldManifest.stageId,
    status: 'complete', artifactHashes });
  if (!validateCampaignMatrixStage({ stageId: heldManifest.stageId, manifest: heldManifest,
    chunks: [...chunks.values()], timings, commandTimings, p75, fileHashes: artifactHashes, marker })) {
    throw new Error('Campaign Matrix deep validation failed before completion.');
  }
  writeAtomic(path.join(controlRoot, 'complete.json'), marker);
  process.stdout.write(`${JSON.stringify({ type: 'strategy-search-stage-stop', stage: 'matrix',
    status: 'complete', markerHash: marker.markerHash })}\n`);
}
