import { describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { identify, fixedBuyPlan, INFINITE_COUNT, canonicalStrategy, stableHash } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import { solveEquilibrium } from '../../src/sim/equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../../src/sim/experimentConfig';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { evaluateCandidates } from '../../src/sim/mixtureEvaluation';
import { InlinePairingRunner } from '../../src/sim/pairingRunner';
import type { MatrixSnapshot } from '../../src/sim/payoffMatrix';
import {
  CONSISTENCY_EVALUATION_SEEDS, ConsistencySeedPlanner, RACE_PROTOCOLS, adaptiveBoundary,
  createSelectedRunCheckpoint, immutableRegistryWrite, lotteryTotalVariation, nominalSurvivorCount,
  pairingScoreAllocation, raceFunnel, raceProtocol, registryHash, runProtocolScan, selectPilotProtocol, supportIdentity,
  supportJaccard, transitionClosureState, validateConsistencySeedPlan, validateKnownAttackerRegistry,
  validateProtocolScan, validateSelectedRunCheckpoint, wilsonScoreInterval
} from '../../src/sim/fixedReservoirConsistency';
import type {
  ClosureState, KnownAttackerRegistry, PilotOutcome, ProtocolScanEvidence, RaceProtocolId,
  ScoreAllocation
} from '../../src/sim/fixedReservoirConsistency';

function strategy(index: number): Strategy {
  return identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: index % 2 ? 'strike' : 'precisionShot', desiredCount: index + 1 },
    { kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }
  ]) });
}
const active = [strategy(100), strategy(101)];
const snapshot: MatrixSnapshot = { protocol: { kingdomId: 'fixture', cards: [], seeds: [1],
  turnLimitPerPlayer: 50, actionCapPerTurn: 200, startingDraftEnabled: false,
  orientationProtocol: 'fixture', rulesFingerprint: '123456789' }, strategies: active, cells: [], complete: true,
centeredPayoffs: [[0, 0], [0, 0]] };
const equilibrium = solveEquilibrium(active.map((entry) => entry.id), snapshot.centeredPayoffs);

function queuedScore(values: number[][]): ScoreAllocation {
  let call = 0;
  return async ({ candidates, schedule }) => {
    const held = values[call++] ?? candidates.map((_entry, index) => index / Math.max(1, candidates.length - 1));
    if (held.length !== candidates.length) throw new Error('fixture field mismatch');
    return candidates.map((entry, index) => ({ strategy: entry,
      blockScores: Array.from({ length: schedule.blocks.length }, () => held[index]!),
      matches: schedule.blocks.length * 4 }));
  };
}
function idScore(reverse = false): ScoreAllocation {
  return async ({ candidates, schedule }) => {
    const rows = candidates.map((entry) => ({ strategy: entry,
      blockScores: Array.from({ length: schedule.blocks.length }, () =>
        (Number.parseInt(entry.id.slice(3, 5), 16) % 20) / 20), matches: schedule.blocks.length * 4 }));
    return reverse ? rows.reverse() : rows;
  };
}
async function scan(protocolId: RaceProtocolId, score: ScoreAllocation, count = 9): Promise<ProtocolScanEvidence> {
  return runProtocolScan({ protocolId, phase: protocolId === 'closure-union-cumulative-v1'
    ? 'selected-closure' : 'search', namespace: 'round:0', candidates: Array.from({ length: count }, (_u, index) => strategy(index)),
  snapshot, equilibrium, planner: new ConsistencySeedPlanner('98f3167850a6f9', 7_100_009), score, now: () => 0 });
}

