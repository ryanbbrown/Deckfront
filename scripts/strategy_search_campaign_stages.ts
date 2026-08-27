import fs from 'node:fs';
import { createCampaignStageControlMarker } from '../src/sim/strategySearchStages';
import type { CampaignStageCompleteness, CampaignStageKind } from '../src/sim/strategySearchStages';

const value = JSON.parse(fs.readFileSync(0, 'utf8')) as {
  stage: CampaignStageKind; stageId: string; status: CampaignStageCompleteness;
  artifactHashes: Record<string, string>; reason?: string;
};
const marker = createCampaignStageControlMarker({ stage: value.stage, stageId: value.stageId,
  status: value.status, artifactHashes: value.artifactHashes,
  ...(value.reason === undefined ? {} : { reason: value.reason }) });
process.stdout.write(`${JSON.stringify(marker)}\n`);
