import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { emptyAggregate } from '../../src/sim/pairing';
import { InlinePairingRunner } from '../../src/sim/pairingRunner';
import type { PairingJob, PairingRunner } from '../../src/sim/pairingRunner';
import { strategyIsLegal } from '../../src/sim/randomStrategy';
import { BudgetedResponseObjective } from '../../src/sim/budgetedResponseObjective';
import type { TrainingCurvePoint } from '../../src/sim/budgetedResponseObjective';
import { ResponsePolicyDomain } from '../../src/sim/responsePolicyGrammar';
import type { PrefixToken } from '../../src/sim/responsePolicyGrammar';
import {
  DependencyAwareCemModel, runDiscreteCem, runFinalTrainingRerace, runStratifiedBeam,
  runUctMcts, runUniformRandomRacing
} from '../../src/sim/responseOptimizers';
import type { ObjectiveLike } from '../../src/sim/responseOptimizers';
import { canonicalStrategy, stableHash } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import { matrixProtocol } from '../../src/sim/payoffMatrix';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../../src/sim/experimentConfig';
import { STRATIFIED_BEAM_LANES } from '../../src/sim/stratifiedBeam';
import {
  loadFrozenEquilibrium, parsePilotOptions, responseOptimizerPilotSchema, runPilot
} from '../../scripts/response_optimizer_pilot';

class DeterministicObjective implements ObjectiveLike {
  readonly curve: TrainingCurvePoint[] = [];
  readonly policies: Strategy[] = [];
  private readonly totals = new Map<string, { total: number; blocks: number }>();
  blocksConsumed = 0;
  matchesConsumed = 0;
  private calls = 0;
  constructor(readonly budget: number,
    private readonly scorer: ((strategy: Strategy, index: number, call: number) => number) | null = null) {}
  get remaining(): number { return this.budget - this.blocksConsumed; }
  canEvaluate(candidates: number, blocks: number): boolean { return candidates * blocks <= this.remaining; }
  async evaluate(candidates: readonly Strategy[], blocks: number) {
    if (!this.canEvaluate(candidates.length, blocks)) throw new Error('over budget');
    this.blocksConsumed += candidates.length * blocks;
    this.matchesConsumed += candidates.length * blocks * 4;
    this.policies.push(...candidates);
    const call = this.calls;
    const evaluations = candidates.map((strategy, index) => {
      const score = this.scorer?.(strategy, index, call)
        ?? Number.parseInt(stableHash(canonicalStrategy(strategy)).slice(0, 6), 16) / 0xffffff;
      const form = canonicalStrategy(strategy);
      const held = this.totals.get(form) ?? { total: 0, blocks: 0 };
      held.total += score * blocks; held.blocks += blocks; this.totals.set(form, held);
      return { strategy, mean: score, blockScores: Array<number>(blocks).fill(score),
        interval: null, matches: blocks * 4, telemetry: emptyAggregate() };
    });
    const best = [...this.totals.entries()].sort((left, right) =>
      right[1].total / right[1].blocks - left[1].total / left[1].blocks)[0]!;
    const bestStrategy = candidates.find((strategy) => canonicalStrategy(strategy) === best[0])
      ?? this.policies.find((strategy) => canonicalStrategy(strategy) === best[0])!;
    this.curve.push({ candidateBlocks: this.blocksConsumed, matches: this.matchesConsumed,
      bestMean: best[1].total / best[1].blocks, policyId: bestStrategy.id });
    this.calls += 1;
    return evaluations;
  }
  aggregate(strategy: Strategy) {
    const held = this.totals.get(canonicalStrategy(strategy));
    return held ? { mean: held.total / held.blocks, blocks: held.blocks } : null;
  }
}

