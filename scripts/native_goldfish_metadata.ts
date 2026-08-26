import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { rulesFingerprint } from '../src/sim/rulesFingerprint';
import { ORDERED_PRODUCT_KINGDOM, orderedProductTarget } from '../src/sim/orderedGoldfishProduct';

const kingdomOption = process.argv.indexOf('--kingdom');
const kingdomId = kingdomOption < 0 ? ORDERED_PRODUCT_KINGDOM : process.argv[kingdomOption + 1];
if (!kingdomId) throw new Error('--kingdom needs a value.');
const target = orderedProductTarget(kingdomId);
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === target.kingdomId);
if (!kingdom) throw new Error(`Ordered product kingdom is not registered: ${target.kingdomId}`);
registerKingdom(kingdom);
process.stdout.write(`${rulesFingerprint(kingdom.id, 30, 200, false).hash}\n`);
