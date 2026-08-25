import fs from 'node:fs';
import path from 'node:path';
import { SeededRandom, registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import {
  FIXED_RESERVOIR_CONFIG
} from '../src/sim/fixedReservoirPsro';
import {
  GOLDFISH_MOVEMENT_PROFILES, rankingKeyText
} from '../src/sim/goldfish';
import type { GoldfishConfig, MovementAwareGoldfishScore } from '../src/sim/goldfish';
import {
  applyCollisionPolicy, compareTailRecords, streamUniqueStrategies
} from '../src/sim/nativeStrategySearch';
import type { TraversalScoreRecord } from '../src/sim/nativeStrategySearch';
import { stoplessRandomDomain } from '../src/sim/randomPsro';
import { RustGoldfishScorer } from '../src/sim/rustGoldfishScorer';
import {
  STAGED_GOLDFISH_VERSION, selectStagedReservoirFromEvidence, stagedReservoirHash,
  validateStagedFixedReservoirPool
} from '../src/sim/stagedGoldfish';
import type {
  StageOneRankedScore, StagedFixedReservoirPoolArtifact
} from '../src/sim/stagedGoldfish';
import { StableHashAccumulator, canonicalStrategy } from '../src/sim/strategy';
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
function* uniqueChunks(seed: number, count: number, chunkSize: number): Generator<{ start: number; strategies: Strategy[] }> {
  const seen = new Set<string>(), chunk: Strategy[] = [];
  let accepted = 0, start = 0;
  for (const strategy of source(seed)) {
    const canonical = canonicalStrategy(strategy);
    if (seen.has(canonical)) continue;
    seen.add(canonical); chunk.push(strategy); accepted += 1;
    if (chunk.length === chunkSize || accepted === count) {
      yield { start, strategies: chunk.splice(0) }; start = accepted;
    }
    if (accepted === count) return;
  }
}
function record(score: MovementAwareGoldfishScore, traversalPosition: number): TraversalScoreRecord {
  return { traversalPosition, displayId: score.strategy.id,
    canonicalStrategy: canonicalStrategy(score.strategy), score };
}
function keepLeaders(
  held: TraversalScoreRecord[], incoming: TraversalScoreRecord[], count: number
): TraversalScoreRecord[] {
  return applyCollisionPolicy([...held, ...incoming]).slice(0, count);
}
function keepTail(
  held: TraversalScoreRecord[], incoming: TraversalScoreRecord[], count: number, seed: number
): TraversalScoreRecord[] {
  return applyCollisionPolicy([...held, ...incoming]).sort(compareTailRecords(seed)).slice(0, count);
}
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

const generatedCount = integer('count', FIXED_RESERVOIR_CONFIG.generatedCount);
const chunkSize = integer('chunk-size', FIXED_RESERVOIR_CONFIG.chunkSize);
const threads = integer('threads', 10);
const poolSeed = integer('pool-seed', 5);
const output = stringOption('out', path.join('.experiments', 'native-staged-product-search',
  `pool-${poolSeed}-${generatedCount}.json`));
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === KINGDOM_ID)!;
registerKingdom(kingdom);

const firstPass = streamUniqueStrategies(source(poolSeed), generatedCount, chunkSize);
const collisionIds = new Set(firstPass.collisionIds);
const scorer = new RustGoldfishScorer(threads);
const scoreDigest = new StableHashAccumulator();
const tailRetain = FIXED_RESERVOIR_CONFIG.goldfishCount + FIXED_RESERVOIR_CONFIG.randomCount;
let leaders: TraversalScoreRecord[] = [], tail: TraversalScoreRecord[] = [];
const collisions: TraversalScoreRecord[] = [];
const firstConfig: GoldfishConfig = { kingdomId: KINGDOM_ID, seeds: [SEEDS[0]!], turnLimit: 30,
  actionCapPerTurn: 200 };
