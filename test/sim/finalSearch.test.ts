import { afterEach, describe, expect, it } from 'vitest';
import { resetKingdoms } from '../../src/game';
import { balanceSuite } from '../../src/sim/balanceSuite';
import { runFinalSearch } from '../../src/sim/finalSearch';
import { emptyAggregate } from '../../src/sim/pairing';
import type { PairingOutcome } from '../../src/sim/pairing';
import type { PairingJob, PairingRunner } from '../../src/sim/pairingRunner';
import { randomUniqueStrategies } from '../../src/sim/randomStrategy';
import { finalSearchSeedNamespaces } from '../../src/sim/seedNamespaces';
import { canonicalStrategy } from '../../src/sim/strategy';

function outcome(job: PairingJob, score: number): PairingOutcome {
  return {
    record: { played: 4, wins: 2, draws: 0, losses: 2, aborted: 0 },
    candidateScore: score * 4, opponentScore: (1 - score) * 4,
    candidateMean: score, opponentMean: 1 - score, telemetry: emptyAggregate(), matches: 4,
    seedBlocks: 1, stopReason: 'maximum',
    blocks: [{ seed: job.options.seeds[0]!, score, played: 4, aborted: 0 }], aborts: []
  };
}

class RecordingRunner implements PairingRunner {
  readonly batches: PairingJob[][] = [];
  async run(jobs: readonly PairingJob[]) {
    this.batches.push([...jobs]);
    const blockCount = this.batches.length === 1 ? 5 : 25;
    return { submitted: jobs.length, outcomes: jobs.map((job, index) => {
      const candidateIndex = Math.floor(index / blockCount);
      return outcome(job, this.batches.length === 1 ? 0.45 + (candidateIndex % 100) / 1_000 : 0.51);
    }) };
  }
  async close(): Promise<void> {}
}

describe('automatic final search', () => {
  afterEach(() => { resetKingdoms(); });

  it('screens 3,000 random strategies and confirms 20 on fresh shared games', async () => {
    balanceSuite.register();
    const kingdomId = 'balance-tuning-005';
    const opponent = randomUniqueStrategies(kingdomId, 1, 1).strategies[0]!;
    const runner = new RecordingRunner();
    const result = await runFinalSearch({ targetWeights: { [opponent.id]: 1 }, strategies: [opponent],
      kingdomId, seeds: finalSearchSeedNamespaces(7, 0), turnLimitPerPlayer: 30,
      actionCapPerTurn: 200, runner });
    expect(result.result).toMatchObject({ objective: 'final', admitted: false,
      sources: { requested: 3_000, actual: 3_000, local: 0, random: 3_000 },
      matches: 62_000 });
    expect(runner.batches.map((batch) => batch.length)).toEqual([15_000, 500]);
    const screen = runner.batches[0]!;
    const candidates = Array.from({ length: 3_000 }, (_entry, index) => screen[index * 5]!.candidate);
    expect(new Set(candidates.map(canonicalStrategy)).size).toBe(3_000);
    expect(screen.slice(0, 5).map((job) => job.options.seeds[0]))
      .toEqual(screen.slice(5, 10).map((job) => job.options.seeds[0]));
    expect(runner.batches[1]!.slice(0, 25).map((job) => job.options.seeds[0]))
      .not.toEqual(screen.slice(0, 5).map((job) => job.options.seeds[0]));
  });
});
