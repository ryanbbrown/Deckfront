import { BALANCE_SUITE_MANIFEST } from './balanceSuite';
import { canonicalJson, sha256Canonical } from './balanceSuiteDesign';

export interface BalanceSmokeSearchScore {
  broadPairs: number;
  broadTriples: number;
  maximumCardExposure: number;
  cardExposureSquareSum: number;
  pairExposureSquareSum: number;
}

export interface BalanceSmokeSearchExchange {
  removeKingdomId: string;
  insertKingdomId: string;
  score: BalanceSmokeSearchScore;
}

export type BalanceSmokeSolverStatus = 'optimal' | 'infeasible' | 'unbounded' | 'timedout' | 'cycled';

export interface BalanceSmokeSearchCandidate {
  count: number;
  cardMinimum: number;
  cardMaximum: number | null;
  solverStatus: BalanceSmokeSolverStatus;
  solverObjective: number;
  initialKingdomIds: string[];
  initialScore: BalanceSmokeSearchScore;
  acceptedExchanges: BalanceSmokeSearchExchange[];
  finalKingdomIds: string[];
  finalScore: BalanceSmokeSearchScore;
}

export interface BalanceSmokeSuiteDesignSource {
  schemaVersion: 1;
  designVersion: 'balance-smoke-suite-design-v1';
  sourceSuiteVersion: 'balance-suite-v4';
  sourceManifestDigest: string;
  sourceKingdomOrder: string[];
  sourceKingdomOrderDigest: string;
  solver: {
    name: 'yalps';
    version: '0.6.4';
    direction: 'minimize';
    objective: 'sum of one-based source indexes';
    options: { maxIterations: 100000; tolerance: 0.01 };
    wallClockTimeout: null;
  };
  candidateSizes: number[];
  cardBounds: { count: number; minimum: number; maximum: number | null }[];
  feasibility: {
    source: 'tuning';
    selectedKingdoms: 'exact candidate size';
    priorityPairMinimum: 1;
    requiredTripleMinimum: 1;
    routeMinimum: 1;
  };
  ascent: {
    neighborhood: 'all selected-to-unselected one-row exchanges';
    traversalOrder: 'selected source order, then unselected source order';
    objectiveOrder: string[];
    tieBreak: 'first exchange in source traversal order';
    optimalityClaim: string;
  };
  candidates: BalanceSmokeSearchCandidate[];
  digest: string;
}

export const BALANCE_SMOKE_CANDIDATE_BOUNDS = Object.freeze([
  { count: 25, minimum: 5, maximum: null },
  { count: 26, minimum: 5, maximum: null },
  { count: 27, minimum: 5, maximum: null },
  { count: 28, minimum: 6, maximum: null },
  { count: 29, minimum: 6, maximum: null },
  { count: 30, minimum: 6, maximum: 11 }
] as const);
export const BALANCE_SMOKE_SOLVER_OPTIONS = Object.freeze({ maxIterations: 100_000, tolerance: 0.01 } as const);
export const BALANCE_SMOKE_ASCENT_OBJECTIVE = Object.freeze([
  'more covered broad pairs',
  'more covered broad triples',
  'lower maximum card exposure',
  'lower sum of squared card exposures',
  'lower sum of squared pair exposures'
]);

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export function balanceSmokeSuiteSourceKingdomIds(): string[] {
  return BALANCE_SUITE_MANIFEST.kingdoms.filter((kingdom) => kingdom.split === 'tuning')
    .map((kingdom) => kingdom.id).sort(compareCodeUnits);
}

export function createBalanceSmokeSuiteDesignContent(): Omit<BalanceSmokeSuiteDesignSource, 'digest'> {
  const sourceKingdomOrder = balanceSmokeSuiteSourceKingdomIds();
  return {
    schemaVersion: 1,
    designVersion: 'balance-smoke-suite-design-v1',
    sourceSuiteVersion: BALANCE_SUITE_MANIFEST.suiteVersion,
    sourceManifestDigest: BALANCE_SUITE_MANIFEST.digest,
    sourceKingdomOrder,
    sourceKingdomOrderDigest: sha256Canonical(sourceKingdomOrder),
    solver: { name: 'yalps', version: '0.6.4', direction: 'minimize',
      objective: 'sum of one-based source indexes', options: { ...BALANCE_SMOKE_SOLVER_OPTIONS }, wallClockTimeout: null },
    candidateSizes: BALANCE_SMOKE_CANDIDATE_BOUNDS.map((entry) => entry.count),
    cardBounds: BALANCE_SMOKE_CANDIDATE_BOUNDS.map((entry) =>
      ({ count: entry.count, minimum: entry.minimum, maximum: entry.maximum })),
    feasibility: { source: 'tuning', selectedKingdoms: 'exact candidate size', priorityPairMinimum: 1,
      requiredTripleMinimum: 1, routeMinimum: 1 },
    ascent: { neighborhood: 'all selected-to-unselected one-row exchanges',
      traversalOrder: 'selected source order, then unselected source order',
      objectiveOrder: [...BALANCE_SMOKE_ASCENT_OBJECTIVE], tieBreak: 'first exchange in source traversal order',
      optimalityClaim: 'Deterministic one-exchange local optimum from the recorded YALPS feasible seed; not a global optimum claim.' },
    candidates: []
  };
}

