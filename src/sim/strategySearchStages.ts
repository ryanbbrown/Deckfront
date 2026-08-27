import { createHash } from 'node:crypto';
import {
  validateOrderedProductArtifact, validateOrderedProductReservoir
} from './orderedGoldfishProduct';
import type {
  OrderedProductRankedArtifact, OrderedProductReservoirArtifact
} from './orderedGoldfishProduct';
import {
  strategySearchMatrixChunkPath, strategySearchMatrixJobs, validateStrategySearchMatrixBatchTiming,
  validateStrategySearchMatrixChunk, validateStrategySearchMatrixCommandTiming,
  validateStrategySearchMatrixManifest, validateStrategySearchMatrixP75Source
} from './strategySearchMatrix';
import type {
  StrategySearchMatrixBatchTiming, StrategySearchMatrixChunk, StrategySearchMatrixCommandTiming,
  StrategySearchMatrixManifest, StrategySearchMatrixP75Source
} from './strategySearchMatrix';
import {
  assembleRawPsroLook, thresholdRacingProtocolHash, validateRawPsroLookArtifact,
  validateRawPsroScoreChunk, validateThresholdRacingProtocol
} from './thresholdRacingPsro';
import type {
  RawPsroLookArtifact, RawPsroScoreChunk, ThresholdRacingProtocol
} from './thresholdRacingPsro';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value);
const exact = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const exactKeys = (value: object, keys: readonly string[]): boolean =>
  exact(Object.keys(value).sort(), [...keys].sort());
function sealed<T extends { markerHash: string }>(value: T): string {
  const copy = structuredClone(value); copy.markerHash = ''; return hash(copy);
}

export type CampaignStageKind = 'goldfish' | 'matrix' | 'psro';
export type CampaignStageCompleteness = 'complete' | 'incomplete' | 'terminal-incomplete';
export interface CampaignStageControlMarker {
  schemaVersion: 1; experiment: 'strategy-search-campaign-stage-control'; stage: CampaignStageKind;
  stageId: string; status: CampaignStageCompleteness; artifactHashes: Record<string, string>;
  reason?: string; markerHash: string;
}
export function campaignStageOutputRoot(stageRoot: string): string {
  if (!stageRoot || stageRoot.includes('\\') || stageRoot.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Campaign stage root is invalid.');
  }
  return `${stageRoot}/output`;
}
export function campaignStageControlPath(stageRoot: string, status: CampaignStageCompleteness): string {
  campaignStageOutputRoot(stageRoot);
  if (!['complete', 'incomplete', 'terminal-incomplete'].includes(status)) {
    throw new Error('Campaign stage completeness is invalid.');
  }
  return `${stageRoot}/control/${status}.json`;
}
export function createCampaignStageControlMarker(input: {
  stage: CampaignStageKind; stageId: string; status: CampaignStageCompleteness;
  artifactHashes: Readonly<Record<string, string>>; reason?: string;
}): CampaignStageControlMarker {
  if (!['goldfish', 'matrix', 'psro'].includes(input.stage) || !sha(input.stageId)
    || !object(input.artifactHashes) || !Object.keys(input.artifactHashes).length
    || Object.keys(input.artifactHashes).some((path) => !path || path.startsWith('/') || path.includes('\\')
      || path.split('/').some((part) => !part || part === '.' || part === '..'))
    || Object.values(input.artifactHashes).some((digest) => !sha(digest))
    || input.status === 'complete' && input.reason !== undefined
    || input.status !== 'complete' && !input.reason) {
    throw new Error('Campaign stage control marker input is invalid.');
  }
  const base = { schemaVersion: 1 as const, experiment: 'strategy-search-campaign-stage-control' as const,
    stage: input.stage, stageId: input.stageId, status: input.status,
    artifactHashes: Object.fromEntries(Object.entries(input.artifactHashes).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0)), ...(input.reason === undefined ? {} : { reason: input.reason }),
    markerHash: '' };
  return { ...base, markerHash: sealed(base) };
}
export function validateCampaignStageControlMarker(value: unknown,
  expected?: CampaignStageControlMarker): value is CampaignStageControlMarker {
  if (!object(value)) return false;
  const status = value.status;
  const keys = status === 'complete'
    ? ['schemaVersion', 'experiment', 'stage', 'stageId', 'status', 'artifactHashes', 'markerHash']
    : ['schemaVersion', 'experiment', 'stage', 'stageId', 'status', 'artifactHashes', 'reason', 'markerHash'];
  if (!exactKeys(value, keys)) return false;
  try {
    const held = value as unknown as CampaignStageControlMarker;
    const rebuilt = createCampaignStageControlMarker({ stage: held.stage, stageId: held.stageId,
      status: held.status, artifactHashes: held.artifactHashes, ...(held.reason === undefined ? {} : { reason: held.reason }) });
    return exact(held, rebuilt) && (!expected || exact(held, expected));
  } catch { return false; }
}

