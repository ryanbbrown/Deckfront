import { describe, expect, it } from 'vitest';
import { diagnosticStrategies } from '../../src/sim/baselines';
import type { CandidateEvaluation } from '../../src/sim/mixtureEvaluation';
import { emptyAggregate } from '../../src/sim/pairing';
import type { Strategy } from '../../src/sim/strategy';
import { canonicalStrategy } from '../../src/sim/strategy';
import {
  cleanScansAfter, orderConfirmedQueue, parseOptions, runConfirmationRace, runThresholdRace,
  weightedFairSchedule
} from '../../scripts/successive_halving_double_oracle_pilot';

function candidates(count = 3) {
  return diagnosticStrategies('current-duel').slice(0, count).map((strategy, index) => ({ strategy, identity: {
    goldfishRank: index + 51, strategyId: strategy.id, canonicalStrategy: canonicalStrategy(strategy)
  } }));
}
function evaluator(score: (strategy: Strategy) => number,
  calls: Array<{ ids: string[]; seeds: number[]; opponents: string[] }>) {
  return async (field: readonly Strategy[], _opponents: unknown,
    schedule: { blocks: Array<{ seed: number; opponentId: string }> }): Promise<CandidateEvaluation[]> => {
    calls.push({ ids: field.map((entry) => entry.id), seeds: schedule.blocks.map((entry) => entry.seed),
      opponents: schedule.blocks.map((entry) => entry.opponentId) });
    return field.map((strategy) => ({ strategy, mean: score(strategy),
      blockScores: schedule.blocks.map(() => score(strategy)), interval: null,
      matches: schedule.blocks.length * 2, telemetry: emptyAggregate() }));
  };
}
const runner = { async run() { throw new Error('fake evaluator owns the smoke test'); }, async close() {} };

