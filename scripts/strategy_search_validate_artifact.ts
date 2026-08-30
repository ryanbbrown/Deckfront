import path from 'node:path';
import { readGoldfishReservoir, readGoldfishTop } from '../src/sim/goldfishReservoir';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`), value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}

const stage = option('stage'), file = path.resolve(option('file')), evidenceId = option('evidence-id'),
  kingdomId = option('kingdom'), evidenceRoot = path.resolve(option('evidence-root'));
if (!/^[0-9a-f]{64}$/.test(evidenceId)) throw new Error('Evidence ID is invalid.');
strategySearchKingdom(kingdomId);
if (stage === 'goldfish-one-reduce') {
  readGoldfishTop(file, kingdomId);
} else if (stage === 'goldfish-two-reduce') {
  readGoldfishReservoir(file, kingdomId, { top: path.join(evidenceRoot, 'goldfish/top-500000.hgf') });
} else {
  throw new Error(`Artifact stage ${stage} does not use validation.`);
}
process.stdout.write(`${JSON.stringify({ valid: true, stage, evidenceId })}\n`);
