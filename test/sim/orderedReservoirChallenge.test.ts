import { beforeAll, describe, expect, it } from 'vitest';
import {
  ORDERED_RESERVOIR_ONE_ROUND_PROTOCOL, adaptOrderedReservoirEntries,
  aggregateComparisons, assessOneRound, inactiveAttackStrategies, summarizeAttack,
  wholeLotteryEvidence
} from '../../src/sim/orderedReservoirChallenge';
import {
  combineScoreEvidence, deriveScoreEvidence, rankingKey
} from '../../src/sim/orderedGoldfishProduct';
import type {
  OrderedProductProfileEvidence, OrderedProductRankedRecord
} from '../../src/sim/orderedGoldfishProduct';
import {
  FIXED_RESERVOIR_CONFIG, reservoirHash, runFixedReservoirPsro
} from '../../src/sim/fixedReservoirPsro';
import type {
  FixedReservoirPoolArtifact, FixedReservoirProtocol, ReservoirConfirmedCandidate
} from '../../src/sim/fixedReservoirPsro';
import { InlinePairingRunner } from '../../src/sim/pairingRunner';
import {
  legacyGeneratedHash, legacyReservoirHash, loadValidatedLegacyFixedReservoirV1,
  validateLegacyFixedReservoirPoolV1, validateLegacyFixedReservoirRunV1
} from '../../src/sim/legacyFixedReservoirV1';
import type {
  LegacyFixedReservoirPoolArtifact, LegacyFixedReservoirPsroArtifact
} from '../../src/sim/legacyFixedReservoirV1';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { registerKingdom } from '../../src/game';
import { canonicalStrategy, fixedBuyPlan, identify, stableHash } from '../../src/sim/strategy';

const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
beforeAll(() => registerKingdom(kingdom));

function record(index: number): OrderedProductRankedRecord {
  const strategy = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: index % 2 ? 'strike' : 'precisionShot', desiredCount: index + 1 }
  ]) });
  const profiles = (offset: number): OrderedProductProfileEvidence[] => [
    { profile: 'stationary', trials: 1, completions: 1, penalizedTurnsTo50: 10 + offset,
      damageArea: 20 + offset, moneySpent: 3 },
    { profile: 'chaser', trials: 1, completions: 1, penalizedTurnsTo50: 11 + offset,
      damageArea: 19 + offset, moneySpent: 4 },
    { profile: 'kiter', trials: 1, completions: 0, penalizedTurnsTo50: 30,
      damageArea: 8 + offset, moneySpent: 5 }
  ];
  const stageOne = deriveScoreEvidence(profiles(index));
  const additional = deriveScoreEvidence(profiles(index + 1));
  const combined = combineScoreEvidence(stageOne, additional);
  return { traversalPosition: index, displayId: strategy.id,
    canonicalStrategy: canonicalStrategy(strategy), strategy, stageOne,
    stageOneRankingKey: rankingKey(stageOne), additional, combined,
    combinedRankingKey: rankingKey(combined), stageOneRank: index + 1, rank: index + 1 };
}

function finalist(id: string, mean: number, lower: number): ReservoirConfirmedCandidate {
  return { strategy: { ...record(id === 'a' ? 0 : 1).strategy, id }, mean,
    interval95: { lower, upper: Math.min(1, mean + 0.05) }, blocks: 400, matches: 1600 };
}

