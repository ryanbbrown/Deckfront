import { describe, expect, it } from 'vitest';
import {
  buildStrategyReportModel, renderStrategyReport
} from '../../scripts/generate_strategy_report';
import type {
  StrategyReportInput, StrategyReportStrategyInput
} from '../../scripts/generate_strategy_report';

const cards: StrategyReportInput['cards'] = [
  { id: 'a', name: 'Melee A', family: 'Melee', cost: 3, text: 'A.', alwaysAvailable: false },
  { id: 'b', name: 'Melee B', family: 'Melee', cost: 4, text: 'B.', alwaysAvailable: false },
  { id: 'm1', name: 'Mage A', family: 'Mage', cost: 3, text: 'M1.', alwaysAvailable: false },
  { id: 'm2', name: 'Mage B', family: 'Mage', cost: 4, text: 'M2.', alwaysAvailable: false },
  { id: 'r1', name: 'Ranged A', family: 'Ranged', cost: 3, text: 'R1.', alwaysAvailable: false },
  { id: 'r2', name: 'Ranged B', family: 'Ranged', cost: 4, text: 'R2.', alwaysAvailable: false },
  { id: 'e', name: 'Engine', family: 'Engine', cost: 2, text: 'E.', alwaysAvailable: true }
];

function strategy(
  id: string, options: Partial<StrategyReportStrategyInput> = {}
): StrategyReportStrategyInput {
  return { id, status: 'Lottery', weight: 1, score: 0.5, damageType: 'Melee',
    startingBuild: [], acquisitionRates: {}, ...options };
}

