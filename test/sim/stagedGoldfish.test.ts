import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { generatedProvenance } from '../../src/sim/nativeStrategySearch';
import {
  GOLDFISH_MOVEMENT_PROFILES, mergeMovementAwareGoldfishScores, scoreMovementAwareGoldfishStrategy
} from '../../src/sim/goldfish';
import type { GoldfishMetrics, MovementAwareGoldfishScore } from '../../src/sim/goldfish';
import {
  STAGED_GOLDFISH_VERSION, selectStagedReservoir, stagedReservoirHash,
  validateStagedFixedReservoirPool
} from '../../src/sim/stagedGoldfish';
import type { StagedFixedReservoirPoolArtifact } from '../../src/sim/stagedGoldfish';
import { INFINITE_COUNT, fixedBuyPlan, identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

function strategy(index: number): Strategy {
  return identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: index % 2 ? 'precisionShot' : 'repellingShot', desiredCount: index + 1 },
    { kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }
  ]) });
}

function syntheticScore(index: number, trials: number): MovementAwareGoldfishScore {
  const metrics = (offset: number): GoldfishMetrics => ({ trials, completions: index + offset,
    meanTurnsTo50: 10, totalTurnsTo50: (index + offset) * 10, damageArea: index * 100 + offset,
    totalDamage: index * 10 + offset, meanDamage: (index * 10 + offset) / trials,
    moneySpent: index, unspentMoney: 0, penalizedTurnsTo50: 100 - index + offset });
  const profiles = GOLDFISH_MOVEMENT_PROFILES.map((profile, offset) => ({ profile, score: metrics(offset) }));
  const values = profiles.map((entry) => entry.score);
  return { strategy: strategy(index), profiles,
    worstCompletions: Math.min(...values.map((entry) => entry.completions)),
    totalCompletions: values.reduce((sum, entry) => sum + entry.completions, 0),
    worstPenalizedTurnsTo50: Math.max(...values.map((entry) => entry.penalizedTurnsTo50)),
    totalPenalizedTurnsTo50: values.reduce((sum, entry) => sum + entry.penalizedTurnsTo50, 0),
    worstDamageArea: Math.min(...values.map((entry) => entry.damageArea)),
    totalDamageArea: values.reduce((sum, entry) => sum + entry.damageArea, 0),
    totalMoneySpent: values.reduce((sum, entry) => sum + entry.moneySpent, 0) };
}

afterEach(() => { resetKingdoms(); });

