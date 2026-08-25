import { createHash } from 'node:crypto';
import rawCoveringDesign from './balance-suite-covering-design-v1.json' with { type: 'json' };
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
  overlapP99: number;
  pairCountStandardDeviation: number;
  deficits: { fullPairs: number; validationPairs: number; priorityPairs: number; validationPriorityPairs: number;
    requiredTriples: number; validationRequiredTriples: number; routes: number; validationRoutes: number };
  routeCounts: Record<BalanceRouteLabel, number>;
  validationRouteCounts: Record<BalanceRouteLabel, number>;
}

export interface BalanceSuiteManifest {
  schemaVersion: 2;
  suiteVersion: 'balance-suite-v4';
  generatorVersion: 'deterministic-covering-v1';
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
    comparisonOptimizationAttemptsPerRow: number;
    passingOptimizationAttemptsPerRow: number;
    constructionRestarts: number;
    optimizationRestarts: number;
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
      variable: CardDefinition[];
      fixedAction: CardDefinition[];
      treasure: CardDefinition[];
      nonMarket: CardDefinition[];
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
      expectedUncoveredCards: number; expectedUncoveredPairs: number; expectedUncoveredTriples: number }[];
    highProbabilityBounds: Record<string, number>;
    randomOverlap: { expected: number; histogram: Record<string, number> };
  };
  deterministicLowerBounds: Record<string, number>;
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
const COMPARISON_OPTIMIZATION_ATTEMPTS_PER_ROW = 0;
const PASSING_OPTIMIZATION_ATTEMPTS_PER_ROW = 0;
const CONSTRUCTION_RESTARTS = 16;
const OPTIMIZATION_RESTARTS = 1;
const MAX_OVERLAP = 6;
const REQUIRED_CANDIDATES = Object.freeze([50, 100, 150, 152, 156, 160, 200]);

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
  { ...authored('tuning', 'deep-beam-tuning-009', 'deep-beam-tuning-009', 'Strategy-search continuity anchor',
    ['channel', 'improvise', 'longshot', 'precisionShot', 'reclaim', 'reforge', 'salvageShot', 'scour', 'sharpen', 'strike']),
    provenance: { kind: 'authored', rationaleId: 'deep-beam-tuning-009', reason: 'Strategy-search continuity anchor',
      sourceId: 'deep-beam-tuning-009', sourceDigest: '4e7c9c889fc40b7d52532b756f17121a247d91497ac0e49f9acd7a150a0972a6' } },
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
  let counts = addCounts(rows);
  let keys = new Set(rows.map((row) => rowKey(row.cards)));
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
    if (split === 'validation') {
      improveValidationRows(rows, count, restart);
      counts = addCounts(rows);
      keys = new Set(rows.map((row) => rowKey(row.cards)));
    }
  }
  return rows;
}

type ObjectiveState = ReturnType<typeof addCounts> & {
  rows: DesignRow[];
  rowKeys: Set<string>;
  overlapSix: number;
  pairDeficit: number;
  validationPairDeficit: number;
  priorityDeficit: number;
  validationPriorityDeficit: number;
  requiredDeficit: number;
  validationRequiredDeficit: number;
  routeDeficit: number;
  validationRouteDeficit: number;
  uncoveredTriples: number;
  pairSquares: number;
}

function deficit(count: number, target: number): number { return Math.max(0, target - count); }
function createObjectiveState(rows: DesignRow[]): ObjectiveState {
  const counts = addCounts(rows);
  let overlapSix = 0;
  for (let left = 0; left < rows.length; left += 1) for (let right = left + 1; right < rows.length; right += 1) {
    if (overlap(rows[left]!.cards, rows[right]!.cards) === 6) overlapSix += 1;
  }
  return {
    rows, rowKeys: new Set(rows.map((row) => rowKey(row.cards))), overlapSix, ...counts,
    pairDeficit: ALL_PAIR_KEYS.reduce((sum, key) => sum + deficit(counts.pairs.get(key)!, 8), 0),
    validationPairDeficit: ALL_PAIR_KEYS.reduce((sum, key) => sum + deficit(counts.validationPairs.get(key)!, 1), 0),
    priorityDeficit: [...PRIORITY_PAIR_KEYS].reduce((sum, key) => sum + deficit(counts.pairs.get(key)!, 12), 0),
    validationPriorityDeficit: [...PRIORITY_PAIR_KEYS].reduce((sum, key) => sum + deficit(counts.validationPairs.get(key)!, 2), 0),
    requiredDeficit: [...REQUIRED_TRIPLE_KEYS].reduce((sum, key) => sum + deficit(counts.triples.get(key)!, 4), 0),
    validationRequiredDeficit: [...REQUIRED_TRIPLE_KEYS].reduce((sum, key) => sum + deficit(counts.validationTriples.get(key)!, 1), 0),
    routeDeficit: ROUTE_LABELS.reduce((sum, label) => sum + deficit(counts.routes.get(label)!, ROUTE_THRESHOLDS[label]), 0),
    validationRouteDeficit: ROUTE_LABELS.reduce((sum, label) => sum + deficit(counts.validationRoutes.get(label)!, 1), 0),
    uncoveredTriples: ALL_TRIPLE_KEYS.filter((key) => counts.triples.get(key) === 0).length,
    pairSquares: ALL_PAIR_KEYS.reduce((sum, key) => sum + counts.pairs.get(key)! ** 2, 0)
  };
}

