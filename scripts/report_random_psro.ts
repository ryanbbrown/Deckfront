import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  generateRandomPsroConsistencyReport, renderRandomPsroConsistencyReport
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
  const ordinarySource = value('--ordinary-source');
  if (!ordinarySource) {
    throw new Error('--ordinary-source must name the exact Mage-heavy ordinary Kingdom 001 artifact. The stratified artifact is not a substitute.');
  }
  const outDirectory = path.resolve(value('--out') ?? path.join(process.cwd(), '.experiments',
    'random-psro-consistency', 'random-psro-v1', 'report'));
  const stratifiedSource = value('--stratified-source');
  const report = await generateRandomPsroConsistencyReport({ root: process.cwd(), ordinarySource,
    ...(stratifiedSource ? { stratifiedSource } : {}),
    reportSeed: positive('--report-seed', 91_001), confirmationBlocks: positive('--confirmation-blocks', 400),
    workers: positive('--workers', 10) });
  fs.mkdirSync(outDirectory, { recursive: true });
  fs.writeFileSync(path.join(outDirectory, 'random-psro-consistency.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDirectory, 'random-psro-consistency.md'), renderRandomPsroConsistencyReport(report));
  process.stdout.write(`Wrote ${outDirectory}.\n`);
  if (Object.values(report.empiricalGates).some((passed) => !passed)) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
