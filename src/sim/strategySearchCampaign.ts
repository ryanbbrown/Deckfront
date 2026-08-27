import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { registerKingdom } from '../game';
import { deepBeamSuite } from './deepBeamSuite';
import { nativeRuleFingerprint } from './nativeGoldfishProtocol';
import {
  deriveCurrentOrderedProductIdentity, ORDERED_PRODUCT_SPACE_COUNT
} from './orderedGoldfishProduct';

export const STRATEGY_SEARCH_CAMPAIGN_SCHEMA_VERSION = 1 as const;
export const STRATEGY_SEARCH_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const STRATEGY_SEARCH_SIMULATOR_VERSION = 'strategy-search-simulator-v1' as const;
export const CAMPAIGN_MATRIX_SCHEMA_VERSION = 3 as const;
export const CAMPAIGN_PSRO_SCHEMA_VERSION = 2 as const;

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(sortValue(value));
const exactKeys = (value: object, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, held]) => [key, sortValue(held)]));
  return value;
}

const nonnegative = z.number().int().nonnegative();
const positive = z.number().int().positive();
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const identifier = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const runtimeStageSchema = z.object({
  cpu: positive, memoryMiB: positive, threads: positive, workerBatchSize: positive,
  timeoutSeconds: positive, checkpointIntervalSeconds: positive
}).strict();
const shardSchema = z.object({ id: identifier, start: nonnegative, end: positive }).strict();
const kingdomEvidenceSchema = z.object({
  ruleFingerprint: z.string().min(1), goldfishSeeds: z.tuple([nonnegative, nonnegative, nonnegative, nonnegative])
}).strict();
const sourceImageSchema = z.object({
  gitVersion: z.string().min(1), digest: sha,
  files: z.array(z.object({ path: z.string().min(1), bytes: nonnegative, sha256: sha }).strict()).min(1)
}).strict();

export const strategySearchCampaignManifestSchema = z.object({
  schemaVersion: z.literal(STRATEGY_SEARCH_CAMPAIGN_SCHEMA_VERSION),
  deployment: z.object({ volumeName: identifier }).strict(),
  evidence: z.object({
    campaignId: identifier,
    kingdomIds: z.array(identifier).min(1),
    sourceImage: sourceImageSchema,
    kingdoms: z.record(identifier, kingdomEvidenceSchema),
    orderedProduct: z.object({
      generator: z.string().min(1), traversal: z.string().min(1), scorerVersion: z.string().min(1),
      candidateCount: positive, retainedCount: positive, reservoirCount: positive,
      canonicalShards: z.array(shardSchema).min(1)
    }).strict(),
    matrix: z.object({
      schemaVersion: z.literal(CAMPAIGN_MATRIX_SCHEMA_VERSION), strategyCount: z.literal(50),
      maxSeedCount: z.literal(125), chunkSize: z.literal(25), trainingPrefixes: z.tuple([z.literal(75), z.literal(100)]),
      heldOutStartOrdinal: z.literal(101)
    }).strict(),
    psro: z.object({
      schemaVersion: z.literal(CAMPAIGN_PSRO_SCHEMA_VERSION), protocolVersion: z.string().min(1),
      threshold: z.literal(0.51), screenDepths: z.tuple([z.literal(8), z.literal(16), z.literal(32),
        z.literal(64), z.literal(128), z.literal(256), z.literal(512)]),
      screenAlpha: z.literal(0.05), confirmationLooks: z.tuple([z.literal(400), z.literal(800),
        z.literal(1600), z.literal(3200), z.literal(6400)]), confirmationFamilyAlpha: z.literal(0.05),
      matrixSeedCount: z.literal(75), cleanScans: z.literal(2),
      screenSeedNamespace: z.string().min(1), confirmationSeedNamespace: z.string().min(1),
      queueRetestSeedNamespace: z.string().min(1), matrixSeedNamespace: z.string().min(1)
    }).strict(),
    simulatorVersion: z.literal(STRATEGY_SEARCH_SIMULATOR_VERSION),
    artifactSchemaVersion: z.literal(STRATEGY_SEARCH_ARTIFACT_SCHEMA_VERSION)
  }).strict(),
  runtime: z.object({
    executionMode: z.enum(['local-fixture', 'modal']), downloadRoot: z.string().min(1),
    controllerTimeoutSeconds: positive, maxActiveContainers: positive, maxActiveCpus: positive,
    dispatchBatchSize: positive,
    stages: z.object({ goldfish: runtimeStageSchema, matrix: runtimeStageSchema, psro: runtimeStageSchema }).strict()
  }).strict()
}).strict();

