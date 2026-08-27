import { describe, expect, it } from 'vitest';
import {
  campaignStageControlPath, createCampaignStageControlMarker, validateCampaignStageControlMarker
} from '../../src/sim/strategySearchStages';

describe('strategy-search stage control', () => {
  it('seals exact complete and incomplete markers', () => {
    const complete = createCampaignStageControlMarker({ stage: 'goldfish', evidenceId: 'a'.repeat(64),
      status: 'complete', artifactHashes: { 'output/evidence.json': 'b'.repeat(64) } });
    expect(validateCampaignStageControlMarker(complete)).toBe(true);
    expect(campaignStageControlPath('evidence/a/goldfish', 'complete'))
      .toBe('evidence/a/goldfish/control/complete.json');
    expect(() => createCampaignStageControlMarker({ stage: 'psro', evidenceId: 'a'.repeat(64),
      status: 'terminal-incomplete', artifactHashes: { output: 'b'.repeat(64) } })).toThrow();
    expect(validateCampaignStageControlMarker({ ...complete, extra: true })).toBe(false);
  });
});
