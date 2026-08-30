import { createHash } from 'node:crypto';
import rawCoveringDesign from './balance-suite-covering-design-v2.json' with { type: 'json' };
import { ALWAYS_AVAILABLE_ACTION_IDS, CARDS, TREASURE_IDS, VARIABLE_ACTION_IDS } from '../game';
import type { CardDefinition, Kingdom } from '../game';

export type BalanceSuiteSplit = 'tuning' | 'validation';
export type BalanceRouteLabel =
  | 'mana-route' | 'melee-route' | 'ranged-route' | 'draw-rich' | 'deck-shaping'
  | 'high-cost-economy' | 'mana-melee' | 'mana-ranged' | 'melee-ranged'
  | 'all-damage-families' | 'improvise-mix' | 'mana-focused' | 'melee-focused'
  | 'ranged-focused';

export interface BalanceSuiteProvenance {
  kind: 'authored' | 'generated';
  rationaleId: string;
  reason: string;
  sourceId?: string | undefined;
  sourceDigest?: string | undefined;
}

export interface BalanceSuiteKingdom extends Kingdom {
  split: BalanceSuiteSplit;
  routeLabels: BalanceRouteLabel[];
  provenance: BalanceSuiteProvenance;
  rowDigest: string;
}

export interface NumericDistribution {
  histogram: Record<string, number>;
  mean: number;
  median: number;
  p90: number;
  p95: number;
  p99: number;
  maximum: number;
}

export interface BalanceSuiteDesign {
  cardCountMinimum: number;
  cardCountMaximum: number;
  cardCounts: Record<string, number>;
  pairCountMinimum: number;
  pairCountMaximum: number;
  pairCountStandardDeviation: number;
  pairCounts: Record<string, number>;
  pairCovered: number;
  pairTotal: number;
  tripleCountMinimum: number;
  tripleCountMaximum: number;
  tripleCounts: Record<string, number>;
  tripleCovered: number;
  tripleTotal: number;
  tripleCoverage: number;
  largestOverlap: number;
  overlap: NumericDistribution;
  jaccard: NumericDistribution;
  routeCounts: Record<BalanceRouteLabel, number>;
  duplicateRows: number;
  invalidRows: number;
}

export interface BalanceCandidateSummary {
  count: number;
  tuningSize: number;
  validationSize: number;
  passed: boolean;
  failures: string[];
  cardMinimum: number;
  tuningCardMinimum: number;
  validationCardMinimum: number;
  pairMinimum: number;
  validationPairMinimum: number;
  priorityPairMinimum: number;
  validationPriorityPairMinimum: number;
  requiredTripleMinimum: number;
  validationRequiredTripleMinimum: number;
  tripleCovered: number;
  tripleCoverage: number;
  largestOverlap: number;
  overlapMean: number;
  overlapP99: number;
  jaccardMean: number;
  pairCountStandardDeviation: number;
  deficits: { fullPairs: number; validationPairs: number; priorityPairs: number; validationPriorityPairs: number;
    requiredTriples: number; validationRequiredTriples: number; routes: number; validationRoutes: number };
  routeCounts: Record<BalanceRouteLabel, number>;
  validationRouteCounts: Record<BalanceRouteLabel, number>;
}

type BalanceCardDefinition = Omit<CardDefinition, 'headline' | 'detail'>;

export interface BalanceSuiteManifest {
  schemaVersion: 2;
  suiteVersion: 'balance-suite-v4';
  generatorVersion: 'deterministic-covering-v2';
  taxonomyVersion: 'kingdom-taxonomy-v1';
  interactionVersion: 'kingdom-interactions-v1';
  methodologyVersion: 'coverage-thresholds-v1';
  digest: string;
  campaignProtocolStatus: 'pending-k009-consistency';
  kingdomSize: 10;
  chosenCount: number;
  selection: {
    rule: string;
    requiredCandidateSizes: number[];
    testedCandidateSizes: number[];
    candidates: BalanceCandidateSummary[];
  };
  generator: {
    baseSeed: number;
    seedDerivation: string;
    greedyCandidatesPerRow: number;
    constructionRestarts: number;
    selectedDesignSourceDigest: string;
    selectedDesignSearch: Record<string, unknown>;
    objectiveOrder: string[];
    tieBreak: string;
    percentileMethod: string;
    serialization: string;
  };
  cardPool: {
    orderedVariableCardIds: string[];
    fixedActionCardIds: string[];
    treasureCardIds: string[];
    nonMarketCardIds: string[];
    variableCount: number;
    kingdomCount: number;
    digest: string;
    semantics: {
      variable: BalanceCardDefinition[];
      fixedAction: BalanceCardDefinition[];
      treasure: BalanceCardDefinition[];
      nonMarket: BalanceCardDefinition[];
    };
  };
  taxonomy: {
    digest: string;
    roles: Record<string, string[]>;
    costBands: { low: string[]; middle: string[]; high: string[] };
  };
  thresholds: {
    card: { fullMinimum: 40; tuningMinimum: 32; validationMinimum: 8; maximumRange: 1 };
    pair: { fullMinimum: 8; validationMinimum: 1; priorityFullMinimum: 12; priorityValidationMinimum: 2 };
    triple: { requiredFullMinimum: 4; requiredValidationMinimum: 1; coveredMinimum: 9090; total: 9880 };
    distinctness: { maximumOverlap: 6; maximumJaccard: number; maximumOverlapP99: 5 };
    routes: Record<BalanceRouteLabel, { fullMinimum: number; validationMinimum: 1 }>;
  };
  interactions: {
    priorityPairs: { id: string; cards: [string, string]; reason: string; count: number; validationCount: number }[];
    requiredTriples: { id: string; cards: [string, string, string]; reason: string; count: number; validationCount: number }[];
  };
  randomBaselines: {
    assumptions: string[];
    actualPool: { cards: 40; choose10: number; cardProbability: number; pairProbability: number; tripleProbability: number };
    comparisonPool: { cards: 45; choose10: number; cardProbability: number; pairProbability: number; tripleProbability: number };
    candidates: { count: number; cardExpected: number; pairExpected: number; tripleExpected: number;
      expectedUncoveredCards: number; expectedUncoveredPairs: number; expectedUncoveredTriples: number;
      everyCardOnceSuccessLower: number; everyPairOnceSuccessLower: number; everyTripleOnceSuccessLower: number;
      everyCardFortySuccessLower: number; everyPairEightSuccessLower: number;
      priorityPairTwelveSuccessLower: number; requiredTripleFourSuccessLower: number }[];
    highProbabilityBounds: Record<string, number>;
    randomOverlap: { expected: number; expectedJaccard: number; histogram: Record<string, number> };
  };
  deterministicLowerBounds: Record<string, number>;
  rawFeasibilityPilot: { count: number; cardMinimum: number; cardMaximum: number;
    pairMinimum: number; pairMaximum: number; tripleCovered: number; tripleCoverage: number;
    maximumOverlap: number }[];
  splits: { name: BalanceSuiteSplit; seed: number; size: number; design: BalanceSuiteDesign }[];
  statistics: BalanceSuiteDesign;
  authoredOverlapMatrix: { left: string; right: string; overlap: number }[];
  residualBlindSpots: {
    uncoveredTripleCount: number;
    uncoveredByFamilyPattern: Record<string, number>;
    completeTripleCoverageClaimed: false;
    completeHigherOrderCoverageClaimed: false;
  };
  kingdoms: BalanceSuiteKingdom[];
}

interface DesignRow {
  cards: string[];
  split: BalanceSuiteSplit;
  provenance: BalanceSuiteProvenance;
  authored: boolean;
}

interface CandidateDesign {
  count: number;
  rows: DesignRow[];
  full: BalanceSuiteDesign;
  tuning: BalanceSuiteDesign;
  validation: BalanceSuiteDesign;
  summary: BalanceCandidateSummary;
}

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const sorted = (values: readonly string[]): string[] => [...values].sort(compareCodeUnits);
const ELIGIBLE = Object.freeze(sorted(VARIABLE_ACTION_IDS));
const ELIGIBLE_SET = new Set(ELIGIBLE);
const KINGDOM_SIZE = 10;
const BASE_SEED = 0x4b535634;
const GREEDY_CANDIDATES = 200;
const CONSTRUCTION_RESTARTS = 16;
const MAX_OVERLAP = 6;
const REQUIRED_CANDIDATES = Object.freeze([50, 100, 150, 152, 156, 160, 200]);
const RAW_FEASIBILITY_PILOT = Object.freeze([
  { count: 50, cardMinimum: 12, cardMaximum: 13, pairMinimum: 1, pairMaximum: 5,
    tripleCovered: 5235, tripleCoverage: 0.529858299595, maximumOverlap: 5 },
  { count: 100, cardMinimum: 25, cardMaximum: 25, pairMinimum: 4, pairMaximum: 8,
    tripleCovered: 7944, tripleCoverage: 0.804048582996, maximumOverlap: 6 },
  { count: 150, cardMinimum: 37, cardMaximum: 38, pairMinimum: 7, pairMaximum: 11,
    tripleCovered: 9103, tripleCoverage: 0.921356275304, maximumOverlap: 7 },
  { count: 152, cardMinimum: 38, cardMaximum: 38, pairMinimum: 7, pairMaximum: 11,
    tripleCovered: 9103, tripleCoverage: 0.921356275304, maximumOverlap: 7 },
  { count: 156, cardMinimum: 39, cardMaximum: 39, pairMinimum: 7, pairMaximum: 11,
    tripleCovered: 9146, tripleCoverage: 0.925708502024, maximumOverlap: 7 },
  { count: 160, cardMinimum: 40, cardMaximum: 40, pairMinimum: 7, pairMaximum: 12,
    tripleCovered: 9192, tripleCoverage: 0.93036437247, maximumOverlap: 7 },
  { count: 200, cardMinimum: 50, cardMaximum: 50, pairMinimum: 10, pairMaximum: 14,
    tripleCovered: 9562, tripleCoverage: 0.967813765182, maximumOverlap: 7 }
]);

