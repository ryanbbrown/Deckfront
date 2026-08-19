export interface BuyAgendaEntry { cardId: string; desiredCount: number }

export interface Strategy {
  id: string;
  startingBuild: string[];
  buyAgenda: BuyAgendaEntry[];
  repeatPurchase: string;
}

/** The executable deck plan, with its display id excluded. */
export function canonicalStrategy(strategy: Strategy): string {
  return JSON.stringify({
    buyAgenda: strategy.buyAgenda.map((entry) => [entry.cardId, entry.desiredCount]),
    repeatPurchase: strategy.repeatPurchase,
    startingBuild: strategy.startingBuild
  });
}

/** FNV-1a, 32 bit. Stable across processes and runs. */
export function stableHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}${(text.length >>> 0).toString(16)}`;
}

export const STRATEGY_ID_PREFIX = 'sg-';

export function identify(strategy: Strategy): Strategy {
  return { ...strategy, id: `${STRATEGY_ID_PREFIX}${stableHash(canonicalStrategy(strategy))}` };
}

export function registerIdentity(known: Map<string, string>, strategy: Strategy): void {
  const form = canonicalStrategy(strategy);
  const seen = known.get(strategy.id);
  if (seen === undefined) { known.set(strategy.id, form); return; }
  if (seen !== form) throw new Error(`Two different strategies share the id ${strategy.id}: ${seen} and ${form}.`);
}

export function formatStrategy(strategy: Strategy): string {
  const agenda = strategy.buyAgenda.map((entry) => `${entry.cardId} x${entry.desiredCount}`).join(' -> ') || 'none';
  return [
    strategy.id,
    `  build: ${strategy.startingBuild.join(', ') || 'none'}`,
    `  agenda: ${agenda}`,
    `  repeat: ${strategy.repeatPurchase}`
  ].join('\n');
}
