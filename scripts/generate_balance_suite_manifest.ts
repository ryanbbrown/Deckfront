import fs from 'node:fs';
import path from 'node:path';
import {
  generateBalanceSuiteManifest, serializeBalanceSuiteManifest
} from '../src/sim/balanceSuiteDesign';

const output = path.join(process.cwd(), 'src', 'sim', 'balance-suite-manifest.json');
const generated = serializeBalanceSuiteManifest(generateBalanceSuiteManifest());
if (process.argv.includes('--check')) {
  const committed = fs.readFileSync(output, 'utf8');
  if (committed !== generated) throw new Error(`Balance-suite manifest is stale: ${output}`);
  process.stdout.write(`Verified ${output}\n`);
} else {
  fs.writeFileSync(output, generated);
  process.stdout.write(`Wrote ${output}\n`);
}
