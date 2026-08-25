import { registerKingdom } from '../game';
import { deepBeamSuite } from './deepBeamSuite';
import { nativeKingdomInput, nativeRuleFingerprint } from './nativeGoldfishProtocol';
import { orderedGoldfishCardIds } from './orderedGoldfishBenchmark';

export function nativeKingdom009Json(): string {
  const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
  registerKingdom(kingdom);
  return `${JSON.stringify({
    kingdom: nativeKingdomInput(kingdom), orderedCardIds: orderedGoldfishCardIds(kingdom.id),
    ruleFingerprint: nativeRuleFingerprint(kingdom.id, 30, 200)
  }, null, 2)}\n`;
}
