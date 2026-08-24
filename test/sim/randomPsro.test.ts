import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SeededRandom, resetKingdoms } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { emptyAggregate } from '../../src/sim/pairing';
import type { PairingJob, PairingRunner } from '../../src/sim/pairingRunner';
import {
  RandomPsroSeedLedger, convergenceState, runRandomPsro, stoplessRandomDomain,
  validateRandomPsroArtifact
} from '../../src/sim/randomPsro';
import {
  inspectRandomPsroUnit, randomPsroArtifactPath, runRandomPsroBatch
} from '../../src/sim/randomPsroSuite';
import {
  loadKingdom001PriorLottery, renderRandomPsroConsistencyReport, weightedLotteryEvaluation
} from '../../src/sim/randomPsroReport';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../../src/sim/experimentConfig';
import { rulesFingerprint } from '../../src/sim/rulesFingerprint';
import { canonicalStrategy } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

class DrawRunner implements PairingRunner {
  async run(jobs: readonly PairingJob[]) {
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

const tinyConfig = {
  initialStrategies: 1, proposalCount: 2, raceBlocks: [1], finalists: 1,
  confirmationBlocks: 2, matrixBlocks: 1, safetyCap: 2, cleanBatchesRequired: 2,
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

function oldSource(file: string, ids: readonly string[]): void {
  const kingdomId = setup();
  const kingdom = deepBeamSuite.kingdoms[0]!;
  const domain = stoplessRandomDomain(kingdomId);
  const random = new SeededRandom(9);
  const targetMixture = ids.map((id) => ({ strategy: { ...domain.randomComplete(random), id }, weight: 1 / ids.length }));
  fs.writeFileSync(file, JSON.stringify({ kingdom,
    rulesFingerprint: rulesFingerprint(kingdomId, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false),
    config: { startingDraftEnabled: false, maxSlots: 8 }, targetMixture }));
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

  it('requires two consecutive clean batches and resets after admission', () => {
    expect(convergenceState(0, false)).toEqual({ cleanStreak: 1, converged: false });
    expect(convergenceState(1, true)).toEqual({ cleanStreak: 0, converged: false });
    expect(convergenceState(1, false)).toEqual({ cleanStreak: 2, converged: true });
  });
});

describe('random PSRO artifacts and resumability', () => {
  it('validates convergence and rejects stale or overlapping evidence', async () => {
    const artifact = await tinyArtifact();
    expect(artifact.status).toBe('converged');
    expect(artifact.rounds.map((round) => round.cleanBatch)).toEqual([true, true]);
    expect(validateRandomPsroArtifact(artifact, { kingdomId: artifact.kingdom.id, seed: 7,
      config: tinyConfig })).toMatchObject({ valid: true, converged: true });
    const stale = structuredClone(artifact); stale.rulesFingerprint.hash = 'stale';
    expect(validateRandomPsroArtifact(stale, { kingdomId: artifact.kingdom.id, seed: 7,
      config: tinyConfig }).valid).toBe(false);
    const overlap = structuredClone(artifact);
    const labels = Object.keys(overlap.seedNamespaces);
    overlap.seedNamespaces[labels[1]!]![0] = overlap.seedNamespaces[labels[0]!]![0]!;
    expect(validateRandomPsroArtifact(overlap, { kingdomId: artifact.kingdom.id, seed: 7,
      config: tinyConfig }).reason).toContain('overlap');
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

  it('rejects a wrong ordinary artifact instead of substituting the stratified source', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-random-source-'));
    const wrong = path.join(root, 'wrong.json');
    oldSource(wrong, ['sg-1e75552ec4', 'sg-7b4e9543a9']);
    expect(() => loadKingdom001PriorLottery(wrong, 'ordinary-mage')).toThrow('exact Mage-heavy ordinary');
    const ordinary = path.join(root, 'ordinary.json');
    oldSource(ordinary, ['sg-00060b43b5', 'sg-0033a454c1']);
    const loaded = loadKingdom001PriorLottery(ordinary, 'ordinary-mage');
    expect(loaded.strategies).toHaveLength(2);
    expect(loaded.strategies.map((entry) => canonicalStrategy(entry.strategy))).toHaveLength(2);
  });
});