function objective(state: ObjectiveState): number[] {
  return [state.pairDeficit + state.validationPairDeficit, state.validationPairDeficit, state.pairDeficit,
    state.priorityDeficit + state.validationPriorityDeficit, state.validationPriorityDeficit, state.priorityDeficit,
    state.requiredDeficit + state.validationRequiredDeficit, state.validationRequiredDeficit, state.requiredDeficit,
    state.routeDeficit + state.validationRouteDeficit, state.validationRouteDeficit, state.routeDeficit,
    Math.max(0, state.uncoveredTriples - (ALL_TRIPLE_KEYS.length - 9090)), state.uncoveredTriples,
    state.pairSquares, Math.max(0, state.overlapSix - Math.floor(state.rows.length * (state.rows.length - 1) / 2 * 0.01)),
    state.overlapSix];
}
function validationObjective(state: ObjectiveState): number[] {
  return [state.validationPairDeficit, state.validationPriorityDeficit, state.validationRequiredDeficit,
    state.validationRouteDeficit, state.pairSquares, state.uncoveredTriples, state.overlapSix];
}
function objectiveBetter(left: readonly number[], right: readonly number[]): boolean {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! < right[index]!;
  }
  return false;
}

function adjustPair(state: ObjectiveState, key: string, delta: number, validation: boolean): void {
  const old = state.pairs.get(key)!, next = old + delta;
  state.pairDeficit += deficit(next, 8) - deficit(old, 8);
  if (PRIORITY_PAIR_KEYS.has(key)) state.priorityDeficit += deficit(next, 12) - deficit(old, 12);
  state.pairSquares += next * next - old * old;
  state.pairs.set(key, next);
  if (validation) {
    const oldValidation = state.validationPairs.get(key)!, nextValidation = oldValidation + delta;
    state.validationPairDeficit += deficit(nextValidation, 1) - deficit(oldValidation, 1);
    if (PRIORITY_PAIR_KEYS.has(key)) {
      state.validationPriorityDeficit += deficit(nextValidation, 2) - deficit(oldValidation, 2);
    }
    state.validationPairs.set(key, nextValidation);
  }
}
function adjustTriple(state: ObjectiveState, key: string, delta: number, validation: boolean): void {
  const old = state.triples.get(key)!, next = old + delta;
  if (old === 0 && next > 0) state.uncoveredTriples -= 1;
  else if (old > 0 && next === 0) state.uncoveredTriples += 1;
  if (REQUIRED_TRIPLE_KEYS.has(key)) state.requiredDeficit += deficit(next, 4) - deficit(old, 4);
  state.triples.set(key, next);
  if (validation) {
    const oldValidation = state.validationTriples.get(key)!, nextValidation = oldValidation + delta;
    if (REQUIRED_TRIPLE_KEYS.has(key)) {
      state.validationRequiredDeficit += deficit(nextValidation, 1) - deficit(oldValidation, 1);
    }
    state.validationTriples.set(key, nextValidation);
  }
}
function adjustRoutes(state: ObjectiveState, cards: readonly string[], split: BalanceSuiteSplit, delta: number): void {
  for (const label of routeLabels(cards)) {
    const old = state.routes.get(label)!, next = old + delta;
    state.routeDeficit += deficit(next, ROUTE_THRESHOLDS[label]) - deficit(old, ROUTE_THRESHOLDS[label]);
    state.routes.set(label, next);
    if (split === 'validation') {
      const oldValidation = state.validationRoutes.get(label)!, nextValidation = oldValidation + delta;
      state.validationRouteDeficit += deficit(nextValidation, 1) - deficit(oldValidation, 1);
      state.validationRoutes.set(label, nextValidation);
    }
  }
}
function adjustRow(state: ObjectiveState, row: DesignRow, delta: number): void {
  const validation = row.split === 'validation';
  for (const [left, right] of combinations2(row.cards)) adjustPair(state, pairKey(left, right), delta, validation);
  for (const [first, second, third] of combinations3(row.cards)) adjustTriple(state, tripleKey(first, second, third), delta, validation);
  adjustRoutes(state, row.cards, row.split, delta);
}

