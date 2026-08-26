import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { solveEquilibrium } from '../../src/sim/equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../../src/sim/experimentConfig';
import {
  ConsistencySeedPlanner, protocolScanEvidenceHash, runProtocolScan, validateProtocolScan
} from '../../src/sim/fixedReservoirConsistency';
import type { ScoreAllocation } from '../../src/sim/fixedReservoirConsistency';
import { matrixProtocol, PayoffMatrix } from '../../src/sim/payoffMatrix';
import type { MatrixSnapshot } from '../../src/sim/payoffMatrix';
import type { ReservoirEntry } from '../../src/sim/fixedReservoirPsro';
import type { OrderedChallengePoolArtifact } from '../../src/sim/orderedReservoirChallenge';
import {
  createOrderedRobustCheckpoint, historicalAuditCandidates, initialRobustRunState,
  orderedRobustProtocolDefinition, reconstructRobustMatrixCache, transitionRobustRunState,
  validateOrderedRobustCheckpoint
} from '../../src/sim/orderedReservoirRobustPsro';
import {
  diagnoseOrderedCandidateMembership, lookupSplitRankedStrategies, nearestOrderedAnalogs
} from '../../src/sim/orderedStrategyDiagnostics';
import {
  combineScoreEvidence, deriveScoreEvidence, rankingKey
} from '../../src/sim/orderedGoldfishProduct';
import type {
  OrderedProductProfileEvidence, OrderedProductRankedRecord
} from '../../src/sim/orderedGoldfishProduct';
import { createOrderedCandidateSpace, orderedGoldfishCardIds } from '../../src/sim/orderedGoldfishBenchmark';
import { rulesFingerprint } from '../../src/sim/rulesFingerprint';
import {
  INFINITE_COUNT, canonicalStrategy, fixedBuyPlan, identify
} from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import type { LegacyFixedReservoirPoolArtifact } from '../../src/sim/legacyFixedReservoirV1';
import { InlinePairingRunner } from '../../src/sim/pairingRunner';

const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
beforeAll(() => registerKingdom(kingdom));

function strategy(index: number): Strategy {
  return identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: index % 2 ? 'strike' : 'precisionShot', desiredCount: index + 1 },
    { kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }
  ]) });
}
const targetStrategies = [strategy(100), strategy(101)];
const targetMatrix: MatrixSnapshot = { protocol: { kingdomId: 'fixture', cards: [], seeds: [1],
  turnLimitPerPlayer: 50, actionCapPerTurn: 200, startingDraftEnabled: false,
  orientationProtocol: 'fixture', rulesFingerprint: '123456789' }, strategies: targetStrategies,
  cells: [], complete: true, centeredPayoffs: [[0, 0], [0, 0]] };
const targetEquilibrium = solveEquilibrium(targetStrategies.map((entry) => entry.id), [[0, 0], [0, 0]]);

function queuedScore(values: number[][]): ScoreAllocation {
  let call = 0;
  return async ({ candidates, schedule }) => {
    const scores = values[call++]!;
    if (scores.length !== candidates.length) throw new Error(`fixture mismatch at call ${call}`);
    return candidates.map((candidate, index) => ({ strategy: candidate,
      blockScores: Array.from({ length: schedule.blocks.length }, () => scores[index]!),
      matches: schedule.blocks.length * 2 }));
  };
}

function scoreEvidence(offset: number) {
  const profiles: OrderedProductProfileEvidence[] = ['stationary', 'chaser', 'kiter'].map((profile, index) => ({
    profile, trials: 1, completions: index < 2 ? 1 : 0,
    penalizedTurnsTo50: 10 + offset + index, damageArea: 20 + offset - index, moneySpent: 4 + index
  }));
  return deriveScoreEvidence(profiles);
}
function rankedRecord(candidate: Strategy, rank: number): OrderedProductRankedRecord {
  const stageOne = scoreEvidence(rank), additional = scoreEvidence(rank + 1);
  const combined = combineScoreEvidence(stageOne, additional);
  return { traversalPosition: rank + 10, displayId: candidate.id,
    canonicalStrategy: canonicalStrategy(candidate), strategy: candidate,
    stageOne, stageOneRankingKey: rankingKey(stageOne), additional, combined,
    combinedRankingKey: rankingKey(combined), stageOneRank: rank, rank };
}

function poolEntry(candidate: Strategy, rank: number): ReservoirEntry {
  return { strategy: candidate, source: 'goldfish', goldfishRank: rank,
    score: { worstCompletions: 0, totalCompletions: 0, worstPenalizedTurnsTo50: 1,
      totalPenalizedTurnsTo50: 1, worstDamageArea: 1, totalDamageArea: 1 } };
}
function smallPool(candidate: Strategy): OrderedChallengePoolArtifact {
  return { schemaVersion: 2, experiment: 'fixed-reservoir-pool', version: 'fixed-reservoir-psro-v2',
    kingdomId: kingdom.id, poolSeed: 0, goldfishSeeds: [1], generatedCount: 1,
    generatedHash: '123456789', canonicalProvenanceDigest: 'abcdef123', duplicateCanonicalCount: 0,
    displayIdCollisionCount: 0, scoringProtocol: 'fixture',
    shardProvenance: [{ shardId: '0', startPosition: 0, endPosition: 1,
      candidateDigest: 'abcdef123', scoreDigest: '987654321' }], reservoirHash: 'abcdef123',
    reservoir: [poolEntry(candidate, 1)], elapsedMs: 0,
    source: { validation: 'goldfish:ordered-product validate-reservoir',
      runId: 'native-e760135dba6f-5625a0ff0bf6048653f9', rankedSha256: 'a'.repeat(64),
      reservoirSha256: 'b'.repeat(64), buildVersion: 'fixture', ruleFingerprint: 'fixture' } };
}

