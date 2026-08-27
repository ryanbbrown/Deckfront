import { createHash } from 'node:crypto';
import {
  ORDERED_PRODUCT_GENERATOR, ORDERED_PRODUCT_TRAVERSAL, validateOrderedProductArtifact,
  validateOrderedProductReservoir
} from './orderedGoldfishProduct';
import { NATIVE_GOLDFISH_SCORER_VERSION } from './nativeGoldfishProtocol';
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
  stageId: string; ranked: unknown; rankedSha256: string; rankedSidecarContent: string;
  reservoir: unknown; reservoirSha256: string; reservoirSidecarContent: string;
  fileHashes: Readonly<Record<string, string>>; marker: unknown;
}): input is typeof input & { ranked: OrderedProductRankedArtifact;
  reservoir: OrderedProductReservoirArtifact; marker: CampaignStageControlMarker } {
  if (!sha(input.stageId) || !sha(input.rankedSha256) || !sha(input.reservoirSha256)
    || !validateOrderedProductArtifact(input.ranked)) return false;
  const ranked = input.ranked;
  if (ranked.scorerVersion !== NATIVE_GOLDFISH_SCORER_VERSION
    || ranked.candidateSpace.generator !== ORDERED_PRODUCT_GENERATOR
    || ranked.candidateSpace.traversal !== ORDERED_PRODUCT_TRAVERSAL
    || !validateOrderedProductReservoir(input.reservoir, ranked, input.rankedSha256)) return false;
  const rankedSidecar = `${input.rankedSha256}  ranked.json\n`;
  const reservoirSidecar = `${input.reservoirSha256}  reservoir.json\n`;
  const expectedPaths = new Set(['output/ranked.json', 'output/ranked.json.sha256',
    'output/reservoir.json', 'output/reservoir.json.sha256']);
  const parts = (ranked as OrderedProductRankedArtifact & { parts?: unknown }).parts;
  if (parts !== undefined) {
    if (!Array.isArray(parts)) return false;
    for (const part of parts) {
      if (!object(part) || typeof part.file !== 'string' || !sha(part.sha256)
        || input.fileHashes[`output/${part.file}`] !== part.sha256) return false;
      expectedPaths.add(`output/${part.file}`);
    }
  }
  if (input.rankedSidecarContent !== rankedSidecar || input.reservoirSidecarContent !== reservoirSidecar
    || input.fileHashes['output/ranked.json'] !== input.rankedSha256
    || input.fileHashes['output/ranked.json.sha256'] !== createHash('sha256').update(rankedSidecar).digest('hex')
    || input.fileHashes['output/reservoir.json'] !== input.reservoirSha256
    || input.fileHashes['output/reservoir.json.sha256'] !== createHash('sha256').update(reservoirSidecar).digest('hex')
    || !exact(Object.keys(input.fileHashes).sort(), [...expectedPaths].sort())
    || Object.values(input.fileHashes).some((digest) => !sha(digest))) return false;
  const expected = createCampaignStageControlMarker({ stage: 'goldfish', stageId: input.stageId,
    status: 'complete', artifactHashes: input.fileHashes });
  return validateCampaignStageControlMarker(input.marker, expected);
}

