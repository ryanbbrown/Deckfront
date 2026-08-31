import { solve } from 'yalps';
import type { Constraint, Model, SolutionStatus } from 'yalps';
import { BALANCE_SUITE_MANIFEST } from './balanceSuite';
import { PRIORITY_PAIRS, REQUIRED_TRIPLES, canonicalJson } from './balanceSuiteDesign';
import {
  BALANCE_SMOKE_CANDIDATE_BOUNDS, BALANCE_SMOKE_SOLVER_OPTIONS,
  balanceSmokeSuiteDesignDigest, createBalanceSmokeSuiteDesignContent,
  validateBalanceSmokeSuiteDesignIdentity
} from './balanceSmokeSuiteDesign';
import type {
  BalanceSmokeSearchExchange, BalanceSmokeSearchScore, BalanceSmokeSuiteDesignSource
} from './balanceSmokeSuiteDesign';

export { serializeBalanceSmokeSuiteDesign } from './balanceSmokeSuiteDesign';
export type {
  BalanceSmokeSearchCandidate, BalanceSmokeSearchExchange, BalanceSmokeSearchScore,
  BalanceSmokeSuiteDesignSource
} from './balanceSmokeSuiteDesign';

interface SearchRow {
  id: string;
  cards: number[];
  pairs: number[];
  triples: number[];
  routes: number[];
}

interface SearchProtocol {
  sourceRows: SearchRow[];
  cardIds: string[];
  priorityPairIndexes: Set<number>;
  requiredTripleIndexes: Set<number>;
  routeLabels: string[];
}

interface StateDelta {
  cards: Map<number, number>;
  pairs: Map<number, number>;
  triples: Map<number, number>;
  routes: Map<number, number>;
}

interface InternalExchange extends BalanceSmokeSearchExchange {
  removeIndex: number;
  insertIndex: number;
  delta: StateDelta;
}

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const squareSum = (values: readonly number[]): number => values.reduce((sum, value) => sum + value * value, 0);

function combinations(length: number, amount: 2 | 3): number[][] {
  const result: number[][] = [];
  for (let first = 0; first < length; first += 1) {
    for (let second = first + 1; second < length; second += 1) {
      if (amount === 2) result.push([first, second]);
      else for (let third = second + 1; third < length; third += 1) result.push([first, second, third]);
    }
  }
  return result;
}

function searchProtocol(): SearchProtocol {
  const cardIds = [...BALANCE_SUITE_MANIFEST.cardPool.orderedVariableCardIds];
  const cardIndex = new Map(cardIds.map((id, index) => [id, index]));
  const pairIndex = new Map(combinations(cardIds.length, 2).map((cards, index) => [cards.join('|'), index]));
  const tripleIndex = new Map(combinations(cardIds.length, 3).map((cards, index) => [cards.join('|'), index]));
  const routeLabels = Object.keys(BALANCE_SUITE_MANIFEST.statistics.routeCounts).sort(compareCodeUnits);
  const routeIndex = new Map(routeLabels.map((label, index) => [label, index]));
  const source = BALANCE_SUITE_MANIFEST.kingdoms.filter((kingdom) => kingdom.split === 'tuning')
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const sourceRows = source.map((kingdom): SearchRow => {
    const cards = kingdom.actionPiles.map((pile) => cardIndex.get(pile.cardId)!)
      .sort((left, right) => left - right);
    return {
      id: kingdom.id,
      cards,
      pairs: combinations(cards.length, 2).map((positions) => pairIndex.get(positions.map((position) => cards[position]!).join('|'))!),
      triples: combinations(cards.length, 3).map((positions) => tripleIndex.get(positions.map((position) => cards[position]!).join('|'))!),
      routes: kingdom.routeLabels.map((label) => routeIndex.get(label)!)
    };
  });
  const interactionIndex = (ids: readonly string[]): number[] => ids.map((id) => cardIndex.get(id)!).sort((left, right) => left - right);
  return {
    sourceRows,
    cardIds,
    priorityPairIndexes: new Set(PRIORITY_PAIRS.map((pair) => pairIndex.get(interactionIndex(pair.cards).join('|'))!)),
    requiredTripleIndexes: new Set(REQUIRED_TRIPLES.map((triple) => tripleIndex.get(interactionIndex(triple.cards).join('|'))!)),
    routeLabels
  };
}

function addDelta(map: Map<number, number>, indexes: readonly number[], amount: number): void {
  for (const index of indexes) map.set(index, (map.get(index) ?? 0) + amount);
}

