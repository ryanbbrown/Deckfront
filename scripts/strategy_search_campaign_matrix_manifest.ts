import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateOrderedCalibrationSource } from '../src/sim/initialMatrixCalibration';
import { createStrategySearchMatrixManifest } from '../src/sim/strategySearchMatrix';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`), value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}
function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; }
function sha(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file);
}
const kingdomId = option('kingdom'), ranked = path.resolve(option('ranked')),
  reservoir = path.resolve(option('reservoir')), stageId = option('stage-id');
strategySearchKingdom(kingdomId);
const validated = validateOrderedCalibrationSource({ kingdomId, ranked: readJson(ranked),
  reservoir: readJson(reservoir), rankedSha256: sha(ranked), reservoirSha256: sha(reservoir) });
const manifest = createStrategySearchMatrixManifest({ stageId, source: { kingdomId,
  orderedProductIdentityHash: (readJson(ranked) as { productIdentity?: { identityHash?: string } })
    .productIdentity?.identityHash ?? '', rankedSha256: sha(ranked), reservoirSha256: sha(reservoir) },
strategies: validated.strategies });
writeAtomic(path.resolve(option('out')), manifest);
process.stdout.write(`${JSON.stringify({ manifestHash: manifest.evidenceHash })}\n`);
