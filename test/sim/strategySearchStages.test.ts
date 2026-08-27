import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { diagnosticStrategies } from '../../src/sim/baselines';
import type { CandidateEvaluation } from '../../src/sim/mixtureEvaluation';
import { emptyAggregate } from '../../src/sim/pairing';
import { canonicalStrategy } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import {
  createCampaignPsroClosure, createCampaignStageControlMarker,
  campaignStageControlPath, campaignStageOutputRoot, validateCampaignPsroStage,
  validateCampaignStageControlMarker
} from '../../src/sim/strategySearchStages';
import {
  createThresholdRacingProtocol, runThresholdRace, thresholdRacingProtocolHash,
  weightedFairSchedule
} from '../../src/sim/thresholdRacingPsro';
import type { RawPsroLookArtifact, RawPsroScoreChunk } from '../../src/sim/thresholdRacingPsro';

const runner = { async run() { throw new Error('injected evaluator owns the fixture'); }, async close() {} };
function candidates() {
  return diagnosticStrategies('current-duel').slice(0, 2).map((strategy, index) => ({ strategy, identity: {
    goldfishRank: index + 51, strategyId: strategy.id, canonicalStrategy: canonicalStrategy(strategy)
  } }));
}
function evaluator(field: readonly Strategy[], _opponents: unknown,
  schedule: { blocks: Array<{ seed: number; opponentId: string }> }): Promise<CandidateEvaluation[]> {
  return Promise.resolve(field.map((strategy) => ({ strategy, mean: 0, interval: null,
    blockScores: schedule.blocks.map(() => 0), matches: schedule.blocks.length * 2,
    telemetry: emptyAggregate() })));
}

describe('campaign deep stage validators and external markers', () => {
  it('keeps control markers outside output roots and rejects malformed or extra fields', () => {
    expect(campaignStageOutputRoot('campaign/k/matrix')).toBe('campaign/k/matrix/output');
    expect(campaignStageControlPath('campaign/k/matrix', 'complete'))
      .toBe('campaign/k/matrix/control/complete.json');
    const marker = createCampaignStageControlMarker({ stage: 'matrix', stageId: 'a'.repeat(64),
      status: 'complete', artifactHashes: { 'output/manifest.json': 'b'.repeat(64) } });
    expect(validateCampaignStageControlMarker(marker)).toBe(true);
    expect(validateCampaignStageControlMarker({ ...marker, extra: true })).toBe(false);
    expect(() => createCampaignStageControlMarker({ stage: 'matrix', stageId: 'a'.repeat(64),
      status: 'complete', artifactHashes: { '../manifest.json': 'b'.repeat(64) } })).toThrow();
    expect(() => createCampaignStageControlMarker({ stage: 'matrix', stageId: 'a'.repeat(64),
      status: 'incomplete', artifactHashes: { 'output/chunk.json': 'b'.repeat(64) } })).toThrow();
  });

  it('deeply reconstructs every PSRO look before accepting empirical closure', async () => {
    const protocol = createThresholdRacingProtocol({ experimentName: 'campaign-stage-fixture',
      runId: 'run', kingdomId: 'current-duel', reservoirCount: 20_000,
      sourceIdentityHash: 'a'.repeat(64), checkpointNamespace: 'raw', screenDepths: [8],
      confirmationLooks: [4, 8] });
    const chunks: RawPsroScoreChunk[] = [], looks: RawPsroLookArtifact[] = [];
    await runThresholdRace({ candidates: candidates(), opponents: new Map(),
      schedule: weightedFairSchedule({ opponent: 1 }, Array.from({ length: 8 }, (_value, index) => index + 1)),
      kingdomId: 'current-duel', runner, depths: [8], evaluate: evaluator as never, chunkSize: 1,
      raw: { protocol, raceKind: 'screen', sealChunk(chunk) { chunks.push(chunk); },
        sealLook(look) { looks.push(look); } } });
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const matrix = { cells: ['saved'] };
    const unsigned = { experiment: protocol.experimentName, version: protocol.protocolVersion,
      runId: protocol.runId, status: 'complete', cleanScans: 2, admissions: [], matrix,
      scans: looks.map((rawLook) => ({ rawLook })), evidenceHash: '' };
    const checkpoint = { ...unsigned, evidenceHash: digest(unsigned) }, report = structuredClone(checkpoint);
    const checkpointSha256 = 'c'.repeat(64), reportSha256 = 'd'.repeat(64), stageId = 'b'.repeat(64);
    const closure = createCampaignPsroClosure({ stageId, protocolHash: thresholdRacingProtocolHash(protocol),
      sourceHash: protocol.sourceIdentityHash, status: 'complete', cleanScans: 2,
      admissions: 0, matrixHash: digest(matrix), checkpointHash: checkpointSha256,
      reportHash: reportSha256, reason: null });
    const artifactHashes: Record<string, string> = {
      'output/protocol.json': '1'.repeat(64),
      [`output/run-${protocol.runId}/closure.json`]: '2'.repeat(64),
      [`output/run-${protocol.runId}/checkpoint.json`]: checkpointSha256,
      [`output/run-${protocol.runId}/report.json`]: reportSha256
    };
    for (const chunk of chunks) {
      artifactHashes[`output/run-${protocol.runId}/raw/chunks/${chunk.lookId}`
        + `/${chunk.candidateStart}-${chunk.candidateEnd}.json`] = chunk.artifactHash;
    }
    for (const look of looks) {
      artifactHashes[`output/run-${protocol.runId}/raw/looks/${look.lookId}.json`] = look.artifactHash;
    }
    const marker = createCampaignStageControlMarker({ stage: 'psro', stageId,
      status: 'complete', artifactHashes });
    const validates = (overrides: Record<string, unknown> = {}) => validateCampaignPsroStage({ stageId,
      protocol, chunks, looks, checkpoint, report, checkpointSha256, reportSha256, closure,
      fileHashes: artifactHashes, marker, ...overrides });
    expect(validates()).toBe(true);
    expect(validates({ chunks: chunks.slice(1) })).toBe(false);
    expect(validates({ closure: { ...closure, cleanScans: 1 } })).toBe(false);
    expect(validates({ checkpoint: { ...checkpoint, matrix: { cells: ['changed'] } } })).toBe(false);
    expect(validates({ marker: { ...marker, extra: true } })).toBe(false);
  });
});