const ROLE_IDS = Object.freeze({
  manaSource: ['channel', 'leyStep', 'attune', 'prism'],
  manaPayoff: ['arcBolt', 'fireball', 'starfire', 'discharge', 'cascade', 'overload'],
  directDamage: ['arcBolt', 'fireball', 'starfire', 'discharge', 'cascade', 'overload', 'jab', 'strike',
    'drive', 'heavyBlow', 'openingStrike', 'rally', 'bullRush', 'flurry', 'pepperingShot', 'steadyShot',
    'repellingShot', 'longshot', 'volley', 'salvageShot', 'precisionShot', 'discipline', 'improvise'],
  damageSetup: ['feint', 'aim'],
  drawSupport: ['channel', 'attune', 'prism', 'feint', 'jab', 'aim', 'pepperingShot', 'salvageShot',
    'footwork', 'stipend', 'reclaim', 'regroup', 'adapt', 'muster', 'regiment', 'sharpen', 'scour'],
  variableMovement: ['leyStep', 'drive', 'repellingShot', 'footwork'],
  economyOrGain: ['stipend', 'reforge'],
  setup: ['feint', 'aim', 'footwork', 'leyStep', 'reclaim', 'regroup', 'adapt'],
  trash: ['discipline', 'cull', 'sharpen', 'reforge', 'scour'],
  discard: ['prism', 'bullRush', 'salvageShot', 'regroup'],
  recovery: ['reclaim'],
  copyScaling: ['attune', 'rally', 'precisionShot'],
  distancePayoff: ['leyStep', 'repellingShot', 'longshot', 'volley'],
  familyDiscardPayoff: ['bullRush', 'salvageShot'],
  multiFamilyPayoff: ['improvise']
} satisfies Record<string, readonly string[]>);

const ROLE_SETS = Object.fromEntries(Object.entries(ROLE_IDS).map(([name, ids]) => [name, new Set(ids)])) as
  Record<keyof typeof ROLE_IDS, Set<string>>;

const ROUTE_THRESHOLDS: Record<BalanceRouteLabel, number> = Object.freeze({
  'mana-route': 16,
  'melee-route': 16,
  'ranged-route': 16,
  'draw-rich': 16,
  'deck-shaping': 12,
  'high-cost-economy': 12,
  'mana-melee': 8,
  'mana-ranged': 8,
  'melee-ranged': 8,
  'all-damage-families': 16,
  'improvise-mix': 8,
  'mana-focused': 4,
  'melee-focused': 4,
  'ranged-focused': 4
});
const ROUTE_LABELS = Object.freeze(Object.keys(ROUTE_THRESHOLDS).sort(compareCodeUnits) as BalanceRouteLabel[]);

function pairKey(left: string, right: string): string {
  return compareCodeUnits(left, right) < 0 ? `${left}|${right}` : `${right}|${left}`;
}
function tripleKey(first: string, second: string, third: string): string {
  return sorted([first, second, third]).join('|');
}
function rowKey(cards: readonly string[]): string { return sorted(cards).join('|'); }
function overlap(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  let count = 0;
  for (const card of left) if (rightSet.has(card)) count += 1;
  return count;
}
function combinations2(cards: readonly string[]): [string, string][] {
  const result: [string, string][] = [];
  for (let left = 0; left < cards.length; left += 1) for (let right = left + 1; right < cards.length; right += 1) {
    result.push([cards[left]!, cards[right]!]);
  }
  return result;
}
function combinations3(cards: readonly string[]): [string, string, string][] {
  const result: [string, string, string][] = [];
  for (let first = 0; first < cards.length; first += 1) for (let second = first + 1; second < cards.length; second += 1) {
    for (let third = second + 1; third < cards.length; third += 1) result.push([cards[first]!, cards[second]!, cards[third]!]);
  }
  return result;
}

const ALL_PAIR_KEYS = Object.freeze(combinations2(ELIGIBLE).map(([left, right]) => pairKey(left, right)).sort(compareCodeUnits));
const ALL_TRIPLE_KEYS = Object.freeze(combinations3(ELIGIBLE).map(([first, second, third]) => tripleKey(first, second, third)).sort(compareCodeUnits));

interface InteractionDefinition { cards: string[]; reason: string }
function expandPriorityPairs(): InteractionDefinition[] {
  const definitions = new Map<string, InteractionDefinition>();
  const add = (left: string, right: string, reason: string): void => {
    const cards = sorted([left, right]);
    definitions.set(cards.join('|'), { cards, reason });
  };
  for (const source of ROLE_IDS.manaSource) for (const payoff of ROLE_IDS.manaPayoff) add(source, payoff, 'mana source and payoff');
  for (const card of ['arcBolt', 'fireball', 'starfire', 'overload']) add('cascade', card, 'spell sequencing');
  for (const card of ['jab', 'strike', 'drive', 'heavyBlow', 'openingStrike', 'rally', 'bullRush', 'flurry']) add('feint', card, 'Feint attack');
  for (const card of ['jab', 'strike', 'drive', 'heavyBlow', 'openingStrike', 'rally', 'flurry']) add('bullRush', card, 'Bull Rush fodder');
  for (const card of ['jab', 'regroup', 'muster', 'footwork']) add('flurry', card, 'Flurry support');
  for (const card of ['pepperingShot', 'steadyShot', 'repellingShot', 'longshot', 'volley', 'salvageShot', 'precisionShot']) add('aim', card, 'Aim attack');
  for (const card of ['pepperingShot', 'steadyShot', 'repellingShot', 'longshot', 'volley', 'precisionShot']) add('salvageShot', card, 'Salvage Shot fodder');
  for (const payoff of ['repellingShot', 'longshot', 'volley']) for (const movement of ['leyStep', 'drive', 'footwork']) add(payoff, movement, 'distance and movement');
  for (const trash of ['discipline', 'cull', 'sharpen', 'scour']) for (const support of ['reclaim', 'regroup']) add(trash, support, 'trash and recovery');
  for (const card of ['discipline', 'cull', 'jab', 'pepperingShot', 'footwork', 'stipend', 'starfire', 'heavyBlow', 'volley', 'regiment']) add('reforge', card, 'Reforge input or payoff');
  for (const card of ['fireball', 'cascade', 'overload', 'heavyBlow', 'bullRush', 'flurry', 'volley', 'salvageShot', 'precisionShot']) add('improvise', card, 'Improvise family mix');
  return [...definitions.values()].sort((left, right) => compareCodeUnits(left.cards.join('|'), right.cards.join('|')));
}

const REQUIRED_TRIPLE_GROUPS = Object.freeze({
  'Mana sequencing': [
    ['channel', 'arcBolt', 'cascade'], ['channel', 'fireball', 'overload'], ['leyStep', 'fireball', 'cascade'],
    ['leyStep', 'starfire', 'overload'], ['attune', 'arcBolt', 'overload'], ['prism', 'starfire', 'cascade']],
  'Feint attack mix': [
    ['feint', 'jab', 'flurry'], ['feint', 'strike', 'heavyBlow'], ['feint', 'drive', 'openingStrike'],
    ['feint', 'rally', 'bullRush'], ['feint', 'bullRush', 'flurry'], ['feint', 'heavyBlow', 'openingStrike']],
  'Bull Rush fodder and support': [
    ['bullRush', 'jab', 'regroup'], ['bullRush', 'strike', 'reclaim'], ['bullRush', 'drive', 'footwork'],
    ['bullRush', 'heavyBlow', 'muster'], ['bullRush', 'rally', 'sharpen'], ['bullRush', 'openingStrike', 'scour']],
  'Flurry support': [
    ['flurry', 'jab', 'regroup'], ['flurry', 'feint', 'muster'], ['flurry', 'footwork', 'adapt'],
    ['flurry', 'channel', 'attune'], ['flurry', 'sharpen', 'reclaim'], ['flurry', 'prism', 'regroup']],
  'Aim attack mix': [
    ['aim', 'pepperingShot', 'salvageShot'], ['aim', 'steadyShot', 'precisionShot'], ['aim', 'repellingShot', 'longshot'],
    ['aim', 'volley', 'salvageShot'], ['aim', 'longshot', 'precisionShot'], ['aim', 'repellingShot', 'volley']],
  'Salvage Shot fodder and support': [
    ['salvageShot', 'pepperingShot', 'regroup'], ['salvageShot', 'steadyShot', 'reclaim'],
    ['salvageShot', 'repellingShot', 'footwork'], ['salvageShot', 'longshot', 'muster'],
    ['salvageShot', 'precisionShot', 'sharpen'], ['salvageShot', 'volley', 'scour']],
  'Distance and movement': [
    ['longshot', 'leyStep', 'aim'], ['longshot', 'drive', 'salvageShot'], ['longshot', 'footwork', 'aim'],
    ['volley', 'leyStep', 'salvageShot'], ['volley', 'footwork', 'aim'], ['repellingShot', 'drive', 'aim']],
  'Trash and payoff': [
    ['discipline', 'regroup', 'arcBolt'], ['cull', 'reclaim', 'heavyBlow'], ['sharpen', 'regroup', 'volley'],
    ['scour', 'reclaim', 'improvise'], ['cull', 'regroup', 'improvise'], ['discipline', 'reclaim', 'precisionShot']],
  'Reforge input and payoff': [
    ['reforge', 'discipline', 'starfire'], ['reforge', 'cull', 'heavyBlow'], ['reforge', 'jab', 'volley'],
    ['reforge', 'pepperingShot', 'regiment'], ['reforge', 'stipend', 'starfire'], ['reforge', 'footwork', 'heavyBlow']],
  'Improvise family mix': [
    ['improvise', 'fireball', 'heavyBlow'], ['improvise', 'cascade', 'bullRush'], ['improvise', 'overload', 'flurry'],
    ['improvise', 'fireball', 'volley'], ['improvise', 'cascade', 'salvageShot'], ['improvise', 'bullRush', 'precisionShot']]
} satisfies Record<string, readonly (readonly string[])[]>);

function expandRequiredTriples(): InteractionDefinition[] {
  return Object.entries(REQUIRED_TRIPLE_GROUPS).flatMap(([reason, triples]) => triples.map((cards) => ({
    cards: sorted(cards), reason
  }))).sort((left, right) => compareCodeUnits(left.cards.join('|'), right.cards.join('|')));
}

