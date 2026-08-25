import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { GOLDFISH_MOVEMENT_PROFILES } from '../src/sim/goldfish';
import type { GoldfishConfig } from '../src/sim/goldfish';
import {
  ORDERED_GOLDFISH_ACTION_CAP, ORDERED_GOLDFISH_SEED_BASE, ORDERED_GOLDFISH_TURN_LIMIT,
  candidateChecksum, coprimeTraversalConfig, createOrderedCandidateSpace, orderedGoldfishCardIds,
  parseOrderedGoldfishArgs, representativeCandidateIndices
} from '../src/sim/orderedGoldfishBenchmark';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import type { Strategy } from '../src/sim/strategy';

interface WorkerReply { id: number; scores?: unknown[]; error?: string; stack?: string }

async function scoreInWorkers(strategies: readonly Strategy[], config: GoldfishConfig,
  kingdom: Kingdom, requestedWorkers: number): Promise<number> {
  const workerCount = Math.min(requestedWorkers, strategies.length);
  const pool = Array.from({ length: workerCount }, () => new Worker(
    new URL('../src/server/goldfishWorker.ts', import.meta.url),
    { workerData: { kingdom }, execArgv: ['--import', 'tsx'] }));
  try {
    const partitions = pool.map((_worker, index) => strategies.slice(
      Math.floor(strategies.length * index / workerCount),
      Math.floor(strategies.length * (index + 1) / workerCount)));
    const counts = await Promise.all(pool.map((worker, index) => new Promise<number>((resolve, reject) => {
      const fail = (error: Error): void => reject(error);
      worker.once('error', fail);
      worker.once('message', (reply: WorkerReply) => {
        worker.off('error', fail);
        if (reply.error || !reply.scores) {
          reject(new Error(reply.stack ?? reply.error ?? 'Goldfish worker failed.'));
          return;
        }
        resolve(reply.scores.length);
      });
      worker.postMessage({ id: index, strategies: partitions[index], config, mode: 'movement-aware' });
    })));
    return counts.reduce((sum, count) => sum + count, 0);
  } finally {
    await Promise.all(pool.map((worker) => worker.terminate()));
  }
}

const options = parseOrderedGoldfishArgs(process.argv.slice(2));
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === options.kingdomId);
if (!kingdom) throw new Error(`Unknown deep-beam suite kingdom: ${options.kingdomId}`);
registerKingdom(kingdom);
const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
if (options.limit > space.candidateCount) {
  throw new Error(`--limit cannot exceed the full candidate count ${space.candidateCount}.`);
}
const traversal = coprimeTraversalConfig(space.candidateCount);
const generationStarted = performance.now();
const candidateIndices = [...representativeCandidateIndices(space.candidateCount, options.limit)];
const strategies = candidateIndices.map((index) => space.candidateAt(index));
const checksum = candidateChecksum(strategies);
const generationMs = performance.now() - generationStarted;
const seeds = Array.from({ length: options.shuffles }, (_unused, index) => ORDERED_GOLDFISH_SEED_BASE + index);
const goldfishConfig: GoldfishConfig = { kingdomId: kingdom.id, seeds,
  turnLimit: ORDERED_GOLDFISH_TURN_LIMIT, actionCapPerTurn: ORDERED_GOLDFISH_ACTION_CAP };
const scoringStarted = performance.now();
const scoredCount = await scoreInWorkers(strategies, goldfishConfig, kingdom, options.workers);
const scoringMs = performance.now() - scoringStarted;
if (scoredCount !== strategies.length) throw new Error(`Workers returned ${scoredCount} of ${strategies.length} scores.`);
const individualTrials = scoredCount * seeds.length * GOLDFISH_MOVEMENT_PROFILES.length;
const seconds = scoringMs / 1_000;

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
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
  scoredCount,
  candidateChecksum: checksum,
  traversal: { ...traversal, formula: '(offset + position * stride) mod fullCandidateCount',
    firstCandidateIndex: candidateIndices[0], lastCandidateIndex: candidateIndices.at(-1) },
  scoring: { path: 'goldfishWorker/movement-aware', profiles: GOLDFISH_MOVEMENT_PROFILES,
    shuffleSeeds: seeds, shuffleCount: seeds.length, turnLimit: goldfishConfig.turnLimit,
    actionCapPerTurn: goldfishConfig.actionCapPerTurn, requestedWorkers: options.workers,
    usedWorkers: Math.min(options.workers, scoredCount), individualTrials },
  timing: { generationMs, scoringMs,
    strategiesPerSecond: scoredCount / seconds, individualTrialsPerSecond: individualTrials / seconds },
  runtime: { node: process.version, platform: process.platform, architecture: process.arch,
    logicalCpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? 'unknown' }
}, null, 2)}\n`);
