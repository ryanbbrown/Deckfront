export const VALUE_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  money: [],
  footwork: ['draw'],
  cull: [],
  muster: ['draw'],
  feint: ['bonus'],
  drive: ['damage', 'wallDamage'],
  flurry: ['perAction', 'max'],
  aim: ['draw'],
  volley: ['near', 'far', 'aimedNear', 'aimedFar'],
  stipend: ['draw', 'money'],
  reclaim: ['draw'],
  adapt: ['draw', 'movedDraw'],
  melee: ['damage'],
  ranged: ['damage', 'draw'],
  spell: ['damage', 'manaCost'],
  channel: ['mana', 'draw'],
  leyStep: ['mana'],
  prism: ['mana', 'draw', 'discard'],
  step: []
});
export function valueKeys(mechanic: string): readonly string[] {
  const keys = VALUE_KEYS[mechanic];
  if (!keys) throw new Error(`Unknown mechanic: ${mechanic}`);
  return keys;
}
