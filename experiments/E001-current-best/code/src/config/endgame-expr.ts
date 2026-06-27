import type { BoolExpr, ComparableValue, GameState, Metric } from '../core/types';

export function metricValue(state: GameState, metric: Metric): ComparableValue {
  if (metric === 'emptyPiles') {
    return Object.values(state.supply).filter((count) => count === 0).length;
  }
  if (metric === 'provincePileEmpty') {
    const province = state.config.cards.find((card) => card.id === 'province' || card.name.toLowerCase() === 'province');
    return province ? state.supply[province.id] === 0 : false;
  }
  return assertNever(metric);
}

export function evaluateEndGame(expr: BoolExpr, state: GameState): boolean {
  if ('and' in expr) {
    return expr.and.every((child) => evaluateEndGame(child, state));
  }
  if ('or' in expr) {
    return expr.or.some((child) => evaluateEndGame(child, state));
  }
  if ('eq' in expr) {
    const [metric, expected] = expr.eq;
    return metricValue(state, metric) === expected;
  }
  if ('gte' in expr) {
    const [metric, expected] = expr.gte;
    const actual = metricValue(state, metric);
    return typeof actual === 'number' && actual >= expected;
  }
  return assertNever(expr);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported end-game expression: ${JSON.stringify(value)}`);
}