const started = Date.now();
try {
  for (const chunk of uniqueChunks(poolSeed, generatedCount, chunkSize)) {
    const scores = await scorer.score(kingdom, chunk.strategies, firstConfig, threads, 'full');
    const records = scores.map((score, index) => record(score, chunk.start + index));
    scores.forEach((score, index) => { if (chunk.start + index) scoreDigest.update('\n');
      scoreDigest.update(rankingKeyText(score)); });
    collisions.push(...records.filter((entry) => collisionIds.has(entry.displayId)));
    const ordinary = records.filter((entry) => !collisionIds.has(entry.displayId));
    leaders = keepLeaders(leaders, ordinary, PREFILTER_COUNT);
    tail = keepTail(tail, ordinary, tailRetain, poolSeed);
  }
  leaders = keepLeaders(leaders, collisions, PREFILTER_COUNT);
  tail = keepTail(tail, collisions, tailRetain, poolSeed);
  const rankByCanonical = new Map(leaders.map((entry, index) => [entry.canonicalStrategy, index + 1]));
  const prefilter: StageOneRankedScore[] = leaders.map((entry, index) => ({
    score: entry.score as MovementAwareGoldfishScore, stageOneGoldfishRank: index + 1
  }));
  const remainingConfig: GoldfishConfig = { ...firstConfig, seeds: SEEDS.slice(1) };
  const rescored: MovementAwareGoldfishScore[] = [];
  for (let index = 0; index < leaders.length; index += chunkSize) {
    rescored.push(...await scorer.score(kingdom,
      leaders.slice(index, index + chunkSize).map((entry) => entry.score.strategy),
      remainingConfig, threads, 'full'));
  }
  const tailCandidates: StageOneRankedScore[] = tail.slice(0, tailRetain)
    .map((entry) => ({ score: entry.score as MovementAwareGoldfishScore,
      stageOneGoldfishRank: rankByCanonical.get(entry.canonicalStrategy) ?? generatedCount }));
  const reservoir = selectStagedReservoirFromEvidence(prefilter, rescored, tailCandidates,
    FIXED_RESERVOIR_CONFIG.goldfishCount, FIXED_RESERVOIR_CONFIG.randomCount);
  const artifact: StagedFixedReservoirPoolArtifact = { schemaVersion: 2,
    experiment: 'staged-fixed-reservoir-pool', version: STAGED_GOLDFISH_VERSION,
    kingdomId: KINGDOM_ID, poolSeed, goldfishSeeds: [...SEEDS], generatedCount,
    generatedHash: firstPass.provenance.generatedIdDigest,
    canonicalProvenanceDigest: firstPass.provenance.canonicalProvenanceDigest,
    duplicateCanonicalCount: firstPass.provenance.duplicateCanonicalCount,
    displayIdCollisionCount: firstPass.provenance.displayIdCollisionCount,
    scoringProtocol: 'native-streaming-staged-v1', shardProvenance: [{ shardId: 'coordinator',
      startPosition: 0, endPosition: generatedCount,
      candidateDigest: firstPass.provenance.canonicalProvenanceDigest, scoreDigest: scoreDigest.digest() }],
    prefilterCount: PREFILTER_COUNT, scoring: { profiles: [...GOLDFISH_MOVEMENT_PROFILES],
      combination: 'disjoint-seed-sum-v1', stageOne: { seeds: [SEEDS[0]!], scoredCount: generatedCount,
        elapsedMs: Date.now() - started }, rescore: { seeds: SEEDS.slice(1), scoredCount: rescored.length,
        elapsedMs: 0 } }, reservoirHash: stagedReservoirHash(reservoir), reservoir,
    elapsedMs: Date.now() - started };
  if (!validateStagedFixedReservoirPool(artifact, { kingdomId: KINGDOM_ID, poolSeed, generatedCount,
    prefilterCount: PREFILTER_COUNT, goldfishCount: FIXED_RESERVOIR_CONFIG.goldfishCount,
    randomCount: FIXED_RESERVOIR_CONFIG.randomCount, goldfishSeeds: SEEDS })) {
    throw new Error('Bounded native staged artifact failed validation.');
  }
  writeAtomic(output, artifact);
  console.log(`wrote ${output}`);
} finally { await scorer.close(); }
