import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { rulesFingerprint } from '../src/sim/rulesFingerprint';

const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
registerKingdom(kingdom);
process.stdout.write(`${JSON.stringify(rulesFingerprint(kingdom.id, 30, 200, false), null, 2)}\n`);
