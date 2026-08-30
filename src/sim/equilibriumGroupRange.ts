import { solve } from 'yalps';

export interface EquilibriumGroupWeightRange {
  minimum: number;
  maximum: number;
}

export interface EquilibriumGroupRangeDiagnostics extends EquilibriumGroupWeightRange {
  minimumSolver: 'primary' | 'fallback';
  maximumSolver: 'primary' | 'fallback';
}

const TOLERANCE = 1e-7;
type Direction = 'minimize' | 'maximize';

function validateInput(ids: readonly string[], payoff: readonly (readonly number[])[], value: number,
  groupIds: ReadonlySet<string>): void {
  if (!ids.length || payoff.length !== ids.length || payoff.some((row) => row.length !== ids.length)
    || new Set(ids).size !== ids.length || !Number.isFinite(value)) throw new Error('Equilibrium group range input is invalid.');
  const known = new Set(ids);
  for (const id of groupIds) if (!known.has(id)) throw new Error(`Unknown equilibrium strategy id ${id}.`);
  for (let row = 0; row < ids.length; row += 1) for (let column = 0; column < ids.length; column += 1) {
    const held = payoff[row]![column]!;
    if (!Number.isFinite(held) || Math.abs(held + payoff[column]![row]!) > TOLERANCE) {
      throw new Error('Equilibrium group range payoff is invalid.');
    }
  }
}

function candidateOrders(ids: readonly string[], groupIds: ReadonlySet<string>): string[][] {
  const sorted = [...ids].sort((left, right) => left.localeCompare(right));
  const grouped = [...sorted.filter((id) => groupIds.has(id)), ...sorted.filter((id) => !groupIds.has(id))];
  const ungrouped = [...sorted.filter((id) => !groupIds.has(id)), ...sorted.filter((id) => groupIds.has(id))];
  const rotate = (offset: number) => [...sorted.slice(offset), ...sorted.slice(0, offset)];
  const candidates = [sorted, [...sorted].reverse(), grouped, ungrouped,
    rotate(Math.floor(sorted.length / 3)), rotate(Math.floor(2 * sorted.length / 3))];
  const seen = new Set<string>();
  return candidates.filter((order) => { const key = order.join('\0'); if (seen.has(key)) return false; seen.add(key); return true; });
}

function validateSolution(ids: readonly string[], payoff: readonly (readonly number[])[], value: number,
  groupIds: ReadonlySet<string>, weights: ReadonlyMap<string, number>, solverObjective: number): number {
  const values = ids.map((id) => weights.get(id) ?? 0);
  if (values.some((weight) => !Number.isFinite(weight) || weight < -TOLERANCE)) {
    throw new Error('Equilibrium group range returned invalid weights.');
  }
  const total = values.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > TOLERANCE) throw new Error('Equilibrium group range weights do not sum to one.');
  for (let column = 0; column < ids.length; column += 1) {
    const constraint = values.reduce((sum, weight, row) => sum + weight * payoff[row]![column]!, 0);
    if (constraint < value - TOLERANCE * 1.01) throw new Error('Equilibrium group range violates a payoff constraint.');
  }
  const objective = ids.reduce((sum, id, index) => sum + (groupIds.has(id) ? values[index]! : 0), 0);
  if (!Number.isFinite(solverObjective) || Math.abs(objective - solverObjective) > TOLERANCE) {
    throw new Error('Equilibrium group range objective does not match its weights.');
  }
  return Math.max(0, Math.min(1, objective));
}

function attempt(ids: readonly string[], payoff: readonly (readonly number[])[], value: number,
  groupIds: ReadonlySet<string>, direction: Direction, objectiveSign: 1 | -1):
  { objective: number; fallback: boolean } {
  const index = new Map(ids.map((id, position) => [id, position]));
  const orders = candidateOrders(ids, groupIds);
  const failures: string[] = [];
  for (let orderIndex = 0; orderIndex < orders.length; orderIndex += 1) {
    const order = orders[orderIndex]!;
    const constraints = new Map<string, { min?: number; equal?: number }>([['total', { equal: 1 }]]);
    for (const id of order) constraints.set(`column:${id}`, { min: value - TOLERANCE });
    const variables = new Map<string, Map<string, number>>();
    for (const rowId of order) {
      const row = index.get(rowId)!;
      const coefficients = new Map<string, number>([
        ['total', 1], ['objective', groupIds.has(rowId) ? objectiveSign : 0]
      ]);
      for (const columnId of order) coefficients.set(`column:${columnId}`,
        payoff[row]![index.get(columnId)!]!);
      variables.set(`p:${rowId}`, coefficients);
    }
    const result = solve({ direction, objective: 'objective', constraints, variables },
      { precision: 1e-10, checkCycles: true, maxPivots: 100_000 });
    if (result.status !== 'optimal') { failures.push(result.status); continue; }
    try {
      const weights = new Map(result.variables.map(([name, weight]) => [name.slice(2), weight]));
      const signed = validateSolution(ids, payoff, value, groupIds, weights, result.result / objectiveSign);
      return { objective: signed, fallback: orderIndex > 0 };
    } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  }
  throw new Error(`Equilibrium group-weight LP failed: ${failures.join(', ')}.`);
}

function optimum(ids: readonly string[], payoff: readonly (readonly number[])[], value: number,
  groupIds: ReadonlySet<string>, direction: Direction): { objective: number; fallback: boolean } {
  const primary = attempt(ids, payoff, value, groupIds, direction, 1);
  const opposite: Direction = direction === 'minimize' ? 'maximize' : 'minimize';
  const independent = attempt(ids, payoff, value, groupIds, opposite, -1);
  if (Math.abs(primary.objective - independent.objective) > TOLERANCE) {
    throw new Error('Independent equilibrium group-range objectives disagree.');
  }
  return { objective: primary.objective, fallback: primary.fallback || independent.fallback };
}

export function equilibriumGroupWeightRangeDetailed(
  ids: readonly string[], payoff: readonly (readonly number[])[], value: number, inputGroupIds: Iterable<string>
): EquilibriumGroupRangeDiagnostics {
  const groupIds = new Set(inputGroupIds);
  validateInput(ids, payoff, value, groupIds);
  const minimum = optimum(ids, payoff, value, groupIds, 'minimize');
  const maximum = optimum(ids, payoff, value, groupIds, 'maximize');
  if (minimum.objective > maximum.objective + TOLERANCE) throw new Error('Equilibrium group range is inverted.');
  return { minimum: minimum.objective, maximum: maximum.objective,
    minimumSolver: minimum.fallback ? 'fallback' : 'primary',
    maximumSolver: maximum.fallback ? 'fallback' : 'primary' };
}

export function equilibriumGroupWeightRange(
  ids: readonly string[], payoff: readonly (readonly number[])[], value: number, groupIds: Iterable<string>
): EquilibriumGroupWeightRange {
  const { minimum, maximum } = equilibriumGroupWeightRangeDetailed(ids, payoff, value, groupIds);
  return { minimum, maximum };
}
