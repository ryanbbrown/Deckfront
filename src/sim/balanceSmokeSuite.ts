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

export interface BalanceSmokeAlternative extends BalanceSmokeCandidate {
  id: string;
  source: 'tuning' | 'tuning-and-validation';
  reason: string;
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
    alternatives: BalanceSmokeAlternative[];
  };
}

const CANDIDATE_IDS: Readonly<Record<number, readonly string[]>> = Object.freeze({
  25: ['balance-tuning-003', 'balance-tuning-008', 'balance-tuning-010', 'balance-tuning-013',
    'balance-tuning-018', 'balance-tuning-019', 'balance-tuning-020', 'balance-tuning-021',
    'balance-tuning-025', 'balance-tuning-026', 'balance-tuning-036', 'balance-tuning-038',
    'balance-tuning-046', 'balance-tuning-048', 'balance-tuning-053', 'balance-tuning-057',
    'balance-tuning-058', 'balance-tuning-059', 'balance-tuning-060', 'balance-tuning-064',
    'balance-tuning-068', 'balance-tuning-071', 'balance-tuning-078', 'balance-tuning-083',
    'balance-tuning-112'],
  26: ['balance-tuning-001', 'balance-tuning-003', 'balance-tuning-008', 'balance-tuning-010',
    'balance-tuning-013', 'balance-tuning-018', 'balance-tuning-020', 'balance-tuning-021',
    'balance-tuning-025', 'balance-tuning-026', 'balance-tuning-036', 'balance-tuning-038',
    'balance-tuning-042', 'balance-tuning-046', 'balance-tuning-048', 'balance-tuning-057',
    'balance-tuning-058', 'balance-tuning-060', 'balance-tuning-064', 'balance-tuning-068',
    'balance-tuning-071', 'balance-tuning-074', 'balance-tuning-078', 'balance-tuning-083',
    'balance-tuning-091', 'balance-tuning-112'],
  27: ['balance-tuning-009', 'balance-tuning-013', 'balance-tuning-025', 'balance-tuning-026',
    'balance-tuning-036', 'balance-tuning-046', 'balance-tuning-047', 'balance-tuning-048',
    'balance-tuning-051', 'balance-tuning-057', 'balance-tuning-058', 'balance-tuning-059',
    'balance-tuning-061', 'balance-tuning-064', 'balance-tuning-068', 'balance-tuning-073',
    'balance-tuning-074', 'balance-tuning-078', 'balance-tuning-083', 'balance-tuning-084',
    'balance-tuning-098', 'balance-tuning-102', 'balance-tuning-107', 'balance-tuning-112',
    'balance-tuning-113', 'balance-tuning-114', 'balance-tuning-122'],
  28: ['balance-tuning-001', 'balance-tuning-003', 'balance-tuning-008', 'balance-tuning-010',
    'balance-tuning-012', 'balance-tuning-013', 'balance-tuning-020', 'balance-tuning-021',
    'balance-tuning-025', 'balance-tuning-026', 'balance-tuning-032', 'balance-tuning-036',
    'balance-tuning-038', 'balance-tuning-042', 'balance-tuning-046', 'balance-tuning-048',
    'balance-tuning-057', 'balance-tuning-058', 'balance-tuning-060', 'balance-tuning-064',
    'balance-tuning-068', 'balance-tuning-071', 'balance-tuning-074', 'balance-tuning-078',
    'balance-tuning-083', 'balance-tuning-084', 'balance-tuning-091', 'balance-tuning-112'],
  29: ['balance-tuning-001', 'balance-tuning-008', 'balance-tuning-010', 'balance-tuning-013',
    'balance-tuning-018', 'balance-tuning-019', 'balance-tuning-020', 'balance-tuning-025',
    'balance-tuning-026', 'balance-tuning-029', 'balance-tuning-036', 'balance-tuning-040',
    'balance-tuning-042', 'balance-tuning-046', 'balance-tuning-048', 'balance-tuning-052',
    'balance-tuning-053', 'balance-tuning-057', 'balance-tuning-058', 'balance-tuning-060',
    'balance-tuning-062', 'balance-tuning-064', 'balance-tuning-068', 'balance-tuning-082',
    'balance-tuning-083', 'balance-tuning-085', 'balance-tuning-102', 'balance-tuning-112',
    'balance-tuning-113'],
  30: ['balance-tuning-001', 'balance-tuning-002', 'balance-tuning-010', 'balance-tuning-013',
    'balance-tuning-018', 'balance-tuning-019', 'balance-tuning-020', 'balance-tuning-021',
    'balance-tuning-025', 'balance-tuning-026', 'balance-tuning-029', 'balance-tuning-035',
    'balance-tuning-036', 'balance-tuning-040', 'balance-tuning-042', 'balance-tuning-046',
    'balance-tuning-053', 'balance-tuning-055', 'balance-tuning-057', 'balance-tuning-058',
    'balance-tuning-060', 'balance-tuning-064', 'balance-tuning-068', 'balance-tuning-071',
    'balance-tuning-078', 'balance-tuning-082', 'balance-tuning-083', 'balance-tuning-093',
    'balance-tuning-112', 'balance-tuning-114']
});