interface SwapProposal { leftIndex: number; rightIndex: number; leftCard: string; rightCard: string }
function randomSwap(state: ObjectiveState, random: Random, split?: BalanceSuiteSplit): SwapProposal | null {
  const indices = state.rows.map((_row, index) => index).filter((index) => !state.rows[index]!.authored
    && (!split || state.rows[index]!.split === split));
  if (indices.length < 2) return null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const leftIndex = indices[random.int(indices.length)]!, rightIndex = indices[random.int(indices.length)]!;
    if (leftIndex === rightIndex || state.rows[leftIndex]!.split !== state.rows[rightIndex]!.split) continue;
    const left = state.rows[leftIndex]!.cards, right = state.rows[rightIndex]!.cards;
    const leftOnly = left.filter((card) => !right.includes(card)), rightOnly = right.filter((card) => !left.includes(card));
    if (!leftOnly.length || !rightOnly.length) continue;
    return { leftIndex, rightIndex, leftCard: leftOnly[random.int(leftOnly.length)]!, rightCard: rightOnly[random.int(rightOnly.length)]! };
  }
  return null;
}

function swappedRows(state: ObjectiveState, proposal: SwapProposal): [string[], string[]] {
  const left = state.rows[proposal.leftIndex]!.cards, right = state.rows[proposal.rightIndex]!.cards;
  return [sorted(left.map((card) => card === proposal.leftCard ? proposal.rightCard : card)),
    sorted(right.map((card) => card === proposal.rightCard ? proposal.leftCard : card))];
}
function proposalPairScore(state: ObjectiveState, proposal: SwapProposal): number[] {
  const left = state.rows[proposal.leftIndex]!, right = state.rows[proposal.rightIndex]!;
  const [nextLeft, nextRight] = swappedRows(state, proposal);
  if (!ordinaryRowValid(nextLeft) || !ordinaryRowValid(nextRight)) return [Number.POSITIVE_INFINITY];
  const deltas = new Map<string, number>();
  const adjust = (cards: readonly string[], amount: number): void => {
    for (const [first, second] of combinations2(cards)) {
      const key = pairKey(first, second); deltas.set(key, (deltas.get(key) ?? 0) + amount);
    }
  };
  adjust(left.cards, -1); adjust(right.cards, -1); adjust(nextLeft, 1); adjust(nextRight, 1);
  let full = 0, validation = 0, priority = 0, validationPriority = 0;
  for (const [key, amount] of deltas) if (amount !== 0) {
    const old = state.pairs.get(key)!, next = old + amount;
    full += deficit(next, 8) - deficit(old, 8);
    if (PRIORITY_PAIR_KEYS.has(key)) priority += deficit(next, 12) - deficit(old, 12);
    if (left.split === 'validation') {
      const oldValidation = state.validationPairs.get(key)!, nextValidation = oldValidation + amount;
      validation += deficit(nextValidation, 1) - deficit(oldValidation, 1);
      if (PRIORITY_PAIR_KEYS.has(key)) {
        validationPriority += deficit(nextValidation, 2) - deficit(oldValidation, 2);
      }
    }
  }
  return [full + validation, validation, full, priority + validationPriority, validationPriority, priority];
}
function scoreLess(left: readonly number[], right: readonly number[]): boolean {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? 0, rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) return leftValue < rightValue;
  }
  return false;
}
function targetPairSwap(state: ObjectiveState, random: Random, keys: readonly string[], target: number,
  validationOnly: boolean): SwapProposal | null {
  const deficits = keys.filter((key) => (validationOnly ? state.validationPairs : state.pairs).get(key)! < target);
  if (!deficits.length) return null;
  let best: SwapProposal | null = null, bestScore: number[] | null = null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const [first, second] = deficits[random.int(deficits.length)]!.split('|') as [string, string];
    const split = validationOnly ? 'validation' : (random.next() < 0.2 ? 'validation' : 'tuning');
    const firstRows = state.rows.map((_row, index) => index).filter((index) => !state.rows[index]!.authored
      && state.rows[index]!.split === split && state.rows[index]!.cards.includes(first) && !state.rows[index]!.cards.includes(second));
    const secondRows = state.rows.map((_row, index) => index).filter((index) => !state.rows[index]!.authored
      && state.rows[index]!.split === split && state.rows[index]!.cards.includes(second) && !state.rows[index]!.cards.includes(first));
    if (!firstRows.length || !secondRows.length) continue;
    const leftIndex = firstRows[random.int(firstRows.length)]!, rightIndex = secondRows[random.int(secondRows.length)]!;
    const left = state.rows[leftIndex]!.cards, right = state.rows[rightIndex]!.cards;
    const exchanges = random.shuffle(left.filter((card) => card !== first && !right.includes(card)));
    for (const exchange of exchanges.slice(0, 2)) {
      const proposal = { leftIndex, rightIndex, leftCard: exchange, rightCard: second };
      const score = proposalPairScore(state, proposal);
      const identity = `${leftIndex}|${rightIndex}|${exchange}|${second}`;
      const bestIdentity = best ? `${best.leftIndex}|${best.rightIndex}|${best.leftCard}|${best.rightCard}` : '';
      if (!bestScore || scoreLess(score, bestScore)
        || (!scoreLess(bestScore, score) && identity < bestIdentity)) { best = proposal; bestScore = score; }
    }
  }
  return best;
}

