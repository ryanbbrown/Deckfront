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

/** Removes cumulative buy targets that cannot change the executable purchase ladder. */
export function normalizeCumulativeBuyTargets(slots: readonly BuyPlanSlot[]): BuyPlanSlot[] {
  const highest = new Map<string, number>();
  const active: BuyPlanSlot[] = [];
  for (const slot of slots) {
    if (slot.kind === 'inactive') continue;
    if (slot.kind !== 'buy') { active.push({ ...slot }); continue; }
    const previous = highest.get(slot.cardId) ?? 0;
    if (previous === INFINITE_COUNT || slot.desiredCount <= previous) continue;
    const contiguous = active.at(-1);
    if (contiguous?.kind === 'buy' && contiguous.cardId === slot.cardId) active.pop();
    highest.set(slot.cardId, slot.desiredCount);
    active.push({ ...slot });
  }
  return fixedBuyPlan(active);
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

/** Incremental FNV-1a with the same output contract as stableHash. */
export class StableHashAccumulator {
  private hash: number;
  private length: number;

  constructor(state: { hash: number; length: number } = { hash: 0x811c9dc5, length: 0 }) {
    if (![state.hash, state.length].every((value) => Number.isSafeInteger(value)
      && value >= 0 && value <= 0xffff_ffff)) throw new Error('Stable hash state is invalid.');
    this.hash = state.hash; this.length = state.length;
  }

  static fromDigest(digest: string): StableHashAccumulator {
    if (!/^[0-9a-f]{9,16}$/.test(digest)) throw new Error('Stable hash digest is invalid.');
    return new StableHashAccumulator({ hash: Number.parseInt(digest.slice(0, 8), 16),
      length: Number.parseInt(digest.slice(8), 16) });
  }

  update(text: string): this {
    for (let index = 0; index < text.length; index += 1) {
      this.hash ^= text.charCodeAt(index);
      this.hash = Math.imul(this.hash, 0x01000193) >>> 0;
    }
    this.length = (this.length + text.length) >>> 0;
    return this;
  }

  digest(): string {
    return `${this.hash.toString(16).padStart(8, '0')}${this.length.toString(16)}`;
  }
}

/** FNV-1a, 32 bit. Stable across processes and runs. */
export function stableHash(text: string): string {
  return new StableHashAccumulator().update(text).digest();
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
