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
    record: { played: 2, wins: 0, draws: 2, losses: 0, aborted: 0 },
    candidateScore: score * 2, opponentScore: (1 - score) * 2,
    candidateMean: score, opponentMean: 1 - score, telemetry: emptyAggregate(), matches: 2,
    seedsEvaluated: 1, stopReason: 'maximum',
    blocks: [{ seed: job.options.seeds[0]!, score, played: 2, aborted: 0 }], aborts: []
  };
}

class RecordingRunner implements PairingRunner {
  readonly batches: PairingJob[][] = [];
  async run(jobs: readonly PairingJob[]) {
    this.batches.push([...jobs]);
    const blockCount = [1, 2, 4, 8, 25][this.batches.length - 1]!;
    return { submitted: jobs.length, outcomes: jobs.map((job, index) => {
      const candidateIndex = Math.floor(index / blockCount);
      return outcome(job, this.batches.length < 5 ? 0.45 + (candidateIndex % 100) / 1_000 : 0.51);
    }) };
  }
  async close(): Promise<void> {}
}

describe('automatic final search', () => {
  afterEach(() => { resetKingdoms(); });

  it('races 3,000 random strategies and confirms the winner on fresh shared games', async () => {
    balanceSuite.register();
    const kingdomId = 'balance-tuning-005';
    const opponent = randomUniqueStrategies(kingdomId, 1, 1).strategies[0]!;
    const runner = new RecordingRunner();
    const result = await runFinalSearch({ targetWeights: { [opponent.id]: 1 }, strategies: [opponent],
      kingdomId, seeds: finalSearchSeedNamespaces(7, 0), turnLimitPerPlayer: 30,
      actionCapPerTurn: 200, runner });
    expect(result.result).toMatchObject({ objective: 'final', admitted: false,
      sources: { requested: 3_000, actual: 3_000, local: 0, random: 3_000 },
      matches: 14_514 });
    expect(runner.batches.map((batch) => batch.length)).toEqual([3_000, 2_000, 1_336, 896, 25]);
    const firstRound = runner.batches[0]!;
    expect(new Set(firstRound.map((job) => canonicalStrategy(job.candidate))).size).toBe(3_000);
    const usedSeeds = runner.batches.map((batch) => new Set(batch.map((job) => job.options.seeds[0])));
    for (let left = 0; left < usedSeeds.length; left += 1) for (let right = left + 1; right < usedSeeds.length; right += 1) {
      expect([...usedSeeds[left]!].some((seed) => usedSeeds[right]!.has(seed))).toBe(false);
    }
  });
});