function targetTripleSwap(state: ObjectiveState, random: Random, validationOnly: boolean,
  target: number): SwapProposal | null {
  const counts = validationOnly ? state.validationTriples : state.triples;
  const deficits = [...REQUIRED_TRIPLE_KEYS].filter((key) => counts.get(key)! < target);
  if (!deficits.length) return null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const cards = deficits[random.int(deficits.length)]!.split('|');
    const split = validationOnly ? 'validation' : (random.next() < 0.2 ? 'validation' : 'tuning');
    const candidates = state.rows.map((_row, index) => index).filter((index) => !state.rows[index]!.authored
      && state.rows[index]!.split === split).map((index) => ({ index,
        present: cards.filter((card) => state.rows[index]!.cards.includes(card)) }))
      .filter((entry) => entry.present.length === 2);
    if (!candidates.length) continue;
    const leftEntry = candidates[random.int(candidates.length)]!;
    const missing = cards.find((card) => !leftEntry.present.includes(card))!;
    const rightRows = state.rows.map((_row, index) => index).filter((index) => !state.rows[index]!.authored
      && state.rows[index]!.split === split && state.rows[index]!.cards.includes(missing)
      && !state.rows[index]!.cards.some((card) => cards.includes(card) && card !== missing));
    if (!rightRows.length) continue;
    const rightIndex = rightRows[random.int(rightRows.length)]!;
    const right = state.rows[rightIndex]!.cards;
    const exchange = random.shuffle(state.rows[leftEntry.index]!.cards.filter((card) => !cards.includes(card)
      && !right.includes(card)))[0];
    if (exchange) return { leftIndex: leftEntry.index, rightIndex, leftCard: exchange, rightCard: missing };
  }
  return null;
}

