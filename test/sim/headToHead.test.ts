import { describe, expect, it } from 'vitest';
import { headToHead } from '../../scripts/headToHead';
import { everyBuild } from '../../scripts/sweep';
import { InlinePairingRunner } from '../../src/sim/pairingRunner';
import type { PairingJob, PairingRunner } from '../../src/sim/pairingRunner';
import { INFINITE_COUNT } from '../../src/sim/strategy';
import { strategy } from './fixtures';

describe('independent head-to-head benchmark', () => {
  it('uses one empty build when the staged sweep runs with draft disabled', () => {
    expect(everyBuild('current-duel', false)).toEqual([[]]);
    expect(everyBuild('current-duel', true).length).toBeGreaterThan(1);
  });

  it('propagates draft-off mode through head-to-head jobs', async () => {
    const inline = new InlinePairingRunner();
    const jobsSeen: PairingJob[] = [];
    const runner: PairingRunner = {
      run: async (jobs, options) => {
        jobsSeen.push(...jobs);
        return inline.run(jobs, options);
      },
      close: async () => {}
    };
    const candidate = strategy({ id: 'candidate', startingBuild: ['aim'] });
    const opponent = strategy({ id: 'opponent', startingBuild: ['jab'] });
    await headToHead(runner, 'distance-duel', [candidate], opponent, [41], 1,
      undefined, { startingDraftEnabled: false });
    expect(jobsSeen).toHaveLength(1);
    expect(jobsSeen[0]!.options.startingDraftEnabled).toBe(false);
  });

  it('scores every candidate against the exact weighted opponent mixture', async () => {
    const runner = new InlinePairingRunner();
    const candidate = strategy({
      id: 'candidate', startingBuild: ['aim', 'pepperingShot'],
      buyPlan: [{ kind: 'buy', cardId: 'pepperingShot', desiredCount: INFINITE_COUNT }]
    });
    const melee = strategy({
      id: 'melee', startingBuild: ['jab', 'step'],
      buyPlan: [{ kind: 'buy', cardId: 'jab', desiredCount: INFINITE_COUNT }]
    });
    const ranged = strategy({
      id: 'ranged', startingBuild: ['aim', 'pepperingShot'],
      buyPlan: [{ kind: 'buy', cardId: 'pepperingShot', desiredCount: INFINITE_COUNT }]
    });
    const seeds = [31, 32];
    const againstMelee = (await headToHead(runner, 'distance-duel', [candidate], melee, seeds, 1))[0]!;
    const againstRanged = (await headToHead(runner, 'distance-duel', [candidate], ranged, seeds, 1))[0]!;
    const mixture = (await headToHead(runner, 'distance-duel', [candidate], [
      { strategy: melee, weight: 1 }, { strategy: ranged, weight: 3 }
    ], seeds, 1))[0]!;

    expect(mixture.blockScores).toEqual(seeds.map((_seed, index) =>
      againstMelee.blockScores[index]! * 0.25 + againstRanged.blockScores[index]! * 0.75));
    expect(mixture.mean).toBe(mixture.blockScores.reduce((sum, score) => sum + score, 0) / seeds.length);
    expect(mixture.matches).toBe(againstMelee.matches + againstRanged.matches);
  });
});
