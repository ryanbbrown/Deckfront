import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { emptyAggregate } from '../../src/sim/pairing';
import { fixedBuyPlan } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import type { InitialMatrixSeedRecord } from '../../src/sim/initialMatrixCalibration';
import {
  createStrategySearchMatrixChunk, createStrategySearchMatrixManifest,
  createStrategySearchMatrixScoreTaskChunk, reduceStrategySearchMatrix,
  reduceStrategySearchMatrixScoreTasks, strategySearchMatrixJobs, strategySearchMatrixScoreTasks,
  validateStrategySearchMatrixArtifact, validateStrategySearchMatrixManifest
} from '../../src/sim/strategySearchMatrix';
import {
  createStrategySearchPsroArtifact, validateStrategySearchPsroArtifact
} from '../../src/sim/strategySearchPsro';

const kingdomId = 'deep-beam-tuning-002', evidenceId = 'a'.repeat(64);
beforeAll(() => registerKingdom(deepBeamSuite.kingdoms.find((entry) => entry.id === kingdomId)!));
function strategies(): Strategy[] { return Array.from({ length: 50 }, (_unused, index) => ({ id: `strategy-${index}`,
  startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: index % 2 ? 'drive' : 'volley',
    desiredCount: index + 1 }]) })); }
function manifest() { return createStrategySearchMatrixManifest({ source: { kingdomId, evidenceId,
  reservoirIdentityHash: 'b'.repeat(64), reservoirContentHash: 'c'.repeat(64),
  matrixSeedNamespace: 'strategy-search-matrix-v2' }, strategies: strategies() }); }
function record(seed: number, row: Strategy, column: Strategy): InitialMatrixSeedRecord {
  const telemetry = emptyAggregate();
  for (const id of new Set([row.id, column.id])) { telemetry.acquisitionsByStrategy[id] = {};
    telemetry.planPositionPurchasesByStrategy![id] = {}; }
  telemetry.byOrientation.firstOchre.normal = { played: 1, wins: 0, draws: 1, losses: 0, aborted: 0 };
  telemetry.byOrientation.firstIndigo.normal = { played: 1, wins: 0, draws: 1, losses: 0, aborted: 0 };
  return { seed, payoffScore: row.id === column.id ? null : 0.5, played: 2, aborted: 0, matches: 2, telemetry };
}
function execute(runtimeChunkSize: number) { const held = manifest(), jobs = strategySearchMatrixJobs(held, runtimeChunkSize);
  const chunks = jobs.map((job) => createStrategySearchMatrixChunk({ manifest: held, job,
    records: job.seeds.map((seed) => record(seed, held.strategies[job.rowIndex]!, held.strategies[job.columnIndex]!)) }));
  return { manifest: held, artifact: reduceStrategySearchMatrix({ manifest: held, chunks }) }; }
function executeScoreTasks(targetTaskMs: number) {
  const held = manifest(), semanticJobs = strategySearchMatrixJobs(held, 25);
  const chunks = semanticJobs.map((job) => createStrategySearchMatrixChunk({ manifest: held, job,
    records: job.seeds.map((seed) => record(seed, held.strategies[job.rowIndex]!, held.strategies[job.columnIndex]!)) }));
  const tasks = strategySearchMatrixScoreTasks(held, { targetTaskMs });
  const taskChunks = tasks.map((task) => createStrategySearchMatrixScoreTaskChunk({ manifest: held, task,
    chunks: task.jobs.map((job) => chunks[job.slot]!) })).reverse();
  return { manifest: held, tasks, taskChunks,
    artifact: reduceStrategySearchMatrixScoreTasks({ manifest: held, tasks, chunks: taskChunks }) };
}

describe('Matrix and PSRO semantic topology', () => {
  it('derives Matrix identity and seeds only from the semantic reservoir', () => {
    const first = manifest(), second = manifest();
    expect(validateStrategySearchMatrixManifest(first)).toBe(true);
    expect(second).toEqual(first);
    expect(strategySearchMatrixJobs(first, 25)).toHaveLength(6_375);
    expect(strategySearchMatrixJobs(first, 17)).toHaveLength(10_200);
    expect(createStrategySearchMatrixManifest({ source: { ...first.source,
      reservoirContentHash: 'd'.repeat(64) }, strategies: first.strategies }).seeds).not.toEqual(first.seeds);
  });

  it('reduces different runtime chunk sizes to byte-identical schema-4 evidence', () => {
    const coarse = execute(125), fine = execute(25);
    expect(fine.artifact).toEqual(coarse.artifact);
    expect(validateStrategySearchMatrixArtifact(coarse.artifact, coarse.manifest)).toBe(true);
    expect(coarse.artifact).not.toHaveProperty('chunkSize');
    expect(JSON.stringify(coarse.artifact)).not.toContain('workerCount');
  }, 120_000);

  it('reduces materially different grouped score tasks and shuffled completion to identical evidence', () => {
    const fine = executeScoreTasks(15_000), coarse = executeScoreTasks(60_000);
    expect(fine.tasks.length).toBeGreaterThan(coarse.tasks.length);
    expect(fine.artifact).toEqual(coarse.artifact);
    expect(() => reduceStrategySearchMatrixScoreTasks({ manifest: fine.manifest, tasks: fine.tasks,
      chunks: [...fine.taskChunks, fine.taskChunks[0]!] })).toThrow('incomplete');
  }, 120_000);

  it('removes candidate chunks and timing from schema-3 PSRO identity', () => {
    const base = { status: 'complete', runId: 'runtime-a', evidenceHash: 'runtime-a',
      source: { rankedPath: '/runtime/a' }, candidates: ['a', 'b'], looks: [{ lookOrdinal: 1,
      candidateStart: 0, candidateEnd: 2, chunkHashes: ['runtime-a'], elapsedMs: 10,
      rawLook: { chunks: [{ candidateStart: 0, candidateEnd: 2, artifactHash: 'runtime-a' }] },
      schedule: [{ seed: 7, score: 3, decision: 'retain' }] }] };
    const other = structuredClone(base); other.looks[0]!.candidateStart = 1;
    other.runId = 'runtime-b'; other.evidenceHash = 'runtime-b'; other.source.rankedPath = '/runtime/b';
    other.looks[0]!.candidateEnd = 1; other.looks[0]!.chunkHashes = ['runtime-b']; other.looks[0]!.elapsedMs = 99;
    other.looks[0]!.rawLook.chunks = [{ candidateStart: 1, candidateEnd: 1, artifactHash: 'runtime-b' }];
    const first = createStrategySearchPsroArtifact({ evidenceId, matrixEvidenceHash: 'd'.repeat(64),
      candidateIds: ['a', 'b'], checkpoint: base, finalStatus: 'complete' });
    const second = createStrategySearchPsroArtifact({ evidenceId, matrixEvidenceHash: 'd'.repeat(64),
      candidateIds: ['a', 'b'], checkpoint: other, finalStatus: 'complete' });
    expect(second).toEqual(first);
    expect(validateStrategySearchPsroArtifact(first)).toBe(true);
    expect(validateStrategySearchPsroArtifact({ ...first, candidateIds: ['changed'] })).toBe(false);
    expect(JSON.stringify(first)).not.toMatch(/candidateStart|candidateEnd|chunkHash|elapsedMs/);
  });
});
