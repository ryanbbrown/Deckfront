import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';
import { nativeRuleFingerprint, nativeScoreBatchRequest } from '../src/sim/nativeGoldfishProtocol';
import {
  CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION, CURRENT_ORDERED_PRODUCT_VERSION,
  ORDERED_PRODUCT_COLLISION_ALLOWANCE, ORDERED_PRODUCT_KINGDOM, ORDERED_PRODUCT_PROFILES,
  ORDERED_PRODUCT_SCHEMA_VERSION, ORDERED_PRODUCT_SEEDS, ORDERED_PRODUCT_SPACE_COUNT,
  candidateSpaceProvenanceDigest, combineScoreEvidence, compactProfileEvidence,
  compareRankedRecords, compareStageOneRecords, createCurrentOrderedProductMembershipValidator,
  deriveCurrentOrderedProductIdentity, fixedJson,
  legacyOrderedProductSeedsValid, legacyOrderedProductTarget, provenanceDigest, rankingKey, sha256Bytes,
  validateOrderedProductRankedRecord, validateOrderedProductStageOneRecord
} from '../src/sim/orderedGoldfishProduct';
import type {
  CurrentOrderedProductIdentity, OrderedProductConfig, OrderedProductRankedArtifact,
  OrderedProductRankedRecord, OrderedProductShardProvenance, OrderedProductStageOneRecord,
  OrderedProductTarget
} from '../src/sim/orderedGoldfishProduct';
import {
  coprimeTraversalConfig, createOrderedCandidateSpace, orderedGoldfishCardIds
} from '../src/sim/orderedGoldfishBenchmark';
import { canonicalStrategy, stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';

const PART_SIZE = 10_000;
type Stage = 'stage-one' | 'stage-two';
interface Checkpoint {
  schemaVersion: number; version: string; productIdentity?: CurrentOrderedProductIdentity;
  stage: Stage; runId: string; buildVersion: string;
  ruleFingerprint: string; scorerVersion: string; config: OrderedProductConfig;
  shard: OrderedProductShardProvenance; recordsFile: string; recordsSha256: string;
  contentDigest: string;
}
interface Part { file: string; startIndex: number; endIndex: number; count: number; sha256: string }
interface CohortManifest {
  schemaVersion: number; version: string; productIdentity?: CurrentOrderedProductIdentity;
  runId: string; buildVersion: string;
  ruleFingerprint: string; scorerVersion: string; config: OrderedProductConfig;
  shards: OrderedProductShardProvenance[]; provenanceDigest: string; recordCount: number;
  stageOneOrderDigest: string; parts: Part[]; contentDigest: string;
}
type RankedHeader = Omit<OrderedProductRankedArtifact, 'records'>;
interface RankedManifest extends RankedHeader {
  recordCount: number; stageOneOrderDigest: string; parts: Part[];
}
interface ReservoirArtifact {
  schemaVersion: number; version: string; productIdentityHash?: string;
  sourceArtifactSha256: string; runId: string;
  reservoirCount: number; entries: OrderedProductRankedRecord[];
}

function option(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`), value = index < 0 ? fallback : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}
function integer(name: string, fallback?: number): number {
  const value = Number(option(name, fallback === undefined ? undefined : String(fallback)));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a nonnegative integer.`);
  return value;
}
function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, text); fs.renameSync(temporary, file);
}
function writeHashed(file: string, value: unknown): string {
  const text = fixedJson(value), digest = sha256Bytes(text);
  writeAtomic(file, text); writeAtomic(`${file}.sha256`, `${digest}  ${path.basename(file)}\n`); return digest;
}
function identityOption(optionName: string, artifactKey: 'buildVersion' | 'scorerVersion', fallback?: string): string {
  const index = process.argv.indexOf(`--${optionName}`);
  if (index >= 0) return option(optionName);
  const artifactIndex = process.argv.indexOf('--artifact');
  if (artifactIndex >= 0) {
    const value = readJson<Record<string, unknown>>(process.argv[artifactIndex + 1]!)[artifactKey];
    if (typeof value === 'string' && value) return value;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`--${optionName} is required for current ordered-product evidence.`);
}
const productSchemaVersion = Number(option('schema-version', String(ORDERED_PRODUCT_SCHEMA_VERSION)));
if (productSchemaVersion !== ORDERED_PRODUCT_SCHEMA_VERSION
  && productSchemaVersion !== CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION) throw new Error('--schema-version must be 1 or 2.');
