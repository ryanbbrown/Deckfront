import { describe, expect, it } from 'vitest';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { emptyAggregate } from '../../src/sim/pairing';
import { InlinePairingRunner } from '../../src/sim/pairingRunner';
import { strategyIsLegal } from '../../src/sim/randomStrategy';
import { BudgetedResponseObjective } from '../../src/sim/budgetedResponseObjective';
import type { TrainingCurvePoint } from '../../src/sim/budgetedResponseObjective';
import { ResponsePolicyDomain } from '../../src/sim/responsePolicyGrammar';
import type { PrefixToken } from '../../src/sim/responsePolicyGrammar';
import {
  DependencyAwareCemModel, runDiscreteCem, runStratifiedBeam, runUctMcts,
  runUniformRandomRacing
} from '../../src/sim/responseOptimizers';
import type { ObjectiveLike } from '../../src/sim/responseOptimizers';
import { canonicalStrategy, stableHash } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import { responseOptimizerPilotSchema } from '../../scripts/response_optimizer_pilot';

class DeterministicObjective implements ObjectiveLike {
  readonly curve: TrainingCurvePoint[] = [];
  readonly policies: Strategy[] = [];
  private readonly totals = new Map<string, { total: number; blocks: number }>();
  blocksConsumed = 0;
  matchesConsumed = 0;
  constructor(readonly budget: number) {}
  get remaining(): number { return this.budget - this.blocksConsumed; }
  canEvaluate(candidates: number, blocks: number): boolean { return candidates * blocks <= this.remaining; }
  async evaluate(candidates: readonly Strategy[], blocks: number) {
    if (!this.canEvaluate(candidates.length, blocks)) throw new Error('over budget');
    this.blocksConsumed += candidates.length * blocks;
    this.matchesConsumed += candidates.length * blocks * 4;
    this.policies.push(...candidates);
    const evaluations = candidates.map((strategy) => {
      const score = Number.parseInt(stableHash(canonicalStrategy(strategy)).slice(0, 6), 16) / 0xffffff;
      const form = canonicalStrategy(strategy);
      const held = this.totals.get(form) ?? { total: 0, blocks: 0 };
      held.total += score * blocks; held.blocks += blocks; this.totals.set(form, held);
      return { strategy, mean: score, blockScores: Array<number>(blocks).fill(score),
        interval: null, matches: blocks * 4, telemetry: emptyAggregate() };
    });
    const best = [...this.totals.entries()].sort((left, right) =>
      right[1].total / right[1].blocks - left[1].total / left[1].blocks)[0]!;
    this.curve.push({ candidateBlocks: this.blocksConsumed, matches: this.matchesConsumed,
      bestMean: best[1].total / best[1].blocks, policyId: candidates[0]!.id });
    return evaluations;
  }
  aggregate(strategy: Strategy) {
    const held = this.totals.get(canonicalStrategy(strategy));
    return held ? { mean: held.total / held.blocks, blocks: held.blocks } : null;
  }
}

function domain(): ResponsePolicyDomain {
  deepBeamSuite.register();
  return new ResponsePolicyDomain('deep-beam-tuning-001', { maxActiveSlots: 8 });
}

describe('the shared response policy grammar', () => {
  it('builds one legal canonical draft-off policy at every allowed length', () => {
    const grammar = domain();
    for (let length = 0; length <= grammar.maxPrefixSlots; length += 1) {
      const policy = grammar.complete(Array<PrefixToken>(length).fill(grammar.prefixTokens[0]!), grammar.floorTokens[0]!);
      expect(grammar.decode(policy).prefix).toHaveLength(length);
      expect(policy.startingBuild).toEqual([]);
      expect(strategyIsLegal(grammar.kingdomId, policy)).toBe(true);
      expect(grammar.complete(grammar.decode(policy).prefix, grammar.decode(policy).floor).id).toBe(policy.id);
    }
  });
});

describe('the fixed-lottery budget', () => {
  it('counts candidate blocks and matches and rejects an over-budget batch', async () => {
    const grammar = domain();
    const opponent = grammar.complete([], grammar.floorTokens[0]!);
    const runner = new InlinePairingRunner();
    const objective = new BudgetedResponseObjective({ kingdomId: grammar.kingdomId,
      opponents: [{ strategy: opponent, weight: 1 }], budget: 2, scheduleSeed: 7, runner,
      turnLimitPerPlayer: 30, actionCapPerTurn: 200 });
    await objective.evaluate([grammar.complete([], grammar.floorTokens[1]!)], 1);
    expect(objective.blocksConsumed).toBe(1);
    expect(objective.matchesConsumed).toBe(4);
    await expect(objective.evaluate([opponent], 2)).rejects.toThrow('with 1 left');
    await objective.evaluate([opponent], 1);
    expect(objective.blocksConsumed).toBe(2);
    expect(objective.remaining).toBe(0);
  });
});

