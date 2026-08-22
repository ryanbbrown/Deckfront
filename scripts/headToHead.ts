/**
 * Scores strategies against one fixed opponent or an exact weighted opponent mixture.
 *
 * Every seed plays all four orientations, so seat, move order and arena side cancel exactly. Mixture
 * scores average each seed across every positive-weight opponent before bootstrap sampling. Results
 * stream in slices, because a sweep can hold more candidates than memory can score at once.
 */
import type { PairingJob, PairingRunner } from '../src/sim/pairingRunner';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import type { Strategy } from '../src/sim/strategy';

export const MAXIMUM_PAIRING_SEEDS = 25;

export interface HeadToHeadScore {
  strategy: Strategy;
  mean: number;
  blockScores: number[];
  matches: number;
}

export interface WeightedOpponent { strategy: Strategy; weight: number }
export type HeadToHeadTarget = Strategy | readonly WeightedOpponent[];

export function seedRange(first: number, count: number): number[] {
  return Array.from({ length: count }, (_value, index) => first + index);
}

/** One pairing takes at most 25 shared seeds, so a longer list becomes several pairings. */
function seedChunks(seeds: readonly number[]): number[][] {
  const chunks: number[][] = [];
  for (let index = 0; index < seeds.length; index += MAXIMUM_PAIRING_SEEDS) {
    chunks.push([...seeds.slice(index, index + MAXIMUM_PAIRING_SEEDS)]);
  }
  return chunks;
}

export type ProgressReporter = (done: number, total: number) => void;

export interface HeadToHeadOptions { startingDraftEnabled?: boolean }

function weightedOpponents(target: HeadToHeadTarget): WeightedOpponent[] {
  const entries = Array.isArray(target) ? [...target] : [{ strategy: target as Strategy, weight: 1 }];
  const positive = entries.filter((entry) => entry.weight > 0);
  const total = positive.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) throw new Error('Head-to-head scoring needs positive opponent weight.');
  return positive.map((entry) => ({ ...entry, weight: entry.weight / total }));
}

async function scoreSlice(
  runner: PairingRunner, kingdomId: string, candidates: readonly Strategy[], target: HeadToHeadTarget,
  seeds: readonly number[], options: HeadToHeadOptions
): Promise<HeadToHeadScore[]> {
  const chunks = seedChunks(seeds);
  const opponents = weightedOpponents(target);
  const jobsPerCandidate = opponents.length * chunks.length;
  const jobs: PairingJob[] = candidates.flatMap((candidate) => opponents.flatMap((entry) =>
    chunks.map((chunk) => ({
      candidate, opponent: entry.strategy,
      options: { kingdomId, seeds: chunk, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
        actionCapPerTurn: ACTION_CAP_PER_TURN,
        startingDraftEnabled: options.startingDraftEnabled ?? true, allowEarlyStop: false }
    }))));
  const batch = await runner.run(jobs);
  if (batch.submitted !== jobs.length) throw new Error('The pairing runner dropped jobs.');
  return candidates.map((strategy, candidateIndex) => {
    const blockScores = Array<number>(seeds.length).fill(0);
    let matches = 0;
    for (let opponentIndex = 0; opponentIndex < opponents.length; opponentIndex += 1) {
      const opponent = opponents[opponentIndex]!;
      let seedIndex = 0;
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const outcomeIndex = candidateIndex * jobsPerCandidate
          + opponentIndex * chunks.length + chunkIndex;
        const outcome = batch.outcomes[outcomeIndex]!;
        if (outcome.record.aborted > 0) throw new Error(`An aborted match invalidated ${strategy.id}.`);
        for (const block of outcome.blocks) {
          blockScores[seedIndex]! += block.score * opponent.weight;
          seedIndex += 1;
        }
        matches += outcome.matches;
      }
    }
    return { strategy, blockScores, matches,
      mean: blockScores.reduce((sum, value) => sum + value, 0) / blockScores.length };
  });
}

export async function headToHead(
  runner: PairingRunner, kingdomId: string, candidates: readonly Strategy[], target: HeadToHeadTarget,
  seeds: readonly number[], slice: number, report?: ProgressReporter,
  options: HeadToHeadOptions = {}
): Promise<HeadToHeadScore[]> {
  const scored: HeadToHeadScore[] = [];
  for (let index = 0; index < candidates.length; index += slice) {
    scored.push(...await scoreSlice(
      runner, kingdomId, candidates.slice(index, index + slice), target, seeds, options
    ));
    report?.(scored.length, candidates.length);
  }
  return scored;
}

/** Scores a stream of candidates, keeping only the best, so a round never holds the whole space. */
export async function headToHeadStream(
  runner: PairingRunner, kingdomId: string, candidates: Iterable<Strategy>, target: HeadToHeadTarget,
  seeds: readonly number[], slice: number, keep: number, report?: ProgressReporter,
  options: HeadToHeadOptions = {}
): Promise<{ best: HeadToHeadScore[]; count: number; matches: number }> {
  const best: HeadToHeadScore[] = [];
  let count = 0;
  let matches = 0;
  let pending: Strategy[] = [];
  const flush = async (): Promise<void> => {
    if (!pending.length) return;
    const scored = await scoreSlice(runner, kingdomId, pending, target, seeds, options);
    best.push(...scored);
    for (const score of scored) matches += score.matches;
    count += pending.length;
    pending = [];
    best.sort((left, right) => right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
    best.length = Math.min(best.length, keep);
    report?.(count, count);
  };
  for (const candidate of candidates) {
    pending.push(candidate);
    if (pending.length >= slice) await flush();
  }
  await flush();
  return { best, count, matches };
}
