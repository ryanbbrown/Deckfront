import { repairStrategy } from './mutation';
import { identify } from './strategy';
import type { Strategy } from './strategy';

interface SeedSpec {
  id: string;
  startingBuild: string[];
  buyAgenda: readonly (readonly [string, number])[];
  repeatPurchase: string;
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
    buyAgenda: spec.buyAgenda.map(([cardId, desiredCount]) => ({ cardId, desiredCount })),
    repeatPurchase: spec.repeatPurchase
  })));
}

const SPECS: Readonly<Record<string, readonly SeedSpec[]>> = {
  'current-duel': [
    {
      id: 'ranged-aim', startingBuild: ['aim', 'precisionShot'],
      buyAgenda: [['precisionShot', 4], ['aim', 2]], repeatPurchase: 'precisionShot'
    },
    {
      id: 'melee-rally', startingBuild: ['feint', 'rally'],
      buyAgenda: [['rally', 5], ['feint', 2]], repeatPurchase: 'rally'
    },
    {
      id: 'mage-cascade', startingBuild: ['channel', 'arcBolt', 'cascade'],
      buyAgenda: [['cascade', 4], ['arcBolt', 4], ['channel', 3]], repeatPurchase: 'channel'
    },
    {
      id: 'engine-improvise', startingBuild: ['cull', 'improvise', 'channel'],
      buyAgenda: [['improvise', 4], ['channel', 3], ['rally', 2]], repeatPurchase: 'improvise'
    },
    {
      id: 'money-shot', startingBuild: ['precisionShot', 'aim'],
      buyAgenda: [['precisionShot', 6], ['aim', 3]], repeatPurchase: 'precisionShot'
    }
  ],
  'three-way-open': [
    {
      id: 'melee', startingBuild: ['drive', 'footwork', 'cull'],
      buyAgenda: [['drive', 5], ['footwork', 3]], repeatPurchase: 'drive'
    },
    {
      id: 'ranged', startingBuild: ['longshot', 'volley', 'footwork'],
      buyAgenda: [['volley', 4], ['longshot', 4], ['footwork', 2]], repeatPurchase: 'volley'
    },
    {
      id: 'mage', startingBuild: ['fireball', 'leyStep', 'discharge'],
      buyAgenda: [['fireball', 4], ['discharge', 3], ['leyStep', 3]], repeatPurchase: 'leyStep'
    },
    {
      id: 'engine', startingBuild: ['stipend', 'footwork', 'cull'],
      buyAgenda: [['stipend', 4], ['improvise', 3], ['footwork', 3]], repeatPurchase: 'stipend'
    },
    {
      id: 'tempo', startingBuild: ['volley', 'leyStep', 'footwork'],
      buyAgenda: [['volley', 5], ['leyStep', 3]], repeatPurchase: 'volley'
    }
  ],
  'three-way-engine': [
    {
      id: 'melee', startingBuild: ['jab', 'rally', 'cull'],
      buyAgenda: [['rally', 5], ['jab', 3]], repeatPurchase: 'rally'
    },
    {
      id: 'ranged', startingBuild: ['pepperingShot', 'precisionShot', 'cull'],
      buyAgenda: [['precisionShot', 5], ['pepperingShot', 3]], repeatPurchase: 'precisionShot'
    },
    {
      id: 'mage', startingBuild: ['channel', 'attune', 'overload'],
      buyAgenda: [['overload', 4], ['attune', 4], ['channel', 3]], repeatPurchase: 'attune'
    },
    {
      id: 'engine', startingBuild: ['regroup', 'cull', 'jab'],
      buyAgenda: [['regroup', 4], ['improvise', 4], ['jab', 3]], repeatPurchase: 'regroup'
    },
    {
      id: 'money', startingBuild: ['pepperingShot'],
      buyAgenda: [['pepperingShot', 5], ['precisionShot', 3]], repeatPurchase: 'pepperingShot'
    }
  ],
  'range-rich-mixed': [
    {
      id: 'melee', startingBuild: ['heavyBlow', 'bullRush', 'cull'],
      buyAgenda: [['heavyBlow', 4], ['bullRush', 4]], repeatPurchase: 'heavyBlow'
    },
    {
      id: 'ranged-volley', startingBuild: ['aim', 'longshot', 'cull'],
      buyAgenda: [['longshot', 5], ['aim', 3]], repeatPurchase: 'longshot'
    },
    {
      id: 'ranged-shot', startingBuild: ['repellingShot', 'salvageShot', 'cull'],
      buyAgenda: [['salvageShot', 4], ['repellingShot', 4]], repeatPurchase: 'repellingShot'
    },
    {
      id: 'mage', startingBuild: ['fireball', 'leyStep', 'cull'],
      buyAgenda: [['fireball', 4], ['leyStep', 4]], repeatPurchase: 'leyStep'
    },
    {
      id: 'engine', startingBuild: ['adapt', 'cull', 'leyStep'],
      buyAgenda: [['adapt', 4], ['longshot', 3]], repeatPurchase: 'adapt'
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
