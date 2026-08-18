import { registerKingdom } from '../../src/game';
import type { Kingdom } from '../../src/game';

function piles(cardIds: readonly string[]): { cardId: string; count: number }[] {
  return cardIds.map((cardId) => ({ cardId, count: 10 }));
}

const THREE_WAY_OPEN = ['footwork', 'stipend', 'drive', 'heavyBlow', 'aim', 'volley', 'channel', 'leyStep', 'arcBolt', 'fireball'];

/**
 * The five approved kingdoms, as `.plans/10-5-kingdoms.md` states them. Step 5 moves this data into
 * `src/game-data/kingdoms.json`; registration is idempotent for identical content, so this file is
 * deleted then rather than reconciled.
 */
export const CURATED_KINGDOMS: readonly Kingdom[] = [
  {
    id: 'current-duel', name: 'Current duel', startingHealth: 20,
    actionPiles: piles(['footwork', 'muster', 'feint', 'drive', 'flurry', 'aim', 'volley', 'adapt'])
  },
  { id: 'three-way-open', name: 'Three-way open', startingHealth: 20, actionPiles: piles(THREE_WAY_OPEN) },
  {
    id: 'three-way-engine', name: 'Three-way engine', startingHealth: 30,
    actionPiles: piles(['footwork', 'muster', 'stipend', 'reclaim', 'adapt', 'heavyBlow', 'steadyShot', 'channel', 'prism', 'fireball'])
  },
  {
    id: 'range-rich-mixed', name: 'Range-rich mixed', startingHealth: 20,
    actionPiles: piles(['footwork', 'adapt', 'quickShot', 'steadyShot', 'aim', 'volley', 'drive', 'heavyBlow', 'channel', 'arcBolt'])
  },
  {
    id: 'rigged-melee', name: 'Rigged melee', startingHealth: 20, actionPiles: piles(THREE_WAY_OPEN),
    overrides: { heavyBlow: { cost: 3, values: { damage: 6 } } }
  }
];

export function registerCuratedKingdoms(): void {
  for (const kingdom of CURATED_KINGDOMS) registerKingdom(structuredClone(kingdom));
}
