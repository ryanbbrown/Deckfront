import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { strategySearchKingdom } from '../../src/sim/strategySearchKingdoms';
import { evaluateCandidates, mixtureSchedule } from '../../src/sim/mixtureEvaluation';
import { createOrderedCandidateSpace, orderedGoldfishCardIds,
  representativeCandidateIndices } from '../../src/sim/orderedGoldfishBenchmark';
import { InlinePairingRunner } from '../../src/sim/pairingRunner';
import { RustCompetitiveEvaluator } from '../../src/sim/rustCompetitiveEvaluator';
import { RustGoldfishScorer } from '../../src/sim/rustGoldfishScorer';

const kingdom = strategySearchKingdom('balance-tuning-003');
const binary = process.env.HEXDECK_GOLDFISH_BIN
  ?? path.resolve('rust/target/release/hexdeck-goldfish');

beforeEach(() => registerKingdom(kingdom));
afterEach(() => resetKingdoms());

describe.skipIf(!fs.existsSync(binary))('the resident Rust competitive evaluator', () => {
  it('matches TypeScript rows and preserves candidate and schedule order', async () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const strategies = [...representativeCandidateIndices(space.candidateCount, 8)]
      .map((index) => space.candidateAt(index));
    const opponents = new Map(strategies.slice(0, 3).map((strategy) => [strategy.id, strategy]));
    const weights = Object.fromEntries([...opponents.keys()].map((id, index) => [id, index + 1]));
    const schedule = mixtureSchedule(weights,
      Array.from({ length: 32 }, (_unused, index) => 5_100_000 + index), 7001);
    const options = { kingdomId: kingdom.id, turnLimitPerPlayer: 30,
      actionCapPerTurn: 200, startingDraftEnabled: false, scoreOnly: true } as const;
    const scorer = new RustGoldfishScorer(4);
    const runner = new InlinePairingRunner();
    try {
      const evaluator = await RustCompetitiveEvaluator.create(scorer, kingdom, strategies, options, 4);
      const expected = await evaluateCandidates(strategies, opponents, schedule, runner, options);
      const actual = await evaluator.evaluate(strategies, opponents, schedule, runner, options);
      expect(actual).toEqual(expected);
    } finally {
      await Promise.all([scorer.close(), runner.close()]);
    }
  }, 30_000);
});
