import { SeededRandom } from '../game';
import { evaluateCandidates, mixtureSchedule } from './mixtureEvaluation';
import type { CandidateEvaluation, MixtureBlock, MixtureSchedule } from './mixtureEvaluation';
import type { PairingRunner } from './pairingRunner';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

export interface TrainingCurvePoint {
  candidateBlocks: number;
  matches: number;
  bestMean: number;
  policyId: string;
}

export interface BudgetedResponseObjectiveOptions {
  kingdomId: string;
  opponents: readonly { strategy: Strategy; weight: number }[];
  budget: number;
  scheduleSeed: number;
  runner: PairingRunner;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  startingDraftEnabled?: boolean;
  scheduleSeeds?: readonly number[];
  samplingSeed?: number;
}

interface AggregateScore { strategy: Strategy; total: number; blocks: number }

/** A fixed-lottery objective whose only budget unit is one candidate on one shuffle-seed evaluation. */
export class BudgetedResponseObjective {
  readonly budget: number;
  readonly schedule: MixtureSchedule;
  readonly curve: TrainingCurvePoint[] = [];
  private readonly opponents: ReadonlyMap<string, Strategy>;
  private readonly runner: PairingRunner;
  private readonly options: Pick<BudgetedResponseObjectiveOptions,
    'kingdomId' | 'turnLimitPerPlayer' | 'actionCapPerTurn' | 'startingDraftEnabled'>;
  private readonly aggregates = new Map<string, AggregateScore>();
  private cursor = 0;
  private consumed = 0;
  private played = 0;

  constructor(options: BudgetedResponseObjectiveOptions) {
    if (!Number.isInteger(options.budget) || options.budget < 1) throw new Error('Training budget must be positive.');
    this.budget = options.budget;
    this.runner = options.runner;
    this.options = options;
    this.opponents = new Map(options.opponents.map((entry) => [entry.strategy.id, entry.strategy]));
    const weights = Object.fromEntries(options.opponents.map((entry) => [entry.strategy.id, entry.weight]));
    const random = new SeededRandom(options.scheduleSeed);
    const seeds = options.scheduleSeeds === undefined
      ? Array.from({ length: options.budget }, () => random.nextInt(0x7fffffff) + 1)
      : [...options.scheduleSeeds];
    if (!seeds.length || new Set(seeds).size !== seeds.length) {
      throw new Error('Training schedule seeds must be a non-empty unique sequence.');
    }
    this.schedule = mixtureSchedule(weights, seeds, options.samplingSeed ?? (options.scheduleSeed ^ 0x51f15e3d));
  }

  get blocksConsumed(): number { return this.consumed; }
  get matchesConsumed(): number { return this.played; }
  get remaining(): number { return this.budget - this.consumed; }

  canEvaluate(candidateCount: number, blocks: number): boolean {
    return Number.isInteger(candidateCount) && candidateCount > 0 && Number.isInteger(blocks) && blocks > 0
      && candidateCount * blocks <= this.remaining;
  }

  async evaluate(candidates: readonly Strategy[], blocks: number): Promise<CandidateEvaluation[]> {
    if (!candidates.length) throw new Error('An objective evaluation needs candidates.');
    if (!this.canEvaluate(candidates.length, blocks)) {
      throw new Error(`Evaluation needs ${candidates.length * blocks} seed evaluations with ${this.remaining} left.`);
    }
    if (this.cursor + blocks > this.schedule.blocks.length) this.cursor = 0;
    const selected = this.schedule.blocks.slice(this.cursor, this.cursor + blocks);
    this.cursor += blocks;
    const schedule = scheduleSlice(this.schedule, selected);
    const result = await evaluateCandidates(candidates, this.opponents, schedule, this.runner, this.options);
    this.consumed += candidates.length * blocks;
    for (const evaluation of result) {
      this.played += evaluation.matches;
      const form = canonicalStrategy(evaluation.strategy);
      const aggregate = this.aggregates.get(form) ?? { strategy: evaluation.strategy, total: 0, blocks: 0 };
      aggregate.total += evaluation.blockScores.reduce((sum, score) => sum + score, 0);
      aggregate.blocks += evaluation.blockScores.length;
      this.aggregates.set(form, aggregate);
    }
    const best = [...this.aggregates.values()].sort((left, right) =>
      right.total / right.blocks - left.total / left.blocks
        || left.strategy.id.localeCompare(right.strategy.id))[0]!;
    this.curve.push({ candidateBlocks: this.consumed, matches: this.played,
      bestMean: best.total / best.blocks, policyId: best.strategy.id });
    return result;
  }

  aggregate(strategy: Strategy): { mean: number; blocks: number } | null {
    const held = this.aggregates.get(canonicalStrategy(strategy));
    return held ? { mean: held.total / held.blocks, blocks: held.blocks } : null;
  }
}

function scheduleSlice(schedule: MixtureSchedule, blocks: readonly MixtureBlock[]): MixtureSchedule {
  const realizedOpponentCounts: Record<string, number> = Object.fromEntries(
    Object.keys(schedule.targetWeights).map((id) => [id, 0]));
  for (const block of blocks) realizedOpponentCounts[block.opponentId] = (realizedOpponentCounts[block.opponentId] ?? 0) + 1;
  return {
    targetWeights: schedule.targetWeights,
    blocks: [...blocks],
    realizedOpponentCounts,
    unsampledPositiveWeightStrategies: Object.keys(schedule.targetWeights)
      .filter((id) => !realizedOpponentCounts[id])
  };
}
