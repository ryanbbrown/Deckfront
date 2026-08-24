import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SeededRandom, resetKingdoms } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { emptyAggregate } from '../../src/sim/pairing';
import type { PairingJob, PairingRunner } from '../../src/sim/pairingRunner';
import {
  RandomPsroSeedLedger, convergenceState, randomRacingBudget, runRandomPsro,
  stoplessRandomDomain, summarizeIndependentAttack, validateRandomPsroArtifact
} from '../../src/sim/randomPsro';
import {
  inspectRandomPsroUnit, randomPsroArtifactPath, runRandomPsroBatch
} from '../../src/sim/randomPsroSuite';
import {
  buildKingdom001OrdinarySource, directionalCrossPlayWithinRange, evaluateKingdom001Comparison,
  loadKingdom001PriorLottery, renderKingdom001SenseCheck, renderRandomPsroConsistencyReport,
  weightedLotteryEvaluation, writeKingdom001OrdinarySource
} from '../../src/sim/randomPsroReport';
import { runUniformRandomRacing } from '../../src/sim/responseOptimizers';
import {
  INFINITE_COUNT, canonicalStrategy, normalizeCumulativeBuyTargets
} from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

class DrawRunner implements PairingRunner {
  async run(jobs: readonly PairingJob[]) {
    if (jobs.some((job) => job.options.startingDraftEnabled !== false)) {
      throw new Error('Random PSRO evaluation must keep the starting draft disabled.');
    }
    return { submitted: jobs.length, outcomes: jobs.map((job) => {
      const blocks = job.options.seeds.map((seed) => ({ seed, score: 0.5, played: 4, aborted: 0 }));
      return { record: { played: blocks.length * 4, wins: 0, draws: blocks.length * 4, losses: 0, aborted: 0 },
        candidateScore: blocks.length * 2, opponentScore: blocks.length * 2,
        telemetry: emptyAggregate(), matches: blocks.length * 4, seedBlocks: blocks.length,
        stopReason: 'maximum' as const, candidateMean: 0.5, opponentMean: 0.5, blocks, aborts: [] };
    }) };
  }
  async close(): Promise<void> {}
}

class CandidateWinRunner implements PairingRunner {
  async run(jobs: readonly PairingJob[]) {
    return { submitted: jobs.length, outcomes: jobs.map((job) => {
      const blocks = job.options.seeds.map((seed) => ({ seed, score: 1, played: 4, aborted: 0 }));
      return { record: { played: blocks.length * 4, wins: blocks.length * 4, draws: 0, losses: 0, aborted: 0 },
        candidateScore: blocks.length * 4, opponentScore: 0,
        telemetry: emptyAggregate(), matches: blocks.length * 4, seedBlocks: blocks.length,
        stopReason: 'maximum' as const, candidateMean: 1, opponentMean: 0, blocks, aborts: [] };
    }) };
  }
  async close(): Promise<void> {}
}

const tinyConfig = {
  initialStrategies: 2, proposalCount: 2, raceBlocks: [1], finalists: 1,
  confirmationBlocks: 2, matrixBlocks: 1, safetyCap: 5, cleanBatchesRequired: 5,
  independentAttackProposalCount: 2
};

afterEach(() => resetKingdoms());

function setup(): string {
  deepBeamSuite.register();
  return 'deep-beam-tuning-001';
}

async function tinyArtifact(seed = 7) {
  return runRandomPsro({ kingdomId: setup(), seed, config: tinyConfig }, new DrawRunner());
}