function rowDelta(remove: SearchRow, insert: SearchRow): StateDelta {
  const delta = { cards: new Map<number, number>(), pairs: new Map<number, number>(),
    triples: new Map<number, number>(), routes: new Map<number, number>() };
  addDelta(delta.cards, remove.cards, -1); addDelta(delta.cards, insert.cards, 1);
  addDelta(delta.pairs, remove.pairs, -1); addDelta(delta.pairs, insert.pairs, 1);
  addDelta(delta.triples, remove.triples, -1); addDelta(delta.triples, insert.triples, 1);
  addDelta(delta.routes, remove.routes, -1); addDelta(delta.routes, insert.routes, 1);
  return delta;
}

class SearchState {
  readonly selected = new Set<number>();
  readonly cardCounts: number[];
  readonly pairCounts: number[];
  readonly tripleCounts: number[];
  readonly routeCounts: number[];
  score: BalanceSmokeSearchScore;

  constructor(readonly protocol: SearchProtocol, ids: readonly string[]) {
    const indexById = new Map(protocol.sourceRows.map((row, index) => [row.id, index]));
    this.cardCounts = Array(protocol.cardIds.length).fill(0) as number[];
    this.pairCounts = Array(combinations(protocol.cardIds.length, 2).length).fill(0) as number[];
    this.tripleCounts = Array(combinations(protocol.cardIds.length, 3).length).fill(0) as number[];
    this.routeCounts = Array(protocol.routeLabels.length).fill(0) as number[];
    for (const id of ids) {
      const index = indexById.get(id);
      if (index === undefined) throw new Error(`Unknown balance-smoke source kingdom ${id}.`);
      if (this.selected.has(index)) throw new Error(`Duplicate balance-smoke source kingdom ${id}.`);
      this.selected.add(index);
      this.adjust(protocol.sourceRows[index]!, 1);
    }
    this.score = this.measureScore();
  }

  private adjust(row: SearchRow, amount: number): void {
    for (const index of row.cards) this.cardCounts[index]! += amount;
    for (const index of row.pairs) this.pairCounts[index]! += amount;
    for (const index of row.triples) this.tripleCounts[index]! += amount;
    for (const index of row.routes) this.routeCounts[index]! += amount;
  }

  private measureScore(): BalanceSmokeSearchScore {
    return {
      broadPairs: this.pairCounts.filter((count) => count > 0).length,
      broadTriples: this.tripleCounts.filter((count) => count > 0).length,
      maximumCardExposure: Math.max(...this.cardCounts),
      cardExposureSquareSum: squareSum(this.cardCounts),
      pairExposureSquareSum: squareSum(this.pairCounts)
    };
  }

  isFeasible(delta: StateDelta | null, minimum: number, maximum: number | null): boolean {
    const value = (counts: readonly number[], index: number, changes: ReadonlyMap<number, number>): number =>
      counts[index]! + (delta ? changes.get(index) ?? 0 : 0);
    for (let index = 0; index < this.cardCounts.length; index += 1) {
      const count = value(this.cardCounts, index, delta?.cards ?? new Map());
      if (count < minimum || (maximum !== null && count > maximum)) return false;
    }
    for (const index of this.protocol.priorityPairIndexes) if (value(this.pairCounts, index, delta?.pairs ?? new Map()) < 1) return false;
    for (const index of this.protocol.requiredTripleIndexes) if (value(this.tripleCounts, index, delta?.triples ?? new Map()) < 1) return false;
    for (let index = 0; index < this.routeCounts.length; index += 1) {
      if (value(this.routeCounts, index, delta?.routes ?? new Map()) < 1) return false;
    }
    return true;
  }

  scoreAfter(delta: StateDelta): BalanceSmokeSearchScore {
    const nextCards = this.cardCounts.map((count, index) => count + (delta.cards.get(index) ?? 0));
    let broadPairs = this.score.broadPairs, broadTriples = this.score.broadTriples;
    for (const [index, amount] of delta.pairs) {
      const before = this.pairCounts[index]!, after = before + amount;
      broadPairs += Number(before === 0 && after > 0) - Number(before > 0 && after === 0);
    }
    for (const [index, amount] of delta.triples) {
      const before = this.tripleCounts[index]!, after = before + amount;
      broadTriples += Number(before === 0 && after > 0) - Number(before > 0 && after === 0);
    }
    let pairExposureSquareSum = this.score.pairExposureSquareSum;
    for (const [index, amount] of delta.pairs) {
      const before = this.pairCounts[index]!;
      pairExposureSquareSum += (before + amount) ** 2 - before ** 2;
    }
    return { broadPairs, broadTriples, maximumCardExposure: Math.max(...nextCards),
      cardExposureSquareSum: squareSum(nextCards), pairExposureSquareSum };
  }

  apply(exchange: InternalExchange): void {
    this.adjust(this.protocol.sourceRows[exchange.removeIndex]!, -1);
    this.adjust(this.protocol.sourceRows[exchange.insertIndex]!, 1);
    this.selected.delete(exchange.removeIndex); this.selected.add(exchange.insertIndex);
    this.score = exchange.score;
  }

