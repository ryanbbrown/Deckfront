import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

function option(args: readonly string[], name: string): string {
  const index = args.indexOf(`--${name}`), value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}

const separator = process.argv.indexOf('--');
if (separator < 0) throw new Error('Strategy-search subprocess arguments need --.');
const wrapperArgs = process.argv.slice(2, separator), entry = option(wrapperArgs, 'entry');
if (entry !== 'validator') throw new Error(`Unknown strategy-search subprocess ${entry}.`);
if (wrapperArgs.length !== 4) throw new Error('Strategy-search subprocess wrapper options differ.');
strategySearchKingdom(option(wrapperArgs, 'kingdom'));
const target = path.resolve('scripts/strategy_search_validate_artifact.ts');
process.argv = [process.execPath, target, ...process.argv.slice(separator + 1)];
await import(pathToFileURL(target).href);
