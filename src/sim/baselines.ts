import type { StateWeights, Strategy } from './strategy';

/** The starting population's yardstick. Step 6 mutates these numbers; it does not invent them. */
const DEFAULT_WEIGHTS: StateWeights = {
  damage: 10, preferredRange: 3, cardsDrawn: 2, moneyGained: 1, trashed: 2,
  reclaimed: 2, discarded: 1, unspentMana: -1, opponentOutOfAttackRange: -4
};
const NO_WEIGHTS: StateWeights = {
  damage: 0, preferredRange: 0, cardsDrawn: 0, moneyGained: 0, trashed: 0,
  reclaimed: 0, discarded: 0, unspentMana: 0, opponentOutOfAttackRange: 0
};

function agenda(entries: readonly [string, number][]): Strategy['buyAgenda'] {
  return entries.map(([cardId, desiredCount]) => ({ cardId, desiredCount }));
}
function baseline(strategy: Omit<Strategy, 'treasureFallback' | 'trashPriority' | 'reclaimPriority' | 'discardPriority'>): Strategy {
  return {
    ...strategy,
    treasureFallback: ['gold', 'silver'],
    trashPriority: ['copper'],
    reclaimPriority: ['gold', 'silver'],
    discardPriority: ['copper', 'silver']
  };
}

export const BASELINE_STRATEGIES: readonly Strategy[] = Object.freeze([
  // An empty build carries the whole 12 into the first Buy phase as firstBuyMoney, where the
  // treasure fallback spends it.
  baseline({
    id: 'treasure-only', preferredRange: 'Near', startingBuild: [], buyAgenda: [],
    weights: { ...NO_WEIGHTS, damage: 10, moneyGained: 4 }
  }),
  baseline({
    id: 'melee-rush', preferredRange: 'Close', startingBuild: ['heavyBlow', 'drive', 'step'],
    buyAgenda: agenda([['heavyBlow', 3], ['drive', 2], ['feint', 2], ['footwork', 2]]),
    weights: DEFAULT_WEIGHTS
  }),
  baseline({
    id: 'ranged-standard', preferredRange: 'Far', startingBuild: ['volley', 'aim', 'footwork'],
    buyAgenda: agenda([['volley', 3], ['aim', 3], ['steadyShot', 2], ['footwork', 2]]),
    weights: DEFAULT_WEIGHTS
  }),
  // `RangeBand` admits only Close, Near, and Far. This deck's spells are range-free, so the weight
  // is 0 and the band never matters.
  baseline({
    id: 'mage-standard', preferredRange: 'Far', startingBuild: ['channel', 'arcBolt', 'leyStep', 'step'],
    buyAgenda: agenda([['fireball', 2], ['arcBolt', 3], ['channel', 3], ['prism', 1]]),
    weights: { ...DEFAULT_WEIGHTS, preferredRange: 0, unspentMana: -3 }
  }),
  baseline({
    id: 'engine-draw', preferredRange: 'Near', startingBuild: ['muster', 'stipend', 'footwork'],
    buyAgenda: agenda([['muster', 3], ['adapt', 2], ['stipend', 2], ['steadyShot', 2]]),
    weights: DEFAULT_WEIGHTS
  })
]);

export function baselineStrategy(id: string): Strategy {
  const found = BASELINE_STRATEGIES.find((strategy) => strategy.id === id);
  if (!found) throw new Error(`Unknown baseline strategy: ${id}`);
  return found;
}
