import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import {
  GOLDFISH_MOVEMENT_PROFILES, rankingKeyText
} from '../src/sim/goldfish';
import type { GoldfishConfig, MovementAwareRankingScore } from '../src/sim/goldfish';
import {
  ORDERED_GOLDFISH_ACTION_CAP, ORDERED_GOLDFISH_SEED_BASE, ORDERED_GOLDFISH_TURN_LIMIT,
  coprimeTraversalConfig, createOrderedCandidateSpace, orderedGoldfishCardIds,
  parseOrderedGoldfishArgs, representativeCandidateIndices
} from '../src/sim/orderedGoldfishBenchmark';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { StableHashAccumulator, canonicalStrategy } from '../src/sim/strategy';
import { RustGoldfishScorer } from '../src/sim/rustGoldfishScorer';
import type { Strategy } from '../src/sim/strategy';

interface WorkerReply {
  id: number;
  scores?: MovementAwareRankingScore[];
  error?: string;
  stack?: string;
}
interface Chunk { id: number; strategies: Strategy[] }
interface ScoreResult {
  scoredCount: number;
  candidateChecksum: string;
  scoreKeyDigest: string;
  generationMs: number;
  firstCandidateIndex: number;
  lastCandidateIndex: number;
  peakRssBytes: number;
}

async function scoreInWorkers(input: {
  space: ReturnType<typeof createOrderedCandidateSpace>;
  limit: number;
  startPosition: number;
  chunkSize: number;
  config: GoldfishConfig;
  kingdom: Kingdom;
  requestedWorkers: number;
  scorer: 'original' | 'lean';
}): Promise<ScoreResult> {
  const workerCount = Math.min(input.requestedWorkers, Math.ceil(input.limit / input.chunkSize));
  const workers = Array.from({ length: workerCount }, () => new Worker(
    new URL('../dist-benchmark/goldfishWorker.mjs', import.meta.url),
    { workerData: { kingdom: input.kingdom } }));
  const candidateDigest = new StableHashAccumulator();
  const scoreDigest = new StableHashAccumulator();
  const results = new Map<number, MovementAwareRankingScore[]>();
  const expectedChunkSizes = new Map<number, number>();
  const traversal = representativeCandidateIndices(
    input.space.candidateCount, input.limit, input.startPosition
  );
  let generated = 0;
  let scored = 0;
  let nextChunkId = 0;
  let nextFoldId = 0;
  let active = 0;
  let generationMs = 0;
  let firstCandidateIndex = -1;
  let lastCandidateIndex = -1;
  let peakRssBytes = process.memoryUsage().rss;

  const makeChunk = (): Chunk | null => {
    if (generated >= input.limit) return null;
    const started = performance.now();
    const strategies: Strategy[] = [];
    while (strategies.length < input.chunkSize && generated < input.limit) {
      const next = traversal.next();
      if (next.done) throw new Error('Ordered traversal ended before the requested limit.');
      const candidateIndex = next.value;
      if (firstCandidateIndex < 0) firstCandidateIndex = candidateIndex;
      lastCandidateIndex = candidateIndex;
      const strategy = input.space.candidateAt(candidateIndex);
      if (generated > 0) candidateDigest.update('\n');
      candidateDigest.update(canonicalStrategy(strategy));
      strategies.push(strategy);
      generated += 1;
    }
    generationMs += performance.now() - started;
    return { id: nextChunkId++, strategies };
  };
  const foldReady = (): void => {
    for (;;) {
      const scores = results.get(nextFoldId);
      if (!scores) return;
      results.delete(nextFoldId);
      for (const score of scores) {
        if (scored > 0) scoreDigest.update('\n');
        scoreDigest.update(rankingKeyText(score));
        scored += 1;
      }
      nextFoldId += 1;
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const finish = (): void => {
        if (settled || generated < input.limit || active !== 0) return;
        foldReady();
        if (scored !== input.limit) {
          fail(new Error(`Workers returned ${scored} of ${input.limit} scores.`));
          return;
        }
        settled = true;
        resolve();
      };
      const dispatch = (worker: Worker): void => {
        if (settled) return;
        const chunk = makeChunk();
        if (!chunk) { finish(); return; }
        active += 1;
        expectedChunkSizes.set(chunk.id, chunk.strategies.length);
        worker.postMessage({ id: chunk.id, strategies: chunk.strategies, config: input.config,
          mode: input.scorer === 'original' ? 'movement-aware' : 'movement-aware-lean-compact' });
      };
      for (const worker of workers) {
        worker.on('error', fail);
        worker.on('exit', (code) => { if (!settled && code !== 0) fail(new Error(`Goldfish worker exited ${code}.`)); });
        worker.on('message', (reply: WorkerReply) => {
          if (settled) return;
          active -= 1;
          if (reply.error || !reply.scores) {
            fail(new Error(reply.stack ?? reply.error ?? 'Goldfish worker failed.'));
            return;
          }
          if (reply.scores.length !== expectedChunkSizes.get(reply.id)) {
            fail(new Error(`Goldfish worker returned a short chunk ${reply.id}.`)); return;
          }
          expectedChunkSizes.delete(reply.id);
          results.set(reply.id, reply.scores);
          peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
          foldReady();
          dispatch(worker);
          finish();
        });
        dispatch(worker);
      }
    });
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
  return { scoredCount: scored, candidateChecksum: candidateDigest.digest(),
    scoreKeyDigest: scoreDigest.digest(), generationMs, firstCandidateIndex, lastCandidateIndex,
    peakRssBytes };
}

