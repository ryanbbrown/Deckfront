import { registerKingdom } from '../game';
import type { Kingdom } from '../game';
import { balanceSuite } from './balanceSuite';

export type StrategySearchKingdom = Kingdom;

const kingdoms = new Map<string, StrategySearchKingdom>();
for (const kingdom of balanceSuite.manifest.kingdoms) {
  const existing = kingdoms.get(kingdom.id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(kingdom)) {
    throw new Error(`Registered strategy-search kingdom ${kingdom.id} has conflicting definitions.`);
  }
  kingdoms.set(kingdom.id, kingdom);
}

export const strategySearchKingdoms = Object.freeze([...kingdoms.values()]);

export function strategySearchKingdom(kingdomId: string): Kingdom {
  const kingdom = kingdoms.get(kingdomId);
  if (!kingdom) throw new Error(`Unknown registered strategy-search kingdom ${kingdomId}.`);
  registerKingdom(kingdom);
  return kingdom;
}