export const PRIORITY_PAIRS = Object.freeze(expandPriorityPairs());
export const REQUIRED_TRIPLES = Object.freeze(expandRequiredTriples());
const PRIORITY_PAIR_KEYS = new Set(PRIORITY_PAIRS.map((entry) => entry.cards.join('|')));
const REQUIRED_TRIPLE_KEYS = new Set(REQUIRED_TRIPLES.map((entry) => entry.cards.join('|')));

const authored = (split: BalanceSuiteSplit, rationaleId: string, sourceId: string | undefined,
  reason: string, cards: readonly string[]): DesignRow => ({
  cards: sorted(cards), split, authored: true,
  provenance: { kind: 'authored', rationaleId, reason, ...(sourceId ? { sourceId } : {}) }
});

const AUTHORED_ROWS: readonly DesignRow[] = Object.freeze([
  authored('validation', 'builtin-distance-duel', 'distance-duel', 'Human-play continuity control',
    ['cull', 'footwork', 'feint', 'jab', 'drive', 'flurry', 'aim', 'pepperingShot', 'repellingShot', 'volley']),
  authored('tuning', 'builtin-current-duel', 'current-duel', 'Human-play continuity control',
    ['cull', 'channel', 'attune', 'arcBolt', 'cascade', 'feint', 'rally', 'aim', 'precisionShot', 'improvise']),
  authored('tuning', 'builtin-three-way-open', 'three-way-open', 'Human-play continuity control',
    ['cull', 'leyStep', 'fireball', 'discharge', 'footwork', 'drive', 'longshot', 'volley', 'stipend', 'improvise']),
  authored('validation', 'builtin-three-way-engine', 'three-way-engine', 'Human-play continuity control',
    ['cull', 'channel', 'attune', 'overload', 'jab', 'rally', 'pepperingShot', 'precisionShot', 'regroup', 'improvise']),
  authored('validation', 'builtin-range-rich-mixed', 'range-rich-mixed', 'Human-play continuity control',
    ['cull', 'leyStep', 'adapt', 'fireball', 'bullRush', 'heavyBlow', 'aim', 'repellingShot', 'longshot', 'salvageShot']),
  authored('tuning', 'strategy-search-continuity-anchor', undefined, 'Strategy-search continuity anchor',
    ['channel', 'improvise', 'longshot', 'precisionShot', 'reclaim', 'reforge', 'salvageShot', 'scour', 'sharpen', 'strike']),
  authored('tuning', 'thin-mana-control', undefined, 'Measures dependence on always-available Focus',
    ['arcBolt', 'fireball', 'starfire', 'discharge', 'cascade', 'overload', 'stipend', 'jab', 'pepperingShot', 'reclaim']),
  authored('validation', 'fixed-movement-control', undefined, 'Measures dependence on always-available Step',
    ['feint', 'jab', 'strike', 'heavyBlow', 'openingStrike', 'rally', 'bullRush', 'flurry', 'longshot', 'volley']),
  authored('tuning', 'high-cost-choke', undefined, 'Measures slow baseline economy and search failure',
    ['prism', 'starfire', 'cascade', 'overload', 'heavyBlow', 'flurry', 'volley', 'regiment', 'channel', 'strike'])
]);

class Random {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || 1; }
  next(): number {
    let value = this.state;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }
  int(maximum: number): number { return Math.floor(this.next() * maximum); }
  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.int(index + 1);
      [result[index], result[other]] = [result[other]!, result[index]!];
    }
    return result;
  }
}

function seedFor(count: number, split: BalanceSuiteSplit, restart = 0): number {
  return (BASE_SEED ^ Math.imul(count, 0x9e3779b1) ^ (split === 'tuning' ? 0x51a7c3d9 : 0xc04f82b1)
    ^ Math.imul(restart + 1, 0x85ebca6b)) >>> 0;
}

function countIn(cards: readonly string[], set: ReadonlySet<string>): number {
  let count = 0;
  for (const card of cards) if (set.has(card)) count += 1;
  return count;
}
function familyDamageCount(cards: readonly string[], family: string): number {
  return cards.filter((card) => ROLE_SETS.directDamage.has(card) && CARDS[card]!.family === family).length;
}
export function routeLabels(cards: readonly string[]): BalanceRouteLabel[] {
  const labels: BalanceRouteLabel[] = [];
  const movementOrFeint = new Set([...ROLE_IDS.variableMovement, 'feint']);
  const movementOrAim = new Set([...ROLE_IDS.variableMovement, 'aim']);
  const shaping = new Set([...ROLE_IDS.trash, ...ROLE_IDS.recovery, ...ROLE_IDS.economyOrGain]);
  const manaDamage = familyDamageCount(cards, 'mana');
  const meleeDamage = familyDamageCount(cards, 'melee');
  const rangedDamage = familyDamageCount(cards, 'ranged');
  if (countIn(cards, ROLE_SETS.manaSource) >= 1 && countIn(cards, ROLE_SETS.manaPayoff) >= 1) labels.push('mana-route');
  if (meleeDamage >= 2 && countIn(cards, movementOrFeint) >= 1) labels.push('melee-route');
  if (rangedDamage >= 2 && countIn(cards, movementOrAim) >= 1) labels.push('ranged-route');
  if (countIn(cards, ROLE_SETS.drawSupport) >= 3) labels.push('draw-rich');
  if (countIn(cards, shaping) >= 3) labels.push('deck-shaping');
  if (cards.filter((card) => CARDS[card]!.cost >= 5).length >= 3 && (cards.includes('stipend') || cards.includes('reforge'))) labels.push('high-cost-economy');
  if (manaDamage >= 2 && meleeDamage >= 2) labels.push('mana-melee');
  if (manaDamage >= 2 && rangedDamage >= 2) labels.push('mana-ranged');
  if (meleeDamage >= 2 && rangedDamage >= 2) labels.push('melee-ranged');
  if (manaDamage >= 1 && meleeDamage >= 1 && rangedDamage >= 1) labels.push('all-damage-families');
  if (cards.includes('improvise') && [manaDamage, meleeDamage, rangedDamage].filter((count) => count >= 1).length >= 2) labels.push('improvise-mix');
  if (cards.filter((card) => CARDS[card]!.family === 'mana').length >= 5
    && countIn(cards, ROLE_SETS.manaSource) >= 2 && countIn(cards, ROLE_SETS.manaPayoff) >= 2) labels.push('mana-focused');
  if (cards.filter((card) => CARDS[card]!.family === 'melee').length >= 5 && meleeDamage >= 4) labels.push('melee-focused');
  if (cards.filter((card) => CARDS[card]!.family === 'ranged').length >= 5 && rangedDamage >= 4) labels.push('ranged-focused');
  return labels.sort(compareCodeUnits);
}

function ordinaryRowValid(cards: readonly string[]): boolean {
  return cards.length === KINGDOM_SIZE && new Set(cards).size === KINGDOM_SIZE
    && cards.every((card) => ELIGIBLE_SET.has(card))
    && countIn(cards, ROLE_SETS.directDamage) >= 2
    && (countIn(cards, ROLE_SETS.drawSupport) + countIn(cards, ROLE_SETS.economyOrGain)
      + countIn(cards, ROLE_SETS.trash) + countIn(cards, ROLE_SETS.recovery)) >= 1
    && cards.some((card) => CARDS[card]!.cost <= 3)
    && cards.some((card) => CARDS[card]!.cost >= 5);
}

function splitSizes(count: number): { tuning: number; validation: number } {
  const predefined = new Map<number, [number, number]>([[50, [40, 10]], [100, [80, 20]], [150, [120, 30]],
    [152, [120, 32]], [156, [124, 32]], [160, [128, 32]], [200, [160, 40]]]);
  const fixed = predefined.get(count);
  if (fixed) return { tuning: fixed[0], validation: fixed[1] };
  const validation = Math.floor(count / 5);
  return { tuning: count - validation, validation };
}

function quotaMaps(count: number, random: Random): Record<BalanceSuiteSplit, Map<string, number>> {
  const sizes = splitSizes(count);
  const tuningSlots = sizes.tuning * KINGDOM_SIZE, validationSlots = sizes.validation * KINGDOM_SIZE;
  const tuningBase = Math.floor(tuningSlots / ELIGIBLE.length), tuningExtra = tuningSlots % ELIGIBLE.length;
  const validationBase = Math.floor(validationSlots / ELIGIBLE.length), validationExtra = validationSlots % ELIGIBLE.length;
  const authoredCounts = Object.fromEntries((['tuning', 'validation'] as const).map((split) => [split,
    new Map(ELIGIBLE.map((card) => [card, AUTHORED_ROWS.filter((row) => row.split === split && row.cards.includes(card)).length]))])) as
    Record<BalanceSuiteSplit, Map<string, number>>;
  const mandatoryTuning = new Set(ELIGIBLE.filter((card) => authoredCounts.tuning.get(card)! > tuningBase));
  const mandatoryValidation = new Set(ELIGIBLE.filter((card) => authoredCounts.validation.get(card)! > validationBase));
  if ([...mandatoryTuning].some((card) => authoredCounts.tuning.get(card)! > tuningBase + 1)
    || [...mandatoryValidation].some((card) => authoredCounts.validation.get(card)! > validationBase + 1)
    || mandatoryTuning.size > tuningExtra || mandatoryValidation.size > validationExtra) {
    throw new Error(`Authored rows cannot fit balanced ${count}-row quotas.`);
  }
  const order = random.shuffle(ELIGIBLE);
  let tuningExtraSet: Set<string>, validationExtraSet: Set<string>;
  if (tuningExtra + validationExtra <= ELIGIBLE.length) {
    if ([...mandatoryTuning].some((card) => mandatoryValidation.has(card))) {
      throw new Error(`Authored ${count}-row extras cannot keep the full-card range at one.`);
    }
    tuningExtraSet = new Set(mandatoryTuning); validationExtraSet = new Set(mandatoryValidation);
    for (const card of order) if (tuningExtraSet.size < tuningExtra && !validationExtraSet.has(card)) tuningExtraSet.add(card);
    for (const card of order) if (validationExtraSet.size < validationExtra && !tuningExtraSet.has(card)) validationExtraSet.add(card);
  } else {
    const tuningOmissions = new Set<string>(), validationOmissions = new Set<string>();
    for (const card of order) if (tuningOmissions.size < ELIGIBLE.length - tuningExtra && !mandatoryTuning.has(card)) tuningOmissions.add(card);
    for (const card of order) if (validationOmissions.size < ELIGIBLE.length - validationExtra
      && !mandatoryValidation.has(card) && !tuningOmissions.has(card)) validationOmissions.add(card);
    tuningExtraSet = new Set(ELIGIBLE.filter((card) => !tuningOmissions.has(card)));
    validationExtraSet = new Set(ELIGIBLE.filter((card) => !validationOmissions.has(card)));
  }
  if (tuningExtraSet.size !== tuningExtra || validationExtraSet.size !== validationExtra) {
    throw new Error(`Could not allocate balanced ${count}-row extras.`);
  }
  return {
    tuning: new Map(ELIGIBLE.map((card) => [card, tuningBase + Number(tuningExtraSet.has(card))])),
    validation: new Map(ELIGIBLE.map((card) => [card, validationBase + Number(validationExtraSet.has(card))]))
  };
}

