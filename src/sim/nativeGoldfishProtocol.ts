import {
  ALWAYS_AVAILABLE_ACTION_IDS, ALWAYS_AVAILABLE_COUNT, cardDefinition, isTacticalAction, kingdomMarket
} from '../game';
import type { Kingdom } from '../game';
import type { GoldfishConfig, MovementAwareGoldfishScore, CompactMovementAwareGoldfishScore } from './goldfish';
import { GOLDFISH_MOVEMENT_PROFILES } from './goldfish';
import { rulesFingerprint } from './rulesFingerprint';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

export const NATIVE_GOLDFISH_PROTOCOL_VERSION = 1;
export const NATIVE_GOLDFISH_SCORER_VERSION = 'native-goldfish-v1';

export interface NativeScoreBatchRequest {
  type: 'score_batch';
  payload: {
    kingdom: {
      id: string;
      health: number;
      aimBonus: number;
      feintBonus: number;
      cards: Array<{ id: string; cardType: string; mechanic: string; family: string; cost: number;
        money: number; supply: number; tactical: boolean; values: Record<string, number> }>;
    };
    strategies: Array<Strategy & { canonicalStrategy: string }>;
    seeds: number[];
    movementProfiles: string[];
    turnLimit: number;
    actionCapPerTurn: number;
    threads: number;
    cpuRequest: number;
    mode: 'full' | 'compact';
  };
}

function resolvedValue(kingdom: Kingdom, definitionId: string, key: string): number {
  return kingdom.overrides?.[definitionId]?.values?.[key] ?? cardDefinition(definitionId).values?.[key] ?? 0;
}

export function nativeKingdomInput(kingdom: Kingdom): NativeScoreBatchRequest['payload']['kingdom'] {
  const market = kingdomMarket(kingdom.id);
  const definitions = [...market, cardDefinition('scrap')];
  const pileCounts = new Map(kingdom.actionPiles.map((pile) => [pile.cardId, pile.count]));
  const always = new Set<string>(ALWAYS_AVAILABLE_ACTION_IDS);
  return { id: kingdom.id, health: kingdom.startingHealth,
    aimBonus: resolvedValue(kingdom, 'aim', 'bonus'),
    feintBonus: resolvedValue(kingdom, 'feint', 'bonus'),
    cards: definitions.map((card) => ({ id: card.id, cardType: card.type, mechanic: card.mechanic,
      family: card.family, cost: card.cost, money: card.money ?? 0, tactical: isTacticalAction(card.id),
      supply: card.type === 'treasure' ? -1 : pileCounts.get(card.id)
        ?? (always.has(card.id) ? ALWAYS_AVAILABLE_COUNT : -1), values: { ...(card.values ?? {}) } })) };
}

export function nativeScoreBatchRequest(
  kingdom: Kingdom, strategies: readonly Strategy[], config: GoldfishConfig,
  threads: number, mode: 'full' | 'compact'
): NativeScoreBatchRequest {
  if (!Number.isSafeInteger(threads) || threads < 1) throw new Error('Native scorer threads must be positive.');
  return { type: 'score_batch', payload: {
    kingdom: nativeKingdomInput(kingdom),
    strategies: strategies.map((strategy) => ({ ...strategy, canonicalStrategy: canonicalStrategy(strategy) })),
    seeds: [...config.seeds], movementProfiles: [...GOLDFISH_MOVEMENT_PROFILES],
    turnLimit: config.turnLimit, actionCapPerTurn: config.actionCapPerTurn,
    threads, cpuRequest: threads, mode
  } };
}

export function nativeRuleFingerprint(kingdomId: string, turnLimit: number, actionCap: number): string {
  return rulesFingerprint(kingdomId, turnLimit, actionCap, false).hash;
}

export type NativeGoldfishScore = MovementAwareGoldfishScore | CompactMovementAwareGoldfishScore;
