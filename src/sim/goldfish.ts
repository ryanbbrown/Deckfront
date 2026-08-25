import { runGoldfishTrial, runLeanGoldfishTrial } from './simulationKernel';
import type { GoldfishMovementProfile, GoldfishTrialResult } from './simulationKernel';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export interface GoldfishConfig {
  kingdomId: string;
  seeds: readonly number[];
  turnLimit: number;
  actionCapPerTurn: number;
  movementProfile?: GoldfishMovementProfile;
}

export interface GoldfishScore {
  strategy: Strategy;
  trials: number;
  completions: number;
  meanTurnsTo50: number | null;
  totalTurnsTo50: number;
  damageArea: number;
  totalDamage: number;
  meanDamage: number;
  moneySpent: number;
  unspentMoney: number;
  penalizedTurnsTo50: number;
}

export type GoldfishMetrics = Omit<GoldfishScore, 'strategy'>;

export interface MovementAwareGoldfishScore {
  strategy: Strategy;
  profiles: Array<{ profile: GoldfishMovementProfile; score: GoldfishMetrics }>;
  worstCompletions: number;
  totalCompletions: number;
  worstPenalizedTurnsTo50: number;
  totalPenalizedTurnsTo50: number;
  worstDamageArea: number;
  totalDamageArea: number;
  totalMoneySpent: number;
}

export interface CompactMovementAwareGoldfishScore {
  strategy: Strategy;
  worstCompletions: number;
  totalCompletions: number;
  worstPenalizedTurnsTo50: number;
  totalPenalizedTurnsTo50: number;
  worstDamageArea: number;
  totalDamageArea: number;
  totalMoneySpent: number;
  strategyId: string;
  collisionTieKey: string;
}

export type MovementAwareRankingScore = MovementAwareGoldfishScore | CompactMovementAwareGoldfishScore;

export interface EnrichmentCohorts {
  selected: MovementAwareGoldfishScore[];
  controls: MovementAwareGoldfishScore[];
}

export interface CompetitiveGoldfishEntry { strategyId: string; lotteryId: string; score: number }
export interface CompetitiveGoldfishSummary {
  candidateScores: Array<{ strategyId: string; mean: number }>;
  mean: number;
  median: number;
  maximum: number;
  above40: number;
  above50: number;
  above55: number;
  perLotteryMaximum: Record<string, number>;
}

function damageArea(trial: GoldfishTrialResult, turnLimit: number): number {
  let total = 0;
  for (let turn = 0; turn < turnLimit; turn += 1) {
    total += trial.damageByTurn[turn] ?? trial.damageByTurn.at(-1) ?? 0;
  }
  return total;
}

export function scoreGoldfishStrategy(strategy: Strategy, config: GoldfishConfig): GoldfishScore {
  if (!config.seeds.length) throw new Error('Goldfish scoring needs at least one seed.');
  const trials = config.seeds.map((seed) => runGoldfishTrial({
    kingdomId: config.kingdomId, seed, strategy,
    turnLimit: config.turnLimit, actionCapPerTurn: config.actionCapPerTurn,
    ...(config.movementProfile ? { movementProfile: config.movementProfile } : {})
  }));
  const completed = trials.filter((trial) => trial.completed);
  const totalTurnsTo50 = completed.reduce((sum, trial) => sum + trial.turnsTo50!, 0);
  const finalDamage = trials.reduce((sum, trial) => sum + (trial.damageByTurn.at(-1) ?? 0), 0);
  return {
    strategy, trials: trials.length, completions: completed.length,
    meanTurnsTo50: completed.length ? totalTurnsTo50 / completed.length : null,
    totalTurnsTo50, damageArea: trials.reduce((sum, trial) => sum + damageArea(trial, config.turnLimit), 0),
    totalDamage: finalDamage, meanDamage: finalDamage / trials.length,
    moneySpent: trials.reduce((sum, trial) => sum + trial.moneySpent, 0),
    unspentMoney: trials.reduce((sum, trial) => sum + trial.unspentMoney, 0),
    penalizedTurnsTo50: trials.reduce((sum, trial) =>
      sum + (trial.completed ? trial.turnsTo50! : config.turnLimit + 1), 0)
  };
}

