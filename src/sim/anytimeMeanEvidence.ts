export const BETTING_LAMBDAS = Object.freeze([
  1 / 256, 1 / 128, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1
] as const);

export type MeanEvidenceDirection = 'greater' | 'less';

export interface AnytimeMeanEvidence {
  threshold: number;
  direction: MeanEvidenceDirection;
  observations: number;
  logEValue: number;
  maximumLogEValue: number;
  pValue: number;
}

function validScores(values: readonly number[]): void {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('Anytime mean evidence needs finite scores in [0, 1].');
  }
}

function logMeanExp(values: readonly number[]): number {
  const maximum = Math.max(...values);
  return maximum + Math.log(values.reduce((sum, value) => sum + Math.exp(value - maximum), 0) / values.length);
}

export function anytimeMeanEvidence(
  values: readonly number[], threshold: number, direction: MeanEvidenceDirection
): AnytimeMeanEvidence {
  validScores(values);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
    throw new Error('Anytime mean threshold must be inside (0, 1).');
  }
  const capitals = BETTING_LAMBDAS.map(() => 0);
  let maximumLogEValue = 0;
  let logEValue = 0;
  for (const value of values) {
    const difference = direction === 'greater' ? value - threshold : threshold - value;
    for (let index = 0; index < BETTING_LAMBDAS.length; index += 1) {
      const factor = 1 + BETTING_LAMBDAS[index]! * difference;
      if (!(factor > 0) || !Number.isFinite(factor)) throw new Error('Betting factor is invalid.');
      capitals[index] = capitals[index]! + Math.log(factor);
    }
    logEValue = logMeanExp(capitals);
    maximumLogEValue = Math.max(maximumLogEValue, logEValue);
  }
  return { threshold, direction, observations: values.length, logEValue, maximumLogEValue,
    pValue: Math.min(1, Math.exp(-maximumLogEValue)) };
}

export interface HolmResult {
  id: string;
  pValue: number;
  adjustedPValue: number;
  rejected: boolean;
  order: number;
}

export function holmStepDown(
  entries: readonly { id: string; pValue: number }[], alpha: number
): HolmResult[] {
  if (!entries.length || !Number.isFinite(alpha) || alpha <= 0 || alpha >= 1
    || new Set(entries.map((entry) => entry.id)).size !== entries.length
    || entries.some((entry) => !entry.id || !Number.isFinite(entry.pValue)
      || entry.pValue < 0 || entry.pValue > 1)) throw new Error('Holm input is invalid.');
  const ordered = [...entries].sort((left, right) => left.pValue - right.pValue || left.id.localeCompare(right.id));
  let running = 0;
  let accepting = true;
  const results = ordered.map((entry, index): HolmResult => {
    running = Math.max(running, Math.min(1, (ordered.length - index) * entry.pValue));
    const rejected = accepting && entry.pValue <= alpha / (ordered.length - index);
    if (!rejected) accepting = false;
    return { ...entry, adjustedPValue: running, rejected, order: index + 1 };
  });
  return results.sort((left, right) => left.id.localeCompare(right.id));
}

function bisect(predicate: (value: number) => boolean, transition: 'true-to-false' | 'false-to-true'): number {
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 21; iteration += 1) {
    const middle = (low + high) / 2;
    const result = predicate(Math.max(1e-9, Math.min(1 - 1e-9, middle)));
    if ((transition === 'true-to-false' && result) || (transition === 'false-to-true' && !result)) low = middle;
    else high = middle;
  }
  return transition === 'true-to-false' ? low : high;
}

export function anytimeConfidenceBounds(values: readonly number[], alpha = 0.05): { lower: number; upper: number } {
  validScores(values);
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) throw new Error('Confidence alpha is invalid.');
  const lowerRejected = (threshold: number) => anytimeMeanEvidence(values, threshold, 'greater').pValue <= alpha / 2;
  const upperRejected = (threshold: number) => anytimeMeanEvidence(values, threshold, 'less').pValue <= alpha / 2;
  const lower = lowerRejected(1e-9) ? bisect(lowerRejected, 'true-to-false') : 0;
  const upper = upperRejected(1 - 1e-9) ? bisect(upperRejected, 'false-to-true') : 1;
  return { lower, upper };
}