describe('random-first policy grammar and evidence', () => {
  it('samples only stopless 1–8 slot policies with an infinite fallback', () => {
    const kingdomId = setup();
    const domain = stoplessRandomDomain(kingdomId);
    const random = new SeededRandom(13);
    for (let index = 0; index < 500; index += 1) {
      const strategy = domain.randomComplete(random);
      const active = strategy.buyPlan.filter((slot) => slot.kind !== 'inactive');
      expect(active.length).toBeGreaterThanOrEqual(1);
      expect(active.length).toBeLessThanOrEqual(8);
      expect(active.some((slot) => slot.kind === 'stop')).toBe(false);
      expect(active.at(-1)).toMatchObject({ kind: 'buy', desiredCount: 99 });
      expect(domain.decode(strategy).floor).toMatch(/^floor:/);
    }
    expect(domain.floorTokens).not.toContain('no-buy');
    expect(domain.prefixTokens.some((token) => token.startsWith('stop:'))).toBe(false);
  });

  it('allocates fresh disjoint schedules and independent run seeds', () => {
    const first = new RandomPsroSeedLedger(1), second = new RandomPsroSeedLedger(2);
    const a = first.reserve('round-0-race', 15);
    const b = first.reserve('round-0-confirm', 20);
    const c = first.reserve('round-1-race', 15);
    first.validate(); second.reserve('round-0-race', 15); second.validate();
    expect(new Set([...a, ...b, ...c]).size).toBe(50);
    expect(first.namespaces['round-0-race']).not.toEqual(second.namespaces['round-0-race']);
  });

  it('requires five consecutive clean fresh-plus-archive batches and resets after admission', () => {
    expect(convergenceState(0, false)).toEqual({ cleanStreak: 1, converged: false });
    expect(convergenceState(4, true)).toEqual({ cleanStreak: 0, converged: false });
    expect(convergenceState(4, false)).toEqual({ cleanStreak: 5, converged: true });
  });

  it('removes cumulative buy no-ops before response policy identity', () => {
    const kingdomId = setup();
    const domain = stoplessRandomDomain(kingdomId);
    const card = domain.purchaseIds[0]!, other = domain.purchaseIds[1]!;
    const reduced = domain.complete([
      `buy:${card}:5`, `buy:${card}:2`, `buy:${card}:5`, `buy:${other}:2`
    ], `floor:${other}`);
    expect(domain.decode(reduced).prefix).toEqual([`buy:${card}:5`, `buy:${other}:2`]);
    const increasing = domain.complete([`buy:${card}:2`, `buy:${card}:5`], `floor:${other}`);
    expect(domain.decode(increasing).prefix).toEqual([`buy:${card}:2`, `buy:${card}:5`]);
    expect(normalizeCumulativeBuyTargets([
      { kind: 'buy', cardId: card!, desiredCount: INFINITE_COUNT },
      { kind: 'buy', cardId: card!, desiredCount: 5 },
      { kind: 'buy', cardId: other!, desiredCount: 2 }
    ]).filter((slot) => slot.kind !== 'inactive')).toEqual([
      { kind: 'buy', cardId: card, desiredCount: INFINITE_COUNT },
      { kind: 'buy', cardId: other, desiredCount: 2 }
    ]);
  });

  it('counts only novel policies before racing and finalist truncation', async () => {
    const kingdomId = setup();
    const domain = stoplessRandomDomain(kingdomId);
    const seed = 55;
    const known = domain.randomComplete(new SeededRandom(seed));
    const budget = randomRacingBudget(2, [1]);
    const policies: Strategy[] = [];
    let consumed = 0;
    const objective = {
      budget, get remaining() { return budget - consumed; }, get blocksConsumed() { return consumed; },
      get matchesConsumed() { return consumed * 4; }, curve: [],
      canEvaluate: (count: number, blocks: number) => count * blocks <= budget - consumed,
      evaluate: async (candidates: readonly Strategy[], blocks: number) => {
        policies.push(...candidates); consumed += candidates.length * blocks;
        return candidates.map((strategy) => ({ strategy, mean: 0.5, blockScores: [0.5], interval: null,
          matches: blocks * 4, telemetry: emptyAggregate() }));
      },
      aggregate: () => ({ mean: 0.5, blocks: 1 })
    };
    await runUniformRandomRacing(objective, domain, seed, { batchSize: 2, roundBlocks: [1],
      searchBudget: budget, excludedCanonical: new Set([canonicalStrategy(known)]) });
    expect(policies).toHaveLength(2);
    expect(policies.map(canonicalStrategy)).not.toContain(canonicalStrategy(known));
  });
});