describe('dependency-aware CEM', () => {
  it('updates complete ordered policies by their preceding token and keeps exploration', () => {
    const grammar = domain();
    const first = grammar.prefixTokens[0]!;
    const second = grammar.prefixTokens[1]!;
    const floor = grammar.floorTokens[1]!;
    const model = new DependencyAwareCemModel(grammar, { smoothing: 0.8, explorationFloor: 0.05 });
    const before = model.prefixProbability(2, 1, first, second);
    model.update(Array<Strategy>(10).fill(grammar.complete([first, second], floor)));
    expect(model.prefixProbability(2, 1, first, second)).toBeGreaterThan(before);
    expect(model.prefixProbability(2, 1, first, grammar.prefixTokens[2]!)).toBeGreaterThan(0);
    expect(model.floorProbability(2, second, floor)).toBeGreaterThan(1 / grammar.floorTokens.length);
  });

  it('is deterministic with a seed and stays inside its budget', async () => {
    const grammar = domain();
    const left = new DeterministicObjective(48); const right = new DeterministicObjective(48);
    const [a, b] = await Promise.all([
      runDiscreteCem(left, grammar, 91, { population: 8, evaluationBlocks: 2 }),
      runDiscreteCem(right, grammar, 91, { population: 8, evaluationBlocks: 2 })
    ]);
    expect(a.policy.id).toBe(b.policy.id);
    expect(a.curve).toEqual(b.curve);
    expect(a.candidateBlocks).toBeLessThanOrEqual(48);
  });
});

describe('complete random, beam, and MCTS search', () => {
  it('uses uniform complete-policy racing deterministically', async () => {
    const grammar = domain();
    const left = new DeterministicObjective(40); const right = new DeterministicObjective(40);
    const [a, b] = await Promise.all([
      runUniformRandomRacing(left, grammar, 12, { batchSize: 8, roundBlocks: [1, 2] }),
      runUniformRandomRacing(right, grammar, 12, { batchSize: 8, roundBlocks: [1, 2] })
    ]);
    expect(a.policy.id).toBe(b.policy.id);
    expect(left.policies.every((policy) => strategyIsLegal(grammar.kingdomId, policy))).toBe(true);
    expect(a.candidateBlocks).toBeLessThanOrEqual(40);
  });

  it('evaluates only complete rollouts and reports real MCTS visits', async () => {
    const grammar = domain();
    const objective = new DeterministicObjective(64);
    const found = await runUctMcts(objective, grammar, 44, { batchSize: 4, rolloutBlocks: 2 });
    expect(objective.policies).toHaveLength(32);
    expect(objective.policies.every((policy) => {
      grammar.decode(policy); return true;
    })).toBe(true);
    expect(found.diagnostics.rootVisits).toBe(32);
    expect(found.diagnostics.bestPolicyVisits).toBeGreaterThan(0);
    expect(found.candidateBlocks).toBe(64);
  });

  it('runs the current diverse beam without exceeding the shared budget', async () => {
    const grammar = domain();
    const small = new ResponsePolicyDomain(grammar.kingdomId, {
      purchaseIds: [grammar.purchaseIds[0]!], floorIds: [grammar.purchaseIds[0]!], maxActiveSlots: 3
    });
    const objective = new DeterministicObjective(30);
    const found = await runStratifiedBeam(objective, {
      lanes: [{ id: 'test', width: 3, finalists: 1, domain: small }]
    });
    expect(found.candidateBlocks).toBeLessThanOrEqual(30);
    expect(() => small.decode(found.policy)).not.toThrow();
    expect((found.diagnostics.stages as object[]).length).toBeGreaterThan(0);
  });
});

describe('the pilot artifact schema', () => {
  it('accepts the recorded fixed-mixture comparison shape', () => {
    const grammar = domain(); const policy = grammar.complete([], grammar.floorTokens[0]!);
    const held = { mean: 0.6, matchCount: 4, seedBlocks: 1, interval95: { lower: 0.51, upper: 0.7 } };
    const row = (optimizer: 'stratified-beam' | 'uniform-random-racing' | 'discrete-cem' | 'uct-mcts') => ({
      optimizer, optimizerSeed: 1, elapsedMs: 1, trainingBlocksConsumed: 1, trainingMatches: 4,
      bestPolicy: policy, bestTrainingMean: 0.6,
      trainingCurve: [{ candidateBlocks: 1, matches: 4, bestMean: 0.6, policyId: policy.id }],
      diagnostics: {}, heldOut: held
    });
    const parsed = responseOptimizerPilotSchema.parse({ schemaVersion: 1,
      experiment: 'response-optimizer-pilot', createdAt: new Date(0).toISOString(),
      frozen: { kingdom: deepBeamSuite.createInput(grammar.kingdomId).kingdom,
        kingdomIdentity: 'rules', targetMixtureIdentity: 'mixture',
        targetMixture: [{ strategy: policy, weight: 1 }], sourceArtifact: 'saved.json' },
      config: { startingDraftEnabled: false, maxActiveSlots: 8, trainingBudgetPerRestart: 1,
        confirmationBlocks: 1, restarts: 1, workers: 1, seed: 1,
        trainingScheduleSeeds: [2], confirmationScheduleSeed: 3,
        confirmationScheduleIdentity: 'schedule', optimizerConfig: {}, optimizerSeeds: {} },
      results: [row('stratified-beam'), row('uniform-random-racing'), row('discrete-cem'), row('uct-mcts')] });
    expect(parsed.results).toHaveLength(4);
  });
});
