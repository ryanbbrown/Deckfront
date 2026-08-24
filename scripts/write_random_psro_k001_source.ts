import path from 'node:path';
import process from 'node:process';
import {
  kingdom001OrdinarySourcePath, writeKingdom001OrdinarySource
} from '../src/sim/randomPsroReport';

const index = process.argv.indexOf('--out');
const raw = index < 0 ? undefined : process.argv[index + 1];
if (index >= 0 && (!raw || raw.startsWith('--'))) throw new Error('--out needs a path.');
const output = raw ? path.resolve(raw) : kingdom001OrdinarySourcePath(process.cwd());
process.stdout.write(`Wrote validated historical K001 ordinary source: ${writeKingdom001OrdinarySource(process.cwd(), output)}\n`);
