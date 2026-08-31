import rawDesign from './balance-smoke-suite-design-v1.json' with { type: 'json' };
import { BALANCE_SUITE_MANIFEST } from './balanceSuite';
import {
  PRIORITY_PAIRS, REQUIRED_TRIPLES, canonicalJson, measureBalanceSuiteDesign, sha256Canonical
} from './balanceSuiteDesign';
import type { BalanceRouteLabel, BalanceSuiteDesign } from './balanceSuiteDesign';
import { validateBalanceSmokeSuiteDesign } from './balanceSmokeSuiteSearch';
import type { BalanceSmokeSuiteDesignSource } from './balanceSmokeSuiteSearch';

export interface BalanceSmokeCandidate {
  count: number;
  kingdomIds: string[];
  cardMinimum: number;
  cardMaximum: number;
  pairCovered: number;
  pairTotal: number;
  pairCoverage: number;
  priorityPairCovered: number;
  priorityPairTotal: number;
  priorityPairMinimum: number;
  tripleCovered: number;
  tripleTotal: number;
  tripleCoverage: number;
  requiredTripleCovered: number;
  requiredTripleTotal: number;
  requiredTripleMinimum: number;
  routesCovered: number;
  routesTotal: number;
  maximumOverlap: number;
}

export interface BalanceSmokeSuiteManifest {
  schemaVersion: 1;
  suiteVersion: 'balance-smoke-v1';
  sourceSuiteVersion: 'balance-suite-v4';
  sourceManifestDigest: string;
  digest: string;
  selectedCount: 30;
  selectedKingdomIds: string[];
  selection: {
    source: 'tuning';
    candidateSizes: number[];
    rule: string;
    method: string;
    optimalityClaim: string;
    requirements: string[];
    tieBreak: string;
    candidates: BalanceSmokeCandidate[];
  };
}

const BALANCE_SMOKE_SUITE_DESIGN = validateBalanceSmokeSuiteDesign(
  rawDesign as unknown as BalanceSmokeSuiteDesignSource
);
const kingdomById = new Map(BALANCE_SUITE_MANIFEST.kingdoms.map((kingdom) => [kingdom.id, kingdom]));
const round = (value: number): number => Number(value.toFixed(12));

function measureCandidate(ids: readonly string[]): BalanceSmokeCandidate {
  if (new Set(ids).size !== ids.length) throw new Error('A balance-smoke candidate has duplicate kingdom IDs.');
  const kingdoms = ids.map((id) => {
    const kingdom = kingdomById.get(id);
    if (!kingdom) throw new Error(`Unknown balance-smoke source kingdom ${id}.`);
    return kingdom;
  });
  const rows = kingdoms.map((kingdom) => kingdom.actionPiles.map((pile) => pile.cardId));
  const design: BalanceSuiteDesign = measureBalanceSuiteDesign(rows);
  const priorityCounts = PRIORITY_PAIRS.map((pair) => design.pairCounts[pair.cards.join('|')]!);
  const requiredCounts = REQUIRED_TRIPLES.map((triple) => design.tripleCounts[triple.cards.join('|')]!);
  const routeCounts = design.routeCounts as Record<BalanceRouteLabel, number>;
  return {
    count: ids.length, kingdomIds: [...ids], cardMinimum: design.cardCountMinimum,
    cardMaximum: design.cardCountMaximum, pairCovered: design.pairCovered, pairTotal: design.pairTotal,
    pairCoverage: round(design.pairCovered / design.pairTotal),
    priorityPairCovered: priorityCounts.filter((count) => count > 0).length,
    priorityPairTotal: priorityCounts.length, priorityPairMinimum: Math.min(...priorityCounts),
    tripleCovered: design.tripleCovered, tripleTotal: design.tripleTotal,
    tripleCoverage: round(design.tripleCovered / design.tripleTotal),
    requiredTripleCovered: requiredCounts.filter((count) => count > 0).length,
    requiredTripleTotal: requiredCounts.length, requiredTripleMinimum: Math.min(...requiredCounts),
    routesCovered: Object.values(routeCounts).filter((count) => count > 0).length,
    routesTotal: Object.keys(routeCounts).length, maximumOverlap: design.largestOverlap
  };
}

export function generateBalanceSmokeSuiteManifest(): BalanceSmokeSuiteManifest {
  const candidates = BALANCE_SMOKE_SUITE_DESIGN.candidates.map((candidate) =>
    measureCandidate(candidate.finalKingdomIds));
  for (const candidate of candidates) {
    if (candidate.priorityPairCovered !== 96 || candidate.requiredTripleCovered !== 60
      || candidate.routesCovered !== candidate.routesTotal) {
      throw new Error(`Balance-smoke candidate ${candidate.count} misses a required interaction or route.`);
    }
    if (candidate.kingdomIds.some((id) => kingdomById.get(id)?.split !== 'tuning')) {
      throw new Error(`Balance-smoke candidate ${candidate.count} is not tuning-only.`);
    }
  }
  const selected = candidates.find((candidate) => candidate.count === 30)!;
  const content = {
    schemaVersion: 1 as const, suiteVersion: 'balance-smoke-v1' as const,
    sourceSuiteVersion: BALANCE_SUITE_MANIFEST.suiteVersion,
    sourceManifestDigest: BALANCE_SUITE_MANIFEST.digest,
    selectedCount: 30 as const, selectedKingdomIds: [...selected.kingdomIds],
    selection: {
      source: 'tuning' as const, candidateSizes: candidates.map((candidate) => candidate.count),
      rule: 'Cover every named interaction and route, require broad card exposure, then maximize pair and triple breadth within the tuning source.',
      method: 'Offline YALPS 0.6.4 binary feasibility with a kingdom-index objective, followed by deterministic one-row exchange ascent; regeneration remeasures the pinned IDs.',
      optimalityClaim: 'Best fixed design found under the stated objective; not a proof of the global combinatorial optimum.',
      requirements: ['all 40 variable cards appear, with at least 6 appearances in the selected 30',
        'all 96 priority pairs appear at least once', 'all 60 required triples appear at least once',
        'all 14 route labels appear'],
      tieBreak: 'higher broad pair coverage, then higher broad triple coverage, then UTF-16 kingdom ID order',
      candidates
    }
  };
  return { ...content, digest: sha256Canonical(content) };
}

export function validateBalanceSmokeSuiteManifest(input: BalanceSmokeSuiteManifest): BalanceSmokeSuiteManifest {
  const expected = generateBalanceSmokeSuiteManifest();
  if (canonicalJson(input) !== canonicalJson(expected)) {
    throw new Error('The committed balance-smoke manifest is stale or invalid.');
  }
  return input;
}

export function serializeBalanceSmokeSuiteManifest(manifest: BalanceSmokeSuiteManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