function addCounts(rows: readonly DesignRow[]): { pairs: Map<string, number>; triples: Map<string, number>;
  validationPairs: Map<string, number>; validationTriples: Map<string, number>; routes: Map<BalanceRouteLabel, number>;
  validationRoutes: Map<BalanceRouteLabel, number> } {
  const pairs = new Map(ALL_PAIR_KEYS.map((key) => [key, 0]));
  const triples = new Map(ALL_TRIPLE_KEYS.map((key) => [key, 0]));
  const validationPairs = new Map(ALL_PAIR_KEYS.map((key) => [key, 0]));
  const validationTriples = new Map(ALL_TRIPLE_KEYS.map((key) => [key, 0]));
  const routes = new Map(ROUTE_LABELS.map((label) => [label, 0]));
  const validationRoutes = new Map(ROUTE_LABELS.map((label) => [label, 0]));
  for (const row of rows) {
    for (const [left, right] of combinations2(row.cards)) {
      const key = pairKey(left, right);
      pairs.set(key, pairs.get(key)! + 1);
      if (row.split === 'validation') validationPairs.set(key, validationPairs.get(key)! + 1);
    }
    for (const [first, second, third] of combinations3(row.cards)) {
      const key = tripleKey(first, second, third);
      triples.set(key, triples.get(key)! + 1);
      if (row.split === 'validation') validationTriples.set(key, validationTriples.get(key)! + 1);
    }
    for (const label of routeLabels(row.cards)) {
      routes.set(label, routes.get(label)! + 1);
      if (row.split === 'validation') validationRoutes.set(label, validationRoutes.get(label)! + 1);
    }
  }
  return { pairs, triples, validationPairs, validationTriples, routes, validationRoutes };
}

function targetTemplate(split: BalanceSuiteSplit, generatedIndex: number): BalanceRouteLabel | null {
  const cycle: BalanceRouteLabel[] = split === 'validation'
    ? ['mana-focused', 'melee-focused', 'ranged-focused', 'deck-shaping', 'high-cost-economy']
    : ['mana-focused', 'melee-focused', 'ranged-focused', 'mana-focused', 'melee-focused', 'ranged-focused',
      'deck-shaping', 'high-cost-economy', 'deck-shaping', 'high-cost-economy'];
  return generatedIndex < cycle.length ? cycle[generatedIndex]! : null;
}

function addTemplate(chosen: Set<string>, label: BalanceRouteLabel | null, remaining: ReadonlyMap<string, number>,
  random: Random): void {
  const available = (predicate: (card: string) => boolean): string[] => random.shuffle(ELIGIBLE
    .filter((card) => predicate(card) && (remaining.get(card) ?? 0) > 0 && !chosen.has(card)));
  const addMany = (cards: readonly string[], amount: number): void => {
    for (const card of cards) { if (chosen.size >= KINGDOM_SIZE || amount <= 0) break; chosen.add(card); amount -= 1; }
  };
  if (label === 'mana-focused') {
    addMany(available((card) => ROLE_SETS.manaSource.has(card)), 2);
    addMany(available((card) => ROLE_SETS.manaPayoff.has(card)), 2);
    addMany(available((card) => CARDS[card]!.family === 'mana'), 1);
  } else if (label === 'melee-focused' || label === 'ranged-focused') {
    const family = label === 'melee-focused' ? 'melee' : 'ranged';
    addMany(available((card) => CARDS[card]!.family === family && ROLE_SETS.directDamage.has(card)), 4);
    addMany(available((card) => CARDS[card]!.family === family), 1);
  } else if (label === 'deck-shaping') {
    const shaping = new Set([...ROLE_IDS.trash, ...ROLE_IDS.recovery, ...ROLE_IDS.economyOrGain]);
    addMany(available((card) => shaping.has(card)), 3);
  } else if (label === 'high-cost-economy') {
    addMany(available((card) => card === 'stipend' || card === 'reforge'), 1);
    addMany(available((card) => CARDS[card]!.cost >= 5), 3);
  }
}

function sampleCandidate(remaining: ReadonlyMap<string, number>, rowsAfter: number, random: Random,
  template: BalanceRouteLabel | null, seedCards: readonly string[]): string[] | null {
  const forced = ELIGIBLE.filter((card) => (remaining.get(card) ?? 0) > rowsAfter);
  if (forced.length > KINGDOM_SIZE) return null;
  const chosen = new Set(forced);
  for (const card of seedCards) if ((remaining.get(card) ?? 0) > 0 && chosen.size < KINGDOM_SIZE) chosen.add(card);
  addTemplate(chosen, template, remaining, random);
  while (chosen.size < KINGDOM_SIZE) {
    const candidates = ELIGIBLE.filter((card) => (remaining.get(card) ?? 0) > 0 && !chosen.has(card));
    if (!candidates.length) return null;
    const total = candidates.reduce((sum, card) => sum + (remaining.get(card) ?? 0) ** 2, 0);
    let pick = random.next() * total;
    let selected = candidates[candidates.length - 1]!;
    for (const card of candidates) {
      pick -= (remaining.get(card) ?? 0) ** 2;
      if (pick <= 0) { selected = card; break; }
    }
    chosen.add(selected);
  }
  const result = sorted([...chosen]);
  return ordinaryRowValid(result) ? result : null;
}

function constructionScore(cards: readonly string[], split: BalanceSuiteSplit,
  counts: ReturnType<typeof addCounts>, rows: readonly DesignRow[]): number[] {
  let fullPairGain = 0, validationPairGain = 0;
  let requiredGain = 0, unseenTriples = 0, pairPressure = 0;
  for (const [left, right] of combinations2(cards)) {
    const key = pairKey(left, right), current = counts.pairs.get(key)!;
    const target = PRIORITY_PAIR_KEYS.has(key) ? 12 : 8;
    fullPairGain += 2 * (target - current) - 1;
    pairPressure += current * current;
    if (split === 'validation') {
      const validation = counts.validationPairs.get(key)!;
      validationPairGain += 2 * ((PRIORITY_PAIR_KEYS.has(key) ? 2 : 1) - validation) - 1;
    }
  }
  for (const [first, second, third] of combinations3(cards)) {
    const key = tripleKey(first, second, third), current = counts.triples.get(key)!;
    unseenTriples += Number(current === 0);
    if (REQUIRED_TRIPLE_KEYS.has(key)) {
      requiredGain += 2 * (4 - current) - 1;
      if (split === 'validation') requiredGain += 2 * (1 - counts.validationTriples.get(key)!) - 1;
    }
  }
  let routeGain = 0;
  for (const label of routeLabels(cards)) {
    routeGain += Number(counts.routes.get(label)! < ROUTE_THRESHOLDS[label]);
    if (split === 'validation') routeGain += 4 * Number(counts.validationRoutes.get(label)! < 1);
  }
  const overlapSix = rows.filter((row) => overlap(cards, row.cards) === 6).length;
  return [validationPairGain + fullPairGain, requiredGain, routeGain, unseenTriples,
    -pairPressure, -overlapSix];
}

function compareScore(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]! !== right[index]!) return left[index]! > right[index]! ? 1 : -1;
  }
  return 0;
}