describe('fixed-reservoir consistency protocols', () => {
  it('pins all definitions and the exact legacy funnel including fields at or below three', () => {
    expect(Object.keys(RACE_PROTOCOLS)).toEqual(['legacy-stage-v1', 'cumulative-v1', 'early-4x-v1',
      'union-2x-v1', 'adaptive-boundary-v1', 'closure-union-cumulative-v1']);
    expect(raceProtocol('legacy-stage-v1')).toMatchObject({ stageBlocks: [1, 2, 4, 8], ranking: 'stage-local',
      racePasses: 1, finalistLimit: 8, confirmationBlocks: 400 });
    expect([1, 2, 3, 4].map(nominalSurvivorCount)).toEqual([1, 1, 1, 3]);
    expect(raceFunnel(567)).toEqual([567, 189, 63, 21, 7]);
    expect(raceFunnel(568)).toEqual([568, 190, 64, 22, 8]);
    expect(raceFunnel(569)).toEqual([569, 190, 64, 22, 8]);
  });

  it('distinguishes stage-local and cumulative ranking on the same base evidence', async () => {
    const evidence = [
      [0.99, 0.5, 0.4, 0.1],
      [0.4, 0.6, 0.5],
      [0.6], [0.6], [0.5]
    ];
    const legacy = await scan('legacy-stage-v1', queuedScore(evidence), 4);
    const cumulative = await scan('cumulative-v1', queuedScore(evidence), 4);
    expect(legacy.allocations[1]!.candidates[0]!.strategyId)
      .not.toBe(cumulative.allocations[1]!.candidates[0]!.strategyId);
  });

  it('unions two independent finalist races before one confirmation', async () => {
    const fields = [[0.9, 0.8, 0.7, 0.1], [0.9, 0.8, 0.7], [0.9], [0.9],
      [0.1, 0.7, 0.8, 0.9], [0.7, 0.8, 0.9], [0.9], [0.9], [0.6, 0.7]];
    const result = await scan('union-2x-v1', queuedScore(fields), 4);
    expect(result.passFinalists).toHaveLength(2);
    expect(result.unionStrategyIds).toHaveLength(2);
    expect(result.confirmationSeeds).toHaveLength(400);
    expect(result.bootstrapSeeds).toHaveLength(2);
  });

  it('uses exact Wilson allocation, inclusive ties, fresh extras, cap, and cumulative reranking', async () => {
    const interval = wilsonScoreInterval(0.5, 1);
    expect(interval.lower).toBeCloseTo(0.15003898915214958, 12);
    expect(interval.upper).toBeCloseTo(0.8499610108478504, 12);
    const rows = Array.from({ length: 9 }, (_u, index) => ({ strategyId: `s${index}`,
      canonicalStrategy: `c${index}`, mean: 0.9 - index * 0.01 }));
    const boundary = adaptiveBoundary(rows, new Map(rows.map((entry) => [entry.strategyId, 1])));
    expect(boundary.nominalCount).toBe(3);
    expect(boundary.boundary).toHaveLength(6);
    const result = await scan('adaptive-boundary-v1', idScore(), 9);
    const base = result.allocations[0]!, extra = result.allocations[1]!;
    expect(base.boundaryStrategyIds).toHaveLength(6);
    expect(extra.seedLabel).toContain('adaptive-extra');
    expect(new Set([...base.seeds, ...extra.seeds]).size).toBe(base.seeds.length + extra.seeds.length);
    expect(extra.candidates.every((entry) => entry.cumulativeBlockScores.length === 2)).toBe(true);
    expect(extra.candidates.filter((entry) => entry.survived)).toHaveLength(3);
  });

  it('derives disjoint order-independent seeds and rejects mutation', () => {
    const first = new ConsistencySeedPlanner('98f3167850a6f9', 7_100_009);
    const b = first.derive('search', 'round:1:confirmation', 4);
    const a = first.derive('search', 'round:0:race', 3);
    const second = new ConsistencySeedPlanner('98f3167850a6f9', 7_100_009);
    expect(second.derive('search', 'round:0:race', 3)).toEqual(a);
    expect(second.derive('search', 'round:1:confirmation', 4)).toEqual(b);
    expect(new Set([...a, ...b]).size).toBe(7);
    expect(validateConsistencySeedPlan(first.plan)).toBe(true);
    const changed = structuredClone(first.plan); changed.namespaces[0]!.seeds.reverse();
    expect(validateConsistencySeedPlan(changed)).toBe(false);
  });

  it('is deterministic under reversed completion and records complete candidate coverage', async () => {
    for (const protocolId of Object.keys(RACE_PROTOCOLS) as RaceProtocolId[]) {
      const forward = await scan(protocolId, idScore(), 9);
      const reverse = await scan(protocolId, idScore(true), 9);
      const clean = (value: ProtocolScanEvidence) => ({ ...value, elapsedMs: 0, evidenceHash: '' });
      expect(clean(reverse)).toEqual(clean(forward));
      expect(forward.completeCandidateCoverage).toBe(9);
      expect(forward.allocations[0]!.entered).toBe(9);
      expect(validateProtocolScan(forward, snapshot, equilibrium)).toBe(true);
    }
  });

  it('rejects score, rank, survivor, mean, interval, seed, and evidence mutations', async () => {
    const original = await scan('adaptive-boundary-v1', idScore(), 9);
    const rejects = (mutate: (copy: ProtocolScanEvidence) => void) => {
      const copy = structuredClone(original); mutate(copy); expect(validateProtocolScan(copy, snapshot, equilibrium)).toBe(false);
    };
    rejects((copy) => { copy.allocations[0]!.candidates[0]!.blockScores[0]! += 0.01; });
    rejects((copy) => { copy.allocations[0]!.candidates[0]!.rank = 2; });
    rejects((copy) => { copy.allocations[0]!.candidates[0]!.survived = !copy.allocations[0]!.candidates[0]!.survived; });
    rejects((copy) => { copy.allocations[0]!.candidates[0]!.mean += 0.01; });
    rejects((copy) => { copy.finalists[0]!.interval95.lower += 0.01; });
    rejects((copy) => { copy.confirmationSeeds.reverse(); });
  });

  it('fails invalid and incomplete block allocations instead of treating them as clean', async () => {
    await expect(scan('legacy-stage-v1', async ({ candidates, schedule }) => candidates.map((entry) => ({ strategy: entry,
      blockScores: schedule.blocks.slice(1).map(() => 0.5), matches: schedule.blocks.length * 4 })), 4))
      .rejects.toThrow('invalid block');
  });

  it('keeps full and score-only blocks, races, unions, adaptive allocation, and confirmation equal', async () => {
    const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
    registerKingdom(kingdom); const runner = new InlinePairingRunner();
    const full: ScoreAllocation = async ({ candidates, opponents, schedule }) =>
      (await evaluateCandidates(candidates, opponents, schedule, runner, { kingdomId: kingdom.id,
        turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN,
        startingDraftEnabled: false, scoreOnly: false }))
        .map((entry) => ({ strategy: entry.strategy, blockScores: entry.blockScores, matches: entry.matches }));
    try {
      for (const protocolId of Object.keys(RACE_PROTOCOLS) as RaceProtocolId[]) {
        const phase = protocolId === 'closure-union-cumulative-v1' ? 'selected-closure' : 'search';
        const input = { protocolId, phase, namespace: 'equivalence', candidates: Array.from({ length: 4 }, (_u, index) => strategy(index)),
          snapshot, equilibrium, now: () => 0 } as const;
        const verbose = await runProtocolScan({ ...input,
          planner: new ConsistencySeedPlanner('98f3167850a6f9', 7_100_009), score: full });
        const compact = await runProtocolScan({ ...input,
          planner: new ConsistencySeedPlanner('98f3167850a6f9', 7_100_009),
          score: pairingScoreAllocation(runner, kingdom.id) });
        expect(compact).toEqual(verbose);
      }
    } finally { await runner.close(); resetKingdoms(); }
  }, 120_000);
});

