import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

interface Row { rule: string; tests: string[] }
export interface DiscoveredTest { id: string; title: string; expectedStatus: string; file: string }
export type CoverageManifest = Record<string, Row[]>;

export const requiredSections = [
  'shared', 'baselineMove', 'shove', 'dash', 'brace', 'cull', 'drive', 'breaker', 'press',
  'pull', 'vault', 'sweep', 'relay', 'block', 'pin', 'corner', 'respawnAndScoring',
  'turnMarketPersistence', 'actionLimits', 'aiHandoff'
];

export function validateManifest(
  manifest: CoverageManifest,
  discovered: DiscoveredTest[],
  sections = requiredSections
): { rowCount: number; testCount: number } {
  const active = discovered.filter((test) => test.expectedStatus === 'passed');
  const activeIds = new Set(active.map((test) => test.id));
  const skippedIds = new Set(discovered.filter((test) => test.expectedStatus !== 'passed').map((test) => test.id));
  const errors: string[] = [];
  for (const section of sections) {
    const rows = manifest[section];
    if (!rows?.length) {
      errors.push(`Missing coverage section: ${section}`);
      continue;
    }
    for (const row of rows) {
      if (!row.rule.trim() || row.tests.length === 0) errors.push(`${section} has an empty coverage row.`);
      for (const testId of row.tests) {
        if (activeIds.has(testId)) continue;
        if (skippedIds.has(testId)) errors.push(`${section}: ${testId} names a skipped browser test.`);
        else errors.push(`${section}: ${testId} does not exactly name a discovered browser test.`);
      }
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return {
    rowCount: Object.values(manifest).reduce((count, rows) => count + rows.length, 0),
    testCount: activeIds.size
  };
}

export async function discoverPlaywrightTests(config?: string): Promise<DiscoveredTest[]> {
  const args = ['test', '--list', '--reporter=json'];
  if (config) args.push('--config', config);
  const { stdout } = await executeFile(path.resolve('node_modules/.bin/playwright'), args, {
    cwd: path.resolve('.'),
    maxBuffer: 20_000_000
  });
  const report = JSON.parse(stdout) as JsonReport;
  const discovered: DiscoveredTest[] = [];
  visitSuites(report.suites, discovered);
  return discovered;
}

async function main(): Promise<void> {
  const manifestPath = path.resolve('test/e2e/coverage-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as CoverageManifest;
  const discovered = [
    ...await discoverPlaywrightTests(),
    ...await discoverPlaywrightTests('playwright.live.config.ts')
  ];
  const result = validateManifest(manifest, discovered);
  console.log(
    `Validated ${result.rowCount} browser coverage rows against ${result.testCount} discovered, non-skipped Playwright test IDs.`
  );
}

interface JsonReport {
  suites: JsonSuite[];
}

interface JsonSuite {
  suites?: JsonSuite[];
  specs?: Array<{
    title: string;
    file: string;
    tests: Array<{ expectedStatus: string }>;
  }>;
}

function visitSuites(suites: JsonSuite[] = [], discovered: DiscoveredTest[]): void {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      const separator = spec.title.indexOf(':');
      const id = (separator === -1 ? spec.title : spec.title.slice(0, separator)).trim();
      for (const test of spec.tests) {
        discovered.push({ id, title: spec.title, expectedStatus: test.expectedStatus, file: spec.file });
      }
    }
    visitSuites(suite.suites, discovered);
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entry) await main();