describe('random PSRO artifacts and resumability', () => {
  it('rejects matrix evidence above the pairing seed limit', async () => {
    await expect(runRandomPsro({ kingdomId: setup(), seed: 7,
      config: { ...tinyConfig, matrixBlocks: 26 } }, new DrawRunner()))
      .rejects.toThrow('25-seed pairing limit');
  });

  it('recomputes and rejects corrupted rules, matrix, equilibrium, chain, terminal, and attack evidence', async () => {
    const artifact = await tinyArtifact();
    const expected = { kingdomId: artifact.kingdom.id, seed: 7, config: tinyConfig };
    expect(artifact.status).toBe('converged');
    expect(artifact.rounds.map((round) => round.cleanBatch)).toEqual([true, true, true, true, true]);
    expect(validateRandomPsroArtifact(artifact, expected)).toMatchObject({ valid: true, converged: true });
    const rejects = (name: string, mutate: (copy: typeof artifact) => void): void => {
      const copy = structuredClone(artifact); mutate(copy);
      expect(validateRandomPsroArtifact(copy, expected).valid, name).toBe(false);
    };
    rejects('kingdom', (copy) => { copy.kingdom.name = 'wrong'; });
    rejects('rules', (copy) => { copy.rulesFingerprint.hash = 'stale'; });
    rejects('config', (copy) => { copy.config.finalists += 1; });
    rejects('matrix id', (copy) => { copy.matrix.strategies[0]!.id = 'wrong'; });
    rejects('matrix cells', (copy) => { copy.matrix.cells.pop(); });
    rejects('cell payoff', (copy) => { copy.matrix.cells[0]!.centeredPayoff += 0.1; });
    rejects('nonfinite payoff', (copy) => { copy.matrix.centeredPayoffs[0]![1] = Number.NaN; });
    rejects('antisymmetry', (copy) => {
      copy.matrix.centeredPayoffs[0]![1] = copy.matrix.centeredPayoffs[0]![1]! + 0.1;
    });
    rejects('equilibrium ids', (copy) => { copy.equilibrium.strategyIds.reverse(); });
    rejects('equilibrium weights', (copy) => { copy.equilibrium.weights[copy.equilibrium.strategyIds[0]!]! += 0.1; });
    rejects('equilibrium value', (copy) => { copy.equilibrium.value += 0.1; });
    rejects('equilibrium residual', (copy) => { copy.equilibrium.residuals.value = -1; });
    rejects('too few clean rounds', (copy) => { copy.rounds.splice(0, 1); });
    rejects('round target chain', (copy) => { copy.rounds[0]!.targetWeights.wrong = 1; });
    rejects('round equilibrium chain', (copy) => { copy.rounds[0]!.equilibriumAfter.value += 0.1; });
    rejects('terminal streak', (copy) => { copy.rounds.at(-1)!.cleanStreak = 1; });
    rejects('archive', (copy) => { copy.archive.push(structuredClone(copy.archive[0]!)); });
    rejects('archive reconsideration', (copy) => { copy.rounds[1]!.archiveCandidateIds = []; });
    rejects('attack evidence', (copy) => { copy.independentAttack!.finalists[0]!.blocks += 1; });
    rejects('attack flag', (copy) => { copy.independentAttack!.confirmedAboveThreshold = true; });
    rejects('seed overlap', (copy) => {
      const labels = Object.keys(copy.seedNamespaces);
      copy.seedNamespaces[labels[1]!]![0] = copy.seedNamespaces[labels[0]!]![0]!;
    });
  });

  it('persists unique finalists and reconsiders the archive against later mixtures', async () => {
    const artifact = await tinyArtifact(8);
    expect(artifact.archive).toHaveLength(new Set(artifact.archive.map((entry) => canonicalStrategy(entry.strategy))).size);
    expect(artifact.archive.length).toBeGreaterThan(0);
    expect(artifact.rounds[1]!.archiveCandidateIds).toContain(artifact.archive[0]!.strategy.id);
    expect(artifact.rounds.at(-1)!.archiveSizeAfter).toBe(artifact.archive.length);
  });

  it('admits every passing finalist as one matrix batch before the round equilibrium', async () => {
    const config = { ...tinyConfig, proposalCount: 9, finalists: 2, safetyCap: 1 };
    const artifact = await runRandomPsro({ kingdomId: setup(), seed: 10, config }, new CandidateWinRunner());
    const round = artifact.rounds[0]!;
    expect(round.finalists).toHaveLength(2);
    expect(round.admittedStrategyIds).toEqual(round.finalists.map((entry) => entry.strategy.id));
    expect(round.equilibriumAfter.strategyIds).toHaveLength(config.initialStrategies + 2);
    expect(artifact.matrix.strategies).toHaveLength(config.initialStrategies + 2);
    expect(artifact.matrix.cells).toHaveLength(6);
    expect(validateRandomPsroArtifact(artifact, { kingdomId: artifact.kingdom.id, seed: 10, config }).valid).toBe(true);
  });

  it('omits independent attack evidence when the safety cap is incomplete', async () => {
    const config = { ...tinyConfig, safetyCap: 1 };
    const artifact = await runRandomPsro({ kingdomId: setup(), seed: 9, config }, new DrawRunner());
    expect(artifact).toMatchObject({ status: 'incomplete', stopReason: 'safety-cap', independentAttack: null });
    expect(Object.keys(artifact.seedNamespaces).some((label) => label.startsWith('attack:'))).toBe(false);
    expect(validateRandomPsroArtifact(artifact, { kingdomId: artifact.kingdom.id, seed: 9, config }))
      .toMatchObject({ valid: true, converged: false });
  });

  it('uses the strict greater-than-50% attack threshold and retains all finalists', async () => {
    const artifact = await tinyArtifact();
    const finalists = structuredClone(artifact.independentAttack!.finalists);
    const passing = structuredClone(finalists[0]!);
    passing.strategy = stoplessRandomDomain(setup()).randomComplete(new SeededRandom(98));
    passing.mean = 0.7; passing.interval95 = { lower: 0.6, upper: 0.8 };
    finalists[0]!.mean = 0.9; finalists[0]!.interval95 = { lower: 0.50, upper: 1 };
    const result = summarizeIndependentAttack(1, 2, [3, 4], [finalists[0]!, passing], 0.50);
    expect(result.finalists).toHaveLength(2);
    expect(result.best?.strategy.id).toBe(passing.strategy.id);
    expect(result.confirmedAboveThreshold).toBe(true);
    expect(summarizeIndependentAttack(1, 1, [3], [finalists[0]!], 0.50).confirmedAboveThreshold).toBe(false);
  });

  it('marks a clean-streak artifact incomplete when final validation finds an admissible attack', async () => {
    const artifact = await tinyArtifact(11);
    artifact.independentAttack!.finalists[0]!.mean = 0.75;
    artifact.independentAttack!.finalists[0]!.interval95 = { lower: 0.60, upper: 0.90 };
    artifact.independentAttack!.best = structuredClone(artifact.independentAttack!.finalists[0]!);
    artifact.independentAttack!.confirmedAboveThreshold = true;
    artifact.status = 'incomplete';
    artifact.stopReason = 'independent-attack-found';
    expect(validateRandomPsroArtifact(artifact, {
      kingdomId: artifact.kingdom.id, seed: 11, config: tinyConfig
    })).toMatchObject({ valid: true, converged: false });
  });

  it('keeps a completed unit when a later unit fails, then skips it on rerun', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-random-psro-'));
    const kingdomId = setup();
    const units = [{ kingdomId, seed: 7 }, { kingdomId, seed: 8 }];
    const called: number[] = [];
    const first = await runRandomPsroBatch({ root, units, config: tinyConfig }, async (options) => {
      called.push(options.seed);
      if (options.seed === 8) throw new Error('interrupted unit');
      return runRandomPsro(options, new DrawRunner());
    });
    expect(first.completed).toEqual([units[0]]);
    expect(first.failed).toHaveLength(1);
    expect(fs.existsSync(randomPsroArtifactPath(root, units[0]!))).toBe(true);
    const second = await runRandomPsroBatch({ root, units, config: tinyConfig }, async (options) => {
      called.push(options.seed); return runRandomPsro(options, new DrawRunner());
    });
    expect(second.skipped).toEqual([units[0]]);
    expect(second.completed).toEqual([units[1]]);
    expect(called).toEqual([7, 8, 8]);
    expect(inspectRandomPsroUnit(root, units[1]!, tinyConfig).converged).toBe(true);
  });
});

