import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import {
  candidateIndexAt, coprimeTraversalConfig, createOrderedCandidateSpace, orderedGoldfishCardIds,
  orderedGoldfishQuantityVectors, parseOrderedGoldfishArgs, representativeCandidateIndices
} from '../../src/sim/orderedGoldfishBenchmark';

afterEach(() => { resetKingdoms(); });

function kingdom009Space(): ReturnType<typeof createOrderedCandidateSpace> {
  const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
  registerKingdom(kingdom);
  return createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
}

describe('ordered unique-card goldfish candidate space', () => {
  it('uses the 54-vector provisional quantity baseline', () => {
    const vectors = orderedGoldfishQuantityVectors();
    expect(vectors).toHaveLength(54);
    expect(vectors[0]).toEqual([1, 1, 1, 3, 3]);
    expect(vectors.at(-1)).toEqual([4, 4, 1, 3, 3]);
    expect(vectors.every((vector) => vector.length === 5
      && vector.slice(0, 3).every((quantity) => quantity >= 1 && quantity <= 4)
      && vector[3] === 3 && vector[4] === 3
      && vector.reduce((sum, quantity) => sum + quantity, 0) <= 15)).toBe(true);
  });

  it('counts the Kingdom 009 ordered skeletons and complete candidates', () => {
    const space = kingdom009Space();
    expect(space.cardIds).toHaveLength(14);
    expect(space.cardIds).not.toContain('copper');
    expect(space.skeletonCount).toBe(240_240);
    expect(space.candidateCount).toBe(12_972_960);
  });

  it('creates five unique finite active slots, an empty build, and no fallback', () => {
    const strategy = kingdom009Space().candidateAt(7_654_321);
    const active = strategy.buyPlan.filter((slot) => slot.kind !== 'inactive');
    expect(strategy.startingBuild).toEqual([]);
    expect(active).toHaveLength(5);
    expect(active.every((slot) => slot.kind === 'buy' && slot.desiredCount >= 1 && slot.desiredCount <= 4)).toBe(true);
    expect(new Set(active.map((slot) => slot.kind === 'buy' ? slot.cardId : '')).size).toBe(5);
    expect(strategy.buyPlan.slice(5)).toEqual(Array.from({ length: 5 }, () => ({ kind: 'inactive' })));
  });

  it('uses a deterministic, duplicate-free traversal that reaches across the full space', () => {
    const total = 12_972_960;
    const indices = [...representativeCandidateIndices(total, 20_000)];
    expect(indices).toEqual([...representativeCandidateIndices(total, 20_000)]);
    expect(new Set(indices).size).toBe(20_000);
    expect(indices[0]).toBe(candidateIndexAt(0, total));
    expect(indices.some((index) => index < total / 10)).toBe(true);
    expect(indices.some((index) => index > total * 9 / 10)).toBe(true);
    const traversal = coprimeTraversalConfig(total);
    expect(traversal.stride).not.toBe(1);
    expect(candidateIndexAt(total - 1, total)).not.toBe(candidateIndexAt(0, total));
  });
});

describe('ordered goldfish CLI arguments', () => {
  it('has reproducible defaults and accepts count as the limit alias', () => {
    expect(parseOrderedGoldfishArgs([])).toEqual({ kingdomId: 'deep-beam-tuning-009',
      limit: 100_000, workers: 10, shuffles: 1 });
    expect(parseOrderedGoldfishArgs(['--kingdom', 'deep-beam-tuning-003', '--count', '25',
      '--workers', '2', '--shuffles', '4'])).toEqual({ kingdomId: 'deep-beam-tuning-003',
      limit: 25, workers: 2, shuffles: 4 });
  });

  it.each([
    [['--limit', '0'], '--limit must be a positive integer.'],
    [['--workers', '2.5'], '--workers must be a positive integer.'],
    [['--limit', '2', '--count', '2'], 'Use either --limit or --count, not both.'],
    [['--workers', '2', '--workers', '3'], '--workers can be specified only once.'],
    [['--mystery', '2'], 'Unknown ordered goldfish option: --mystery']
  ])('rejects invalid arguments %j', (args, message) => {
    expect(() => parseOrderedGoldfishArgs(args)).toThrow(message);
  });
});
