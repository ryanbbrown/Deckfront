import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { SeededRandom, registerKingdom, resetKingdoms } from '../../src/game';
import {
  mergeMovementAwareGoldfishScores, scoreMovementAwareGoldfishStrategyLean
} from '../../src/sim/goldfish';
import type { CompactMovementAwareGoldfishScore, GoldfishConfig,
  MovementAwareGoldfishScore } from '../../src/sim/goldfish';
import { nativeKingdom009Json } from '../../src/sim/nativeKingdom009';
import {
  MAX_GLOBAL_COLLISION_IDS, applyCollisionPolicy, mergeShardRetention, retainShard,
  seededTailRank, streamUniqueStrategies, streamUniqueStrategiesAsync
} from '../../src/sim/nativeStrategySearch';
import type { TraversalScoreRecord } from '../../src/sim/nativeStrategySearch';
import { canonicalStrategy, fixedBuyPlan, identify } from '../../src/sim/strategy';
import {
  selectStagedReservoir, selectStagedReservoirFromMergedEvidence
} from '../../src/sim/stagedGoldfish';
import type { Strategy } from '../../src/sim/strategy';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { stoplessRandomDomain } from '../../src/sim/randomPsro';

function strategy(index: number, id?: string): Strategy {
  const value = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: index % 2 ? 'gold' : 'silver', desiredCount: index + 1 }
  ]) });
  return id ? { ...value, id } : value;
}

function record(index: number, value: number, id?: string): TraversalScoreRecord {
  const held = strategy(index, id);
  const score: CompactMovementAwareGoldfishScore = {
    strategy: held, worstCompletions: value, totalCompletions: value,
    worstPenalizedTurnsTo50: 30 - value, totalPenalizedTurnsTo50: 90 - value,
    worstDamageArea: value, totalDamageArea: value, totalMoneySpent: value,
    strategyId: held.id, collisionTieKey: canonicalStrategy(held)
  };
  return { traversalPosition: index, displayId: held.id,
    canonicalStrategy: canonicalStrategy(held), score };
}

afterEach(() => resetKingdoms());

