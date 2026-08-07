import { describe, expect, it } from 'vitest';
import {
  deckDamageCapPerAttacker,
  enabledWinEventTypes,
  incomeForCenterCount,
  recruitCapPerTurn,
  recruitCostForRuleset,
  rulesConfigForRuleset,
  sixCenterDominanceConfig,
  unitLeadThreshold
} from '../src/playtest/rulesConfig';

describe('rulesConfigForRuleset', () => {
  it('represents current rules explicitly', () => {
    expect(recruitCostForRuleset('current')).toBe(6);
    expect(incomeForCenterCount('current', 0)).toBe(2);
    expect(incomeForCenterCount('current', 6)).toBe(8);
    expect(deckDamageCapPerAttacker('current')).toBe(1);
    expect(recruitCapPerTurn('current')).toBeNull();
    expect(enabledWinEventTypes('current')).toEqual(['unitLead', 'sixCenterDominance']);
    expect(unitLeadThreshold('current')).toBe(4);
    expect(sixCenterDominanceConfig('current')).toEqual({
      minCompletedTurns: 18,
      centersRequired: 6,
      maxUnitDeficit: 2,
      responseWindow: true
    });
  });

  it('fails loudly for unknown rulesets', () => {
    expect(() => rulesConfigForRuleset('territory-v1-cost6-damagecap-responsewin-lead4')).toThrow('Unknown board ruleset');
  });
});