export function balanceSmokeSuiteDesignDigest(design: BalanceSmokeSuiteDesignSource): string {
  const content = { ...design } as Partial<BalanceSmokeSuiteDesignSource>;
  delete content.digest;
  return sha256Canonical(content);
}

function assertSame(actual: unknown, expected: unknown, message: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(message);
}

function assertOrderedSourceIds(ids: readonly string[], count: number, sourceIndex: ReadonlyMap<string, number>,
  message: string): void {
  if (ids.length !== count || new Set(ids).size !== count
    || ids.some((id) => !sourceIndex.has(id))
    || ids.some((id, index) => index > 0 && sourceIndex.get(ids[index - 1]!)! >= sourceIndex.get(id)!)) {
    throw new Error(message);
  }
}

export function validateBalanceSmokeSuiteDesignIdentity(
  input: BalanceSmokeSuiteDesignSource
): BalanceSmokeSuiteDesignSource {
  const expected = createBalanceSmokeSuiteDesignContent();
  if (input.schemaVersion !== expected.schemaVersion || input.designVersion !== expected.designVersion) {
    throw new Error('Balance-smoke design version is invalid.');
  }
  if (input.digest !== balanceSmokeSuiteDesignDigest(input)) throw new Error('Balance-smoke design digest is invalid.');
  assertSame(input.sourceSuiteVersion, expected.sourceSuiteVersion, 'Balance-smoke source suite version is stale.');
  assertSame(input.sourceManifestDigest, expected.sourceManifestDigest, 'Balance-smoke source manifest digest is stale.');
  assertSame(input.sourceKingdomOrder, expected.sourceKingdomOrder, 'Balance-smoke source kingdom order is stale.');
  assertSame(input.sourceKingdomOrderDigest, expected.sourceKingdomOrderDigest, 'Balance-smoke source order digest is stale.');
  assertSame(input.solver, expected.solver, 'Balance-smoke solver provenance is stale.');
  assertSame(input.candidateSizes, expected.candidateSizes, 'Balance-smoke candidate sizes are stale.');
  assertSame(input.cardBounds, expected.cardBounds, 'Balance-smoke card bounds are stale.');
  assertSame(input.feasibility, expected.feasibility, 'Balance-smoke feasibility protocol is stale.');
  assertSame(input.ascent, expected.ascent, 'Balance-smoke ascent protocol is stale.');
  if (input.candidates.length !== BALANCE_SMOKE_CANDIDATE_BOUNDS.length) {
    throw new Error('Balance-smoke candidate count is stale.');
  }
  const sourceIndex = new Map(input.sourceKingdomOrder.map((id, index) => [id, index]));
  for (const [candidateIndex, candidate] of input.candidates.entries()) {
    const bound = BALANCE_SMOKE_CANDIDATE_BOUNDS[candidateIndex]!;
    if (candidate.count !== bound.count || candidate.cardMinimum !== bound.minimum
      || candidate.cardMaximum !== bound.maximum || candidate.solverStatus !== 'optimal') {
      throw new Error(`Balance-smoke candidate ${bound.count} provenance is invalid.`);
    }
    assertOrderedSourceIds(candidate.initialKingdomIds, bound.count, sourceIndex,
      `Balance-smoke candidate ${bound.count} initial IDs are invalid.`);
    assertOrderedSourceIds(candidate.finalKingdomIds, bound.count, sourceIndex,
      `Balance-smoke candidate ${bound.count} final IDs are invalid.`);
    if (candidate.acceptedExchanges.some((exchange) => !sourceIndex.has(exchange.removeKingdomId)
      || !sourceIndex.has(exchange.insertKingdomId))) {
      throw new Error(`Balance-smoke candidate ${bound.count} exchange IDs are invalid.`);
    }
  }
  return input;
}

export function serializeBalanceSmokeSuiteDesign(design: BalanceSmokeSuiteDesignSource): string {
  return `${JSON.stringify(design, null, 2)}\n`;
}