const requestedKingdomId = option('kingdom', ORDERED_PRODUCT_KINGDOM);
const productSeeds = option('seeds', ORDERED_PRODUCT_SEEDS.join(',')).split(',').map((value) => Number(value));
if (productSeeds.length !== 4 || new Set(productSeeds).size !== 4
  || productSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)
  || productSchemaVersion === ORDERED_PRODUCT_SCHEMA_VERSION
    && !legacyOrderedProductSeedsValid(requestedKingdomId, productSeeds)) {
  throw new Error(`--seeds is not valid for ordered product schema ${productSchemaVersion}.`);
}
let currentProductIdentity: CurrentOrderedProductIdentity | undefined;
let currentMembership: ((record: OrderedProductStageOneRecord) => boolean) | undefined;
let productTarget: OrderedProductTarget = productSchemaVersion === ORDERED_PRODUCT_SCHEMA_VERSION
  ? legacyOrderedProductTarget(requestedKingdomId)
  : { kingdomId: requestedKingdomId, version: CURRENT_ORDERED_PRODUCT_VERSION,
    authorization: '', candidateProvenanceDigest: '' };
function identityFields(): { productIdentity?: CurrentOrderedProductIdentity } {
  return currentProductIdentity ? { productIdentity: currentProductIdentity } : {};
}
function identityValid(value: { productIdentity?: CurrentOrderedProductIdentity }): boolean {
  return productSchemaVersion === ORDERED_PRODUCT_SCHEMA_VERSION ? value.productIdentity === undefined
    : JSON.stringify(value.productIdentity) === JSON.stringify(currentProductIdentity);
}

