import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import rawSmokeManifest from '../../src/sim/balance-smoke-suite-manifest.json' with { type: 'json' };
import { BALANCE_SUITE_MANIFEST } from '../../src/sim/balanceSuite';
import {
  generateBalanceSmokeSuiteManifest, serializeBalanceSmokeSuiteManifest, validateBalanceSmokeSuiteManifest
} from '../../src/sim/balanceSmokeSuite';
import type { BalanceSmokeSuiteManifest } from '../../src/sim/balanceSmokeSuite';

const smokeManifest = rawSmokeManifest as unknown as BalanceSmokeSuiteManifest;
const sourceById = new Map(BALANCE_SUITE_MANIFEST.kingdoms.map((kingdom) => [kingdom.id, kingdom]));
const key = (cards: readonly string[]): string => [...cards].sort().join('|');

describe('balance smoke suite', () => {
  it('selects 30 tuning kingdoms with broad and named interaction coverage', () => {
    expect(validateBalanceSmokeSuiteManifest(smokeManifest)).toBe(smokeManifest);
    expect(smokeManifest.selectedKingdomIds).toHaveLength(30);
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
    expect(Math.min(...cardCounts.values())).toBe(6);
    expect(Math.max(...cardCounts.values())).toBe(10);
    expect(pairs.size).toBe(710);
    expect(triples.size).toBe(3221);
    const selected = smokeManifest.selection.candidates.find((candidate) => candidate.count === 30)!;
    expect(selected).toMatchObject({ priorityPairCovered: 96, priorityPairMinimum: 1,
      requiredTripleCovered: 60, requiredTripleMinimum: 1, routesCovered: 14, routesTotal: 14,
      maximumOverlap: 5 });
  });

  it('records the 25-to-30 coverage curve and source alternatives', () => {
    expect(smokeManifest.selection.candidates.map((candidate) => [candidate.count, candidate.cardMinimum,
      candidate.cardMaximum, candidate.pairCovered, candidate.tripleCovered])).toEqual([
      [25, 5, 11, 653, 2720],
      [26, 5, 10, 673, 2850],
      [27, 5, 11, 679, 2935],
      [28, 6, 10, 689, 3023],
      [29, 6, 11, 706, 3142],
      [30, 6, 10, 710, 3221]
    ]);
    expect(smokeManifest.selection.candidates.every((candidate) => candidate.priorityPairCovered === 96
      && candidate.requiredTripleCovered === 60 && candidate.routesCovered === 14)).toBe(true);
  });

  it('regenerates byte for byte and rejects stale source data', () => {
    const committed = fs.readFileSync(path.resolve(import.meta.dirname,
      '../../src/sim/balance-smoke-suite-manifest.json'), 'utf8');
    expect(serializeBalanceSmokeSuiteManifest(generateBalanceSmokeSuiteManifest())).toBe(committed);
    const child = spawnSync(process.execPath,
      ['--import', 'tsx', 'scripts/generate_balance_smoke_suite_manifest.ts', '--check'],
      { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8', timeout: 120_000 });
    expect(child.status, child.stderr).toBe(0);
    const stale = structuredClone(smokeManifest);
    stale.selectedKingdomIds[0] = 'balance-tuning-128';
    expect(() => validateBalanceSmokeSuiteManifest(stale)).toThrow(/stale or invalid/iu);
  });
});
