import fs from 'node:fs';
import path from 'node:path';
import {
  generateBalanceSmokeSuiteManifest, serializeBalanceSmokeSuiteManifest
} from '../src/sim/balanceSmokeSuite';

const output = path.join(process.cwd(), 'src', 'sim', 'balance-smoke-suite-manifest.json');
const generated = serializeBalanceSmokeSuiteManifest(generateBalanceSmokeSuiteManifest());
if (process.argv.includes('--check')) {
  if (fs.readFileSync(output, 'utf8') !== generated) {
    throw new Error(`Balance-smoke manifest is stale: ${output}`);
  }
  process.stdout.write(`Verified ${output}\n`);
} else {
  fs.writeFileSync(output, generated);
  process.stdout.write(`Wrote ${output}\n`);
}