describe('K007 threshold-racing Double Oracle pilot', () => {
  it('builds nested proportional largest-deficit prefixes without random opponent sampling', () => {
    const seeds = Array.from({ length: 10 }, (_unused, index) => index + 100);
    const schedule = weightedFairSchedule({ c: 2, a: 5, b: 3, zero: 0 }, seeds);
    expect(schedule.blocks.map((entry) => entry.opponentId))
      .toEqual(['a', 'b', 'c', 'a', 'a', 'b', 'a', 'c', 'b', 'a']);
    expect(schedule.realizedOpponentCounts).toEqual({ a: 5, b: 3, c: 2 });
    expect(weightedFairSchedule({ c: 2, a: 5, b: 3 }, seeds.slice(0, 8)).blocks)
      .toEqual(schedule.blocks.slice(0, 8));
    for (let prefix = 1; prefix <= schedule.blocks.length; prefix += 1) {
      const counts = { a: 0, b: 0, c: 0 };
      schedule.blocks.slice(0, prefix).forEach((entry) => { counts[entry.opponentId as keyof typeof counts] += 1; });
      expect(Math.max(Math.abs(counts.a - prefix * 0.5), Math.abs(counts.b - prefix * 0.3),
        Math.abs(counts.c - prefix * 0.2))).toBeLessThanOrEqual(1);
    }
  });

  it('starts every inactive candidate at 8, removes threshold decisions, and doubles only unresolved prefixes', async () => {
    const field = candidates();
    const calls: Array<{ ids: string[]; seeds: number[]; opponents: string[] }> = [];
    const scores = new Map([[field[0]!.strategy.id, 0], [field[1]!.strategy.id, 1],
      [field[2]!.strategy.id, 0.51]]);
    const schedule = weightedFairSchedule({ x: 0.7, y: 0.3 }, Array.from({ length: 32 }, (_unused, index) => index + 1));
    const result = await runThresholdRace({ candidates: field, opponents: new Map(), schedule,
      kingdomId: 'current-duel', runner, depths: [8, 16, 32],
      evaluate: evaluator((strategy) => scores.get(strategy.id)!, calls) as never });

    expect(result.looks.map((look) => [look.blocks, look.entered, look.below, look.above, look.unresolved]))
      .toEqual([[8, 3, 0, 0, 3], [16, 3, 1, 1, 1], [32, 1, 0, 0, 1]]);
    expect(result.below.map((entry) => entry.strategyId)).toEqual([field[0]!.strategy.id]);
    expect(result.provisional.map((entry) => entry.strategyId)).toEqual([field[1]!.strategy.id]);
    expect(result.unresolved.map((entry) => entry.strategyId)).toEqual([field[2]!.strategy.id]);
    expect(result).not.toHaveProperty('admitted');
    expect(calls[0]!.seeds).toEqual(schedule.blocks.slice(0, 8).map((entry) => entry.seed));
    expect(calls[1]!.seeds).toEqual(schedule.blocks.slice(8, 16).map((entry) => entry.seed));
    expect(calls[2]!.ids).toEqual([field[2]!.strategy.id]);
    expect(calls[2]!.seeds).toEqual(schedule.blocks.slice(16, 32).map((entry) => entry.seed));
  });

  it('uses fresh cumulative confirmation looks and Bonferroni family bounds at 0.51', async () => {
    const field = candidates();
    const calls: Array<{ ids: string[]; seeds: number[]; opponents: string[] }> = [];
    const scores = new Map([[field[0]!.strategy.id, 0], [field[1]!.strategy.id, 1],
      [field[2]!.strategy.id, 0.51]]);
    const schedule = weightedFairSchedule({ x: 1 }, Array.from({ length: 800 }, (_unused, index) => 10_000 + index));
    const result = await runConfirmationRace({ candidates: field, opponents: new Map(), schedule,
      kingdomId: 'current-duel', runner, looks: [400, 800],
      evaluate: evaluator((strategy) => scores.get(strategy.id)!, calls) as never });

    expect(result.alphaPerCandidate).toBeCloseTo(0.05 / 3);
    expect(result.rejected.map((entry) => entry.strategyId)).toEqual([field[0]!.strategy.id]);
    expect(result.confirmed.map((entry) => entry.strategyId)).toEqual([field[1]!.strategy.id]);
    expect(result.unresolved.map((entry) => entry.strategyId)).toEqual([field[2]!.strategy.id]);
    expect(result.looks.map((look) => [look.blocks, look.entered])).toEqual([[400, 3], [800, 1]]);
    expect(calls[0]!.seeds).toEqual(schedule.blocks.slice(0, 400).map((entry) => entry.seed));
    expect(calls[1]!.seeds).toEqual(schedule.blocks.slice(400, 800).map((entry) => entry.seed));
  });

  it('orders the strongest confirmed lower bound deterministically and reports ties and overlaps', () => {
    const field = candidates();
    const row = (index: number, lower: number, upper: number, score: number) => ({ ...field[index]!.identity,
      blocks: 400, mean: score, interval: { lower, upper }, status: 'confirmed' as const });
    const order = orderConfirmedQueue([
      row(2, 0.59, 0.72, 0.66), row(1, 0.60, 0.70, 0.65), row(0, 0.60, 0.70, 0.65)
    ]);
    expect(order.strongestStrategyId).toBe(field[0]!.strategy.id);
    expect(order.orderedStrategyIds).toEqual([
      field[0]!.strategy.id, field[1]!.strategy.id, field[2]!.strategy.id
    ]);
    expect(order.strongestTieIds).toEqual([field[1]!.strategy.id]);
    expect(order.strongestOverlapIds).toEqual([field[1]!.strategy.id, field[2]!.strategy.id]);
    expect(cleanScansAfter(1, true, false)).toBe(0);
    expect(cleanScansAfter(1, false, true)).toBe(2);
  });

  it('requires one of three independent run IDs and rejects unrelated options', () => {
    expect(parseOptions(['--run', '--inputs', 'inputs.json', '--out', 'out', '--run-id', '3']))
      .toMatchObject({ mode: '--run', workers: 4, runId: 3 });
    expect(() => parseOptions(['--run', '--inputs', 'inputs.json', '--out', 'out', '--run-id', '4']))
      .toThrow('Run ID must be 1, 2, or 3.');
    expect(() => parseOptions(['--status', '--out', 'out', '--run-id', '1', '--workers', '2']))
      .toThrow('Unknown pilot option --workers.');
  });
});
