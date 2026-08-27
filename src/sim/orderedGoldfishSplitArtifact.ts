import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
  validateOrderedCalibrationSourceForCounts
} from './initialMatrixCalibration';
import type { InitialMatrixSourceIdentity } from './initialMatrixCalibration';
import {
  CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION, ORDERED_PRODUCT_SCHEMA_VERSION,
  candidateSpaceProvenanceDigest, compareRankedRecords,
  createCurrentOrderedProductMembershipValidator, fixedJson, provenanceDigest, rankingKey,
  validateOrderedProductRankedRecord
} from './orderedGoldfishProduct';
import type {
  CurrentOrderedProductIdentity, OrderedProductRankedArtifact,
  OrderedProductRankedRecord, OrderedProductReservoirArtifact, OrderedProductShardProvenance
} from './orderedGoldfishProduct';
import type { Strategy } from './strategy';

const PART_KEYS = ['file', 'startIndex', 'endIndex', 'count', 'sha256'] as const;
const CONFIG_KEYS = ['kingdomId', 'candidateCount', 'retainedCount', 'reservoirCount', 'seeds',
  'profiles', 'turnLimit', 'actionCapPerTurn', 'collisionAllowance'] as const;
const CANDIDATE_SPACE_KEYS = ['generator', 'traversal', 'cardIds', 'quantityVectors', 'skeletonCount',
  'candidateCount', 'strideSeed', 'offsetSeed', 'stride', 'offset', 'provenanceDigest'] as const;
const SHARD_KEYS = ['shardId', 'startPosition', 'endPosition', 'completeCount', 'retainedCount',
  'candidateDigest', 'scoreDigest', 'contentDigest'] as const;
const RECORD_KEYS = ['traversalPosition', 'displayId', 'canonicalStrategy', 'strategy', 'stageOne',
  'stageOneRankingKey', 'additional', 'combined', 'combinedRankingKey', 'stageOneRank', 'rank'] as const;
const RESERVOIR_KEYS_V1 = ['schemaVersion', 'version', 'sourceArtifactSha256', 'runId',
  'reservoirCount', 'entries'] as const;
const RESERVOIR_KEYS_V2 = [...RESERVOIR_KEYS_V1, 'productIdentityHash'] as const;

export interface OrderedProductRankedPart {
  file: string;
  startIndex: number;
  endIndex: number;
  count: number;
  sha256: string;
}
export type OrderedProductSplitRankedManifest = Omit<OrderedProductRankedArtifact, 'records'> & {
  recordCount: number;
  stageOneOrderDigest: string;
  parts: OrderedProductRankedPart[];
};
export interface ValidatedOrderedProductSplitSource {
  manifest: OrderedProductSplitRankedManifest;
  reservoir: OrderedProductReservoirArtifact;
  rankedSha256: string;
  reservoirSha256: string;
  source: InitialMatrixSourceIdentity;
  strategies: Strategy[];
}

const exact = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: object, keys: readonly string[]): boolean =>
  exact(Object.keys(value).sort(), [...keys].sort());
