import { beforeAll, describe, expect, it } from 'vitest';
import { strategySearchKingdom } from '../../src/sim/strategySearchKingdoms';
import { solveEquilibrium } from '../../src/sim/equilibrium';
import { emptyAggregate } from '../../src/sim/pairing';
import { matrixProtocol } from '../../src/sim/payoffMatrix';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';
import { canonicalStrategy } from '../../src/sim/strategy';
import { createStrategySearchPsroArtifact, validateStrategySearchPsroArtifact } from '../../src/sim/strategySearchPsro';
import {
  createParallelAdmissionRowChunk, createParallelPsroCheckpoint, createParallelPsroScoreTaskChunk,
  partitionParallelPsroLook, reduceParallelAdmissionRow, reduceParallelPsroLook, startParallelPsro
} from '../../src/sim/strategySearchParallelPsro';
import type {
  ParallelPsroLookDescriptor, ParallelPsroSemanticCheckpoint, ParallelPsroTransition
} from '../../src/sim/strategySearchParallelPsro';
import { createThresholdRacingProtocol, scheduleSlice } from '../../src/sim/thresholdRacingPsro';

const kingdomId = 'balance-tuning-002';
beforeAll(() => { strategySearchKingdom(kingdomId); });
function source() {
  const candidates = Array.from({ length: 52 }, (_unused, index) => {
    const strategy = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'buy',
      cardId: index % 2 ? 'drive' : 'volley', desiredCount: index + 1 }]) });
    return { goldfishRank: index + 1, strategyId: strategy.id,
      canonicalStrategy: canonicalStrategy(strategy), strategy };
  });
  const strategies = candidates.slice(0, 50).map((candidate) => candidate.strategy);
  const centeredPayoffs = strategies.map(() => strategies.map(() => 0));
  const matrix = { protocol: matrixProtocol(kingdomId, Array.from({ length: 75 }, (_unused, index) => index + 1),
    30, 200, false), strategies, cells: [], complete: true, centeredPayoffs };
  const protocol = createThresholdRacingProtocol({ experimentName: 'fixture', runId: 'main', kingdomId,
    reservoirCount: candidates.length, sourceIdentityHash: 'a'.repeat(64), checkpointNamespace: 'b'.repeat(64),
    matrixSeedNamespace: 'matrix-fixture', screenSeedNamespace: 'screen-fixture',
    confirmationSeedNamespace: 'confirmation-fixture', queueRetestSeedNamespace: 'retest-fixture' });
  return { candidates, matrix, protocol };
}
function initial(): ParallelPsroTransition { const held = source();
  return startParallelPsro(createParallelPsroCheckpoint(held)); }
function score(transition: Extract<ParallelPsroTransition, { kind: 'score' }>,
  value: number | ((strategyId: string) => number), targetTasks = 50): ParallelPsroTransition {
  const { checkpoint, look } = transition;
  const candidates = new Map(checkpoint.candidates.map((entry) => [entry.strategyId, entry]));
  const tasks = partitionParallelPsroLook(look, { targetTasks });
  const chunks = tasks.map((task) => {
    const field = look.candidateIds.slice(task.candidateStart, task.candidateEnd).map((id) => candidates.get(id)!);
    const suffix = scheduleSlice(look.fullSchedule, task.scheduleStart, task.scheduleEnd);
    return createParallelPsroScoreTaskChunk({ checkpoint, look, task,
      rows: field.map((entry) => { const held = typeof value === 'number' ? value : value(entry.strategyId);
        const telemetry = emptyAggregate(), blocks = suffix.blocks.length;
        telemetry.damageByCard.volley = blocks;
        telemetry.byOrientation.firstOchre.normal = { played: blocks, wins: blocks, draws: 0, losses: 0, aborted: 0 };
        telemetry.byOrientation.firstIndigo.normal = { played: blocks, wins: 0, draws: 0, losses: blocks, aborted: 0 };
        return { strategy: entry.strategy, mean: held, blockScores: suffix.blocks.map(() => held), interval: null,
          matches: blocks * 2, telemetry }; }) });
  }).reverse();
  return reduceParallelPsroLook({ checkpoint, look, tasks, chunks });
}
function asScore(value: ParallelPsroTransition): Extract<ParallelPsroTransition, { kind: 'score' }> {
  expect(value.kind).toBe('score'); return value as Extract<ParallelPsroTransition, { kind: 'score' }>;
}
function finishRace(transition: ParallelPsroTransition, value: number | ((strategyId: string) => number),
  targetTasks = 50): ParallelPsroTransition {
  const initialKind = asScore(transition).look.raceKind;
  let held = transition;
  while (held.kind === 'score' && held.look.raceKind === initialKind) held = score(held, value, targetTasks);
  return held;
}
function unresolved(checkpoint: ParallelPsroSemanticCheckpoint, kind: 'screen' | 'confirmation' | 'queue-retest') {
  return checkpoint.decisions.filter((record) => record.raceKind === kind)
    .flatMap((record) => record.decisions).filter((decision) => decision.status === 'unresolved');
}