function trySwap(state: ObjectiveState, proposal: SwapProposal,
  objectiveForState: (state: ObjectiveState) => number[] = objective): boolean {
  const left = state.rows[proposal.leftIndex]!, right = state.rows[proposal.rightIndex]!;
  if (left.authored || right.authored || left.split !== right.split || left.cards.includes(proposal.rightCard)
    || right.cards.includes(proposal.leftCard)) return false;
  const nextLeft = sorted(left.cards.map((card) => card === proposal.leftCard ? proposal.rightCard : card));
  const nextRight = sorted(right.cards.map((card) => card === proposal.rightCard ? proposal.leftCard : card));
  if (!ordinaryRowValid(nextLeft) || !ordinaryRowValid(nextRight)) return false;
  const leftKey = rowKey(left.cards), rightKey = rowKey(right.cards), nextLeftKey = rowKey(nextLeft), nextRightKey = rowKey(nextRight);
  if (nextLeftKey === nextRightKey || (state.rowKeys.has(nextLeftKey) && nextLeftKey !== leftKey && nextLeftKey !== rightKey)
    || (state.rowKeys.has(nextRightKey) && nextRightKey !== leftKey && nextRightKey !== rightKey)) return false;
  let nextOverlapSix = state.overlapSix;
  for (let index = 0; index < state.rows.length; index += 1) {
    if (index === proposal.leftIndex || index === proposal.rightIndex) continue;
    const other = state.rows[index]!.cards;
    const oldLeft = overlap(left.cards, other), oldRight = overlap(right.cards, other);
    const newLeft = overlap(nextLeft, other), newRight = overlap(nextRight, other);
    if (newLeft > MAX_OVERLAP || newRight > MAX_OVERLAP) return false;
    nextOverlapSix += Number(newLeft === 6) + Number(newRight === 6) - Number(oldLeft === 6) - Number(oldRight === 6);
  }
  if (overlap(nextLeft, nextRight) > MAX_OVERLAP) return false;
  const before = objectiveForState(state);
  adjustRow(state, left, -1); adjustRow(state, right, -1);
  const oldLeftCards = left.cards, oldRightCards = right.cards;
  left.cards = nextLeft; right.cards = nextRight;
  adjustRow(state, left, 1); adjustRow(state, right, 1);
  const oldOverlapSix = state.overlapSix; state.overlapSix = nextOverlapSix;
  const after = objectiveForState(state);
  if (!objectiveBetter(after, before)) {
    adjustRow(state, left, -1); adjustRow(state, right, -1);
    left.cards = oldLeftCards; right.cards = oldRightCards;
    adjustRow(state, left, 1); adjustRow(state, right, 1);
    state.overlapSix = oldOverlapSix;
    return false;
  }
  state.rowKeys.delete(leftKey); state.rowKeys.delete(rightKey);
  state.rowKeys.add(nextLeftKey); state.rowKeys.add(nextRightKey);
  return true;
}

function improveValidationRows(rows: DesignRow[], count: number, restart: number): void {
  const state = createObjectiveState(rows);
  const random = new Random(seedFor(count ^ 0x76616c, 'validation', restart));
  const attempts = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let proposal: SwapProposal | null;
    if (state.validationPairDeficit > 0) proposal = targetPairSwap(state, random, ALL_PAIR_KEYS, 1, true);
    else if (state.validationPriorityDeficit > 0) proposal = targetPairSwap(state, random, [...PRIORITY_PAIR_KEYS], 2, true);
    else if (state.validationRequiredDeficit > 0) proposal = targetTripleSwap(state, random, true, 1);
    else proposal = randomSwap(state, random, 'validation');
    if (!proposal) proposal = randomSwap(state, random, 'validation');
    if (proposal) trySwap(state, proposal, validationObjective);
  }
}

function improveRows(rows: DesignRow[], count: number, restart: number): DesignRow[] {
  const state = createObjectiveState(rows);
  const random = new Random(seedFor(count, 'validation', restart));
  const attempts = count * (count < 160
    ? COMPARISON_OPTIMIZATION_ATTEMPTS_PER_ROW : PASSING_OPTIMIZATION_ATTEMPTS_PER_ROW);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let proposal: SwapProposal | null;
    if (state.pairDeficit > 0) proposal = targetPairSwap(state, random, ALL_PAIR_KEYS, 8, false);
    else if (state.validationPairDeficit > 0) proposal = targetPairSwap(state, random, ALL_PAIR_KEYS, 1, true);
    else if (state.priorityDeficit > 0) proposal = targetPairSwap(state, random, [...PRIORITY_PAIR_KEYS], 12, false);
    else if (state.validationPriorityDeficit > 0) proposal = targetPairSwap(state, random, [...PRIORITY_PAIR_KEYS], 2, true);
    else if (state.requiredDeficit > 0) proposal = targetTripleSwap(state, random, false, 4);
    else if (state.validationRequiredDeficit > 0) proposal = targetTripleSwap(state, random, true, 1);
    else proposal = randomSwap(state, random, state.validationRouteDeficit > 0 ? 'validation' : undefined);
    if (!proposal) proposal = randomSwap(state, random);
    if (proposal) trySwap(state, proposal);
  }
  return state.rows;
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
    overlaps.push(amount); jaccards.push(amount / (2 * KINGDOM_SIZE - amount));
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
    tripleCoverage: full.tripleCoverage, largestOverlap: full.largestOverlap, overlapP99: full.overlap.p99,
    pairCountStandardDeviation: full.pairCountStandardDeviation, deficits, routeCounts: full.routeCounts,
    validationRouteCounts: validation.routeCounts };
}