  ids(): string[] {
    return [...this.selected].sort((left, right) => left - right).map((index) => this.protocol.sourceRows[index]!.id);
  }
}

function scoreTuple(score: BalanceSmokeSearchScore): number[] {
  return [score.broadPairs, score.broadTriples, -score.maximumCardExposure,
    -score.cardExposureSquareSum, -score.pairExposureSquareSum];
}

function compareScores(left: BalanceSmokeSearchScore, right: BalanceSmokeSearchScore): number {
  const leftTuple = scoreTuple(left), rightTuple = scoreTuple(right);
  for (let index = 0; index < leftTuple.length; index += 1) {
    if (leftTuple[index] !== rightTuple[index]) return leftTuple[index]! > rightTuple[index]! ? 1 : -1;
  }
  return 0;
}

function bestExchange(state: SearchState, minimum: number, maximum: number | null): InternalExchange | null {
  let bestScore = state.score, best: InternalExchange | null = null;
  const selected = [...state.selected].sort((left, right) => left - right);
  const unselected = state.protocol.sourceRows.map((_, index) => index).filter((index) => !state.selected.has(index));
  for (const removeIndex of selected) for (const insertIndex of unselected) {
    const delta = rowDelta(state.protocol.sourceRows[removeIndex]!, state.protocol.sourceRows[insertIndex]!);
    if (!state.isFeasible(delta, minimum, maximum)) continue;
    const score = state.scoreAfter(delta);
    if (compareScores(score, bestScore) > 0) {
      bestScore = score;
      best = { removeIndex, insertIndex, delta,
        removeKingdomId: state.protocol.sourceRows[removeIndex]!.id,
        insertKingdomId: state.protocol.sourceRows[insertIndex]!.id, score };
    }
  }
  return best;
}

function candidateBound(count: number): typeof BALANCE_SMOKE_CANDIDATE_BOUNDS[number] {
  const bound = BALANCE_SMOKE_CANDIDATE_BOUNDS.find((entry) => entry.count === count);
  if (!bound) throw new Error(`Unsupported balance-smoke candidate size ${count}.`);
  return bound;
}

function solverModel(protocol: SearchProtocol, count: number, minimum: number,
  maximum: number | null): Model<string, string> {
  const constraints: Record<string, Constraint> = { count: { equal: count } };
  for (let index = 0; index < protocol.cardIds.length; index += 1) {
    constraints[`card:${index}`] = maximum === null ? { min: minimum } : { min: minimum, max: maximum };
  }
  for (const index of protocol.priorityPairIndexes) constraints[`pair:${index}`] = { min: 1 };
  for (const index of protocol.requiredTripleIndexes) constraints[`triple:${index}`] = { min: 1 };
  for (let index = 0; index < protocol.routeLabels.length; index += 1) constraints[`route:${index}`] = { min: 1 };
  const variables: Record<string, Record<string, number>> = {};
  for (const [sourceIndex, row] of protocol.sourceRows.entries()) {
    const coefficients: Record<string, number> = { count: 1, sourceIndex: sourceIndex + 1 };
    for (const index of row.cards) coefficients[`card:${index}`] = 1;
    for (const index of row.pairs) if (protocol.priorityPairIndexes.has(index)) coefficients[`pair:${index}`] = 1;
    for (const index of row.triples) if (protocol.requiredTripleIndexes.has(index)) coefficients[`triple:${index}`] = 1;
    for (const index of row.routes) coefficients[`route:${index}`] = 1;
    variables[`row:${sourceIndex}`] = coefficients;
  }
  return { direction: 'minimize', objective: 'sourceIndex', constraints, variables, binaries: true };
}

export function generateBalanceSmokeSuiteYalpsModel(count: number): Model<string, string> {
  const protocol = searchProtocol(), bound = candidateBound(count);
  return solverModel(protocol, bound.count, bound.minimum, bound.maximum);
}

function solverSeed(protocol: SearchProtocol, count: number, minimum: number, maximum: number | null): {
  status: SolutionStatus; objective: number; ids: string[]
} {
  const solution = solve(solverModel(protocol, count, minimum, maximum), BALANCE_SMOKE_SOLVER_OPTIONS);
  const indexes = solution.variables.filter(([, value]) => value > 0.5)
    .map(([key]) => Number(String(key).slice('row:'.length))).sort((left, right) => left - right);
  if (solution.status !== 'optimal' || indexes.length !== count) {
    throw new Error(`YALPS did not find an optimal ${count}-kingdom balance-smoke seed: ${solution.status}.`);
  }
  const objective = indexes.reduce((sum, index) => sum + index + 1, 0);
  return { status: solution.status, objective, ids: indexes.map((index) => protocol.sourceRows[index]!.id) };
}

