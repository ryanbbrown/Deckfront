import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { solveEquilibrium } from '../../src/sim/equilibrium';
import { emptyAggregate } from '../../src/sim/pairing';
import { matrixProtocol } from '../../src/sim/payoffMatrix';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';
import { canonicalStrategy } from '../../src/sim/strategy';
import {
  createParallelAdmissionRowChunk, createParallelPsroCheckpoint, reduceParallelAdmissionRow,
  reduceParallelPsroLook, startParallelPsro
} from '../../src/sim/strategySearchParallelPsro';
import type {
  ParallelPsroLookDescriptor, ParallelPsroSemanticCheckpoint, ParallelPsroTransition
} from '../../src/sim/strategySearchParallelPsro';
import {
  createRawPsroScoreChunk, createThresholdRacingProtocol
} from '../../src/sim/thresholdRacingPsro';

const kingdomId = 'deep-beam-tuning-002';
beforeAll(() => registerKingdom(deepBeamSuite.kingdoms.find((kingdom) => kingdom.id === kingdomId)!));
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
function score(transition: Extract<ParallelPsroTransition, { kind: 'score' }>, value: number,
  split = false): ParallelPsroTransition {
  const { checkpoint, look } = transition, candidates = new Map(checkpoint.candidates.map((entry) => [entry.strategyId, entry]));
  const ranges = split ? [[0, 1], [1, look.candidateIds.length]] : [[0, look.candidateIds.length]];
  const chunks = ranges.filter(([start, end]) => end! > start!).map(([start, end]) => {
    const field = look.candidateIds.slice(start, end).map((id) => candidates.get(id)!);
    return createRawPsroScoreChunk({ protocol: checkpoint.protocol, raceKind: look.raceKind,
      lookId: look.lookId, lookDepth: look.lookDepth, familySize: look.familySize, alpha: look.alpha,
      candidates: field.map((entry) => ({ identity: entry, strategy: entry.strategy })), candidateStart: start!,
      fullSchedule: look.fullSchedule, suffixSchedule: look.suffixSchedule, scheduleStart: look.scheduleStart,
      rows: field.map((entry) => ({ strategy: entry.strategy, mean: value,
        blockScores: look.suffixSchedule.blocks.map(() => value), interval: null,
        matches: look.suffixSchedule.blocks.length * 2, telemetry: emptyAggregate() })) });
  }).reverse();
  return reduceParallelPsroLook({ checkpoint, look, chunks });
}
function asScore(value: ParallelPsroTransition): Extract<ParallelPsroTransition, { kind: 'score' }> {
  expect(value.kind).toBe('score'); return value as Extract<ParallelPsroTransition, { kind: 'score' }>;
}
function finishRace(transition: ParallelPsroTransition, value: number): ParallelPsroTransition {
  const initialKind = asScore(transition).look.raceKind;
  let held = transition;
  while (held.kind === 'score' && held.look.raceKind === initialKind) held = score(held, value, true);
  return held;
}

describe('parallel PSRO production transition', () => {
  it('preserves candidate-major score order across shuffled chunks and finishes after two clean searches', () => {
    const complete = finishRace(initial(), 0);
    expect(complete.kind).toBe('complete');
    expect(complete.checkpoint.cleanSearches).toBe(2);
    expect(complete.checkpoint.stopReason).toBe('empirical-two-clean-scans');
    const finalByCandidate = new Map<string, string>();
    complete.checkpoint.decisions.forEach((record) => record.decisions.forEach((decision) =>
      finalByCandidate.set(decision.strategyId, decision.status)));
    expect([...finalByCandidate.values()].every((status) => status === 'below')).toBe(true);
  });

  it('waits for the complete screen family before applying Bonferroni confirmation', () => {
    const confirmation = finishRace(initial(), 1);
    expect(confirmation.kind).toBe('score');
    const held = asScore(confirmation);
    expect(held.look.raceKind).toBe('confirmation');
    expect(held.look.familySize).toBe(2);
    expect(held.look.alpha).toBe(0.025);
    const admission = finishRace(held, 1);
    expect(admission.kind).toBe('admission-row');
    if (admission.kind !== 'admission-row') throw new Error('Expected an admission row.');
    expect(admission.row.opponentIds).toHaveLength(50);
    const rowChunk = createParallelAdmissionRowChunk({ row: admission.row, taskIndex: 0,
      cells: admission.row.opponentIds.map((opponentId) => ({ opponentId,
        scores: admission.row.seeds.map(() => 0.75), played: admission.row.seeds.map(() => 2),
        telemetry: emptyAggregate() })) });
    const retest = reduceParallelAdmissionRow({ checkpoint: admission.checkpoint,
      row: admission.row, chunks: [rowChunk] });
    expect(retest.kind).toBe('score');
    expect(retest.checkpoint.matrix.strategies).toHaveLength(51);
    expect(retest.checkpoint.matrix.strategies.map((strategy) => strategy.id))
      .toEqual([...retest.checkpoint.matrix.strategies.map((strategy) => strategy.id)].sort());
    if (retest.kind === 'score') expect(retest.look.raceKind).toBe('queue-retest');
    expect(() => reduceParallelAdmissionRow({ checkpoint: admission.checkpoint,
      row: admission.row, chunks: [rowChunk, rowChunk] })).toThrow('stale');
  });

  it('makes a capped unresolved screen terminal-incomplete and never clean', () => {
    let transition = initial();
    for (let look = 0; look < 7; look += 1) transition = score(asScore(transition), 0.5, true);
    expect(transition.kind).toBe('terminal-incomplete');
    expect(transition.checkpoint.cleanSearches).toBe(0);
    expect(transition.checkpoint.stopReason).toBe('fixed-protocol-look-cap-unresolved');
  });

  it('rejects stale checkpoints before a transition', () => {
    const transition = asScore(initial()), stale = structuredClone(transition.checkpoint) as ParallelPsroSemanticCheckpoint;
    stale.equilibrium = solveEquilibrium(stale.matrix.strategies.map((strategy) => strategy.id),
      stale.matrix.centeredPayoffs); stale.cleanSearches = 1;
    expect(() => reduceParallelPsroLook({ checkpoint: stale,
      look: transition.look as ParallelPsroLookDescriptor, chunks: [] })).toThrow('checkpoint');
  });
});