function replaySelectedDesign(): DesignRow[] {
  const source = rawCoveringDesign as { schemaVersion: number; designVersion: string; cardOrder: string[];
    rowCount: number; search: Record<string, unknown>;
    rows: { split: BalanceSuiteSplit; authored: boolean; cards: string[] }[] };
  if (source.schemaVersion !== 1 || source.designVersion !== 'covering-design-v1' || source.rowCount !== 160
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
  let best: CandidateDesign | null = null, successful = 0;
  const errors: string[] = [];
  for (let restart = 0; restart < CONSTRUCTION_RESTARTS && successful < OPTIMIZATION_RESTARTS; restart += 1) {
    let rows: DesignRow[];
    try { rows = improveRows(buildInitialRows(count, restart), count, restart); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); continue; }
    successful += 1;
    const candidate = candidateFromRows(count, rows), summary = candidate.summary;
    if (!best || (summary.passed && !best.summary.passed)
      || (summary.failures.length < best.summary.failures.length)
      || (summary.failures.length === best.summary.failures.length && summary.tripleCovered > best.summary.tripleCovered)
      || (summary.failures.length === best.summary.failures.length && summary.tripleCovered === best.summary.tripleCovered
        && rows.map((row) => rowKey(row.cards)).join('\n') < best.rows.map((row) => rowKey(row.cards)).join('\n'))) best = candidate;
  }
  if (!best) throw new Error(`Could not construct ${count}-row candidate after ${CONSTRUCTION_RESTARTS} attempts: ${errors.at(-1) ?? 'unknown failure'}`);
  return best;
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
function randomBaselines(candidateSizes: readonly number[]): BalanceSuiteManifest['randomBaselines'] {
  const cardProbability = 1 / 4, pairProbability = 3 / 52, tripleProbability = 3 / 247;
  const overlapHistogram: Record<string, number> = {};
  for (let amount = 0; amount <= 10; amount += 1) {
    overlapHistogram[String(amount)] = round(choose(10, amount) * choose(30, 10 - amount) / choose(40, 10));
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
      expectedUncoveredTriples: round(9880 * (1 - tripleProbability) ** count) })),
    highProbabilityBounds: { everyCardOnce: 24, everyPairOnce: 163, everyTripleOnce: 998,
      everyCardFortyTimes: 236, everyPairEightTimes: 401, priorityPairsTwelveTimes: 455,
      requiredTriplesFourTimes: 1090 },
    randomOverlap: { expected: 2.5, histogram: overlapHistogram }
  };
}

