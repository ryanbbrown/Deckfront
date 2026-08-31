import fs from 'node:fs';
import path from 'node:path';
import {
  generateBalanceSmokeSuiteDesign, serializeBalanceSmokeSuiteDesign
} from '../src/sim/balanceSmokeSuiteSearch';

const output = path.join(process.cwd(), 'src', 'sim', 'balance-smoke-suite-design-v1.json');
const generated = serializeBalanceSmokeSuiteDesign(generateBalanceSmokeSuiteDesign());
const stdout = process.argv.includes('--stdout');
const check = process.argv.includes('--check');
if (stdout && check) throw new Error('Use either --stdout or --check, not both.');
if (stdout) {
  process.stdout.write(generated);
} else if (check) {
  if (fs.readFileSync(output, 'utf8') !== generated) throw new Error(`Balance-smoke design source is stale: ${output}`);
  process.stdout.write(`Verified ${output}\n`);
} else {
  fs.writeFileSync(output, generated);
  process.stdout.write(`Wrote ${output}\n`);
}
