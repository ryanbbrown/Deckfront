import fs from 'node:fs';
import path from 'node:path';
import { SeededRandom, registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { FIXED_RESERVOIR_CONFIG } from '../src/sim/fixedReservoirPsro';
import { GOLDFISH_MOVEMENT_PROFILES, mergeMovementAwareGoldfishScores } from '../src/sim/goldfish';
import type { GoldfishConfig, MovementAwareGoldfishScore } from '../src/sim/goldfish';
import { nativeRuleFingerprint } from '../src/sim/nativeGoldfishProtocol';
import {
  MAX_GLOBAL_COLLISION_IDS, mergeShardRetention, retainShard, streamUniqueStrategiesAsync
} from '../src/sim/nativeStrategySearch';
import type { ShardRetention, TraversalScoreRecord } from '../src/sim/nativeStrategySearch';
import { stoplessRandomDomain } from '../src/sim/randomPsro';
import { RustGoldfishScorer } from '../src/sim/rustGoldfishScorer';
import {
  STAGED_GOLDFISH_VERSION, selectStagedReservoirFromMergedEvidence, stagedReservoirHash,
  stagedTailEvidenceDigest, validateStagedFixedReservoirPool
} from '../src/sim/stagedGoldfish';
import type { StageOneRankedScore, StagedFixedReservoirPoolArtifact } from '../src/sim/stagedGoldfish';
import { canonicalStrategy, stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';

const KINGDOM_ID = 'deep-beam-tuning-009';
const SEEDS = [5_200_000, 5_200_001, 5_200_002, 5_200_003];
const PREFILTER_COUNT = 50_000;

function integer(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = Number(index < 0 ? fallback : process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be positive.`);
  return value;
}
function stringOption(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
}
function* source(seed: number): Generator<Strategy> {
  const random = new SeededRandom(seed), domain = stoplessRandomDomain(KINGDOM_ID);
  for (;;) yield domain.randomComplete(random);
}
function record(score: MovementAwareGoldfishScore, traversalPosition: number): TraversalScoreRecord {
  return { traversalPosition, displayId: score.strategy.id,
    canonicalStrategy: canonicalStrategy(score.strategy), score };
}
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

const generatedCount = integer('count', FIXED_RESERVOIR_CONFIG.generatedCount);
const chunkSize = integer('chunk-size', FIXED_RESERVOIR_CONFIG.chunkSize);
const shardSize = integer('shard-size', 100_000);
const threads = integer('threads', 10);
const poolSeed = integer('pool-seed', 5);
const output = stringOption('out', path.join('.experiments', 'native-staged-product-search',
  `pool-${poolSeed}-${generatedCount}.json`));
const prefilterCount = Math.min(PREFILTER_COUNT, generatedCount - FIXED_RESERVOIR_CONFIG.randomCount);
if (prefilterCount < FIXED_RESERVOIR_CONFIG.goldfishCount) {
  throw new Error(`--count must be at least ${FIXED_RESERVOIR_CONFIG.goldfishCount
    + FIXED_RESERVOIR_CONFIG.randomCount}.`);
}
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === KINGDOM_ID)!;
registerKingdom(kingdom);
if (fs.existsSync(output)) {
  try {
    const held = JSON.parse(fs.readFileSync(output, 'utf8')) as unknown;
    if (validateStagedFixedReservoirPool(held, { kingdomId: KINGDOM_ID, poolSeed, generatedCount,
      prefilterCount, goldfishCount: FIXED_RESERVOIR_CONFIG.goldfishCount,
      randomCount: FIXED_RESERVOIR_CONFIG.randomCount, goldfishSeeds: SEEDS })) {
      const artifact = held as StagedFixedReservoirPoolArtifact;
      console.log(JSON.stringify({ output, resumed: true, generatedCount,
        prefilterCount: artifact.prefilterEvidence.count,
        leaderCount: artifact.reservoir.filter((entry) => entry.source === 'goldfish').length,
        tailCount: artifact.reservoir.filter((entry) => entry.source === 'random').length,
        generatedHash: artifact.generatedHash,
        canonicalProvenanceDigest: artifact.canonicalProvenanceDigest,
        prefilterDigest: artifact.prefilterEvidence.digest, leaderDigest: artifact.leaderDigest,
        tailDigest: artifact.tailDigest }));
      process.exit(0);
    }
  } catch { /* Invalid or partial output runs again and is replaced atomically. */ }
}

const scorer = new RustGoldfishScorer(threads);
const tailRetain = FIXED_RESERVOIR_CONFIG.goldfishCount + FIXED_RESERVOIR_CONFIG.randomCount;
const collisionAllowance = MAX_GLOBAL_COLLISION_IDS;
const firstConfig: GoldfishConfig = { kingdomId: KINGDOM_ID, seeds: [SEEDS[0]!], turnLimit: 30,
  actionCapPerTurn: 200 };
const started = Date.now();
const stageOneStarted = started;
const stageOneShards: ShardRetention[] = [];
let pendingStageOne: TraversalScoreRecord[] = [];
let stageOneShardStart = 0;
const flushStageOne = (): void => {
  if (!pendingStageOne.length) return;
  const end = stageOneShardStart + pendingStageOne.length;
  // At most `collisionAllowance` policy drops can precede a survivor. The same bound holds for
  // the tail because its seeded rank depends on display ID, while collision policy picks its canonical form.
  stageOneShards.push(retainShard(stageOneShards.length, stageOneShardStart, end, pendingStageOne,
    prefilterCount + collisionAllowance, tailRetain + collisionAllowance, poolSeed, new Set()));
  stageOneShardStart = end;
  pendingStageOne = [];
};
try {
  const generation = await streamUniqueStrategiesAsync(source(poolSeed), generatedCount, chunkSize,
    async (chunk) => {
      const scores = await scorer.score(kingdom, chunk.strategies, firstConfig, threads, 'full');
      for (let index = 0; index < scores.length; index += 1) {
        pendingStageOne.push(record(scores[index]!, chunk.startPosition + index));
        if (pendingStageOne.length === shardSize) flushStageOne();
      }
    });
  flushStageOne();
  if (generation.provenance.displayIdCollisionCount > collisionAllowance) {
    throw new Error(`Display-ID collisions exceed the bounded allowance ${collisionAllowance}.`);
  }
  const stageOneElapsedMs = Date.now() - stageOneStarted;
  const stageOne = mergeShardRetention(stageOneShards, prefilterCount, tailRetain, poolSeed);
  const rankByCanonical = new Map(stageOne.leaders.map((entry, index) =>
    [entry.canonicalStrategy, index + 1]));
  const prefilter: StageOneRankedScore[] = stageOne.leaders.map((entry, index) => ({
    score: entry.score as MovementAwareGoldfishScore, stageOneGoldfishRank: index + 1
  }));

  const remainingConfig: GoldfishConfig = { ...firstConfig, seeds: SEEDS.slice(1) };
  const rescoreStarted = Date.now();
  const stageTwoShards: ShardRetention[] = [];
  let pendingStageTwo: TraversalScoreRecord[] = [];
  let stageTwoShardStart = 0;
  const flushStageTwo = (): void => {
    if (!pendingStageTwo.length) return;
    const end = stageTwoShardStart + pendingStageTwo.length;
    stageTwoShards.push(retainShard(stageTwoShards.length, stageTwoShardStart, end, pendingStageTwo,
      FIXED_RESERVOIR_CONFIG.goldfishCount, 0, poolSeed, new Set()));
    stageTwoShardStart = end;
    pendingStageTwo = [];
  };
  for (let index = 0; index < stageOne.leaders.length; index += chunkSize) {
    const held = stageOne.leaders.slice(index, index + chunkSize);
    const rescored = await scorer.score(kingdom, held.map((entry) => entry.score.strategy),
      remainingConfig, threads, 'full');
    for (let offset = 0; offset < held.length; offset += 1) {
      const combined = mergeMovementAwareGoldfishScores([
        held[offset]!.score as MovementAwareGoldfishScore, rescored[offset]!
      ]);
      pendingStageTwo.push(record(combined, index + offset));
      if (pendingStageTwo.length === shardSize) flushStageTwo();
    }
  }
  flushStageTwo();
  const rescoreElapsedMs = Date.now() - rescoreStarted;
  const stageTwo = mergeShardRetention(stageTwoShards,
    FIXED_RESERVOIR_CONFIG.goldfishCount, 0, poolSeed);
  const tailCandidates: StageOneRankedScore[] = stageOne.tail.map((entry) => ({
    score: entry.score as MovementAwareGoldfishScore,
    stageOneGoldfishRank: rankByCanonical.get(entry.canonicalStrategy) ?? null
  }));
  const reservoir = selectStagedReservoirFromMergedEvidence(prefilter,
    stageTwo.leaders.map((entry) => entry.score as MovementAwareGoldfishScore), tailCandidates,
    FIXED_RESERVOIR_CONFIG.goldfishCount, FIXED_RESERVOIR_CONFIG.randomCount);
  const artifact: StagedFixedReservoirPoolArtifact = { schemaVersion: 2,
    experiment: 'staged-fixed-reservoir-pool', version: STAGED_GOLDFISH_VERSION,
    kingdomId: KINGDOM_ID, poolSeed, goldfishSeeds: [...SEEDS], generatedCount,
    generatedHash: generation.provenance.generatedIdDigest,
    canonicalProvenanceDigest: generation.provenance.canonicalProvenanceDigest,
    duplicateCanonicalCount: generation.provenance.duplicateCanonicalCount,
    displayIdCollisionCount: generation.provenance.displayIdCollisionCount,
    scoringProtocol: 'native-streaming-staged-v3',
    buildVersion: process.env.HEXDECK_BUILD_VERSION ?? 'local-working-tree',
    ruleFingerprint: nativeRuleFingerprint(KINGDOM_ID, 30, 200), shardProvenance: stageOneShards.map((shard) => ({
      shardId: String(shard.shardId), startPosition: shard.startPosition,
      endPosition: shard.endPosition, candidateDigest: shard.candidateDigest,
      scoreDigest: shard.scoreDigest
    })), prefilterCount,
    prefilterEvidence: { count: prefilter.length,
      entries: prefilter.map((entry) => ({ displayId: entry.score.strategy.id,
        canonicalStrategy: canonicalStrategy(entry.score.strategy) })),
      digest: stableHash(prefilter.map((entry) =>
        `${entry.score.strategy.id}\t${canonicalStrategy(entry.score.strategy)}`).join('\n')) },
    leaderDigest: stableHash(reservoir.filter((entry) => entry.source === 'goldfish')
      .map((entry) => canonicalStrategy(entry.strategy)).join('\n')),
    tailDigest: stableHash(reservoir.filter((entry) => entry.source === 'random')
      .map((entry) => canonicalStrategy(entry.strategy)).join('\n')),
    tailEvidence: { eligibleCount: generatedCount - generation.provenance.displayIdCollisionCount,
      retainedCount: stageOne.tail.length,
      entries: stageOne.tail.map((entry) => ({ displayId: entry.displayId,
        canonicalStrategy: entry.canonicalStrategy, traversalPosition: entry.traversalPosition })),
      digest: stagedTailEvidenceDigest(stageOne.tail) },
    scoring: { profiles: [...GOLDFISH_MOVEMENT_PROFILES],
      combination: 'disjoint-seed-sum-v1', stageOne: { seeds: [SEEDS[0]!], scoredCount: generatedCount,
        elapsedMs: stageOneElapsedMs }, rescore: { seeds: SEEDS.slice(1), scoredCount: prefilter.length,
        elapsedMs: rescoreElapsedMs, shardProvenance: stageTwoShards.map((shard) => ({
          shardId: String(shard.shardId), startPosition: shard.startPosition,
          endPosition: shard.endPosition, candidateDigest: shard.candidateDigest,
          scoreDigest: shard.scoreDigest
        })) } }, reservoirHash: stagedReservoirHash(reservoir), reservoir,
    elapsedMs: Date.now() - started };
  if (!validateStagedFixedReservoirPool(artifact, { kingdomId: KINGDOM_ID, poolSeed, generatedCount,
    prefilterCount, goldfishCount: FIXED_RESERVOIR_CONFIG.goldfishCount,
    randomCount: FIXED_RESERVOIR_CONFIG.randomCount, goldfishSeeds: SEEDS })) {
    throw new Error('Bounded native staged artifact failed validation.');
  }
  writeAtomic(output, artifact);
  console.log(JSON.stringify({ output, resumed: false, generatedCount,
    prefilterCount: artifact.prefilterEvidence.count,
    leaderCount: artifact.reservoir.filter((entry) => entry.source === 'goldfish').length,
    tailCount: artifact.reservoir.filter((entry) => entry.source === 'random').length,
    stageOneShardCount: stageOneShards.length, stageTwoShardCount: stageTwoShards.length,
    stageOneElapsedMs, rescoreElapsedMs, elapsedMs: artifact.elapsedMs,
    generatedHash: artifact.generatedHash,
    canonicalProvenanceDigest: artifact.canonicalProvenanceDigest,
    prefilterDigest: artifact.prefilterEvidence.digest, leaderDigest: artifact.leaderDigest,
    tailDigest: artifact.tailDigest }));
} finally { await scorer.close(); }