describe('ordered robust race and state', () => {
  it('runs two independent cumulative passes and confirms their deterministic finalist union', async () => {
    const candidates = Array.from({ length: 4 }, (_unused, index) => strategy(index));
    const score = queuedScore([
      [0.9, 0.8, 0.7, 0.1], [0.9, 0.8, 0.7], [0.9], [0.9],
      [0.1, 0.7, 0.8, 0.9], [0.7, 0.8, 0.9], [0.9], [0.9], [0.6, 0.7]
    ]);
    const planner = new ConsistencySeedPlanner('abcdef123', 9_100_009);
    const scan = await runProtocolScan({ protocolId: 'closure-union-cumulative-v1',
      phase: 'search', namespace: 'robust:ordinary:0', candidates, snapshot: targetMatrix,
      equilibrium: targetEquilibrium, planner, score, now: () => 0 });
    expect(scan.protocol).toMatchObject({ ranking: 'cumulative', racePasses: 2, stageBlocks: [1, 2, 4, 8] });
    expect(scan.passFinalists).toHaveLength(2);
    expect(scan.unionStrategyIds).toHaveLength(2);
    expect(scan.confirmationSeeds).toHaveLength(400);
    expect(scan.bootstrapSeeds).toHaveLength(2);
    expect(scan.allocations.filter((entry) => entry.stage === 1)
      .every((entry) => entry.candidates.every((candidate) => candidate.cumulativeBlockScores.length === 3)))
      .toBe(true);
    const allSeeds = planner.plan.namespaces.flatMap((entry) => entry.seeds);
    expect(new Set(allSeeds).size).toBe(allSeeds.length);

    const changed = structuredClone(scan);
    changed.allocations[1]!.candidates[0]!.strategyId = candidates[3]!.id;
    const unhashed = structuredClone(changed) as Partial<typeof changed>;
    delete unhashed.evidenceHash; delete unhashed.elapsedMs;
    changed.evidenceHash = protocolScanEvidenceHash(unhashed as Omit<typeof changed, 'evidenceHash' | 'elapsedMs'>);
    expect(validateProtocolScan(changed, targetMatrix, targetEquilibrium)).toBe(false);
  });

  it('resets after admissions and keeps ordinary and closure cap hits incomplete', () => {
    let state = initialRobustRunState();
    state = transitionRobustRunState(state, { kind: 'ordinary', admitted: 0 }, { ordinary: 3, closure: 2 });
    state = transitionRobustRunState(state, { kind: 'ordinary', admitted: 0 }, { ordinary: 3, closure: 2 });
    expect(state.nextPhase).toBe('closure-scan');
    state = transitionRobustRunState(state, { kind: 'closure', admitted: 1 }, { ordinary: 3, closure: 2 });
    expect(state).toMatchObject({ cleanStreak: 0, closureCycles: 1, nextPhase: 'ordinary-scan' });
    expect(transitionRobustRunState(state, { kind: 'ordinary', admitted: 1 },
      { ordinary: 3, closure: 2 })).toMatchObject({ status: 'incomplete', stopReason: 'ordinary-safety-cap' });
    const closureReady = { ...state, nextPhase: 'closure-scan' as const };
    expect(transitionRobustRunState(closureReady, { kind: 'closure', admitted: 1 },
      { ordinary: 4, closure: 2 })).toMatchObject({ status: 'incomplete', stopReason: 'closure-cycle-cap' });
  });

  it('deep-validates a resumable initial checkpoint and rejects stale rules and audit-only old strategies', () => {
    const candidate = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id)).candidateAt(0);
    const pool = smallPool(candidate), planner = new ConsistencySeedPlanner(pool.reservoirHash, 123);
    const seeds = planner.derive('search', 'robust:matrix', 1);
    const matrix: MatrixSnapshot = { protocol: matrixProtocol(kingdom.id, seeds,
      TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false),
      strategies: [candidate], cells: [], complete: true, centeredPayoffs: [[0]] };
    const equilibrium = solveEquilibrium([candidate.id], [[0]]);
    const checkpoint = createOrderedRobustCheckpoint({ kingdomId: kingdom.id,
      poolHash: pool.generatedHash, reservoirHash: pool.reservoirHash,
      sourceRankedSha256: pool.source.rankedSha256,
      rulesFingerprint: rulesFingerprint(kingdom.id,
        TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false), evaluationSeed: 123,
      protocol: orderedRobustProtocolDefinition({ initialStrategies: 1, matrixBlocks: 1 }),
      initialStrategyIds: [candidate.id], seedPlan: planner.plan, records: [], admissions: [],
      matrix, equilibrium, state: initialRobustRunState(), elapsedMs: 0 });
    const options = { initialStrategies: 1, matrixBlocks: 1, evaluationSeeds: [123] };
    expect(validateOrderedRobustCheckpoint(checkpoint, pool, options)).toBe(true);
    const resumed = new PayoffMatrix(matrix.protocol, new InlinePairingRunner(),
      reconstructRobustMatrixCache(checkpoint));
    resumed.addStrategy(candidate);
    expect(resumed.snapshot()).toEqual(matrix);
    expect(validateOrderedRobustCheckpoint({ ...checkpoint,
      rulesFingerprint: { ...checkpoint.rulesFingerprint, hash: 'stale' } }, pool, options)).toBe(false);
    expect(validateOrderedRobustCheckpoint({ ...checkpoint,
      protocol: { ...checkpoint.protocol, matrixBlocks: 2 } }, pool, options)).toBe(false);

    const old = strategy(9);
    const oldMatrix = { ...matrix, strategies: [old] };
    const oldEquilibrium = solveEquilibrium([old.id], [[0]]);
    const oldCheckpoint = createOrderedRobustCheckpoint({ ...checkpoint, matrix: oldMatrix,
      equilibrium: oldEquilibrium, initialStrategyIds: [old.id], seedPlan: planner.plan, elapsedMs: 0 });
    expect(validateOrderedRobustCheckpoint(oldCheckpoint, pool, options)).toBe(false);
    const historical = { poolSeed: 1, reservoir: [poolEntry(candidate, 1), poolEntry(old, 2)]
    } as LegacyFixedReservoirPoolArtifact;
    expect(historicalAuditCandidates(historical, checkpoint).map((entry) => entry.id)).toEqual([old.id]);
    expect(checkpoint.matrix.strategies.map((entry) => entry.id)).toEqual([candidate.id]);
  });
});

