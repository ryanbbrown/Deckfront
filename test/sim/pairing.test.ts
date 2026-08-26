import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../src/sim/types';
import type { SimulationMatchConfig } from '../../src/sim/simulationKernel';
import {
  GAMES_PER_SEED, SIGN_TEST_THRESHOLD, exactSignTest, isSignificantSignTest,
  playPairing, shouldStopPairing
} from '../../src/sim/pairing';
import type { PairingMatchRunner } from '../../src/sim/pairing';
import { diagnosticStrategies } from '../../src/sim/baselines';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';

type CandidateResult = 'win' | 'loss' | 'draw' | 'abort';

function scripted(results: readonly CandidateResult[]): PairingMatchRunner {
  let call = 0;
  return ((config: SimulationMatchConfig): MatchResult => {
    const result = results[Math.floor(call / GAMES_PER_SEED)] ?? 'draw';
    call += 1;
    const outcome = result === 'win' ? 'ochre'
      : result === 'loss' ? 'indigo'
        : result === 'abort' ? 'aborted' : 'draw';
    return {
      config: {
        kingdomId: config.kingdomId, seed: config.seed, firstPlayerId: config.firstPlayerId,
        swapSides: config.swapSides, turnLimitPerPlayer: config.turnLimitPerPlayer,
        actionCapPerTurn: config.actionCapPerTurn, startingDraftEnabled: config.startingDraftEnabled ?? true,
        agentIds: { ochre: config.strategies.ochre.id, indigo: config.strategies.indigo.id }
      },
      outcome,
      reason: result === 'abort' ? 'actionSearchOverflow' : result === 'draw' ? 'turnLimit' : 'victory',
      turns: 1,
      telemetry: {
        turnsToWin: result === 'win' || result === 'loss' ? 1 : null,
        eventCount: 0,
        damageByCard: { ochre: {}, indigo: {} }, playsByCard: { ochre: {}, indigo: {} },
        purchasesByCard: { ochre: {}, indigo: {} }, startingBuild: { ochre: [], indigo: [] },
        deadDraws: {
          ochre: { range: 0, mana: 0, setup: 0, total: 0 },
          indigo: { range: 0, mana: 0, setup: 0, total: 0 }
        },
        moneySpent: { ochre: 0, indigo: 0 }, unspentMoney: { ochre: 0, indigo: 0 },
        finalHealth: { ochre: 20, indigo: 20 }
      }
    };
  }) as PairingMatchRunner;
}

function outcome(seedCount: number, blocks: readonly CandidateResult[]) {
  const [candidate, opponent] = diagnosticStrategies('current-duel');
  return playPairing(candidate!, opponent!, {
    kingdomId: 'current-duel', seeds: Array.from({ length: seedCount }, (_, index) => index + 1),
    turnLimitPerPlayer: 30, actionCapPerTurn: 200, allowEarlyStop: true
  }, scripted(blocks));
}

describe('the pairing protocol', () => {
  it('uses one shuffle seed for exactly two fixed-seat games and alternates the first strategy', () => {
    const [strategyA, strategyB] = diagnosticStrategies('current-duel');
    const configs: SimulationMatchConfig[] = [];
    const runner = scripted(['draw']);
    const result = playPairing(strategyA!, strategyB!, {
      kingdomId: 'current-duel', seeds: [123456789], turnLimitPerPlayer: 30, actionCapPerTurn: 200
    }, (config) => { configs.push(config); return runner(config); });

    expect(result.matches).toBe(2);
    expect(configs.map((config) => ({
      seed: config.seed, firstPlayerId: config.firstPlayerId, swapSides: config.swapSides,
      ochre: config.strategies.ochre.id, indigo: config.strategies.indigo.id
    }))).toEqual([
      { seed: 123456789, firstPlayerId: 'ochre', swapSides: false,
        ochre: strategyA!.id, indigo: strategyB!.id },
      { seed: 123456789, firstPlayerId: 'indigo', swapSides: false,
        ochre: strategyA!.id, indigo: strategyB!.id }
    ]);
  });
});

