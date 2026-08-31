import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { Constraint } from 'yalps';
import rawSmokeManifest from '../../src/sim/balance-smoke-suite-manifest.json' with { type: 'json' };
import { BALANCE_SUITE_MANIFEST } from '../../src/sim/balanceSuite';
import {
  generateBalanceSmokeSuiteManifest, serializeBalanceSmokeSuiteManifest, validateBalanceSmokeSuiteManifest
} from '../../src/sim/balanceSmokeSuite';
import type { BalanceSmokeSuiteManifest } from '../../src/sim/balanceSmokeSuite';
import {
  findBestBalanceSmokeSuiteExchange, generateBalanceSmokeSuiteYalpsModel, searchBalanceSmokeSuite
} from '../../src/sim/balanceSmokeSuiteSearch';

const smokeManifest = rawSmokeManifest as unknown as BalanceSmokeSuiteManifest;
const sourceById = new Map(BALANCE_SUITE_MANIFEST.kingdoms.map((kingdom) => [kingdom.id, kingdom]));
const key = (cards: readonly string[]): string => [...cards].sort().join('|');
const EXPECTED_IDS = [
  'balance-tuning-005', 'balance-tuning-007', 'balance-tuning-009', 'balance-tuning-010',
  'balance-tuning-011', 'balance-tuning-013', 'balance-tuning-014', 'balance-tuning-015',
  'balance-tuning-018', 'balance-tuning-021', 'balance-tuning-024', 'balance-tuning-029',
  'balance-tuning-031', 'balance-tuning-033', 'balance-tuning-034', 'balance-tuning-037',
  'balance-tuning-042', 'balance-tuning-047', 'balance-tuning-053', 'balance-tuning-056',
  'balance-tuning-057', 'balance-tuning-064', 'balance-tuning-067', 'balance-tuning-080',
  'balance-tuning-082', 'balance-tuning-086', 'balance-tuning-090', 'balance-tuning-097',
  'balance-tuning-116', 'balance-tuning-126'
] as const;

function runSearch(root: string, ...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/search_balance_smoke_suite.ts', ...args],
    { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 });
}

describe('balance smoke suite', () => {
  it('selects the recorded 30 tuning kingdoms with broad and named interaction coverage', () => {
    expect(validateBalanceSmokeSuiteManifest(smokeManifest)).toBe(smokeManifest);
    expect(smokeManifest.selectedKingdomIds).toEqual(EXPECTED_IDS);
    expect(new Set(smokeManifest.selectedKingdomIds).size).toBe(30);
    const rows = smokeManifest.selectedKingdomIds.map((id) => {
      const kingdom = sourceById.get(id)!;
      expect(kingdom.split, id).toBe('tuning');
      return kingdom.actionPiles.map((pile) => pile.cardId);
    });
    const cardCounts = new Map(BALANCE_SUITE_MANIFEST.cardPool.orderedVariableCardIds.map((card) => [card, 0]));
    const pairs = new Set<string>(), triples = new Set<string>();
    for (const row of rows) {
      for (const card of row) cardCounts.set(card, cardCounts.get(card)! + 1);
      for (let first = 0; first < row.length; first += 1) {
        for (let second = first + 1; second < row.length; second += 1) {
          pairs.add(key([row[first]!, row[second]!]));
          for (let third = second + 1; third < row.length; third += 1) {
            triples.add(key([row[first]!, row[second]!, row[third]!]));
          }
        }
      }
    }
    expect([...cardCounts.values()].filter((count) => count > 0)).toHaveLength(40);
    expect(Math.min(...cardCounts.values())).toBe(6);
    expect(Math.max(...cardCounts.values())).toBe(10);
    expect(pairs.size).toBe(710);
    expect(triples.size).toBe(3221);
    const selected = smokeManifest.selection.candidates.find((candidate) => candidate.count === 30)!;
    expect(selected).toMatchObject({ priorityPairCovered: 96, priorityPairMinimum: 1,
      requiredTripleCovered: 60, requiredTripleMinimum: 1, routesCovered: 14, routesTotal: 14,
      maximumOverlap: 5 });
  });

  it('applies the selected card bounds to the YALPS model', () => {
    const constraints = generateBalanceSmokeSuiteYalpsModel().constraints as Readonly<Record<string, Constraint>>;
    const cardConstraints = Object.entries(constraints).filter(([name]) => name.startsWith('card:'))
      .map(([, constraint]) => constraint);
    expect(cardConstraints).toEqual(Array.from({ length: 40 }, () => ({ min: 6, max: 11 })));
  });

  it('reproduces the recorded 30 kingdoms in independent processes', () => {
    const result = searchBalanceSmokeSuite();
    expect(result).toEqual({ kingdomIds: EXPECTED_IDS,
      score: { broadPairs: 710, broadTriples: 3221, maximumCardExposure: 10,
        cardExposureSquareSum: 2322, pairExposureSquareSum: 3166 } });
    const root = path.resolve(import.meta.dirname, '../..');
    const expected = `${JSON.stringify(EXPECTED_IDS, null, 2)}\n`;
    const first = runSearch(root), second = runSearch(root);
    expect(first.status, first.stderr.toString()).toBe(0);
    expect(second.status, second.stderr.toString()).toBe(0);
    expect(first.stdout).toBe(expected);
    expect(second.stdout).toBe(first.stdout);
    const check = runSearch(root, '--check');
    expect(check.status, check.stderr.toString()).toBe(0);
    expect(check.stdout).toMatch(/Verified 30 selected balance-smoke kingdom IDs/u);
  }, 120_000);

  it('has no strictly improving valid one-row exchange for the selected 30', () => {
    expect(findBestBalanceSmokeSuiteExchange(EXPECTED_IDS)).toBeNull();
  });

  it('regenerates the smoke manifest byte for byte and rejects stale data', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const committed = fs.readFileSync(path.join(root, 'src/sim/balance-smoke-suite-manifest.json'), 'utf8');
    expect(serializeBalanceSmokeSuiteManifest(generateBalanceSmokeSuiteManifest())).toBe(committed);
    const child = spawnSync(process.execPath,
      ['--import', 'tsx', 'scripts/generate_balance_smoke_suite_manifest.ts', '--check'],
      { cwd: root, encoding: 'utf8', timeout: 120_000 });
    expect(child.status, child.stderr).toBe(0);
    const stale = structuredClone(smokeManifest);
    stale.selectedKingdomIds[0] = 'balance-tuning-128';
    expect(() => validateBalanceSmokeSuiteManifest(stale)).toThrow(/stale or invalid/iu);
  });
});
