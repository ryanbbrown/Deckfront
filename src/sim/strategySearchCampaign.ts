import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { strategySearchKingdom, strategySearchKingdoms } from './strategySearchKingdoms';
import { nativeRuleFingerprint, NATIVE_GOLDFISH_SCORER_VERSION } from './nativeGoldfishProtocol';
import { ORDERED_PRODUCT_PROFILES, ORDERED_PRODUCT_SEEDS, ORDERED_PRODUCT_SPACE_COUNT } from './orderedGoldfishProduct';
import { orderedGoldfishCardIds } from './orderedGoldfishBenchmark';

export const STRATEGY_SEARCH_CAMPAIGN_SCHEMA_VERSION = 2 as const;
export const STRATEGY_SEARCH_ARTIFACT_SCHEMA_VERSION = 4 as const;
export const CAMPAIGN_MATRIX_SCHEMA_VERSION = 4 as const;
export const CAMPAIGN_PSRO_SCHEMA_VERSION = 3 as const;
export const STRATEGY_SEARCH_SIMULATOR_VERSION = 'strategy-search-simulator-v2' as const;
export const STRATEGY_SEARCH_CAMPAIGN_VOLUME_NAME = 'hexdeck-native-strategy-results' as const;
export const STRATEGY_SEARCH_DOWNLOAD_ROOT = '.data/strategy-search' as const;
export const STRATEGY_SEARCH_MIN_CAPACITY = 4;
export const MATRIX_SEED_NAMESPACE = 'strategy-search-matrix-v2' as const;
export const PSRO_SCREEN_SEED_NAMESPACE = 'strategy-search-psro-screen-v2' as const;
export const PSRO_CONFIRMATION_SEED_NAMESPACE = 'strategy-search-psro-confirmation-v2' as const;
export const PSRO_QUEUE_RETEST_SEED_NAMESPACE = 'strategy-search-psro-queue-retest-v2' as const;

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, held]) => [key, sortValue(held)]));
  return value;
}
export const canonicalStrategySearchJson = (value: unknown): string => JSON.stringify(sortValue(value));
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const identifier = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const nonnegative = z.number().int().nonnegative().safe();

export const strategySearchRequestSchema = z.object({
  kingdomIds: z.array(identifier).min(1),
  maxActiveCpus: z.number().int().safe().min(STRATEGY_SEARCH_MIN_CAPACITY)
}).strict().superRefine((request, context) => {
  if (new Set(request.kingdomIds).size !== request.kingdomIds.length) {
    context.addIssue({ code: 'custom', path: ['kingdomIds'], message: 'Kingdom IDs must be unique.' });
  }
  const registered = new Set(strategySearchKingdoms.map((kingdom) => kingdom.id));
  request.kingdomIds.forEach((kingdomId, index) => {
    if (!registered.has(kingdomId)) context.addIssue({ code: 'custom', path: ['kingdomIds', index],
      message: `Unknown registered kingdom ${kingdomId}.` });
  });
});
export type StrategySearchRequest = z.infer<typeof strategySearchRequestSchema>;
export function parseStrategySearchRequest(value: unknown): StrategySearchRequest {
  const request = strategySearchRequestSchema.parse(value);
  for (const kingdomId of request.kingdomIds) strategySearchKingdom(kingdomId);
  return request;
}