export function validateCampaignGoldfishStage(input: {
  stageId: string; ranked: unknown; rankedSha256: string; reservoir: unknown; reservoirSha256: string;
  marker: unknown;
}): input is typeof input & { ranked: OrderedProductRankedArtifact;
  reservoir: OrderedProductReservoirArtifact; marker: CampaignStageControlMarker } {
  if (!sha(input.stageId) || !sha(input.rankedSha256) || !sha(input.reservoirSha256)
    || !validateOrderedProductArtifact(input.ranked)) return false;
  const ranked = input.ranked;
  if (!validateOrderedProductReservoir(input.reservoir, ranked, input.rankedSha256)) return false;
  const expected = createCampaignStageControlMarker({ stage: 'goldfish', stageId: input.stageId,
    status: 'complete', artifactHashes: { 'output/ranked.json': input.rankedSha256,
      'output/reservoir.json': input.reservoirSha256 } });
  return validateCampaignStageControlMarker(input.marker, expected);
}

export function validateCampaignMatrixStage(input: {
  stageId: string; manifest: unknown; chunks: readonly unknown[]; timings: readonly unknown[];
  commandTimings: readonly unknown[]; p75: unknown; marker: unknown;
}): input is typeof input & { manifest: StrategySearchMatrixManifest; chunks: StrategySearchMatrixChunk[];
  timings: StrategySearchMatrixBatchTiming[]; commandTimings: StrategySearchMatrixCommandTiming[];
  p75: StrategySearchMatrixP75Source; marker: CampaignStageControlMarker } {
  if (!sha(input.stageId) || !validateStrategySearchMatrixManifest(input.manifest)
    || input.manifest.stageId !== input.stageId) return false;
  const manifest = input.manifest, jobs = strategySearchMatrixJobs(manifest);
  if (input.chunks.length !== jobs.length || input.timings.length < 1 || input.commandTimings.length < 1) return false;
  const chunksBySlot = new Map<number, StrategySearchMatrixChunk>();
  for (const value of input.chunks) {
    if (!object(value) || !Number.isSafeInteger(value.slot) || chunksBySlot.has(value.slot as number)) return false;
    const job = jobs[value.slot as number];
    if (!job || !validateStrategySearchMatrixChunk(value, manifest, job)) return false;
    chunksBySlot.set(job.slot, value);
  }
  if (chunksBySlot.size !== jobs.length) return false;
  const timingHashes = new Set<string>(), coveredSlots = new Set<number>();
  for (const value of input.timings) {
    if (!object(value) || !Array.isArray(value.slots) || !Number.isSafeInteger(value.batchIndex)
      || !Number.isSafeInteger(value.workerCount)) return false;
    const timingJobs = value.slots.map((slot) => jobs[Number(slot)])
      .filter((job): job is NonNullable<typeof job> => job !== undefined);
    if (timingJobs.length !== value.slots.length || !validateStrategySearchMatrixBatchTiming(value, manifest,
      { batchIndex: value.batchIndex as number, jobs: timingJobs, workerCount: value.workerCount as number })
      || timingHashes.has(value.evidenceHash as string)) return false;
    timingHashes.add(value.evidenceHash as string);
    for (const slot of value.slots) {
      if (coveredSlots.has(Number(slot))) return false;
      coveredSlots.add(Number(slot));
    }
  }
  if (coveredSlots.size !== jobs.length) return false;
  const commandHashes: string[] = [];
  for (const value of input.commandTimings) {
    if (!validateStrategySearchMatrixCommandTiming(value, manifest)) return false;
    commandHashes.push(...value.batchTimingHashes);
  }
  if (!exact([...commandHashes].sort(), [...timingHashes].sort())
    || !validateStrategySearchMatrixP75Source(input.p75, manifest,
      jobs.filter((job) => job.startSeedIndex < 75).map((job) => chunksBySlot.get(job.slot)!))) return false;
  const artifactHashes: Record<string, string> = {
    'output/manifest.json': manifest.evidenceHash, 'output/p75.json': input.p75.evidenceHash
  };
  for (const chunk of chunksBySlot.values()) {
    artifactHashes[`output/${strategySearchMatrixChunkPath(jobs[chunk.slot]!)}`] = chunk.evidenceHash;
  }
  for (const timing of input.timings as StrategySearchMatrixBatchTiming[]) {
    artifactHashes[`output/timing/batch-${timing.batchIdentity}.json`] = timing.evidenceHash;
  }
  for (const timing of input.commandTimings as StrategySearchMatrixCommandTiming[]) {
    artifactHashes[`output/commands/${timing.evidenceHash}.json`] = timing.evidenceHash;
  }
  const expected = createCampaignStageControlMarker({ stage: 'matrix', stageId: input.stageId,
    status: 'complete', artifactHashes });
  return validateCampaignStageControlMarker(input.marker, expected);
}