describe('parallel PSRO production transition', () => {
  it('exposes substantial concurrency for every K005-sized screen look and preserves exact coverage', () => {
    const transition = asScore(initial());
    const looks = [
      [19_950, 0, 8], [19_206, 8, 16], [8_834, 16, 32], [3_857, 32, 64],
      [758, 64, 128], [356, 128, 256], [289, 256, 512]
    ] as const;
    for (const [candidateCount, scheduleStart, scheduleEnd] of looks) {
      const look = { ...transition.look,
        candidateIds: Array.from({ length: candidateCount }, (_unused, index) => `candidate-${index}`),
        candidateCanonicals: Array.from({ length: candidateCount }, (_unused, index) => `canonical-${index}`),
        scheduleStart, scheduleEnd };
      const tasks = partitionParallelPsroLook(look);
      expect(tasks.length * 4).toBeGreaterThan(36);
      expect(tasks.length * 4).toBeLessThanOrEqual(400);
      expect(partitionParallelPsroLook(look, { maxTasks: 10 }).length).toBeLessThanOrEqual(10);
      expect(tasks.reduce((sum, task) => sum + (task.candidateEnd - task.candidateStart)
        * (task.scheduleEnd - task.scheduleStart), 0)).toBe(candidateCount * (scheduleEnd - scheduleStart));
      expect(new Set(tasks.map((task) => `${task.candidateStart}:${task.candidateEnd}`)).size).toBeGreaterThan(1);
      expect(new Set(tasks.map((task) => `${task.scheduleStart}:${task.scheduleEnd}`)).size).toBeGreaterThan(1);
    }
  });

  it('produces byte-identical decisions across materially different task layouts', () => {
    const transition = asScore(initial());
    expect(score(transition, 0.5, 25)).toEqual(score(transition, 0.5, 50));
  });

  it('preserves candidate-major score order and finishes after two clean searches', () => {
    const complete = finishRace(initial(), 0);
    expect(complete.kind).toBe('complete');
    expect(complete.checkpoint.cleanSearches).toBe(2);
    expect(complete.checkpoint.stopReason).toBe('empirical-two-clean-scans');
    const finalByCandidate = new Map<string, string>();
    complete.checkpoint.decisions.forEach((record) => record.decisions.forEach((decision) =>
      finalByCandidate.set(decision.strategyId, decision.status)));
    expect([...finalByCandidate.values()].every((status) => status === 'below')).toBe(true);
  });

  it('keeps capped screen uncertainty and confirms only provisional-above candidates', () => {
    const transition = asScore(initial()), ids = transition.look.candidateIds;
    const confirmation = finishRace(transition, (id) => id === ids[0] ? 1 : 0.5);
    expect(confirmation.kind).toBe('score');
    expect(asScore(confirmation).look.raceKind).toBe('confirmation');
    expect(asScore(confirmation).look.candidateIds).toEqual([ids[0]]);
    expect(unresolved(confirmation.checkpoint, 'screen').map((entry) => entry.strategyId)).toContain(ids[1]);
  }, 15_000);

  it('keeps capped confirmation uncertainty and admits only confirmed candidates', () => {
    const screen = finishRace(initial(), 1), ids = asScore(screen).look.candidateIds;
    const admission = finishRace(screen, (id) => id === ids[0] ? 1 : 0.5);
    expect(admission.kind).toBe('admission-row');
    if (admission.kind !== 'admission-row') throw new Error('Expected an admission row.');
    expect(admission.row.candidateId).toBe(ids[0]);
    expect(unresolved(admission.checkpoint, 'confirmation').map((entry) => entry.strategyId)).toContain(ids[1]);
  }, 15_000);

  it('keeps capped queue-retest uncertainty, clears the unconfirmed queue, and starts a new screen', () => {
    const confirmation = finishRace(finishRace(initial(), 1), 1);
    expect(confirmation.kind).toBe('admission-row');
    if (confirmation.kind !== 'admission-row') throw new Error('Expected an admission row.');
    const rowChunk = createParallelAdmissionRowChunk({ row: confirmation.row, taskIndex: 0,
      cells: confirmation.row.opponentIds.map((opponentId) => ({ opponentId,
        scores: confirmation.row.seeds.map(() => 0.75), played: confirmation.row.seeds.map(() => 2),
        telemetry: emptyAggregate() })) });
    const retest = reduceParallelAdmissionRow({ checkpoint: confirmation.checkpoint,
      row: confirmation.row, chunks: [rowChunk] });
    expect(asScore(retest).look.raceKind).toBe('queue-retest');
    const next = finishRace(retest, 0.5);
    expect(asScore(next).look.raceKind).toBe('screen');
    expect(next.checkpoint.queue).toHaveLength(0);
    expect(unresolved(next.checkpoint, 'queue-retest')).not.toHaveLength(0);
  }, 30_000);

  it('counts two capped unresolved searches as clean while retaining every unresolved decision', () => {
    const transition = finishRace(initial(), 0.5);
    expect(transition.kind).toBe('complete');
    expect(transition.checkpoint.cleanSearches).toBe(2);
    expect(unresolved(transition.checkpoint, 'screen')).toHaveLength(28);
    const { candidates, looks, ...semanticCheckpoint } = transition.checkpoint;
    const artifact = createStrategySearchPsroArtifact({ evidenceId: 'b'.repeat(64),
      matrixEvidenceHash: 'c'.repeat(64), candidateIds: candidates.map((candidate) => candidate.strategyId),
      rawLooks: looks, checkpoint: semanticCheckpoint, finalStatus: 'complete' });
    expect(validateStrategySearchPsroArtifact(artifact)).toBe(true);
    expect(JSON.stringify(artifact.semanticCheckpoint)).toContain('unresolved');
  }, 30_000);

  it('rejects stale checkpoints before a transition', () => {
    const transition = asScore(initial()), stale = structuredClone(transition.checkpoint) as ParallelPsroSemanticCheckpoint;
    stale.equilibrium = solveEquilibrium(stale.matrix.strategies.map((strategy) => strategy.id),
      stale.matrix.centeredPayoffs); stale.cleanSearches = 1;
    expect(() => reduceParallelPsroLook({ checkpoint: stale,
      look: transition.look as ParallelPsroLookDescriptor, tasks: [], chunks: [] })).toThrow('checkpoint');
  });
});