export function validateCampaignMatrixStage(input: {
  stageId: string; manifest: unknown; chunks: readonly unknown[]; timings: readonly unknown[];
  commandTimings: readonly unknown[]; p75: unknown; fileHashes: Readonly<Record<string, string>>;
  marker: unknown;
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
  const expectedPaths = new Set(['output/manifest.json', 'output/p75.json']);
  for (const chunk of chunksBySlot.values()) {
    expectedPaths.add(`output/${strategySearchMatrixChunkPath(jobs[chunk.slot]!)}`);
  }
  for (const timing of input.timings as StrategySearchMatrixBatchTiming[]) {
    expectedPaths.add(`output/timing/batch-${timing.batchIdentity}.json`);
  }
  for (const timing of input.commandTimings as StrategySearchMatrixCommandTiming[]) {
    expectedPaths.add(`output/commands/${timing.evidenceHash}.json`);
  }
  if (!exact(Object.keys(input.fileHashes).sort(), [...expectedPaths].sort())
    || Object.values(input.fileHashes).some((digest) => !sha(digest))) return false;
  const expected = createCampaignStageControlMarker({ stage: 'matrix', stageId: input.stageId,
    status: 'complete', artifactHashes: input.fileHashes });
  return validateCampaignStageControlMarker(input.marker, expected);
}

const PSRO_CLOSURE_KEYS = ['schemaVersion', 'experiment', 'stageId', 'protocolHash', 'sourceHash',
  'status', 'cleanScans', 'admissions', 'matrixHash', 'checkpointHash', 'reportHash', 'reason',
  'artifactHash'] as const;
export interface CampaignPsroClosure {
  schemaVersion: 1; experiment: 'strategy-search-campaign-psro-closure'; stageId: string;
  protocolHash: string; sourceHash: string; status: CampaignStageCompleteness; cleanScans: number;
  admissions: number; matrixHash: string; checkpointHash: string; reportHash: string;
  reason: string | null; artifactHash: string;
}
export function createCampaignPsroClosure(input: Omit<CampaignPsroClosure,
  'schemaVersion' | 'experiment' | 'artifactHash'>): CampaignPsroClosure {
  if (!sha(input.stageId) || !sha(input.protocolHash) || !sha(input.sourceHash) || !sha(input.matrixHash)
    || !sha(input.checkpointHash) || !sha(input.reportHash)
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
        matrixHash: held.matrixHash, checkpointHash: held.checkpointHash, reportHash: held.reportHash,
        reason: held.reason }));
  } catch { return false; }
}
export function validateCampaignPsroStage(input: {
  stageId: string; protocol: unknown; chunks: readonly unknown[]; looks: readonly unknown[];
  checkpoint: unknown; report: unknown; checkpointSha256: string; reportSha256: string;
  closure: unknown; fileHashes: Readonly<Record<string, string>>; marker: unknown;
}): boolean {
  if (!sha(input.stageId) || !validateThresholdRacingProtocol(input.protocol)
    || !validateCampaignPsroClosure(input.closure, input.protocol, input.stageId)
    || !sha(input.checkpointSha256) || !sha(input.reportSha256)
    || input.closure.checkpointHash !== input.checkpointSha256
    || input.closure.reportHash !== input.reportSha256 || !exact(input.checkpoint, input.report)
    || !object(input.checkpoint)) return false;
  const checkpoint = input.checkpoint as Record<string, unknown>;
  const checkpointUnsigned = structuredClone(checkpoint); checkpointUnsigned.evidenceHash = '';
  if (!sha(checkpoint.evidenceHash) || checkpoint.evidenceHash !== hash(checkpointUnsigned)
    || !object(checkpoint.matrix) || input.closure.matrixHash !== hash(checkpoint.matrix)
    || checkpoint.runId !== input.protocol.runId || checkpoint.version !== input.protocol.protocolVersion
    || checkpoint.experiment !== input.protocol.experimentName
    || checkpoint.cleanScans !== input.closure.cleanScans
    || !Array.isArray(checkpoint.admissions) || checkpoint.admissions.length !== input.closure.admissions
    || (input.closure.status === 'complete' ? checkpoint.status !== 'complete' : checkpoint.status !== 'unresolved')) {
    return false;
  }
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
  const referencedLooks = new Set<string>();
  const collectRawLooks = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(collectRawLooks);
    else if (object(value)) {
      if (object(value.rawLook) && sha(value.rawLook.artifactHash)) {
        referencedLooks.add(value.rawLook.artifactHash as string);
      }
      Object.values(value).forEach(collectRawLooks);
    }
  };
  collectRawLooks(checkpoint);
  if (!exact([...referencedLooks].sort(), looks.map((look) => look.artifactHash).sort())) return false;
  const expectedPaths = new Set(['output/protocol.json', `output/run-${protocol.runId}/closure.json`,
    `output/run-${protocol.runId}/checkpoint.json`, `output/run-${protocol.runId}/report.json`]);
  for (const chunk of chunks) expectedPaths.add(`output/run-${protocol.runId}/raw/chunks/${chunk.lookId}`
    + `/${chunk.candidateStart}-${chunk.candidateEnd}.json`);
  for (const look of looks) expectedPaths.add(`output/run-${protocol.runId}/raw/looks/${look.lookId}.json`);
  if (!exact(Object.keys(input.fileHashes).sort(), [...expectedPaths].sort())
    || Object.values(input.fileHashes).some((digest) => !sha(digest))) return false;
  const expected = createCampaignStageControlMarker({ stage: 'psro', stageId: input.stageId,
    status: input.closure.status, artifactHashes: input.fileHashes,
    ...(input.closure.reason === null ? {} : { reason: input.closure.reason }) });
  return validateCampaignStageControlMarker(input.marker, expected);
}