function buildInitialRows(count: number, restart: number): DesignRow[] {
  const random = new Random(seedFor(count, 'tuning', restart));
  const quotas = quotaMaps(count, random);
  const sizes = splitSizes(count);
  const rows = AUTHORED_ROWS.map((row) => ({ ...row, cards: [...row.cards], provenance: { ...row.provenance } }));
  for (const row of rows) for (const card of row.cards) quotas[row.split].set(card, quotas[row.split].get(card)! - 1);
  if (Object.values(quotas).some((map) => [...map.values()].some((value) => value < 0))) {
    throw new Error(`Authored rows exceed a ${count}-row split quota.`);
  }
  const counts = addCounts(rows);
  const keys = new Set(rows.map((row) => rowKey(row.cards)));
  for (const split of ['validation', 'tuning'] as const) {
    const authoredCount = rows.filter((row) => row.split === split).length;
    const generatedCount = sizes[split] - authoredCount;
    const remaining = quotas[split];
    for (let generatedIndex = 0; generatedIndex < generatedCount; generatedIndex += 1) {
      const rowsAfter = generatedCount - generatedIndex - 1;
      let best: string[] | null = null, bestScore: number[] | null = null;
      const template = targetTemplate(split, generatedIndex);
      for (let attempt = 0; attempt < GREEDY_CANDIDATES; attempt += 1) {
        const priorityNeeds = PRIORITY_PAIRS.filter((entry) => entry.cards.every((card) => (remaining.get(card) ?? 0) > 0)
          && counts.pairs.get(entry.cards.join('|'))! < 12
          && (split !== 'validation' || counts.validationPairs.get(entry.cards.join('|'))! < 2));
        const tripleNeeds = REQUIRED_TRIPLES.filter((entry) => entry.cards.every((card) => (remaining.get(card) ?? 0) > 0)
          && counts.triples.get(entry.cards.join('|'))! < 4
          && (split !== 'validation' || counts.validationTriples.get(entry.cards.join('|'))! < 1));
        const seedCards = new Set<string>();
        const priority = priorityNeeds.length ? priorityNeeds[attempt % priorityNeeds.length] : undefined;
        const triple = tripleNeeds.length ? tripleNeeds[Math.floor(attempt / 2) % tripleNeeds.length] : undefined;
        if (attempt % 4 === 0 || attempt % 4 === 2) for (const card of priority?.cards ?? []) seedCards.add(card);
        if (attempt % 4 === 1 || attempt % 4 === 2) for (const card of triple?.cards ?? []) seedCards.add(card);
        const candidate = sampleCandidate(remaining, rowsAfter, random, template, [...seedCards]);
        if (!candidate || keys.has(rowKey(candidate)) || rows.some((row) => overlap(candidate, row.cards) > MAX_OVERLAP)) continue;
        const score = constructionScore(candidate, split, counts, rows);
        if (!bestScore || compareScore(score, bestScore) > 0
          || (compareScore(score, bestScore) === 0 && rowKey(candidate) < rowKey(best!))) {
          best = candidate; bestScore = score;
        }
      }
      if (!best) throw new Error(`Could not build ${count}-row ${split} row ${generatedIndex + 1}.`);
      const row: DesignRow = { cards: best, split, authored: false,
        provenance: { kind: 'generated', rationaleId: 'balanced-covering', reason: 'Deterministic balanced covering row' } };
      rows.push(row); keys.add(rowKey(best));
      for (const card of best) remaining.set(card, remaining.get(card)! - 1);
      for (const [left, right] of combinations2(best)) {
        const key = pairKey(left, right); counts.pairs.set(key, counts.pairs.get(key)! + 1);
        if (split === 'validation') counts.validationPairs.set(key, counts.validationPairs.get(key)! + 1);
      }
      for (const [first, second, third] of combinations3(best)) {
        const key = tripleKey(first, second, third); counts.triples.set(key, counts.triples.get(key)! + 1);
        if (split === 'validation') counts.validationTriples.set(key, counts.validationTriples.get(key)! + 1);
      }
      for (const label of routeLabels(best)) {
        counts.routes.set(label, counts.routes.get(label)! + 1);
        if (split === 'validation') counts.validationRoutes.set(label, counts.validationRoutes.get(label)! + 1);
      }
    }
    if ([...remaining.values()].some((value) => value !== 0)) throw new Error(`Incomplete ${split} quota at ${count} rows.`);
  }
  return rows;
}

function histogram(values: readonly number[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[String(value)] = (result[String(value)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => Number(left) - Number(right)));
}
function round(value: number): number { return Number(value.toFixed(12)); }
function nearestRank(values: readonly number[], percentile: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(percentile * ordered.length) - 1)]!;
}
function numericDistribution(values: readonly number[]): NumericDistribution {
  if (!values.length) return { histogram: {}, mean: 0, median: 0, p90: 0, p95: 0, p99: 0, maximum: 0 };
  return { histogram: histogram(values), mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    median: round(nearestRank(values, 0.5)), p90: round(nearestRank(values, 0.9)),
    p95: round(nearestRank(values, 0.95)), p99: round(nearestRank(values, 0.99)), maximum: round(Math.max(...values)) };
}

export function measureBalanceSuiteDesign(rowsInput: readonly (readonly string[])[], eligibleInput: readonly string[] = ELIGIBLE): BalanceSuiteDesign {
  const eligible = sorted(eligibleInput);
  const cards = new Map(eligible.map((card) => [card, 0]));
  const pairKeys = combinations2(eligible).map(([left, right]) => pairKey(left, right));
  const tripleKeys = combinations3(eligible).map(([first, second, third]) => tripleKey(first, second, third));
  const pairs = new Map(pairKeys.map((key) => [key, 0]));
  const triples = new Map(tripleKeys.map((key) => [key, 0]));
  const routeCounts = Object.fromEntries(ROUTE_LABELS.map((label) => [label, 0])) as Record<BalanceRouteLabel, number>;
  const rowKeys = new Set<string>();
  let duplicateRows = 0, invalidRows = 0;
  for (const row of rowsInput) {
    if (rowKeys.has(rowKey(row))) duplicateRows += 1;
    rowKeys.add(rowKey(row));
    if (eligible.length === ELIGIBLE.length && !ordinaryRowValid(row)) invalidRows += 1;
    for (const card of row) if (cards.has(card)) cards.set(card, cards.get(card)! + 1);
    for (const [left, right] of combinations2(row)) {
      const key = pairKey(left, right); if (pairs.has(key)) pairs.set(key, pairs.get(key)! + 1);
    }
    for (const [first, second, third] of combinations3(row)) {
      const key = tripleKey(first, second, third); if (triples.has(key)) triples.set(key, triples.get(key)! + 1);
    }
    if (eligible.length === ELIGIBLE.length) for (const label of routeLabels(row)) routeCounts[label] += 1;
  }
  const overlaps: number[] = [], jaccards: number[] = [];
  for (let left = 0; left < rowsInput.length; left += 1) for (let right = left + 1; right < rowsInput.length; right += 1) {
    const amount = overlap(rowsInput[left]!, rowsInput[right]!);
    overlaps.push(amount); jaccards.push(amount / (rowsInput[left]!.length + rowsInput[right]!.length - amount));
  }
  const cardValues = [...cards.values()], pairValues = [...pairs.values()], tripleValues = [...triples.values()];
  const pairMean = pairValues.reduce((sum, value) => sum + value, 0) / (pairValues.length || 1);
  return {
    cardCountMinimum: cardValues.length ? Math.min(...cardValues) : 0,
    cardCountMaximum: cardValues.length ? Math.max(...cardValues) : 0,
    cardCounts: Object.fromEntries([...cards.entries()].sort(([left], [right]) => compareCodeUnits(left, right))),
    pairCountMinimum: pairValues.length ? Math.min(...pairValues) : 0,
    pairCountMaximum: pairValues.length ? Math.max(...pairValues) : 0,
    pairCountStandardDeviation: round(Math.sqrt(pairValues.reduce((sum, value) => sum + (value - pairMean) ** 2, 0) / (pairValues.length || 1))),
    pairCounts: Object.fromEntries([...pairs.entries()].sort(([left], [right]) => compareCodeUnits(left, right))),
    pairCovered: pairValues.filter((value) => value > 0).length, pairTotal: pairValues.length,
    tripleCountMinimum: tripleValues.length ? Math.min(...tripleValues) : 0,
    tripleCountMaximum: tripleValues.length ? Math.max(...tripleValues) : 0,
    tripleCounts: Object.fromEntries([...triples.entries()].sort(([left], [right]) => compareCodeUnits(left, right))),
    tripleCovered: tripleValues.filter((value) => value > 0).length, tripleTotal: tripleValues.length,
    tripleCoverage: round(tripleValues.filter((value) => value > 0).length / (tripleValues.length || 1)),
    largestOverlap: overlaps.length ? Math.max(...overlaps) : 0,
    overlap: numericDistribution(overlaps), jaccard: numericDistribution(jaccards), routeCounts,
    duplicateRows, invalidRows
  };
}

function deficit(count: number, target: number): number { return Math.max(0, target - count); }

function summarizeCandidate(count: number, rows: DesignRow[], full: BalanceSuiteDesign,
  tuning: BalanceSuiteDesign, validation: BalanceSuiteDesign): BalanceCandidateSummary {
  const priorityFull = PRIORITY_PAIRS.map((entry) => full.pairCounts[entry.cards.join('|')]!);
  const priorityValidation = PRIORITY_PAIRS.map((entry) => validation.pairCounts[entry.cards.join('|')]!);
  const requiredFull = REQUIRED_TRIPLES.map((entry) => full.tripleCounts[entry.cards.join('|')]!);
  const requiredValidation = REQUIRED_TRIPLES.map((entry) => validation.tripleCounts[entry.cards.join('|')]!);
  const failures: string[] = [];
  if (full.cardCountMinimum < 40) failures.push('full card minimum');
  if (tuning.cardCountMinimum < 32) failures.push('tuning card minimum');
  if (validation.cardCountMinimum < 8) failures.push('validation card minimum');
  if (full.cardCountMaximum - full.cardCountMinimum > 1 || tuning.cardCountMaximum - tuning.cardCountMinimum > 1
    || validation.cardCountMaximum - validation.cardCountMinimum > 1) failures.push('card frequency range');
  if (full.pairCountMinimum < 8) failures.push('full pair minimum');
  if (validation.pairCountMinimum < 1) failures.push('validation pair minimum');
  if (Math.min(...priorityFull) < 12) failures.push('priority pair minimum');
  if (Math.min(...priorityValidation) < 2) failures.push('validation priority pair minimum');
  if (Math.min(...requiredFull) < 4) failures.push('required triple minimum');
  if (Math.min(...requiredValidation) < 1) failures.push('validation required triple minimum');
  if (full.tripleCovered < 9090) failures.push('broad triple coverage');
  if (full.duplicateRows > 0) failures.push('duplicate row');
  if (full.invalidRows > 0) failures.push('invalid row');
  if (full.largestOverlap > 6) failures.push('maximum overlap');
  if (full.overlap.p99 > 5) failures.push('overlap p99');
  for (const label of ROUTE_LABELS) {
    if (full.routeCounts[label] < ROUTE_THRESHOLDS[label]) failures.push(`${label} route minimum`);
    if (validation.routeCounts[label] < 1) failures.push(`${label} validation route minimum`);
  }
  const sizes = splitSizes(count);
  const deficits = {
    fullPairs: Object.values(full.pairCounts).reduce((sum, value) => sum + deficit(value, 8), 0),
    validationPairs: Object.values(validation.pairCounts).reduce((sum, value) => sum + deficit(value, 1), 0),
    priorityPairs: priorityFull.reduce((sum, value) => sum + deficit(value, 12), 0),
    validationPriorityPairs: priorityValidation.reduce((sum, value) => sum + deficit(value, 2), 0),
    requiredTriples: requiredFull.reduce((sum, value) => sum + deficit(value, 4), 0),
    validationRequiredTriples: requiredValidation.reduce((sum, value) => sum + deficit(value, 1), 0),
    routes: ROUTE_LABELS.reduce((sum, label) => sum + deficit(full.routeCounts[label], ROUTE_THRESHOLDS[label]), 0),
    validationRoutes: ROUTE_LABELS.reduce((sum, label) => sum + deficit(validation.routeCounts[label], 1), 0)
  };
  return { count, tuningSize: sizes.tuning, validationSize: sizes.validation, passed: failures.length === 0, failures,
    cardMinimum: full.cardCountMinimum, tuningCardMinimum: tuning.cardCountMinimum,
    validationCardMinimum: validation.cardCountMinimum, pairMinimum: full.pairCountMinimum,
    validationPairMinimum: validation.pairCountMinimum, priorityPairMinimum: Math.min(...priorityFull),
    validationPriorityPairMinimum: Math.min(...priorityValidation), requiredTripleMinimum: Math.min(...requiredFull),
    validationRequiredTripleMinimum: Math.min(...requiredValidation), tripleCovered: full.tripleCovered,
    tripleCoverage: full.tripleCoverage, largestOverlap: full.largestOverlap,
    overlapMean: full.overlap.mean, overlapP99: full.overlap.p99, jaccardMean: full.jaccard.mean,
    pairCountStandardDeviation: full.pairCountStandardDeviation, deficits, routeCounts: full.routeCounts,
    validationRouteCounts: validation.routeCounts };
}

