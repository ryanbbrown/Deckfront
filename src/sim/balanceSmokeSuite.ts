import { BALANCE_SUITE_MANIFEST } from './balanceSuite';
import {
  PRIORITY_PAIRS, REQUIRED_TRIPLES, canonicalJson, measureBalanceSuiteDesign, sha256Canonical
} from './balanceSuiteDesign';
import type { BalanceRouteLabel, BalanceSuiteDesign } from './balanceSuiteDesign';

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

const CANDIDATE_IDS: Readonly<Record<number, readonly string[]>> = Object.freeze({
  25: ['balance-tuning-009', 'balance-tuning-011', 'balance-tuning-013', 'balance-tuning-015',
    'balance-tuning-022', 'balance-tuning-023', 'balance-tuning-029', 'balance-tuning-031',
    'balance-tuning-033', 'balance-tuning-034', 'balance-tuning-037', 'balance-tuning-047',
    'balance-tuning-056', 'balance-tuning-057', 'balance-tuning-060', 'balance-tuning-064',
    'balance-tuning-077', 'balance-tuning-082', 'balance-tuning-085', 'balance-tuning-087',
    'balance-tuning-090', 'balance-tuning-091', 'balance-tuning-103', 'balance-tuning-118',
    'balance-tuning-124'],
  26: ['balance-tuning-005', 'balance-tuning-006', 'balance-tuning-007', 'balance-tuning-008',
    'balance-tuning-009', 'balance-tuning-010', 'balance-tuning-011', 'balance-tuning-012',
    'balance-tuning-013', 'balance-tuning-014', 'balance-tuning-024', 'balance-tuning-029',
    'balance-tuning-031', 'balance-tuning-033', 'balance-tuning-034', 'balance-tuning-039',
    'balance-tuning-056', 'balance-tuning-065', 'balance-tuning-068', 'balance-tuning-082',
    'balance-tuning-087', 'balance-tuning-090', 'balance-tuning-099', 'balance-tuning-102',
    'balance-tuning-123', 'balance-tuning-126'],
  27: ['balance-tuning-005', 'balance-tuning-007', 'balance-tuning-009', 'balance-tuning-010',
    'balance-tuning-011', 'balance-tuning-013', 'balance-tuning-014', 'balance-tuning-015',
    'balance-tuning-017', 'balance-tuning-024', 'balance-tuning-029', 'balance-tuning-031',
    'balance-tuning-033', 'balance-tuning-034', 'balance-tuning-042', 'balance-tuning-047',
    'balance-tuning-053', 'balance-tuning-056', 'balance-tuning-057', 'balance-tuning-064',
    'balance-tuning-080', 'balance-tuning-082', 'balance-tuning-086', 'balance-tuning-089',
    'balance-tuning-090', 'balance-tuning-102', 'balance-tuning-118'],
  28: ['balance-tuning-005', 'balance-tuning-006', 'balance-tuning-007', 'balance-tuning-010',
    'balance-tuning-012', 'balance-tuning-015', 'balance-tuning-022', 'balance-tuning-023',
    'balance-tuning-029', 'balance-tuning-031', 'balance-tuning-032', 'balance-tuning-033',
    'balance-tuning-034', 'balance-tuning-040', 'balance-tuning-042', 'balance-tuning-056',
    'balance-tuning-057', 'balance-tuning-060', 'balance-tuning-062', 'balance-tuning-064',
    'balance-tuning-065', 'balance-tuning-068', 'balance-tuning-079', 'balance-tuning-082',
    'balance-tuning-083', 'balance-tuning-090', 'balance-tuning-102', 'balance-tuning-126'],
  29: ['balance-tuning-005', 'balance-tuning-006', 'balance-tuning-007', 'balance-tuning-009',
    'balance-tuning-010', 'balance-tuning-011', 'balance-tuning-013', 'balance-tuning-014',
    'balance-tuning-015', 'balance-tuning-017', 'balance-tuning-024', 'balance-tuning-025',
    'balance-tuning-029', 'balance-tuning-031', 'balance-tuning-033', 'balance-tuning-034',
    'balance-tuning-036', 'balance-tuning-039', 'balance-tuning-042', 'balance-tuning-056',
    'balance-tuning-057', 'balance-tuning-065', 'balance-tuning-067', 'balance-tuning-080',
    'balance-tuning-082', 'balance-tuning-083', 'balance-tuning-090', 'balance-tuning-102',
    'balance-tuning-118'],
  30: ['balance-tuning-005', 'balance-tuning-007', 'balance-tuning-009', 'balance-tuning-010',
    'balance-tuning-011', 'balance-tuning-013', 'balance-tuning-014', 'balance-tuning-015',
    'balance-tuning-018', 'balance-tuning-021', 'balance-tuning-024', 'balance-tuning-029',
    'balance-tuning-031', 'balance-tuning-033', 'balance-tuning-034', 'balance-tuning-037',
    'balance-tuning-042', 'balance-tuning-047', 'balance-tuning-053', 'balance-tuning-056',
    'balance-tuning-057', 'balance-tuning-064', 'balance-tuning-067', 'balance-tuning-080',
    'balance-tuning-082', 'balance-tuning-086', 'balance-tuning-090', 'balance-tuning-097',
    'balance-tuning-116', 'balance-tuning-126']
});

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
  const candidates = Object.entries(CANDIDATE_IDS).sort(([left], [right]) => Number(left) - Number(right))
    .map(([, ids]) => measureCandidate(ids));
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
