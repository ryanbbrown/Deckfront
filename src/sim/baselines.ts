import { identify } from './strategy';
import type { Strategy } from './strategy';
import { repairStrategy } from './mutation';

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

const openSeeds: readonly SeedSpec[] = [
  { id: 'melee', startingBuild: ['heavyBlow', 'drive', 'footwork'], buyAgenda: [['heavyBlow', 3], ['drive', 2], ['footwork', 2]], repeatPurchase: 'footwork' },
  { id: 'ranged', startingBuild: ['volley', 'aim', 'footwork'], buyAgenda: [['volley', 3], ['aim', 3], ['footwork', 2]], repeatPurchase: 'footwork' },
  { id: 'mage', startingBuild: ['channel', 'arcBolt', 'leyStep', 'footwork'], buyAgenda: [['fireball', 2], ['arcBolt', 3], ['channel', 3], ['leyStep', 2]], repeatPurchase: 'channel' },
  { id: 'money-drive', startingBuild: ['drive'], buyAgenda: [['drive', 3], ['footwork', 2]], repeatPurchase: 'footwork' },
  { id: 'tempo', startingBuild: ['stipend', 'aim', 'volley'], buyAgenda: [['volley', 3], ['aim', 2], ['stipend', 2]], repeatPurchase: 'stipend' }
];

const SPECS: Readonly<Record<string, readonly SeedSpec[]>> = {
  'current-duel': [
    { id: 'ranged-aim', startingBuild: ['volley', 'aim', 'footwork'], buyAgenda: [['volley', 3], ['aim', 3], ['footwork', 2]], repeatPurchase: 'footwork' },
    { id: 'melee-drive', startingBuild: ['drive', 'drive', 'footwork'], buyAgenda: [['drive', 4], ['feint', 2], ['footwork', 2]], repeatPurchase: 'footwork' },
    { id: 'flurry-tempo', startingBuild: ['flurry', 'footwork', 'footwork'], buyAgenda: [['flurry', 3], ['feint', 2], ['footwork', 2]], repeatPurchase: 'footwork' },
    { id: 'engine-draw', startingBuild: ['muster', 'volley'], buyAgenda: [['muster', 3], ['volley', 3], ['adapt', 2], ['footwork', 2]], repeatPurchase: 'footwork' },
    { id: 'money-volley', startingBuild: ['volley'], buyAgenda: [['volley', 3], ['aim', 2]], repeatPurchase: 'footwork' }
  ],
  'three-way-open': openSeeds,
  'three-way-engine': [
    { id: 'melee', startingBuild: ['heavyBlow', 'footwork', 'reclaim'], buyAgenda: [['heavyBlow', 3], ['footwork', 2], ['reclaim', 2]], repeatPurchase: 'footwork' },
    { id: 'ranged', startingBuild: ['steadyShot', 'steadyShot', 'footwork'], buyAgenda: [['steadyShot', 4], ['footwork', 2]], repeatPurchase: 'footwork' },
    { id: 'mage', startingBuild: ['channel', 'prism', 'channel'], buyAgenda: [['fireball', 3], ['channel', 3], ['prism', 2]], repeatPurchase: 'channel' },
    { id: 'engine', startingBuild: ['muster', 'stipend', 'reclaim'], buyAgenda: [['steadyShot', 3], ['muster', 3], ['stipend', 2], ['reclaim', 2]], repeatPurchase: 'footwork' },
    { id: 'money', startingBuild: ['steadyShot'], buyAgenda: [['steadyShot', 3], ['footwork', 2]], repeatPurchase: 'footwork' }
  ],
  'range-rich-mixed': [
    { id: 'melee', startingBuild: ['heavyBlow', 'drive', 'footwork'], buyAgenda: [['heavyBlow', 3], ['drive', 2], ['footwork', 2]], repeatPurchase: 'footwork' },
    { id: 'ranged-volley', startingBuild: ['volley', 'aim', 'footwork'], buyAgenda: [['volley', 3], ['aim', 3], ['footwork', 2]], repeatPurchase: 'footwork' },
    { id: 'ranged-shot', startingBuild: ['steadyShot', 'quickShot', 'footwork'], buyAgenda: [['steadyShot', 3], ['quickShot', 3], ['footwork', 2]], repeatPurchase: 'footwork' },
    { id: 'mage', startingBuild: ['channel', 'arcBolt', 'arcBolt', 'footwork'], buyAgenda: [['arcBolt', 4], ['channel', 3], ['footwork', 2]], repeatPurchase: 'channel' },
    { id: 'money-quick', startingBuild: ['quickShot'], buyAgenda: [['quickShot', 3], ['footwork', 2]], repeatPurchase: 'footwork' }
  ],
  'rigged-melee': openSeeds
};

export const SEED_STRATEGIES: Readonly<Record<string, readonly Strategy[]>> = deepFreeze(
  Object.fromEntries(Object.entries(SPECS).map(([kingdomId, specs]) => [kingdomId, specs.map((spec) => seed(kingdomId, spec))]))
);

export const SEED_LABELS: Readonly<Record<string, readonly string[]>> = deepFreeze(
  Object.fromEntries(Object.entries(SPECS).map(([kingdomId, specs]) => [kingdomId, specs.map((spec) => spec.id)]))
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
