import type { Kingdom } from '../game';
import { GAMES_PER_SEED, emptyAggregate } from './pairing';
import type { PairingRunner } from './pairingRunner';
import type { CandidateEvaluation, MixtureSchedule } from './mixtureEvaluation';
import type { CompetitiveBlock, CompetitiveKernelConfig } from './nativeCompetitiveProtocol';
import { DeadlineInterruptionError, InvalidEvaluationError } from './payoffMatrix';
import type { RustGoldfishScorer } from './rustGoldfishScorer';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

const TARGET_BLOCKS_PER_SHARD = 65_536;

export class RustCompetitiveEvaluator {
  private constructor(
    private readonly scorer: RustGoldfishScorer,
    private readonly loadId: string,
    private readonly strategyIndexes: ReadonlyMap<string, number>,
    private readonly canonicalById: ReadonlyMap<string, string>,
    private readonly config: CompetitiveKernelConfig
  ) {}

  static async create(
    scorer: RustGoldfishScorer, kingdom: Kingdom, strategies: readonly Strategy[],
    config: CompetitiveKernelConfig, threads: number, cpuRequest = threads
  ): Promise<RustCompetitiveEvaluator> {
    const indexes = new Map<string, number>();
    const canonicalById = new Map<string, string>();
    strategies.forEach((strategy, index) => {
      const canonical = canonicalStrategy(strategy);
      const held = canonicalById.get(strategy.id);
      if (held !== undefined && held !== canonical) {
        throw new Error(`Competitive strategy id collision: ${strategy.id}.`);
      }
      if (held === undefined) indexes.set(strategy.id, index);
      canonicalById.set(strategy.id, canonical);
    });
    const loadId = await scorer.loadCompetitive(kingdom, strategies, config, threads, cpuRequest);
    return new RustCompetitiveEvaluator(scorer, loadId, indexes, canonicalById, config);
  }

  private strategyIndex(strategy: Strategy): number {
    const index = this.strategyIndexes.get(strategy.id);
    if (index === undefined || this.canonicalById.get(strategy.id) !== canonicalStrategy(strategy)) {
      throw new Error(`Strategy ${strategy.id} is not in the resident competitive table.`);
    }
    return index;
  }

  async evaluate(
    candidates: readonly Strategy[], opponents: ReadonlyMap<string, Strategy>, schedule: MixtureSchedule,
    _runner: PairingRunner, options: {
      kingdomId: string; turnLimitPerPlayer: number; actionCapPerTurn: number;
      startingDraftEnabled?: boolean; deadline?: number; scoreOnly?: boolean;
    }
  ): Promise<CandidateEvaluation[]> {
    if (options.scoreOnly !== true || options.kingdomId !== this.config.kingdomId
      || options.turnLimitPerPlayer !== this.config.turnLimitPerPlayer
      || options.actionCapPerTurn !== this.config.actionCapPerTurn
      || (options.startingDraftEnabled ?? true) !== this.config.startingDraftEnabled) {
      throw new Error('Rust competitive evaluation config does not match the resident kernel.');
    }
    const candidateIndexes = candidates.map((candidate) => this.strategyIndex(candidate));
    const opponentIndexes = schedule.blocks.map((block) => {
      const opponent = opponents.get(block.opponentId);
      if (!opponent) throw new Error(`Mixture opponent ${block.opponentId} is missing.`);
      return this.strategyIndex(opponent);
    });
    const scoreRows = candidates.map(() => new Uint8Array(schedule.blocks.length));
    const candidateSpan = schedule.blocks.length <= TARGET_BLOCKS_PER_SHARD
      ? Math.max(1, Math.floor(TARGET_BLOCKS_PER_SHARD / Math.max(1, schedule.blocks.length))) : 1;
    const scheduleSpan = Math.min(TARGET_BLOCKS_PER_SHARD, schedule.blocks.length);
    for (let candidateStart = 0; candidateStart < candidates.length; candidateStart += candidateSpan) {
      const candidateEnd = Math.min(candidates.length, candidateStart + candidateSpan);
      for (let scheduleStart = 0; scheduleStart < schedule.blocks.length; scheduleStart += scheduleSpan) {
        if (options.deadline !== undefined && Date.now() >= options.deadline) {
          throw new DeadlineInterruptionError('Deadline interrupted a native mixture evaluation.', {
            candidateStart, scheduleStart
          });
        }
        const scheduleEnd = Math.min(schedule.blocks.length, scheduleStart + scheduleSpan);
        const blocks: CompetitiveBlock[] = [];
        for (let candidateIndex = candidateStart; candidateIndex < candidateEnd; candidateIndex += 1) {
          for (let blockIndex = scheduleStart; blockIndex < scheduleEnd; blockIndex += 1) {
            blocks.push({ candidateIndex: candidateIndexes[candidateIndex]!,
              opponentIndex: opponentIndexes[blockIndex]!, seed: schedule.blocks[blockIndex]!.seed });
          }
        }
        const result = await this.scorer.scoreCompetitive(this.loadId, blocks);
        if (result.aborts.length || result.played.some((played) => played !== GAMES_PER_SEED)) {
          throw new InvalidEvaluationError('An aborted match invalidated a native mixture evaluation.', {
            candidateStart, scheduleStart, abort: result.aborts[0]
          });
        }
        let resultIndex = 0;
        for (let candidateIndex = candidateStart; candidateIndex < candidateEnd; candidateIndex += 1) {
          scoreRows[candidateIndex]!.set(
            result.scoreBytes.subarray(resultIndex, resultIndex + scheduleEnd - scheduleStart), scheduleStart);
          resultIndex += scheduleEnd - scheduleStart;
        }
      }
    }
    return candidates.map((strategy, candidateIndex): CandidateEvaluation => {
      const blockScores = Array.from(scoreRows[candidateIndex]!, (score) => score / 4);
      return { strategy, mean: blockScores.reduce((sum, score) => sum + score, 0) / blockScores.length,
        blockScores, interval: null, matches: blockScores.length * GAMES_PER_SEED,
        telemetry: emptyAggregate() };
    });
  }
}
