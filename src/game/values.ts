import type { CardMechanic } from './types';

export const VALUE_KEYS: Readonly<Record<CardMechanic, readonly string[]>> = Object.freeze({
  money: [], footwork: ['draw'], cull: [], muster: ['draw'], feint: ['draw', 'bonus'],
  drive: ['damage', 'wallDamage'], flurry: ['perAction'], aim: ['draw', 'bonus'], volley: ['near', 'far'],
  stipend: ['draw', 'money'], reclaim: ['draw'], adapt: ['draw', 'movedDraw'], melee: ['damage', 'draw'],
  ranged: ['damage', 'draw'], repellingShot: ['near', 'far'], spell: ['damage', 'manaCost'],
  channel: ['mana', 'draw'], leyStep: ['mana', 'farMana'], prism: ['mana', 'draw', 'discard'], step: [],
  attune: ['mana', 'draw', 'perCopy'], discharge: ['perMana'], cascade: ['damage', 'manaCost', 'perSpell'],
  overload: ['perManaSpent'], openingStrike: ['first', 'later'], rally: ['damage', 'perCopy'], bullRush: ['damage'],
  longshot: [], salvageShot: ['draw'], precisionShot: ['first', 'later'], regroup: ['draw', 'discard'],
  discipline: ['damage'], sharpen: ['draw'], reforge: ['costBonus'], scour: ['drawPerTrash'],
  improvise: ['perFamily'], scrap: ['damage']
});
export function valueKeys(mechanic: string): readonly string[] {
  const keys = VALUE_KEYS[mechanic as CardMechanic];
  if (!keys) throw new Error(`Unknown mechanic: ${mechanic}`);
  return keys;
}