export type StrategySearchCampaignManifest = z.infer<typeof strategySearchCampaignManifestSchema>;
export type CampaignRuntime = StrategySearchCampaignManifest['runtime'];
export type SourceImageIdentity = StrategySearchCampaignManifest['evidence']['sourceImage'];

export interface ParsedCampaignManifest {
  manifest: StrategySearchCampaignManifest;
  evidenceHash: string;
  runtimeHash: string;
  stageIds: Record<string, { goldfish: string; matrix: string; psro: string }>;
}

const EXCLUDED_SOURCE_COMPONENTS = new Set(['.git', 'node_modules', '.experiments', '.reviews', '.data',
  'dist', 'dist-sim', 'dist-benchmark', 'target']);
function assertSourceImagePath(relative: string): void {
  const components = relative.split('/');
  const name = components.at(-1)!.toLocaleLowerCase('en-US');
  if (components.some((component) => EXCLUDED_SOURCE_COMPONENTS.has(component.toLocaleLowerCase('en-US')))
    || name === '.env' || name.startsWith('.env.') || name.includes('credential')
    || name.endsWith('.pem') || name.endsWith('.key')) {
    throw new Error(`Source-image path is generated, secret-bearing, or excluded: ${relative}`);
  }
}

export function normalizedRelativePath(raw: string): string {
  if (!raw || raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new Error(`Content path is not a normalized relative path: ${raw}`);
  }
  const components = raw.split('/');
  if (components.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Content path contains an empty or traversal component: ${raw}`);
  }
  const normalized = components.join('/').normalize('NFC');
  if (normalized !== raw || path.posix.normalize(raw) !== raw) {
    throw new Error(`Content path is not NFC-normalized: ${raw}`);
  }
  return normalized;
}

export function deriveSourceImageIdentity(input: {
  gitVersion: string;
  files: readonly { path: string; content: string | Uint8Array }[];
  dirtyTrackedPaths?: readonly string[];
}): SourceImageIdentity {
  if (input.dirtyTrackedPaths?.length) {
    throw new Error(`Source-image worktree has dirty tracked paths: ${input.dirtyTrackedPaths.join(', ')}`);
  }
  if (!input.gitVersion || !input.files.length) throw new Error('Source-image identity needs a Git version and files.');
  const seen = new Set<string>();
  const files = input.files.map((file) => {
    const relative = normalizedRelativePath(file.path);
    assertSourceImagePath(relative);
    if (seen.has(relative)) throw new Error(`Duplicate source-image path ${relative}.`);
    seen.add(relative);
    const bytes = typeof file.content === 'string' ? Buffer.from(file.content) : Buffer.from(file.content);
    return { path: relative, bytes: bytes.byteLength, sha256: sha256(bytes) };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const digest = sha256(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''));
  return sourceImageSchema.parse({ gitVersion: input.gitVersion, digest, files });
}
export function validateSourceImageIdentity(value: unknown): value is SourceImageIdentity {
  const parsed = sourceImageSchema.safeParse(value);
  if (!parsed.success) return false;
  try {
    const seen = new Set<string>();
    for (const file of parsed.data.files) {
      normalizedRelativePath(file.path);
      assertSourceImagePath(file.path);
      if (seen.has(file.path)) return false;
      seen.add(file.path);
    }
    const sorted = [...parsed.data.files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    return JSON.stringify(sorted) === JSON.stringify(parsed.data.files)
      && parsed.data.digest === sha256(sorted.map((file) =>
        `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''));
  } catch { return false; }
}
export function verifySourceImageFiles(identity: SourceImageIdentity,
  files: readonly { path: string; content: string | Uint8Array }[]): boolean {
  try {
    return canonical(deriveSourceImageIdentity({ gitVersion: identity.gitVersion, files })) === canonical(identity);
  } catch { return false; }
}

