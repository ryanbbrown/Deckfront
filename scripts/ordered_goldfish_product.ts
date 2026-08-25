import fs from 'node:fs';
import path from 'node:path';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { nativeScoreBatchRequest } from '../src/sim/nativeGoldfishProtocol';
import {
  ORDERED_PRODUCT_COLLISION_ALLOWANCE, ORDERED_PRODUCT_KINGDOM, ORDERED_PRODUCT_PROFILES,
  ORDERED_PRODUCT_SCHEMA_VERSION, ORDERED_PRODUCT_SEEDS, ORDERED_PRODUCT_SPACE_COUNT,
  ORDERED_PRODUCT_VERSION, buildOrderedProductReservoir, candidateSpaceProvenanceDigest,
  combineScoreEvidence, compactProfileEvidence, compareRankedRecords, fixedJson, provenanceDigest,
  rankingKey, retainOrderedProductRecords, sha256Bytes, validateOrderedProductArtifact,
  validateOrderedProductRankedRecord, validateOrderedProductReservoir,
  validateOrderedProductStageOneRecord
} from '../src/sim/orderedGoldfishProduct';
import type {
  OrderedProductConfig, OrderedProductRankedArtifact, OrderedProductRankedRecord,
  OrderedProductShardProvenance, OrderedProductStageOneRecord
} from '../src/sim/orderedGoldfishProduct';
import {
  coprimeTraversalConfig, createOrderedCandidateSpace, orderedGoldfishCardIds
} from '../src/sim/orderedGoldfishBenchmark';
import { nativeRuleFingerprint } from '../src/sim/nativeGoldfishProtocol';
import { canonicalStrategy, stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';

interface Checkpoint<T> {
  schemaVersion: number;
  version: string;
  stage: 'stage-one' | 'stage-two';
  runId: string;
  buildVersion: string;
  ruleFingerprint: string;
  scorerVersion: string;
  config: OrderedProductConfig;
  shard: OrderedProductShardProvenance;
  records: T[];
  contentDigest: string;
}
interface StageOneCohort {
  schemaVersion: number;
  version: string;
  runId: string;
  buildVersion: string;
  ruleFingerprint: string;
  scorerVersion: string;
  config: OrderedProductConfig;
  shards: OrderedProductShardProvenance[];
  provenanceDigest: string;
  records: Array<OrderedProductStageOneRecord & { stageOneRank: number }>;
  contentDigest: string;
}
function option(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? fallback : process.argv[index + 1];
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
function writeHashedArtifact(file: string, value: unknown): string {
  const text = fixedJson(value), digest = sha256Bytes(text);
  writeAtomic(file, text);
  writeAtomic(`${file}.sha256`, `${digest}  ${path.basename(file)}\n`);
  return digest;
}
function config(): OrderedProductConfig {
  const retainedCount = integer('retained-count', 500_000);
  const reservoirCount = integer('reservoir-count', 20_000);
  if (retainedCount < 1 || reservoirCount < 1 || reservoirCount > retainedCount) {
    throw new Error('Reservoir count must be positive and no greater than retained count.');
  }
  return { kingdomId: ORDERED_PRODUCT_KINGDOM, candidateCount: ORDERED_PRODUCT_SPACE_COUNT,
    retainedCount, reservoirCount, seeds: [...ORDERED_PRODUCT_SEEDS], profiles: [...ORDERED_PRODUCT_PROFILES],
    turnLimit: 30, actionCapPerTurn: 200, collisionAllowance: ORDERED_PRODUCT_COLLISION_ALLOWANCE };
}
function checkpointDigest<T>(checkpoint: Omit<Checkpoint<T>, 'contentDigest'>): string {
  return stableHash(JSON.stringify(checkpoint));
}
function cohortDigest(cohort: Omit<StageOneCohort, 'contentDigest'>): string {
  return stableHash(JSON.stringify(cohort));
}
function cohortValid(cohort: StageOneCohort): boolean {
  return cohort.contentDigest === cohortDigest({ ...cohort, contentDigest: undefined } as never)
    && JSON.stringify(cohort.config) === JSON.stringify(config())
    && cohort.provenanceDigest === provenanceDigest(cohort.shards)
    && cohort.records.length === cohort.config.retainedCount
    && cohort.records.every((entry, index) => validateOrderedProductStageOneRecord(entry)
      && entry.stageOneRank === index + 1);
}
function checkpointValid<T>(value: Checkpoint<T>, expectedStage: Checkpoint<T>['stage']): boolean {
  const unsigned = { ...value, shard: { ...value.shard, contentDigest: '' } };
  delete (unsigned as Partial<Checkpoint<T>>).contentDigest;
  if (value.schemaVersion !== ORDERED_PRODUCT_SCHEMA_VERSION || value.version !== ORDERED_PRODUCT_VERSION
    || value.stage !== expectedStage || value.shard.contentDigest !== value.contentDigest
    || value.shard.retainedCount !== value.records.length
    || value.contentDigest !== checkpointDigest(unsigned)) return false;
  return expectedStage === 'stage-one'
    ? (value.records as OrderedProductStageOneRecord[]).every(validateOrderedProductStageOneRecord)
    : (value.records as OrderedProductRankedRecord[]).every(validateOrderedProductRankedRecord);
}
function makeCheckpoint<T>(
  stage: Checkpoint<T>['stage'], records: T[], shard: Omit<OrderedProductShardProvenance, 'contentDigest'>
): Checkpoint<T> {
  const base = { schemaVersion: ORDERED_PRODUCT_SCHEMA_VERSION, version: ORDERED_PRODUCT_VERSION, stage,
    runId: option('run-id'), buildVersion: option('build-version'),
    ruleFingerprint: option('rule-fingerprint'), scorerVersion: option('scorer-version', 'native-goldfish-v1'),
    config: config(), shard: { ...shard, contentDigest: '' }, records };
  const contentDigest = checkpointDigest(base);
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
  if (typeof value.strategyId !== 'string' || typeof value.collisionTieKey !== 'string') {
    throw new Error('Native score identity is invalid.');
  }
  return { strategyId: value.strategyId, collisionTieKey: value.collisionTieKey };
}
function scoreDigest(records: readonly OrderedProductStageOneRecord[], field: 'stageOne' | 'combined'): string {
  return stableHash(records.map((record) => `${rankingKey(field === 'stageOne' ? record.stageOne
    : (record as OrderedProductRankedRecord).combined).join('\t')}\t${record.displayId}\t${record.canonicalStrategy}\t${record.traversalPosition}`).join('\n'));
}
function shardProvenance(checkpoint: Checkpoint<unknown>): OrderedProductShardProvenance {
  return checkpoint.shard;
}
function manifestFiles(): string[] {
  const manifest = readJson<unknown>(option('manifest'));
  if (!Array.isArray(manifest) || manifest.some((entry) => typeof entry !== 'string')) {
    throw new Error('Manifest must be a JSON array of checkpoint paths.');
  }
  return manifest as string[];
}
function validateCheckpointSet<T>(checkpoints: Checkpoint<T>[], stage: Checkpoint<T>['stage'], total: number): void {
  checkpoints.sort((left, right) => left.shard.startPosition - right.shard.startPosition);
  if (!checkpoints.length || checkpoints[0]!.shard.startPosition !== 0
    || checkpoints.at(-1)!.shard.endPosition !== total) throw new Error(`${stage} checkpoint coverage is incomplete.`);
  checkpoints.forEach((entry, index) => {
    if (!checkpointValid(entry, stage) || entry.shard.shardId !== index
      || entry.shard.completeCount !== entry.shard.endPosition - entry.shard.startPosition
      || (index && checkpoints[index - 1]!.shard.endPosition !== entry.shard.startPosition)
      || JSON.stringify(entry.config) !== JSON.stringify(checkpoints[0]!.config)
      || JSON.stringify(entry.config) !== JSON.stringify(config())
      || entry.runId !== checkpoints[0]!.runId || entry.buildVersion !== checkpoints[0]!.buildVersion
      || entry.ruleFingerprint !== checkpoints[0]!.ruleFingerprint
      || entry.scorerVersion !== checkpoints[0]!.scorerVersion) throw new Error(`${stage} checkpoint set is stale, corrupt, or noncontiguous.`);
  });
}

const mode = process.argv[2];
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === ORDERED_PRODUCT_KINGDOM)!;
registerKingdom(kingdom);

if (mode === 'validate-checkpoint') {
  const checkpoint = readJson<Checkpoint<unknown>>(option('checkpoint'));
  const stage = option('stage') as Checkpoint<unknown>['stage'];
  if (!checkpointValid(checkpoint, stage) || checkpoint.runId !== option('run-id')
    || checkpoint.buildVersion !== option('build-version')
    || checkpoint.ruleFingerprint !== option('rule-fingerprint')
    || checkpoint.scorerVersion !== option('scorer-version', 'native-goldfish-v1')
    || checkpoint.shard.shardId !== integer('shard-id')
    || checkpoint.shard.startPosition !== integer('start-position')
    || checkpoint.shard.endPosition !== integer('end-position')
    || JSON.stringify(checkpoint.config) !== JSON.stringify(config())) {
    throw new Error('Checkpoint does not match its expected schema and configuration.');
  }
  console.log(JSON.stringify({ valid: true, contentDigest: checkpoint.contentDigest,
    retainedCount: checkpoint.records.length }));
} else if (mode === 'stage-one-checkpoint') {
  const request = readJson<{ payload: { strategies: Array<Strategy & { canonicalStrategy: string }> } }>(option('request'));
  const metadata = readJson<{ candidateDigest: string; completeCount: number; ruleFingerprint: string }>(option('metadata'));
  const scores = nativeScores(option('response'));
  const start = integer('start-position'), end = integer('end-position');
  if (request.payload.strategies.length !== scores.length || scores.length !== end - start
    || metadata.completeCount !== scores.length
    || metadata.ruleFingerprint !== option('rule-fingerprint')) {
    throw new Error('Stage-one request, response, range, or rule fingerprint differs.');
  }
  const all = scores.map((raw, index): OrderedProductStageOneRecord => {
    const inputStrategy = request.payload.strategies[index]!, identity = rawIdentity(raw);
    const strategy: Strategy = { id: inputStrategy.id, startingBuild: inputStrategy.startingBuild,
      buyPlan: inputStrategy.buyPlan };
    if (identity.strategyId !== strategy.id || identity.collisionTieKey !== canonicalStrategy(strategy)) {
      throw new Error('Native stage-one identity differs from TypeScript generation.');
    }
    const stageOne = compactProfileEvidence(raw);
    return { traversalPosition: start + index, displayId: strategy.id,
      canonicalStrategy: canonicalStrategy(strategy), strategy, stageOne,
      stageOneRankingKey: rankingKey(stageOne) };
  });
  const retained = retainOrderedProductRecords(all, config().retainedCount, config().collisionAllowance);
  const checkpoint = makeCheckpoint('stage-one', retained, { shardId: integer('shard-id'),
    startPosition: start, endPosition: end, completeCount: all.length, retainedCount: retained.length,
    candidateDigest: metadata.candidateDigest, scoreDigest: scoreDigest(all, 'stageOne') });
  writeAtomic(option('out'), fixedJson(checkpoint));
} else if (mode === 'merge-stage-one') {
  const checkpoints = manifestFiles().map((file) => readJson<Checkpoint<OrderedProductStageOneRecord>>(file));
  validateCheckpointSet(checkpoints, 'stage-one', ORDERED_PRODUCT_SPACE_COUNT);
  const first = checkpoints[0]!;
  const retained = retainOrderedProductRecords(checkpoints.flatMap((entry) => entry.records),
    first.config.retainedCount, 0).slice(0, first.config.retainedCount);
  if (retained.length !== first.config.retainedCount) throw new Error('Stage one did not produce the retained cohort.');
  const records = retained.map((entry, index) => ({ ...entry, stageOneRank: index + 1 }));
  const base = { schemaVersion: ORDERED_PRODUCT_SCHEMA_VERSION, version: ORDERED_PRODUCT_VERSION,
    runId: first.runId, buildVersion: first.buildVersion, ruleFingerprint: first.ruleFingerprint,
    scorerVersion: first.scorerVersion, config: first.config, shards: checkpoints.map(shardProvenance),
    provenanceDigest: provenanceDigest(checkpoints.map(shardProvenance)), records };
  writeAtomic(option('out'), fixedJson({ ...base, contentDigest: cohortDigest(base) }));
} else if (mode === 'stage-two-input') {
  const cohort = readJson<StageOneCohort>(option('cohort'));
  if (!cohortValid(cohort) || cohort.ruleFingerprint !== nativeRuleFingerprint(ORDERED_PRODUCT_KINGDOM, 30, 200)) {
    throw new Error('Stage-one cohort is invalid.');
  }
  const start = integer('start-position'), end = integer('end-position');
  if (end < start || end > cohort.records.length) throw new Error('Stage-two range is invalid.');
  const request = nativeScoreBatchRequest(kingdom, cohort.records.slice(start, end).map((entry) => entry.strategy),
    { kingdomId: ORDERED_PRODUCT_KINGDOM, seeds: ORDERED_PRODUCT_SEEDS.slice(1), turnLimit: 30,
      actionCapPerTurn: 200 }, integer('threads'), 'full');
  fs.writeFileSync(option('request'), fixedJson(request));
  fs.writeFileSync(option('metadata'), fixedJson({ completeCount: end - start,
    candidateDigest: stableHash(cohort.records.slice(start, end).map((entry) => entry.canonicalStrategy).join('\n')),
    ruleFingerprint: nativeRuleFingerprint(ORDERED_PRODUCT_KINGDOM, 30, 200) }));
} else if (mode === 'stage-two-checkpoint') {
  const cohort = readJson<StageOneCohort>(option('cohort'));
  if (!cohortValid(cohort)) throw new Error('Stage-one cohort is invalid.');
  const scores = nativeScores(option('response'));
  const start = integer('start-position'), end = integer('end-position');
  const held = cohort.records.slice(start, end);
  if (scores.length !== held.length || end - start !== held.length) throw new Error('Stage-two response and range differ.');
  const records = scores.map((raw, index): OrderedProductRankedRecord => {
    const first = held[index]!, identity = rawIdentity(raw);
    if (identity.strategyId !== first.displayId || identity.collisionTieKey !== first.canonicalStrategy) {
      throw new Error('Native stage-two identity differs from retained stage one.');
    }
    const additional = compactProfileEvidence(raw);
    const combined = combineScoreEvidence(first.stageOne, additional);
    return { ...first, additional, combined, combinedRankingKey: rankingKey(combined), rank: 0 };
  });
  const metadata = readJson<{ candidateDigest: string; ruleFingerprint: string }>(option('metadata'));
  if (metadata.ruleFingerprint !== cohort.ruleFingerprint) throw new Error('Stage-two rule fingerprint differs.');
  const checkpoint = makeCheckpoint('stage-two', records, { shardId: integer('shard-id'),
    startPosition: start, endPosition: end, completeCount: records.length, retainedCount: records.length,
    candidateDigest: metadata.candidateDigest, scoreDigest: scoreDigest(records, 'combined') });
  writeAtomic(option('out'), fixedJson(checkpoint));
} else if (mode === 'finalize') {
  const cohort = readJson<StageOneCohort>(option('cohort'));
  if (!cohortValid(cohort)) throw new Error('Stage-one cohort is invalid.');
  const checkpoints = manifestFiles().map((file) => readJson<Checkpoint<OrderedProductRankedRecord>>(file));
  validateCheckpointSet(checkpoints, 'stage-two', cohort.config.retainedCount);
  const records = checkpoints.flatMap((entry) => entry.records).sort(compareRankedRecords)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  const space = createOrderedCandidateSpace(orderedGoldfishCardIds(ORDERED_PRODUCT_KINGDOM));
  const traversal = coprimeTraversalConfig(space.candidateCount);
  const candidateSpace = { generator: 'ordered-typescript-five-rung-v1', traversal: 'coprime-position-v1',
    cardIds: [...space.cardIds], quantityVectors: space.quantityVectors.map((entry) => [...entry]),
    skeletonCount: space.skeletonCount, candidateCount: space.candidateCount, ...traversal,
    provenanceDigest: '' };
  candidateSpace.provenanceDigest = candidateSpaceProvenanceDigest(candidateSpace);
  const artifact: OrderedProductRankedArtifact = { schemaVersion: ORDERED_PRODUCT_SCHEMA_VERSION,
    version: ORDERED_PRODUCT_VERSION, runId: cohort.runId, buildVersion: cohort.buildVersion,
    ruleFingerprint: cohort.ruleFingerprint, scorerVersion: cohort.scorerVersion, config: cohort.config,
    candidateSpace,
    stageOneShards: cohort.shards, stageTwoShards: checkpoints.map(shardProvenance),
    stageOneProvenanceDigest: cohort.provenanceDigest,
    stageTwoProvenanceDigest: provenanceDigest(checkpoints.map(shardProvenance)), records };
  if (!validateOrderedProductArtifact(artifact)) throw new Error('Final ranked artifact failed validation.');
  const digest = writeHashedArtifact(option('out'), artifact);
  console.log(JSON.stringify({ artifact: option('out'), sha256: digest, retainedCount: records.length }));
} else if (mode === 'validate') {
  const file = option('artifact'), text = fs.readFileSync(file, 'utf8'), artifact = JSON.parse(text) as unknown;
  const expected = fs.readFileSync(option('sha256', `${file}.sha256`), 'utf8').trim().split(/\s+/)[0];
  if (sha256Bytes(text) !== expected || fixedJson(artifact) !== text || !validateOrderedProductArtifact(artifact)) {
    throw new Error('Ranked artifact bytes, SHA-256, or semantic validation failed.');
  }
  console.log(JSON.stringify({ artifact: file, sha256: expected,
    retainedCount: (artifact as OrderedProductRankedArtifact).records.length }));
} else if (mode === 'build-reservoir') {
  const file = option('artifact'), text = fs.readFileSync(file, 'utf8'), sourceSha = sha256Bytes(text);
  const sidecar = fs.readFileSync(option('sha256', `${file}.sha256`), 'utf8').trim().split(/\s+/)[0];
  const artifact = JSON.parse(text) as unknown;
  if (sourceSha !== sidecar || !validateOrderedProductArtifact(artifact)) throw new Error('Ranked artifact is invalid.');
  const reservoir = buildOrderedProductReservoir(artifact, sourceSha);
  if (!validateOrderedProductReservoir(reservoir, artifact, sourceSha)) throw new Error('Reservoir validation failed.');
  const digest = writeHashedArtifact(option('out'), reservoir);
  console.log(JSON.stringify({ reservoir: option('out'), sha256: digest,
    count: reservoir.entries.length, sourceArtifactSha256: sourceSha }));
} else if (mode === 'validate-reservoir') {
  const artifactFile = option('artifact'), artifactText = fs.readFileSync(artifactFile, 'utf8');
  const artifact = JSON.parse(artifactText) as OrderedProductRankedArtifact, sourceSha = sha256Bytes(artifactText);
  const file = option('reservoir'), text = fs.readFileSync(file, 'utf8');
  const expected = fs.readFileSync(option('sha256', `${file}.sha256`), 'utf8').trim().split(/\s+/)[0];
  const reservoir = JSON.parse(text) as unknown;
  if (sha256Bytes(text) !== expected || fixedJson(reservoir) !== text
    || !validateOrderedProductArtifact(artifact)
    || !validateOrderedProductReservoir(reservoir, artifact, sourceSha)) throw new Error('Reservoir validation failed.');
  console.log(JSON.stringify({ reservoir: file, sha256: expected,
    count: (reservoir as { entries: unknown[] }).entries.length }));
} else {
  throw new Error('Mode must be validate-checkpoint, stage-one-checkpoint, merge-stage-one, stage-two-input, stage-two-checkpoint, finalize, validate, build-reservoir, or validate-reservoir.');
}