describe('bounded deterministic native strategy search', () => {
  it('keeps the committed native Kingdom 009 input current', () => {
    expect(fs.readFileSync('rust/goldfish/kingdom009.json', 'utf8')).toBe(nativeKingdom009Json());
  });

  it('awaits one stateful generation pass across chunk sizes', async () => {
    const values = [strategy(0), strategy(0), strategy(1), strategy(2), strategy(3)];
    const consumed: Strategy[] = [];
    const generation = await streamUniqueStrategiesAsync(values, 4, 2, async (chunk) => {
      consumed.push(...chunk.strategies);
      await Promise.resolve();
    });
    expect(consumed).toEqual([values[0], values[2], values[3], values[4]]);
    expect(generation.provenance).toEqual(streamUniqueStrategies(values, 4, 3).provenance);
  });
  it('matches the real stateful product generator across chunk sizes', () => {
    const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
    registerKingdom(kingdom);
    const source = function* () { const random = new SeededRandom(5), domain = stoplessRandomDomain(kingdom.id);
      for (;;) yield domain.randomComplete(random); };
    const oneIds: string[] = [], unevenIds: string[] = [];
    const one = streamUniqueStrategies(source(), 1_000, 1,
      (chunk) => oneIds.push(...chunk.strategies.map((entry) => entry.id)));
    const uneven = streamUniqueStrategies(source(), 1_000, 137,
      (chunk) => unevenIds.push(...chunk.strategies.map((entry) => entry.id)));
    expect(one.provenance).toEqual(uneven.provenance);
    expect(oneIds).toEqual(unevenIds);
  });

  it('preserves stateful accepted order and provenance across chunk sizes', () => {
    const source = [strategy(0), strategy(0), strategy(1, 'forced'), strategy(2, 'forced'), strategy(3)];
    const oneStrategies: Strategy[] = [], threeStrategies: Strategy[] = [];
    const one = streamUniqueStrategies(source, 4, 1,
      (chunk) => oneStrategies.push(...chunk.strategies));
    const three = streamUniqueStrategies(source, 4, 3,
      (chunk) => threeStrategies.push(...chunk.strategies));
    expect(oneStrategies).toEqual(threeStrategies);
    expect(one.provenance).toEqual(three.provenance);
    expect(one.provenance.duplicateCanonicalCount).toBe(1);
    expect(one.provenance.displayIdCollisionCount).toBe(1);
    expect(one.collisionIds).toEqual(['forced']);
  });

  it('ranks display-ID collisions and drops the lower-ranked canonical strategy', () => {
    const records = [record(0, 1, 'collision'), record(1, 9, 'collision'), record(2, 4)];
    const selected = applyCollisionPolicy(records);
    expect(selected).toHaveLength(2);
    expect(selected.find((entry) => entry.displayId === 'collision')?.traversalPosition).toBe(1);
  });

  it('bounds adversarial collision retention to one score winner per display ID and shard', () => {
    const records = Array.from({ length: 50 }, (_unused, index) => record(index, index, 'collision'));
    const shard = retainShard(0, 0, records.length, records, 8, 8, 5,
      new Set(['collision']));
    expect(shard.collisions).toHaveLength(1);
    expect(shard.collisions[0]?.traversalPosition).toBe(49);
  });

  it('bounds the configured global collision set', () => {
    const collisionIds = new Set(Array.from({ length: MAX_GLOBAL_COLLISION_IDS + 1 },
      (_unused, index) => `collision-${index}`));
    expect(() => retainShard(0, 0, 1, [record(0, 1)], 1, 1, 5, collisionIds))
      .toThrow(`Global display-ID collisions exceed ${MAX_GLOBAL_COLLISION_IDS}.`);
  });

  it('promotes records hidden by display-ID collisions across shard boundaries', () => {
    const records = [record(0, 100, 'collision'), record(1, 90), record(2, 80),
      record(3, 110, 'collision'), record(4, 70), record(5, 60)];
    const collisionIds = new Set(['collision']);
    const shards = [retainShard(0, 0, 3, records.slice(0, 3), 3, 2, 5, collisionIds),
      retainShard(1, 3, 6, records.slice(3), 3, 2, 5, collisionIds)];
    const merged = mergeShardRetention(shards, 3, 2, 5);
    const single = mergeShardRetention([retainShard(0, 0, 6, records, 3, 2, 5, collisionIds)], 3, 2, 5);
    expect(merged).toEqual(single);
  });

  it('matches one-process policy with production empty collision IDs and allowance', () => {
    const allowance = 6;
    const records = Array.from({ length: 36 }, (_unused, index) => record(index, 100 - index));
    const tailId = Array.from({ length: 100 }, (_unused, index) => `tail-collision-${index}`)
      .sort((left, right) => seededTailRank({ ...records[0]!, displayId: left }, 5)
        - seededTailRank({ ...records[0]!, displayId: right }, 5))[0]!;
    const pairs: Array<[number, number, string]> = [
      [2, 24, 'leader-collision'], [7, 8, 'prefilter-boundary-collision'],
      [10, 27, tailId], [12, 29, 'collision-3'], [15, 31, 'collision-4'], [18, 34, 'collision-5']
    ];
    for (const [better, worse, id] of pairs) {
      records[better] = record(better, 100 - better, id);
      records[worse] = record(worse, 100 - worse, id);
    }
    const shards = [retainShard(0, 0, 8, records.slice(0, 8), 8 + allowance, 8 + allowance, 5, new Set()),
      retainShard(1, 8, 23, records.slice(8, 23), 8 + allowance, 8 + allowance, 5, new Set()),
      retainShard(2, 23, 36, records.slice(23), 8 + allowance, 8 + allowance, 5, new Set())];
    const merged = mergeShardRetention(shards, 8, 8, 5);
    const oneProcess = mergeShardRetention([
      retainShard(0, 0, 36, records, 8 + allowance, 8 + allowance, 5, new Set())
    ], 8, 8, 5);
    expect(merged).toEqual(oneProcess);
    expect(merged.leaders.some((entry) => entry.displayId === 'prefilter-boundary-collision')).toBe(true);
    expect(merged.tail.some((entry) => entry.displayId === tailId)).toBe(true);
  });

  it('matches one-process staged selection with real generated strategies and scores', () => {
    const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
    registerKingdom(kingdom);
    const generated: Strategy[] = [];
    const source = function* () { const random = new SeededRandom(17), domain = stoplessRandomDomain(kingdom.id);
      for (;;) yield domain.randomComplete(random); };
    const generation = streamUniqueStrategies(source(), 36, 7,
      (chunk) => generated.push(...chunk.strategies));
    const firstConfig: GoldfishConfig = { kingdomId: kingdom.id, seeds: [71], turnLimit: 12,
      actionCapPerTurn: 40 };
    const remainingConfig: GoldfishConfig = { ...firstConfig, seeds: [72, 73] };
    const stageOneScores = generated.map((entry) =>
      scoreMovementAwareGoldfishStrategyLean(entry, firstConfig, 'full'));
    const records = stageOneScores.map((score, index): TraversalScoreRecord => ({
      traversalPosition: index, displayId: score.strategy.id,
      canonicalStrategy: canonicalStrategy(score.strategy), score
    }));
    const collisionIds = new Set(generation.collisionIds);
    const stageOneShards = [
      retainShard(0, 0, 11, records.slice(0, 11), 20, 8, 17, collisionIds),
      retainShard(1, 11, 27, records.slice(11, 27), 20, 8, 17, collisionIds),
      retainShard(2, 27, 36, records.slice(27), 20, 8, 17, collisionIds)
    ];
    const mergedOne = mergeShardRetention(stageOneShards, 20, 8, 17);
    const remaining = mergedOne.leaders.map((entry) => scoreMovementAwareGoldfishStrategyLean(
      entry.score.strategy, remainingConfig, 'full'));
    const combined = mergedOne.leaders.map((entry, index): TraversalScoreRecord => {
      const score = mergeMovementAwareGoldfishScores([
        entry.score as MovementAwareGoldfishScore, remaining[index]!
      ]);
      return { traversalPosition: index, displayId: score.strategy.id,
        canonicalStrategy: canonicalStrategy(score.strategy), score };
    });
    const stageTwo = mergeShardRetention([
      retainShard(0, 0, 6, combined.slice(0, 6), 5, 0, 17, new Set()),
      retainShard(1, 6, 17, combined.slice(6, 17), 5, 0, 17, new Set()),
      retainShard(2, 17, 20, combined.slice(17), 5, 0, 17, new Set())
    ], 5, 0, 17);
    const ranks = new Map(mergedOne.leaders.map((entry, index) => [entry.canonicalStrategy, index + 1]));
    const sharded = selectStagedReservoirFromMergedEvidence(
      mergedOne.leaders.map((entry, index) => ({ score: entry.score as MovementAwareGoldfishScore,
        stageOneGoldfishRank: index + 1 })),
      stageTwo.leaders.map((entry) => entry.score as MovementAwareGoldfishScore),
      mergedOne.tail.map((entry) => ({ score: entry.score as MovementAwareGoldfishScore,
        stageOneGoldfishRank: ranks.get(entry.canonicalStrategy) ?? null })), 5, 3);
    const oneProcess = selectStagedReservoir(stageOneScores, remaining, 20, 5, 3, 17);
    expect(mergedOne.leaders.map((entry) => entry.canonicalStrategy)).toEqual(
      applyCollisionPolicy(records).slice(0, 20).map((entry) => entry.canonicalStrategy));
    expect(sharded.map((entry) => entry.strategy.id)).toEqual(
      oneProcess.map((entry) => entry.strategy.id));
    expect(sharded.filter((entry) => entry.source === 'random').map((entry) => entry.randomTailRank))
      .toEqual(oneProcess.filter((entry) => entry.source === 'random')
        .map((entry) => entry.randomTailRank));
    expect(sharded.filter((entry) => entry.source === 'random')
      .some((entry) => entry.stageOneGoldfishRank === null)).toBe(true);
  }, 30_000);

  it('merges uneven and empty final shards like one process', () => {
    const records = Array.from({ length: 23 }, (_unused, index) => record(index, (index * 7) % 13));
    const collisionIds = new Set<string>();
    const shards = [retainShard(0, 0, 7, records.slice(0, 7), 8, 8, 77, collisionIds),
      retainShard(1, 7, 19, records.slice(7, 19), 8, 8, 77, collisionIds),
      retainShard(2, 19, 23, records.slice(19), 8, 8, 77, collisionIds),
      retainShard(3, 23, 23, [], 8, 8, 77, collisionIds)];
    const merged = mergeShardRetention(shards, 8, 5, 77);
    const single = mergeShardRetention([
      retainShard(0, 0, 23, records, 8, 8, 77, collisionIds)
    ], 8, 5, 77);
    expect(merged.leaders.map((entry) => entry.canonicalStrategy))
      .toEqual(single.leaders.map((entry) => entry.canonicalStrategy));
    expect(merged.tail.map((entry) => entry.canonicalStrategy))
      .toEqual(single.tail.map((entry) => entry.canonicalStrategy));
  });
});
