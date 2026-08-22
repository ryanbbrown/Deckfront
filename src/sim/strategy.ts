/** A strategy drafts a build, then scans a fixed ten-slot purchase ladder. */
export const BUY_PLAN_SLOTS = 10;
export const INFINITE_COUNT = 99;
export const MAXIMUM_FINITE_COUNT = 10;
export const MAXIMUM_STOP_THRESHOLD = 10;

export interface InactiveBuySlot { kind: 'inactive' }
export interface BuySlot { kind: 'buy'; cardId: string; desiredCount: number }
export interface StopSlot { kind: 'stop'; threshold: number }
export type BuyPlanSlot = InactiveBuySlot | BuySlot | StopSlot;

export interface Strategy {
  id: string;
  startingBuild: string[];
  buyPlan: BuyPlanSlot[];
}

export function inactiveSlot(): InactiveBuySlot { return { kind: 'inactive' }; }

/** Pads or truncates a ladder without interpreting its slots. Validation belongs to repairStrategy. */
export function fixedBuyPlan(slots: readonly BuyPlanSlot[]): BuyPlanSlot[] {
  return Array.from({ length: BUY_PLAN_SLOTS }, (_unused, index) => {
    const slot = slots[index];
    return slot ? { ...slot } : inactiveSlot();
  });
}

export function isInfinite(slot: BuyPlanSlot): boolean {
  return slot.kind === 'buy' && slot.desiredCount === INFINITE_COUNT;
}

/** INFINITE_COUNT is a sentinel, so an infinite buy slot never stops wanting copies. */
export function slotWantsMore(slot: BuySlot, acquired: number): boolean {
  return slot.desiredCount === INFINITE_COUNT || acquired < slot.desiredCount;
}

/** The executable deck plan, with its display id excluded. */
export function canonicalStrategy(strategy: Strategy): string {
  return JSON.stringify({
    buyPlan: strategy.buyPlan.map((slot) => slot.kind === 'buy'
      ? ['buy', slot.cardId, slot.desiredCount]
      : slot.kind === 'stop' ? ['stop', slot.threshold] : ['inactive']),
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

export function formatSlot(slot: BuyPlanSlot): string {
  if (slot.kind === 'inactive') return 'inactive';
  if (slot.kind === 'stop') return `stop >=${slot.threshold}`;
  return `${slot.cardId} x${slot.desiredCount === INFINITE_COUNT ? '∞' : slot.desiredCount}`;
}

export const formatRung = formatSlot;

export function formatStrategy(strategy: Strategy): string {
  return [
    strategy.id,
    `  build: ${strategy.startingBuild.join(', ') || 'none'}`,
    `  plan: ${strategy.buyPlan.map(formatSlot).join(' -> ')}`
  ].join('\n');
}
