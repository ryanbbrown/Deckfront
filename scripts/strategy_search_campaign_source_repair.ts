import fs from 'node:fs';
import { validateCampaignSourceRepair } from '../src/sim/strategySearchCampaignOperator';

const request = JSON.parse(fs.readFileSync(0, 'utf8')) as Record<string, unknown>;
if (!validateCampaignSourceRepair(request.repair)) throw new Error('Campaign source repair is invalid.');
const repair = request.repair;
if (repair.campaignEvidenceHash !== request.evidenceHash
  || JSON.stringify(repair.executionSourceImage) !== JSON.stringify(request.executionSourceImage)) {
  throw new Error('Campaign source repair does not match the launch bundle.');
}
process.stdout.write(`${JSON.stringify(repair)}\n`);
