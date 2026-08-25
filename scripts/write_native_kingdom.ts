import fs from 'node:fs';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { nativeKingdomInput, nativeRuleFingerprint } from '../src/sim/nativeGoldfishProtocol';
import { orderedGoldfishCardIds } from '../src/sim/orderedGoldfishBenchmark';

const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
registerKingdom(kingdom);
fs.writeFileSync('rust/goldfish/kingdom009.json', `${JSON.stringify({
  kingdom: nativeKingdomInput(kingdom), orderedCardIds: orderedGoldfishCardIds(kingdom.id),
  ruleFingerprint: nativeRuleFingerprint(kingdom.id, 30, 200)
}, null, 2)}\n`);
