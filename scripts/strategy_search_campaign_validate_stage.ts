import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateCampaignGoldfishStage, validateCampaignMatrixStage, validateCampaignPsroStage,
  validateCampaignStageControlMarker
} from '../src/sim/strategySearchStages';
import {
  strategySearchMatrixJobs, strategySearchMatrixChunkPath, validateStrategySearchMatrixManifest
} from '../src/sim/strategySearchMatrix';
import type {
  StrategySearchMatrixBatchTiming, StrategySearchMatrixChunk, StrategySearchMatrixCommandTiming
} from '../src/sim/strategySearchMatrix';
import type { OrderedProductRankedArtifact, OrderedProductReservoirArtifact } from '../src/sim/orderedGoldfishProduct';
import type { RawPsroLookArtifact, RawPsroScoreChunk } from '../src/sim/thresholdRacingPsro';

interface Request { campaignRoot: string; stage: 'goldfish' | 'matrix' | 'psro'; stageId: string;
  stageRoot: string; expectedStatus: 'complete' | 'incomplete' | 'terminal-incomplete' }
const request = JSON.parse(fs.readFileSync(0, 'utf8')) as Request;
const root = path.resolve(request.campaignRoot);
function confined(relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\')
    || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Campaign validation path is invalid: ${relative}`);
  }
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Campaign validation path escapes: ${relative}`);
  return resolved;
}
function rejectSymlinks(directory: string): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Campaign validation found a symlink: ${file}`);
    if (entry.isDirectory()) rejectSymlinks(file);
  }
}
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function sha(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function verifyIndexedFiles(marker: { artifactHashes: Record<string, string> }, stageRoot: string): void {
  for (const [relative, digest] of Object.entries(marker.artifactHashes)) {
    if (!relative.startsWith('output/')) throw new Error(`Stage marker path is outside output: ${relative}`);
    const file = path.join(stageRoot, relative);
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || sha(file) !== digest) throw new Error(`Stage marker file differs: ${relative}`);
  }
}
if (!/^[0-9a-f]{64}$/.test(request.stageId)) throw new Error('Campaign validation stage ID is invalid.');
const stageRoot = confined(request.stageRoot); rejectSymlinks(stageRoot);
const markerFile = path.join(stageRoot, 'control', `${request.expectedStatus}.json`);
const marker = read<unknown>(markerFile);
if (!validateCampaignStageControlMarker(marker) || marker.stage !== request.stage || marker.stageId !== request.stageId
  || marker.status !== request.expectedStatus) throw new Error('Campaign stage marker is invalid.');
verifyIndexedFiles(marker, stageRoot);
const validatedMarker = marker;
function compactResult(): Record<string, unknown> {
  const entries = Object.entries(validatedMarker.artifactHashes).sort(([left], [right]) => left < right ? -1 : 1);
  return { status: request.expectedStatus, ...(validatedMarker.reason ? { reason: validatedMarker.reason } : {}),
    markerHash: validatedMarker.markerHash, artifactCount: entries.length,
    artifactSetHash: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
if (request.expectedStatus !== 'complete') {
  process.stdout.write(`${JSON.stringify(compactResult())}\n`);
  process.exit(0);
}
if (request.stage === 'goldfish') {
  const rankedFile = path.join(stageRoot, 'output', 'ranked.json'), manifest = read<Record<string, unknown>>(rankedFile);
  const parts = manifest.parts as Array<{ file: string; sha256: string; count: number }>;
  if (!Array.isArray(parts)) throw new Error('Campaign ranked parts are missing.');
  const records: unknown[] = [];
  for (const part of parts) {
    const file = path.resolve(path.dirname(rankedFile), part.file);
    if (!file.startsWith(`${path.dirname(rankedFile)}${path.sep}`)
      || fs.lstatSync(file).isSymbolicLink() || sha(file) !== part.sha256) {
      throw new Error(`Campaign ranked part is stale: ${part.file}`);
    }
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length !== part.count) throw new Error(`Campaign ranked part count differs: ${part.file}`);
    records.push(...lines.map((line) => JSON.parse(line) as unknown));
  }
  const ranked = { ...manifest, records } as unknown as OrderedProductRankedArtifact;
  const reservoirFile = path.join(stageRoot, 'output', 'reservoir.json');
  const rankedSidecarFile = `${rankedFile}.sha256`, reservoirSidecarFile = `${reservoirFile}.sha256`;
  const reservoir = read<OrderedProductReservoirArtifact>(reservoirFile);
  if (!validateCampaignGoldfishStage({ stageId: request.stageId, ranked, rankedSha256: sha(rankedFile),
    rankedSidecarContent: fs.readFileSync(rankedSidecarFile, 'utf8'), reservoir,
    reservoirSha256: sha(reservoirFile), reservoirSidecarContent: fs.readFileSync(reservoirSidecarFile, 'utf8'),
    fileHashes: marker.artifactHashes, marker })) throw new Error('Goldfish deep stage validation failed.');
} else if (request.stage === 'matrix') {
  const output = path.join(stageRoot, 'output'), manifest = read<unknown>(path.join(output, 'manifest.json'));
  if (!validateStrategySearchMatrixManifest(manifest)) throw new Error('Matrix manifest is invalid.');
  const chunks: StrategySearchMatrixChunk[] = [];
  for (const job of strategySearchMatrixJobs(manifest)) chunks.push(read(path.join(output,
    strategySearchMatrixChunkPath(job))));
  const timings = fs.readdirSync(path.join(output, 'timing')).filter((name) => name.endsWith('.json'))
    .map((name) => read<StrategySearchMatrixBatchTiming>(path.join(output, 'timing', name)));
  const commandTimings = fs.readdirSync(path.join(output, 'commands')).filter((name) => name.endsWith('.json'))
    .map((name) => read<StrategySearchMatrixCommandTiming>(path.join(output, 'commands', name)));
  if (!validateCampaignMatrixStage({ stageId: request.stageId, manifest, chunks, timings, commandTimings,
    p75: read(path.join(output, 'p75.json')), fileHashes: marker.artifactHashes, marker })) {
    throw new Error('Matrix deep stage validation failed.');
  }
} else {
  const output = path.join(stageRoot, 'output'), protocol = read<{ runId: string }>(path.join(output, 'protocol.json'));
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(protocol.runId)) throw new Error('Campaign PSRO run ID is invalid.');
  const runRoot = path.resolve(output, `run-${protocol.runId}`);
  if (!runRoot.startsWith(`${path.resolve(output)}${path.sep}`)) throw new Error('Campaign PSRO run path escapes output.');
  const chunks: RawPsroScoreChunk[] = [], looks: RawPsroLookArtifact[] = [];
  const visit = (directory: string, target: unknown[]): void => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Campaign validation found a symlink: ${file}`);
      if (entry.isDirectory()) visit(file, target); else if (entry.name.endsWith('.json')) target.push(read(file));
    }
  };
  visit(path.join(runRoot, 'raw', 'chunks'), chunks); visit(path.join(runRoot, 'raw', 'looks'), looks);
  const checkpointFile = path.join(runRoot, 'checkpoint.json'), reportFile = path.join(runRoot, 'report.json');
  if (!validateCampaignPsroStage({ stageId: request.stageId, protocol, chunks, looks,
    checkpoint: read(checkpointFile), report: read(reportFile), checkpointSha256: sha(checkpointFile),
    reportSha256: sha(reportFile), closure: read(path.join(runRoot, 'closure.json')),
    fileHashes: marker.artifactHashes, marker })) throw new Error('PSRO deep stage validation failed.');
}
process.stdout.write(`${JSON.stringify(compactResult())}\n`);
