import { BALANCE_SUITE_MANIFEST, validateBalanceSuiteManifest } from '../src/sim/balanceSuite';

const manifest = validateBalanceSuiteManifest(BALANCE_SUITE_MANIFEST);
process.stdout.write(`${manifest.chosenCount} kingdoms; ${manifest.splits.find((split) => split.name === 'tuning')!.size} tuning; ${manifest.splits.find((split) => split.name === 'validation')!.size} validation; digest ${manifest.digest}.\n`);
