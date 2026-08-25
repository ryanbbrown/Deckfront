import { describe, expect, it } from 'vitest';
import type { EquilibriumResult } from '../../src/sim/equilibrium';
import { emptyAggregate } from '../../src/sim/pairing';
import {
  acquisitionEquivalentClasses, completeAcquisitionEvidenceKey, stratifiedOpponentSchedule,
  summarizeLotteryAcquisitions
} from '../../src/sim/lotteryAcquisition';
import type { FullCandidateEvidence } from '../../src/sim/lotteryAcquisition';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';

const melee = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'drive', desiredCount: 1 }]) });
const ranged = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'volley', desiredCount: 1 }]) });
function evidence(strategy = melee, opponent = ranged, card = 'drive'): FullCandidateEvidence {
  const telemetry = emptyAggregate();
  telemetry.acquisitionsByStrategy[strategy.id] = { [card]: 4 };
  telemetry.planPositionPurchasesByStrategy![strategy.id] = { '0': 4 };
  return { strategy, blocks: [{ seed: 1, opponentId: opponent.id, score: 0.75, matches: 4, telemetry }] };
}
function equilibrium(): EquilibriumResult {
  return { strategyIds: [melee.id, ranged.id].sort(), weights: { [melee.id]: 0.5, [ranged.id]: 0.5 },
    maximumEquilibriumWeight: { [melee.id]: 0.5, [ranged.id]: 0.5 }, value: 0,
    maximumKnownAdvantage: 0, residuals: { nonnegative: 0, totalWeight: 0, value: 0, payoff: 0 } };
}

describe('lottery acquisition evidence', () => {
  it('collapses only identical complete product telemetry', () => {
    const same = structuredClone(evidence()); same.strategy = { ...same.strategy, id: 'shadow' };
    same.blocks[0]!.telemetry.acquisitionsByStrategy.shadow = same.blocks[0]!.telemetry.acquisitionsByStrategy[melee.id]!;
    delete same.blocks[0]!.telemetry.acquisitionsByStrategy[melee.id];
    same.blocks[0]!.telemetry.planPositionPurchasesByStrategy!.shadow =
      same.blocks[0]!.telemetry.planPositionPurchasesByStrategy![melee.id]!;
    delete same.blocks[0]!.telemetry.planPositionPurchasesByStrategy![melee.id];
    expect(completeAcquisitionEvidenceKey(same)).toBe(completeAcquisitionEvidenceKey(evidence()));
    expect(acquisitionEquivalentClasses([evidence(), same])[0]!.memberIds).toHaveLength(2);
    same.blocks[0]!.telemetry.planPositionPurchasesByStrategy!.shadow!['1'] = 1;
    expect(acquisitionEquivalentClasses([evidence(), same])).toHaveLength(2);
  });

  it('includes every self-play opponent and weights acquisitions by the lottery', () => {
    const schedule = stratifiedOpponentSchedule({ [melee.id]: 0.5, [ranged.id]: 0.5 },
      Array.from({ length: 100 }, (_unused, index) => index + 1), 25);
    expect(schedule.counts[melee.id]).toBe(50);
    expect(schedule.counts[ranged.id]).toBe(50);
    const meleeBlocks = [evidence(melee, melee, 'drive'), evidence(melee, ranged, 'drive')].flatMap((entry) => entry.blocks);
    const rangedBlocks = [evidence(ranged, melee, 'volley'), evidence(ranged, ranged, 'volley')].flatMap((entry) => entry.blocks);
    const summary = summarizeLotteryAcquisitions({ strategies: [melee, ranged],
      panels: [{ strategy: melee, blocks: meleeBlocks }, { strategy: ranged, blocks: rangedBlocks }],
      equilibrium: equilibrium(), centeredPayoffs: [[0, 0], [0, 0]] });
    expect(summary.expectedCopiesPerPlayerGame.drive).toBeCloseTo(0.375);
    expect(summary.expectedCopiesPerPlayerGame.volley).toBeCloseTo(0.375);
    expect(summary.selectedArchetypeShares).toMatchObject({ Melee: 0.5, Ranged: 0.5 });
  });
});