function canonicalCard(card: CardDefinition): CardDefinition {
  return JSON.parse(JSON.stringify(card)) as CardDefinition;
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
  if (!selected) selected = candidates.find((candidate) => candidate.summary.passed) ?? null;
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
      split, startingHealth: 40, actionPiles: row.cards.map((cardId) => ({ cardId, count: 10 })),
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
    schemaVersion: 2, suiteVersion: 'balance-suite-v4', generatorVersion: 'deterministic-covering-v1',
    taxonomyVersion: 'kingdom-taxonomy-v1', interactionVersion: 'kingdom-interactions-v1',
    methodologyVersion: 'coverage-thresholds-v1', campaignProtocolStatus: 'pending-k009-consistency',
    kingdomSize: 10, chosenCount: selected.count,
    selection: { rule: 'First passing integer at or above the 160-row exposure lower bound; always compare 200.',
      requiredCandidateSizes: [...REQUIRED_CANDIDATES], testedCandidateSizes: testedSizes,
      candidates: candidates.map((candidate) => candidate.summary) },
    generator: { baseSeed: BASE_SEED,
      seedDerivation: 'baseSeed xor imul(count, 0x9e3779b1) xor splitSeed xor imul(restart + 1, 0x85ebca6b)',
      greedyCandidatesPerRow: GREEDY_CANDIDATES,
      comparisonOptimizationAttemptsPerRow: COMPARISON_OPTIMIZATION_ATTEMPTS_PER_ROW,
      passingOptimizationAttemptsPerRow: PASSING_OPTIMIZATION_ATTEMPTS_PER_ROW,
      constructionRestarts: CONSTRUCTION_RESTARTS, optimizationRestarts: OPTIMIZATION_RESTARTS,
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
    splits: [
      { name: 'tuning', seed: seedFor(selected.count, 'tuning'), size: rowsBySplit.tuning.length, design: selected.tuning },
      { name: 'validation', seed: seedFor(selected.count, 'validation'), size: rowsBySplit.validation.length, design: selected.validation }],
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

export function validateBalanceSuiteManifest(input: BalanceSuiteManifest): BalanceSuiteManifest {
  validateFrozenInputs();
  if (input.schemaVersion !== 2 || input.suiteVersion !== 'balance-suite-v4'
    || input.generatorVersion !== 'deterministic-covering-v1' || input.taxonomyVersion !== 'kingdom-taxonomy-v1'
    || input.interactionVersion !== 'kingdom-interactions-v1' || input.methodologyVersion !== 'coverage-thresholds-v1') {
    throw new Error('Balance-suite provenance does not match the frozen design protocol.');
  }
  if (input.campaignProtocolStatus !== 'pending-k009-consistency') throw new Error('Unexpected campaign protocol status.');
  if (input.digest !== manifestDigest(input)) throw new Error('Balance-suite manifest digest is invalid.');
  if (input.kingdoms.length !== input.chosenCount) throw new Error('Balance-suite kingdom count does not match selection.');
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
  for (const [kingdomIndex, kingdom] of input.kingdoms.entries()) {
    if (ids.has(kingdom.id)) throw new Error(`Duplicate kingdom ID ${kingdom.id}.`);
    ids.add(kingdom.id);
    if (kingdom.rowDigest !== rowDigest(kingdom)) throw new Error(`Invalid row digest for ${kingdom.id}.`);
    const expectedRow = expectedOrderedRows[kingdomIndex];
    if (!expectedRow || kingdom.split !== expectedRow.split
      || rowKey(kingdom.actionPiles.map((pile) => pile.cardId)) !== rowKey(expectedRow.cards)
      || canonicalJson(kingdom.provenance) !== canonicalJson(expectedRow.provenance)) {
      throw new Error(`Stale row provenance or covering design for ${kingdom.id}.`);
    }
    if (kingdom.startingHealth !== 40 || kingdom.actionPiles.length !== 10 || kingdom.overrides !== undefined
      || kingdom.actionPiles.some((pile) => pile.count !== 10)
      || new Set(kingdom.actionPiles.map((pile) => pile.cardId)).size !== 10
      || kingdom.actionPiles.some((pile) => !ELIGIBLE_SET.has(pile.cardId))) {
      throw new Error(`Invalid kingdom definition ${kingdom.id}.`);
    }
    const cards = kingdom.actionPiles.map((pile) => pile.cardId);
    if (!ordinaryRowValid(cards)) throw new Error(`Kingdom ${kingdom.id} lacks an ordinary route.`);
    assertEqual(kingdom.routeLabels, routeLabels(cards), `Stale route labels for ${kingdom.id}.`);
    rows.push({ cards, split: kingdom.split, authored: kingdom.provenance.kind === 'authored', provenance: kingdom.provenance });
  }
  const tuningRows = rows.filter((row) => row.split === 'tuning').map((row) => row.cards);
  const validationRows = rows.filter((row) => row.split === 'validation').map((row) => row.cards);
  const full = measureBalanceSuiteDesign(rows.map((row) => row.cards));
  const tuning = measureBalanceSuiteDesign(tuningRows), validation = measureBalanceSuiteDesign(validationRows);
  assertEqual(input.statistics, full, 'Balance-suite statistics are stale.');
  const splitMap = new Map(input.splits.map((split) => [split.name, split]));
  assertEqual(splitMap.get('tuning')?.design, tuning, 'Tuning statistics are stale.');
  assertEqual(splitMap.get('validation')?.design, validation, 'Validation statistics are stale.');
  const summary = summarizeCandidate(input.chosenCount, rows, full, tuning, validation);
  if (!summary.passed) throw new Error(`Selected balance suite fails: ${summary.failures.join(', ')}.`);
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
  return input;
}

export const balanceSuiteDesign = Object.freeze({
  generate: generateBalanceSuiteManifest,
  measure: measureBalanceSuiteDesign,
  validate: validateBalanceSuiteManifest,
  serialize: serializeBalanceSuiteManifest,
  digest: manifestDigest
});