const PSRO_CLOSURE_KEYS = ['schemaVersion', 'experiment', 'stageId', 'protocolHash', 'sourceHash',
  'status', 'cleanScans', 'admissions', 'matrixHash', 'reason', 'artifactHash'] as const;
export interface CampaignPsroClosure {
  schemaVersion: 1; experiment: 'strategy-search-campaign-psro-closure'; stageId: string;
  protocolHash: string; sourceHash: string; status: CampaignStageCompleteness; cleanScans: number;
  admissions: number; matrixHash: string; reason: string | null; artifactHash: string;
}
export function createCampaignPsroClosure(input: Omit<CampaignPsroClosure,
  'schemaVersion' | 'experiment' | 'artifactHash'>): CampaignPsroClosure {
  if (!sha(input.stageId) || !sha(input.protocolHash) || !sha(input.sourceHash) || !sha(input.matrixHash)
    || !Number.isSafeInteger(input.cleanScans) || input.cleanScans < 0
    || !Number.isSafeInteger(input.admissions) || input.admissions < 0
    || input.status === 'complete' && (input.cleanScans < 2 || input.reason !== null)
    || input.status !== 'complete' && !input.reason) throw new Error('Campaign PSRO closure input is invalid.');
  const base = { schemaVersion: 1 as const, experiment: 'strategy-search-campaign-psro-closure' as const,
    ...input, artifactHash: '' };
  return { ...base, artifactHash: hash(base) };
}
export function validateCampaignPsroClosure(value: unknown, protocol: ThresholdRacingProtocol,
  stageId: string): value is CampaignPsroClosure {
  if (!object(value) || !exactKeys(value, PSRO_CLOSURE_KEYS)) return false;
  try {
    const held = value as unknown as CampaignPsroClosure;
    return held.stageId === stageId && held.protocolHash === thresholdRacingProtocolHash(protocol)
      && held.sourceHash === protocol.sourceIdentityHash && exact(held, createCampaignPsroClosure({
        stageId: held.stageId, protocolHash: held.protocolHash, sourceHash: held.sourceHash,
        status: held.status, cleanScans: held.cleanScans, admissions: held.admissions,
        matrixHash: held.matrixHash, reason: held.reason }));
  } catch { return false; }
}
export function validateCampaignPsroStage(input: {
  stageId: string; protocol: unknown; chunks: readonly unknown[]; looks: readonly unknown[];
  closure: unknown; marker: unknown;
}): boolean {
  if (!sha(input.stageId) || !validateThresholdRacingProtocol(input.protocol)
    || !validateCampaignPsroClosure(input.closure, input.protocol, input.stageId)) return false;
  const protocol = input.protocol, chunks = input.chunks as RawPsroScoreChunk[], looks = input.looks as RawPsroLookArtifact[];
  const byHash = new Map<string, RawPsroScoreChunk>();
  for (const chunk of chunks) {
    if (!validateRawPsroScoreChunk(chunk, protocol) || byHash.has(chunk.artifactHash)) return false;
    byHash.set(chunk.artifactHash, chunk);
  }
  const used = new Set<string>();
  for (const look of looks) {
    if (!validateRawPsroLookArtifact(look, protocol)) return false;
    const held = look.chunks.map((reference) => byHash.get(reference.artifactHash));
    if (held.some((chunk) => !chunk)) return false;
    try { assembleRawPsroLook(look, held as RawPsroScoreChunk[], protocol); } catch { return false; }
    for (const reference of look.chunks) {
      if (used.has(reference.artifactHash)) return false;
      used.add(reference.artifactHash);
    }
  }
  if (used.size !== chunks.length) return false;
  const artifactHashes: Record<string, string> = {
    'output/protocol.json': thresholdRacingProtocolHash(protocol),
    [`output/run-${protocol.runId}/closure.json`]: input.closure.artifactHash
  };
  for (const chunk of chunks) {
    artifactHashes[`output/run-${protocol.runId}/raw/chunks/${chunk.lookId}`
      + `/${chunk.candidateStart}-${chunk.candidateEnd}.json`] = chunk.artifactHash;
  }
  for (const look of looks) {
    artifactHashes[`output/run-${protocol.runId}/raw/looks/${look.lookId}.json`] = look.artifactHash;
  }
  const expected = createCampaignStageControlMarker({ stage: 'psro', stageId: input.stageId,
    status: input.closure.status, artifactHashes,
    ...(input.closure.reason === null ? {} : { reason: input.closure.reason }) });
  return validateCampaignStageControlMarker(input.marker, expected);
}
