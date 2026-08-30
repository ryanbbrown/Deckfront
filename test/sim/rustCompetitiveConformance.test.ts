import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALWAYS_AVAILABLE_ACTION_IDS, CARDS, registerKingdom, resetKingdoms } from '../../src/game';
import { strategySearchKingdom } from '../../src/sim/strategySearchKingdoms';
import type { CompetitiveBlock } from '../../src/sim/nativeCompetitiveProtocol';
import { createOrderedCandidateSpace, orderedGoldfishCardIds,
  representativeCandidateIndices } from '../../src/sim/orderedGoldfishBenchmark';
import { playPairingScoreOnly } from '../../src/sim/pairing';
import { RustGoldfishScorer } from '../../src/sim/rustGoldfishScorer';
import { runSimulationMatch, runSimulationMatchScoreOnly } from '../../src/sim/simulationKernel';
import { INFINITE_COUNT, fixedBuyPlan, identify } from '../../src/sim/strategy';

const kingdom = strategySearchKingdom('balance-tuning-003');
const binary = process.env.HEXDECK_GOLDFISH_BIN
  ?? path.resolve('rust/target/release/hexdeck-goldfish');
const config = { kingdomId: kingdom.id, turnLimitPerPlayer: 30,
  actionCapPerTurn: 200, startingDraftEnabled: false } as const;

beforeEach(() => registerKingdom(kingdom));
afterEach(() => resetKingdoms());

