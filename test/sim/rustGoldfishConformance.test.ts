import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALWAYS_AVAILABLE_ACTION_IDS, CARDS, FIRST_PLAYER_HEALTH_PENALTY, registerKingdom, resetKingdoms
} from '../../src/game';
import { scoreMovementAwareGoldfishStrategyLean } from '../../src/sim/goldfish';
import { strategySearchKingdom } from '../../src/sim/strategySearchKingdoms';
import { createOrderedCandidateSpace, orderedGoldfishCardIds,
  representativeCandidateIndices } from '../../src/sim/orderedGoldfishBenchmark';
import { nativeScoreBatchRequest } from '../../src/sim/nativeGoldfishProtocol';
import { RustGoldfishScorer } from '../../src/sim/rustGoldfishScorer';
import { runGoldfishTrial } from '../../src/sim/simulationKernel';
import { INFINITE_COUNT, fixedBuyPlan, identify, stableHash } from '../../src/sim/strategy';
import { compareUtf16 } from '../../src/sim/utf16';

const kingdom = strategySearchKingdom('balance-tuning-003');

beforeEach(() => registerKingdom(kingdom));
afterEach(() => resetKingdoms());

const nativeBinary = process.env.HEXDECK_GOLDFISH_BIN
  ?? path.resolve('rust/target/release/hexdeck-goldfish');

it('carries strategy and first-player constants in the native scoring contract', () => {
  const strategy = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([]) });
  const request = nativeScoreBatchRequest(kingdom, [strategy], { kingdomId: kingdom.id, seeds: [1],
    turnLimit: 1, actionCapPerTurn: 1 }, 1, 'compact');
  expect(request.payload.infiniteCount).toBe(INFINITE_COUNT);
  expect(request.payload.firstPlayerHealthPenalty).toBe(FIRST_PLAYER_HEALTH_PENALTY);
});

