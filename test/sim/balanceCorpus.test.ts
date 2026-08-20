import { describe, expect, it } from 'vitest';
import {
  buildBalanceCorpusModel, buildStrategyGroups, classifyStrategyDamage, renderBalanceCorpus,
  selectCorpusKingdoms
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
      multipleViableRate: 0, damageStrategyCounts: { 'No damage package': 80 },
      drawRate: 0, winnerTurnsPerPlayer: 8 });
    expect(model.summaries.validation).toMatchObject({ kingdoms: 20, lotteryDistribution: { 2: 20 },
      effectiveMinimum: 2, effectiveMedian: 2, effectiveMean: 2, effectiveMaximum: 2,
      multipleViableRate: 1, damageStrategyCounts: { Ranged: 40 },
      winnerTurnsPerPlayer: 10 });
    expect(model.summaries.combined).toMatchObject({ kingdoms: 100, effectiveMedian: 1,
      effectiveMean: 1.2, multipleViableRate: 0.2,
      damageStrategyCounts: { 'No damage package': 80, Ranged: 40 },
      winnerTurnsPerPlayer: 8.4 });
    expect(model.summaries.tuning.firstPlayerScore).toBeCloseTo(0.6, 12);
    expect(model.summaries.validation!.drawRate).toBeCloseTo(0.1, 12);
    expect(model.summaries.validation!.firstPlayerScore).toBeCloseTo(0.4, 12);
    expect(model.summaries.combined.drawRate).toBeCloseTo(0.02, 12);
    expect(model.summaries.combined.firstPlayerScore).toBeCloseTo(0.56, 12);
    const footwork = model.cards.find((card) => card.cardId === 'footwork')!;
    const volley = model.cards.find((card) => card.cardId === 'volley')!;
    expect(footwork.tuning).toMatchObject({ buildPlans: 80, repeatPlans: 80,
      acquiredStrategies: 80, familyAcquisitionShare: 1 });
    expect(volley.validation).toMatchObject({ buildPlans: 40, repeatPlans: 40,
      acquiredStrategies: 40, familyAcquisitionShare: 1 });
  });

  it('classifies strategy damage from its starting deck and evaluated acquisitions', () => {
    expect(classifyStrategyDamage({ startingBuild: ['drive'], acquisitionRates: { drive: 2, footwork: 3 } }))
      .toBe('Melee');
    expect(classifyStrategyDamage({ startingBuild: ['focus'], acquisitionRates: { arcBolt: 2, channel: 4 } }))
      .toBe('Mage');
    expect(classifyStrategyDamage({ startingBuild: ['steadyShot'], acquisitionRates: { steadyShot: 3, drive: 1 } }))
      .toBe('Melee + Ranged');
    expect(classifyStrategyDamage({ startingBuild: ['footwork'], acquisitionRates: { footwork: 5 } }))
      .toBe('No damage package');
  });

  it('calculates card use separately inside each strategy type', () => {
    const reports = corpus();
    const tuning = reports.filter((entry) => entry.split === 'tuning');
    tuning[0]!.strategies[0] = { ...tuning[0]!.strategies[0]!, startingBuild: ['drive'],
      acquisitionRates: { drive: 2, footwork: 1 }, acquiredCards: ['drive', 'footwork'] };
    const groups = buildStrategyGroups(buildBalanceCorpusModel(BALANCE_SUITE_MANIFEST, tuning));
    const melee = groups.find((group) => group.label === 'Melee')!;
    expect(melee).toMatchObject({ strategies: 1, share: 1 / 80 });
    expect(melee.cards.find((card) => card.cardId === 'drive')).toMatchObject({
      acquiredStrategies: 1, averageCopiesWhenAcquired: 2, buildPlans: 1
    });
    expect(melee.cards.find((card) => card.cardId === 'footwork')).toMatchObject({
      acquiredStrategies: 1, averageCopiesWhenAcquired: 1
    });
  });

  it('shows co-use only among strategies offered both cards', () => {
    const tuning = corpus().filter((entry) => entry.split === 'tuning');
    const definitions = BALANCE_SUITE_MANIFEST.kingdoms.filter((entry) => entry.split === 'tuning'
      && ['drive', 'heavyBlow'].every((cardId) => entry.actionPiles.some((pile) => pile.cardId === cardId)));
    expect(definitions.length).toBeGreaterThanOrEqual(2);
    const first = tuning.find((entry) => entry.id === definitions[0]!.id)!;
    first.strategies[0] = { ...first.strategies[0]!, startingBuild: ['drive'], repeatPurchase: 'drive',
      acquisitionRates: { drive: 2, heavyBlow: 1 } };
    const second = tuning.find((entry) => entry.id === definitions[1]!.id)!;
    second.strategies[0] = { ...second.strategies[0]!, startingBuild: ['drive'], repeatPurchase: 'drive',
      acquisitionRates: { drive: 2 } };
    const melee = buildStrategyGroups(buildBalanceCorpusModel(BALANCE_SUITE_MANIFEST, tuning))
      .find((group) => group.label === 'Melee')!;
    const pair = melee.pairs.find((entry) => new Set([entry.firstCardId, entry.secondCardId]).has('drive')
      && new Set([entry.firstCardId, entry.secondCardId]).has('heavyBlow'))!;
    expect(pair).toMatchObject({ offeredTogether: 2, acquiredTogether: 1, firstOnly: 1,
      secondOnly: 0, neither: 0 });
    expect(renderBalanceCorpus(buildBalanceCorpusModel(BALANCE_SUITE_MANIFEST, tuning)))
      .toContain('When defining cards were offered together');
  });

  it('renders the complete tuning split without stale validation results', () => {
    const tuning = corpus().filter((entry) => entry.split === 'tuning');
    const rangedDefinition = BALANCE_SUITE_MANIFEST.kingdoms.find((entry) => entry.split === 'tuning'
      && entry.actionPiles.some((pile) => pile.cardId === 'volley'))!;
    const ranged = tuning.find((entry) => entry.id === rangedDefinition.id)!;
    ranged.strategies[0] = { ...ranged.strategies[0]!, startingBuild: ['volley'], repeatPurchase: 'volley',
      families: ['Ranged'], acquiredCards: ['volley'], acquisitionRates: { volley: 1 } };
    const model = buildBalanceCorpusModel(BALANCE_SUITE_MANIFEST, tuning);
    expect(model.scope).toBe('tuning');
    expect(model.summaries.validation).toBeNull();
    expect(model.summaries.combined.kingdoms).toBe(80);
    const html = renderBalanceCorpus(model);
    expect(html).toContain('Eighty-kingdom tuning report');
    expect(html).toContain('Balance at a glance');
    expect(html).toContain('Strategy types');
    expect(html).toContain('No damage package strategies');
    expect(html).toContain('Ranged strategies');
    expect(html).toContain('Cards that define this strategy type');
    expect(html).toContain('Does this strategy type depend on a card?');
    expect(html).toContain('Used when offered');
    expect(html).toContain('Copies when used');
    expect(html).toContain('Movement, drawing, money, and other support');
    expect(html).not.toContain('This is an incomplete historical card pool');
    expect(html).toContain('All 80 kingdoms');
    expect(html).toContain('The held-back validation kingdoms were not run');
    expect(html).not.toContain('<td>Validation</td><td>20</td>');
  });

  it('selects five unique kingdoms with stable id tie breaks', () => {
    const input = [
      kingdom('a', 'tuning', 1, 0.5), kingdom('b', 'tuning', 1, 0.5),
      kingdom('c', 'tuning', 5, 1), kingdom('d', 'tuning', 4, 0),
      kingdom('e', 'tuning', 3, 0.4), kingdom('f', 'tuning', 2, 0.6),
      kingdom('g', 'tuning', 2.5, 0.3, 1, 0.75), kingdom('h', 'tuning', 2.5, 0.3, 1, 0.75)
    ];
    const selected = selectCorpusKingdoms(input);
    expect(selected.map((entry) => entry.kingdom.id)).toEqual(['a', 'c', 'b', 'd', 'g']);
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
    expect(first).toContain('Kingdom diversity');
    expect(first).toContain('All 100 kingdoms');
    expect(first).toContain('Five selected kingdom details');
    expect(first).not.toMatch(/rigged|calibration/iu);
  });
});
