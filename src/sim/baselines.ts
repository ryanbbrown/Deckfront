import { repairStrategy } from './mutation';
import { INFINITE_COUNT, identify } from './strategy';
import type { Strategy } from './strategy';

interface SeedSpec {
  id: string;
  startingBuild: string[];
  /** Ladder rungs, in scan order. INFINITE_COUNT marks the rung that repeats. */
  buyPlan: readonly (readonly [string, number])[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

function seed(kingdomId: string, spec: SeedSpec): Strategy {
  return deepFreeze(repairStrategy(kingdomId, identify({
    id: spec.id,
    startingBuild: [...spec.startingBuild],
    buyPlan: spec.buyPlan.map(([cardId, desiredCount]) => ({ kind: 'buy' as const, cardId, desiredCount }))
  })));
}

const SPECS: Readonly<Record<string, readonly SeedSpec[]>> = {
  'current-duel': [
    {
      id: 'ranged-aim', startingBuild: ['aim', 'precisionShot'],
      buyPlan: [['precisionShot', 4], ['aim', 2], ['precisionShot', INFINITE_COUNT]]
    },
    {
      id: 'melee-rally', startingBuild: ['feint', 'rally'],
      buyPlan: [['rally', 5], ['feint', 2], ['rally', INFINITE_COUNT]]
    },
    {
      id: 'mage-cascade', startingBuild: ['channel', 'arcBolt', 'cascade'],
      buyPlan: [['cascade', 4], ['arcBolt', 4], ['channel', 3], ['channel', INFINITE_COUNT]]
    },
    {
      id: 'engine-improvise', startingBuild: ['cull', 'improvise', 'channel'],
      buyPlan: [['improvise', 4], ['channel', 3], ['rally', 2], ['improvise', INFINITE_COUNT]]
    },
    {
      id: 'money-shot', startingBuild: ['precisionShot', 'aim'],
      buyPlan: [['precisionShot', 6], ['aim', 3], ['precisionShot', INFINITE_COUNT]]
    }
  ],
  'three-way-open': [
    {
      id: 'melee', startingBuild: ['drive', 'footwork', 'cull'],
      buyPlan: [['drive', 5], ['footwork', 3], ['drive', INFINITE_COUNT]]
    },
    {
      id: 'ranged', startingBuild: ['longshot', 'volley', 'footwork'],
      buyPlan: [['volley', 4], ['longshot', 4], ['footwork', 2], ['volley', INFINITE_COUNT]]
    },
    {
      id: 'mage', startingBuild: ['fireball', 'leyStep', 'discharge'],
      buyPlan: [['fireball', 4], ['discharge', 3], ['leyStep', 3], ['leyStep', INFINITE_COUNT]]
    },
    {
      id: 'engine', startingBuild: ['stipend', 'footwork', 'cull'],
      buyPlan: [['stipend', 4], ['improvise', 3], ['footwork', 3], ['stipend', INFINITE_COUNT]]
    },
    {
      id: 'tempo', startingBuild: ['volley', 'leyStep', 'footwork'],
      buyPlan: [['volley', 5], ['leyStep', 3], ['volley', INFINITE_COUNT]]
    }
  ],
  'three-way-engine': [
    {
      id: 'melee', startingBuild: ['jab', 'rally', 'cull'],
      buyPlan: [['rally', 5], ['jab', 3], ['rally', INFINITE_COUNT]]
    },
    {
      id: 'ranged', startingBuild: ['pepperingShot', 'precisionShot', 'cull'],
      buyPlan: [['precisionShot', 5], ['pepperingShot', 3], ['precisionShot', INFINITE_COUNT]]
    },
    {
      id: 'mage', startingBuild: ['channel', 'attune', 'overload'],
      buyPlan: [['overload', 4], ['attune', 4], ['channel', 3], ['attune', INFINITE_COUNT]]
    },
    {
      id: 'engine', startingBuild: ['regroup', 'cull', 'jab'],
      buyPlan: [['regroup', 4], ['improvise', 4], ['jab', 3], ['regroup', INFINITE_COUNT]]
    },
    {
      id: 'money', startingBuild: ['pepperingShot'],
      buyPlan: [['pepperingShot', 5], ['precisionShot', 3], ['pepperingShot', INFINITE_COUNT]]
    }
  ],
  'range-rich-mixed': [
    {
      id: 'melee', startingBuild: ['heavyBlow', 'bullRush', 'cull'],
      buyPlan: [['heavyBlow', 4], ['bullRush', 4], ['heavyBlow', INFINITE_COUNT]]
    },
    {
      id: 'ranged-volley', startingBuild: ['aim', 'longshot', 'cull'],
      buyPlan: [['longshot', 5], ['aim', 3], ['longshot', INFINITE_COUNT]]
    },
    {
      id: 'ranged-shot', startingBuild: ['repellingShot', 'salvageShot', 'cull'],
      buyPlan: [['salvageShot', 4], ['repellingShot', 4], ['repellingShot', INFINITE_COUNT]]
    },
    {
      id: 'mage', startingBuild: ['fireball', 'leyStep', 'cull'],
      buyPlan: [['fireball', 4], ['leyStep', 4], ['leyStep', INFINITE_COUNT]]
    },
    {
      id: 'engine', startingBuild: ['adapt', 'cull', 'leyStep'],
      buyPlan: [['adapt', 4], ['longshot', 3], ['adapt', INFINITE_COUNT]]
    }
  ]
};

export const SEED_STRATEGIES: Readonly<Record<string, readonly Strategy[]>> = deepFreeze(
  Object.fromEntries(Object.entries(SPECS).map(([kingdomId, specs]) => [
    kingdomId, specs.map((spec) => seed(kingdomId, spec))
  ]))
);
export const SEED_LABELS: Readonly<Record<string, readonly string[]>> = deepFreeze(
  Object.fromEntries(Object.entries(SPECS).map(([kingdomId, specs]) => [
    kingdomId, specs.map((spec) => spec.id)
  ]))
);

export function diagnosticStrategies(kingdomId: string): readonly Strategy[] {
  const strategies = SEED_STRATEGIES[kingdomId];
  if (!strategies) throw new Error(`Unknown diagnostic kingdom: ${kingdomId}.`);
  return strategies;
}

export function diagnosticLabels(kingdomId: string): Map<string, string> {
  const strategies = diagnosticStrategies(kingdomId);
  const labels = SEED_LABELS[kingdomId];
  if (!labels) throw new Error(`Unknown diagnostic kingdom: ${kingdomId}.`);
  return new Map(strategies.map((strategy, index) => [strategy.id, labels[index]!]));
}
