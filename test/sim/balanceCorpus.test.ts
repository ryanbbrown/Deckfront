import { describe, expect, it } from 'vitest';
import {
  buildBalanceCorpusModel, renderBalanceCorpus, selectCorpusKingdoms
} from '../../scripts/generate_balance_corpus';
import type { CorpusKingdomReport } from '../../scripts/generate_balance_corpus';
import { BALANCE_SUITE_MANIFEST } from '../../src/sim/balanceSuite';

function kingdom(
  id: string, split: 'tuning' | 'validation', effective: number, ranged: number,
  viable = split === 'validation' ? 2 : 1, drawRate = split === 'validation' ? 0.1 : 0
): CorpusKingdomReport {
  const strategies = Array.from({ length: viable }, (_, index) => ({
    id: `${id}-s${index}`, status: 'Lottery' as const, weight: 1 / viable, score: 0.5,
    startingBuild: [split === 'tuning' ? 'footwork' : 'volley'], purchaseSteps: [],
    repeatPurchase: split === 'tuning' ? 'footwork' : 'volley',
    families: [split === 'tuning' ? 'Engine' as const : 'Ranged' as const],
    acquiredCards: [split === 'tuning' ? 'footwork' : 'volley'],
    acquisitionRates: split === 'tuning' ? { footwork: 1 } : { volley: 1 }
  }));
  return { id, name: id, split, seed: 1, finishedAt: '2026-08-19T00:00:00.000Z', elapsedMs: 1000,
    matches: 100, stopReason: 'response-exhausted', discoveredStrategies: viable,
    matrixCells: viable * (viable - 1) / 2, rulesFingerprint: 'rules', turnLimitPerPlayer: 30,
    actionCapPerTurn: 200, materialCount: viable, nearCount: 0, effectiveLotterySize: effective,
    acquiredFamilyShares: { Engine: 1 - ranged, Melee: 0, Ranged: ranged, Mage: 0 }, strategies,
    matchupScores: strategies.map((_row, row) => strategies.map((_column, column) => row === column ? 0.5 : 0.6)),
    lotteryTelemetry: { games: 100, drawRate,
      firstPlayerWinRate: 0.5, firstPlayerScore: split === 'tuning' ? 0.6 : 0.4,
      winnerTurnsPerPlayer: split === 'tuning' ? 8 : 10, acquisitionsPerGame: {} } };
}

function corpus(): CorpusKingdomReport[] {
  return BALANCE_SUITE_MANIFEST.kingdoms.map((definition) => kingdom(definition.id, definition.split,
    definition.split === 'tuning' ? 1 : 2, definition.split === 'tuning' ? 0 : 1));
}

describe('balance-corpus aggregation', () => {
  it('keeps tuning, validation, and combined calculations separate', () => {
    const model = buildBalanceCorpusModel(BALANCE_SUITE_MANIFEST, corpus());
    expect(model.summaries.tuning).toMatchObject({ kingdoms: 80, lotteryDistribution: { 1: 80 },
      effectiveMinimum: 1, effectiveMedian: 1, effectiveMean: 1, effectiveMaximum: 1,
      multipleViableRate: 0, familyShares: { Engine: 1, Melee: 0, Ranged: 0, Mage: 0 },
      drawRate: 0, winnerTurnsPerPlayer: 8 });
    expect(model.summaries.validation).toMatchObject({ kingdoms: 20, lotteryDistribution: { 2: 20 },
      effectiveMinimum: 2, effectiveMedian: 2, effectiveMean: 2, effectiveMaximum: 2,
      multipleViableRate: 1, familyShares: { Engine: 0, Melee: 0, Ranged: 1, Mage: 0 },
      winnerTurnsPerPlayer: 10 });
    expect(model.summaries.combined).toMatchObject({ kingdoms: 100, effectiveMedian: 1,
      effectiveMean: 1.2, multipleViableRate: 0.2,
      familyShares: { Engine: 0.8, Melee: 0, Ranged: 0.2, Mage: 0 },
      winnerTurnsPerPlayer: 8.4 });
    expect(model.summaries.tuning.firstPlayerScore).toBeCloseTo(0.6, 12);
    expect(model.summaries.validation.drawRate).toBeCloseTo(0.1, 12);
    expect(model.summaries.validation.firstPlayerScore).toBeCloseTo(0.4, 12);
    expect(model.summaries.combined.drawRate).toBeCloseTo(0.02, 12);
    expect(model.summaries.combined.firstPlayerScore).toBeCloseTo(0.56, 12);
    const footwork = model.cards.find((card) => card.cardId === 'footwork')!;
    const volley = model.cards.find((card) => card.cardId === 'volley')!;
    expect(footwork.tuning).toMatchObject({ buildPlans: 80, repeatPlans: 80,
      acquiredStrategies: 80, familyAcquisitionShare: 1 });
    expect(volley.validation).toMatchObject({ buildPlans: 40, repeatPlans: 40,
      acquiredStrategies: 40, familyAcquisitionShare: 1 });
  });

  it('selects five unique kingdoms with stable id tie breaks', () => {
    const input = [
      kingdom('a', 'tuning', 1, 0.5), kingdom('b', 'tuning', 1, 0.5),
      kingdom('c', 'tuning', 5, 1), kingdom('d', 'tuning', 4, 0),
      kingdom('e', 'tuning', 3, 0.4), kingdom('f', 'tuning', 2, 0.6),
      kingdom('g', 'tuning', 2.5, 0.3, 1, 0.75), kingdom('h', 'tuning', 2.5, 0.3, 1, 0.75)
    ];
    const selected = selectCorpusKingdoms(input);
    expect(selected.map((entry) => entry.kingdom.id)).toEqual(['a', 'c', 'f', 'd', 'g']);
    expect(selected[4]!.reason).toBe('Highest draw rate');
    expect(new Set(selected.map((entry) => entry.kingdom.id)).size).toBe(5);
  });

  it('surfaces kingdoms whose final lottery draws at least half its games', () => {
    const reports = corpus();
    const warned = reports.find((entry) => entry.id === 'balance-tuning-005')!;
    warned.lotteryTelemetry.drawRate = 1;
    warned.materialCount = 15;
    warned.nearCount = 3;
    warned.strategies = Array.from({ length: 18 }, (_entry, index) => ({ ...warned.strategies[0]!, id: `draw-${index}` }));
    warned.matchupScores = warned.strategies.map((_row, row) =>
      warned.strategies.map((_column, column) => row === column ? 0.5 : 0));
    const model = buildBalanceCorpusModel(BALANCE_SUITE_MANIFEST, reports);
    expect(model.playQualityWarnings.map((entry) => entry.id)).toEqual(['balance-tuning-005']);
    const html = renderBalanceCorpus(model);
    expect(html).toContain('Play quality needs investigation');
    expect(html).toContain('balance-tuning-005');
    expect(html).toContain('<td>100.0%</td><td>15</td><td>3</td><td>18</td>');
    expect(html).toContain('stalled market');
    expect(html).toContain('search or shared pilot did not discover a working strategy');
  });

  it('renders deterministic required sections without calibration language', () => {
    const model = buildBalanceCorpusModel(BALANCE_SUITE_MANIFEST, corpus());
    const first = renderBalanceCorpus(model), second = renderBalanceCorpus(model);
    expect(first).toBe(second);
    expect(first).toContain('Strategy diversity and play diagnostics');
    expect(first).toContain('All 100 kingdoms');
    expect(first).toContain('Five selected kingdom details');
    expect(first).not.toMatch(/rigged|calibration/iu);
  });
});
