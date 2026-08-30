import { cardDefinition } from '../game';

export const DAMAGE_FAMILIES = ['Melee', 'Ranged', 'Mage'] as const;
export type DamageFamily = typeof DAMAGE_FAMILIES[number];
export const MIXED_DAMAGE_MINIMUM = 0.2;

export interface StrategyDamageEvidence {
  startingBuild: readonly string[];
  acquisitionRates: Readonly<Record<string, number>>;
}

export function damageFamily(cardId: string): DamageFamily | null {
  const mechanic = cardDefinition(cardId).mechanic;
  if (['melee', 'drive', 'flurry', 'openingStrike', 'rally', 'bullRush'].includes(mechanic)) return 'Melee';
  if (['ranged', 'repellingShot', 'volley', 'longshot', 'salvageShot', 'precisionShot'].includes(mechanic)) return 'Ranged';
  if (['spell', 'discharge', 'cascade', 'overload'].includes(mechanic)) return 'Mage';
  return null;
}

export function strategyDamageAmounts(strategy: StrategyDamageEvidence): Record<DamageFamily, number> {
  const amounts = Object.fromEntries(DAMAGE_FAMILIES.map((name) => [name, 0])) as Record<DamageFamily, number>;
  for (const cardId of strategy.startingBuild) {
    const cardFamily = damageFamily(cardId);
    if (cardFamily) amounts[cardFamily] += 1;
  }
  for (const [cardId, amount] of Object.entries(strategy.acquisitionRates)) {
    const cardFamily = damageFamily(cardId);
    if (cardFamily) amounts[cardFamily] += amount;
  }
  const improviseAmount = strategy.startingBuild.filter((cardId) => cardId === 'improvise').length
    + (strategy.acquisitionRates.improvise ?? 0);
  if (improviseAmount > 0) {
    const ownedFamilies = new Set([...strategy.startingBuild, ...Object.entries(strategy.acquisitionRates)
      .filter(([, amount]) => amount > 0).map(([cardId]) => cardId)].flatMap((cardId) => {
      const family = cardDefinition(cardId).family;
      return family === 'melee' ? ['Melee' as const] : family === 'ranged' ? ['Ranged' as const]
        : family === 'mana' ? ['Mage' as const] : [];
    }));
    for (const family of ownedFamilies) amounts[family] += improviseAmount;
  }
  return amounts;
}

export function classifyStrategyDamage(strategy: StrategyDamageEvidence): string {
  const amounts = strategyDamageAmounts(strategy);
  const total = Object.values(amounts).reduce((sum, amount) => sum + amount, 0);
  if (!total) return 'No damage package';
  const material = DAMAGE_FAMILIES.filter((name) => amounts[name] / total >= MIXED_DAMAGE_MINIMUM);
  return material.length ? material.join(' + ') : DAMAGE_FAMILIES
    .reduce((best, name) => amounts[name] > amounts[best] ? name : best);
}
