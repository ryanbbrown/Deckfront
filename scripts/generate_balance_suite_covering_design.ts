import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  generateBalanceSuiteCoveringSearchInput, sha256Canonical
} from '../src/sim/balanceSuiteDesign';

interface SearchRow { split: 'tuning' | 'validation'; authored: boolean; cards: string[] }
interface SearchStage { name: string; attempts: number; seed: number; mode: 'validation' | 'tuning' }

const STAGES: readonly SearchStage[] = Object.freeze([
  { name: 'validation', attempts: 10_000_000, seed: 11_111, mode: 'validation' },
  { name: 'tuning', attempts: 15_000_000, seed: 22_222, mode: 'tuning' }
]);
const root = process.cwd();
const sourcePath = path.join(root, 'scripts', 'balance_suite_covering_search.cpp');
const outputPath = path.join(root, 'src', 'sim', 'balance-suite-covering-design-v2.json');
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

function compiler(): string {
  const candidates = [process.env.CXX, 'clang++', 'c++'].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const check = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (check.status === 0) return candidate;
  }
  throw new Error('The covering-design search needs a C++20 compiler. Set CXX or install clang++.');
}

function mergeRows(input: string, output: string): string {
  const source = input.trimEnd().split('\n'), generated = output.trimEnd().split('\n');
  const count = Number(source[0]);
  if (!Number.isInteger(count) || generated[0] !== source[0] || generated.length !== count + 1) {
    throw new Error('The covering search returned malformed rows.');
  }
  return `${[source[0]!, source[1]!, ...generated.slice(1), ...source.slice(count + 2)].join('\n')}\n`;
}

function parseRows(output: string): SearchRow[] {
  const lines = output.trimEnd().split('\n'), count = Number(lines.shift());
  if (count !== 160 || lines.length !== count) throw new Error('The covering search did not return 160 rows.');
  return lines.map((line): SearchRow => {
    const [split, authored, ...cards] = line.split(' ');
    if ((split !== '0' && split !== '1') || (authored !== '0' && authored !== '1')
      || cards.length !== 10 || new Set(cards).size !== 10) {
      throw new Error(`Malformed covering-search row: ${line}`);
    }
    return { split: split === '1' ? 'validation' : 'tuning', authored: authored === '1', cards };
  });
}

function runSearch(): Record<string, unknown> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-covering-search-'));
  try {
    const binary = path.join(temporary, 'covering-search');
    const compile = spawnSync(compiler(), ['-O3', '-std=c++20', sourcePath, '-o', binary],
      { encoding: 'utf8', timeout: 120_000 });
    if (compile.status !== 0) throw new Error(`Covering-search compile failed:\n${compile.stderr}`);
    let input = generateBalanceSuiteCoveringSearchInput(), output = '';
    for (const stage of STAGES) {
      const started = Date.now();
      const run = spawnSync(binary, [String(stage.attempts), String(stage.seed), stage.mode],
        { input, encoding: 'utf8', timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
      if (run.status !== 0) throw new Error(`Covering-search ${stage.name} stage failed:\n${run.stderr}`);
      output = run.stdout;
      input = mergeRows(input, output);
      process.stderr.write(`Covering-search ${stage.name}: ${(Date.now() - started) / 1000}s\n`);
    }
    const rows = parseRows(output);
    const content = {
      schemaVersion: 1,
      designVersion: 'covering-design-v2',
      cardOrder: generateBalanceSuiteCoveringSearchInput().split('\n')[1]!.split(' '),
      rowCount: rows.length,
      search: {
        method: 'deterministic greedy quota construction followed by split-isolated two-row swaps',
        initialConstruction: {
          baseSeed: 2_108_903_718,
          restart: 0,
          greedyCandidatesPerRow: 200,
          inputDigest: sha256(generateBalanceSuiteCoveringSearchInput())
        },
        implementation: path.relative(root, sourcePath),
        implementationDigest: sha256(fs.readFileSync(sourcePath)),
        compilerFlags: ['-O3', '-std=c++20'],
        stages: STAGES,
        tieBreak: 'direct UTF-16 code-unit order for construction; fixed PRNG sequence for swaps'
      },
      rows
    };
    return { ...content, digest: sha256Canonical(content) };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

const generated = `${JSON.stringify(runSearch(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync(outputPath, 'utf8') !== generated) {
    throw new Error(`Covering-design source is stale: ${outputPath}`);
  }
  process.stdout.write(`Verified ${outputPath}\n`);
} else {
  fs.writeFileSync(outputPath, generated);
  process.stdout.write(`Wrote ${outputPath}\n`);
}