/** Reliable kills first, then speed, early damage, useful spending, and stable identity. */
export function compareGoldfishScores(left: GoldfishScore, right: GoldfishScore): number {
  return right.completions - left.completions
    || left.totalTurnsTo50 - right.totalTurnsTo50
    || right.damageArea - left.damageArea
    || right.moneySpent - left.moneySpent
    || compareUtf16(left.strategy.id, right.strategy.id)
    || compareUtf16(canonicalStrategy(left.strategy), canonicalStrategy(right.strategy));
}

export const GOLDFISH_MOVEMENT_PROFILES = Object.freeze([
  'stationary', 'chaser', 'kiter'
] as const satisfies readonly GoldfishMovementProfile[]);

export function scoreGoldfishStrategyLean(strategy: Strategy, config: GoldfishConfig): GoldfishScore {
  if (!config.seeds.length) throw new Error('Goldfish scoring needs at least one seed.');
  const trials = config.seeds.map((seed) => runLeanGoldfishTrial({
    kingdomId: config.kingdomId, seed, strategy,
    turnLimit: config.turnLimit, actionCapPerTurn: config.actionCapPerTurn,
    ...(config.movementProfile ? { movementProfile: config.movementProfile } : {})
  }));
  const completed = trials.filter((trial) => trial.completed);
  const totalTurnsTo50 = completed.reduce((sum, trial) => sum + trial.turnsTo50!, 0);
  const finalDamage = trials.reduce((sum, trial) => sum + trial.finalDamage, 0);
  return {
    strategy, trials: trials.length, completions: completed.length,
    meanTurnsTo50: completed.length ? totalTurnsTo50 / completed.length : null,
    totalTurnsTo50, damageArea: trials.reduce((sum, trial) => sum + trial.damageArea, 0),
    totalDamage: finalDamage, meanDamage: finalDamage / trials.length,
    moneySpent: trials.reduce((sum, trial) => sum + trial.moneySpent, 0),
    unspentMoney: trials.reduce((sum, trial) => sum + trial.unspentMoney, 0),
    penalizedTurnsTo50: trials.reduce((sum, trial) =>
      sum + (trial.completed ? trial.turnsTo50! : config.turnLimit + 1), 0)
  };
}

function goldfishMetrics(complete: GoldfishScore): GoldfishMetrics {
  return {
    trials: complete.trials, completions: complete.completions,
    meanTurnsTo50: complete.meanTurnsTo50, totalTurnsTo50: complete.totalTurnsTo50,
    damageArea: complete.damageArea, totalDamage: complete.totalDamage,
    meanDamage: complete.meanDamage, moneySpent: complete.moneySpent,
    unspentMoney: complete.unspentMoney, penalizedTurnsTo50: complete.penalizedTurnsTo50
  };
}

function movementAwareScore(
  strategy: Strategy, config: GoldfishConfig,
  scorer: (strategy: Strategy, config: GoldfishConfig) => GoldfishScore
): MovementAwareGoldfishScore {
  const profiles = GOLDFISH_MOVEMENT_PROFILES.map((profile) => ({ profile,
    score: goldfishMetrics(scorer(strategy, { ...config, movementProfile: profile }))
  }));
  const values = profiles.map((entry) => entry.score);
  return {
    strategy, profiles,
    worstCompletions: Math.min(...values.map((score) => score.completions)),
    totalCompletions: values.reduce((sum, score) => sum + score.completions, 0),
    worstPenalizedTurnsTo50: Math.max(...values.map((score) => score.penalizedTurnsTo50)),
    totalPenalizedTurnsTo50: values.reduce((sum, score) => sum + score.penalizedTurnsTo50, 0),
    worstDamageArea: Math.min(...values.map((score) => score.damageArea)),
    totalDamageArea: values.reduce((sum, score) => sum + score.damageArea, 0),
    totalMoneySpent: values.reduce((sum, score) => sum + score.moneySpent, 0)
  };
}

