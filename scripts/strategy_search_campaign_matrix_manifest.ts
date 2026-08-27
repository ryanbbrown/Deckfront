import fs from 'node:fs';
import path from 'node:path';
import { loadValidatedOrderedProductSplitSource } from '../src/sim/orderedGoldfishSplitArtifact';
import { createStrategySearchMatrixManifest } from '../src/sim/strategySearchMatrix';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`), value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file);
}
const kingdomId = option('kingdom'), ranked = path.resolve(option('ranked')),
  reservoir = path.resolve(option('reservoir')), stageId = option('stage-id'),
  matrixSeedNamespace = option('seed-namespace');
strategySearchKingdom(kingdomId);
const validated = await loadValidatedOrderedProductSplitSource({ kingdomId, rankedPath: ranked,
  reservoirPath: reservoir });
const manifest = createStrategySearchMatrixManifest({ stageId, source: { kingdomId,
  orderedProductIdentityHash: validated.manifest.productIdentity?.identityHash ?? '',
  rankedSha256: validated.rankedSha256, reservoirSha256: validated.reservoirSha256,
  matrixSeedNamespace },
strategies: validated.strategies });
writeAtomic(path.resolve(option('out')), manifest);
process.stdout.write(`${JSON.stringify({ manifestHash: manifest.evidenceHash })}\n`);
