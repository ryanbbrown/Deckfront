import { describe, expect, it } from 'vitest';
import type { CompactMovementAwareGoldfishScore } from '../../src/sim/goldfish';
import {
  applyCollisionPolicy, mergeShardRetention, retainShard, streamUniqueStrategies
} from '../../src/sim/nativeStrategySearch';
import type { TraversalScoreRecord } from '../../src/sim/nativeStrategySearch';
import { canonicalStrategy, fixedBuyPlan, identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

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

describe('bounded deterministic native strategy search', () => {
  it('preserves stateful accepted order and provenance across chunk sizes', () => {
    const source = [strategy(0), strategy(0), strategy(1, 'forced'), strategy(2, 'forced'), strategy(3)];
    const one = streamUniqueStrategies(source, 4, 1);
    const three = streamUniqueStrategies(source, 4, 3);
    expect(one.chunks.flatMap((chunk) => chunk.strategies))
      .toEqual(three.chunks.flatMap((chunk) => chunk.strategies));
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

  it('merges uneven and empty final shards like one process', () => {
    const records = Array.from({ length: 23 }, (_unused, index) => record(index, (index * 7) % 13));
    const shards = [retainShard(0, 0, 7, records.slice(0, 7), 8, 8, 77),
      retainShard(1, 7, 19, records.slice(7, 19), 8, 8, 77),
      retainShard(2, 19, 23, records.slice(19), 8, 8, 77),
      retainShard(3, 23, 23, [], 8, 8, 77)];
    const merged = mergeShardRetention(shards, 8, 5, 77);
    const single = mergeShardRetention([retainShard(0, 0, 23, records, 8, 8, 77)], 8, 5, 77);
    expect(merged.leaders.map((entry) => entry.canonicalStrategy))
      .toEqual(single.leaders.map((entry) => entry.canonicalStrategy));
    expect(merged.tail.map((entry) => entry.canonicalStrategy))
      .toEqual(single.tail.map((entry) => entry.canonicalStrategy));
  });
});
