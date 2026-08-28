import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

const ENTRYPOINTS = Object.freeze({
  'matrix-manifest': 'scripts/strategy_search_campaign_matrix_manifest.ts',
  'matrix-score': 'scripts/strategy_search_campaign_matrix_score.ts',
  'matrix-reduce': 'scripts/strategy_search_campaign_matrix_reduce.ts',
  'parallel-psro': 'scripts/strategy_search_campaign_parallel_psro.ts',
  'psro-score-receipt-validator': 'scripts/strategy_search_validate_psro_score_receipt.ts',
  matrix: 'scripts/strategy_search_campaign_matrix.ts',
  psro: 'scripts/strategy_search_campaign_psro.ts',
  validator: 'scripts/strategy_search_validate_artifact.ts'
});
type StrategySearchSubprocess = keyof typeof ENTRYPOINTS;

function option(args: readonly string[], name: string): string {
  const index = args.indexOf(`--${name}`), value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}

const separator = process.argv.indexOf('--');
if (separator < 0) throw new Error('Strategy-search subprocess arguments need --.');
const wrapperArgs = process.argv.slice(2, separator), entry = option(wrapperArgs, 'entry');
if (!(entry in ENTRYPOINTS)) throw new Error(`Unknown strategy-search subprocess ${entry}.`);
if (wrapperArgs.length !== 4) throw new Error('Strategy-search subprocess wrapper options differ.');
const kingdomId = option(wrapperArgs, 'kingdom'), target = path.resolve(ENTRYPOINTS[entry as StrategySearchSubprocess]);
strategySearchKingdom(kingdomId);
const targetArgs = process.argv.slice(separator + 1), temporaryFiles: string[] = [];
if (entry === 'parallel-psro' && targetArgs.includes('--transition')
  && targetArgs[targetArgs.indexOf('--mode') + 1] !== 'finalize') {
  const transitionIndex = targetArgs.indexOf('--transition'), transitionFile = targetArgs[transitionIndex + 1]!;
  const transition = JSON.parse(fs.readFileSync(transitionFile, 'utf8')) as {
    checkpoint: unknown; look?: unknown; row?: unknown };
  const writePart = (label: 'checkpoint' | 'look' | 'row', value: unknown): string => {
    const file = `${transitionFile}.${label}-${process.pid}.json`;
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`); temporaryFiles.push(file); return file;
  };
  targetArgs.splice(transitionIndex, 2, '--checkpoint', writePart('checkpoint', transition.checkpoint));
  if (transition.look) targetArgs.push('--look', writePart('look', transition.look));
  if (transition.row) targetArgs.push('--row', writePart('row', transition.row));
}
process.argv = [process.execPath, target, ...targetArgs];
try { await import(pathToFileURL(target).href); }
finally { temporaryFiles.forEach((file) => fs.rmSync(file, { force: true })); }
