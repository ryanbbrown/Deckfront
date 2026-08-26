import { describe, expect, it } from 'vitest';
import { emptyAggregate } from '../../src/sim/pairing';
import {
  collapseAcquisitionEquivalentAdmissions, createOrderedFullPsroCheckpoint, decideConfirmationLook,
  initialFullPsroState, orderedFullPsroSeeds, selectFullScreenCandidates, shadowAnchorSyntheticId,
  transitionFullPsroState, validateOrderedFullPsroCheckpoint, validateOrderedFullPsroCheckpointIdentity,
  validateOrderedFullPsroResumeChain,
  validateOrderedFullPsroSeedPlan
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
function evidence(id: string, position = '0', blocks = 1): FullCandidateEvidence {
  const held = strategy(id);
  return { strategy: held, blocks: Array.from({ length: blocks }, (_unused, index) => {
    const telemetry = emptyAggregate();
    telemetry.acquisitionsByStrategy[id] = { drive: 4 };
    telemetry.planPositionPurchasesByStrategy![id] = { [position]: 4 };
    return { seed: index + 1, opponentId: 'target', score: 0.75, matches: 2 as const, telemetry };
  }) };
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

  it('retains equivalent shadow self-play when the anchor uses a separate synthetic candidate ID', () => {
    const collapsed = collapseAcquisitionEquivalentAdmissions({ evidence: [evidence('a'), evidence('b')],
      admittedIds: new Set(['a', 'b']), existingShadows: [], anchorEvidence: new Map() });
    expect(collapsed.representatives.map((entry) => entry.strategy.id)).toEqual(['a']);
    expect(collapsed.shadows[0]!.shadowIds).toEqual(['b']);
    const shadow = evidence('b', '0', 200); shadow.blocks.forEach((block) => {
      block.opponentId = 'a'; block.telemetry.acquisitionsByStrategy.a = { volley: 2 };
      block.telemetry.planPositionPurchasesByStrategy!.a = { '0': 2 };
    });
    const syntheticId = shadowAnchorSyntheticId({ run: 1, scan: 1, representativeId: 'a', blocks: 200 });
    const anchor = evidence(syntheticId, '0', 200); anchor.strategy = strategy('a'); anchor.candidateTelemetryId = syntheticId;
    anchor.blocks.forEach((block) => {
      block.opponentId = 'a'; block.telemetry.acquisitionsByStrategy.a = { volley: 2 };
      block.telemetry.planPositionPurchasesByStrategy!.a = { '0': 2 };
    });
    const retained = collapseAcquisitionEquivalentAdmissions({ evidence: [shadow], admittedIds: new Set(),
      existingShadows: collapsed.shadows, anchorEvidence: new Map([['a:200', anchor]]) });
    expect(retained.retainedShadowIds).toEqual(['b']);
    expect(retained.divergedShadowIds).toEqual([]);
  });

  it('splits a diverged retired shadow without adding it to the matrix', () => {
    const existing: ShadowEquivalentClass[] = [{ evidenceKey: 'old', representativeId: 'a',
      activeRepresentativeId: 'a', memberIds: ['a', 'b'], shadowIds: ['b'] }];
    const retired = collapseAcquisitionEquivalentAdmissions({ evidence: [evidence('b', '1')], admittedIds: new Set(),
      existingShadows: existing, anchorEvidence: new Map([['a:1', evidence('a')]]) });
    expect(retired.divergedShadowIds).toEqual(['b']);
    expect(retired.representatives).toEqual([]);
  });

  it('splits a diverged admitted shadow and adds its new representative', () => {
    const existing: ShadowEquivalentClass[] = [{ evidenceKey: 'old', representativeId: 'a',
      activeRepresentativeId: 'a', memberIds: ['a', 'b'], shadowIds: ['b'] }];
    const admitted = collapseAcquisitionEquivalentAdmissions({ evidence: [evidence('b', '1')], admittedIds: new Set(['b']),
      existingShadows: existing, anchorEvidence: new Map([['a:1', evidence('a')]]) });
    expect(admitted.divergedShadowIds).toEqual(['b']);
    expect(admitted.representatives[0]!.strategy.id).toBe('b');
  });

  it('forces 100 blocks, two clean scans, and rejects stale checkpoint identity', () => {
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
      panelEvidenceHashes: [], auditEvidenceHashes: [], terminalEvidenceHash: null, elapsedMs: 10 });
    expect(validateOrderedFullPsroCheckpoint(checkpoint)).toBe(true);
    const identity = { run: 1 as const, kingdomId: 'deep-beam-tuning-009' as const,
      rulesFingerprint: 'abcdef1234', reservoirHash: 'abcdef1234', poolHash: 'pool',
      sourceRankedSha256: 'a'.repeat(64) };
    expect(validateOrderedFullPsroCheckpointIdentity(checkpoint, identity)).toBe(true);
    expect(validateOrderedFullPsroCheckpointIdentity(checkpoint,
      { ...identity, rulesFingerprint: 'wrong-rule' })).toBe(false);
    expect(validateOrderedFullPsroCheckpointIdentity(checkpoint,
      { ...identity, sourceRankedSha256: 'b'.repeat(64) })).toBe(false);
    const changed = structuredClone(checkpoint); changed.activeStrategyIds.push('b');
    expect(validateOrderedFullPsroCheckpoint(changed)).toBe(false);
  });

  it('accepts a complete end-to-end resume chain and rejects corrupt or stale children', () => {
    const states = [initialFullPsroState()];
    states.push(transitionFullPsroState(states[0]!, { representativeAdmissions: 0, unresolved: 0 }));
    states.push(transitionFullPsroState(states[1]!, { representativeAdmissions: 0, unresolved: 0 }));
    states.push(transitionFullPsroState(states[2]!, {
      representativeAdmissions: 0, unresolved: 0, precisionStable: true }));
    const checkpoint = createOrderedFullPsroCheckpoint({ run: 1, kingdomId: 'deep-beam-tuning-009',
      rulesFingerprint: 'abcdef1234', reservoirHash: 'abcdef1234', poolHash: 'pool',
      sourceRankedSha256: 'a'.repeat(64), state: states[3]!, activeStrategyIds: ['a'], shadowClasses: [],
      matrixEvidenceHash: 'matrix', scanEvidenceHashes: ['scan-1', 'scan-2', 'scan-3'],
      panelEvidenceHashes: [], auditEvidenceHashes: [], terminalEvidenceHash: null, elapsedMs: 10 });
    const transitions = [0, 1, 2].map((index) => ({ scan: index,
      summaryHash: `scan-${index + 1}`, childHashes: [`child-${index + 1}`],
      stateBefore: states[index]!, stateAfter: states[index + 1]!,
      activeStrategyIdsBefore: ['a'], activeStrategyIdsAfter: ['a'],
      shadowClassesBefore: [], shadowClassesAfter: [] }));
    expect(validateOrderedFullPsroResumeChain({ checkpoint, initialActiveStrategyIds: ['a'], transitions })).toBe(true);
    const corrupt = structuredClone(transitions); corrupt[1]!.childHashes = ['child-1'];
    expect(validateOrderedFullPsroResumeChain({ checkpoint, initialActiveStrategyIds: ['a'], transitions: corrupt })).toBe(false);
    const stale = structuredClone(transitions); stale[2]!.stateBefore = { ...stale[2]!.stateBefore, matrixDepth: 50 };
    expect(validateOrderedFullPsroResumeChain({ checkpoint, initialActiveStrategyIds: ['a'], transitions: stale })).toBe(false);
  });
});
