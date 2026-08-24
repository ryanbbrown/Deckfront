import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { RANDOM_PSRO_VERSION } from '../src/sim/randomPsro';
import {
  generateKingdom001SenseCheck, renderKingdom001SenseCheck
} from '../src/sim/randomPsroReport';

function value(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const held = process.argv[index + 1];
  if (!held || held.startsWith('--')) throw new Error(`${flag} needs a value.`);
  return held;
}
function positive(flag: string, fallback: number): number {
  const parsed = Number(value(flag) ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

try {
  const seed = positive('--seed', 35_001);
  const ordinarySource = value('--ordinary-source');
  const stratifiedSource = value('--stratified-source');
  const report = await generateKingdom001SenseCheck({ root: process.cwd(), seed,
    ...(ordinarySource ? { ordinarySource } : {}),
    ...(stratifiedSource ? { stratifiedSource } : {}),
    reportSeed: positive('--report-seed', 92_001),
    confirmationBlocks: positive('--confirmation-blocks', 400),
    workers: positive('--workers', 10) });
  const outDirectory = path.resolve(value('--out') ?? path.join(process.cwd(), '.experiments',
    'random-psro-consistency', RANDOM_PSRO_VERSION, 'report'));
  fs.mkdirSync(outDirectory, { recursive: true });
  const base = `k001-seed-${seed}-check`;
  fs.writeFileSync(path.join(outDirectory, `${base}.json`), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDirectory, `${base}.md`), renderKingdom001SenseCheck(report));
  process.stdout.write(`Wrote ${path.join(outDirectory, base)}.{json,md}.\n`);
  if (!report.comparison.oldSupportGate) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
