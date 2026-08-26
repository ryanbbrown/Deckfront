import { performance } from 'node:perf_hooks';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { evaluateCandidates, mixtureSchedule } from '../src/sim/mixtureEvaluation';
import type { CompetitiveBlock } from '../src/sim/nativeCompetitiveProtocol';
import { createOrderedCandidateSpace, orderedGoldfishCardIds,
  representativeCandidateIndices } from '../src/sim/orderedGoldfishBenchmark';
import { playPairingScoreOnly } from '../src/sim/pairing';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { RustCompetitiveEvaluator } from '../src/sim/rustCompetitiveEvaluator';
import { RustGoldfishScorer } from '../src/sim/rustGoldfishScorer';

const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-007')!;
registerKingdom(kingdom);
const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
const strategies = [...representativeCandidateIndices(space.candidateCount, 250)]
  .map((index) => space.candidateAt(index));
const blocks: CompetitiveBlock[] = Array.from({ length: 8192 }, (_unused, index) => ({
  candidateIndex: index % strategies.length,
  opponentIndex: (index * 11 + 5) % strategies.length,
  seed: (5_700_000 + index * 104_729) >>> 0
}));
const threads = Math.min(8, Number(process.env.HEXDECK_COMPETITIVE_THREADS ?? 8));
const config = { kingdomId: kingdom.id, turnLimitPerPlayer: 30,
  actionCapPerTurn: 200, startingDraftEnabled: false } as const;
const rust = new RustGoldfishScorer(threads);
try {
  const loadId = await rust.loadCompetitive(kingdom, strategies, config, threads);
  const typescriptScore = (block: CompetitiveBlock): number => playPairingScoreOnly(
    strategies[block.candidateIndex]!, strategies[block.opponentIndex]!, {
      kingdomId: kingdom.id, seeds: [block.seed], turnLimitPerPlayer: 30,
      actionCapPerTurn: 200, startingDraftEnabled: false
    }).scoreBytes[0]!;
  blocks.slice(0, 32).forEach(typescriptScore);
  await rust.scoreCompetitive(loadId, blocks.slice(0, 32));

  const typescriptStarted = performance.now();
  const expected = Uint8Array.from(blocks.map(typescriptScore));
  const typescriptMs = performance.now() - typescriptStarted;

  const rustStarted = performance.now();
  const actual = await rust.scoreCompetitive(loadId, blocks);
  const rustMs = performance.now() - rustStarted;
  if (Buffer.compare(Buffer.from(actual.scoreBytes), Buffer.from(expected)) !== 0
    || actual.played.some((played) => played !== 2) || actual.aborts.length) {
    throw new Error('Competitive benchmark parity failed.');
  }
  const opponents = new Map(strategies.slice(0, 8).map((strategy) => [strategy.id, strategy]));
  const workerScheduleBlocks = Number(process.env.HEXDECK_PARITY_SCHEDULE_BLOCKS ?? 8);
  if (!Number.isSafeInteger(workerScheduleBlocks) || workerScheduleBlocks < 1) {
    throw new Error('HEXDECK_PARITY_SCHEDULE_BLOCKS must be a positive integer.');
  }
  const schedule = mixtureSchedule(Object.fromEntries([...opponents.keys()].map((id) => [id, 1])),
    Array.from({ length: workerScheduleBlocks }, (_unused, index) => 6_100_000 + index), 6_200_000);
  const runner = new WorkerPairingRunner(threads, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  const evaluator = await RustCompetitiveEvaluator.create(rust, kingdom, strategies, config, threads);
  const options = { ...config, scoreOnly: true } as const;
  try {
    await evaluateCandidates(strategies.slice(0, 8), opponents, schedule, runner, options);
    await evaluator.evaluate(strategies.slice(0, 8), opponents, schedule, runner, options);
    const workerStarted = performance.now();
    const workerRows = await evaluateCandidates(strategies, opponents, schedule, runner, options);
    const workerMs = performance.now() - workerStarted;
    const evaluatorStarted = performance.now();
    const rustRows = await evaluator.evaluate(strategies, opponents, schedule, runner, options);
    const evaluatorMs = performance.now() - evaluatorStarted;
    if (JSON.stringify(rustRows.map((row) => row.blockScores))
      !== JSON.stringify(workerRows.map((row) => row.blockScores))) {
      throw new Error('Competitive worker-shape benchmark parity failed.');
    }
    console.log(JSON.stringify({ parity: 'exact', kernel: {
      blocks: blocks.length, games: blocks.length * 2, threads,
      typescriptMs: Number(typescriptMs.toFixed(3)), rustMs: Number(rustMs.toFixed(3)),
      speedup: Number((typescriptMs / rustMs).toFixed(3)),
      typescriptGamesPerSecond: Math.round(blocks.length * 2 / (typescriptMs / 1000)),
      rustGamesPerSecond: Math.round(blocks.length * 2 / (rustMs / 1000))
    }, workerShape: { candidates: strategies.length, scheduleBlocks: schedule.blocks.length,
      games: strategies.length * schedule.blocks.length * 2,
      typescriptWorkerMs: Number(workerMs.toFixed(3)), rustEvaluatorMs: Number(evaluatorMs.toFixed(3)),
      speedup: Number((workerMs / evaluatorMs).toFixed(3)) } }, null, 2));
  } finally {
    await runner.close();
  }
} finally {
  await rust.close();
}
