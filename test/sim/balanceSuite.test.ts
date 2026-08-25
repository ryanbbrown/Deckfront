import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VARIABLE_ACTION_IDS, findKingdom, resetKingdoms } from '../../src/game';
import {
  BALANCE_CAMPAIGN_BLOCKED_MESSAGE, BALANCE_SUITE_MANIFEST, balanceSuite
} from '../../src/sim/balanceSuite';
import {
  PRIORITY_PAIRS, REQUIRED_TRIPLES, manifestDigest,
  measureBalanceSuiteDesign, routeLabels, rowDigest, sha256Canonical,
  validateBalanceSuiteManifest
} from '../../src/sim/balanceSuiteDesign';
import type { BalanceSuiteManifest } from '../../src/sim/balanceSuiteDesign';
import { renderKingdomSuiteDesignReport } from '../../scripts/generate_kingdom_suite_design_report';

function clone(): BalanceSuiteManifest { return structuredClone(BALANCE_SUITE_MANIFEST); }
function rehash(manifest: BalanceSuiteManifest, rowIndex?: number): void {
  if (rowIndex !== undefined) manifest.kingdoms[rowIndex]!.rowDigest = rowDigest(manifest.kingdoms[rowIndex]!);
  manifest.digest = manifestDigest(manifest);
}
function independentCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(independentCanonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => [key, independentCanonical(entry)]));
  return value;
}
function independentDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(independentCanonical(value))).digest('hex');
}

afterEach(() => { resetKingdoms(); });

describe('balance-suite design', () => {
  it('measures literal card, pair, triple, overlap, and Jaccard values', () => {
    const result = measureBalanceSuiteDesign([
      ['a', 'b', 'c'], ['a', 'b', 'd'], ['a', 'c', 'd'], ['b', 'c', 'd']
    ], ['a', 'b', 'c', 'd']);
    expect(result.cardCounts).toEqual({ a: 3, b: 3, c: 3, d: 3 });
    expect(new Set(Object.values(result.pairCounts))).toEqual(new Set([2]));
    expect(new Set(Object.values(result.tripleCounts))).toEqual(new Set([1]));
    expect(result.overlap).toMatchObject({ histogram: { 2: 6 }, mean: 2, p99: 2, maximum: 2 });
    expect(result.jaccard.mean).toBe(0.5);
  });

  it('pins exact combinatorics and interaction expansion with independent arithmetic', () => {
    const choose = (n: number, k: number): number => {
      let result = 1; for (let index = 1; index <= k; index += 1) result *= (n - k + index) / index;
      return Math.round(result);
    };
    expect(choose(40, 10)).toBe(847_660_528);
    expect(10 / 40).toBe(1 / 4);
    expect(10 * 9 / (40 * 39)).toBe(3 / 52);
    expect(10 * 9 * 8 / (40 * 39 * 38)).toBe(3 / 247);
    expect(PRIORITY_PAIRS).toHaveLength(96);
    expect(REQUIRED_TRIPLES).toHaveLength(60);
    const degrees = new Map(VARIABLE_ACTION_IDS.map((card) => [card, 0]));
    for (const pair of PRIORITY_PAIRS) for (const card of pair.cards) degrees.set(card, degrees.get(card)! + 1);
    const memberships = new Map(VARIABLE_ACTION_IDS.map((card) => [card, 0]));
    for (const triple of REQUIRED_TRIPLES) for (const card of triple.cards) memberships.set(card, memberships.get(card)! + 1);
    expect(Math.max(...degrees.values())).toBe(10);
    expect(Math.max(...memberships.values())).toBe(11);
  });

  it('selects 160 as the first passing count and satisfies every threshold', () => {
    const manifest = BALANCE_SUITE_MANIFEST;
    expect(manifest.chosenCount).toBe(160);
    expect(manifest.splits.map((split) => [split.name, split.size])).toEqual([['tuning', 128], ['validation', 32]]);
    expect(manifest.selection.candidates.map((candidate) => [candidate.count, candidate.passed]))
      .toEqual([[50, false], [100, false], [150, false], [152, false], [156, false], [160, true], [200, true]]);
    expect(manifest.selection.candidates.filter((candidate) => candidate.count < 160)
      .map((candidate) => [candidate.count, candidate.failures.includes('full card minimum')]))
      .toEqual([[50, true], [100, true], [150, true], [152, true], [156, true]]);
    expect(manifest.statistics).toMatchObject({ cardCountMinimum: 40, cardCountMaximum: 40,
      pairCountMinimum: 8, tripleCovered: 9140, largestOverlap: 6, duplicateRows: 0, invalidRows: 0 });
    expect(manifest.statistics.overlap.p99).toBe(5);
    expect(Math.min(...manifest.interactions.priorityPairs.map((pair) => pair.count))).toBe(12);
    expect(Math.min(...manifest.interactions.priorityPairs.map((pair) => pair.validationCount))).toBe(2);
    expect(Math.min(...manifest.interactions.requiredTriples.map((triple) => triple.count))).toBe(4);
    expect(Math.min(...manifest.interactions.requiredTriples.map((triple) => triple.validationCount))).toBe(1);
    expect(validateBalanceSuiteManifest(manifest)).toBe(manifest);
  }, 120_000);

  it('pins row and manifest SHA-256 digests with independent canonical hashing', () => {
    const first = BALANCE_SUITE_MANIFEST.kingdoms[0]!;
    const rowContent = { ...first } as Partial<typeof first>; delete rowContent.rowDigest;
    expect(first.rowDigest).toBe(independentDigest(rowContent));
    const manifestContent = { ...BALANCE_SUITE_MANIFEST } as Partial<BalanceSuiteManifest>; delete manifestContent.digest;
    expect(BALANCE_SUITE_MANIFEST.digest).toBe(independentDigest(manifestContent));
  });

  it('renders deterministic design evidence, formulas, blind spots, and campaign bounds', () => {
    const first = renderKingdomSuiteDesignReport(BALANCE_SUITE_MANIFEST);
    expect(first).toBe(renderKingdomSuiteDesignReport(BALANCE_SUITE_MANIFEST));
    expect(first).toContain('40 choose 10 = 847,660,528');
    expect(first).toContain('Candidate coverage curve and decision');
    expect(first).toContain('Raw feasibility pilot');
    expect(first).toContain('Deterministic lower bounds');
    expect(first).toContain('Random mean Jaccard');
    expect(first).toContain('Residual blind spots');
    expect(first).toContain('Thirty-kingdom smoke suite');
    expect(first).toContain('aria-label="9140 of 9880"');
    expect(first).toContain('<span class="bar"');
    expect(first).not.toContain('&lt;span class=&quot;bar&quot;');
    expect(first).toContain('pending the Kingdom 009 consistency protocol');
    expect(first).toContain(BALANCE_SUITE_MANIFEST.digest);
  });

  it('registers v4 kingdoms only in simulator code', () => {
    const id = 'balance-tuning-005';
    expect(findKingdom(id)).toBeNull();
    balanceSuite.register();
    expect(findKingdom(id)).toMatchObject({ id, startingHealth: 40 });
    resetKingdoms();
    expect(findKingdom(id)).toBeNull();
  });
});

