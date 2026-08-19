import { solve } from 'yalps';

export const EQUILIBRIUM_TOLERANCE = 1e-7;
export const SUPPORT_TOLERANCE = 1e-6;
const SHIFT = 2;

export interface EquilibriumResiduals {
  nonnegative: number;
  totalWeight: number;
  value: number;
  payoff: number;
}

export interface EquilibriumResult {
  strategyIds: string[];
  weights: Record<string, number>;
  maximumEquilibriumWeight: Record<string, number>;
  value: number;
  maximumKnownAdvantage: number;
  residuals: EquilibriumResiduals;
}

function validate(ids: readonly string[], payoff: readonly (readonly number[])[]): void {
  if (!ids.length || payoff.length !== ids.length || payoff.some((row) => row.length !== ids.length)) {
    throw new Error('An equilibrium needs a non-empty square payoff matrix.');
  }
  if (new Set(ids).size !== ids.length) throw new Error('Equilibrium strategy ids must be unique.');
  for (let row = 0; row < ids.length; row += 1) {
    for (let column = 0; column < ids.length; column += 1) {
      const value = payoff[row]![column]!;
      if (!Number.isFinite(value)) throw new Error('Equilibrium payoffs must be finite.');
      if (Math.abs(value + payoff[column]![row]!) > EQUILIBRIUM_TOLERANCE) {
        throw new Error('The payoff matrix must be antisymmetric.');
      }
    }
  }
}

function solutionMap(variables: readonly [string, number][]): Map<string, number> {
  return new Map(variables);
}

function baseValue(payoff: readonly (readonly number[])[]): number {
  const variables = new Map<string, Map<string, number>>();
  for (let row = 0; row < payoff.length; row += 1) {
    const coefficients = new Map<string, number>([['objective', 1]]);
    for (let column = 0; column < payoff.length; column += 1) {
      coefficients.set(`column:${column}`, payoff[row]![column]! + SHIFT);
    }
    variables.set(`x:${row}`, coefficients);
  }
  const constraints = new Map<string, { min: number }>();
  for (let column = 0; column < payoff.length; column += 1) constraints.set(`column:${column}`, { min: 1 });
  const result = solve({ direction: 'minimize', objective: 'objective', constraints, variables },
    { precision: 1e-10, checkCycles: true });
  if (result.status !== 'optimal' || !(result.result > 0)) {
    throw new Error(`Equilibrium value LP failed: ${result.status}.`);
  }
  return 1 / result.result - SHIFT;
}

function witness(
  ids: readonly string[], payoff: readonly (readonly number[])[], value: number, objectiveIndex: number
): number[] {
  const constraints = new Map<string, { min?: number; max?: number; equal?: number }>();
  constraints.set('total', { equal: 1 });
  for (let column = 0; column < ids.length; column += 1) {
    constraints.set(`column:${column}`, { min: value - EQUILIBRIUM_TOLERANCE });
  }
  const variables = new Map<string, Map<string, number>>();
  for (let row = 0; row < ids.length; row += 1) {
    const coefficients = new Map<string, number>([
      ['total', 1], ['objective', row === objectiveIndex ? 1 : 0]
    ]);
    for (let column = 0; column < ids.length; column += 1) {
      coefficients.set(`column:${column}`, payoff[row]![column]!);
    }
    variables.set(`p:${row}`, coefficients);
  }
  const result = solve({ direction: 'maximize', objective: 'objective', constraints, variables },
    { precision: 1e-10, checkCycles: true });
  if (result.status !== 'optimal') throw new Error(`Maximum-support LP failed: ${result.status}.`);
  const values = solutionMap(result.variables);
  return ids.map((_id, index) => values.get(`p:${index}`) ?? 0);
}

export function solveEquilibrium(
  inputIds: readonly string[], inputPayoff: readonly (readonly number[])[]
): EquilibriumResult {
  validate(inputIds, inputPayoff);
  const order = inputIds.map((id, index) => ({ id, index })).sort((a, b) => a.id.localeCompare(b.id));
  const ids = order.map((entry) => entry.id);
  const payoff = order.map((row) => order.map((column) => inputPayoff[row.index]![column.index]!));
  const value = baseValue(payoff);
  if (Math.abs(value) > EQUILIBRIUM_TOLERANCE * 4) {
    throw new Error(`Antisymmetric equilibrium value ${value} exceeds tolerance.`);
  }
  const witnesses = ids.map((_id, index) => witness(ids, payoff, value, index));
  const maxima = witnesses.map((entry, index) => Math.max(0, entry[index]!));
  const supported = witnesses.filter((_entry, index) => maxima[index]! > SUPPORT_TOLERANCE);
  if (!supported.length) throw new Error('Maximum-support equilibrium has empty support.');
  const raw = ids.map((_id, index) => supported.reduce((sum, entry) => sum + entry[index]!, 0) / supported.length);
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  const weights = raw.map((weight) => Math.max(0, weight / total));
  const columnPayoffs = ids.map((_id, column) =>
    weights.reduce((sum, weight, row) => sum + weight * payoff[row]![column]!, 0));
  const pureAgainstMixture = ids.map((_id, row) =>
    weights.reduce((sum, weight, column) => sum + weight * payoff[row]![column]!, 0));
  const residuals = {
    nonnegative: Math.max(0, ...weights.map((weight) => -weight)),
    totalWeight: Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1),
    value: Math.abs(value),
    payoff: Math.max(0, ...columnPayoffs.map((payoffValue) => value - payoffValue))
  };
  if (Math.max(...Object.values(residuals)) > EQUILIBRIUM_TOLERANCE * 8) {
    throw new Error(`Equilibrium residual exceeds tolerance: ${JSON.stringify(residuals)}.`);
  }
  return {
    strategyIds: ids,
    weights: Object.fromEntries(ids.map((id, index) => [id, weights[index]!])),
    maximumEquilibriumWeight: Object.fromEntries(ids.map((id, index) => [id, maxima[index]!])),
    value,
    maximumKnownAdvantage: Math.max(0, ...pureAgainstMixture),
    residuals
  };
}
