import { SeededRandom, registerKingdom } from '../game';
import type { Kingdom } from '../game';
import { EXPERIMENT_DEFAULTS, ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../sim/experimentConfig';
import { mixtureSchedule } from '../sim/mixtureEvaluation';
import { emptyAggregate } from '../sim/pairing';
import { WorkerPairingRunner } from '../sim/pairingRunner';
import type { PairingRunner } from '../sim/pairingRunner';
import { runPsro } from '../sim/psro';
import type { FinalSearchOutcome, FinalSearchOptions } from '../sim/finalSearch';
import type { Strategy } from '../sim/strategy';
import type { AiDifficulty, TrainingSummary } from '../shared/api';

export interface AiTrainingResult { strategy: Strategy; summary: TrainingSummary }
export interface AiTrainer { train(kingdom: Kingdom, seed: number, difficulty: AiDifficulty): Promise<AiTrainingResult> }
export interface AiTrainingLimits {
  restarts: number; initialStrategies: number; candidates: number; iterations: number;
  seeds: number; unionIterations: number; workers: number; deadlineMinutes: number;
  finalSearch?: 'full' | 'none' | undefined;
}

async function noFinalChallenger(options: FinalSearchOptions): Promise<FinalSearchOutcome> {
  const schedule = mixtureSchedule(options.targetWeights, [], options.seeds.candidate[0]!);
  const sources = { requested: 0, requestedLocal: 0, requestedRandom: 0, actual: 0, local: 0, random: 0,
    duplicateRejections: 0, localShortfall: 0, randomShortfall: 0 };
  return { candidate: null, result: {
    objective: 'final', sources, screenSchedule: schedule, confirmSchedule: schedule,
    bestTrainingMean: 0, candidateId: null, heldOutMean: null, interval: null, rounds: [],
    admitted: false, matches: 0, telemetry: emptyAggregate(), screenTelemetry: emptyAggregate(),
    confirmationTelemetry: emptyAggregate(), failureReason: null
  } };
}

export class AiTrainingError extends Error {}
export interface AiTrainerDependencies {
  runSearch?: typeof runPsro | undefined;
  createRunner?: ((kingdom: Kingdom, workers: number) => PairingRunner) | undefined;
}

export class ProductionAiTrainer implements AiTrainer {
  constructor(
    private readonly limits: AiTrainingLimits = EXPERIMENT_DEFAULTS.full,
    private readonly dependencies: AiTrainerDependencies = {}
  ) {}

  async train(kingdom: Kingdom, seed: number, difficulty: AiDifficulty): Promise<AiTrainingResult> {
    const started = Date.now();
    const deadline = started + this.limits.deadlineMinutes * 60_000;
    let runner: PairingRunner | null = null;
    let output: AiTrainingResult | null = null;
    let failure: AiTrainingError | null = null;
    try {
      registerKingdom(kingdom);
      runner = this.dependencies.createRunner?.(kingdom, this.limits.workers) ?? new WorkerPairingRunner(
        this.limits.workers, new URL('./aiWorker.ts', import.meta.url), { kingdom }, ['--import', 'tsx']
      );
      const result = await (this.dependencies.runSearch ?? runPsro)({
        kingdomId: kingdom.id, seed, restarts: this.limits.restarts,
        initialStrategies: this.limits.initialStrategies, candidates: this.limits.candidates,
        iterations: this.limits.iterations, seeds: this.limits.seeds,
        unionIterations: this.limits.unionIterations, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
        actionCapPerTurn: ACTION_CAP_PER_TURN,
        searchDeadline: started + Math.round((deadline - started) * 0.7), finalDeadline: deadline,
        ...(this.limits.finalSearch === 'none' ? { finalSearch: noFinalChallenger } : {})
      }, runner);
      if (!result.valid || !result.equilibrium) {
        throw new AiTrainingError(result.failure?.message ?? `AI training stopped: ${result.stopReason}.`);
      }
      const strategy = selectStrategy(result, seed, difficulty);
      output = { strategy, summary: {
        elapsedMs: Date.now() - started, matches: result.matches, strategyId: strategy.id
      } };
    } catch (error) {
      failure = error instanceof AiTrainingError ? error
        : new AiTrainingError(`AI training failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (runner) {
      try { await runner.close(); }
      catch (error) {
        failure = new AiTrainingError(`AI training cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failure) throw failure;
    if (!output) throw new AiTrainingError('AI training did not return a strategy.');
    return output;
  }
}

const DIFFICULTY_TARGETS: Record<Exclude<AiDifficulty, 'expert'>, number> = {
  easy: 0.325, normal: 0.4, hard: 0.45
};
const DIFFICULTY_SEEDS: Record<Exclude<AiDifficulty, 'expert'>, number> = {
  easy: 0xe451, normal: 0x4e6f, hard: 0xa4d1
};
const SCORE_TOLERANCE = 1e-12;

function selectStrategy(
  result: Awaited<ReturnType<typeof runPsro>>, seed: number, difficulty: AiDifficulty
): Strategy {
  if (!result.equilibrium) throw new AiTrainingError('AI training produced no equilibrium.');
  if (difficulty === 'expert') {
    const weighted = result.strategies.map((strategy) => ({
      strategy, weight: result.equilibrium!.weights[strategy.id] ?? 0
    })).filter((entry) => entry.weight > 0);
    if (!weighted.length) throw new AiTrainingError('AI training produced no selectable strategy.');
    const random = new SeededRandom(seed ^ 0xa17e51);
    const target = random.nextInt(1_000_000) / 1_000_000;
    let cumulative = 0;
    let selected = weighted.at(-1)!.strategy;
    for (const entry of weighted) {
      cumulative += entry.weight;
      if (target <= cumulative) { selected = entry.strategy; break; }
    }
    return selected;
  }

  const target = DIFFICULTY_TARGETS[difficulty];
  const weights = result.equilibrium.weights;
  const scored = result.matrix.strategies.map((strategy, row) => ({
    strategy,
    score: (1 + result.matrix.strategies.reduce((sum, opponent, column) =>
      sum + (weights[opponent.id] ?? 0) * result.matrix.centeredPayoffs[row]![column]!, 0)) / 2
  }));
  if (!scored.length) throw new AiTrainingError('AI training produced no selectable strategy.');
  const inBand = scored.filter((entry) => Math.abs(entry.score - target) <= 0.025 + SCORE_TOLERANCE);
  const smallestDistance = Math.min(...scored.map((entry) => Math.abs(entry.score - target)));
  const selectable = inBand.length ? inBand : scored.filter((entry) =>
    Math.abs(Math.abs(entry.score - target) - smallestDistance) <= SCORE_TOLERANCE);
  return selectable[new SeededRandom(seed ^ DIFFICULTY_SEEDS[difficulty]).nextInt(selectable.length)]!.strategy;
}
