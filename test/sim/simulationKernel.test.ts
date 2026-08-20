import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { tacticalAgent } from '../../src/sim/tacticalAgent';
import { diagnosticStrategies } from '../../src/sim/baselines';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';
import { runMatch } from '../../src/sim/match';
import { randomUniqueStrategies } from '../../src/sim/randomStrategy';
import { runSimulationMatch } from '../../src/sim/simulationKernel';
import type { Strategy } from '../../src/sim/strategy';

afterEach(() => { resetKingdoms(); });

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

  it('matches the immutable engine for Repelling Shot movement', () => {
    registerKingdom({
      id: 'repelling-parity', name: 'Repelling parity', startingHealth: 40,
      actionPiles: [
        { cardId: 'repellingShot', count: 10 }, { cardId: 'volley', count: 10 },
        { cardId: 'heavyBlow', count: 10 }, { cardId: 'footwork', count: 10 }
      ]
    });
    const ranged: Strategy = {
      id: 'repelling', startingBuild: ['repellingShot', 'repellingShot', 'volley'],
      buyAgenda: [{ cardId: 'repellingShot', desiredCount: 5 }, { cardId: 'volley', desiredCount: 3 }],
      repeatPurchase: 'repellingShot'
    };
    const melee: Strategy = {
      id: 'melee', startingBuild: ['heavyBlow', 'heavyBlow'],
      buyAgenda: [{ cardId: 'heavyBlow', desiredCount: 4 }, { cardId: 'footwork', desiredCount: 3 }],
      repeatPurchase: 'footwork'
    };
    for (const seed of [2, 7, 19]) {
      const shared = {
        kingdomId: 'repelling-parity', seed, firstPlayerId: seed === 7 ? 'indigo' as const : 'ochre' as const,
        swapSides: seed === 19, turnLimitPerPlayer: 30, actionCapPerTurn: 200
      };
      const product = runMatch({
        ...shared, agents: { ochre: tacticalAgent(ranged), indigo: tacticalAgent(melee) }
      });
      const compact = runSimulationMatch({ ...shared, strategies: { ochre: ranged, indigo: melee } });
      expect(compact, `seed ${seed}`).toEqual(product);
      expect(compact.telemetry.playsByCard.ochre.repellingShot).toBeGreaterThan(0);
    }
  });
});
