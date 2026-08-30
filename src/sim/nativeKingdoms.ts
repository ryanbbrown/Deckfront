import { registerKingdom } from '../game';
import { nativeKingdomInput, nativeRuleFingerprint } from './nativeGoldfishProtocol';
import { orderedGoldfishCardIds } from './orderedGoldfishBenchmark';
import { strategySearchKingdoms } from './strategySearchKingdoms';

export interface NativeKingdomRecord {
  kingdomId: string;
  kingdom: ReturnType<typeof nativeKingdomInput>;
  orderedCardIds: string[];
  ruleFingerprint: string;
}

export function nativeKingdomsJson(): string {
  const kingdoms: NativeKingdomRecord[] = strategySearchKingdoms.map((kingdom) => {
    registerKingdom(kingdom);
    return {
      kingdomId: kingdom.id,
      kingdom: nativeKingdomInput(kingdom),
      orderedCardIds: orderedGoldfishCardIds(kingdom.id),
      ruleFingerprint: nativeRuleFingerprint(kingdom.id, 30, 200)
    };
  });
  return `${JSON.stringify({ kingdoms }, null, 2)}\n`;
}