describe('ordered reservoir one-round challenge', () => {
  it('adapts a ranked prefix into an all-goldfish pool without a random tail', () => {
    const entries = adaptOrderedReservoirEntries([record(0), record(1)]);
    expect(entries.map((entry) => ({ source: entry.source, rank: entry.goldfishRank,
      totalDamageArea: entry.score.totalDamageArea }))).toEqual([
      { source: 'goldfish', rank: 1, totalDamageArea: record(0).combined.totalDamageArea },
      { source: 'goldfish', rank: 2, totalDamageArea: record(1).combined.totalDamageArea }
    ]);
    expect(() => adaptOrderedReservoirEntries([{ ...record(0), rank: 2 }]))
      .toThrow('invalid, duplicated, or out of rank order');
    expect(() => adaptOrderedReservoirEntries([record(0), { ...record(0), rank: 2 }]))
      .toThrow('invalid, duplicated, or out of rank order');
  });

  it('runs one round and validates a real-shape legacy v1 pool and run boundary', async () => {
    expect(ORDERED_RESERVOIR_ONE_ROUND_PROTOCOL).toEqual({
      ...FIXED_RESERVOIR_CONFIG,
      generatedCount: 12_972_960, goldfishCount: 20_000, randomCount: 0, safetyCap: 1
    });
    const admitted = assessOneRound({ rounds: [{ round: 0, admittedStrategyIds: ['exploit-a', 'exploit-b'] }] });
    expect(admitted).toEqual({ status: 'incomplete-admissions', complete: false,
      admittedStrategyIds: ['exploit-a', 'exploit-b'],
      message: '2 strategies were admitted. The one-round lottery is incomplete and is not a convergence result.' });
    expect(() => assessOneRound({ rounds: [] })).toThrow('exactly one response round');
    expect(() => assessOneRound({ rounds: [
      { round: 0, admittedStrategyIds: [] }, { round: 1, admittedStrategyIds: [] }
    ] })).toThrow('exactly one response round');

    const reservoir = adaptOrderedReservoirEntries(Array.from({ length: 6 }, (_unused, index) => record(index)));
    const canonicalProvenanceDigest = stableHash(reservoir.map((entry) => canonicalStrategy(entry.strategy)).join('\n'));
    const pool: FixedReservoirPoolArtifact = { schemaVersion: 2, experiment: 'fixed-reservoir-pool',
      version: 'fixed-reservoir-psro-v2', kingdomId: kingdom.id, poolSeed: 0,
      goldfishSeeds: [1], generatedCount: 6, generatedHash: '123456789', canonicalProvenanceDigest,
      duplicateCanonicalCount: 0, displayIdCollisionCount: 0, scoringProtocol: 'fixture',
      shardProvenance: [{ shardId: '0', startPosition: 0, endPosition: 6,
        candidateDigest: canonicalProvenanceDigest, scoreDigest: '987654321' }],
      reservoirHash: reservoirHash(reservoir), reservoir, elapsedMs: 0 };
    const protocol: FixedReservoirProtocol = { generatedCount: 6, goldfishCount: 6, randomCount: 0,
      initialStrategies: 3, raceBlocks: [1], finalists: 1, confirmationBlocks: 2,
      matrixBlocks: 1, cleanScansRequired: 2, safetyCap: 1, admissionLowerBound: 0.5, chunkSize: 3 };
    const run = await runFixedReservoirPsro(pool, new InlinePairingRunner(),
      { evaluationSeed: 1234, protocol });
    expect(run.rounds).toHaveLength(1);
    expect(run.rounds[0]!.scannedCount).toBe(3);
    expect(run.status).toBe('incomplete');
    expect(() => assessOneRound(run)).not.toThrow();

    const reservoirIds = reservoir.map((entry) => entry.strategy.id);
    const generatedIds = [...reservoirIds, reservoirIds[0]!];
    const legacyPool: LegacyFixedReservoirPoolArtifact = { schemaVersion: 1,
      experiment: 'fixed-reservoir-pool', version: 'fixed-reservoir-psro-v1', kingdomId: kingdom.id,
      poolSeed: 0, goldfishSeeds: [1], generatedCount: generatedIds.length, generatedIds,
      generatedHash: legacyGeneratedHash(generatedIds), reservoirHash: legacyReservoirHash(reservoir),
      reservoir, elapsedMs: 10 };
    const legacyRun: LegacyFixedReservoirPsroArtifact = { ...run, schemaVersion: 1,
      version: 'fixed-reservoir-psro-v1', poolHash: legacyPool.generatedHash,
      reservoirHash: legacyPool.reservoirHash, reservoir };
    const legacyOptions = { kingdomId: kingdom.id, poolSeed: 0, evaluationSeed: 1234,
      protocol: { ...protocol, generatedCount: generatedIds.length }, goldfishSeeds: [1] };
    expect(validateLegacyFixedReservoirPoolV1(legacyPool, legacyOptions)).toBe(true);
    expect(validateLegacyFixedReservoirRunV1(legacyRun, legacyPool, legacyOptions)).toBe(true);
    expect(loadValidatedLegacyFixedReservoirV1(legacyPool, legacyRun, legacyOptions))
      .toEqual({ pool: legacyPool, run: legacyRun });
    expect(validateLegacyFixedReservoirPoolV1({ ...legacyPool,
      generatedIds: [...legacyPool.generatedIds].reverse() }, legacyOptions)).toBe(false);
    expect(validateLegacyFixedReservoirRunV1({ ...legacyRun,
      rulesFingerprint: { ...legacyRun.rulesFingerprint, hash: 'stale-rules' }
    }, legacyPool, legacyOptions)).toBe(false);
  }, 30_000);

  it('calculates whole-lottery directions and exploit evidence from independent literal results', () => {
    const forward = wholeLotteryEvidence([
      { strategyId: 'a', weight: 1, blockScores: [1, 0], matches: 8 },
      { strategyId: 'b', weight: 3, blockScores: [0.5, 1], matches: 8 }
    ], 41);
    expect(forward.blockScores).toEqual([0.625, 0.75]);
    expect(forward.score).toBe(0.6875);
    expect(forward.matches).toBe(16);

    const orderedAttack = summarizeAttack(20_000, [finalist('a', 0.56, 0.51), finalist('b', 0.58, 0.49)]);
    const historicalAttack = summarizeAttack(20_000, [finalist('b', 0.48, 0.44)]);
    expect(orderedAttack.exploitStrategyIds).toEqual(['a']);
    expect(orderedAttack.best?.strategy.id).toBe('a');
    const attackCandidates = inactiveAttackStrategies(
      [record(0).strategy, record(1).strategy], [record(0).strategy]);
    expect(attackCandidates.map((strategy) => strategy.id)).toEqual([record(1).strategy.id]);
    expect(summarizeAttack(attackCandidates.length, []).scannedCount).toBe(1);
    const comparison = { historicalPoolSeed: 1, orderedAsRow: { ...forward,
      interval95: { lower: 0.55, upper: 0.75 } },
    historicalAsRow: { ...forward, score: 0.4, interval95: { lower: 0.3, upper: 0.45 } },
    orderedAttack, historicalAttack };
    expect(aggregateComparisons([comparison])).toMatchObject({
      orderedScores: [0.6875, 0.6], meanOrderedScore: 0.64375,
      orderedExploitCount: 1, historicalExploitCount: 0, assessment: 'ordered-stronger'
    });
  });
});
