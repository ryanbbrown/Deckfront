import { describe, expect, it } from 'vitest';
import { strategySearchKingdom } from '../../src/sim/strategySearchKingdoms';
import { emptyAggregate } from '../../src/sim/pairing';
import type { PairingOutcome } from '../../src/sim/pairing';
import {
  appendNestedMatrixOutcome, createNestedMatrixEvidence, nestedMatrixSnapshot, nestedMatrixWork,
  validateNestedMatrixEvidence
} from '../../src/sim/nestedPayoffMatrix';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';

const left = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'drive', desiredCount: 1 }]) });
const right = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'volley', desiredCount: 1 }]) });
function outcome(seeds: number[]): PairingOutcome {
  const telemetry = emptyAggregate();
  for (const first of ['firstOchre', 'firstIndigo'] as const) {
    telemetry.byOrientation[first].normal.played = seeds.length;
    telemetry.byOrientation[first].normal.draws = seeds.length;
  }
  return { record: { played: seeds.length * 2, wins: seeds.length * 2, draws: 0, losses: seeds.length * 2, aborted: 0 },
    candidateScore: seeds.length * 2, opponentScore: seeds.length * 2, telemetry,
    matches: seeds.length * 2, seedsEvaluated: seeds.length, stopReason: 'maximum', candidateMean: 0.5,
    opponentMean: 0.5, blocks: seeds.map((seed) => ({ seed, score: 0.5, played: 2, aborted: 0 })), aborts: [] };
}

describe('nested payoff matrix evidence', () => {
  it('reuses exact 25-block batches in 50- and 100-block snapshots', () => {
    strategySearchKingdom('balance-tuning-003');
    let matrix = createNestedMatrixEvidence({ version: 'ordered-reservoir-full-nested-matrix-v2',
      kingdomId: 'balance-tuning-003', seeds: Array.from({ length: 200 }, (_unused, index) => index + 1),
      turnLimitPerPlayer: 30, actionCapPerTurn: 200, startingDraftEnabled: false }, [left, right]);
    for (const work of nestedMatrixWork(matrix, 50)) matrix = appendNestedMatrixOutcome(matrix, work, outcome(work.seeds));
    expect(validateNestedMatrixEvidence(matrix)).toBe(true);
    expect(nestedMatrixSnapshot(matrix, 50).cells[0]!.blocks).toHaveLength(50);
    for (const work of nestedMatrixWork(matrix, 100)) matrix = appendNestedMatrixOutcome(matrix, work, outcome(work.seeds));
    expect(nestedMatrixSnapshot(matrix, 100).cells[0]!.blocks.slice(0, 50))
      .toEqual(nestedMatrixSnapshot(matrix, 50).cells[0]!.blocks);
    const stale = structuredClone(matrix); stale.cells[0]!.batches[0]!.blocks[0]!.score = 0.75;
    expect(validateNestedMatrixEvidence(stale)).toBe(false);
  });
});