describe('the sequential sign-test rule', () => {
  it('crosses the exact clean-sweep boundary at 12 non-tied blocks', () => {
    expect(exactSignTest(11, 0)).toBe(0.0009765625);
    expect(exactSignTest(12, 0)).toBe(0.00048828125);
    expect(shouldStopPairing(4, 25, 12, 0)).toBe(false);
    expect(shouldStopPairing(5, 25, 5, 0)).toBe(false);
    expect(shouldStopPairing(12, 25, 12, 0)).toBe(true);
  });

  it('treats equality with the declared threshold as significant', () => {
    expect(isSignificantSignTest(SIGN_TEST_THRESHOLD)).toBe(true);
    expect(isSignificantSignTest(SIGN_TEST_THRESHOLD + Number.EPSILON)).toBe(false);
  });

  it.each([1, 5, 8, 24, 25])('runs all %i tied shuffle seeds to the maximum', (seedCount) => {
    const result = outcome(seedCount, Array<CandidateResult>(seedCount).fill('draw'));
    expect(result.stopReason).toBe('maximum');
    expect(result.seedsEvaluated).toBe(seedCount);
    expect(result.matches).toBe(seedCount * GAMES_PER_SEED);
    expect(result.record.draws).toBe(seedCount * GAMES_PER_SEED);
  });

  it('stops a clean sweep only after the complete twelfth seed evaluation', () => {
    const result = outcome(25, Array<CandidateResult>(25).fill('win'));
    expect(result.stopReason).toBe('significant');
    expect(result.seedsEvaluated).toBe(12);
    expect(result.matches).toBe(24);
    expect(result.record.wins).toBe(24);
  });

  it('propagates draft-off mode to both games', () => {
    const [candidate, opponent] = diagnosticStrategies('current-duel');
    const modes: boolean[] = [];
    const runner: PairingMatchRunner = (config) => {
      modes.push(config.startingDraftEnabled ?? true);
      return scripted(['draw'])(config);
    };
    playPairing(candidate!, opponent!, {
      kingdomId: 'current-duel', seeds: [1], turnLimitPerPlayer: 30,
      actionCapPerTurn: 200, startingDraftEnabled: false
    }, runner);
    expect(modes).toEqual([false, false]);
  });

  it('disables early stopping for screens, confirmations, and final top-ups', () => {
    const [candidate, opponent] = diagnosticStrategies('current-duel');
    const result = playPairing(candidate!, opponent!, {
      kingdomId: 'current-duel', seeds: Array.from({ length: 25 }, (_, index) => index + 1),
      turnLimitPerPlayer: 30, actionCapPerTurn: 200, allowEarlyStop: false
    }, scripted(Array<CandidateResult>(25).fill('win')));
    expect(result.seedsEvaluated).toBe(25);
    expect(result.blocks).toHaveLength(25);
  });

  it('removes tied seed evaluations from the sign-test sample and stops at the first abort', () => {
    const blocks: CandidateResult[] = [
      ...Array<CandidateResult>(11).fill('win'),
      ...Array<CandidateResult>(12).fill('draw'),
      'abort', 'win'
    ];
    const result = outcome(25, blocks);
    expect(result.stopReason).toBe('maximum');
    expect(result.seedsEvaluated).toBe(24);
    expect(result.matches).toBe(47);
    expect(result.record.aborted).toBe(1);
  });

  it('gives a fully aborted pairing no mean', () => {
    const result = outcome(8, Array<CandidateResult>(8).fill('abort'));
    expect(result).toMatchObject({
      stopReason: 'maximum', seedsEvaluated: 1, matches: 1, candidateMean: null, opponentMean: null
    });
    expect(result.record).toMatchObject({ played: 0, aborted: 1 });
  });
});

describe('the production seed gate', () => {
  it('executes every fixed-seed round-robin evaluation without aborts', { timeout: 120_000 }, () => {
    let games = 0;
    for (const kingdomId of CURATED_KINGDOM_IDS) {
      const strategies = diagnosticStrategies(kingdomId);
      expect(strategies).toHaveLength(5);
      expect(new Set(strategies.map((entry) => entry.id)).size).toBe(5);
      for (let left = 0; left < strategies.length; left += 1) {
        for (let right = left + 1; right < strategies.length; right += 1) {
          const result = playPairing(strategies[left]!, strategies[right]!, {
            kingdomId, seeds: [17], turnLimitPerPlayer: 30, actionCapPerTurn: 200
          });
          expect(result.record.played, `${kingdomId}/${left}/${right}`).toBe(GAMES_PER_SEED);
          expect(result.record.aborted, `${kingdomId}/${left}/${right}`).toBe(0);
          expect(result.telemetry.turnsToWin.count, `${kingdomId}/${left}/${right}`)
            .toBe(GAMES_PER_SEED - result.record.draws);
          games += result.matches;
        }
      }
    }
    expect(games).toBe(80);
  });
});
