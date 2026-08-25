import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALWAYS_AVAILABLE_ACTION_IDS, CARDS, registerKingdom, resetKingdoms } from '../../src/game';
import { scoreMovementAwareGoldfishStrategyLean } from '../../src/sim/goldfish';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { createOrderedCandidateSpace, orderedGoldfishCardIds,
  representativeCandidateIndices } from '../../src/sim/orderedGoldfishBenchmark';
import { RustGoldfishScorer } from '../../src/sim/rustGoldfishScorer';
import { INFINITE_COUNT, fixedBuyPlan, identify } from '../../src/sim/strategy';

const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;

beforeEach(() => registerKingdom(kingdom));
afterEach(() => resetKingdoms());

describe('Rust goldfish scorer conformance', () => {
  it('matches full lean fields and compact ranking keys on ordered candidates', async () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const positions = [...representativeCandidateIndices(space.candidateCount, 1000)];
    const strategies = positions.map((index) => space.candidateAt(index));
    const config = { kingdomId: kingdom.id, seeds: [4_100_000], turnLimit: 30, actionCapPerTurn: 200 };
    const rust = new RustGoldfishScorer(4);
    try {
      const full = await rust.score(kingdom, strategies, config, 4, 'full');
      const typescript = strategies.map((strategy) =>
        scoreMovementAwareGoldfishStrategyLean(strategy, config, 'full'));
      for (let index = 0; index < full.length; index += 1) {
        expect(full[index], `candidate ${index} ${strategies[index]!.id}`).toEqual(typescript[index]);
      }
      const compact = await rust.score(kingdom, strategies, config, 4, 'compact');
      expect(compact.map((entry) => ({ ...entry, strategy: undefined }))).toEqual(
        strategies.map((strategy) => ({ ...scoreMovementAwareGoldfishStrategyLean(strategy, config),
          strategy: undefined })));
    } finally { await rust.close(); }
  }, 60_000);

  it('matches victory, turn-limit, and action-cap damage padding', async () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const strategy = space.candidateAt([...representativeCandidateIndices(space.candidateCount, 1)][0]!);
    const configs = [
      { kingdomId: kingdom.id, seeds: [4_100_000], turnLimit: 30, actionCapPerTurn: 200 },
      { kingdomId: kingdom.id, seeds: [4_100_000], turnLimit: 1, actionCapPerTurn: 200 },
      { kingdomId: kingdom.id, seeds: [4_100_000], turnLimit: 30, actionCapPerTurn: 1 }
    ];
    const rust = new RustGoldfishScorer(1);
    try {
      for (const config of configs) {
        expect((await rust.score(kingdom, [strategy], config, 1, 'full'))[0])
          .toEqual(scoreMovementAwareGoldfishStrategyLean(strategy, config, 'full'));
      }
    } finally { await rust.close(); }
  });

  it('matches every card mechanic in one all-mechanics kingdom', async () => {
    const always = new Set<string>(ALWAYS_AVAILABLE_ACTION_IDS);
    const cardIds = Object.values(CARDS).filter((card) => card.type === 'action'
      && card.id !== 'scrap' && !always.has(card.id)).map((card) => card.id);
    const mechanicsKingdom = { id: 'native-all-mechanics', name: 'Native all mechanics', startingHealth: 50,
      actionPiles: cardIds.map((cardId) => ({ cardId, count: 10 })) };
    registerKingdom(mechanicsKingdom);
    const strategies = cardIds.map((cardId) => identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
      { kind: 'buy', cardId, desiredCount: 2 },
      { kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }
    ]) }));
    const config = { kingdomId: mechanicsKingdom.id, seeds: [91], turnLimit: 10, actionCapPerTurn: 200 };
    const rust = new RustGoldfishScorer(4);
    try {
      const native = await rust.score(mechanicsKingdom, strategies, config, 4, 'full');
      const typescript = strategies.map((strategy) =>
        scoreMovementAwareGoldfishStrategyLean(strategy, config, 'full'));
      for (let index = 0; index < native.length; index += 1) {
        expect(native[index], cardIds[index]).toEqual(typescript[index]);
      }
    } finally { await rust.close(); }
  }, 60_000);
});
