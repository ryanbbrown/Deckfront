import { describe, expect, it } from 'vitest';
import { emptyAggregate } from '../../src/sim/pairing';
import {
  collapseAcquisitionEquivalentAdmissions, createOrderedFullPsroCheckpoint, decideConfirmationLook,
  initialFullPsroState, orderedFullPsroSeeds, selectFullScreenCandidates, transitionFullPsroState,
  validateOrderedFullPsroCheckpoint, validateOrderedFullPsroSeedPlan
} from '../../src/sim/orderedReservoirFullPsro';
import type { FullScreenCandidate, ShadowEquivalentClass } from '../../src/sim/orderedReservoirFullPsro';
import type { FullCandidateEvidence } from '../../src/sim/lotteryAcquisition';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';

function row(index: number, score = 1 - index / 1_000): FullScreenCandidate {
  return { goldfishRank: index + 51, strategyId: `s-${String(index).padStart(4, '0')}`,
    canonicalStrategy: `canonical-${index}`, laneA: Array(25).fill(score), laneB: Array(25).fill(score) };
}
function strategy(id: string) {
  return { ...identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: 'drive', desiredCount: 1 }
  ]) }), id };
}
function evidence(id: string, position = '0'): FullCandidateEvidence {
  const held = strategy(id), telemetry = emptyAggregate();
  telemetry.acquisitionsByStrategy[id] = { drive: 4 };
  telemetry.planPositionPurchasesByStrategy![id] = { [position]: 4 };
  return { strategy: held, blocks: [{ seed: 1, opponentId: 'target', score: 0.75, matches: 4, telemetry }] };
}

describe('full ordered-reservoir PSRO protocol', () => {
  it('uses collision-free namespaces and rejects a third run', () => {
    expect(validateOrderedFullPsroSeedPlan('fa94c2084739ef')).toBe(true);
    expect(() => orderedFullPsroSeeds('fa94c2084739ef', 3 as 1, 'matrix', 200)).toThrow();
  });

  it('advances wide complete score tiers and fails instead of truncating oversized ties', () => {
    const rows = Array.from({ length: 300 }, (_unused, index) => row(index));
    for (let index = 90; index <= 110; index += 1) rows[index]!.laneA = Array(25).fill(rows[99]!.laneA[0]);
    const selected = selectFullScreenCandidates(rows);
    expect(rows.slice(90, 111).every((entry) => selected.laneATierIds.includes(entry.strategyId))).toBe(true);
    expect(selected.strategyIds.length).toBeGreaterThan(200);
    expect(() => selectFullScreenCandidates(Array.from({ length: 600 }, (_unused, index) => row(index, 0.5))))
      .toThrow('screen-width-unresolved');
  });

  it('uses retirement first, Holm admission, and unresolved final decisions', () => {
    const decisions = decideConfirmationLook([
      { strategyId: 'loser', blockScores: Array(200).fill(0) },
      { strategyId: 'winner', blockScores: Array(200).fill(1) }
    ]);
    expect(decisions.find((entry) => entry.strategyId === 'loser')!.decision).toBe('retired');
    expect(decisions.find((entry) => entry.strategyId === 'winner')!.decision).toBe('admitted');
    expect(decideConfirmationLook([{ strategyId: 'flat', blockScores: Array(6_400).fill(0.505) }], true)[0]!.decision)
      .toMatch(/retired|unresolved/);
  });

  it('collapses complete acquisition equivalents and separates a diverged shadow', () => {
    const first = evidence('a'), second = evidence('b');
    const collapsed = collapseAcquisitionEquivalentAdmissions({ admitted: [first, second],
      existingShadows: [], anchorEvidence: new Map() });
    expect(collapsed.representatives.map((entry) => entry.strategy.id)).toEqual(['a']);
    expect(collapsed.shadows[0]!.shadowIds).toEqual(['b']);
    const existing: ShadowEquivalentClass[] = collapsed.shadows;
    const diverged = collapseAcquisitionEquivalentAdmissions({ admitted: [evidence('b', '1')],
      existingShadows: existing, anchorEvidence: new Map([['a', evidence('a')]]) });
    expect(diverged.divergedShadowIds).toEqual(['b']);
    expect(diverged.representatives[0]!.strategy.id).toBe('b');
  });

  it('forces 100 blocks, two clean scans, and validates hashed checkpoints', () => {
    let state = initialFullPsroState();
    state = transitionFullPsroState(state, { representativeAdmissions: 0, unresolved: 0 });
    expect(state.matrixDepth).toBe(100);
    state = transitionFullPsroState(state, { representativeAdmissions: 0, unresolved: 0 });
    state = transitionFullPsroState(state, { representativeAdmissions: 0, unresolved: 0, precisionStable: true });
    expect(state.status).toBe('complete');
    const checkpoint = createOrderedFullPsroCheckpoint({ run: 1, kingdomId: 'deep-beam-tuning-009',
      rulesFingerprint: 'abcdef1234', reservoirHash: 'abcdef1234', poolHash: 'pool',
      sourceRankedSha256: 'a'.repeat(64), state, activeStrategyIds: ['a'], shadowClasses: [],
      matrixEvidenceHash: 'matrix', scanEvidenceHashes: ['scan-1', 'scan-2', 'scan-3'],
      panelEvidenceHashes: [], elapsedMs: 10 });
    expect(validateOrderedFullPsroCheckpoint(checkpoint)).toBe(true);
    const changed = structuredClone(checkpoint); changed.activeStrategyIds.push('b');
    expect(validateOrderedFullPsroCheckpoint(changed)).toBe(false);
  });
});
