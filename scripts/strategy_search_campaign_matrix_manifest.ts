import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { candidateIndexAt, createOrderedCandidateSpace, orderedGoldfishCardIds } from '../src/sim/orderedGoldfishBenchmark';
import { createStrategySearchMatrixManifest } from '../src/sim/strategySearchMatrix';
import { readGoldfishReservoirV4 } from '../src/sim/strategySearchCompact';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`), value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`); return value;
}
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`); fs.renameSync(temporary, file);
}
const evidenceId = option('evidence-id'), kingdomId = option('kingdom'), reservoirFile = path.resolve(option('reservoir'));
const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
const strategyAt = (position: number) => space.candidateAt(candidateIndexAt(position, space.candidateCount));
const reservoir = readGoldfishReservoirV4(reservoirFile, strategyAt);
if (reservoir.header.evidenceId !== evidenceId || reservoir.records.length < 50) {
  throw new Error('Goldfish reservoir is invalid for Matrix.');
}
const reservoirContentHash = createHash('sha256').update(fs.readFileSync(reservoirFile)).digest('hex');
if (reservoirContentHash !== option('reservoir-sha256')) {
  throw new Error('Goldfish reservoir publication hash differs for Matrix.');
}
const manifest = createStrategySearchMatrixManifest({ source: { kingdomId, evidenceId,
  reservoirIdentityHash: reservoir.artifactHash, reservoirContentHash,
  matrixSeedNamespace: option('seed-namespace') }, strategies: reservoir.records.slice(0, 50).map((entry) => entry.strategy) });
writeAtomic(path.resolve(option('out')), manifest);
process.stdout.write(`${JSON.stringify({ manifestHash: manifest.evidenceHash })}\n`);
