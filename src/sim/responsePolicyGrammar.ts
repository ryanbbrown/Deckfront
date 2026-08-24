import { SeededRandom } from '../game';
import { kingdomFacts, repairStrategy } from './mutation';
import {
  BUY_PLAN_SLOTS, INFINITE_COUNT, canonicalStrategy, normalizeCumulativeBuyTargets
} from './strategy';
import type { BuyPlanSlot, Strategy } from './strategy';

export const RESPONSE_MAX_ACTIVE_SLOTS = 8;
export const RESPONSE_FINITE_COUNTS = Object.freeze([1, 2, 3, 4, 5] as const);
export const RESPONSE_STOP_THRESHOLDS = Object.freeze([2, 4, 6] as const);

export type PrefixToken = `buy:${string}:${number}` | `stop:${number}`;
export type FloorToken = 'no-buy' | `floor:${string}`;

export interface ResponsePolicyDomainOptions {
  purchaseIds?: readonly string[];
  floorIds?: readonly string[];
  maxActiveSlots?: number;
  allowStopTokens?: boolean;
  allowNoBuyFloor?: boolean;
}

function buyToken(cardId: string, count: number): PrefixToken {
  return `buy:${cardId}:${count}`;
}

/** One canonical complete-policy grammar for every pilot optimizer. */
export class ResponsePolicyDomain {
  readonly kingdomId: string;
  readonly purchaseIds: readonly string[];
  readonly floorIds: readonly string[];
  readonly prefixTokens: readonly PrefixToken[];
  readonly floorTokens: readonly FloorToken[];
  readonly maxActiveSlots: number;
  readonly maxPrefixSlots: number;

  constructor(kingdomId: string, options: ResponsePolicyDomainOptions = {}) {
    this.kingdomId = kingdomId;
    const available = new Set(kingdomFacts(kingdomId).purchaseIds);
    this.purchaseIds = Object.freeze([...new Set(options.purchaseIds ?? available)].sort());
    for (const cardId of this.purchaseIds) {
      if (!available.has(cardId)) throw new Error(`${cardId} is not purchasable in ${kingdomId}.`);
    }
    const allowNoBuyFloor = options.allowNoBuyFloor ?? true;
    const requestedFloors = options.floorIds === undefined
      ? [...(allowNoBuyFloor ? ['no-buy'] : []), ...this.purchaseIds]
      : [...new Set(options.floorIds)].sort();
    if (!allowNoBuyFloor && requestedFloors.includes('no-buy')) {
      throw new Error('The response policy domain does not allow a no-buy floor.');
    }
    for (const cardId of requestedFloors) {
      if (cardId !== 'no-buy' && !this.purchaseIds.includes(cardId)) {
        throw new Error(`${cardId} is not an allowed terminal floor in ${kingdomId}.`);
      }
    }
    if (!requestedFloors.length) throw new Error('A response policy domain needs a terminal floor.');
    const maxActiveSlots = options.maxActiveSlots ?? RESPONSE_MAX_ACTIVE_SLOTS;
    if (!Number.isInteger(maxActiveSlots) || maxActiveSlots < 1 || maxActiveSlots > BUY_PLAN_SLOTS) {
      throw new Error(`maxActiveSlots must be from 1 to ${BUY_PLAN_SLOTS}.`);
    }
    this.maxActiveSlots = maxActiveSlots;
    this.maxPrefixSlots = maxActiveSlots - 1;
    this.floorIds = Object.freeze(requestedFloors);
    this.prefixTokens = Object.freeze([
      ...this.purchaseIds.flatMap((cardId) => RESPONSE_FINITE_COUNTS.map((count) => buyToken(cardId, count))),
      ...((options.allowStopTokens ?? true)
        ? RESPONSE_STOP_THRESHOLDS.map((threshold): PrefixToken => `stop:${threshold}`) : [])
    ]);
    this.floorTokens = Object.freeze(requestedFloors.map((cardId): FloorToken =>
      cardId === 'no-buy' ? 'no-buy' : `floor:${cardId}`));
  }

  /** Samples length uniformly, then samples every prefix token and the terminal floor uniformly. */
  randomComplete(random: SeededRandom): Strategy {
    const length = random.nextInt(this.maxPrefixSlots + 1);
    const prefix = Array.from({ length }, () => this.prefixTokens[random.nextInt(this.prefixTokens.length)]!);
    const floor = this.floorTokens[random.nextInt(this.floorTokens.length)]!;
    return this.complete(prefix, floor);
  }

  complete(prefix: readonly PrefixToken[], floor: FloorToken): Strategy {
    if (prefix.length > this.maxPrefixSlots) throw new Error('The response prefix is too long.');
    if (prefix.some((token) => !this.prefixTokens.includes(token))) throw new Error('The response prefix is not legal.');
    if (!this.floorTokens.includes(floor)) throw new Error('The response floor is not legal.');
    const slots: BuyPlanSlot[] = prefix.map((token) => this.prefixSlot(token));
    slots.push(this.floorSlot(floor));
    const buyPlan = normalizeCumulativeBuyTargets(slots);
    const strategy = repairStrategy(this.kingdomId, { id: '', startingBuild: [], buyPlan });
    if (strategy.startingBuild.length
      || canonicalStrategy(strategy) !== canonicalStrategy({ id: '', startingBuild: [], buyPlan })) {
      throw new Error('Response policy repair changed a grammar-valid policy.');
    }
    return strategy;
  }

  decode(strategy: Strategy): { prefix: PrefixToken[]; floor: FloorToken } {
    const active = this.activeSlots(strategy);
    if (!active.length || active.length > this.maxActiveSlots || strategy.startingBuild.length) {
      throw new Error(`${strategy.id} is outside the response policy domain.`);
    }
    const terminal = active.at(-1)!;
    const floor: FloorToken = terminal.kind === 'stop' && terminal.threshold === 0
      ? 'no-buy' : terminal.kind === 'buy' && terminal.desiredCount === INFINITE_COUNT
        ? `floor:${terminal.cardId}` : (() => { throw new Error(`${strategy.id} has no terminal floor.`); })();
    const prefix = active.slice(0, -1).map((slot): PrefixToken => {
      if (slot.kind === 'stop' && RESPONSE_STOP_THRESHOLDS.includes(slot.threshold as 2 | 4 | 6)) {
        return `stop:${slot.threshold}`;
      }
      if (slot.kind === 'buy' && RESPONSE_FINITE_COUNTS.includes(slot.desiredCount as 1 | 2 | 3 | 4 | 5)) {
        return buyToken(slot.cardId, slot.desiredCount);
      }
      throw new Error(`${strategy.id} has an invalid finite prefix slot.`);
    });
    const rebuilt = this.complete(prefix, floor);
    if (canonicalStrategy(rebuilt) !== canonicalStrategy(strategy)) {
      throw new Error(`${strategy.id} is not a canonical response policy.`);
    }
    return { prefix, floor };
  }

  private activeSlots(strategy: Strategy): BuyPlanSlot[] {
    return strategy.buyPlan.filter((slot) => slot.kind !== 'inactive');
  }

  private prefixSlot(token: PrefixToken): BuyPlanSlot {
    const [kind, value, rawCount] = token.split(':');
    return kind === 'stop'
      ? { kind: 'stop', threshold: Number(value) }
      : { kind: 'buy', cardId: value!, desiredCount: Number(rawCount) };
  }

  private floorSlot(token: FloorToken): BuyPlanSlot {
    return token === 'no-buy'
      ? { kind: 'stop', threshold: 0 }
      : { kind: 'buy', cardId: token.slice('floor:'.length), desiredCount: INFINITE_COUNT };
  }
}