const sourceImageSchema = z.object({
  digest: sha,
  scientificDigest: sha,
  scientificPaths: z.array(z.string().min(1)).min(1),
  files: z.array(z.object({ path: z.string().min(1), bytes: nonnegative, sha256: sha }).strict()).min(1)
}).strict();
export type SourceImageIdentity = z.infer<typeof sourceImageSchema>;
export function normalizedRelativePath(raw: string): string {
  if (!raw || raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new Error(`Content path is not a normalized relative path: ${raw}`);
  }
  const parts = raw.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Content path contains traversal: ${raw}`);
  }
  const normalized = parts.join('/').normalize('NFC');
  if (normalized !== raw || path.posix.normalize(raw) !== raw) throw new Error(`Content path is not normalized: ${raw}`);
  return normalized;
}
export function deriveSourceImageIdentity(input: {
  files: readonly { path: string; content: string | Uint8Array }[];
  dirtyExecutablePaths?: readonly string[];
  expectedPaths?: readonly string[];
  scientificPaths?: readonly string[];
}): SourceImageIdentity {
  if (input.dirtyExecutablePaths?.length) {
    throw new Error(`Executable source has dirty paths: ${input.dirtyExecutablePaths.join(', ')}`);
  }
  const seen = new Set<string>();
  const files = input.files.map((file) => {
    const relative = normalizedRelativePath(file.path);
    if (seen.has(relative)) throw new Error(`Duplicate executable source path ${relative}.`);
    seen.add(relative);
    const bytes = Buffer.from(file.content);
    return { path: relative, bytes: bytes.byteLength, sha256: sha256(bytes) };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (!files.length) throw new Error('Executable source allowlist is empty.');
  if (input.expectedPaths) {
    const expected = [...input.expectedPaths].map(normalizedRelativePath).sort();
    if (JSON.stringify(files.map((file) => file.path)) !== JSON.stringify(expected)) {
      throw new Error('Executable source files differ from the image allowlist.');
    }
  }
  const scientificPaths = input.scientificPaths ? [...input.scientificPaths].map(normalizedRelativePath).sort()
    : files.map((file) => file.path);
  const scientific = files.filter((file) => scientificPaths.includes(file.path));
  if (!scientific.length || JSON.stringify(scientific.map((file) => file.path)) !== JSON.stringify(scientificPaths)) {
    throw new Error('Scientific source files differ from the scientific allowlist.');
  }
  const digestInput = (held: typeof files): string => held.map((file) =>
    `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('');
  return sourceImageSchema.parse({ files, digest: sha256(digestInput(files)), scientificPaths,
    scientificDigest: sha256(digestInput(scientific)) });
}
export function validateSourceImageIdentity(value: unknown): value is SourceImageIdentity {
  const parsed = sourceImageSchema.safeParse(value);
  if (!parsed.success) return false;
  try {
    const files = parsed.data.files;
    if (new Set(files.map((file) => normalizedRelativePath(file.path))).size !== files.length) return false;
    const sorted = [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const scientificPaths = parsed.data.scientificPaths.map(normalizedRelativePath);
    const scientific = files.filter((file) => scientificPaths.includes(file.path));
    const digestInput = (held: typeof files): string => held.map((file) =>
      `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('');
    return JSON.stringify(files) === JSON.stringify(sorted)
      && JSON.stringify(scientificPaths) === JSON.stringify([...scientificPaths].sort())
      && JSON.stringify(scientific.map((file) => file.path)) === JSON.stringify(scientificPaths)
      && parsed.data.digest === sha256(digestInput(files))
      && parsed.data.scientificDigest === sha256(digestInput(scientific));
  } catch { return false; }
}
export function verifySourceImageFiles(identity: SourceImageIdentity,
  files: readonly { path: string; content: string | Uint8Array }[], scientificPaths?: readonly string[]): boolean {
  try { return canonicalStrategySearchJson(deriveSourceImageIdentity({ files,
    expectedPaths: identity.files.map((file) => file.path),
    scientificPaths: scientificPaths ?? identity.scientificPaths })) === canonicalStrategySearchJson(identity); }
  catch { return false; }
}

export interface KingdomEvidenceIdentity {
  schemaVersion: 1;
  kingdomId: string;
  scientificDigest: string;
  rulesFingerprint: string;
  goldfish: {
    generator: 'ordered-five-rung-v1';
    rowFormat: 'goldfish-rows-v1';
    scorerVersion: typeof NATIVE_GOLDFISH_SCORER_VERSION;
    candidateCount: typeof ORDERED_PRODUCT_SPACE_COUNT;
    retainedCount: 500000;
    reservoirCount: 20000;
    profiles: typeof ORDERED_PRODUCT_PROFILES;
    seeds: typeof ORDERED_PRODUCT_SEEDS;
    cardIds: string[];
  };
  matrix: { schemaVersion: 4; seedNamespace: typeof MATRIX_SEED_NAMESPACE; strategyCount: 50; seedCount: 125 };
  psro: {
    schemaVersion: 3; protocolVersion: 'threshold-racing-psro-v2';
    screenSeedNamespace: typeof PSRO_SCREEN_SEED_NAMESPACE;
    confirmationSeedNamespace: typeof PSRO_CONFIRMATION_SEED_NAMESPACE;
    queueRetestSeedNamespace: typeof PSRO_QUEUE_RETEST_SEED_NAMESPACE;
  };
  evidenceId: string;
}
export interface ParsedStrategySearchRequest {
  request: StrategySearchRequest;
  sourceImage: SourceImageIdentity;
  kingdoms: KingdomEvidenceIdentity[];
  campaignExecutionId: string;
  authorizationToken: string;
  downloadRoot: string;
}
function kingdomEvidenceIdentity(kingdomId: string, source: SourceImageIdentity): KingdomEvidenceIdentity {
  const cardIds = orderedGoldfishCardIds(kingdomId);
  const candidateCount = cardIds.length === 14 ? ORDERED_PRODUCT_SPACE_COUNT : 0;
  if (candidateCount !== ORDERED_PRODUCT_SPACE_COUNT) {
    throw new Error(`Registered kingdom ${kingdomId} derives ${candidateCount} candidates; expected ${ORDERED_PRODUCT_SPACE_COUNT}.`);
  }
  const base = { schemaVersion: 1 as const, kingdomId, scientificDigest: source.scientificDigest,
    rulesFingerprint: nativeRuleFingerprint(kingdomId, 30, 200), goldfish: {
      generator: 'ordered-five-rung-v1' as const, rowFormat: 'goldfish-rows-v1' as const,
      scorerVersion: NATIVE_GOLDFISH_SCORER_VERSION, candidateCount: ORDERED_PRODUCT_SPACE_COUNT,
      retainedCount: 500_000 as const, reservoirCount: 20_000 as const,
      profiles: ORDERED_PRODUCT_PROFILES, seeds: ORDERED_PRODUCT_SEEDS, cardIds
    } as const, matrix: { schemaVersion: 4 as const, seedNamespace: MATRIX_SEED_NAMESPACE,
      strategyCount: 50 as const, seedCount: 125 as const }, psro: { schemaVersion: 3 as const,
      protocolVersion: 'threshold-racing-psro-v2' as const, screenSeedNamespace: PSRO_SCREEN_SEED_NAMESPACE,
      confirmationSeedNamespace: PSRO_CONFIRMATION_SEED_NAMESPACE,
      queueRetestSeedNamespace: PSRO_QUEUE_RETEST_SEED_NAMESPACE } };
  return { ...base, evidenceId: sha256(canonicalStrategySearchJson(base)) };
}
export function deriveStrategySearch(input: { request: unknown; sourceImage: SourceImageIdentity }): ParsedStrategySearchRequest {
  const request = parseStrategySearchRequest(input.request);
  if (!validateSourceImageIdentity(input.sourceImage)) throw new Error('Executable source identity is invalid.');
  const kingdoms = request.kingdomIds.map((kingdomId) => kingdomEvidenceIdentity(kingdomId, input.sourceImage));
  const campaignExecutionId = sha256(canonicalStrategySearchJson({ deploymentDigest: input.sourceImage.digest,
    orderedEvidenceIds: kingdoms.map((entry) => entry.evidenceId) }));
  const authorizationToken = deriveLaunchAuthorizationToken({ request, sourceDigest: input.sourceImage.digest,
    orderedEvidenceIds: kingdoms.map((entry) => entry.evidenceId) });
  return { request, sourceImage: structuredClone(input.sourceImage), kingdoms, campaignExecutionId,
    authorizationToken, downloadRoot: `${STRATEGY_SEARCH_DOWNLOAD_ROOT}/${campaignExecutionId}` };
}
export function deriveLaunchAuthorizationToken(input: { request: StrategySearchRequest; sourceDigest: string;
  orderedEvidenceIds: readonly string[] }): string {
  const request = parseStrategySearchRequest(input.request);
  sha.parse(input.sourceDigest);
  if (input.orderedEvidenceIds.length !== request.kingdomIds.length
    || input.orderedEvidenceIds.some((entry) => !sha.safeParse(entry).success)) {
    throw new Error('Authorization evidence IDs differ from the request.');
  }
  return `strategy-search-v2.${sha256(canonicalStrategySearchJson({ request,
    sourceDigest: input.sourceDigest, orderedEvidenceIds: input.orderedEvidenceIds }))}`;
}
export function validateLaunchAuthorizationToken(token: string, parsed: ParsedStrategySearchRequest): boolean {
  const expected = parsed.authorizationToken, left = Buffer.from(token), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function kingdomArtifactRoot(evidenceId: string): string {
  sha.parse(evidenceId); return `evidence/${evidenceId}`;
}
export function campaignExecutionRoot(campaignExecutionId: string): string {
  sha.parse(campaignExecutionId); return `executions/${campaignExecutionId}`;
}
