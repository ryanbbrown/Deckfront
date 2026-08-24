import { runGoldfishTrial } from './simulationKernel';
import type { GoldfishTrialResult } from './simulationKernel';
import type { Strategy } from './strategy';

export interface GoldfishConfig {
  kingdomId: string;
  seeds: readonly number[];
  turnLimit: number;
  actionCapPerTurn: number;
}

export interface GoldfishScore {
  strategy: Strategy;
  trials: number;
  completions: number;
  meanTurnsTo50: number | null;
  totalTurnsTo50: number;
  damageArea: number;
  meanDamage: number;
  moneySpent: number;
  unspentMoney: number;
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
    turnLimit: config.turnLimit, actionCapPerTurn: config.actionCapPerTurn
  }));
  const completed = trials.filter((trial) => trial.completed);
  const totalTurnsTo50 = completed.reduce((sum, trial) => sum + trial.turnsTo50!, 0);
  const finalDamage = trials.reduce((sum, trial) => sum + (trial.damageByTurn.at(-1) ?? 0), 0);
  return {
    strategy, trials: trials.length, completions: completed.length,
    meanTurnsTo50: completed.length ? totalTurnsTo50 / completed.length : null,
    totalTurnsTo50, damageArea: trials.reduce((sum, trial) => sum + damageArea(trial, config.turnLimit), 0),
    meanDamage: finalDamage / trials.length,
    moneySpent: trials.reduce((sum, trial) => sum + trial.moneySpent, 0),
    unspentMoney: trials.reduce((sum, trial) => sum + trial.unspentMoney, 0)
  };
}

/** Reliable kills first, then speed, early damage, useful spending, and stable identity. */
export function compareGoldfishScores(left: GoldfishScore, right: GoldfishScore): number {
  return right.completions - left.completions
    || left.totalTurnsTo50 - right.totalTurnsTo50
    || right.damageArea - left.damageArea
    || right.moneySpent - left.moneySpent
    || left.strategy.id.localeCompare(right.strategy.id);
}
