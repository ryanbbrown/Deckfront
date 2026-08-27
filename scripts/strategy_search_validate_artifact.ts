import fs from 'node:fs';
import path from 'node:path';
import {
  validateGoldfishArtifactV3, validateGoldfishReservoirV3
} from '../src/sim/strategySearchCompact';
import type { GoldfishArtifactV3 } from '../src/sim/strategySearchCompact';
import {
  validateStrategySearchMatrixArtifact, validateStrategySearchMatrixManifest
} from '../src/sim/strategySearchMatrix';
import type { StrategySearchMatrixArtifact } from '../src/sim/strategySearchMatrix';
import { validateStrategySearchPsroArtifact } from '../src/sim/strategySearchPsro';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`), value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}
function read(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; }
const stage = option('stage'), file = path.resolve(option('file')), evidenceId = option('evidence-id'),
  kingdomId = option('kingdom');
const evidenceRoot = path.resolve(option('evidence-root'));
if (!/^[0-9a-f]{64}$/.test(evidenceId)) throw new Error('Evidence ID is invalid.');
const value = read(file);
if (stage === 'goldfish-one-reduce') {
  if (!validateGoldfishArtifactV3(value) || value.evidenceId !== evidenceId || value.kingdomId !== kingdomId
    || value.candidateCount !== 12_972_960 || value.retainedCount !== 500_000 || value.reservoirCount !== 20_000
    || JSON.stringify(value.seeds) !== JSON.stringify([4_100_000])) {
    throw new Error('Goldfish top-500000 artifact is invalid.');
  }
} else if (stage === 'goldfish-two-reduce') {
  const top = read(path.join(evidenceRoot, 'goldfish/top-500000.json')) as GoldfishArtifactV3;
  if (!validateGoldfishArtifactV3(top) || top.kingdomId !== kingdomId
    || !validateGoldfishReservoirV3(value, top) || value.entries.length !== 20_000
    || value.evidenceId !== evidenceId) throw new Error('Goldfish reservoir artifact is invalid.');
} else if (stage === 'matrix') {
  const matrix = value as StrategySearchMatrixArtifact;
  if (!validateStrategySearchMatrixManifest(matrix.manifest)
    || matrix.manifest.source.evidenceId !== evidenceId || matrix.manifest.source.kingdomId !== kingdomId
    || !validateStrategySearchMatrixArtifact(matrix, matrix.manifest)) {
    throw new Error('Matrix artifact is invalid.');
  }
} else if (stage === 'psro') {
  const matrix = read(path.join(evidenceRoot, 'matrix/evidence.json')) as StrategySearchMatrixArtifact;
  const reservoir = read(path.join(evidenceRoot, 'goldfish/reservoir.json'));
  if (!validateStrategySearchPsroArtifact(value) || value.evidenceId !== evidenceId || !value.rawLooks.length
    || !validateStrategySearchMatrixManifest(matrix.manifest)
    || matrix.manifest.source.kingdomId !== kingdomId
    || !validateStrategySearchMatrixArtifact(matrix, matrix.manifest)
    || value.matrixEvidenceHash !== matrix.evidenceHash
    || !validateGoldfishReservoirV3(reservoir)
    || JSON.stringify(value.candidateIds) !== JSON.stringify(reservoir.entries.map((entry) => entry.displayId))) {
    throw new Error('PSRO artifact is invalid.');
  }
} else {
  throw new Error(`Artifact stage ${stage} does not use JSON validation.`);
}
process.stdout.write(`${JSON.stringify({ valid: true, stage, evidenceId })}\n`);
