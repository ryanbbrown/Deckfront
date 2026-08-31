import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { Constraint } from 'yalps';
import rawSmokeDesign from '../../src/sim/balance-smoke-suite-design-v1.json' with { type: 'json' };
import rawSmokeManifest from '../../src/sim/balance-smoke-suite-manifest.json' with { type: 'json' };
import { BALANCE_SUITE_MANIFEST } from '../../src/sim/balanceSuite';
import {
  generateBalanceSmokeSuiteManifest, serializeBalanceSmokeSuiteManifest, validateBalanceSmokeSuiteManifest
} from '../../src/sim/balanceSmokeSuite';
import type { BalanceSmokeSuiteManifest } from '../../src/sim/balanceSmokeSuite';
import {
  findBestBalanceSmokeSuiteExchange, generateBalanceSmokeSuiteDesign,
  generateBalanceSmokeSuiteYalpsModel, validateBalanceSmokeSuiteDesign
} from '../../src/sim/balanceSmokeSuiteSearch';
import {
  balanceSmokeSuiteDesignDigest, serializeBalanceSmokeSuiteDesign
} from '../../src/sim/balanceSmokeSuiteDesign';
import type { BalanceSmokeSuiteDesignSource } from '../../src/sim/balanceSmokeSuiteDesign';

const smokeDesign = rawSmokeDesign as unknown as BalanceSmokeSuiteDesignSource;
const smokeManifest = rawSmokeManifest as unknown as BalanceSmokeSuiteManifest;
const sourceById = new Map(BALANCE_SUITE_MANIFEST.kingdoms.map((kingdom) => [kingdom.id, kingdom]));
const key = (cards: readonly string[]): string => [...cards].sort().join('|');
const EXPECTED_IDS = [
  [25, ['balance-tuning-009', 'balance-tuning-011', 'balance-tuning-013', 'balance-tuning-015',
    'balance-tuning-022', 'balance-tuning-023', 'balance-tuning-029', 'balance-tuning-031',
    'balance-tuning-033', 'balance-tuning-034', 'balance-tuning-037', 'balance-tuning-047',
    'balance-tuning-056', 'balance-tuning-057', 'balance-tuning-060', 'balance-tuning-064',
    'balance-tuning-077', 'balance-tuning-082', 'balance-tuning-085', 'balance-tuning-087',
    'balance-tuning-090', 'balance-tuning-091', 'balance-tuning-103', 'balance-tuning-118',
    'balance-tuning-124']],
  [26, ['balance-tuning-005', 'balance-tuning-006', 'balance-tuning-007', 'balance-tuning-008',
    'balance-tuning-009', 'balance-tuning-010', 'balance-tuning-011', 'balance-tuning-012',
    'balance-tuning-013', 'balance-tuning-014', 'balance-tuning-024', 'balance-tuning-029',
    'balance-tuning-031', 'balance-tuning-033', 'balance-tuning-034', 'balance-tuning-039',
    'balance-tuning-056', 'balance-tuning-065', 'balance-tuning-068', 'balance-tuning-082',
    'balance-tuning-087', 'balance-tuning-090', 'balance-tuning-099', 'balance-tuning-102',
    'balance-tuning-123', 'balance-tuning-126']],
  [27, ['balance-tuning-005', 'balance-tuning-007', 'balance-tuning-009', 'balance-tuning-010',
    'balance-tuning-011', 'balance-tuning-013', 'balance-tuning-014', 'balance-tuning-015',
    'balance-tuning-017', 'balance-tuning-024', 'balance-tuning-029', 'balance-tuning-031',
    'balance-tuning-033', 'balance-tuning-034', 'balance-tuning-042', 'balance-tuning-047',
    'balance-tuning-053', 'balance-tuning-056', 'balance-tuning-057', 'balance-tuning-064',
    'balance-tuning-080', 'balance-tuning-082', 'balance-tuning-086', 'balance-tuning-089',
    'balance-tuning-090', 'balance-tuning-102', 'balance-tuning-118']],
  [28, ['balance-tuning-005', 'balance-tuning-006', 'balance-tuning-007', 'balance-tuning-010',
    'balance-tuning-012', 'balance-tuning-015', 'balance-tuning-022', 'balance-tuning-023',
    'balance-tuning-029', 'balance-tuning-031', 'balance-tuning-032', 'balance-tuning-033',
    'balance-tuning-034', 'balance-tuning-040', 'balance-tuning-042', 'balance-tuning-056',
    'balance-tuning-057', 'balance-tuning-060', 'balance-tuning-062', 'balance-tuning-064',
    'balance-tuning-065', 'balance-tuning-068', 'balance-tuning-079', 'balance-tuning-082',
    'balance-tuning-083', 'balance-tuning-090', 'balance-tuning-102', 'balance-tuning-126']],
  [29, ['balance-tuning-005', 'balance-tuning-006', 'balance-tuning-007', 'balance-tuning-009',
    'balance-tuning-010', 'balance-tuning-011', 'balance-tuning-013', 'balance-tuning-014',
    'balance-tuning-015', 'balance-tuning-017', 'balance-tuning-024', 'balance-tuning-025',
    'balance-tuning-029', 'balance-tuning-031', 'balance-tuning-033', 'balance-tuning-034',
    'balance-tuning-036', 'balance-tuning-039', 'balance-tuning-042', 'balance-tuning-056',
    'balance-tuning-057', 'balance-tuning-065', 'balance-tuning-067', 'balance-tuning-080',
    'balance-tuning-082', 'balance-tuning-083', 'balance-tuning-090', 'balance-tuning-102',
    'balance-tuning-118']],
  [30, ['balance-tuning-005', 'balance-tuning-007', 'balance-tuning-009', 'balance-tuning-010',
    'balance-tuning-011', 'balance-tuning-013', 'balance-tuning-014', 'balance-tuning-015',
    'balance-tuning-018', 'balance-tuning-021', 'balance-tuning-024', 'balance-tuning-029',
    'balance-tuning-031', 'balance-tuning-033', 'balance-tuning-034', 'balance-tuning-037',
    'balance-tuning-042', 'balance-tuning-047', 'balance-tuning-053', 'balance-tuning-056',
    'balance-tuning-057', 'balance-tuning-064', 'balance-tuning-067', 'balance-tuning-080',
    'balance-tuning-082', 'balance-tuning-086', 'balance-tuning-090', 'balance-tuning-097',
    'balance-tuning-116', 'balance-tuning-126']]
] as const;