async function scoreInRust(input: {
  space: ReturnType<typeof createOrderedCandidateSpace>; limit: number; startPosition: number;
  chunkSize: number; config: GoldfishConfig; kingdom: Kingdom; threads: number;
}): Promise<ScoreResult> {
  const traversal = representativeCandidateIndices(input.space.candidateCount, input.limit, input.startPosition);
  const candidateDigest = new StableHashAccumulator();
  const scoreDigest = new StableHashAccumulator();
  const scorer = new RustGoldfishScorer(input.threads);
  let generated = 0, generationMs = 0, firstCandidateIndex = -1, lastCandidateIndex = -1;
  let peakRssBytes = process.memoryUsage().rss;
  try {
    while (generated < input.limit) {
      const started = performance.now();
      const strategies: Strategy[] = [];
      while (strategies.length < input.chunkSize && generated < input.limit) {
        const next = traversal.next();
        if (next.done) throw new Error('Ordered traversal ended before the requested limit.');
        if (firstCandidateIndex < 0) firstCandidateIndex = next.value;
        lastCandidateIndex = next.value;
        const strategy = input.space.candidateAt(next.value);
        if (generated) candidateDigest.update('\n');
        candidateDigest.update(canonicalStrategy(strategy));
        strategies.push(strategy); generated += 1;
      }
      generationMs += performance.now() - started;
      const scores = await scorer.score(input.kingdom, strategies, input.config, input.threads, 'compact');
      scores.forEach((score, index) => {
        const scorePosition = generated - strategies.length + index;
        if (scorePosition) scoreDigest.update('\n');
        scoreDigest.update(rankingKeyText(score));
      });
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }
  } finally { await scorer.close(); }
  return { scoredCount: generated, candidateChecksum: candidateDigest.digest(),
    scoreKeyDigest: scoreDigest.digest(), generationMs, firstCandidateIndex, lastCandidateIndex, peakRssBytes };
}

const options = parseOrderedGoldfishArgs(process.argv.slice(2));
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === options.kingdomId);
if (!kingdom) throw new Error(`Unknown deep-beam suite kingdom: ${options.kingdomId}`);
registerKingdom(kingdom);
const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
if (options.startPosition + options.limit > space.candidateCount) {
  throw new Error(`The traversal range cannot exceed the full candidate count ${space.candidateCount}.`);
}
const traversal = coprimeTraversalConfig(space.candidateCount);
const seeds = Array.from({ length: options.shuffles }, (_unused, index) => ORDERED_GOLDFISH_SEED_BASE + index);
const goldfishConfig: GoldfishConfig = { kingdomId: kingdom.id, seeds,
  turnLimit: ORDERED_GOLDFISH_TURN_LIMIT, actionCapPerTurn: ORDERED_GOLDFISH_ACTION_CAP };
const scoringStarted = performance.now();
const result = options.scorer === 'rust'
  ? await scoreInRust({ space, limit: options.limit, startPosition: options.startPosition,
    chunkSize: options.chunkSize, config: goldfishConfig, kingdom, threads: options.workers })
  : await scoreInWorkers({ space, limit: options.limit, startPosition: options.startPosition,
    chunkSize: options.chunkSize, config: goldfishConfig, kingdom,
    requestedWorkers: options.workers, scorer: options.scorer });
const scoringMs = performance.now() - scoringStarted;
const individualTrials = result.scoredCount * seeds.length * GOLDFISH_MOVEMENT_PROFILES.length;
const seconds = scoringMs / 1_000;

process.stdout.write(`${JSON.stringify({
  schemaVersion: 2,
  benchmark: 'ordered-unique-card-goldfish',
  baseline: {
    status: 'provisional benchmark baseline; not a product decision',
    structure: 'empty starting build; five unique finite buy rungs; no fallback',
    quantities: 'first three rungs 1..4; last two rungs fixed at 3; total planned quantity <=15',
    quantityVectorCount: space.quantityVectors.length
  },
  kingdomId: kingdom.id,
  cardIds: space.cardIds,
  skeletonCount: space.skeletonCount,
  fullCandidateCount: space.candidateCount,
  scoredCount: result.scoredCount,
  candidateChecksum: result.candidateChecksum,
  scoreKeyDigest: result.scoreKeyDigest,
  traversal: { ...traversal, startPosition: options.startPosition, endPosition: options.startPosition + options.limit,
    formula: '(offset + position * stride) mod fullCandidateCount',
    firstCandidateIndex: result.firstCandidateIndex, lastCandidateIndex: result.lastCandidateIndex },
  scoring: { path: options.scorer, profiles: GOLDFISH_MOVEMENT_PROFILES,
    shuffleSeeds: seeds, shuffleCount: seeds.length, turnLimit: goldfishConfig.turnLimit,
    actionCapPerTurn: goldfishConfig.actionCapPerTurn, requestedWorkers: options.workers,
    usedWorkers: options.scorer === 'rust' ? options.workers
      : Math.min(options.workers, Math.ceil(result.scoredCount / options.chunkSize)),
    chunkSize: options.chunkSize, dispatch: options.scorer === 'rust' ? 'rust-rayon' : 'dynamic-pull',
    workerBuild: options.scorer === 'rust' ? 'rust-1.98-release' : 'esbuild-node22',
    digestFoldOrder: 'traversal', individualTrials },
  timing: { generationMs: result.generationMs, scoringMs,
    strategiesPerSecond: result.scoredCount / seconds, individualTrialsPerSecond: individualTrials / seconds },
  memory: { peakRssBytes: result.peakRssBytes },
  runtime: { node: process.version, platform: process.platform, architecture: process.arch,
    logicalCpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? 'unknown' }
}, null, 2)}\n`);
