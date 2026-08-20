import { describe, expect, it } from 'vitest';
import { tacticalAgent } from '../../src/sim/tacticalAgent';
import { diagnosticStrategies } from '../../src/sim/baselines';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';
import { runMatch } from '../../src/sim/match';
import { randomUniqueStrategies } from '../../src/sim/randomStrategy';
import { runSimulationMatch } from '../../src/sim/simulationKernel';

describe('the compact simulation kernel', () => {
  it.each(CURATED_KINGDOM_IDS)('matches the immutable engine in %s', (kingdomId) => {
    const strategies = [...diagnosticStrategies(kingdomId), ...randomUniqueStrategies(kingdomId, 91, 3).strategies];
    for (const seed of [3, 17]) {
      for (const ochre of strategies) for (const indigo of strategies) {
        const swapSides = seed === 17;
        const shared = {
          kingdomId, seed, firstPlayerId: seed === 3 ? 'ochre' as const : 'indigo' as const,
          swapSides, turnLimitPerPlayer: 30, actionCapPerTurn: 200
        };
        const product = runMatch({
          ...shared,
          agents: { ochre: tacticalAgent(ochre), indigo: tacticalAgent(indigo) }
        });
        const compact = runSimulationMatch({
          ...shared,
          strategies: { ochre, indigo }
        });
        expect(compact, `${kingdomId} ${ochre.id} vs ${indigo.id} seed ${seed}`).toEqual(product);
        expect(runSimulationMatch({ ...shared, strategies: { ochre, indigo } })).toEqual(compact);
      }
    }
  });
});
