import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import {
  candidateChecksumFromIterable, candidateIndexAt, coprimeTraversalConfig, createOrderedCandidateSpace,
  orderedGoldfishCardIds, orderedGoldfishQuantityVectors, parseOrderedGoldfishArgs,
  representativeCandidateIndices
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

  it.each([
    ['deep-beam-tuning-001', 'fe10624e178e8'],
    ['deep-beam-tuning-007', '65257033178f5'],
    ['deep-beam-tuning-008', 'fea778e71849c'],
    ['deep-beam-tuning-009', 'fa0328fb18315']
  ])('pins the first 500 traversal candidates for %s', (kingdomId, expectedChecksum) => {
    const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === kingdomId)!;
    registerKingdom(kingdom);
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
    const strategies = function* () {
      for (const index of representativeCandidateIndices(space.candidateCount, 500)) {
        yield space.candidateAt(index);
      }
    };
    expect(space.candidateCount).toBe(12_972_960);
    expect(candidateChecksumFromIterable(strategies())).toBe(expectedChecksum);
  });

  it('pins the frozen 100,000-candidate Kingdom 009 traversal checksum', () => {
    const space = kingdom009Space();
    const strategies = function* () {
      for (const index of representativeCandidateIndices(space.candidateCount, 100_000)) {
        yield space.candidateAt(index);
      }
    };
    expect(candidateChecksumFromIterable(strategies())).toBe('93a38dcc12eabd6');
  });

  it('keeps representative traversal continuous across shard boundaries', () => {
    const total = 12_972_960;
    expect([...representativeCandidateIndices(total, 301, 0)]).toEqual([
      ...representativeCandidateIndices(total, 137, 0),
      ...representativeCandidateIndices(total, 164, 137)
    ]);
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
      limit: 100_000, workers: 10, shuffles: 1, chunkSize: 250, scorer: 'original', startPosition: 0 });
    expect(parseOrderedGoldfishArgs(['--kingdom', 'deep-beam-tuning-003', '--count', '25',
      '--workers', '2', '--shuffles', '4', '--chunk-size', '8', '--scorer', 'lean']))
      .toEqual({ kingdomId: 'deep-beam-tuning-003', limit: 25, workers: 2, shuffles: 4,
        chunkSize: 8, scorer: 'lean', startPosition: 0 });
  });

  it.each([
    [['--limit', '0'], '--limit must be a positive integer.'],
    [['--workers', '2.5'], '--workers must be a positive integer.'],
    [['--limit', '2', '--count', '2'], 'Use either --limit or --count, not both.'],
    [['--workers', '2', '--workers', '3'], '--workers can be specified only once.'],
    [['--chunk-size', '0'], '--chunk-size must be a positive integer.'],
    [['--start-position', '-1'], '--start-position must be a nonnegative integer.'],
    [['--scorer', 'fast'], '--scorer must be original, lean, or rust.'],
    [['--mystery', '2'], 'Unknown ordered goldfish option: --mystery']
  ])('rejects invalid arguments %j', (args, message) => {
    expect(() => parseOrderedGoldfishArgs(args)).toThrow(message);
  });
});
