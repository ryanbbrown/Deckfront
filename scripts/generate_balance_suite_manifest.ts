import fs from 'node:fs';
import path from 'node:path';
import { BALANCE_SUITE_SPEC, balanceSuite } from '../src/sim/balanceSuite';

const output = path.join(process.cwd(), 'src', 'sim', 'balance-suite-manifest.json');
fs.writeFileSync(output, `${JSON.stringify(balanceSuite.generate(BALANCE_SUITE_SPEC), null, 2)}\n`);
process.stdout.write(`Wrote ${output}\n`);
