import { SeededRandom } from '../game';
import type { Kingdom } from '../game';
import type { Strategy } from '../sim/strategy';
import type { AiDifficulty, TrainingSummary } from '../shared/api';
import { findPretrainedKingdom } from './pretrainedCatalog';
import type { PretrainedPlan } from './pretrainedCatalog';

export interface AiTrainingResult { strategy: Strategy; summary: TrainingSummary }
export interface AiTrainer { train(kingdom: Kingdom, seed: number, difficulty: AiDifficulty): Promise<AiTrainingResult> }
export class AiTrainingError extends Error {}

const DIFFICULTY_TARGETS: Record<Exclude<AiDifficulty, 'expert'>, number> = {
  easy: 0.325, normal: 0.4, hard: 0.45
};
const DIFFICULTY_SEEDS: Record<Exclude<AiDifficulty, 'expert'>, number> = {
  easy: 0xe451, normal: 0x4e6f, hard: 0xa4d1
};
const SCORE_TOLERANCE = 1e-12;

function selectPlan(plans: readonly PretrainedPlan[], seed: number, difficulty: AiDifficulty): PretrainedPlan {
  if (difficulty === 'expert') {
    const weighted = plans.filter((plan) => plan.equilibriumWeight > 0);
    if (!weighted.length) throw new AiTrainingError('Pretrained AI has no selectable equilibrium strategy.');
    const target = new SeededRandom(seed ^ 0xa17e51).nextInt(1_000_000) / 1_000_000;
    let cumulative = 0;
    let selected = weighted.at(-1)!;
    for (const plan of weighted) {
      cumulative += plan.equilibriumWeight;
      if (target <= cumulative) { selected = plan; break; }
    }
    return selected;
  }

  const target = DIFFICULTY_TARGETS[difficulty];
  const inBand = plans.filter((plan) => Math.abs(plan.selectedLotteryScore - target) <= 0.025 + SCORE_TOLERANCE);
  const smallestDistance = Math.min(...plans.map((plan) => Math.abs(plan.selectedLotteryScore - target)));
  const selectable = inBand.length ? inBand : plans.filter((plan) =>
    Math.abs(Math.abs(plan.selectedLotteryScore - target) - smallestDistance) <= SCORE_TOLERANCE);
  return selectable[new SeededRandom(seed ^ DIFFICULTY_SEEDS[difficulty]).nextInt(selectable.length)]!;
}

export class PretrainedAiTrainer implements AiTrainer {
  async train(kingdom: Kingdom, seed: number, difficulty: AiDifficulty): Promise<AiTrainingResult> {
    const started = Date.now();
    const trained = findPretrainedKingdom(kingdom.actionPiles.map((pile) => pile.cardId));
    if (!trained) throw new AiTrainingError('This kingdom has no pretrained AI opponent.');
    const selected = selectPlan(trained.plans, seed, difficulty);
    const strategy = structuredClone(selected.strategy);
    return { strategy, summary: { elapsedMs: Date.now() - started, matches: 0, strategyId: strategy.id } };
  }
}