describe('consistency report math and prior sources', () => {
  it('weights whole-lottery block scores and reports the worst support CI', () => {
    const strategies = [{ id: 'a', startingBuild: [], buyPlan: [] },
      { id: 'b', startingBuild: [], buyPlan: [] }] as Strategy[];
    const evaluation = (strategy: Strategy, scores: number[]) => ({ strategy,
      mean: scores.reduce((sum, value) => sum + value, 0) / scores.length,
      blockScores: scores, interval: null, matches: scores.length * 4, telemetry: emptyAggregate() });
    const result = weightedLotteryEvaluation([
      evaluation(strategies[0]!, [1, 0]), evaluation(strategies[1]!, [0.5, 0.5])
    ], { a: 0.25, b: 0.75 }, 3);
    expect(result.score).toBeCloseTo(0.5);
    expect(result.support).toHaveLength(2);
    expect(result.worstSupport.interval95.lower).toBeGreaterThanOrEqual(0);
    const rendered = renderRandomPsroConsistencyReport({ schemaVersion: 1,
      experiment: 'random-psro-consistency-report', createdAt: '', reportSeed: 1, confirmationBlocks: 2,
      empiricalGates: { oldSupportVsNewNoCiLowerAbove50: true, crossRunLotteryWithin47To53: true,
        crossRunSupportNoCiLowerAbove50: true, independentAttackNoCiLowerAbove55: true }, kingdoms: [] });
    expect(rendered).toContain('empirical gates');
    expect(rendered).toContain('not proofs');
  });

  it('builds the one-run K001 comparison through the shared evaluator and gates every old support', async () => {
    const domain = stoplessRandomDomain(setup());
    const random = new SeededRandom(77);
    const makeLottery = (label: string, count: number) => ({ label,
      strategies: Array.from({ length: count }, () => ({ strategy: domain.randomComplete(random), weight: 1 / count })) });
    const current = makeLottery('seed-35001', 2);
    const ordinary = makeLottery('ordinary', 3);
    const stratified = makeLottery('stratified', 2);
    const calls: string[] = [];
    const evaluate = async (candidate: typeof current, _opponent: typeof current, label: string) => {
      calls.push(label);
      const support = candidate.strategies.map((entry) => ({ strategy: entry.strategy, mean: 0.5,
        interval95: { lower: 0.49, upper: 0.51 }, blocks: 10, matches: 40 }));
      return { score: 0.5, interval95: { lower: 0.49, upper: 0.51 }, support, worstSupport: support[0]! };
    };
    const comparison = await evaluateKingdom001Comparison([current], ordinary, stratified,
      evaluate, { ordinary: 'ordinary.json', stratified: 'stratified.json' });
    expect(calls).toEqual(['old-support-vs-seed-35001', 'seed-35001-vs-ordinary',
      'seed-35001-vs-stratified', 'ordinary-vs-seed-35001', 'stratified-vs-seed-35001',
      'ordinary-vs-stratified']);
    expect(comparison.oldSupportAgainstNew['seed-35001']!.support).toHaveLength(5);
    expect(comparison.newSupportAgainstOld['seed-35001']!.ordinary.support).toHaveLength(2);
    expect(comparison.newSupportAgainstOld['seed-35001']!.stratified.support).toHaveLength(2);
    expect(comparison.oldSupportGate).toBe(true);
    comparison.oldSupportAgainstNew['seed-35001']!.support[0]!.interval95.lower = 0.51;
    comparison.oldSupportGate = Object.values(comparison.oldSupportAgainstNew)
      .every((result) => result.support.every((entry) => entry.interval95.lower <= 0.50));
    expect(comparison.oldSupportGate).toBe(false);
    const markdown = renderKingdom001SenseCheck({ schemaVersion: 1,
      experiment: 'random-psro-k001-old-lottery-check', createdAt: '', runSeed: 35_001,
      reportSeed: 92_001, confirmationBlocks: 10, newArtifact: 'new.json',
      seedNamespaces: {}, comparison });
    expect(markdown).toContain('Every old support strategy');
    expect(markdown).toContain('Every new support strategy');
    expect(markdown).toContain('Whole-lottery cross-play');
  });

  it('requires both fresh cross-play directions to pass the 47–53% gate', () => {
    expect(directionalCrossPlayWithinRange(0.5, 0.52)).toBe(true);
    expect(directionalCrossPlayWithinRange(0.5, 0.54)).toBe(false);
    expect(directionalCrossPlayWithinRange(0.46, 0.5)).toBe(false);
  });

  it('requires exact membership, content, and weights from the saved stratified source', () => {
    setup();
    const sourceFile = path.join(process.cwd(), '.experiments', 'deep-beam-suite', 'deep-beam-v1',
      'results', 'deep-beam-tuning-001.json');
    const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8')) as Record<string, unknown>;
    expect(loadKingdom001PriorLottery(sourceFile, 'stratified-melee').strategies.map((entry) => entry.strategy.id))
      .toEqual(['sg-1e75552ec4', 'sg-7b4e9543a9']);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-stratified-source-'));
    const rejects = (name: string, mutate: (copy: Record<string, unknown>) => void): void => {
      const copy = structuredClone(source); mutate(copy); const file = path.join(root, `${name}.json`);
      fs.writeFileSync(file, JSON.stringify(copy));
      expect(() => loadKingdom001PriorLottery(file, 'stratified-melee'), name).toThrow();
    };
    const target = (copy: Record<string, unknown>) => copy.targetMixture as { weight: number; strategy: Strategy }[];
    rejects('extra', (copy) => { target(copy).push(structuredClone(target(copy)[0]!)); });
    rejects('weight', (copy) => { target(copy)[0]!.weight += 0.01; });
    rejects('content', (copy) => { target(copy)[0]!.strategy.buyPlan[0] = { kind: 'inactive' }; });
    rejects('id', (copy) => { target(copy)[0]!.strategy.id = 'sg-fabricated'; });
  });

  it('writes and validates the exact three-strategy recovered ordinary source', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-random-source-'));
    setup();
    const ordinary = path.join(root, 'ordinary.json');
    writeKingdom001OrdinarySource(root, ordinary);
    const loaded = loadKingdom001PriorLottery(ordinary, 'ordinary-mage');
    expect(loaded.strategies.map((entry) => [entry.strategy.id, entry.weight])).toEqual([
      ['sg-00060b43b5', 0.3404255296666667],
      ['sg-0033a454c1', 0.3404255341333333],
      ['sg-00dac22eb4', 0.3191489362]
    ]);
    const source = buildKingdom001OrdinarySource(root);
    const rejects = (name: string, mutate: (copy: typeof source) => void): void => {
      const file = path.join(root, `${name}.json`); const copy = structuredClone(source); mutate(copy);
      fs.writeFileSync(file, JSON.stringify(copy));
      expect(() => loadKingdom001PriorLottery(file, 'ordinary-mage'), name).toThrow();
    };
    rejects('extra', (copy) => { copy.targetMixture!.push(structuredClone(copy.targetMixture![0]!)); });
    rejects('weight', (copy) => { copy.targetMixture![0]!.weight += 0.01; });
    rejects('content', (copy) => { copy.targetMixture![0]!.strategy.buyPlan[0] = { kind: 'inactive' }; });
    rejects('id', (copy) => { copy.targetMixture![0]!.strategy.id = 'sg-fabricated'; });
    rejects('provenance', (copy) => { copy.provenance = 'fabricated'; });
  });
});