describe('balance-suite sensitive validation', () => {
  it.each<[string, (manifest: BalanceSuiteManifest) => void, RegExp]>([
    ['nine piles', (manifest) => { manifest.kingdoms[0]!.actionPiles.pop(); }, /exactly ten piles/iu],
    ['pile count nine', (manifest) => { manifest.kingdoms[0]!.actionPiles[0]!.count = 9; }, /exactly ten cards/iu],
    ['Scrap pile', (manifest) => { manifest.kingdoms[0]!.actionPiles[0]!.cardId = 'scrap'; }, /ineligible variable card/iu],
    ['override', (manifest) => { manifest.kingdoms[0]!.overrides = { jab: { cost: 1 } }; }, /must not have overrides/iu],
    ['provenance', (manifest) => { manifest.kingdoms[0]!.provenance.reason = 'wrong'; }, /stale row provenance/iu]
  ])('rejects %s after semantic digests are recomputed', (_label, mutate, message) => {
    const manifest = clone(); mutate(manifest); rehash(manifest, 0);
    expect(() => validateBalanceSuiteManifest(manifest)).toThrow(message);
  });

  it('rejects stale row and top-level digests independently', () => {
    const row = clone(); row.kingdoms[0]!.rowDigest = 'wrong'; row.digest = manifestDigest(row);
    expect(() => validateBalanceSuiteManifest(row)).toThrow(/row digest/iu);
    const top = clone(); top.digest = 'wrong';
    expect(() => validateBalanceSuiteManifest(top)).toThrow(/manifest digest/iu);
  });

  it('rejects changed generator provenance, card semantics, and candidate selection with current digests', () => {
    const generator = clone(); generator.generator.baseSeed += 1; rehash(generator);
    expect(() => validateBalanceSuiteManifest(generator)).toThrow(/generator provenance/iu);
    const version = clone(); (version as { taxonomyVersion: string }).taxonomyVersion = 'wrong'; rehash(version);
    expect(() => validateBalanceSuiteManifest(version)).toThrow(/frozen design protocol/iu);
    const semantics = clone(); semantics.cardPool.semantics.variable[0]!.cost += 1; rehash(semantics);
    expect(() => validateBalanceSuiteManifest(semantics)).toThrow(/semantics/iu);
    const candidate = clone(); candidate.selection.candidates.find((entry) => entry.count === 160)!.passed = false; rehash(candidate);
    expect(() => validateBalanceSuiteManifest(candidate)).toThrow(/candidate metrics/iu);
  });

  it('rejects missing, duplicate, reordered, and card-frequency-deficit content', () => {
    const missing = clone(); missing.kingdoms.pop(); rehash(missing);
    expect(() => validateBalanceSuiteManifest(missing)).toThrow(/wrong selected size/iu);
    const duplicate = clone(); duplicate.kingdoms[1]!.id = duplicate.kingdoms[0]!.id; rehash(duplicate, 1);
    expect(() => validateBalanceSuiteManifest(duplicate)).toThrow(/duplicate kingdom ID/iu);
    const reordered = clone();
    [reordered.cardPool.orderedVariableCardIds[0], reordered.cardPool.orderedVariableCardIds[1]] =
      [reordered.cardPool.orderedVariableCardIds[1]!, reordered.cardPool.orderedVariableCardIds[0]!];
    rehash(reordered);
    expect(() => validateBalanceSuiteManifest(reordered)).toThrow(/eligible card order/iu);
    const frequency = clone(), row = frequency.kingdoms[0]!;
    row.actionPiles.find((pile) => pile.cardId === 'cull')!.cardId = 'adapt';
    row.routeLabels = routeLabels(row.actionPiles.map((pile) => pile.cardId)); rehash(frequency, 0);
    expect(() => validateBalanceSuiteManifest(frequency)).toThrow(/full card minimum/iu);
  });

  it.each<[string, (manifest: BalanceSuiteManifest) => void]>([
    ['non-selected candidate metrics', (manifest) => { manifest.selection.candidates[0]!.tripleCovered += 1; }],
    ['pair threshold', (manifest) => {
      (manifest.thresholds.pair as { fullMinimum: number }).fullMinimum = 9;
    }],
    ['priority-pair threshold', (manifest) => {
      (manifest.thresholds.pair as { priorityFullMinimum: number }).priorityFullMinimum = 13;
    }],
    ['required-triple threshold', (manifest) => {
      (manifest.thresholds.triple as { requiredFullMinimum: number }).requiredFullMinimum = 5;
    }],
    ['route threshold', (manifest) => { manifest.thresholds.routes['mana-route'].fullMinimum += 1; }],
    ['overlap threshold', (manifest) => {
      (manifest.thresholds.distinctness as { maximumOverlap: number }).maximumOverlap = 5;
    }],
    ['taxonomy roles', (manifest) => {
      manifest.taxonomy.roles.directDamage!.pop();
      manifest.taxonomy.digest = sha256Canonical({ roles: manifest.taxonomy.roles, costBands: manifest.taxonomy.costBands });
    }],
    ['split size', (manifest) => { manifest.splits[0]!.size -= 1; }],
    ['random baseline', (manifest) => { manifest.randomBaselines.candidates[0]!.pairExpected += 1; }],
    ['deterministic lower bound', (manifest) => { manifest.deterministicLowerBounds.everyPairEightTimes = 140; }],
    ['authored overlap', (manifest) => { manifest.authoredOverlapMatrix[0]!.overlap += 1; }],
    ['residual blind spots', (manifest) => { manifest.residualBlindSpots.uncoveredTripleCount += 1; }],
    ['raw pilot', (manifest) => { manifest.rawFeasibilityPilot[0]!.tripleCovered += 1; }]
  ])('rejects rehashed %s evidence', (_label, mutate) => {
    const manifest = clone(); mutate(manifest); rehash(manifest);
    expect(() => validateBalanceSuiteManifest(manifest)).toThrow(/methodology evidence/iu);
  });
});

describe('pending balance campaign boundary', () => {
  it('blocks batch work before adapter calls or files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-balance-block-'));
    let called = false;
    await expect(balanceSuite.runBatch({ root, kingdomIds: ['balance-tuning-001'] }, async () => { called = true; }))
      .rejects.toThrow(BALANCE_CAMPAIGN_BLOCKED_MESSAGE);
    expect(called).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