const BALANCED_30_IDS = Object.freeze([
  'balance-tuning-001', 'balance-tuning-008', 'balance-tuning-009', 'balance-tuning-010',
  'balance-tuning-013', 'balance-tuning-020', 'balance-tuning-025', 'balance-tuning-026',
  'balance-tuning-032', 'balance-tuning-036', 'balance-tuning-042', 'balance-tuning-046',
  'balance-tuning-047', 'balance-tuning-048', 'balance-tuning-052', 'balance-tuning-053',
  'balance-tuning-057', 'balance-tuning-058', 'balance-tuning-062', 'balance-tuning-074',
  'balance-tuning-075', 'balance-tuning-083', 'balance-tuning-084', 'balance-tuning-085',
  'balance-tuning-089', 'balance-tuning-102', 'balance-tuning-107', 'balance-tuning-112',
  'balance-tuning-113', 'balance-tuning-120'
]);

const ALL_SOURCE_30_IDS = Object.freeze([
  'balance-tuning-001', 'balance-tuning-002', 'balance-tuning-010', 'balance-tuning-013',
  'balance-tuning-018', 'balance-tuning-019', 'balance-tuning-020', 'balance-tuning-021',
  'balance-tuning-025', 'balance-tuning-026', 'balance-tuning-029', 'balance-tuning-036',
  'balance-tuning-040', 'balance-tuning-042', 'balance-tuning-046', 'balance-tuning-053',
  'balance-tuning-057', 'balance-tuning-058', 'balance-tuning-060', 'balance-tuning-064',
  'balance-tuning-068', 'balance-tuning-071', 'balance-tuning-078', 'balance-tuning-082',
  'balance-tuning-083', 'balance-tuning-084', 'balance-tuning-112', 'balance-validation-017',
  'balance-validation-023', 'balance-validation-029'
]);

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
    count: ids.length,
    kingdomIds: [...ids],
    cardMinimum: design.cardCountMinimum,
    cardMaximum: design.cardCountMaximum,
    pairCovered: design.pairCovered,
    pairTotal: design.pairTotal,
    pairCoverage: round(design.pairCovered / design.pairTotal),
    priorityPairCovered: priorityCounts.filter((count) => count > 0).length,
    priorityPairTotal: priorityCounts.length,
    priorityPairMinimum: Math.min(...priorityCounts),
    tripleCovered: design.tripleCovered,
    tripleTotal: design.tripleTotal,
    tripleCoverage: round(design.tripleCovered / design.tripleTotal),
    requiredTripleCovered: requiredCounts.filter((count) => count > 0).length,
    requiredTripleTotal: requiredCounts.length,
    requiredTripleMinimum: Math.min(...requiredCounts),
    routesCovered: Object.values(routeCounts).filter((count) => count > 0).length,
    routesTotal: Object.keys(routeCounts).length,
    maximumOverlap: design.largestOverlap
  };
}

function alternative(id: string, source: BalanceSmokeAlternative['source'], reason: string,
  ids: readonly string[]): BalanceSmokeAlternative {
  return { id, source, reason, ...measureCandidate(ids) };
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
    schemaVersion: 1 as const,
    suiteVersion: 'balance-smoke-v1' as const,
    sourceSuiteVersion: BALANCE_SUITE_MANIFEST.suiteVersion,
    sourceManifestDigest: BALANCE_SUITE_MANIFEST.digest,
    selectedCount: 30 as const,
    selectedKingdomIds: [...selected.kingdomIds],
    selection: {
      source: 'tuning' as const,
      candidateSizes: candidates.map((candidate) => candidate.count),
      rule: 'Cover every named interaction and route, keep broad card exposure, then maximize pair and triple breadth within the tuning source.',
      method: 'Binary feasibility search followed by deterministic one-row exchange ascent.',
      optimalityClaim: 'Best fixed design found under the stated objective; not a proof of the global combinatorial optimum.',
      requirements: [
        'all 40 variable cards appear, with at least 6 appearances in the selected 30',
        'all 96 priority pairs appear at least once',
        'all 60 required triples appear at least once',
        'all 14 route labels appear'
      ],
      tieBreak: 'higher broad pair coverage, then higher broad triple coverage, then UTF-16 kingdom ID order',
      candidates,
      alternatives: [
        alternative('balanced-card-30', 'tuning',
          'Raises the card minimum from 6 to 7 but covers 22 fewer broad pairs and 23 fewer broad triples.', BALANCED_30_IDS),
        alternative('all-source-breadth-30', 'tuning-and-validation',
          'Adds 12 broad pairs and 10 broad triples over the tuning-only breadth design but uses three validation kingdoms.',
          ALL_SOURCE_30_IDS)
      ]
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