function config(): OrderedProductConfig {
  const retainedCount = integer('retained-count', 500_000), reservoirCount = integer('reservoir-count', 20_000);
  if (retainedCount < 1 || reservoirCount < 1 || reservoirCount > retainedCount) {
    throw new Error('Reservoir count must be positive and no greater than retained count.');
  }
  return { kingdomId: productTarget.kingdomId, candidateCount: ORDERED_PRODUCT_SPACE_COUNT,
    retainedCount, reservoirCount, seeds: [...productSeeds], profiles: [...ORDERED_PRODUCT_PROFILES],
    turnLimit: 30, actionCapPerTurn: 200, collisionAllowance: ORDERED_PRODUCT_COLLISION_ALLOWANCE };
}
function expectedConfig(value: OrderedProductConfig): boolean {
  return JSON.stringify(value) === JSON.stringify(config());
}
function unsignedDigest<T extends { contentDigest: string }>(value: T): string {
  const unsigned = { ...value }; delete (unsigned as Partial<T>).contentDigest;
  return stableHash(JSON.stringify(unsigned));
}
function manifestFiles(): string[] {
  const value = readJson<unknown>(option('manifest'));
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error('Manifest must list paths.');
  return value as string[];
}
function recordFile(checkpointFile: string, checkpoint: Checkpoint): string {
  return path.resolve(path.dirname(checkpointFile), checkpoint.recordsFile);
}
function lineDigestText(record: OrderedProductStageOneRecord): string {
  return `${rankingKey(record.stageOne).join('\t')}\t${record.displayId}\t${record.canonicalStrategy}\t${record.traversalPosition}`;
}
function combinedDigestText(record: OrderedProductRankedRecord): string {
  return `${rankingKey(record.combined).join('\t')}\t${record.displayId}\t${record.canonicalStrategy}\t${record.traversalPosition}`;
}
function stageOneEntryDigest(record: OrderedProductStageOneRecord): Buffer {
  return createHash('sha256').update(lineDigestText(record)).digest();
}
function writeJsonLines<T>(file: string, records: readonly T[]): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`, descriptor = fs.openSync(temporary, 'w');
  const hash = createHash('sha256');
  try {
    for (const record of records) { const line = `${JSON.stringify(record)}\n`; fs.writeSync(descriptor, line); hash.update(line); }
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file); return hash.digest('hex');
}
async function* readLines<T>(file: string, expectedSha: string): AsyncGenerator<T> {
  const hash = createHash('sha256'); let count = 0;
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) { hash.update(`${line}\n`); count += 1; yield JSON.parse(line) as T; }
  if (hash.digest('hex') !== expectedSha) throw new Error(`Part digest differs: ${file}`);
  if (!count && fs.statSync(file).size) throw new Error(`Part is unreadable: ${file}`);
}
async function checkpointRecords<T extends OrderedProductStageOneRecord>(
  checkpointFile: string, checkpoint: Checkpoint, validate: (record: T) => boolean,
  compare: (left: T, right: T) => number
): Promise<AsyncGenerator<T>> {
  async function* held(): AsyncGenerator<T> {
    let count = 0, previous: T | undefined;
    for await (const record of readLines<T>(recordFile(checkpointFile, checkpoint), checkpoint.recordsSha256)) {
      if (!validate(record) || (currentMembership && !currentMembership(record))
        || (previous && compare(previous, record) > 0)) throw new Error('Checkpoint records are invalid or unsorted.');
      previous = record; count += 1; yield record;
    }
    if (count !== checkpoint.shard.retainedCount) throw new Error('Checkpoint retained count differs.');
  }
  return held();
}
function checkpointHeaderValid(value: Checkpoint, expectedStage: Stage): boolean {
  const unsigned = { ...value, shard: { ...value.shard, contentDigest: '' } };
  delete (unsigned as Partial<Checkpoint>).contentDigest;
  return value.schemaVersion === productSchemaVersion && value.version === productTarget.version
    && identityValid(value) && value.stage === expectedStage && expectedConfig(value.config)
    && value.shard.contentDigest === value.contentDigest
    && value.contentDigest === stableHash(JSON.stringify(unsigned))
    && value.shard.retainedCount <= value.shard.completeCount && /^[0-9a-f]{64}$/.test(value.recordsSha256);
}
function makeCheckpoint(
  stage: Stage, shard: Omit<OrderedProductShardProvenance, 'contentDigest'>,
  recordsFile: string, recordsSha256: string
): Checkpoint {
  const base = { schemaVersion: productSchemaVersion, version: productTarget.version, ...identityFields(), stage,
    runId: option('run-id'), buildVersion: option('build-version'), ruleFingerprint: option('rule-fingerprint'),
    scorerVersion: option('scorer-version', 'native-goldfish-v1'), config: config(),
    shard: { ...shard, contentDigest: '' }, recordsFile: path.basename(recordsFile), recordsSha256,
    contentDigest: '' };
  const contentDigest = unsignedDigest(base);
  return { ...base, shard: { ...base.shard, contentDigest }, contentDigest };
}
function nativeScores(file: string): unknown[] {
  const response = readJson<{ ok: boolean; result?: { scores?: unknown[] }; error?: unknown }>(file);
  if (!response.ok || !Array.isArray(response.result?.scores)) throw new Error(`Native scoring failed: ${JSON.stringify(response.error)}`);
  return response.result.scores;
}
function rawIdentity(raw: unknown): { strategyId: string; collisionTieKey: string } {
  if (typeof raw !== 'object' || raw === null) throw new Error('Native score is invalid.');
  const value = raw as Record<string, unknown>;
  if (typeof value.strategyId !== 'string' || typeof value.collisionTieKey !== 'string') throw new Error('Native identity is invalid.');
  return { strategyId: value.strategyId, collisionTieKey: value.collisionTieKey };
}

interface HeapEntry<T> { value: T; source: number; iterator: AsyncIterator<T> }
async function* mergeSorted<T>(iterators: AsyncIterator<T>[], compare: (left: T, right: T) => number): AsyncGenerator<T> {
  const heap: HeapEntry<T>[] = [];
  const less = (left: HeapEntry<T>, right: HeapEntry<T>): boolean => compare(left.value, right.value) < 0;
  const push = (entry: HeapEntry<T>): void => {
    heap.push(entry); let index = heap.length - 1;
    while (index) { const parent = Math.floor((index - 1) / 2); if (!less(heap[index]!, heap[parent]!)) break;
      [heap[index], heap[parent]] = [heap[parent]!, heap[index]!]; index = parent; }
  };
  for (let source = 0; source < iterators.length; source += 1) {
    const iterator = iterators[source]!, next = await iterator.next();
    if (!next.done) push({ value: next.value, source, iterator });
  }
  while (heap.length) {
    const first = heap[0]!, last = heap.pop()!;
    if (heap.length) { heap[0] = last; let index = 0;
      for (;;) { const left = index * 2 + 1, right = left + 1;
        let best = index; if (left < heap.length && less(heap[left]!, heap[best]!)) best = left;
        if (right < heap.length && less(heap[right]!, heap[best]!)) best = right;
        if (best === index) break; [heap[index], heap[best]] = [heap[best]!, heap[index]!]; index = best; }
    }
    yield first.value;
    const next = await first.iterator.next(); if (!next.done) push({ ...first, value: next.value });
  }
}
async function writeParts<T>(
  manifestFile: string, records: AsyncIterable<T>, limit: number,
  map: (record: T, index: number) => unknown
): Promise<{ parts: Part[]; count: number }> {
  const parts: Part[] = []; let buffer: unknown[] = [], count = 0;
  const flush = (): void => {
    if (!buffer.length) return;
    const partFile = `${manifestFile}.part-${parts.length.toString().padStart(4, '0')}.jsonl`;
    const startIndex = count - buffer.length, sha256 = writeJsonLines(partFile, buffer);
    parts.push({ file: path.basename(partFile), startIndex, endIndex: count, count: buffer.length, sha256 }); buffer = [];
  };
  for await (const record of records) {
    if (count === limit) break; buffer.push(map(record, count)); count += 1;
    if (buffer.length === PART_SIZE) flush();
  }
  flush(); return { parts, count };
}
async function* readParts<T>(manifestFile: string, parts: readonly Part[]): AsyncGenerator<T> {
  let expected = 0;
  for (const part of parts) {
    if (part.startIndex !== expected || part.endIndex - part.startIndex !== part.count) throw new Error('Part ranges are invalid.');
    let count = 0;
    for await (const record of readLines<T>(path.resolve(path.dirname(manifestFile), part.file), part.sha256)) {
      count += 1; yield record;
    }
    if (count !== part.count) throw new Error('Part count differs.'); expected = part.endIndex;
  }
}
function validateCheckpointSet(checkpoints: Array<{ file: string; value: Checkpoint }>, stage: Stage, total: number): void {
  checkpoints.sort((left, right) => left.value.shard.startPosition - right.value.shard.startPosition);
  if (!checkpoints.length || checkpoints[0]!.value.shard.startPosition !== 0
    || checkpoints.at(-1)!.value.shard.endPosition !== total) throw new Error(`${stage} coverage is incomplete.`);
  checkpoints.forEach(({ value }, index) => {
    const first = checkpoints[0]!.value;
    if (!checkpointHeaderValid(value, stage) || value.shard.shardId !== index
      || value.shard.completeCount !== value.shard.endPosition - value.shard.startPosition
      || (index && checkpoints[index - 1]!.value.shard.endPosition !== value.shard.startPosition)
      || value.runId !== first.runId || value.buildVersion !== first.buildVersion
      || value.ruleFingerprint !== first.ruleFingerprint || value.scorerVersion !== first.scorerVersion) {
      throw new Error(`${stage} checkpoints are stale, corrupt, or noncontiguous.`);
    }
  });
}
function cohortHeaderValid(value: CohortManifest): boolean {
  return value.schemaVersion === productSchemaVersion && value.version === productTarget.version
    && identityValid(value) && expectedConfig(value.config) && value.recordCount === value.config.retainedCount
    && value.provenanceDigest === provenanceDigest(value.shards) && value.contentDigest === unsignedDigest(value);
}
async function readCohortRange(file: string, cohort: CohortManifest, start: number, end: number): Promise<Array<OrderedProductStageOneRecord & { stageOneRank: number }>> {
  if (!cohortHeaderValid(cohort) || start < 0 || end < start || end > cohort.recordCount) throw new Error('Cohort or range is invalid.');
  const result: Array<OrderedProductStageOneRecord & { stageOneRank: number }> = [];
  for (const part of cohort.parts.filter((entry) => entry.endIndex > start && entry.startIndex < end)) {
    let index = part.startIndex;
    for await (const record of readLines<OrderedProductStageOneRecord & { stageOneRank: number }>(
      path.resolve(path.dirname(file), part.file), part.sha256)) {
      if (index >= start && index < end) result.push(record); index += 1;
    }
  }
  if (result.length !== end - start || result.some((record, index) =>
    !validateOrderedProductStageOneRecord(record) || currentMembership && !currentMembership(record)
      || record.stageOneRank !== start + index + 1)) {
    throw new Error('Cohort records are invalid.');
  }
  return result;
}
function candidateSpace(): RankedManifest['candidateSpace'] {
  const space = createOrderedCandidateSpace(orderedGoldfishCardIds(productTarget.kingdomId));
  const value = { generator: 'ordered-typescript-five-rung-v1', traversal: 'coprime-position-v1',
    cardIds: [...space.cardIds], quantityVectors: space.quantityVectors.map((entry) => [...entry]),
    skeletonCount: space.skeletonCount, candidateCount: space.candidateCount,
    ...coprimeTraversalConfig(space.candidateCount), provenanceDigest: '' };
  value.provenanceDigest = candidateSpaceProvenanceDigest(value); return value;
}
async function validateRankedManifest(file: string): Promise<{ manifest: RankedManifest; sha256: string }> {
  const text = fs.readFileSync(file, 'utf8'), sha256 = sha256Bytes(text);
  const expected = fs.readFileSync(option('sha256', `${file}.sha256`), 'utf8').trim().split(/\s+/)[0];
  const value = JSON.parse(text) as RankedManifest;
  if (sha256 !== expected || fixedJson(value) !== text || value.schemaVersion !== productSchemaVersion
    || value.version !== productTarget.version || !identityValid(value) || !expectedConfig(value.config)
    || value.recordCount !== value.config.retainedCount
    || value.candidateSpace.provenanceDigest !== productTarget.candidateProvenanceDigest
    || value.candidateSpace.provenanceDigest !== candidateSpaceProvenanceDigest(value.candidateSpace)
    || provenanceDigest(value.stageOneShards) !== value.stageOneProvenanceDigest
    || provenanceDigest(value.stageTwoShards) !== value.stageTwoProvenanceDigest) throw new Error('Ranked manifest is invalid.');
  const rankDigests = Buffer.alloc(value.recordCount * 32), seenRanks = new Uint8Array(value.recordCount);
  let count = 0, previous: OrderedProductRankedRecord | undefined;
  for await (const record of readParts<OrderedProductRankedRecord>(file, value.parts)) {
    if (!validateOrderedProductRankedRecord(record)
      || (currentMembership && !currentMembership(record))
      || record.rank !== count + 1
      || record.stageOneRank < 1 || record.stageOneRank > value.recordCount
      || seenRanks[record.stageOneRank - 1] || (previous && compareRankedRecords(previous, record) > 0)) {
      throw new Error('Ranked record identity, evidence, membership, or order is invalid.');
    }
    seenRanks[record.stageOneRank - 1] = 1;
    stageOneEntryDigest(record).copy(rankDigests, (record.stageOneRank - 1) * 32);
    previous = record; count += 1;
  }
  if (count !== value.recordCount || createHash('sha256').update(rankDigests).digest('hex') !== value.stageOneOrderDigest) {
    throw new Error('Ranked membership or stage-one rank digest differs.');
  }
  return { manifest: value, sha256 };
}

const mode = process.argv[2];
const kingdom = strategySearchKingdom(productTarget.kingdomId);
if (productSchemaVersion === CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION) {
  currentProductIdentity = deriveCurrentOrderedProductIdentity({ kingdomId: requestedKingdomId, seeds: productSeeds,
    scorerVersion: identityOption('scorer-version', 'scorerVersion', 'native-goldfish-v1'),
    buildVersion: identityOption('build-version', 'buildVersion') });
  currentMembership = createCurrentOrderedProductMembershipValidator(currentProductIdentity);
  productTarget = { ...productTarget, candidateProvenanceDigest: currentProductIdentity.candidateProvenanceDigest };
  if (currentProductIdentity.candidateCount !== ORDERED_PRODUCT_SPACE_COUNT) {
    throw new Error(`Derived candidate count is ${currentProductIdentity.candidateCount}; expected ${ORDERED_PRODUCT_SPACE_COUNT}.`);
  }
}

if (mode === 'validate-checkpoint') {
  const file = option('checkpoint'), value = readJson<Checkpoint>(file), stage = option('stage') as Stage;
  if (!checkpointHeaderValid(value, stage) || value.runId !== option('run-id')
    || value.buildVersion !== option('build-version') || value.ruleFingerprint !== option('rule-fingerprint')
    || value.scorerVersion !== option('scorer-version', 'native-goldfish-v1')
    || value.shard.shardId !== integer('shard-id') || value.shard.startPosition !== integer('start-position')
    || value.shard.endPosition !== integer('end-position')) throw new Error('Checkpoint header differs.');
  const validate = stage === 'stage-one' ? validateOrderedProductStageOneRecord : validateOrderedProductRankedRecord;
  const compare = stage === 'stage-one' ? compareStageOneRecords : compareRankedRecords;
  let count = 0;
  for await (const record of await checkpointRecords(file, value, validate as never, compare as never)) {
    void record; count += 1;
  }
  console.log(JSON.stringify({ valid: true, contentDigest: value.contentDigest, retainedCount: count }));
} else if (mode === 'stage-one-checkpoint') {
  const request = readJson<{ payload: { kingdom: { id: string }; seeds: number[];
    strategies: Array<Strategy & { canonicalStrategy: string }> } }>(option('request'));
  const metadata = readJson<{ kingdomId: string; candidateDigest: string; completeCount: number;
    ruleFingerprint: string; shuffleSeeds: number[] }>(option('metadata'));
  const scores = nativeScores(option('response')), start = integer('start-position'), end = integer('end-position');
  if (request.payload.strategies.length !== scores.length || scores.length !== end - start
    || request.payload.kingdom.id !== productTarget.kingdomId
    || JSON.stringify(request.payload.seeds) !== JSON.stringify(productSeeds.slice(0, 1))
    || metadata.kingdomId !== productTarget.kingdomId || metadata.completeCount !== scores.length
    || JSON.stringify(metadata.shuffleSeeds) !== JSON.stringify(productSeeds.slice(0, 1))
    || metadata.ruleFingerprint !== option('rule-fingerprint')) throw new Error('Stage-one inputs differ.');
  const records = scores.map((raw, index): OrderedProductStageOneRecord => {
    const input = request.payload.strategies[index]!, identity = rawIdentity(raw);
    const strategy: Strategy = { id: input.id, startingBuild: input.startingBuild, buyPlan: input.buyPlan };
    if (identity.strategyId !== strategy.id || identity.collisionTieKey !== canonicalStrategy(strategy)) throw new Error('Stage-one identity differs.');
    const stageOne = compactProfileEvidence(raw);
    return { traversalPosition: start + index, displayId: strategy.id, canonicalStrategy: canonicalStrategy(strategy),
      strategy, stageOne, stageOneRankingKey: rankingKey(stageOne) };
  }).sort(compareStageOneRecords).slice(0, config().retainedCount + config().collisionAllowance);
  const output = option('out'), recordsFile = `${output}.records.jsonl`, recordsSha256 = writeJsonLines(recordsFile, records);
  const scoreDigest = stableHash([...records].sort((left, right) => left.traversalPosition - right.traversalPosition)
    .map(lineDigestText).join('\n'));
  const checkpoint = makeCheckpoint('stage-one', { shardId: integer('shard-id'), startPosition: start,
    endPosition: end, completeCount: end - start, retainedCount: records.length,
    candidateDigest: metadata.candidateDigest, scoreDigest }, recordsFile, recordsSha256);
  writeAtomic(output, fixedJson(checkpoint));
} else if (mode === 'merge-stage-one') {
  const checkpoints = manifestFiles().map((file) => ({ file, value: readJson<Checkpoint>(file) }));
  validateCheckpointSet(checkpoints, 'stage-one', ORDERED_PRODUCT_SPACE_COUNT);
  const iterators = await Promise.all(checkpoints.map(({ file, value }) => checkpointRecords(
    file, value, validateOrderedProductStageOneRecord, compareStageOneRecords)));
  const merged = mergeSorted(iterators.map((entry) => entry[Symbol.asyncIterator]()), compareStageOneRecords);
  const seenCanonical = new Set<string>(), seenDisplay = new Set<string>();
  const selected = async function* (): AsyncGenerator<OrderedProductStageOneRecord> {
    for await (const record of merged) {
      if (seenCanonical.has(record.canonicalStrategy) || seenDisplay.has(record.displayId)) continue;
      seenCanonical.add(record.canonicalStrategy); seenDisplay.add(record.displayId); yield record;
    }
  };
  const output = option('out'), first = checkpoints[0]!.value;
  const rankHash = createHash('sha256');
  const written = await writeParts(output, selected(), first.config.retainedCount, (record, index) => {
    rankHash.update(stageOneEntryDigest(record)); return { ...record, stageOneRank: index + 1 };
  });
  if (written.count !== first.config.retainedCount) throw new Error('Stage one retained cohort is incomplete.');
  const base = { schemaVersion: productSchemaVersion, version: productTarget.version, ...identityFields(),
    runId: first.runId, buildVersion: first.buildVersion, ruleFingerprint: first.ruleFingerprint,
    scorerVersion: first.scorerVersion, config: first.config, shards: checkpoints.map(({ value }) => value.shard),
    provenanceDigest: provenanceDigest(checkpoints.map(({ value }) => value.shard)), recordCount: written.count,
    stageOneOrderDigest: rankHash.digest('hex'), parts: written.parts, contentDigest: '' };
  writeAtomic(output, fixedJson({ ...base, contentDigest: unsignedDigest(base) }));
} else if (mode === 'validate-cohort') {
  const file = option('cohort'), cohort = readJson<CohortManifest>(file);
  if (!cohortHeaderValid(cohort)) throw new Error('Cohort header is invalid.');
  const rankHash = createHash('sha256'); let count = 0;
  for await (const record of readParts<OrderedProductStageOneRecord & { stageOneRank: number }>(file, cohort.parts)) {
    if (!validateOrderedProductStageOneRecord(record) || currentMembership && !currentMembership(record)
      || record.stageOneRank !== count + 1) throw new Error('Cohort membership or rank is invalid.');
    rankHash.update(stageOneEntryDigest(record)); count += 1;
  }
  if (count !== cohort.recordCount || rankHash.digest('hex') !== cohort.stageOneOrderDigest) {
    throw new Error('Cohort count or stage-one order digest differs.');
  }
  console.log(JSON.stringify({ cohort: file, retainedCount: count, contentDigest: cohort.contentDigest }));
} else if (mode === 'stage-two-input') {
  const file = option('cohort'), cohort = readJson<CohortManifest>(file);
  const start = integer('start-position'), end = integer('end-position'), records = await readCohortRange(file, cohort, start, end);
  if (cohort.ruleFingerprint !== nativeRuleFingerprint(productTarget.kingdomId, 30, 200)) throw new Error('Cohort rules differ.');
  const request = nativeScoreBatchRequest(kingdom, records.map((entry) => entry.strategy),
    { kingdomId: productTarget.kingdomId, seeds: productSeeds.slice(1), turnLimit: 30,
      actionCapPerTurn: 200 }, integer('threads'), 'full');
  fs.writeFileSync(option('request'), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(option('metadata'), fixedJson({ kingdomId: productTarget.kingdomId,
    completeCount: end - start,
    candidateDigest: stableHash(records.map((entry) => entry.canonicalStrategy).join('\n')),
    ruleFingerprint: nativeRuleFingerprint(productTarget.kingdomId, 30, 200),
    shuffleSeeds: productSeeds.slice(1) }));
} else if (mode === 'stage-two-checkpoint') {
  const cohortFile = option('cohort'), cohort = readJson<CohortManifest>(cohortFile);
  const start = integer('start-position'), end = integer('end-position');
  const held = await readCohortRange(cohortFile, cohort, start, end), scores = nativeScores(option('response'));
  const metadata = readJson<{ kingdomId: string; candidateDigest: string; ruleFingerprint: string;
    shuffleSeeds: number[] }>(option('metadata'));
  if (scores.length !== held.length || metadata.kingdomId !== productTarget.kingdomId
    || JSON.stringify(metadata.shuffleSeeds) !== JSON.stringify(productSeeds.slice(1))
    || metadata.ruleFingerprint !== cohort.ruleFingerprint) throw new Error('Stage-two inputs differ.');
  const records = scores.map((raw, index): OrderedProductRankedRecord => {
    const first = held[index]!, identity = rawIdentity(raw);
    if (identity.strategyId !== first.displayId || identity.collisionTieKey !== first.canonicalStrategy) throw new Error('Stage-two identity differs.');
    const additional = compactProfileEvidence(raw), combined = combineScoreEvidence(first.stageOne, additional);
    return { ...first, additional, combined, combinedRankingKey: rankingKey(combined), rank: 0 };
  }).sort(compareRankedRecords);
  const output = option('out'), recordsFile = `${output}.records.jsonl`, recordsSha256 = writeJsonLines(recordsFile, records);
  const checkpoint = makeCheckpoint('stage-two', { shardId: integer('shard-id'), startPosition: start,
    endPosition: end, completeCount: records.length, retainedCount: records.length,
    candidateDigest: metadata.candidateDigest, scoreDigest: stableHash(records.map(combinedDigestText).join('\n')) },
  recordsFile, recordsSha256);
  writeAtomic(output, fixedJson(checkpoint));
} else if (mode === 'finalize') {
  const cohortFile = option('cohort'), cohort = readJson<CohortManifest>(cohortFile);
  if (!cohortHeaderValid(cohort)) throw new Error('Cohort header is invalid.');
  const checkpoints = manifestFiles().map((file) => ({ file, value: readJson<Checkpoint>(file) }));
  validateCheckpointSet(checkpoints, 'stage-two', cohort.config.retainedCount);
  const iterators = await Promise.all(checkpoints.map(({ file, value }) => checkpointRecords(
    file, value, validateOrderedProductRankedRecord, compareRankedRecords)));
  const output = option('out'), written = await writeParts(output,
    mergeSorted(iterators.map((entry) => entry[Symbol.asyncIterator]()), compareRankedRecords),
    cohort.config.retainedCount, (record, index) => ({ ...record, rank: index + 1 }));
  if (written.count !== cohort.config.retainedCount) throw new Error('Ranked artifact is incomplete.');
  const manifest: RankedManifest = { schemaVersion: productSchemaVersion, version: productTarget.version,
    ...identityFields(), runId: cohort.runId, buildVersion: cohort.buildVersion, ruleFingerprint: cohort.ruleFingerprint,
    scorerVersion: cohort.scorerVersion, config: cohort.config, candidateSpace: candidateSpace(),
    stageOneShards: cohort.shards, stageTwoShards: checkpoints.map(({ value }) => value.shard),
    stageOneProvenanceDigest: cohort.provenanceDigest,
    stageTwoProvenanceDigest: provenanceDigest(checkpoints.map(({ value }) => value.shard)),
    recordCount: written.count, stageOneOrderDigest: cohort.stageOneOrderDigest, parts: written.parts };
  const digest = writeHashed(output, manifest);
  console.log(JSON.stringify({ artifact: output, sha256: digest, retainedCount: written.count, partCount: written.parts.length }));
} else if (mode === 'validate') {
  const value = await validateRankedManifest(option('artifact'));
  console.log(JSON.stringify({ artifact: option('artifact'), sha256: value.sha256,
    retainedCount: value.manifest.recordCount, partCount: value.manifest.parts.length }));
} else if (mode === 'build-reservoir') {
  const file = option('artifact'), { manifest, sha256 } = await validateRankedManifest(file);
  const entries: OrderedProductRankedRecord[] = [];
  for await (const record of readParts<OrderedProductRankedRecord>(file, manifest.parts)) {
    if (entries.length < manifest.config.reservoirCount) entries.push(record); else break;
  }
  const reservoir: ReservoirArtifact = { schemaVersion: productSchemaVersion,
    version: productTarget.version,
    ...(currentProductIdentity && { productIdentityHash: currentProductIdentity.identityHash }),
    sourceArtifactSha256: sha256, runId: manifest.runId,
    reservoirCount: manifest.config.reservoirCount, entries };
  if (entries.length !== reservoir.reservoirCount) throw new Error('Reservoir prefix is incomplete.');
  const digest = writeHashed(option('out'), reservoir);
  console.log(JSON.stringify({ reservoir: option('out'), sha256: digest, count: entries.length,
    sourceArtifactSha256: sha256 }));
} else if (mode === 'validate-reservoir') {
  const artifactFile = option('artifact'), { manifest, sha256 } = await validateRankedManifest(artifactFile);
  const file = option('reservoir'), text = fs.readFileSync(file, 'utf8'), value = JSON.parse(text) as ReservoirArtifact;
  const expected = fs.readFileSync(option('sha256', `${file}.sha256`), 'utf8').trim().split(/\s+/)[0];
  const prefix: OrderedProductRankedRecord[] = [];
  for await (const record of readParts<OrderedProductRankedRecord>(artifactFile, manifest.parts)) {
    if (prefix.length < manifest.config.reservoirCount) prefix.push(record); else break;
  }
  if (sha256Bytes(text) !== expected || fixedJson(value) !== text || value.sourceArtifactSha256 !== sha256
    || value.productIdentityHash !== currentProductIdentity?.identityHash
    || value.runId !== manifest.runId || value.reservoirCount !== manifest.config.reservoirCount
    || JSON.stringify(value.entries) !== JSON.stringify(prefix)) throw new Error('Reservoir validation failed.');
  console.log(JSON.stringify({ reservoir: file, sha256: expected, count: prefix.length }));
} else throw new Error('Unknown ordered product mode.');