describe('staged movement-aware goldfish', () => {
  it('merges one seed and three seeds into the direct four-seed score on a real kingdom', () => {
    registerKingdom({ id: 'staged-goldfish-test', name: 'Staged goldfish test', startingHealth: 50,
      actionPiles: [{ cardId: 'precisionShot', count: 10 }, { cardId: 'repellingShot', count: 10 }] });
    const candidate = strategy(7);
    const config = { kingdomId: 'staged-goldfish-test', turnLimit: 30, actionCapPerTurn: 200 };
    const first = scoreMovementAwareGoldfishStrategy(candidate, { ...config, seeds: [101] });
    const remaining = scoreMovementAwareGoldfishStrategy(candidate, { ...config, seeds: [102, 103, 104] });
    const direct = scoreMovementAwareGoldfishStrategy(candidate, { ...config, seeds: [101, 102, 103, 104] });
    expect(mergeMovementAwareGoldfishScores([first, remaining])).toEqual(direct);
  });

  it('selects deterministic survivors and an unrestricted deterministic tail', () => {
    const first = Array.from({ length: 40 }, (_unused, index) => syntheticScore(index, 1));
    const survivors = [...first].sort((left, right) => right.worstCompletions - left.worstCompletions)
      .slice(0, 10).map((entry) => syntheticScore(first.indexOf(entry), 3));
    const selected = selectStagedReservoir(first, survivors, 10, 6, 5, 5);
    const repeated = selectStagedReservoir([...first].reverse(), [...survivors].reverse(), 10, 6, 5, 5);
    expect(selected.map((entry) => entry.strategy.id)).toEqual(repeated.map((entry) => entry.strategy.id));
    expect(selected.filter((entry) => entry.source === 'goldfish')
      .every((entry) => entry.stageOneGoldfishRank <= 10)).toBe(true);
    const tail = selected.filter((entry) => entry.source === 'random');
    expect(tail).toHaveLength(5);
    expect(tail.some((entry) => entry.stageOneGoldfishRank !== null
      && entry.stageOneGoldfishRank > 10)).toBe(true);
    expect(tail.every((entry) => entry.scoreProvenance === 'stage-one-only')).toBe(true);
  });

  it('rejects staged artifacts that misstate tail provenance or selection', () => {
    const first = Array.from({ length: 20 }, (_unused, index) => syntheticScore(index, 1));
    const survivors = first.slice(-8).map((_entry, offset) => syntheticScore(12 + offset, 3));
    const reservoir = selectStagedReservoir(first, survivors, 8, 5, 3, 5);
    const provenance = generatedProvenance(first.map((entry) => entry.strategy));
    const artifact: StagedFixedReservoirPoolArtifact = { schemaVersion: 2,
      experiment: 'staged-fixed-reservoir-pool', version: STAGED_GOLDFISH_VERSION,
      kingdomId: 'fixture', poolSeed: 5, goldfishSeeds: [100, 101, 102, 103],
      generatedCount: 20, generatedHash: provenance.generatedIdDigest,
      canonicalProvenanceDigest: provenance.canonicalProvenanceDigest,
      duplicateCanonicalCount: 0, displayIdCollisionCount: 0, scoringProtocol: 'fixture-v1',
      shardProvenance: [{ shardId: '0', startPosition: 0, endPosition: 20,
        candidateDigest: provenance.canonicalProvenanceDigest, scoreDigest: '123456789' }], prefilterCount: 8,
      scoring: { profiles: [...GOLDFISH_MOVEMENT_PROFILES], combination: 'disjoint-seed-sum-v1',
        stageOne: { seeds: [100], scoredCount: 20, elapsedMs: 10 },
        rescore: { seeds: [101, 102, 103], scoredCount: 8, elapsedMs: 20,
          shardProvenance: [{ shardId: '0', startPosition: 0, endPosition: 8,
            candidateDigest: '123456789', scoreDigest: 'abcdef123' }] } },
      reservoirHash: stagedReservoirHash(reservoir), reservoir, elapsedMs: 30 };
    expect(validateStagedFixedReservoirPool(artifact, { goldfishCount: 5, randomCount: 3,
      goldfishSeeds: [100, 101, 102, 103] })).toBe(true);
    const corruptShard = structuredClone(artifact);
    corruptShard.shardProvenance[0]!.endPosition = 19;
    expect(validateStagedFixedReservoirPool(corruptShard)).toBe(false);
    const corruptRescoreShard = structuredClone(artifact);
    corruptRescoreShard.scoring.rescore.shardProvenance[0]!.endPosition = 7;
    expect(validateStagedFixedReservoirPool(corruptRescoreShard)).toBe(false);
    const randomIndex = artifact.reservoir.findIndex((entry) => entry.source === 'random');
    const dishonest = structuredClone(artifact);
    dishonest.reservoir[randomIndex]!.scoreProvenance = 'combined-four-seed';
    dishonest.reservoirHash = stagedReservoirHash(dishonest.reservoir);
    expect(validateStagedFixedReservoirPool(dishonest)).toBe(false);
    const wrongTail = structuredClone(artifact);
    [wrongTail.reservoir[randomIndex], wrongTail.reservoir[randomIndex + 1]] =
      [wrongTail.reservoir[randomIndex + 1]!, wrongTail.reservoir[randomIndex]!];
    wrongTail.reservoirHash = stagedReservoirHash(wrongTail.reservoir);
    expect(validateStagedFixedReservoirPool(wrongTail)).toBe(false);
  });
});