class ScoreRunner implements PairingRunner {
  private calls = 0;
  constructor(private readonly score: (job: PairingJob, call: number) => number) {}
  async run(jobs: readonly PairingJob[]) {
    const call = this.calls;
    this.calls += 1;
    return { submitted: jobs.length, outcomes: jobs.map((job) => {
      const score = this.score(job, call);
      return { record: { played: 4, wins: 0, draws: 4, losses: 0, aborted: 0 },
        candidateScore: score * 4, opponentScore: (1 - score) * 4, telemetry: emptyAggregate(),
        matches: 4, seedBlocks: 1, stopReason: 'maximum' as const,
        candidateMean: score, opponentMean: 1 - score,
        blocks: [{ seed: job.options.seeds[0]!, score, played: 4, aborted: 0 }], aborts: [] };
    }) };
  }
  async close(): Promise<void> {}
}

function domain(): ResponsePolicyDomain {
  deepBeamSuite.register();
  return new ResponsePolicyDomain('deep-beam-tuning-001', { maxActiveSlots: 8 });
}

function writeValidFrozen(root: string, kingdomId: string): void {
  const input = deepBeamSuite.createInput(kingdomId);
  const grammar = new ResponsePolicyDomain(kingdomId);
  const strategies = [grammar.complete([], grammar.floorTokens[0]!),
    grammar.complete([], grammar.floorTokens[1]!)];
  const value = { schemaVersion: 1, experiment: 'draft-off-diverse-beam-double-oracle',
    suiteVersion: deepBeamSuite.version, kingdom: input.kingdom, rulesFingerprint: input.rulesFingerprint,
    config: { startingDraftEnabled: false, workers: 10, iterations: 3, maxSlots: 8,
      lanes: STRATIFIED_BEAM_LANES, admissionsPerLane: 1, stageSeeds: [1, 2, 4],
      confirmationSeeds: 12, matrixSeeds: 8, earlyStopDelta: 0.002,
      earlyStopPatience: 2, sweep: false }, elapsedMs: 1, iterations: [{}],
    matrix: { protocol: matrixProtocol(kingdomId,
      Array.from({ length: 8 }, (_unused, index) => 40_000 + index),
      TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false), strategies,
      cells: [{ complete: true }], complete: true }, equilibrium: {},
    targetMixture: [{ strategy: strategies[0]!, weight: 1 }], independentSweep: null };
  const file = deepBeamSuite.resultPath(root, kingdomId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

describe('the shared response policy grammar', () => {
  it('builds one legal canonical draft-off policy at every allowed length', () => {
    const grammar = domain();
    for (let length = 0; length <= grammar.maxPrefixSlots; length += 1) {
      const floorCard = grammar.floorTokens[0]!.slice('floor:'.length);
      const prefix = grammar.purchaseIds.filter((cardId) => cardId !== floorCard).slice(0, length)
        .map((cardId): PrefixToken => `buy:${cardId}:1`);
      const policy = grammar.complete(prefix, grammar.floorTokens[0]!);
      expect(grammar.decode(policy).prefix).toHaveLength(length);
      expect(policy.startingBuild).toEqual([]);
      expect(strategyIsLegal(grammar.kingdomId, policy)).toBe(true);
      expect(grammar.complete(grammar.decode(policy).prefix, grammar.decode(policy).floor).id).toBe(policy.id);
    }
  });

  it('rejects invalid grammar boundaries and non-domain policies', () => {
    const grammar = domain();
    expect(() => new ResponsePolicyDomain(grammar.kingdomId, { maxActiveSlots: 0 })).toThrow('maxActiveSlots');
    expect(() => new ResponsePolicyDomain(grammar.kingdomId, { maxActiveSlots: 11 })).toThrow('maxActiveSlots');
    expect(() => grammar.complete(Array<PrefixToken>(8).fill(grammar.prefixTokens[0]!),
      grammar.floorTokens[0]!)).toThrow('too long');
    expect(() => grammar.complete(['buy:not-a-card:1'], grammar.floorTokens[0]!)).toThrow('not legal');
    expect(() => grammar.complete([], 'floor:not-a-card')).toThrow('not legal');
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

  it('uses a deterministic common-random-number schedule', () => {
    const grammar = domain(); const opponent = grammar.complete([], grammar.floorTokens[0]!);
    const make = (seed: number) => new BudgetedResponseObjective({ kingdomId: grammar.kingdomId,
      opponents: [{ strategy: opponent, weight: 1 }], budget: 9, scheduleSeed: seed,
      runner: new InlinePairingRunner(), turnLimitPerPlayer: 30, actionCapPerTurn: 200 });
    expect(make(41).schedule).toEqual(make(41).schedule);
    expect(make(41).schedule.blocks).not.toEqual(make(42).schedule.blocks);
  });

  it('changes the current best curve entry when repeated evidence lowers the leader', async () => {
    const grammar = domain();
    const policies = [grammar.complete([], grammar.floorTokens[0]!),
      grammar.complete([], grammar.floorTokens[1]!)];
    const runner = new ScoreRunner((job, call) => job.candidate.id === policies[0]!.id
      ? (call === 0 ? 1 : 0) : 0.8);
    const objective = new BudgetedResponseObjective({ kingdomId: grammar.kingdomId,
      opponents: [{ strategy: policies[0]!, weight: 1 }], budget: 4, scheduleSeed: 4, runner,
      turnLimitPerPlayer: 30, actionCapPerTurn: 200 });
    await objective.evaluate(policies, 1);
    await objective.evaluate(policies, 1);
    expect(objective.curve.map((entry) => entry.policyId)).toEqual([policies[0]!.id, policies[1]!.id]);
    expect(objective.curve[1]!.bestMean).toBeCloseTo(0.8);
  });
});

describe('dependency-aware CEM', () => {
  it('updates complete ordered policies by their preceding token and keeps exploration', () => {
    const grammar = domain();
    const first = grammar.prefixTokens[0]!;
    const firstCard = first.split(':')[1];
    const second = grammar.prefixTokens.find((token) => token.split(':')[1] !== firstCard)!;
    const floor = grammar.floorTokens[1]!;
    const model = new DependencyAwareCemModel(grammar, { smoothing: 0.8, explorationFloor: 0.05 });
    const before = model.prefixProbability(2, 1, first, second);
    model.update(Array<Strategy>(10).fill(grammar.complete([first, second], floor)));
    expect(model.prefixProbability(2, 1, first, second)).toBeGreaterThan(before);
    expect(model.prefixProbability(5, 1, first, second)).toBeGreaterThan(before);
    const alternative = grammar.prefixTokens.find((token) => token !== second)!;
    expect(model.prefixProbability(2, 1, first, alternative)).toBeGreaterThan(0);
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
    for (const policy of left.policies) {
      const decoded = grammar.decode(policy);
      expect(grammar.complete(decoded.prefix, decoded.floor).id).toBe(policy.id);
    }
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

  it('evaluates only complete rollouts and is deterministic with its seed', async () => {
    const grammar = domain();
    const objective = new DeterministicObjective(64); const repeated = new DeterministicObjective(64);
    const found = await runUctMcts(objective, grammar, 44, { batchSize: 4, rolloutBlocks: 2 });
    const again = await runUctMcts(repeated, grammar, 44, { batchSize: 4, rolloutBlocks: 2 });
    expect(objective.policies).toHaveLength(32);
    expect(objective.policies.every((policy) => {
      grammar.decode(policy); return true;
    })).toBe(true);
    expect(found.diagnostics.rootVisits).toBe(32);
    expect((found.diagnostics.finalistVisits as Record<string, number>)[found.policy.id]).toBeGreaterThan(0);
    expect(found.policy.id).toBe(again.policy.id);
    expect(found.candidateBlocks).toBe(64);
  });

  it('runs the current diverse beam without exceeding the shared budget', async () => {
    const grammar = domain();
    const small = new ResponsePolicyDomain(grammar.kingdomId, {
      purchaseIds: [grammar.purchaseIds[0]!], floorIds: [grammar.purchaseIds[0]!], maxActiveSlots: 3
    });
    const objective = new DeterministicObjective(30); const repeated = new DeterministicObjective(30);
    const options = { lanes: [{ id: 'test', width: 3, finalists: 1, domain: small }],
      stageBlocks: [1, 2, 4], earlyStopDelta: 0.002, earlyStopPatience: 2 };
    const found = await runStratifiedBeam(objective, options);
    const again = await runStratifiedBeam(repeated, options);
    expect(found.candidateBlocks).toBeLessThanOrEqual(30);
    expect(found.policy.id).toBe(again.policy.id);
    expect(() => small.decode(found.policy)).not.toThrow();
    expect((found.diagnostics.stages as object[]).length).toBeGreaterThan(0);
  });

  it('drops an early one-block beam winner when the common rerace reverses it', async () => {
    const grammar = domain();
    const small = new ResponsePolicyDomain(grammar.kingdomId, {
      purchaseIds: [grammar.purchaseIds[0]!], floorIds: [grammar.purchaseIds[0]!], maxActiveSlots: 2
    });
    let early = ''; let later = '';
    const objective = new DeterministicObjective(30, (strategy, index, call) => {
      if (call === 0) {
        if (index === 0) early = strategy.id;
        if (index === 1) later = strategy.id;
        return index === 0 ? 1 : index === 1 ? 0.75 : 0;
      }
      return strategy.id === early ? 0 : strategy.id === later ? 0.8 : 0;
    });
    const search = await runStratifiedBeam(objective, {
      lanes: [{ id: 'test', width: 2, finalists: 2, domain: small }],
      stageBlocks: [1], earlyStopDelta: 0.002, earlyStopPatience: 2, searchBudget: 9
    });
    const reraced = await runFinalTrainingRerace(objective, search, { candidateCount: 2, blocksPerCandidate: 2 });
    expect(search.policy.id).toBe(early);
    expect(reraced.policy.id).toBe(later);
    expect(reraced.diagnostics.finalRerace).toBeDefined();
  });

  it('runs every optimizer on the real objective with a small non-divisible budget', async () => {
    const grammar = domain();
    const small = new ResponsePolicyDomain(grammar.kingdomId, {
      purchaseIds: [grammar.purchaseIds[0]!], floorIds: [grammar.purchaseIds[0]!], maxActiveSlots: 2
    });
    const opponent = small.complete([], small.floorTokens[0]!);
    const run = async (name: string) => {
      const objective = new BudgetedResponseObjective({ kingdomId: grammar.kingdomId,
        opponents: [{ strategy: opponent, weight: 1 }], budget: 17, scheduleSeed: 19,
        runner: new InlinePairingRunner(), turnLimitPerPlayer: 30, actionCapPerTurn: 200 });
      const search = name === 'beam'
        ? await runStratifiedBeam(objective, { lanes: [{ id: 'test', width: 2, finalists: 2, domain: small }],
          stageBlocks: [1], earlyStopDelta: 0.002, earlyStopPatience: 2, searchBudget: 9 })
        : name === 'random' ? await runUniformRandomRacing(objective, small, 3,
          { batchSize: 8, roundBlocks: [1], searchBudget: 9 })
          : name === 'cem' ? await runDiscreteCem(objective, small, 3,
            { population: 8, evaluationBlocks: 1, searchBudget: 9 })
            : await runUctMcts(objective, small, 3,
              { batchSize: 8, rolloutBlocks: 1, searchBudget: 9 });
      return runFinalTrainingRerace(objective, search, { candidateCount: 8, blocksPerCandidate: 1 });
    };
    for (const name of ['beam', 'random', 'cem', 'mcts']) {
      const found = await run(name);
      expect(found.candidateBlocks).toBeGreaterThan(0);
      expect(found.candidateBlocks).toBeLessThanOrEqual(17);
      expect(() => small.decode(found.policy)).not.toThrow();
    }
  });
});

describe('the pilot artifact schema', () => {
  it('accepts the recorded fixed-mixture comparison shape', () => {
    const grammar = domain(); const policy = grammar.complete([], grammar.floorTokens[0]!);
    const held = { mean: 0.6, matchCount: 4, seedBlocks: 1, interval95: { lower: 0.51, upper: 0.7 } };
    const curve = [{ candidateBlocks: 1, matches: 4, bestMean: 0.6, policyId: policy.id }];
    const row = (optimizer: 'stratified-beam' | 'uniform-random-racing' | 'discrete-cem' | 'uct-mcts') => ({
      optimizer, selectedRestart: 0, optimizerSeed: 1, elapsedMs: 1,
      trainingBlocksConsumed: 1, trainingMatches: 4,
      bestPolicy: policy, bestTrainingMean: 0.6, trainingCurve: curve, finalists: [policy],
      restarts: [{ restart: 0, optimizerSeed: 1, trainingScheduleSeed: 2, candidateBlocks: 1,
        matches: 4, bestPolicy: policy, bestTrainingMean: 0.6, curve, finalists: [policy], diagnostics: {} }],
      diagnostics: {}, heldOut: held
    });
    const parsed = responseOptimizerPilotSchema.parse({ schemaVersion: 2,
      experiment: 'response-optimizer-pilot', createdAt: new Date(0).toISOString(),
      frozen: { kingdom: deepBeamSuite.createInput(grammar.kingdomId).kingdom,
        kingdomIdentity: 'rules', targetMixtureIdentity: 'mixture',
        targetMixture: [{ strategy: policy, weight: 1 }], sourceArtifact: 'saved.json' },
      config: { startingDraftEnabled: false, maxActiveSlots: 8, trainingBudgetPerRestart: 1,
        confirmationBlocks: 1, restarts: 1, workers: 1, seed: 1,
        trainingScheduleSeeds: [2], confirmationScheduleSeed: 3,
        confirmationScheduleIdentity: 'schedule', trainingCurveMinimumBlocks: 1,
        finalRerace: { candidateCount: 1, blocksPerCandidate: 1, reservedBlocks: 1 },
        optimizerConfig: {}, optimizerSeeds: {} },
      results: [row('stratified-beam'), row('uniform-random-racing'), row('discrete-cem'), row('uct-mcts')] });
    expect(parsed.results).toHaveLength(4);
  });

  it('parses explicit CLI options reproducibly', () => {
    const argv = ['--kingdom', 'deep-beam-tuning-001', '--budget', '123', '--seed', '9',
      '--restarts', '2', '--confirmation-blocks', '7', '--workers', '3', '--out', '/tmp/pilot.json'];
    expect(parsePilotOptions(argv, '/one')).toEqual(parsePilotOptions(argv, '/two'));
    expect(parsePilotOptions(argv, '/one')).toMatchObject({ budget: 123, seed: 9, restarts: 2,
      confirmationBlocks: 7, workers: 3, out: '/tmp/pilot.json' });
  });

  it('rejects stale and malformed frozen artifacts through deep-suite validation', () => {
    const kingdomId = domain().kingdomId;
    for (const content of ['{broken', JSON.stringify({ schemaVersion: 1, suiteVersion: 'stale' })]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-response-frozen-'));
      const file = deepBeamSuite.resultPath(root, kingdomId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      expect(() => loadFrozenEquilibrium(root, kingdomId)).toThrow('failed deep-beam validation');
    }
  });

  it('records two restart seeds, counters, curves, finalists, and selected evidence consistently', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-response-restarts-'));
    const kingdomId = domain().kingdomId;
    writeValidFrozen(root, kingdomId);
    const artifact = await runPilot({ kingdomId, budget: 40, confirmationBlocks: 1,
      seed: 11, restarts: 2, workers: 1, out: path.join(root, 'ignored.json') }, root);
    for (const optimizer of artifact.results) {
      expect(optimizer.restarts).toHaveLength(2);
      const selected = optimizer.restarts[optimizer.selectedRestart]!;
      expect(optimizer.optimizerSeed).toBe(selected.optimizerSeed);
      expect(optimizer.trainingBlocksConsumed).toBe(selected.candidateBlocks);
      expect(optimizer.trainingMatches).toBe(selected.matches);
      expect(optimizer.trainingCurve).toEqual(selected.curve);
      expect(optimizer.finalists).toEqual(selected.finalists);
      expect(selected.trainingScheduleSeed).toBe(
        artifact.config.trainingScheduleSeeds[optimizer.selectedRestart]);
    }
  });
});
