import { afterEach, describe, expect, it } from 'vitest';
import { SeededRandom, registerKingdom, resetKingdoms } from '../../src/game';
import type { CompactMovementAwareGoldfishScore } from '../../src/sim/goldfish';
import {
  applyCollisionPolicy, mergeShardRetention, retainShard, streamUniqueStrategies
} from '../../src/sim/nativeStrategySearch';
import type { TraversalScoreRecord } from '../../src/sim/nativeStrategySearch';
import { canonicalStrategy, fixedBuyPlan, identify } from '../../src/sim/strategy';
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

  it('promotes records hidden by display-ID collisions across shard boundaries', () => {
    const records = [record(0, 100, 'collision'), record(1, 90), record(2, 80),
      record(3, 110, 'collision'), record(4, 70), record(5, 60)];
    const collisionIds = new Set(['collision']);
    const shards = [retainShard(0, 0, 3, records.slice(0, 3), 3, 2, 5, collisionIds),
      retainShard(1, 3, 6, records.slice(3), 3, 2, 5, collisionIds)];
    const merged = mergeShardRetention(shards, 3, 2, 5);
    const single = mergeShardRetention([retainShard(0, 0, 6, records, 3, 2, 5, collisionIds)], 3, 2, 5);
    expect(merged).toEqual(single);
    expect(new Set([...merged.leaders, ...merged.tail].map((entry) => entry.displayId)).size)
      .toBe(merged.leaders.length + merged.tail.length);
  });

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
