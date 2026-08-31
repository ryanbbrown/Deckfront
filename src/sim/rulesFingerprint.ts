import {
  ARENA_MAX, ARENA_MIN, FIRST_PLAYER_HEALTH_PENALTY, MANA_USABLE_TURNS, MAX_CARRIED_MANA, MAX_FIRST_BUY_CARRY,
  STARTING_BUDGET, kingdomMarket, kingdomOf
} from '../game';
import type { CardDefinition } from '../game';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './experimentConfig';
import {
  MATRIX_PROTOCOL_VERSION, SIMULATION_KERNEL_PROTOCOL_VERSION, TACTICAL_PILOT_PROTOCOL_VERSION
} from './protocolVersions';
import { stableHash } from './strategy';

export const RULES_FINGERPRINT_VERSION = 3;

type ScientificCardDefinition = Omit<CardDefinition, 'headline' | 'detail'>;
function scientificMarket(kingdomId: string): ScientificCardDefinition[] {
  return kingdomMarket(kingdomId).map((card) => {
    const scientificCard = structuredClone(card) as Partial<CardDefinition>;
    delete scientificCard.headline;
    delete scientificCard.detail;
    return scientificCard as ScientificCardDefinition;
  });
}

export interface RulesFingerprint {
  version: typeof RULES_FINGERPRINT_VERSION;
  hash: string;
  rules: {
    kingdom: ReturnType<typeof kingdomOf>;
    market: ReturnType<typeof scientificMarket>;
    arenaMinimum: number;
    arenaMaximum: number;
    startingBudget: number;
    maximumFirstBuyCarry: number;
    maximumCarriedMana: number;
    manaUsableTurns: number | 'unlimited';
    firstPlayerHealthPenalty: number;
    turnLimitPerPlayer: number;
    actionCapPerTurn: number;
    orientationProtocol: string;
    simulationKernelProtocol: string;
    tacticalPilotProtocol: string;
    startingDraftEnabled: boolean;
  };
}

export function rulesFingerprint(
  kingdomId: string, turnLimitPerPlayer = TURN_LIMIT_PER_PLAYER, actionCapPerTurn = ACTION_CAP_PER_TURN,
  startingDraftEnabled = true
): RulesFingerprint {
  const rules: RulesFingerprint['rules'] = {
    kingdom: structuredClone(kingdomOf(kingdomId)),
    market: scientificMarket(kingdomId),
    arenaMinimum: ARENA_MIN,
    arenaMaximum: ARENA_MAX,
    startingBudget: STARTING_BUDGET,
    maximumFirstBuyCarry: MAX_FIRST_BUY_CARRY,
    maximumCarriedMana: MAX_CARRIED_MANA,
    manaUsableTurns: MANA_USABLE_TURNS,
    firstPlayerHealthPenalty: FIRST_PLAYER_HEALTH_PENALTY,
    turnLimitPerPlayer,
    actionCapPerTurn,
    orientationProtocol: MATRIX_PROTOCOL_VERSION,
    simulationKernelProtocol: SIMULATION_KERNEL_PROTOCOL_VERSION,
    tacticalPilotProtocol: TACTICAL_PILOT_PROTOCOL_VERSION,
    startingDraftEnabled
  };
  return { version: RULES_FINGERPRINT_VERSION, hash: stableHash(JSON.stringify(rules)), rules };
}