function validateShardPartition(shards: readonly { id: string; start: number; end: number }[], total: number): void {
  let cursor = 0;
  const ids = new Set<string>();
  for (const shard of shards) {
    if (ids.has(shard.id) || shard.start !== cursor || shard.end <= shard.start || shard.end > total) {
      throw new Error('Canonical Goldfish shard partition has a gap, overlap, duplicate, or invalid bound.');
    }
    ids.add(shard.id); cursor = shard.end;
  }
  if (cursor !== total) throw new Error('Canonical Goldfish shard partition does not cover the candidate space.');
}

export function parseStrategySearchCampaignManifest(value: unknown): ParsedCampaignManifest {
  const manifest = strategySearchCampaignManifestSchema.parse(value);
  if (!validateSourceImageIdentity(manifest.evidence.sourceImage)) {
    throw new Error('Campaign source-image identity is stale, corrupt, or not canonical.');
  }
  if (new Set(manifest.evidence.kingdomIds).size !== manifest.evidence.kingdomIds.length) {
    throw new Error('Campaign kingdom IDs must be unique.');
  }
  if (Object.keys(manifest.evidence.kingdoms).length !== manifest.evidence.kingdomIds.length
    || manifest.evidence.kingdomIds.some((id) => !manifest.evidence.kingdoms[id])) {
    throw new Error('Campaign evidence must map exactly four Goldfish seeds to every requested kingdom.');
  }
  const registered = new Map(deepBeamSuite.kingdoms.map((kingdom) => [kingdom.id, kingdom]));
  for (const kingdomId of manifest.evidence.kingdomIds) {
    const kingdom = registered.get(kingdomId);
    if (!kingdom) throw new Error(`Unknown campaign kingdom ${kingdomId}.`);
    registerKingdom(kingdom);
    const evidence = manifest.evidence.kingdoms[kingdomId]!;
    const expectedRules = nativeRuleFingerprint(kingdomId, 30, 200);
    if (evidence.ruleFingerprint !== expectedRules) throw new Error(`Rule fingerprint differs for ${kingdomId}.`);
    const identity = deriveCurrentOrderedProductIdentity({ kingdomId, seeds: evidence.goldfishSeeds,
      scorerVersion: manifest.evidence.orderedProduct.scorerVersion,
      buildVersion: manifest.evidence.sourceImage.gitVersion });
    if (identity.candidateCount !== manifest.evidence.orderedProduct.candidateCount) {
      throw new Error(`Derived ordered-product candidate count differs for ${kingdomId}.`);
    }
  }
  if (manifest.evidence.orderedProduct.candidateCount !== ORDERED_PRODUCT_SPACE_COUNT
    || manifest.evidence.orderedProduct.retainedCount !== 500_000
    || manifest.evidence.orderedProduct.reservoirCount !== 20_000) {
    throw new Error('Campaign ordered-product counts differ from the settled protocol.');
  }
  validateShardPartition(manifest.evidence.orderedProduct.canonicalShards,
    manifest.evidence.orderedProduct.candidateCount);
  const evidenceHash = sha256(canonical(manifest.evidence));
  const runtimeHash = sha256(canonical(manifest.runtime));
  const stageIds = Object.fromEntries(manifest.evidence.kingdomIds.map((kingdomId) => {
    const root = sha256(canonical({ evidenceHash, kingdomId }));
    return [kingdomId, {
      goldfish: sha256(canonical({ root, stage: 'goldfish' })),
      matrix: sha256(canonical({ root, stage: 'matrix' })),
      psro: sha256(canonical({ root, stage: 'psro' }))
    }];
  }));
  return { manifest, evidenceHash, runtimeHash, stageIds };
}

