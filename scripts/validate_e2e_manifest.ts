import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

export interface CoverageManifest {
  cards: Record<string, string[]>;
  browserFlows: Record<string, string[]>;
  aiFlows: Record<string, string[]>;
}

export const requiredCards = [
  'copper', 'silver', 'gold', 'footwork', 'cull', 'muster', 'feint', 'drive', 'flurry', 'aim', 'volley'
];

export const requiredBrowserFlows = [
  'startingBuild', 'localTwoPlayer', 'zeroPaidBuild', 'buildAddRemoveRepeat', 'buildRefresh', 'buildRace', 'buildLocked',
  'freeCopper', 'overBudgetBuild', 'humanFirst', 'aiFirst', 'hiddenAiBuild', 'editedPrompt', 'promptCanClear',
  'carriedStartingMoney', 'treasureAutoPlay', 'footworkSelections', 'sharedSpaces', 'passThrough', 'driveDirection', 'cullBothForms', 'cullNoPair',
  'disabledReasons', 'drawPreviewOpaque', 'buyDrawOpaque', 'previewUndoConfirm', 'multiplePurchases',
  'baseTreasuresNondepleting', 'tenthActionSupply', 'turnCleanup', 'conditionDisplay', 'closeCombination',
  'rangedCombination', 'wallCollision', 'nearVolleyComparison', 'realFlurryShortChain', 'realFlurryCap',
  'refreshActionPreview', 'refreshConfirmedAction', 'refreshBuy', 'refreshAiWait', 'refreshAiError', 'refreshEnded',
  'confirmedVictory', 'completeGame', 'victoryRefreshNewGame', 'privateHtml', 'publicPurchaseHistory',
  'modelSummaryUi', 'aiElapsedTimer'
];

export const requiredAiFlows = [
  'independentBuild', 'strategyTrace', 'modelSummaryTrace', 'completeServerTurn', 'serverContinuesWithoutPage',
  'aiErrorRetry', 'retryPreservesCommits', 'decisionGuard', 'validFakeBuild', 'liveBridgeBuildAndTurn'
];

export function validateManifest(manifest: CoverageManifest, discoveredIds: Set<string>): { mappings: number; tests: number } {
  const errors: string[] = [];
  validateSection('cards', manifest.cards, requiredCards, discoveredIds, errors);
  validateSection('browserFlows', manifest.browserFlows, requiredBrowserFlows, discoveredIds, errors);
  validateSection('aiFlows', manifest.aiFlows, requiredAiFlows, discoveredIds, errors);
  if (errors.length) throw new Error(errors.join('\n'));
  const mapped = new Set(Object.values(manifest).flatMap((section) => Object.values(section).flat()));
  return { mappings: Object.values(manifest).reduce((total, section) => total + Object.keys(section).length, 0), tests: mapped.size };
}

function validateSection(
  name: string,
  section: Record<string, string[]> | undefined,
  required: string[],
  discoveredIds: Set<string>,
  errors: string[]
): void {
  if (!section) {
    errors.push(`Missing manifest section: ${name}`);
    return;
  }
  const keys = Object.keys(section);
  for (const key of required) {
    const tests = section[key];
    if (!tests?.length) errors.push(`${name}.${key} has no mapped test.`);
    for (const testId of tests ?? []) {
      if (!discoveredIds.has(testId)) errors.push(`${name}.${key}: ${testId} is not an exact discovered test ID.`);
    }
  }
  for (const key of keys.filter((key) => !required.includes(key))) errors.push(`${name}.${key} is not a current required mapping.`);
}

export async function discoverTestIds(): Promise<Set<string>> {
  const [browser, liveBrowser, unit] = await Promise.all([
    discoverPlaywrightIds(), discoverPlaywrightIds('playwright.live.config.ts'), discoverVitestIds()
  ]);
  return new Set([...browser, ...liveBrowser, ...unit]);
}

async function discoverPlaywrightIds(config?: string): Promise<string[]> {
  const args = ['test', '--list', '--reporter=json'];
  if (config) args.push('--config', config);
  const { stdout } = await executeFile(path.resolve('node_modules/.bin/playwright'), args, { cwd: path.resolve('.'), maxBuffer: 20_000_000 });
  const report = JSON.parse(stdout) as { suites?: JsonSuite[] };
  const ids: string[] = [];
  visitSuites(report.suites ?? [], ids);
  return ids;
}

interface JsonSuite {
  suites?: JsonSuite[];
  specs?: Array<{ title: string; tests: Array<{ expectedStatus: string }> }>;
}

function visitSuites(suites: JsonSuite[], ids: string[]): void {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      const separator = spec.title.indexOf(':');
      const id = (separator < 0 ? spec.title : spec.title.slice(0, separator)).trim();
      if (spec.tests.some((test) => test.expectedStatus === 'passed')) ids.push(`pw:${id}`);
    }
    visitSuites(suite.suites ?? [], ids);
  }
}

async function discoverVitestIds(): Promise<string[]> {
  const { stdout } = await executeFile(path.resolve('node_modules/.bin/vitest'), ['list', '--exclude', 'test/e2e/**', '--json'], {
    cwd: path.resolve('.'), maxBuffer: 20_000_000
  });
  const tests = JSON.parse(stdout) as Array<{ name: string }>;
  return tests.map((test) => `vitest:${test.name}`);
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.resolve('test/e2e/coverage-manifest.json'), 'utf8')) as CoverageManifest;
  const result = validateManifest(manifest, await discoverTestIds());
  console.log(`Validated ${result.mappings} required coverage mappings against ${result.tests} exact test IDs.`);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entry) await main();
