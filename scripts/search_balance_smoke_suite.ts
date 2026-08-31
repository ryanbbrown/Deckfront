import fs from 'node:fs';
import path from 'node:path';
import { searchBalanceSmokeSuite } from '../src/sim/balanceSmokeSuiteSearch';

const result = searchBalanceSmokeSuite();
const serializedIds = `${JSON.stringify(result.kingdomIds, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const manifestPath = path.join(process.cwd(), 'src', 'sim', 'balance-smoke-suite-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { selectedKingdomIds?: unknown };
  if (JSON.stringify(manifest.selectedKingdomIds) !== JSON.stringify(result.kingdomIds)) {
    throw new Error(`Balance-smoke selected IDs are stale: ${manifestPath}`);
  }
  process.stdout.write(`Verified ${result.kingdomIds.length} selected balance-smoke kingdom IDs.\n`);
} else {
  process.stdout.write(serializedIds);
}
