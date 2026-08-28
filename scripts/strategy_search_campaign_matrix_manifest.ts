import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readGoldfishReservoir } from '../src/sim/goldfishReservoir';
import { createStrategySearchMatrixManifest } from '../src/sim/strategySearchMatrix';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`), value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`); return value;
}
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`); fs.renameSync(temporary, file);
}
const evidenceId = option('evidence-id'), kingdomId = option('kingdom'), reservoirFile = path.resolve(option('reservoir'));
const topFile = path.join(path.dirname(reservoirFile), 'top-500000.hgf');
const reservoir = readGoldfishReservoir(reservoirFile, kingdomId, { top: topFile });
if (reservoir.records.length < 50) throw new Error('Goldfish reservoir is invalid for Matrix.');
const reservoirIdentityHash = createHash('sha256').update(fs.readFileSync(reservoirFile)).digest('hex');
if (reservoirIdentityHash !== option('reservoir-sha256')) {
  throw new Error('Goldfish reservoir publication hash differs for Matrix.');
}
const reservoirContentHash = createHash('sha256').update(fs.readFileSync(topFile)).digest('hex');
const manifest = createStrategySearchMatrixManifest({ source: { kingdomId, evidenceId,
  reservoirIdentityHash, reservoirContentHash, matrixSeedNamespace: option('seed-namespace') },
strategies: reservoir.records.slice(0, 50).map((entry) => entry.strategy) });
writeAtomic(path.resolve(option('out')), manifest);
process.stdout.write(`${JSON.stringify({ manifestHash: manifest.evidenceHash })}\n`);
