import {
  FIRST_PLAYER_HEALTH_PENALTY, MAX_FIRST_BUY_CARRY, STARTING_BUDGET, kingdomMarket, kingdomOf
} from '../game';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './experimentConfig';
import {
  MATRIX_PROTOCOL_VERSION, SIMULATION_KERNEL_PROTOCOL_VERSION, TACTICAL_PILOT_PROTOCOL_VERSION
} from './protocolVersions';
import { stableHash } from './strategy';

export const RULES_FINGERPRINT_VERSION = 1;

export interface RulesFingerprint {
  version: typeof RULES_FINGERPRINT_VERSION;
  hash: string;
  rules: {
    kingdom: ReturnType<typeof kingdomOf>;
    market: ReturnType<typeof kingdomMarket>;
    startingBudget: number;
    maximumFirstBuyCarry: number;
    firstPlayerHealthPenalty: number;
    turnLimitPerPlayer: number;
    actionCapPerTurn: number;
    orientationProtocol: string;
    simulationKernelProtocol: string;
    tacticalPilotProtocol: string;
  };
}

export function rulesFingerprint(
  kingdomId: string, turnLimitPerPlayer = TURN_LIMIT_PER_PLAYER, actionCapPerTurn = ACTION_CAP_PER_TURN
): RulesFingerprint {
  const rules: RulesFingerprint['rules'] = {
    kingdom: structuredClone(kingdomOf(kingdomId)),
    market: structuredClone(kingdomMarket(kingdomId)),
    startingBudget: STARTING_BUDGET,
    maximumFirstBuyCarry: MAX_FIRST_BUY_CARRY,
    firstPlayerHealthPenalty: FIRST_PLAYER_HEALTH_PENALTY,
    turnLimitPerPlayer,
    actionCapPerTurn,
    orientationProtocol: MATRIX_PROTOCOL_VERSION,
    simulationKernelProtocol: SIMULATION_KERNEL_PROTOCOL_VERSION,
    tacticalPilotProtocol: TACTICAL_PILOT_PROTOCOL_VERSION
  };
  return { version: RULES_FINGERPRINT_VERSION, hash: stableHash(JSON.stringify(rules)), rules };
}