const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function checkedSidecar(file: string, digest: string): void {
  const sidecar = `${file}.sha256`;
  if (!fs.existsSync(sidecar)
    || fs.readFileSync(sidecar, 'utf8') !== `${digest}  ${path.basename(file)}\n`) {
    throw new Error(`Ordered product SHA-256 sidecar differs: ${sidecar}`);
  }
}
function safePartFile(rankedPath: string, name: string): string {
  if (!name || path.basename(name) !== name || name === '.' || name === '..' || name.includes('\\')) {
    throw new Error(`Ordered product ranked part path is invalid: ${name}`);
  }
  const root = path.dirname(rankedPath), resolved = path.resolve(root, name);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`) || fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error(`Ordered product ranked part escapes or is a symlink: ${name}`);
  }
  return resolved;
}
function validShards(shards: unknown, total: number): shards is OrderedProductShardProvenance[] {
  if (!Array.isArray(shards) || !shards.length || shards[0]?.startPosition !== 0
    || shards.at(-1)?.endPosition !== total) return false;
  return shards.every((entry, index) => object(entry) && exactKeys(entry, SHARD_KEYS)
    && entry.shardId === index && Number.isSafeInteger(entry.startPosition) && Number(entry.startPosition) >= 0
    && Number.isSafeInteger(entry.endPosition) && Number(entry.endPosition) >= Number(entry.startPosition)
    && entry.completeCount === Number(entry.endPosition) - Number(entry.startPosition)
    && Number.isSafeInteger(entry.retainedCount) && Number(entry.retainedCount) >= 0
    && Number(entry.retainedCount) <= Number(entry.completeCount)
    && typeof entry.candidateDigest === 'string' && /^[0-9a-f]{9,}$/.test(entry.candidateDigest)
    && typeof entry.scoreDigest === 'string' && /^[0-9a-f]{9,}$/.test(entry.scoreDigest)
    && typeof entry.contentDigest === 'string' && /^[0-9a-f]{9,}$/.test(entry.contentDigest)
    && (index === 0 || shards[index - 1]!.endPosition === entry.startPosition));
}
function stageOneEntryDigest(record: OrderedProductRankedRecord): Buffer {
  return createHash('sha256').update(`${rankingKey(record.stageOne).join('\t')}\t${record.displayId}`
    + `\t${record.canonicalStrategy}\t${record.traversalPosition}`).digest();
}
async function readPart(file: string, expectedSha: string,
  visit: (record: unknown) => void): Promise<number> {
  if (sha256File(file) !== expectedSha) throw new Error(`Ordered product ranked part hash differs: ${file}`);
  const digest = createHash('sha256'); let count = 0;
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity });
  for await (const line of lines) {
    digest.update(`${line}\n`); count += 1; visit(JSON.parse(line) as unknown);
  }
  if (digest.digest('hex') !== expectedSha) throw new Error(`Ordered product ranked part hash differs: ${file}`);
  return count;
}

export async function loadValidatedOrderedProductSplitSource(input: {
  kingdomId: string;
  rankedPath: string;
  reservoirPath: string;
  counts?: { retainedCount: number; reservoirCount: number; strategyCount: number };
}): Promise<ValidatedOrderedProductSplitSource> {
  const counts = input.counts ?? { retainedCount: 500_000, reservoirCount: 20_000, strategyCount: 50 };
  for (const file of [input.rankedPath, input.reservoirPath]) {
    if (!path.isAbsolute(file) || !fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) {
      throw new Error(`Ordered product source path is missing, relative, or a symlink: ${file}`);
    }
  }
  const rankedText = fs.readFileSync(input.rankedPath, 'utf8');
  const reservoirText = fs.readFileSync(input.reservoirPath, 'utf8');
  const rankedSha256 = sha256File(input.rankedPath), reservoirSha256 = sha256File(input.reservoirPath);
  checkedSidecar(input.rankedPath, rankedSha256); checkedSidecar(input.reservoirPath, reservoirSha256);
  const manifest = JSON.parse(rankedText) as OrderedProductSplitRankedManifest;
  const reservoir = JSON.parse(reservoirText) as OrderedProductReservoirArtifact;
  const manifestKeys = manifest.schemaVersion === CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION
    ? ['schemaVersion', 'version', 'productIdentity', 'runId', 'buildVersion', 'ruleFingerprint',
      'scorerVersion', 'config', 'candidateSpace', 'stageOneShards', 'stageTwoShards',
      'stageOneProvenanceDigest', 'stageTwoProvenanceDigest', 'recordCount', 'stageOneOrderDigest', 'parts']
    : ['schemaVersion', 'version', 'runId', 'buildVersion', 'ruleFingerprint', 'scorerVersion', 'config',
      'candidateSpace', 'stageOneShards', 'stageTwoShards', 'stageOneProvenanceDigest',
      'stageTwoProvenanceDigest', 'recordCount', 'stageOneOrderDigest', 'parts'];
  if (!object(manifest) || !exactKeys(manifest, manifestKeys) || fixedJson(manifest) !== rankedText
    || !object(manifest.config) || !exactKeys(manifest.config, CONFIG_KEYS)
    || !object(manifest.candidateSpace) || !exactKeys(manifest.candidateSpace, CANDIDATE_SPACE_KEYS)
    || !Array.isArray(manifest.parts) || !manifest.parts.length
    || manifest.parts.some((part) => !object(part) || !exactKeys(part, PART_KEYS))
    || !Number.isSafeInteger(manifest.recordCount) || manifest.recordCount !== counts.retainedCount
    || !sha(manifest.stageOneOrderDigest)
    || manifest.candidateSpace.provenanceDigest !== candidateSpaceProvenanceDigest(manifest.candidateSpace)
    || !validShards(manifest.stageOneShards, manifest.config.candidateCount)
    || !validShards(manifest.stageTwoShards, manifest.recordCount)
    || manifest.stageOneProvenanceDigest !== provenanceDigest(manifest.stageOneShards)
    || manifest.stageTwoProvenanceDigest !== provenanceDigest(manifest.stageTwoShards)
    || !object(reservoir)
    || !exactKeys(reservoir, manifest.schemaVersion === CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION
      ? RESERVOIR_KEYS_V2 : RESERVOIR_KEYS_V1)
    || fixedJson(reservoir) !== reservoirText
    || ![ORDERED_PRODUCT_SCHEMA_VERSION, CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION].includes(manifest.schemaVersion)) {
    throw new Error('Ordered product split ranked manifest or reservoir shape is invalid.');
  }
  const membership = manifest.schemaVersion === CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION
    ? createCurrentOrderedProductMembershipValidator(manifest.productIdentity as CurrentOrderedProductIdentity)
    : undefined;
  const stageOneDigests = Buffer.alloc(manifest.recordCount * 32);
  const seenStageOneRanks = new Uint8Array(manifest.recordCount);
  const seenIds = new Set<string>(), seenCanonicals = new Set<string>();
  const prefix: OrderedProductRankedRecord[] = [];
  let expectedStart = 0, recordCount = 0, previous: OrderedProductRankedRecord | undefined;
  const partFiles = new Set<string>();
  for (const part of manifest.parts) {
    if (!Number.isSafeInteger(part.startIndex) || !Number.isSafeInteger(part.endIndex)
      || !Number.isSafeInteger(part.count) || part.startIndex !== expectedStart || part.count < 1
      || part.endIndex !== part.startIndex + part.count || !sha(part.sha256)
      || partFiles.has(part.file)) throw new Error('Ordered product ranked part ranges are invalid.');
    partFiles.add(part.file);
    const partFile = safePartFile(input.rankedPath, part.file);
    const count = await readPart(partFile, part.sha256, (raw) => {
      if (!object(raw) || !exactKeys(raw, RECORD_KEYS)) {
        throw new Error(`Ordered product ranked record ${recordCount + 1} has unexpected fields.`);
      }
      const record = raw as unknown as OrderedProductRankedRecord;
      if (!validateOrderedProductRankedRecord(record) || membership && !membership(record)
        || record.rank !== recordCount + 1 || record.stageOneRank < 1
        || record.stageOneRank > manifest.recordCount || seenStageOneRanks[record.stageOneRank - 1]
        || previous && compareRankedRecords(previous, record) > 0 || seenIds.has(record.displayId)
        || seenCanonicals.has(record.canonicalStrategy)) {
        throw new Error(`Ordered product ranked record ${recordCount + 1} is invalid or out of order.`);
      }
      seenStageOneRanks[record.stageOneRank - 1] = 1;
      stageOneEntryDigest(record).copy(stageOneDigests, (record.stageOneRank - 1) * 32);
      seenIds.add(record.displayId); seenCanonicals.add(record.canonicalStrategy);
      if (prefix.length < counts.reservoirCount) prefix.push(record);
      previous = record; recordCount += 1;
    });
    if (count !== part.count) throw new Error(`Ordered product ranked part count differs: ${part.file}`);
    expectedStart = part.endIndex;
  }
  if (recordCount !== manifest.recordCount || expectedStart !== manifest.recordCount
    || createHash('sha256').update(stageOneDigests).digest('hex') !== manifest.stageOneOrderDigest
    || !exact(prefix, reservoir.entries)) {
    throw new Error('Ordered product ranked parts, stage-one digest, or reservoir prefix differ.');
  }
  const validated = validateOrderedCalibrationSourceForCounts({ kingdomId: input.kingdomId,
    ranked: manifest, reservoir, rankedSha256, reservoirSha256 }, counts);
  return { manifest, reservoir, rankedSha256, reservoirSha256,
    source: validated.source, strategies: validated.strategies };
}