describe('strategy distribution report', () => {
  it('uses only final-lottery equilibrium weights for strategy types and global card use', () => {
    const model = buildStrategyReportModel({ suiteVersion: 'test', cards, kingdoms: [
      { id: 'one', availableCardIds: ['a', 'b', 'm1', 'm2', 'r1', 'r2', 'e'], strategies: [
        strategy('heavy', { weight: 0.75, startingBuild: ['a'], damageType: 'Melee' }),
        strategy('light', { weight: 0.25, damageType: 'Mage + Melee' }),
        strategy('non-lottery', { status: '40% viable', weight: 100, startingBuild: ['a'], damageType: 'Ranged' })
      ] },
      { id: 'two', availableCardIds: ['a', 'b', 'm1', 'm2', 'r1', 'r2', 'e'], strategies: [
        strategy('second-kingdom', { weight: 7, damageType: 'Mage + Ranged' })
      ] }
    ] });

    expect(model.eligibleStrategies).toBe(3);
    expect(model.strategyTypes).toEqual([
      { label: 'Mage + Ranged', share: 0.5, kingdoms: 1 },
      { label: 'Melee', share: 0.375, kingdoms: 1 },
      { label: 'Mage + Melee', share: 0.125, kingdoms: 1 }
    ]);
    expect(model.cardSelection.find((card) => card.cardId === 'a')).toMatchObject({
      eligibleKingdoms: 2, selectionRate: 0.375, startingRate: 0.375
    });
  });

  it('counts starting cards and actual acquisitions but not planned-only cards', () => {
    const model = buildStrategyReportModel({ suiteVersion: 'test', cards, kingdoms: [
      { id: 'one', availableCardIds: ['a', 'b', 'm1', 'm2', 'r1', 'r2', 'e'], strategies: [
        strategy('plan', { startingBuild: ['a'], acquisitionRates: { b: 0.25 },
          buyPlan: [{ cardId: 'e' }] })
      ] }
    ] });
    const measures = Object.fromEntries(model.cardSelection.map((card) => [card.cardId, card]));

    expect(measures.a).toMatchObject({ selectionRate: 1, startingRate: 1, acquisitionRate: 0, meanOwnedCopies: 1 });
    expect(measures.b).toMatchObject({ selectionRate: 1, startingRate: 0, acquisitionRate: 1, meanOwnedCopies: 0.25 });
    expect(measures.e).toMatchObject({ selectionRate: 0, startingRate: 0, acquisitionRate: 0, meanOwnedCopies: 0 });
  });

  it('builds each map from exact pure-family lotteries and only that family’s cards', () => {
    const model = buildStrategyReportModel({ suiteVersion: 'test', cards, kingdoms: [
      { id: 'pure', availableCardIds: ['a', 'b', 'm1', 'm2', 'r1', 'r2'], strategies: [
        strategy('pure-melee', { startingBuild: ['a', 'b'], damageType: 'Melee' }),
        strategy('mixed', { weight: 100, startingBuild: ['a'], damageType: 'Mage + Melee' }),
        strategy('near-pure', { status: 'Near 50%', weight: 100, startingBuild: ['b'], damageType: 'Melee' })
      ] }
    ] });
    const families = new Map(model.familyRelationships.map((entry) => [entry.family, entry]));

    expect(families.get('Mage')!.cardIds).toEqual(['m1', 'm2']);
    expect(families.get('Melee')!.cardIds).toEqual(['a', 'b']);
    expect(families.get('Ranged')!.cardIds).toEqual(['r1', 'r2']);
    expect(families.get('Melee')!.eligibleKingdoms).toBe(1);
    expect(families.get('Melee')!.cards).toEqual([
      { cardId: 'a', offeredSelectionRate: 1, overallSelectionRate: 1, offeredKingdoms: 1 },
      { cardId: 'b', offeredSelectionRate: 1, overallSelectionRate: 1, offeredKingdoms: 1 }
    ]);
    expect(families.get('Melee')!.pairs).toEqual([{
      firstCardId: 'a', secondCardId: 'b', both: 1, firstOnly: 0, secondOnly: 0,
      neither: 0, eligibleKingdoms: 1
    }]);
    expect(families.get('Mage')!.eligibleKingdoms).toBe(0);
    expect(families.get('Mage')!.cards).toEqual([
      { cardId: 'm1', offeredSelectionRate: 0, overallSelectionRate: 0, offeredKingdoms: 0 },
      { cardId: 'm2', offeredSelectionRate: 0, overallSelectionRate: 0, offeredKingdoms: 0 }
    ]);
    expect(families.get('Mage')!.pairs[0]?.eligibleKingdoms).toBe(0);
  });

  it('normalizes family weights within each kingdom, weights kingdoms equally, and requires both cards to be offered', () => {
    const model = buildStrategyReportModel({ suiteVersion: 'test', cards, kingdoms: [
      { id: 'weighted', availableCardIds: ['a', 'b'], strategies: [
        strategy('a-heavy', { weight: 9, startingBuild: ['a'] }),
        strategy('b-light', { weight: 1, startingBuild: ['b'] })
      ] },
      { id: 'equal-kingdom', availableCardIds: ['a', 'b'], strategies: [
        strategy('b-only', { weight: 50, startingBuild: ['b'] })
      ] },
      { id: 'not-offered-together', availableCardIds: ['a'], strategies: [
        strategy('would-use-a', { weight: 1, startingBuild: ['a'] })
      ] },
      { id: 'mixed-only', availableCardIds: ['a', 'b'], strategies: [
        strategy('mixed', { weight: 1, startingBuild: ['a', 'b'], damageType: 'Mage + Melee' })
      ] },
      { id: 'other-family', availableCardIds: ['a', 'b'], strategies: [
        strategy('ranged', { weight: 1, startingBuild: ['a', 'b'], damageType: 'Ranged' })
      ] }
    ] });
    const melee = model.familyRelationships.find((entry) => entry.family === 'Melee')!;
    const pair = melee.pairs[0];

    expect(melee.eligibleKingdoms).toBe(3);
    expect(melee.cards.find((card) => card.cardId === 'b')).toEqual({
      cardId: 'b', offeredSelectionRate: 0.55, overallSelectionRate: 1.1 / 3, offeredKingdoms: 2
    });
    expect(pair).toEqual({ firstCardId: 'a', secondCardId: 'b', both: 0, firstOnly: 0.45,
      secondOnly: 0.55, neither: 0, eligibleKingdoms: 2 });
  });

  it('counts pure-family coverage once per kingdom at cumulative competitive thresholds', () => {
    const model = buildStrategyReportModel({ suiteVersion: 'test', cards, kingdoms: [
      { id: 'one', availableCardIds: [], strategies: [
        strategy('mage-lottery', { damageType: 'Mage' }),
        strategy('mage-duplicate', { status: '40% viable', damageType: 'Mage', score: 0.49 }),
        strategy('melee-48', { status: '40% viable', damageType: 'Melee', score: 0.48 }),
        strategy('mixed-high', { status: '40% viable', damageType: 'Mage + Melee', score: 1 })
      ] },
      { id: 'two', availableCardIds: [], strategies: [
        strategy('mage-45', { status: '40% viable', damageType: 'Mage', score: 0.45 }),
        strategy('ranged-lottery', { damageType: 'Ranged' })
      ] },
      { id: 'three', availableCardIds: [], strategies: [
        strategy('melee-40', { status: '40% viable', damageType: 'Melee', score: 0.4 }),
        strategy('ranged-between', { status: '40% viable', damageType: 'Ranged', score: 0.479 })
      ] },
      { id: 'four', availableCardIds: [], strategies: [] }
    ] }).competitiveDepth;

    expect(model.families).toEqual([
      { family: 'Mage', counts: { lottery: 1, atLeast48: 1, atLeast45: 2, atLeast40: 2 } },
      { family: 'Melee', counts: { lottery: 0, atLeast48: 1, atLeast45: 1, atLeast40: 2 } },
      { family: 'Ranged', counts: { lottery: 1, atLeast48: 1, atLeast45: 2, atLeast40: 2 } }
    ]);
    expect(model.familyCounts).toEqual([
      { familyCount: 0, counts: { lottery: 2, atLeast48: 2, atLeast45: 1, atLeast40: 1 } },
      { familyCount: 1, counts: { lottery: 2, atLeast48: 1, atLeast45: 1, atLeast40: 0 } },
      { familyCount: 2, counts: { lottery: 0, atLeast48: 1, atLeast45: 2, atLeast40: 3 } },
      { familyCount: 3, counts: { lottery: 0, atLeast48: 0, atLeast45: 0, atLeast40: 0 } },
      { familyCount: '2 or 3', counts: { lottery: 0, atLeast48: 1, atLeast45: 2, atLeast40: 3 } }
    ]);
  });

  it('renders the fixed sections in order without obsolete controls or global analyses', () => {
    const html = renderStrategyReport(buildStrategyReportModel({ suiteVersion: 'test', cards, kingdoms: [
      { id: 'one', availableCardIds: ['a', 'b', 'm1', 'm2', 'r1', 'r2', 'e'], strategies: [strategy('one')] }
    ] }));

    const types = html.indexOf('<section id="strategy-types">');
    const depth = html.indexOf('<section id="competitive-depth">');
    const relationships = html.indexOf('<section id="family-relationships">');
    const cardUse = html.indexOf('<section id="card-use">');
    expect(types).toBeGreaterThan(-1);
    expect(types).toBeLessThan(depth);
    expect(depth).toBeLessThan(relationships);
    expect(relationships).toBeLessThan(cardUse);
    expect(html.match(/class="family-panel"/g)).toHaveLength(3);
    expect(html).toContain("K = '+pair.eligibleKingdoms+' eligible kingdoms");
    expect(html.match(/<h4>Card usage<\/h4>/g)).toHaveLength(3);
    expect(html).toContain('Usage when offered');
    expect(html).toContain('Overall Melee usage');
    expect(html).toContain('counts unavailable cards as unused');
    expect(html).toContain("pct(selection.offeredSelectionRate)+'</strong><br>used when offered");
    expect(html).toContain("if(colIndex>rowIndex){html+='<td class=\"empty\"></td>'");
    expect(html).toContain("<strong>Both '+pct(pair.both)");
    expect(html).toContain("Row only '+pct(pair.firstOnly)");
    expect(html).toContain("Column only '+pct(pair.secondOnly)");
    expect(html).toContain("Neither '+pct(pair.neither)");
    expect(html).toContain('The denominator is K eligible kingdoms, not a raw strategy count.');
    expect(html).not.toContain('relationship score');
    expect(html).toContain('including mixed strategies');
    expect(html).not.toContain('data-weight');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Most often together');
    expect(html).not.toContain('emergence-section');
  });
});
