import { SeededRandom, registerKingdom } from '../game';
import type { Kingdom } from '../game';
import { EXPERIMENT_DEFAULTS, ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../sim/experimentConfig';
import { mixtureSchedule } from '../sim/mixtureEvaluation';
import { emptyAggregate } from '../sim/pairing';
import { WorkerPairingRunner } from '../sim/pairingRunner';
import { runPsro } from '../sim/psro';
import type { FinalSearchOutcome, FinalSearchOptions } from '../sim/finalSearch';
import type { Strategy } from '../sim/strategy';
import type { TrainingSummary } from '../shared/api';

export interface AiTrainingResult { strategy: Strategy; summary: TrainingSummary }
export interface AiTrainer { train(kingdom: Kingdom, seed: number): Promise<AiTrainingResult> }
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
    bestTrainingMean: 0, candidateId: null, heldOutMean: null, interval: null,
    admitted: false, matches: 0, telemetry: emptyAggregate(), screenTelemetry: emptyAggregate(),
    confirmationTelemetry: emptyAggregate(), failureReason: null
  } };
}

export class AiTrainingError extends Error {}

export class ProductionAiTrainer implements AiTrainer {
  constructor(private readonly limits: AiTrainingLimits = EXPERIMENT_DEFAULTS.full) {}

  async train(kingdom: Kingdom, seed: number): Promise<AiTrainingResult> {
    registerKingdom(kingdom);
    const started = Date.now();
    const deadline = started + this.limits.deadlineMinutes * 60_000;
    const runner = new WorkerPairingRunner(
      this.limits.workers, new URL('./aiWorker.ts', import.meta.url), { kingdom }, ['--import', 'tsx']
    );
    try {
      const result = await runPsro({
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
      const weighted = result.strategies.map((strategy) => ({
        strategy, weight: result.equilibrium!.weights[strategy.id] ?? 0
      })).filter((entry) => entry.weight > 0);
      if (!weighted.length) throw new AiTrainingError('AI training produced no selectable strategy.');
      const random = new SeededRandom(seed ^ 0xa17e51);
      const target = random.nextInt(1_000_000) / 1_000_000;
      let cumulative = 0;
      let strategy = weighted.at(-1)!.strategy;
      for (const entry of weighted) {
        cumulative += entry.weight;
        if (target <= cumulative) { strategy = entry.strategy; break; }
      }
      return { strategy, summary: {
        elapsedMs: Date.now() - started, matches: result.matches, strategyId: strategy.id
      } };
    } finally {
      await runner.close();
    }
  }
}