describe.skipIf(!fs.existsSync(nativeBinary))('Rust goldfish scorer conformance', () => {
  it('matches shuffle, UTF-16 comparison, and stable hashing through the process protocol', async () => {
    const scorer = new RustGoldfishScorer(1);
    try {
      let state = 11;
      const deck = Array.from({ length: 10 }, (_unused, index) => index);
      for (let index = deck.length - 1; index > 0; index -= 1) {
        state = (1664525 * state + 1013904223) >>> 0;
        const swap = Math.floor(state / 0x100000000 * (index + 1));
        [deck[index], deck[swap]] = [deck[swap]!, deck[index]!];
      }
      expect(await scorer.shuffle(11, Array.from({ length: 10 }, (_unused, index) => index))).toEqual(deck);
      expect(await scorer.stableHash('native-😀')).toBe(stableHash('native-😀'));
      for (const [left, right] of [['a', 'A'], ['x😀', 'x￿'], ['same', 'same']]) {
        expect(Math.sign(await scorer.compareUtf16(left!, right!))).toBe(Math.sign(compareUtf16(left!, right!)));
      }
    } finally { await scorer.close(); }
  });

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

  it.each([
    'balance-tuning-003',
    'balance-tuning-004',
    'balance-tuning-005',
    'balance-tuning-006'
  ])('matches the four-seed ordered product evidence for %s', async (kingdomId) => {
    const selectedKingdom = strategySearchKingdom(kingdomId);
    registerKingdom(selectedKingdom);
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
    const strategies = [...representativeCandidateIndices(space.candidateCount, 32)]
      .map((index) => space.candidateAt(index));
    const config = { kingdomId, seeds: [4_100_000, 4_100_001, 4_100_002, 4_100_003],
      turnLimit: 30, actionCapPerTurn: 200 };
    const rust = new RustGoldfishScorer(2);
    try {
      expect(await rust.score(selectedKingdom, strategies, config, 2, 'full')).toEqual(
        strategies.map((strategy) => scoreMovementAwareGoldfishStrategyLean(strategy, config, 'full')));
    } finally { await rust.close(); }
  }, 60_000);

  it('matches disjoint multi-seed aggregation', async () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const strategies = [...representativeCandidateIndices(space.candidateCount, 12)]
      .map((index) => space.candidateAt(index));
    const config = { kingdomId: kingdom.id, seeds: [4_100_000, 4_100_001, 4_100_002],
      turnLimit: 12, actionCapPerTurn: 80 };
    const rust = new RustGoldfishScorer(2);
    try {
      expect(await rust.score(kingdom, strategies, config, 2, 'full')).toEqual(
        strategies.map((strategy) => scoreMovementAwareGoldfishStrategyLean(strategy, config, 'full')));
    } finally { await rust.close(); }
  }, 30_000);

  it('matches victory, turn-limit, and action-cap damage padding', async () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const strategy = space.candidateAt([...representativeCandidateIndices(space.candidateCount, 1)][0]!);
    const ignoredBuild = identify({ ...strategy, id: '', startingBuild: ['precisionShot'],
      buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'precisionShot', desiredCount: INFINITE_COUNT }]) });
    const configs = [
      { kingdomId: kingdom.id, seeds: [4_100_000], turnLimit: 30, actionCapPerTurn: 200 },
      { kingdomId: kingdom.id, seeds: [4_100_000], turnLimit: 1, actionCapPerTurn: 200 },
      { kingdomId: kingdom.id, seeds: [4_100_000], turnLimit: 30, actionCapPerTurn: 1 },
      { kingdomId: kingdom.id, seeds: [4_100_000], turnLimit: 60, actionCapPerTurn: 200 }
    ];
    const rust = new RustGoldfishScorer(1);
    try {
      for (const config of configs) {
        const candidates = [strategy, ignoredBuild];
        expect(await rust.score(kingdom, candidates, config, 1, 'full'))
          .toEqual(candidates.map((candidate) =>
            scoreMovementAwareGoldfishStrategyLean(candidate, config, 'full')));
      }
      expect(runGoldfishTrial({ ...configs[1]!, seed: configs[1]!.seeds[0]!,
        strategy: ignoredBuild }).reason).toBe('turnLimit');
      expect(runGoldfishTrial({ ...configs[2]!, seed: configs[2]!.seeds[0]!,
        strategy: ignoredBuild }).reason).toBe('actionCap');
      expect(runGoldfishTrial({ ...configs[3]!, seed: configs[3]!.seeds[0]!,
        strategy: ignoredBuild }).reason).toBe('victory');
    } finally { await rust.close(); }
  });

  it('matches every card mechanic in one all-mechanics kingdom', async () => {
    const always = new Set<string>(ALWAYS_AVAILABLE_ACTION_IDS);
    const cardIds = Object.values(CARDS).filter((card) => card.type === 'action'
      && card.id !== 'scrap' && !always.has(card.id)).map((card) => card.id);
    const mechanicsKingdom = { id: 'native-all-mechanics', name: 'Native all mechanics', startingHealth: 50,
      actionPiles: cardIds.map((cardId) => ({ cardId, count: 10 })) };
    registerKingdom(mechanicsKingdom);
    const strategies = cardIds.map((cardId) => identify({ id: '', startingBuild: [],
      buyPlan: fixedBuyPlan(cardId === 'flurry'
        ? [{ kind: 'buy', cardId: 'footwork', desiredCount: 1 }, { kind: 'buy', cardId, desiredCount: 2 }]
        : cardId === 'leyStep'
          ? [{ kind: 'buy', cardId, desiredCount: 2 },
          { kind: 'buy', cardId: 'longshot', desiredCount: 2 }]
        : cardId === 'feint'
          ? [{ kind: 'buy', cardId: 'strike', desiredCount: 2 }, { kind: 'buy', cardId, desiredCount: 2 }]
          : cardId === 'aim'
            ? [{ kind: 'buy', cardId, desiredCount: 2 },
              { kind: 'buy', cardId: 'precisionShot', desiredCount: 2 }]
            : cardId === 'starfire'
              ? [{ kind: 'buy', cardId: 'silver', desiredCount: 1 },
                { kind: 'buy', cardId, desiredCount: 1 }, { kind: 'buy', cardId: 'focus', desiredCount: 5 }]
              : ['arcBolt', 'fireball', 'cascade'].includes(cardId)
                ? [{ kind: 'buy', cardId: 'focus', desiredCount: 2 },
                  { kind: 'buy', cardId, desiredCount: 1 }]
              : cardId === 'regiment'
                ? [{ kind: 'buy', cardId: 'silver', desiredCount: 2 },
                  { kind: 'buy', cardId: 'gold', desiredCount: 2 }, { kind: 'buy', cardId, desiredCount: 1 }]
                : [{ kind: 'buy', cardId, desiredCount: 2 },
                  { kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }]) }));
    const mechanicsNotPurchased: string[] = [];
    const mechanicsNotExecuted: string[] = [];
    for (const [index, strategy] of strategies.entries()) {
      const cardId = cardIds[index]!;
      let purchased = false, executed = false;
      for (let seed = 91; seed < 111 && !executed; seed += 1) {
        const trial = runGoldfishTrial({ kingdomId: mechanicsKingdom.id, seed, strategy,
          turnLimit: 60, actionCapPerTurn: 200,
          movementProfile: CARDS[cardId]!.family === 'melee' ? 'chaser' : 'stationary' });
        purchased ||= Boolean(trial.purchasesByCard[cardId]);
        executed ||= Boolean(trial.playsByCard[cardId]);
      }
      if (!purchased) mechanicsNotPurchased.push(cardId);
      if (!executed) mechanicsNotExecuted.push(cardId);
    }
    expect({ mechanicsNotPurchased, mechanicsNotExecuted }).toEqual({
      mechanicsNotPurchased: [], mechanicsNotExecuted: []
    });
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