describe('fixed-reservoir closure, registry, checkpoint, metrics, and decision', () => {
  const state: ClosureState = { cleanStreak: 1, closureCycle: 0, nextPhase: 'ordinary-scan',
    snapshotHash: 'snapshot-a', status: 'incomplete' };
  it('implements ordinary, closure, direct-admission, cap, and failure transitions', () => {
    const closure = transitionClosureState(state, { kind: 'ordinary', admitted: 0 });
    expect(closure.nextPhase).toBe('closure-scan');
    const direct = transitionClosureState(closure, { kind: 'closure', admitted: 0 });
    expect(direct.nextPhase).toBe('direct-check');
    expect(transitionClosureState(direct, { kind: 'direct', admitted: 0 }).status).toBe('complete');
    expect(transitionClosureState(direct, { kind: 'direct', admitted: 1 })).toMatchObject({ cleanStreak: 0,
      closureCycle: 1, nextPhase: 'ordinary-scan' });
    const capped = { ...closure, closureCycle: 3 };
    expect(transitionClosureState(capped, { kind: 'closure', admitted: 1 }).status).toBe('unresolved');
    for (const reason of ['timeout', 'abort', 'invalid-block', 'ordinary-safety-cap', 'closure-cycle-cap'] as const) {
      expect(transitionClosureState(state, { kind: 'failure', reason }).status).toBe('unresolved');
    }
  });

  it('validates immutable attacker registries and rejects empty/changed evidence correctly', () => {
    const base = { schemaVersion: 1 as const, experiment: 'fixed-reservoir-consistency-attacker-registry' as const,
      version: 'fixed-reservoir-consistency-v1' as const, reservoirHash: '98f3167850a6f9', frozen: true as const,
      entries: [], sentinelByTarget: { '7100009': [] } };
    const empty: KnownAttackerRegistry = { ...base, evidenceHash: registryHash(base) };
    expect(validateKnownAttackerRegistry(empty)).toBe(true);
    expect(immutableRegistryWrite(null, empty)).toBe(empty);
    const changedBase = { ...base, sentinelByTarget: { '7100009': ['x'] } };
    const changed = { ...changedBase, evidenceHash: registryHash(changedBase) };
    expect(() => immutableRegistryWrite(empty, changed)).toThrow('immutable');
  });

  it('pins TV and Jaccard metrics at disjoint, shared, and threshold edges', () => {
    expect(lotteryTotalVariation({ a: 1 }, { b: 1 })).toBe(1);
    expect(lotteryTotalVariation({ a: 0.5, b: 0.5 }, { a: 0.25, b: 0.75 })).toBe(0.25);
    expect(supportJaccard(['a'], ['b'])).toBe(0);
    expect(supportJaccard(['a', 'b'], ['b', 'c'])).toBe(1 / 3);
    expect(supportJaccard([], [])).toBe(1);
    const held = { ...equilibrium, strategyIds: ['a', 'b'], weights: { a: 1e-6, b: 1.1e-6 } };
    expect(supportIdentity(held)).toEqual(['b']);
  });

  it('selects by material time, matches, simplicity, fallback, and no qualifier', () => {
    const rows = (id: PilotOutcome['protocolId'], time: number, matches: number, pass = true): PilotOutcome[] =>
      CONSISTENCY_EVALUATION_SEEDS.map((targetEvaluationSeed) => ({ protocolId: id, targetEvaluationSeed,
        elapsedMs: time, matches, detectedStrategyIds: ['attacker'], scriptedAttackerPassed: pass }));
    expect(selectPilotProtocol([...rows('cumulative-v1', 1000, 100), ...rows('adaptive-boundary-v1', 700, 200)],
      ['attacker']).selected).toBe('adaptive-boundary-v1');
    expect(selectPilotProtocol([...rows('cumulative-v1', 1000, 100), ...rows('adaptive-boundary-v1', 800, 90)],
      ['attacker']).selected).toBe('adaptive-boundary-v1');
    expect(selectPilotProtocol([...rows('cumulative-v1', 1000, 100), ...rows('adaptive-boundary-v1', 980, 100)],
      []).selected).toBe('cumulative-v1');
    const decision = selectPilotProtocol([...rows('cumulative-v1', 1000, 100), ...rows('union-2x-v1', 2000, 200)], ['attacker']);
    expect(decision.fallback).toBe('union-2x-v1');
    expect(selectPilotProtocol(rows('cumulative-v1', 1000, 100, false), []).selected).toBeNull();
    expect(selectPilotProtocol(rows('cumulative-v1', 1000, 100, false), ['attacker']).selected)
      .toBe('cumulative-v1');
  });

  it('validates checkpoint interfaces and rejects stale phase, support, protocol, and hash', () => {
    const one = strategy(1); const matrix: MatrixSnapshot = { ...snapshot, strategies: [one], cells: [],
      centeredPayoffs: [[0]] }; const solved = solveEquilibrium([one.id], [[0]]);
    const planner = new ConsistencySeedPlanner('98f3167850a6f9', 7_100_009);
    const checkpoint = createSelectedRunCheckpoint({ reservoirHash: '98f3167850a6f9', evaluationSeed: 7_100_009,
      protocol: { ...raceProtocol('cumulative-v1'), stageBlocks: [...raceProtocol('cumulative-v1').stageBlocks] },
      seedPlan: planner.plan, activeStrategyIds: [one.id], matrix, equilibrium: solved, scans: [], admissions: [],
      state: { cleanStreak: 0, closureCycle: 0, nextPhase: 'ordinary-scan',
        snapshotHash: stableCheckpointSnapshot(matrix, solved), status: 'incomplete' }, elapsedMs: 0 });
    expect(validateSelectedRunCheckpoint(checkpoint)).toBe(true);
    const mutate = (key: 'next' | 'support' | 'protocol') => { const copy = structuredClone(checkpoint);
      if (key === 'next') copy.state.nextPhase = 'complete';
      if (key === 'support') copy.equilibrium.weights[one.id] = 0.9;
      if (key === 'protocol') (copy.protocol.stageBlocks as number[])[0] = 2;
      return copy; };
    expect(validateSelectedRunCheckpoint(mutate('next'))).toBe(false);
    expect(validateSelectedRunCheckpoint(mutate('support'))).toBe(false);
    expect(validateSelectedRunCheckpoint(mutate('protocol'))).toBe(false);
  });
});

function stableCheckpointSnapshot(matrix: MatrixSnapshot, solved: ReturnType<typeof solveEquilibrium>): string {
  // Keep the public snapshot hash contract in the test without exporting artifact internals.
  const value = { strategies: matrix.strategies.map(canonicalStrategy), centeredPayoffs: matrix.centeredPayoffs,
    equilibrium: solved };
  // The stable hash is imported indirectly to avoid a duplicate fixture format.
  return lotterySnapshotHashForTest(value);
}
function lotterySnapshotHashForTest(value: unknown): string { return stableHash(JSON.stringify(value)); }