export function scoreMovementAwareGoldfishStrategyLean(
  strategy: Strategy, config: GoldfishConfig, mode: 'full'
): MovementAwareGoldfishScore;
export function scoreMovementAwareGoldfishStrategyLean(
  strategy: Strategy, config: GoldfishConfig, mode?: 'compact'
): CompactMovementAwareGoldfishScore;
export function scoreMovementAwareGoldfishStrategyLean(
  strategy: Strategy, config: GoldfishConfig, mode: 'full' | 'compact' = 'compact'
): MovementAwareGoldfishScore | CompactMovementAwareGoldfishScore {
  const full = movementAwareScore(strategy, config, scoreGoldfishStrategyLean);
  if (mode === 'full') return full;
  return compactMovementAwareGoldfishScore(full);
}

export function compactMovementAwareGoldfishScore(
  score: MovementAwareGoldfishScore
): CompactMovementAwareGoldfishScore {
  return {
    strategy: score.strategy, worstCompletions: score.worstCompletions,
    totalCompletions: score.totalCompletions,
    worstPenalizedTurnsTo50: score.worstPenalizedTurnsTo50,
    totalPenalizedTurnsTo50: score.totalPenalizedTurnsTo50,
    worstDamageArea: score.worstDamageArea, totalDamageArea: score.totalDamageArea,
    totalMoneySpent: score.totalMoneySpent, strategyId: score.strategy.id,
    collisionTieKey: canonicalStrategy(score.strategy)
  };
}

export function rankingKeyText(score: MovementAwareRankingScore): string {
  const strategyId = 'strategyId' in score ? score.strategyId : score.strategy.id;
  const collisionTieKey = 'collisionTieKey' in score
    ? score.collisionTieKey : canonicalStrategy(score.strategy);
  return [score.worstCompletions, score.totalCompletions, score.worstPenalizedTurnsTo50,
    score.totalPenalizedTurnsTo50, score.worstDamageArea, score.totalDamageArea,
    score.totalMoneySpent, strategyId, collisionTieKey].join('\t');
}

export function rankingDigest(scores: readonly MovementAwareRankingScore[]): string {
  return stableHash(scores.map(rankingKeyText).join('\n'));
}

export function scoreMovementAwareGoldfishStrategy(
  strategy: Strategy, config: GoldfishConfig
): MovementAwareGoldfishScore {
  return movementAwareScore(strategy, config, scoreGoldfishStrategy);
}

export function mergeMovementAwareGoldfishScores(
  parts: readonly MovementAwareGoldfishScore[]
): MovementAwareGoldfishScore {
  if (!parts.length) throw new Error('Movement-aware goldfish merging needs score evidence.');
  const strategy = parts[0]!.strategy;
  if (parts.some((part) => part.strategy.id !== strategy.id)) {
    throw new Error('Movement-aware goldfish evidence must describe one strategy.');
  }
  const profiles = GOLDFISH_MOVEMENT_PROFILES.map((profile) => {
    const metrics = parts.map((part) => part.profiles.find((entry) => entry.profile === profile)?.score);
    if (metrics.some((entry) => !entry)) throw new Error(`Missing ${profile} goldfish evidence.`);
    const scores = metrics as GoldfishMetrics[];
    const trials = scores.reduce((sum, score) => sum + score.trials, 0);
    const completions = scores.reduce((sum, score) => sum + score.completions, 0);
    const totalTurnsTo50 = scores.reduce((sum, score) => sum + score.totalTurnsTo50, 0);
    const totalDamage = scores.reduce((sum, score) => sum + score.totalDamage, 0);
    return { profile, score: {
      trials, completions, meanTurnsTo50: completions ? totalTurnsTo50 / completions : null,
      totalTurnsTo50,
      damageArea: scores.reduce((sum, score) => sum + score.damageArea, 0),
      totalDamage, meanDamage: totalDamage / trials,
      moneySpent: scores.reduce((sum, score) => sum + score.moneySpent, 0),
      unspentMoney: scores.reduce((sum, score) => sum + score.unspentMoney, 0),
      penalizedTurnsTo50: scores.reduce((sum, score) => sum + score.penalizedTurnsTo50, 0)
    } };
  });
  const values = profiles.map((entry) => entry.score);
  return { strategy, profiles,
    worstCompletions: Math.min(...values.map((score) => score.completions)),
    totalCompletions: values.reduce((sum, score) => sum + score.completions, 0),
    worstPenalizedTurnsTo50: Math.max(...values.map((score) => score.penalizedTurnsTo50)),
    totalPenalizedTurnsTo50: values.reduce((sum, score) => sum + score.penalizedTurnsTo50, 0),
    worstDamageArea: Math.min(...values.map((score) => score.damageArea)),
    totalDamageArea: values.reduce((sum, score) => sum + score.damageArea, 0),
    totalMoneySpent: values.reduce((sum, score) => sum + score.moneySpent, 0) };
}

