import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

const ENTRYPOINTS = Object.freeze({
  goldfish: 'scripts/strategy_search_goldfish.ts',
  'matrix-manifest': 'scripts/strategy_search_campaign_matrix_manifest.ts',
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
process.argv = [process.execPath, target, ...process.argv.slice(separator + 1)];
await import(pathToFileURL(target).href);