function replaySelectedDesign(): DesignRow[] {
  const source = rawCoveringDesign as { schemaVersion: number; designVersion: string; cardOrder: string[];
    rowCount: number; digest: string; search: Record<string, unknown>;
    rows: { split: BalanceSuiteSplit; authored: boolean; cards: string[] }[] };
  const sourceContent = { ...source } as Partial<typeof source>; delete sourceContent.digest;
  if (source.schemaVersion !== 1 || source.designVersion !== 'covering-design-v2' || source.rowCount !== 160
    || source.digest !== sha256Canonical(sourceContent)
    || canonicalJson(source.cardOrder) !== canonicalJson(ELIGIBLE) || source.rows.length !== 160) {
    throw new Error('The selected covering-design source is stale.');
  }
  const authoredByKey = new Map(AUTHORED_ROWS.map((row) => [rowKey(row.cards), row]));
  return source.rows.map((entry): DesignRow => {
    const cards = sorted(entry.cards), fixed = authoredByKey.get(rowKey(cards));
    if (entry.authored !== Boolean(fixed) || (fixed && fixed.split !== entry.split)) {
      throw new Error(`Covering-design authored provenance is stale for ${rowKey(cards)}.`);
    }
    return fixed ? { ...fixed, cards: [...fixed.cards], provenance: { ...fixed.provenance } }
      : { cards, split: entry.split, authored: false,
        provenance: { kind: 'generated', rationaleId: 'balanced-covering',
          reason: 'Deterministic balanced covering row' } };
  });
}

function extendSelectedDesignTo200(): DesignRow[] {
  for (let restart = 0; restart < CONSTRUCTION_RESTARTS; restart += 1) {
    const random = new Random(seedFor(200, 'tuning', restart));
    const rows = replaySelectedDesign();
    const remainingBySplit: Record<BalanceSuiteSplit, Map<string, number>> = {
      tuning: new Map(ELIGIBLE.map((card) => [card, 8])),
      validation: new Map(ELIGIBLE.map((card) => [card, 2]))
    };
    const counts = addCounts(rows), keys = new Set(rows.map((row) => rowKey(row.cards)));
    let failed = false;
    for (const split of ['validation', 'tuning'] as const) {
      const amount = split === 'validation' ? 8 : 32, remaining = remainingBySplit[split];
      for (let rowIndex = 0; rowIndex < amount; rowIndex += 1) {
        let best: string[] | null = null, bestScore: number[] | null = null;
        for (let attempt = 0; attempt < GREEDY_CANDIDATES; attempt += 1) {
          const candidate = sampleCandidate(remaining, amount - rowIndex - 1, random, null, []);
          if (!candidate || keys.has(rowKey(candidate)) || rows.some((row) => overlap(candidate, row.cards) > 6)) continue;
          const score = constructionScore(candidate, split, counts, rows);
          if (!bestScore || compareScore(score, bestScore) > 0
            || (compareScore(score, bestScore) === 0 && rowKey(candidate) < rowKey(best!))) {
            best = candidate; bestScore = score;
          }
        }
        if (!best) { failed = true; break; }
        const row: DesignRow = { cards: best, split, authored: false,
          provenance: { kind: 'generated', rationaleId: 'balanced-covering-extension',
            reason: 'Deterministic 200-row comparison extension' } };
        rows.push(row); keys.add(rowKey(best));
        for (const card of best) remaining.set(card, remaining.get(card)! - 1);
        for (const [left, right] of combinations2(best)) {
          const key = pairKey(left, right); counts.pairs.set(key, counts.pairs.get(key)! + 1);
          if (split === 'validation') counts.validationPairs.set(key, counts.validationPairs.get(key)! + 1);
        }
        for (const [first, second, third] of combinations3(best)) {
          const key = tripleKey(first, second, third); counts.triples.set(key, counts.triples.get(key)! + 1);
          if (split === 'validation') counts.validationTriples.set(key, counts.validationTriples.get(key)! + 1);
        }
        for (const label of routeLabels(best)) {
          counts.routes.set(label, counts.routes.get(label)! + 1);
          if (split === 'validation') counts.validationRoutes.set(label, counts.validationRoutes.get(label)! + 1);
        }
      }
      if (failed) break;
    }
    if (!failed && rows.length === 200) return rows;
  }
  throw new Error('Could not build the deterministic 200-row comparison extension.');
}

export function generateBalanceSuiteCoveringSearchInput(): string {
  const rows = buildInitialRows(160, 0);
  const lines = [String(rows.length), ELIGIBLE.join(' ')];
  for (const row of rows) {
    lines.push(`${row.split === 'validation' ? 1 : 0} ${row.authored ? 1 : 0} ${row.cards.join(' ')}`);
  }
  lines.push(String(PRIORITY_PAIRS.length));
  for (const pair of PRIORITY_PAIRS) lines.push(pair.cards.join(' '));
  lines.push(String(REQUIRED_TRIPLES.length));
  for (const triple of REQUIRED_TRIPLES) lines.push(triple.cards.join(' '));
  return `${lines.join('\n')}\n`;
}

function candidateFromRows(count: number, rows: DesignRow[]): CandidateDesign {
  const tuningRows = rows.filter((row) => row.split === 'tuning').map((row) => row.cards);
  const validationRows = rows.filter((row) => row.split === 'validation').map((row) => row.cards);
  const full = measureBalanceSuiteDesign(rows.map((row) => row.cards));
  const tuning = measureBalanceSuiteDesign(tuningRows), validation = measureBalanceSuiteDesign(validationRows);
  return { count, rows, full, tuning, validation,
    summary: summarizeCandidate(count, rows, full, tuning, validation) };
}