export function contentIndexDestination(root: string, relative: string): string {
  const normalized = normalizedRelativePath(relative);
  const resolvedRoot = path.resolve(root), destination = path.resolve(resolvedRoot, ...normalized.split('/'));
  if (destination === resolvedRoot || !destination.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Content path resolves outside the campaign root: ${relative}`);
  }
  return destination;
}

export function campaignStagePath(campaignId: string, evidenceHash: string, kingdomId: string,
  stage: 'goldfish' | 'matrix' | 'psro'): string {
  identifier.parse(campaignId); identifier.parse(kingdomId); sha.parse(evidenceHash);
  return `campaigns/${campaignId}/${evidenceHash}/kingdoms/${kingdomId}/${stage}`;
}

export interface RuntimeStageCeilings {
  cpu: number; memoryMiB: number; threads: number; workerBatchSize: number; timeoutSeconds: number;
}
export interface RuntimeCeilings {
  controllerTimeoutSeconds: number;
  maxActiveContainers: number;
  maxActiveCpus: number;
  stages: { goldfish: RuntimeStageCeilings; matrix: RuntimeStageCeilings; psro: RuntimeStageCeilings };
}
const runtimeStageCeilingsSchema = z.object({ cpu: positive, memoryMiB: positive, threads: positive,
  workerBatchSize: positive, timeoutSeconds: positive }).strict();
const runtimeCeilingsSchema = z.object({ controllerTimeoutSeconds: positive, maxActiveContainers: positive,
  maxActiveCpus: positive, stages: z.object({ goldfish: runtimeStageCeilingsSchema,
    matrix: runtimeStageCeilingsSchema, psro: runtimeStageCeilingsSchema }).strict() }).strict();
export function runtimeCeilings(runtime: CampaignRuntime): RuntimeCeilings {
  const stage = (value: CampaignRuntime['stages']['goldfish']): RuntimeStageCeilings => ({
    cpu: value.cpu, memoryMiB: value.memoryMiB, threads: value.threads,
    workerBatchSize: value.workerBatchSize, timeoutSeconds: value.timeoutSeconds
  });
  return runtimeCeilingsSchema.parse({ controllerTimeoutSeconds: runtime.controllerTimeoutSeconds,
    maxActiveContainers: runtime.maxActiveContainers, maxActiveCpus: runtime.maxActiveCpus,
    stages: { goldfish: stage(runtime.stages.goldfish), matrix: stage(runtime.stages.matrix),
      psro: stage(runtime.stages.psro) } });
}
export function deriveLaunchAuthorizationToken(evidenceHash: string, ceilings: RuntimeCeilings): string {
  sha.parse(evidenceHash);
  const validated = runtimeCeilingsSchema.parse(ceilings);
  return `campaign-v1.${sha256(canonical({ evidenceHash, ceilings: validated }))}`;
}
export function validateLaunchAuthorizationToken(token: string, evidenceHash: string,
  ceilings: RuntimeCeilings): boolean {
  try {
    const expected = deriveLaunchAuthorizationToken(evidenceHash, ceilings);
    const left = Buffer.from(token), right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  } catch { return false; }
}
function ceilingsFit(actual: RuntimeCeilings, authorized: RuntimeCeilings): boolean {
  const fields = ['cpu', 'memoryMiB', 'threads', 'workerBatchSize', 'timeoutSeconds'] as const;
  return actual.controllerTimeoutSeconds <= authorized.controllerTimeoutSeconds
    && actual.maxActiveContainers <= authorized.maxActiveContainers && actual.maxActiveCpus <= authorized.maxActiveCpus
    && (['goldfish', 'matrix', 'psro'] as const).every((stage) =>
      fields.every((field) => actual.stages[stage][field] <= authorized.stages[stage][field]));
}
function mergeRuntimeCeilings(left: RuntimeCeilings, right: RuntimeCeilings): RuntimeCeilings {
  const maximum = (a: number, b: number): number => Math.max(a, b);
  const stage = (name: keyof RuntimeCeilings['stages']): RuntimeStageCeilings => ({
    cpu: maximum(left.stages[name].cpu, right.stages[name].cpu),
    memoryMiB: maximum(left.stages[name].memoryMiB, right.stages[name].memoryMiB),
    threads: maximum(left.stages[name].threads, right.stages[name].threads),
    workerBatchSize: maximum(left.stages[name].workerBatchSize, right.stages[name].workerBatchSize),
    timeoutSeconds: maximum(left.stages[name].timeoutSeconds, right.stages[name].timeoutSeconds)
  });
  return { controllerTimeoutSeconds: maximum(left.controllerTimeoutSeconds, right.controllerTimeoutSeconds),
    maxActiveContainers: maximum(left.maxActiveContainers, right.maxActiveContainers),
    maxActiveCpus: maximum(left.maxActiveCpus, right.maxActiveCpus),
    stages: { goldfish: stage('goldfish'), matrix: stage('matrix'), psro: stage('psro') } };
}
export function runtimeFitsAuthorizedCeilings(runtime: CampaignRuntime, authorized: RuntimeCeilings): boolean {
  try { return ceilingsFit(runtimeCeilings(runtime), runtimeCeilingsSchema.parse(authorized)); }
  catch { return false; }
}

export type CampaignStageStatus = 'pending' | 'ready' | 'active' | 'incomplete' | 'terminal-incomplete' | 'complete';
export interface CampaignStageState {
  id: string; status: CampaignStageStatus; callId?: string; controllerFence?: number;
  heartbeatMs?: number; resources?: { containers: number; cpus: number };
  reason?: string; artifactPaths?: string[]; artifactHashes?: Record<string, string>;
}
export interface CampaignState {
  schemaVersion: 1; campaignId: string; evidenceHash: string; runtimeHistory: string[];
  revision: number; fencingToken: number; controller: null | { ownerId: string; leaseUntilMs: number; fencingToken: number };
  authorizedCeilings: RuntimeCeilings | null; stages: Record<string, CampaignStageState>; evidenceHashSeal: string;
}
function sealState(state: Omit<CampaignState, 'evidenceHashSeal'> | CampaignState): CampaignState {
  const copy = structuredClone(state) as CampaignState; copy.evidenceHashSeal = '';
  return { ...copy, evidenceHashSeal: sha256(canonical(copy)) };
}
export function createCampaignState(input: { campaignId: string; evidenceHash: string; runtimeHash: string;
  stageIds: ParsedCampaignManifest['stageIds'] }): CampaignState {
  const stages: Record<string, CampaignStageState> = {};
  for (const [kingdomId, ids] of Object.entries(input.stageIds)) {
    stages[`${kingdomId}:goldfish`] = { id: ids.goldfish, status: 'ready' };
    stages[`${kingdomId}:matrix`] = { id: ids.matrix, status: 'pending' };
    stages[`${kingdomId}:psro`] = { id: ids.psro, status: 'pending' };
  }
  return sealState({ schemaVersion: 1, campaignId: input.campaignId, evidenceHash: input.evidenceHash,
    runtimeHistory: [input.runtimeHash], revision: 0, fencingToken: 0, controller: null,
    authorizedCeilings: null, stages, evidenceHashSeal: '' });
}
function validStageState(stage: unknown): stage is CampaignStageState {
  if (!stage || typeof stage !== 'object') return false;
  const held = stage as CampaignStageState;
  if (!sha.safeParse(held.id).success || !legalTransitions[held.status]) return false;
  if (held.status === 'pending' || held.status === 'ready') return exactKeys(held, ['id', 'status']);
  if (held.status === 'active') return exactKeys(held, ['id', 'status', 'callId', 'controllerFence',
    'heartbeatMs', 'resources']) && Boolean(held.callId) && Number.isSafeInteger(held.controllerFence)
    && held.controllerFence! >= 0 && Number.isSafeInteger(held.heartbeatMs) && held.heartbeatMs! >= 0
    && Boolean(held.resources) && exactKeys(held.resources!, ['containers', 'cpus'])
    && Number.isSafeInteger(held.resources!.containers) && held.resources!.containers > 0
    && Number.isSafeInteger(held.resources!.cpus) && held.resources!.cpus > 0;
  if (held.status === 'incomplete' || held.status === 'terminal-incomplete') {
    return exactKeys(held, ['id', 'status', 'reason', 'artifactPaths']) && Boolean(held.reason)
      && Array.isArray(held.artifactPaths) && new Set(held.artifactPaths).size === held.artifactPaths.length
      && held.artifactPaths.every((entry) => typeof entry === 'string' && entry.length > 0);
  }
  return exactKeys(held, ['id', 'status', 'artifactHashes']) && Boolean(held.artifactHashes)
    && Object.keys(held.artifactHashes!).length > 0
    && Object.values(held.artifactHashes!).every((digest) => sha.safeParse(digest).success);
}
export function validateCampaignState(value: unknown): value is CampaignState {
  if (!value || typeof value !== 'object' || !exactKeys(value,
    ['schemaVersion', 'campaignId', 'evidenceHash', 'runtimeHistory', 'revision', 'fencingToken',
      'controller', 'authorizedCeilings', 'stages', 'evidenceHashSeal'])) return false;
  try {
    const held = value as CampaignState;
    if (held.schemaVersion !== 1 || !identifier.safeParse(held.campaignId).success
      || !Number.isSafeInteger(held.revision) || held.revision < 0
      || !Number.isSafeInteger(held.fencingToken) || held.fencingToken < 0 || !sha.safeParse(held.evidenceHash).success
      || !sha.safeParse(held.evidenceHashSeal).success || !Array.isArray(held.runtimeHistory)
      || !held.runtimeHistory.length || new Set(held.runtimeHistory).size !== held.runtimeHistory.length
      || held.runtimeHistory.some((entry) => !sha.safeParse(entry).success)
      || !held.stages || typeof held.stages !== 'object' || Array.isArray(held.stages)
      || !Object.keys(held.stages).length) return false;
    if (held.authorizedCeilings !== null && !runtimeCeilingsSchema.safeParse(held.authorizedCeilings).success) return false;
    if (held.controller !== null && (!exactKeys(held.controller, ['ownerId', 'leaseUntilMs', 'fencingToken'])
      || !held.controller.ownerId || !Number.isSafeInteger(held.controller.leaseUntilMs)
      || held.controller.leaseUntilMs < 0 || held.controller.fencingToken !== held.fencingToken)) return false;
    const ids = new Set<string>();
    for (const [key, stage] of Object.entries(held.stages)) {
      if (!/^[A-Za-z0-9._-]+:(goldfish|matrix|psro)$/.test(key) || !validStageState(stage)
        || ids.has(stage.id)) return false;
      ids.add(stage.id);
    }
    return sealState(held).evidenceHashSeal === held.evidenceHashSeal;
  } catch { return false; }
}
function nextState(state: CampaignState): CampaignState {
  return sealState({ ...structuredClone(state), revision: state.revision + 1 });
}
export function claimCampaignController(input: { state: CampaignState; expectedRevision: number; ownerId: string;
  nowMs: number; leaseMs: number; authorization?: { token: string; ceilings: RuntimeCeilings } }): CampaignState {
  if (!validateCampaignState(input.state) || input.state.revision !== input.expectedRevision
    || !input.ownerId || !Number.isSafeInteger(input.nowMs) || !Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1) {
    throw new Error('Campaign controller claim has stale or invalid state.');
  }
  const state = structuredClone(input.state);
  const firstLaunch = state.authorizedCeilings === null;
  if (input.authorization) {
    if (!validateLaunchAuthorizationToken(input.authorization.token,
      state.evidenceHash, input.authorization.ceilings)) throw new Error('Campaign runtime increase is not authorized.');
    const authorized = runtimeCeilingsSchema.parse(input.authorization.ceilings);
    state.authorizedCeilings = state.authorizedCeilings
      ? mergeRuntimeCeilings(state.authorizedCeilings, authorized) : structuredClone(authorized);
  } else if (firstLaunch) throw new Error('First campaign launch is not authorized.');
  if (state.controller && state.controller.leaseUntilMs > input.nowMs
    && state.controller.ownerId !== input.ownerId) throw new Error('Campaign controller lease is active.');
  if (!state.controller || state.controller.ownerId !== input.ownerId) state.fencingToken += 1;
  state.controller = { ownerId: input.ownerId, leaseUntilMs: input.nowMs + input.leaseMs,
    fencingToken: state.fencingToken };
  return nextState(state);
}
export function mutateCampaignState(input: { state: CampaignState; expectedRevision: number;
  ownerId: string; fencingToken: number; mutate: (draft: CampaignState) => void }): CampaignState {
  if (!validateCampaignState(input.state) || input.state.revision !== input.expectedRevision
    || input.state.controller?.ownerId !== input.ownerId
    || input.state.controller.fencingToken !== input.fencingToken
    || input.state.fencingToken !== input.fencingToken) throw new Error('Campaign state mutation is stale or fenced out.');
  const draft = structuredClone(input.state); input.mutate(draft);
  if (draft.schemaVersion !== input.state.schemaVersion || draft.campaignId !== input.state.campaignId
    || draft.evidenceHash !== input.state.evidenceHash || draft.revision !== input.state.revision
    || draft.fencingToken !== input.state.fencingToken
    || canonical(draft.controller) !== canonical(input.state.controller)
    || canonical(draft.authorizedCeilings) !== canonical(input.state.authorizedCeilings)
    || canonical(draft.runtimeHistory) !== canonical(input.state.runtimeHistory)
    || draft.evidenceHashSeal !== input.state.evidenceHashSeal
    || canonical(Object.keys(draft.stages).sort()) !== canonical(Object.keys(input.state.stages).sort())) {
    throw new Error('Campaign mutation changed protected state fields.');
  }
  for (const [key, before] of Object.entries(input.state.stages)) {
    const after = draft.stages[key];
    if (!after || after.id !== before.id || !validStageState(after)) {
      throw new Error('Campaign mutation changed a stage identity or produced malformed state.');
    }
    if (after.status !== before.status && !legalTransitions[before.status].includes(after.status)) {
      throw new Error(`Illegal campaign stage transition ${before.status} -> ${after.status}.`);
    }
    if (after.status === before.status && before.status !== 'active' && canonical(after) !== canonical(before)) {
      throw new Error('Campaign mutation changed a terminal or inactive stage without a transition.');
    }
    if (after.status === 'active' && before.status === 'active'
      && (after.callId !== before.callId || after.controllerFence !== before.controllerFence
        || canonical(after.resources) !== canonical(before.resources))) {
      throw new Error('Campaign mutation changed an active call identity or allocation.');
    }
  }
  const next = nextState(draft);
  if (!validateCampaignState(next)) throw new Error('Campaign mutation produced invalid state.');
  return next;
}
const legalTransitions: Record<CampaignStageStatus, readonly CampaignStageStatus[]> = {
  pending: ['ready'], ready: ['active'], active: ['incomplete', 'terminal-incomplete', 'complete'],
  incomplete: ['ready'], 'terminal-incomplete': [], complete: []
};
export function transitionCampaignStage(stage: CampaignStageState, status: CampaignStageStatus,
  details: Omit<CampaignStageState, 'id' | 'status'> = {}): CampaignStageState {
  if (!legalTransitions[stage.status].includes(status)) {
    throw new Error(`Illegal campaign stage transition ${stage.status} -> ${status}.`);
  }
  if (status === 'active' && (!details.callId || details.controllerFence === undefined
    || !details.resources || !Number.isSafeInteger(details.heartbeatMs))) {
    throw new Error('Active stage needs call, fence, heartbeat, and resources.');
  }
  if ((status === 'incomplete' || status === 'terminal-incomplete')
    && (!details.reason || !Array.isArray(details.artifactPaths))) {
    throw new Error('Incomplete stage needs an exact reason and resumable artifact paths.');
  }
  if (status === 'complete' && (!details.artifactHashes || !Object.keys(details.artifactHashes).length)) {
    throw new Error('Complete stage needs validated artifact hashes.');
  }
  const transitioned = { id: stage.id, status, ...structuredClone(details) };
  if (!validStageState(transitioned)) throw new Error('Campaign stage transition details are malformed.');
  return transitioned;
}

export interface CampaignContentIndexEntry {
  path: string; bytes: number; sha256: string; stageId: string;
  completeness: 'complete' | 'incomplete' | 'terminal-incomplete';
}
export interface CampaignContentIndex { schemaVersion: 1; entries: CampaignContentIndexEntry[]; indexHash: string }
export function createCampaignContentIndex(entries: readonly CampaignContentIndexEntry[]): CampaignContentIndex {
  const normalized = entries.map((entry) => ({ ...entry, path: normalizedRelativePath(entry.path) }));
  const exactPaths = new Set<string>(), folded = new Set<string>();
  for (const entry of normalized) {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !sha.safeParse(entry.sha256).success || !entry.stageId) {
      throw new Error(`Content-index entry is invalid: ${entry.path}`);
    }
    const collisionKey = entry.path.normalize('NFC').toLocaleLowerCase('en-US');
    if (exactPaths.has(entry.path) || folded.has(collisionKey)) throw new Error(`Content-index path collides: ${entry.path}`);
    exactPaths.add(entry.path); folded.add(collisionKey);
  }
  normalized.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { schemaVersion: 1, entries: normalized, indexHash: sha256(canonical(normalized)) };
}
export function validateCampaignContentIndex(value: unknown): value is CampaignContentIndex {
  if (!value || typeof value !== 'object') return false;
  try {
    const held = value as CampaignContentIndex;
    return held.schemaVersion === 1 && Array.isArray(held.entries)
      && canonical(createCampaignContentIndex(held.entries)) === canonical(held);
  } catch { return false; }
}