export function compareMovementAwareGoldfishScores(
  left: MovementAwareRankingScore, right: MovementAwareRankingScore
): number {
  return right.worstCompletions - left.worstCompletions
    || right.totalCompletions - left.totalCompletions
    || left.worstPenalizedTurnsTo50 - right.worstPenalizedTurnsTo50
    || left.totalPenalizedTurnsTo50 - right.totalPenalizedTurnsTo50
    || right.worstDamageArea - left.worstDamageArea
    || right.totalDamageArea - left.totalDamageArea
    || right.totalMoneySpent - left.totalMoneySpent
    || compareUtf16(left.strategy.id, right.strategy.id)
    || compareUtf16(canonicalStrategy(left.strategy), canonicalStrategy(right.strategy));
}

function seededIdentityRank(id: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function selectEnrichmentCohorts(
  scores: readonly MovementAwareGoldfishScore[], count: number, controlSeed: number
): EnrichmentCohorts {
  if (count < 1 || scores.length < count * 2) throw new Error('Enrichment cohorts need two full groups.');
  const selected = [...scores].sort(compareMovementAwareGoldfishScores).slice(0, count);
  const selectedIds = new Set(selected.map((entry) => entry.strategy.id));
  const controls = scores.filter((entry) => !selectedIds.has(entry.strategy.id)).sort((left, right) =>
    seededIdentityRank(left.strategy.id, controlSeed) - seededIdentityRank(right.strategy.id, controlSeed)
      || compareUtf16(left.strategy.id, right.strategy.id)
      || compareUtf16(canonicalStrategy(left.strategy), canonicalStrategy(right.strategy))).slice(0, count);
  return { selected, controls };
}

export function summarizeCompetitiveGoldfishEntries(
  entries: readonly CompetitiveGoldfishEntry[]
): CompetitiveGoldfishSummary {
  if (!entries.length) throw new Error('Competitive goldfish summary needs evidence.');
  const lotteryIds = [...new Set(entries.map((entry) => entry.lotteryId))].sort();
  const byCandidate = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const rows = byCandidate.get(entry.strategyId) ?? new Map<string, number>();
    if (rows.has(entry.lotteryId)) throw new Error('Duplicate candidate-lottery evidence.');
    rows.set(entry.lotteryId, entry.score); byCandidate.set(entry.strategyId, rows);
  }
  const candidateScores = [...byCandidate].map(([strategyId, rows]) => {
    if (rows.size !== lotteryIds.length) throw new Error('Every candidate needs every lottery.');
    return { strategyId, mean: [...rows.values()].reduce((sum, score) => sum + score, 0) / rows.size };
  }).sort((left, right) => right.mean - left.mean || compareUtf16(left.strategyId, right.strategyId));
  const values = candidateScores.map((entry) => entry.mean).sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
  const perLotteryMaximum = Object.fromEntries(lotteryIds.map((lotteryId) => [lotteryId,
    Math.max(...entries.filter((entry) => entry.lotteryId === lotteryId).map((entry) => entry.score))]));
  return {
    candidateScores,
    mean: values.reduce((sum, score) => sum + score, 0) / values.length,
    median,
    maximum: Math.max(...values),
    above40: values.filter((score) => score >= 0.4).length,
    above50: values.filter((score) => score >= 0.5).length,
    above55: values.filter((score) => score >= 0.55).length,
    perLotteryMaximum
  };
}