export function generateBalanceSuiteCandidate(count: number): CandidateDesign {
  if (count === 160) return candidateFromRows(count, replaySelectedDesign());
  if (count === 200) return candidateFromRows(count, extendSelectedDesignTo200());
  const errors: string[] = [];
  for (let restart = 0; restart < CONSTRUCTION_RESTARTS; restart += 1) {
    try { return candidateFromRows(count, buildInitialRows(count, restart)); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  throw new Error(`Could not construct ${count}-row candidate after ${CONSTRUCTION_RESTARTS} attempts: ${errors.at(-1) ?? 'unknown failure'}`);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareCodeUnits(left, right)).map(([key, entry]) => [key, canonicalize(entry)]));
  return value;
}
export function canonicalJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }
export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
export function rowDigest(row: Omit<BalanceSuiteKingdom, 'rowDigest'> | BalanceSuiteKingdom): string {
  const content = { ...row } as Partial<BalanceSuiteKingdom>;
  delete content.rowDigest;
  return sha256Canonical(content);
}
export function manifestDigest(manifest: Omit<BalanceSuiteManifest, 'digest'> | BalanceSuiteManifest): string {
  const content = { ...manifest } as Partial<BalanceSuiteManifest>;
  delete content.digest;
  return sha256Canonical(content);
}
export function serializeBalanceSuiteManifest(manifest: BalanceSuiteManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function choose(n: number, k: number): number {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = result * (n - k + index) / index;
  return Math.round(result);
}
function binomialBelow(count: number, probability: number, minimum: number): number {
  let total = 0;
  for (let amount = 0; amount < minimum; amount += 1) {
    total += choose(count, amount) * probability ** amount * (1 - probability) ** (count - amount);
  }
  return total;
}
function unionSuccessLower(count: number, probability: number, minimum: number, items: number): number {
  return round(Math.max(0, 1 - items * binomialBelow(count, probability, minimum)));
}
function randomBaselines(candidateSizes: readonly number[]): BalanceSuiteManifest['randomBaselines'] {
  const cardProbability = 1 / 4, pairProbability = 3 / 52, tripleProbability = 3 / 247;
  const overlapHistogram: Record<string, number> = {};
  let expectedJaccard = 0;
  for (let amount = 0; amount <= 10; amount += 1) {
    const probability = choose(10, amount) * choose(30, 10 - amount) / choose(40, 10);
    overlapHistogram[String(amount)] = round(probability);
    expectedJaccard += probability * amount / (20 - amount);
  }
  return {
    assumptions: ['Rows are independent random 10-card subsets sampled with replacement.',
      'Union bounds are conservative and do not assume independent item events.',
      'The deterministic suite is not a random-population sample.'],
    actualPool: { cards: 40, choose10: choose(40, 10), cardProbability, pairProbability, tripleProbability },
    comparisonPool: { cards: 45, choose10: choose(45, 10), cardProbability: 2 / 9,
      pairProbability: 1 / 22, tripleProbability: 4 / 473 },
    candidates: candidateSizes.map((count) => ({ count, cardExpected: round(count * cardProbability),
      pairExpected: round(count * pairProbability), tripleExpected: round(count * tripleProbability),
      expectedUncoveredCards: round(40 * (1 - cardProbability) ** count),
      expectedUncoveredPairs: round(780 * (1 - pairProbability) ** count),
      expectedUncoveredTriples: round(9880 * (1 - tripleProbability) ** count),
      everyCardOnceSuccessLower: unionSuccessLower(count, cardProbability, 1, 40),
      everyPairOnceSuccessLower: unionSuccessLower(count, pairProbability, 1, 780),
      everyTripleOnceSuccessLower: unionSuccessLower(count, tripleProbability, 1, 9880),
      everyCardFortySuccessLower: unionSuccessLower(count, cardProbability, 40, 40),
      everyPairEightSuccessLower: unionSuccessLower(count, pairProbability, 8, 780),
      priorityPairTwelveSuccessLower: unionSuccessLower(count, pairProbability, 12, 96),
      requiredTripleFourSuccessLower: unionSuccessLower(count, tripleProbability, 4, 60) })),
    highProbabilityBounds: { everyCardOnce: 24, everyPairOnce: 163, everyTripleOnce: 998,
      everyCardFortyTimes: 236, everyPairEightTimes: 401, priorityPairsTwelveTimes: 455,
      requiredTriplesFourTimes: 1090 },
    randomOverlap: { expected: 2.5, expectedJaccard: round(expectedJaccard), histogram: overlapHistogram }
  };
}

function canonicalCard(card: CardDefinition): BalanceCardDefinition {
  const { headline: _headline, detail: _detail, ...semanticCard } = card;
  return JSON.parse(JSON.stringify(semanticCard)) as BalanceCardDefinition;
}
function familyPattern(key: string): string {
  return key.split('|').map((card) => CARDS[card]!.family).sort(compareCodeUnits).join('+');
}

export function generateBalanceSuiteManifest(): BalanceSuiteManifest {
  validateFrozenInputs();
  const candidates: CandidateDesign[] = [];
  for (const count of [50, 100, 150, 152, 156, 160]) candidates.push(generateBalanceSuiteCandidate(count));
  let selected = candidates.find((candidate) => candidate.count === 160 && candidate.summary.passed) ?? null;
  for (let count = 161; !selected && count <= 200; count += 1) {
    const candidate = generateBalanceSuiteCandidate(count); candidates.push(candidate);
    if (candidate.summary.passed) selected = candidate;
  }
  if (!candidates.some((candidate) => candidate.count === 200)) candidates.push(generateBalanceSuiteCandidate(200));
  if (!selected) throw new Error(`No candidate through 200 passes: ${candidates.map((candidate) => `${candidate.count} [${candidate.summary.failures.join(', ')}]`).join('; ')}`);
  candidates.sort((left, right) => left.count - right.count);
  const rowsBySplit: Record<BalanceSuiteSplit, DesignRow[]> = {
    tuning: selected.rows.filter((row) => row.split === 'tuning'),
    validation: selected.rows.filter((row) => row.split === 'validation')
  };
  const kingdoms: BalanceSuiteKingdom[] = [];
  for (const split of ['tuning', 'validation'] as const) rowsBySplit[split].forEach((row, index) => {
    const base = {
      id: `balance-${split}-${String(index + 1).padStart(3, '0')}`,
      name: `Balance ${split === 'tuning' ? 'Tuning' : 'Validation'} ${String(index + 1).padStart(3, '0')}`,
      split, startingHealth: 50, actionPiles: row.cards.map((cardId) => ({ cardId, count: 10 })),
      routeLabels: routeLabels(row.cards), provenance: { ...row.provenance }
    };
    kingdoms.push({ ...base, rowDigest: rowDigest(base as Omit<BalanceSuiteKingdom, 'rowDigest'>) });
  });
  const selectedValidation = selected.validation;
  const interactions = {
    priorityPairs: PRIORITY_PAIRS.map((entry) => ({ id: entry.cards.join('|'), cards: entry.cards as [string, string],
      reason: entry.reason, count: selected.full.pairCounts[entry.cards.join('|')]!,
      validationCount: selectedValidation.pairCounts[entry.cards.join('|')]! })),
    requiredTriples: REQUIRED_TRIPLES.map((entry) => ({ id: entry.cards.join('|'), cards: entry.cards as [string, string, string],
      reason: entry.reason, count: selected.full.tripleCounts[entry.cards.join('|')]!,
      validationCount: selectedValidation.tripleCounts[entry.cards.join('|')]! }))
  };
  const semantics = {
    variable: [...VARIABLE_ACTION_IDS].map((id) => canonicalCard(CARDS[id]!)),
    fixedAction: [...ALWAYS_AVAILABLE_ACTION_IDS].map((id) => canonicalCard(CARDS[id]!)),
    treasure: [...TREASURE_IDS].map((id) => canonicalCard(CARDS[id]!)),
    nonMarket: [canonicalCard(CARDS.scrap!)]
  };
  const roles = Object.fromEntries(Object.entries(ROLE_IDS).map(([name, ids]) => [name, sorted(ids)]));
  const costBands = { low: ELIGIBLE.filter((id) => CARDS[id]!.cost <= 3),
    middle: ELIGIBLE.filter((id) => CARDS[id]!.cost === 4), high: ELIGIBLE.filter((id) => CARDS[id]!.cost >= 5) };
  const uncoveredByFamilyPattern: Record<string, number> = {};
  for (const [key, value] of Object.entries(selected.full.tripleCounts)) if (value === 0) {
    const pattern = familyPattern(key); uncoveredByFamilyPattern[pattern] = (uncoveredByFamilyPattern[pattern] ?? 0) + 1;
  }
  const authoredRows = selected.rows.filter((row) => row.authored);
  const authoredOverlapMatrix: { left: string; right: string; overlap: number }[] = [];
  for (let left = 0; left < authoredRows.length; left += 1) for (let right = left + 1; right < authoredRows.length; right += 1) {
    authoredOverlapMatrix.push({ left: authoredRows[left]!.provenance.rationaleId,
      right: authoredRows[right]!.provenance.rationaleId, overlap: overlap(authoredRows[left]!.cards, authoredRows[right]!.cards) });
  }
  const testedSizes = candidates.map((candidate) => candidate.count);
  const base: Omit<BalanceSuiteManifest, 'digest'> = {
    schemaVersion: 2, suiteVersion: 'balance-suite-v4', generatorVersion: 'deterministic-covering-v2',
    taxonomyVersion: 'kingdom-taxonomy-v1', interactionVersion: 'kingdom-interactions-v1',
    methodologyVersion: 'coverage-thresholds-v1', campaignProtocolStatus: 'pending-k009-consistency',
    kingdomSize: 10, chosenCount: selected.count,
    selection: { rule: 'First passing integer at or above the 160-row exposure lower bound; always compare 200.',
      requiredCandidateSizes: [...REQUIRED_CANDIDATES], testedCandidateSizes: testedSizes,
      candidates: candidates.map((candidate) => candidate.summary) },
    generator: { baseSeed: BASE_SEED,
      seedDerivation: 'baseSeed xor imul(count, 0x9e3779b1) xor splitSeed xor imul(restart + 1, 0x85ebca6b)',
      greedyCandidatesPerRow: GREEDY_CANDIDATES,
      constructionRestarts: CONSTRUCTION_RESTARTS,
      selectedDesignSourceDigest: sha256Canonical(rawCoveringDesign),
      selectedDesignSearch: { ...(rawCoveringDesign as { search: Record<string, unknown> }).search },
      objectiveOrder: ['validity/duplicates/overlap', 'card quotas', 'full pair deficits', 'validation pair deficits',
        'priority pair deficits', 'required triple deficits', 'route deficits', 'uncovered triples',
        'pair variance', 'overlap tail', 'canonical row order'],
      tieBreak: 'Direct UTF-16 code-unit order', percentileMethod: 'Nearest rank: ceil(p * count)',
      serialization: 'Canonical compact UTF-8 JSON for SHA-256; pretty JSON uses two spaces and one final newline' },
    cardPool: { orderedVariableCardIds: [...VARIABLE_ACTION_IDS], fixedActionCardIds: [...ALWAYS_AVAILABLE_ACTION_IDS],
      treasureCardIds: [...TREASURE_IDS], nonMarketCardIds: ['scrap'], variableCount: ELIGIBLE.length,
      kingdomCount: choose(40, 10), digest: sha256Canonical(semantics), semantics },
    taxonomy: { digest: sha256Canonical({ roles, costBands }), roles, costBands },
    thresholds: { card: { fullMinimum: 40, tuningMinimum: 32, validationMinimum: 8, maximumRange: 1 },
      pair: { fullMinimum: 8, validationMinimum: 1, priorityFullMinimum: 12, priorityValidationMinimum: 2 },
      triple: { requiredFullMinimum: 4, requiredValidationMinimum: 1, coveredMinimum: 9090, total: 9880 },
      distinctness: { maximumOverlap: 6, maximumJaccard: round(6 / 14), maximumOverlapP99: 5 },
      routes: Object.fromEntries(ROUTE_LABELS.map((label) => [label, { fullMinimum: ROUTE_THRESHOLDS[label], validationMinimum: 1 }])) as
        Record<BalanceRouteLabel, { fullMinimum: number; validationMinimum: 1 }> },
    interactions, randomBaselines: randomBaselines(testedSizes),
    deterministicLowerBounds: { pairOnceSchonheim: 20, tripleOnceSchonheim: 88, everyPairEightTimes: 139,
      everyPairNineTimes: 156, cardExposureThirtyTwoPlusEight: 160 },
    rawFeasibilityPilot: RAW_FEASIBILITY_PILOT.map((entry) => ({ ...entry })),
    splits: [
      { name: 'tuning', seed: 22_222, size: rowsBySplit.tuning.length, design: selected.tuning },
      { name: 'validation', seed: 11_111, size: rowsBySplit.validation.length, design: selected.validation }],
    statistics: selected.full, authoredOverlapMatrix,
    residualBlindSpots: { uncoveredTripleCount: selected.full.tripleTotal - selected.full.tripleCovered,
      uncoveredByFamilyPattern: Object.fromEntries(Object.entries(uncoveredByFamilyPattern).sort(([left], [right]) => compareCodeUnits(left, right))),
      completeTripleCoverageClaimed: false, completeHigherOrderCoverageClaimed: false }, kingdoms
  };
  return { ...base, digest: manifestDigest(base as Omit<BalanceSuiteManifest, 'digest'>) };
}

function validateFrozenInputs(): void {
  if (ELIGIBLE.length !== 40 || new Set(ELIGIBLE).size !== 40) throw new Error('The suite needs exactly 40 unique variable cards.');
  for (const [name, ids] of Object.entries(ROLE_IDS)) for (const id of ids) {
    if (!ELIGIBLE_SET.has(id)) throw new Error(`${name} contains ineligible card ${id}.`);
  }
  if (PRIORITY_PAIRS.length !== 96) throw new Error(`Expected 96 priority pairs, found ${PRIORITY_PAIRS.length}.`);
  if (REQUIRED_TRIPLES.length !== 60 || new Set(REQUIRED_TRIPLES.map((entry) => entry.cards.join('|'))).size !== 60) {
    throw new Error('Expected 60 unique required triples.');
  }
  const degrees = new Map(ELIGIBLE.map((card) => [card, 0]));
  for (const entry of PRIORITY_PAIRS) for (const card of entry.cards) degrees.set(card, degrees.get(card)! + 1);
  if (Math.max(...degrees.values()) !== 10) throw new Error('Priority-pair maximum degree must be 10.');
  const memberships = new Map(ELIGIBLE.map((card) => [card, 0]));
  for (const entry of REQUIRED_TRIPLES) for (const card of entry.cards) memberships.set(card, memberships.get(card)! + 1);
  if (Math.max(...memberships.values()) !== 11) throw new Error('Required-triple maximum membership must be 11.');
  for (const row of AUTHORED_ROWS) if (!ordinaryRowValid(row.cards)) throw new Error(`Invalid authored row ${row.provenance.rationaleId}.`);
  for (let left = 0; left < AUTHORED_ROWS.length; left += 1) for (let right = left + 1; right < AUTHORED_ROWS.length; right += 1) {
    if (overlap(AUTHORED_ROWS[left]!.cards, AUTHORED_ROWS[right]!.cards) > MAX_OVERLAP) throw new Error('Authored-row overlap exceeds six.');
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(message);
}
let expectedManifestCache: BalanceSuiteManifest | null = null;
function expectedManifest(): BalanceSuiteManifest {
  expectedManifestCache ??= generateBalanceSuiteManifest();
  return expectedManifestCache;
}

export function validateBalanceSuiteManifestIdentity(input: BalanceSuiteManifest): BalanceSuiteManifest {
  if (input.schemaVersion !== 2 || input.suiteVersion !== 'balance-suite-v4'
    || input.generatorVersion !== 'deterministic-covering-v2' || input.taxonomyVersion !== 'kingdom-taxonomy-v1'
    || input.interactionVersion !== 'kingdom-interactions-v1' || input.methodologyVersion !== 'coverage-thresholds-v1') {
    throw new Error('Balance-suite provenance does not match the frozen design protocol.');
  }
  if (input.campaignProtocolStatus !== 'pending-k009-consistency') throw new Error('Unexpected campaign protocol status.');
  if (input.chosenCount !== 160 || input.kingdoms.length !== 160 || input.kingdomSize !== 10) {
    throw new Error('Balance-suite identity has the wrong selected size.');
  }
  return input;
}

export function validateBalanceSuiteManifest(input: BalanceSuiteManifest): BalanceSuiteManifest {
  validateFrozenInputs();
  validateBalanceSuiteManifestIdentity(input);
  if (input.digest !== manifestDigest(input)) throw new Error('Balance-suite manifest digest is invalid.');
  if (input.generator.baseSeed !== BASE_SEED || input.generator.greedyCandidatesPerRow !== GREEDY_CANDIDATES
    || input.generator.constructionRestarts !== CONSTRUCTION_RESTARTS
    || input.generator.selectedDesignSourceDigest !== sha256Canonical(rawCoveringDesign)) {
    throw new Error('Balance-suite generator provenance is stale.');
  }
  assertEqual(input.cardPool.orderedVariableCardIds, [...VARIABLE_ACTION_IDS], 'Eligible card order is stale.');
  const expectedSemantics = {
    variable: [...VARIABLE_ACTION_IDS].map((id) => canonicalCard(CARDS[id]!)),
    fixedAction: [...ALWAYS_AVAILABLE_ACTION_IDS].map((id) => canonicalCard(CARDS[id]!)),
    treasure: [...TREASURE_IDS].map((id) => canonicalCard(CARDS[id]!)), nonMarket: [canonicalCard(CARDS.scrap!)]
  };
  assertEqual(input.cardPool.semantics, expectedSemantics, 'Card semantics are stale.');
  if (input.cardPool.digest !== sha256Canonical(expectedSemantics)) throw new Error('Card-pool digest is stale.');
  const expectedRows = replaySelectedDesign();
  const expectedOrderedRows = ['tuning', 'validation'].flatMap((split) =>
    expectedRows.filter((row) => row.split === split)) as DesignRow[];
  const rows: DesignRow[] = [];
  const ids = new Set<string>();
  for (const kingdom of input.kingdoms) {
    if (ids.has(kingdom.id)) throw new Error(`Duplicate kingdom ID ${kingdom.id}.`);
    ids.add(kingdom.id);
    if (kingdom.rowDigest !== rowDigest(kingdom)) throw new Error(`Invalid row digest for ${kingdom.id}.`);
    if (kingdom.startingHealth !== 50) throw new Error(`Kingdom ${kingdom.id} must start at 50 health.`);
    if (kingdom.actionPiles.length !== 10) throw new Error(`Kingdom ${kingdom.id} must have exactly ten piles.`);
    if (kingdom.overrides !== undefined) throw new Error(`Kingdom ${kingdom.id} must not have overrides.`);
    if (kingdom.actionPiles.some((pile) => pile.count !== 10)) {
      throw new Error(`Every pile in ${kingdom.id} must contain exactly ten cards.`);
    }
    const cards = kingdom.actionPiles.map((pile) => pile.cardId);
    if (new Set(cards).size !== 10) throw new Error(`Kingdom ${kingdom.id} has a duplicate card pile.`);
    if (cards.some((card) => !ELIGIBLE_SET.has(card))) {
      throw new Error(`Kingdom ${kingdom.id} contains an ineligible variable card.`);
    }
    if (!ordinaryRowValid(cards)) throw new Error(`Kingdom ${kingdom.id} lacks an ordinary route.`);
    assertEqual(kingdom.routeLabels, routeLabels(cards), `Stale route labels for ${kingdom.id}.`);
    rows.push({ cards, split: kingdom.split, authored: kingdom.provenance.kind === 'authored', provenance: kingdom.provenance });
  }
  const tuningRows = rows.filter((row) => row.split === 'tuning').map((row) => row.cards);
  const validationRows = rows.filter((row) => row.split === 'validation').map((row) => row.cards);
  const full = measureBalanceSuiteDesign(rows.map((row) => row.cards));
  const tuning = measureBalanceSuiteDesign(tuningRows), validation = measureBalanceSuiteDesign(validationRows);
  const summary = summarizeCandidate(input.chosenCount, rows, full, tuning, validation);
  if (!summary.passed) throw new Error(`Selected balance suite fails: ${summary.failures.join(', ')}.`);
  assertEqual(input.statistics, full, 'Balance-suite statistics are stale.');
  const splitMap = new Map(input.splits.map((split) => [split.name, split]));
  assertEqual(splitMap.get('tuning')?.design, tuning, 'Tuning statistics are stale.');
  assertEqual(splitMap.get('validation')?.design, validation, 'Validation statistics are stale.');
  for (const [index, row] of rows.entries()) {
    const expectedRow = expectedOrderedRows[index];
    if (!expectedRow || row.split !== expectedRow.split || rowKey(row.cards) !== rowKey(expectedRow.cards)
      || canonicalJson(row.provenance) !== canonicalJson(expectedRow.provenance)) {
      throw new Error(`Stale row provenance or covering design at row ${index + 1}.`);
    }
  }
  const selected = input.selection.candidates.find((candidate) => candidate.count === input.chosenCount);
  assertEqual(selected, summary, 'Selected candidate metrics are stale.');
  if (input.selection.candidates.some((candidate) => candidate.count < input.chosenCount && candidate.passed)) {
    throw new Error('The selected count is not the first passing count.');
  }
  if (![50, 100, 150, 152, 156, 160, 200].every((count) => input.selection.testedCandidateSizes.includes(count))) {
    throw new Error('Required candidate size is missing.');
  }
  const expectedPairs = PRIORITY_PAIRS.map((entry) => ({ id: entry.cards.join('|'), cards: entry.cards,
    reason: entry.reason, count: full.pairCounts[entry.cards.join('|')]!, validationCount: validation.pairCounts[entry.cards.join('|')]! }));
  const expectedTriples = REQUIRED_TRIPLES.map((entry) => ({ id: entry.cards.join('|'), cards: entry.cards,
    reason: entry.reason, count: full.tripleCounts[entry.cards.join('|')]!, validationCount: validation.tripleCounts[entry.cards.join('|')]! }));
  assertEqual(input.interactions.priorityPairs, expectedPairs, 'Priority-pair evidence is stale.');
  assertEqual(input.interactions.requiredTriples, expectedTriples, 'Required-triple evidence is stale.');
  assertEqual(input, expectedManifest(), 'Balance-suite methodology evidence is stale.');
  return input;
}

export const balanceSuiteDesign = Object.freeze({
  generate: generateBalanceSuiteManifest,
  measure: measureBalanceSuiteDesign,
  validate: validateBalanceSuiteManifest,
  validateIdentity: validateBalanceSuiteManifestIdentity,
  serialize: serializeBalanceSuiteManifest,
  digest: manifestDigest
});