function redigest(design: BalanceSmokeSuiteDesignSource): BalanceSmokeSuiteDesignSource {
  design.digest = balanceSmokeSuiteDesignDigest(design);
  return design;
}

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

  it('records the literal 25-to-30 IDs and coverage curve', () => {
    expect(smokeDesign.candidates.map((candidate) => [candidate.count, candidate.finalKingdomIds])).toEqual(EXPECTED_IDS);
    expect(smokeManifest.selection.candidates.map((candidate) => [candidate.count, candidate.kingdomIds])).toEqual(EXPECTED_IDS);
    expect(smokeDesign.candidates[5]).toMatchObject({
      solverObjective: 1114,
      initialKingdomIds: ['balance-tuning-005', 'balance-tuning-006', 'balance-tuning-007',
        'balance-tuning-009', 'balance-tuning-010', 'balance-tuning-011', 'balance-tuning-012',
        'balance-tuning-013', 'balance-tuning-014', 'balance-tuning-015', 'balance-tuning-016',
        'balance-tuning-018', 'balance-tuning-021', 'balance-tuning-024', 'balance-tuning-029',
        'balance-tuning-031', 'balance-tuning-033', 'balance-tuning-034', 'balance-tuning-037',
        'balance-tuning-039', 'balance-tuning-042', 'balance-tuning-047', 'balance-tuning-056',
        'balance-tuning-057', 'balance-tuning-064', 'balance-tuning-080', 'balance-tuning-082',
        'balance-tuning-086', 'balance-tuning-090', 'balance-tuning-126'],
      initialScore: { broadPairs: 697, broadTriples: 3182, maximumCardExposure: 11,
        cardExposureSquareSum: 2342, pairExposureSquareSum: 3244 },
      acceptedExchanges: [
        { removeKingdomId: 'balance-tuning-016', insertKingdomId: 'balance-tuning-089',
          score: { broadPairs: 702, broadTriples: 3198, maximumCardExposure: 11,
            cardExposureSquareSum: 2324, pairExposureSquareSum: 3206 } },
        { removeKingdomId: 'balance-tuning-039', insertKingdomId: 'balance-tuning-053',
          score: { broadPairs: 704, broadTriples: 3211, maximumCardExposure: 11,
            cardExposureSquareSum: 2324, pairExposureSquareSum: 3188 } },
        { removeKingdomId: 'balance-tuning-006', insertKingdomId: 'balance-tuning-097',
          score: { broadPairs: 708, broadTriples: 3219, maximumCardExposure: 11,
            cardExposureSquareSum: 2318, pairExposureSquareSum: 3174 } },
        { removeKingdomId: 'balance-tuning-012', insertKingdomId: 'balance-tuning-067',
          score: { broadPairs: 708, broadTriples: 3221, maximumCardExposure: 10,
            cardExposureSquareSum: 2318, pairExposureSquareSum: 3170 } },
        { removeKingdomId: 'balance-tuning-089', insertKingdomId: 'balance-tuning-116',
          score: { broadPairs: 710, broadTriples: 3221, maximumCardExposure: 10,
            cardExposureSquareSum: 2322, pairExposureSquareSum: 3166 } }
      ],
      finalScore: { broadPairs: 710, broadTriples: 3221, maximumCardExposure: 10,
        cardExposureSquareSum: 2322, pairExposureSquareSum: 3166 }
    });
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

  it('applies the literal card bounds to the YALPS seed model', () => {
    const cardConstraints = (count: number): Constraint[] => Object.entries(
      generateBalanceSmokeSuiteYalpsModel(count).constraints as Readonly<Record<string, Constraint>>
    ).filter(([name]) => name.startsWith('card:')).map(([, constraint]) => constraint);
    expect(cardConstraints(30)).toEqual(Array.from({ length: 40 }, () => ({ min: 6, max: 11 })));
    expect(cardConstraints(29)).toEqual(Array.from({ length: 40 }, () => ({ min: 6 })));
  });

  it('regenerates the search design byte for byte in two independent processes', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const committed = fs.readFileSync(path.join(root, 'src/sim/balance-smoke-suite-design-v1.json'), 'utf8');
    expect(validateBalanceSmokeSuiteDesign(smokeDesign)).toBe(smokeDesign);
    expect(serializeBalanceSmokeSuiteDesign(generateBalanceSmokeSuiteDesign())).toBe(committed);
    const run = (): ReturnType<typeof spawnSync> => spawnSync(process.execPath,
      ['--import', 'tsx', 'scripts/generate_balance_smoke_suite_design.ts', '--stdout'],
      { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    const first = run(), second = run();
    expect(first.status, first.stderr.toString()).toBe(0);
    expect(second.status, second.stderr.toString()).toBe(0);
    expect(first.stdout).toBe(committed);
    expect(second.stdout).toBe(first.stdout);
  }, 120_000);

  it('rejects changed design identity and provenance even with a replacement digest', () => {
    const badDigest = structuredClone(smokeDesign);
    badDigest.digest = '0'.repeat(64);
    expect(() => validateBalanceSmokeSuiteDesign(badDigest)).toThrow(/digest/iu);

    const sourceDigest = structuredClone(smokeDesign);
    sourceDigest.sourceManifestDigest = '0'.repeat(64);
    expect(() => validateBalanceSmokeSuiteDesign(redigest(sourceDigest))).toThrow(/source manifest/iu);

    const sourceOrder = structuredClone(smokeDesign);
    [sourceOrder.sourceKingdomOrder[0], sourceOrder.sourceKingdomOrder[1]] =
      [sourceOrder.sourceKingdomOrder[1]!, sourceOrder.sourceKingdomOrder[0]!];
    sourceOrder.sourceKingdomOrderDigest = '0'.repeat(64);
    expect(() => validateBalanceSmokeSuiteDesign(redigest(sourceOrder))).toThrow(/source kingdom order/iu);

    const solver = structuredClone(smokeDesign);
    (solver.solver as { version: string }).version = '0.6.3';
    expect(() => validateBalanceSmokeSuiteDesign(redigest(solver))).toThrow(/solver provenance/iu);

    const candidate = structuredClone(smokeDesign);
    candidate.candidates[0]!.finalKingdomIds[0] = 'balance-tuning-128';
    expect(() => validateBalanceSmokeSuiteDesign(redigest(candidate))).toThrow(/final IDs/iu);

    const exchange = structuredClone(smokeDesign);
    exchange.candidates[5]!.acceptedExchanges[0]!.insertKingdomId = 'balance-tuning-128';
    expect(() => validateBalanceSmokeSuiteDesign(redigest(exchange))).toThrow(/exchange provenance/iu);
  });

  it('has no strictly improving valid one-row exchange for the selected 30', () => {
    expect(findBestBalanceSmokeSuiteExchange(EXPECTED_IDS[5][1], 30)).toBeNull();
  });

  it('regenerates the smoke manifest byte for byte and rejects stale source data', () => {
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