describe.skipIf(!fs.existsSync(binary))('Rust competitive scorer conformance', () => {
  it('matches exact per-match outcomes and deterministic block bytes', async () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const strategies = [...representativeCandidateIndices(space.candidateCount, 8)]
      .map((index) => space.candidateAt(index));
    const blocks: CompetitiveBlock[] = Array.from({ length: 2048 }, (_unused, index) => ({
      candidateIndex: index % strategies.length,
      opponentIndex: (index * 5 + 3) % strategies.length,
      seed: (4_700_000 + index * 7919) >>> 0
    }));
    const rust = new RustGoldfishScorer(4);
    try {
      const loadId = await rust.loadCompetitive(kingdom, strategies, config, 4);
      for (const block of blocks.slice(0, 32)) {
        for (const firstPlayer of ['ochre', 'indigo'] as const) {
          const expected = runSimulationMatchScoreOnly({ ...config, seed: block.seed, firstPlayerId: firstPlayer,
            swapSides: false, strategies: { ochre: strategies[block.candidateIndex]!,
              indigo: strategies[block.opponentIndex]! } });
          expect(await rust.fixtureCompetitive(loadId, block, firstPlayer),
            `${block.candidateIndex}:${block.opponentIndex}:${block.seed}:${firstPlayer}`).toEqual(expected);
        }
      }
      const expected = blocks.map((block) => playPairingScoreOnly(
        strategies[block.candidateIndex]!, strategies[block.opponentIndex]!, {
          kingdomId: kingdom.id, seeds: [block.seed], turnLimitPerPlayer: 30,
          actionCapPerTurn: 200, startingDraftEnabled: false
        }));
      const actual = await rust.scoreCompetitive(loadId, blocks);
      expect(actual).toEqual({
        scoreBytes: Uint8Array.from(expected.map((outcome) => outcome.scoreBytes[0]!)),
        played: Uint8Array.from(expected.map((outcome) => outcome.played[0]!)),
        aborts: []
      });
    } finally {
      await rust.close();
    }
  }, 60_000);

  it('matches every card mechanic when the TypeScript game executes that card', async () => {
    const always = new Set<string>(ALWAYS_AVAILABLE_ACTION_IDS);
    const cardIds = Object.values(CARDS).filter((card) => card.type === 'action'
      && card.id !== 'scrap' && !always.has(card.id)).map((card) => card.id);
    const mechanicsKingdom = { id: 'native-competitive-all-mechanics', name: 'Native competitive all mechanics',
      startingHealth: 50, actionPiles: cardIds.map((cardId) => ({ cardId, count: 10 })) };
    registerKingdom(mechanicsKingdom);
    const strategies = cardIds.map((cardId) => identify({ id: '', startingBuild: [],
      buyPlan: fixedBuyPlan(cardId === 'leyStep'
        ? [{ kind: 'buy', cardId, desiredCount: 2 }, { kind: 'buy', cardId: 'longshot', desiredCount: 2 }]
        : cardId === 'feint'
          ? [{ kind: 'buy', cardId: 'step', desiredCount: 2 },
            { kind: 'buy', cardId: 'strike', desiredCount: 2 }, { kind: 'buy', cardId, desiredCount: 2 }]
          : cardId === 'aim'
            ? [{ kind: 'buy', cardId, desiredCount: 2 },
              { kind: 'buy', cardId: 'precisionShot', desiredCount: 2 }]
            : cardId === 'starfire'
              ? [{ kind: 'buy', cardId: 'silver', desiredCount: 1 },
                { kind: 'buy', cardId, desiredCount: 1 }, { kind: 'buy', cardId: 'focus', desiredCount: 5 }]
              : ['arcBolt', 'fireball', 'cascade'].includes(cardId)
                ? [{ kind: 'buy', cardId: 'focus', desiredCount: 2 }, { kind: 'buy', cardId, desiredCount: 1 }]
                : cardId === 'regiment'
                  ? [{ kind: 'buy', cardId: 'step', desiredCount: 2 },
                    { kind: 'buy', cardId: 'silver', desiredCount: 2 },
                    { kind: 'buy', cardId: 'gold', desiredCount: 2 },
                    { kind: 'buy', cardId, desiredCount: 1 }]
                  : CARDS[cardId]!.family === 'melee'
                  ? [{ kind: 'buy', cardId: 'step', desiredCount: 2 },
                    { kind: 'buy', cardId, desiredCount: 2 },
                    { kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }]
                  : [{ kind: 'buy', cardId, desiredCount: 2 },
                    { kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }]) }));
    const opponent = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([]) });
    const table = [...strategies, opponent];
    const heldConfig = { kingdomId: mechanicsKingdom.id, turnLimitPerPlayer: 60,
      actionCapPerTurn: 200, startingDraftEnabled: false } as const;
    const fixtures: Array<{ block: CompetitiveBlock; firstPlayer: 'ochre' | 'indigo' }> = [];
    const missing: string[] = [];
    for (let strategyIndex = 0; strategyIndex < strategies.length; strategyIndex += 1) {
      let selected: { seed: number; firstPlayer: 'ochre' | 'indigo' } | null = null;
      for (let seed = 91; seed < 111 && !selected; seed += 1) {
        for (const firstPlayer of ['ochre', 'indigo'] as const) {
          const result = runSimulationMatch({ ...heldConfig, seed, firstPlayerId: firstPlayer, swapSides: false,
            strategies: { ochre: strategies[strategyIndex]!, indigo: opponent } });
          if (result.telemetry.playsByCard.ochre[cardIds[strategyIndex]!]! > 0) {
            selected = { seed, firstPlayer };
            break;
          }
        }
      }
      if (!selected) missing.push(cardIds[strategyIndex]!);
      else fixtures.push({ block: { candidateIndex: strategyIndex, opponentIndex: table.length - 1,
        seed: selected.seed }, firstPlayer: selected.firstPlayer });
    }
    expect(missing).toEqual([]);
    const rust = new RustGoldfishScorer(4);
    try {
      const loadId = await rust.loadCompetitive(mechanicsKingdom, table, heldConfig, 4);
      for (const fixture of fixtures) {
        const expected = runSimulationMatchScoreOnly({ ...heldConfig, seed: fixture.block.seed,
          firstPlayerId: fixture.firstPlayer, swapSides: false,
          strategies: { ochre: table[fixture.block.candidateIndex]!, indigo: opponent } });
        expect(await rust.fixtureCompetitive(loadId, fixture.block, fixture.firstPlayer),
          cardIds[fixture.block.candidateIndex]).toEqual(expected);
      }
    } finally {
      await rust.close();
    }
  }, 60_000);

  it('matches persistent mana when Focus funds later-turn Starfire plays', async () => {
    const manaKingdom = { id: 'native-persistent-mana', name: 'Native persistent mana', startingHealth: 30,
      actionPiles: [{ cardId: 'starfire', count: 10 }] };
    registerKingdom(manaKingdom);
    const mage = identify({ id: '', startingBuild: ['focus', 'focus', 'focus'],
      buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'starfire', desiredCount: INFINITE_COUNT }]) });
    const passive = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([]) });
    const strategies = [mage, passive];
    const heldConfig = { kingdomId: manaKingdom.id, turnLimitPerPlayer: 20,
      actionCapPerTurn: 200, startingDraftEnabled: true } as const;
    const rust = new RustGoldfishScorer(1);
    let starfirePlays = 0;
    try {
      const loadId = await rust.loadCompetitive(manaKingdom, strategies, heldConfig, 1);
      for (const seed of [3, 11, 29]) {
        const expected = runSimulationMatch({ ...heldConfig, seed, firstPlayerId: 'ochre', swapSides: false,
          strategies: { ochre: mage, indigo: passive } });
        starfirePlays += expected.telemetry.playsByCard.ochre.starfire ?? 0;
        expect(await rust.fixtureCompetitive(loadId, { candidateIndex: 0, opponentIndex: 1, seed }, 'ochre'))
          .toEqual({ outcome: expected.outcome, reason: expected.reason, turns: expected.turns });
      }
      expect(starfirePlays).toBeGreaterThan(0);
    } finally {
      await rust.close();
    }
  });

  it('matches action-cap and turn-limit boundaries in both orientations', async () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const strategies = [...representativeCandidateIndices(space.candidateCount, 2)]
      .map((index) => space.candidateAt(index));
    for (const boundary of [
      { ...config, turnLimitPerPlayer: 1 },
      { ...config, actionCapPerTurn: 1 }
    ]) {
      const rust = new RustGoldfishScorer(1);
      try {
        const loadId = await rust.loadCompetitive(kingdom, strategies, boundary, 1);
        const block = { candidateIndex: 0, opponentIndex: 1, seed: 91 };
        for (const firstPlayer of ['ochre', 'indigo'] as const) {
          expect(await rust.fixtureCompetitive(loadId, block, firstPlayer)).toEqual(
            runSimulationMatchScoreOnly({ ...boundary, seed: block.seed, firstPlayerId: firstPlayer,
              swapSides: false, strategies: { ochre: strategies[0]!, indigo: strategies[1]! } }));
        }
      } finally {
        await rust.close();
      }
    }
  });
});