export function generateBalanceSmokeSuiteDesign(): BalanceSmokeSuiteDesignSource {
  const protocol = searchProtocol(), content = createBalanceSmokeSuiteDesignContent();
  for (const bound of BALANCE_SMOKE_CANDIDATE_BOUNDS) {
    const seed = solverSeed(protocol, bound.count, bound.minimum, bound.maximum);
    const state = new SearchState(protocol, seed.ids);
    if (!state.isFeasible(null, bound.minimum, bound.maximum)) throw new Error(`YALPS returned an infeasible ${bound.count}-kingdom seed.`);
    const initialScore = { ...state.score }, acceptedExchanges: BalanceSmokeSearchExchange[] = [];
    for (let exchange = bestExchange(state, bound.minimum, bound.maximum); exchange;
      exchange = bestExchange(state, bound.minimum, bound.maximum)) {
      acceptedExchanges.push({ removeKingdomId: exchange.removeKingdomId,
        insertKingdomId: exchange.insertKingdomId, score: { ...exchange.score } });
      state.apply(exchange);
    }
    content.candidates.push({ count: bound.count, cardMinimum: bound.minimum, cardMaximum: bound.maximum,
      solverStatus: seed.status, solverObjective: seed.objective, initialKingdomIds: [...seed.ids], initialScore,
      acceptedExchanges, finalKingdomIds: state.ids(), finalScore: { ...state.score } });
  }
  const design = content as BalanceSmokeSuiteDesignSource;
  return { ...design, digest: balanceSmokeSuiteDesignDigest(design) };
}

function assertSame(actual: unknown, expected: unknown, message: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(message);
}

export function validateBalanceSmokeSuiteDesign(input: BalanceSmokeSuiteDesignSource): BalanceSmokeSuiteDesignSource {
  validateBalanceSmokeSuiteDesignIdentity(input);
  const protocol = searchProtocol();
  for (const [candidateIndex, candidate] of input.candidates.entries()) {
    const bound = BALANCE_SMOKE_CANDIDATE_BOUNDS[candidateIndex]!;
    if (candidate.count !== bound.count || candidate.cardMinimum !== bound.minimum || candidate.cardMaximum !== bound.maximum
      || candidate.solverStatus !== 'optimal' || candidate.initialKingdomIds.length !== bound.count
      || candidate.finalKingdomIds.length !== bound.count) {
      throw new Error(`Balance-smoke candidate ${bound.count} provenance is invalid.`);
    }
    const state = new SearchState(protocol, candidate.initialKingdomIds);
    if (!state.isFeasible(null, bound.minimum, bound.maximum)) throw new Error(`Balance-smoke candidate ${bound.count} seed is infeasible.`);
    const objective = [...state.selected].reduce((sum, index) => sum + index + 1, 0);
    if (candidate.solverObjective !== objective) throw new Error(`Balance-smoke candidate ${bound.count} solver objective is stale.`);
    assertSame(candidate.initialScore, state.score, `Balance-smoke candidate ${bound.count} initial score is stale.`);
    for (const recorded of candidate.acceptedExchanges) {
      const exchange = bestExchange(state, bound.minimum, bound.maximum);
      if (!exchange || exchange.removeKingdomId !== recorded.removeKingdomId
        || exchange.insertKingdomId !== recorded.insertKingdomId) {
        throw new Error(`Balance-smoke candidate ${bound.count} exchange provenance is stale.`);
      }
      assertSame(recorded.score, exchange.score, `Balance-smoke candidate ${bound.count} exchange score is stale.`);
      state.apply(exchange);
    }
    if (bestExchange(state, bound.minimum, bound.maximum)) {
      throw new Error(`Balance-smoke candidate ${bound.count} is not a one-exchange local optimum.`);
    }
    assertSame(candidate.finalKingdomIds, state.ids(), `Balance-smoke candidate ${bound.count} final IDs are stale.`);
    assertSame(candidate.finalScore, state.score, `Balance-smoke candidate ${bound.count} final score is stale.`);
  }
  return input;
}

export function findBestBalanceSmokeSuiteExchange(ids: readonly string[], count: number): BalanceSmokeSearchExchange | null {
  const protocol = searchProtocol(), bound = candidateBound(count), state = new SearchState(protocol, ids);
  if (ids.length !== count || !state.isFeasible(null, bound.minimum, bound.maximum)) {
    throw new Error(`Balance-smoke candidate ${count} is infeasible.`);
  }
  const exchange = bestExchange(state, bound.minimum, bound.maximum);
  return exchange ? { removeKingdomId: exchange.removeKingdomId,
    insertKingdomId: exchange.insertKingdomId, score: exchange.score } : null;
}
