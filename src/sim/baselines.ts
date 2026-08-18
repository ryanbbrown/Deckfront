import { identify } from './strategy';
import type { StateWeights, Strategy } from './strategy';

const DEFAULT_WEIGHTS: StateWeights = {
  damage: 10, preferredRange: 3, cardsDrawn: 2, moneyGained: 1, trashed: 2,
  reclaimed: 2, discarded: 1, unspentMana: -1, opponentOutOfAttackRange: -4
};
const NO_WEIGHTS: StateWeights = {
  damage: 0, preferredRange: 0, cardsDrawn: 0, moneyGained: 0, trashed: 0,
  reclaimed: 0, discarded: 0, unspentMana: 0, opponentOutOfAttackRange: 0
};

type Template = 'standard' | 'mage' | 'money';
interface SeedSpec {
  id: string;
  template: Template;
  preferredRange: Strategy['preferredRange'];
  startingBuild: string[];
  buyAgenda: readonly (readonly [string, number])[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

function seed(spec: SeedSpec): Strategy {
  const weights = spec.template === 'mage'
    ? { ...DEFAULT_WEIGHTS, preferredRange: 0, unspentMana: -3 }
    : spec.template === 'money'
      ? { ...NO_WEIGHTS, damage: 10, moneyGained: 4 }
      : { ...DEFAULT_WEIGHTS };
  return deepFreeze(identify({
    id: spec.id,
    preferredRange: spec.preferredRange,
    startingBuild: [...spec.startingBuild],
    buyAgenda: spec.buyAgenda.map(([cardId, desiredCount]) => ({ cardId, desiredCount })),
    weights,
    treasureFallback: ['gold', 'silver'],
    trashPriority: ['copper'],
    reclaimPriority: ['gold', 'silver'],
    discardPriority: ['copper', 'silver']
  }));
}

const openSeeds: readonly SeedSpec[] = [
  { id: 'melee', template: 'standard', preferredRange: 'Close', startingBuild: ['heavyBlow', 'drive', 'footwork'], buyAgenda: [['heavyBlow', 3], ['drive', 2], ['footwork', 2]] },
  { id: 'ranged', template: 'standard', preferredRange: 'Far', startingBuild: ['volley', 'aim', 'footwork'], buyAgenda: [['volley', 3], ['aim', 3], ['footwork', 2]] },
  { id: 'mage', template: 'mage', preferredRange: 'Far', startingBuild: ['channel', 'arcBolt', 'leyStep', 'footwork'], buyAgenda: [['fireball', 2], ['arcBolt', 3], ['channel', 3], ['leyStep', 2]] },
  { id: 'money-drive', template: 'money', preferredRange: 'Close', startingBuild: ['drive'], buyAgenda: [['drive', 3], ['footwork', 2]] },
  { id: 'tempo', template: 'standard', preferredRange: 'Far', startingBuild: ['stipend', 'aim', 'volley'], buyAgenda: [['volley', 3], ['aim', 2], ['stipend', 2]] }
];

const SPECS: Readonly<Record<string, readonly SeedSpec[]>> = {
  'current-duel': [
    { id: 'ranged-aim', template: 'standard', preferredRange: 'Far', startingBuild: ['volley', 'aim', 'footwork'], buyAgenda: [['volley', 3], ['aim', 3], ['footwork', 2]] },
    { id: 'melee-drive', template: 'standard', preferredRange: 'Close', startingBuild: ['drive', 'drive', 'footwork'], buyAgenda: [['drive', 4], ['feint', 2], ['footwork', 2]] },
    { id: 'flurry-tempo', template: 'standard', preferredRange: 'Close', startingBuild: ['flurry', 'footwork', 'footwork'], buyAgenda: [['flurry', 3], ['feint', 2], ['footwork', 2]] },
    { id: 'engine-draw', template: 'standard', preferredRange: 'Near', startingBuild: ['muster', 'volley'], buyAgenda: [['muster', 3], ['volley', 3], ['adapt', 2], ['footwork', 2]] },
    { id: 'money-volley', template: 'money', preferredRange: 'Far', startingBuild: ['volley'], buyAgenda: [['volley', 3], ['aim', 2]] }
  ],
  'three-way-open': openSeeds,
  'three-way-engine': [
    { id: 'melee', template: 'standard', preferredRange: 'Close', startingBuild: ['heavyBlow', 'footwork', 'reclaim'], buyAgenda: [['heavyBlow', 3], ['footwork', 2], ['reclaim', 2]] },
    { id: 'ranged', template: 'standard', preferredRange: 'Far', startingBuild: ['steadyShot', 'steadyShot', 'footwork'], buyAgenda: [['steadyShot', 4], ['footwork', 2]] },
    { id: 'mage', template: 'mage', preferredRange: 'Far', startingBuild: ['channel', 'prism', 'channel'], buyAgenda: [['fireball', 3], ['channel', 3], ['prism', 2]] },
    { id: 'engine', template: 'standard', preferredRange: 'Near', startingBuild: ['muster', 'stipend', 'reclaim'], buyAgenda: [['steadyShot', 3], ['muster', 3], ['stipend', 2], ['reclaim', 2]] },
    { id: 'money', template: 'money', preferredRange: 'Far', startingBuild: ['steadyShot'], buyAgenda: [['steadyShot', 3], ['footwork', 2]] }
  ],
  'range-rich-mixed': [
    { id: 'melee', template: 'standard', preferredRange: 'Close', startingBuild: ['heavyBlow', 'drive', 'footwork'], buyAgenda: [['heavyBlow', 3], ['drive', 2], ['footwork', 2]] },
    { id: 'ranged-volley', template: 'standard', preferredRange: 'Far', startingBuild: ['volley', 'aim', 'footwork'], buyAgenda: [['volley', 3], ['aim', 3], ['footwork', 2]] },
    { id: 'ranged-shot', template: 'standard', preferredRange: 'Near', startingBuild: ['steadyShot', 'quickShot', 'footwork'], buyAgenda: [['steadyShot', 3], ['quickShot', 3], ['footwork', 2]] },
    { id: 'mage', template: 'mage', preferredRange: 'Far', startingBuild: ['channel', 'arcBolt', 'arcBolt', 'footwork'], buyAgenda: [['arcBolt', 4], ['channel', 3], ['footwork', 2]] },
    { id: 'money-quick', template: 'money', preferredRange: 'Near', startingBuild: ['quickShot'], buyAgenda: [['quickShot', 3], ['footwork', 2]] }
  ],
  'rigged-melee': openSeeds
};

/** Five complete, immutable strategies for every curated experiment kingdom. */
export const SEED_STRATEGIES: Readonly<Record<string, readonly Strategy[]>> = deepFreeze(
  Object.fromEntries(Object.entries(SPECS).map(([kingdomId, specs]) => [kingdomId, specs.map(seed)]))
);

export const SEED_LABELS: Readonly<Record<string, readonly string[]>> = deepFreeze(
  Object.fromEntries(Object.entries(SPECS).map(([kingdomId, specs]) => [kingdomId, specs.map((spec) => spec.id)]))
);
