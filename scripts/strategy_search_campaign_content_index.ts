import fs from 'node:fs';
import { createCampaignContentIndex } from '../src/sim/strategySearchCampaign';
import type { CampaignContentIndexEntry } from '../src/sim/strategySearchCampaign';

const input = JSON.parse(fs.readFileSync(0, 'utf8')) as unknown;
if (!Array.isArray(input)) throw new Error('Campaign content-index input must be an array.');
process.stdout.write(`${JSON.stringify(createCampaignContentIndex(input as CampaignContentIndexEntry[]))}\n`);