describe('ordered generation diagnostics', () => {
  it('finds exact membership and reports every material old-plan violation', () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const exact = space.candidateAt(1234);
    const membership = diagnoseOrderedCandidateMembership(exact);
    expect(membership).toMatchObject({ representable: true, candidateIndex: 1234, violations: [] });
    expect(membership.traversalPosition).not.toBeNull();

    const old = identify({ id: '', startingBuild: ['strike'], buyPlan: fixedBuyPlan([
      { kind: 'buy', cardId: 'strike', desiredCount: INFINITE_COUNT },
      { kind: 'buy', cardId: 'gold', desiredCount: 8 },
      { kind: 'buy', cardId: 'step', desiredCount: 2 },
      { kind: 'buy', cardId: 'silver', desiredCount: 9 },
      { kind: 'buy', cardId: 'focus', desiredCount: 2 }
    ]) });
    const absent = diagnoseOrderedCandidateMembership(old);
    expect(absent.representable).toBe(false);
    expect(absent.violations).toEqual(expect.arrayContaining([
      expect.stringContaining('starting build must be empty'),
      expect.stringContaining('infinite count 99'),
      expect.stringContaining('buy 2 count must be from 1 through 4'),
      expect.stringContaining('buy 4 count must equal 3'),
      expect.stringContaining('buy 5 count must equal 3')
    ]));
    const analogs = nearestOrderedAnalogs(old);
    expect(analogs.length).toBeGreaterThan(0);
    expect(analogs.every((entry) => diagnoseOrderedCandidateMembership(entry.strategy).representable)).toBe(true);
    expect(analogs[0]!.strategy.buyPlan[0]).toMatchObject({ kind: 'buy', cardId: 'strike', desiredCount: 4 });
    expect(analogs[0]!.strategy.startingBuild).toEqual([]);
  });

  it('streams split ranked parts, validates their digests, and returns only requested records', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-ranked-lookup-'));
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const records = [rankedRecord(space.candidateAt(0), 1), rankedRecord(space.candidateAt(1), 2)];
    const lines = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    const part = path.join(directory, 'part.jsonl'); fs.writeFileSync(part, lines);
    const digest = createHash('sha256').update(lines).digest('hex');
    const manifest = path.join(directory, 'ranked.json');
    fs.writeFileSync(manifest, JSON.stringify({ recordCount: 2,
      parts: [{ file: 'part.jsonl', startIndex: 0, endIndex: 2, count: 2, sha256: digest }] }));
    const query = new Set([records[1]!.canonicalStrategy]);
    const found = await lookupSplitRankedStrategies(manifest, query);
    expect([...found.values()]).toEqual([{ canonicalStrategy: records[1]!.canonicalStrategy,
      displayId: records[1]!.displayId, traversalPosition: records[1]!.traversalPosition,
      stageOneRank: 2, rank: 2, top20000: true }]);
    fs.appendFileSync(part, '{}\n');
    await expect(lookupSplitRankedStrategies(manifest, query)).rejects.toThrow('count or SHA-256');
  });
});
