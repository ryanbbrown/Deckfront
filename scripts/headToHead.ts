/**
 * Scores strategies against one fixed opponent, using the same pairing the payoff matrix uses.
 *
 * Every seed plays all four orientations, so seat, move order and arena side cancel exactly. Results
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

async function scoreSlice(
  runner: PairingRunner, kingdomId: string, candidates: readonly Strategy[], opponent: Strategy,
  seeds: readonly number[]
): Promise<HeadToHeadScore[]> {
  const chunks = seedChunks(seeds);
  const jobs: PairingJob[] = candidates.flatMap((candidate) => chunks.map((chunk) => ({
    candidate, opponent,
    options: { kingdomId, seeds: chunk, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
      actionCapPerTurn: ACTION_CAP_PER_TURN, allowEarlyStop: false }
  })));
  const batch = await runner.run(jobs);
  if (batch.submitted !== jobs.length) throw new Error('The pairing runner dropped jobs.');
  return candidates.map((strategy, index) => {
    const blockScores: number[] = [];
    let matches = 0;
    for (let chunk = 0; chunk < chunks.length; chunk += 1) {
      const outcome = batch.outcomes[index * chunks.length + chunk]!;
      if (outcome.record.aborted > 0) throw new Error(`An aborted match invalidated ${strategy.id}.`);
      for (const block of outcome.blocks) blockScores.push(block.score);
      matches += outcome.matches;
    }
    return { strategy, blockScores, matches,
      mean: blockScores.reduce((sum, value) => sum + value, 0) / blockScores.length };
  });
}

export async function headToHead(
  runner: PairingRunner, kingdomId: string, candidates: readonly Strategy[], opponent: Strategy,
  seeds: readonly number[], slice: number, report?: ProgressReporter
): Promise<HeadToHeadScore[]> {
  const scored: HeadToHeadScore[] = [];
  for (let index = 0; index < candidates.length; index += slice) {
    scored.push(...await scoreSlice(runner, kingdomId, candidates.slice(index, index + slice), opponent, seeds));
    report?.(scored.length, candidates.length);
  }
  return scored;
}

/** Scores a stream of candidates, keeping only the best, so a round never holds the whole space. */
export async function headToHeadStream(
  runner: PairingRunner, kingdomId: string, candidates: Iterable<Strategy>, opponent: Strategy,
  seeds: readonly number[], slice: number, keep: number, report?: ProgressReporter
): Promise<{ best: HeadToHeadScore[]; count: number; matches: number }> {
  const best: HeadToHeadScore[] = [];
  let count = 0;
  let matches = 0;
  let pending: Strategy[] = [];
  const flush = async (): Promise<void> => {
    if (!pending.length) return;
    const scored = await scoreSlice(runner, kingdomId, pending, opponent, seeds);
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
