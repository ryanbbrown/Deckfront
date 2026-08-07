export type WinEventType = 'unitLead' | 'centerMajority' | 'sixCenterDominance';

export interface BoardRulesConfig {
  id: string;
  recruitCost: number;
  income: {
    base: number;
    perCenter: number;
    compressed?: {
      lowCenterMax: number;
      lowCenterBonus: number;
      midCenterMax: number;
      midIncome: number;
      highIncome: number;
    };
  };
  deckDamageCapPerAttacker: number | null;
  recruitCapPerTurn: number | null;
  win: {
    unitLead?: {
      threshold: number;
      responseWindow: true;
    };
    centerMajority?: {
      minCompletedTurns: number;
      centersRequired: number;
      minUnitLead: number;
      responseWindow: true;
    };
    sixCenterDominance?: {
      minCompletedTurns: number;
      centersRequired: number;
      maxUnitDeficit: number;
      responseWindow: true;
    };
  };
}

const CURRENT_RULES: BoardRulesConfig = {
  id: 'current',
  recruitCost: 6,
  income: {
    base: 2,
    perCenter: 1
  },
  deckDamageCapPerAttacker: 1,
  recruitCapPerTurn: null,
  win: {
    unitLead: {
      threshold: 4,
      responseWindow: true
    },
    sixCenterDominance: {
      minCompletedTurns: 18,
      centersRequired: 6,
      maxUnitDeficit: 2,
      responseWindow: true
    }
  }
};

const RULESETS: Record<string, BoardRulesConfig> = {
  current: CURRENT_RULES
};

export function rulesConfigForRuleset(ruleset: string): BoardRulesConfig {
  const config = RULESETS[ruleset];
  if (!config) {
    throw new Error(`Unknown board ruleset: ${ruleset}`);
  }
  return config;
}

export function recruitCostForRuleset(ruleset: string): number {
  return rulesConfigForRuleset(ruleset).recruitCost;
}

export function incomeForCenterCount(ruleset: string, centers: number): number {
  const income = rulesConfigForRuleset(ruleset).income;
  if (income.compressed) {
    if (centers <= income.compressed.lowCenterMax) {
      return centers + income.compressed.lowCenterBonus;
    }
    if (centers <= income.compressed.midCenterMax) {
      return income.compressed.midIncome;
    }
    return income.compressed.highIncome;
  }
  return income.base + centers * income.perCenter;
}

export function enabledWinEventTypes(ruleset: string): WinEventType[] {
  const win = rulesConfigForRuleset(ruleset).win;
  const types: WinEventType[] = [];
  if (win.unitLead) {
    types.push('unitLead');
  }
  if (win.centerMajority) {
    types.push('centerMajority');
  }
  if (win.sixCenterDominance) {
    types.push('sixCenterDominance');
  }
  return types;
}

export function unitLeadThreshold(ruleset: string): number | null {
  return rulesConfigForRuleset(ruleset).win.unitLead?.threshold ?? null;
}

export function centerMajorityConfig(ruleset: string): NonNullable<BoardRulesConfig['win']['centerMajority']> | null {
  return rulesConfigForRuleset(ruleset).win.centerMajority ?? null;
}

export function sixCenterDominanceConfig(ruleset: string): NonNullable<BoardRulesConfig['win']['sixCenterDominance']> | null {
  return rulesConfigForRuleset(ruleset).win.sixCenterDominance ?? null;
}

export function deckDamageCapPerAttacker(ruleset: string): number | null {
  return rulesConfigForRuleset(ruleset).deckDamageCapPerAttacker;
}

export function recruitCapPerTurn(ruleset: string): number | null {
  return rulesConfigForRuleset(ruleset).recruitCapPerTurn;
}
