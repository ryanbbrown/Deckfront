import { ResponsePolicyDomain } from './responsePolicyGrammar';

export function stoplessRandomDomain(kingdomId: string, maxActiveSlots = 8): ResponsePolicyDomain {
  return new ResponsePolicyDomain(kingdomId, {
    maxActiveSlots,
    allowStopTokens: false,
    allowNoBuyFloor: false
  });
}
