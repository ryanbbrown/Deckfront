import fs from 'node:fs';
import path from 'node:path';
import { readGoldfishReservoir, readGoldfishTop } from '../src/sim/goldfishReservoir';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';
import { validateStrategySearchMatrixArtifact, validateStrategySearchMatrixArtifactIdentity,
  validateStrategySearchMatrixManifest } from '../src/sim/strategySearchMatrix';
import type { StrategySearchMatrixArtifact } from '../src/sim/strategySearchMatrix';
import { validateStrategySearchPsroArtifact } from '../src/sim/strategySearchPsro';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`), value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}
function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; }
const stage = option('stage'), file = path.resolve(option('file')), evidenceId = option('evidence-id'),
  kingdomId = option('kingdom'), evidenceRoot = path.resolve(option('evidence-root'));
if (!/^[0-9a-f]{64}$/.test(evidenceId)) throw new Error('Evidence ID is invalid.');
strategySearchKingdom(kingdomId);
if (stage === 'goldfish-one-reduce') {
  readGoldfishTop(file, kingdomId);
} else if (stage === 'goldfish-two-reduce') {
  const topFile = path.join(evidenceRoot, 'goldfish/top-500000.hgf');
  readGoldfishReservoir(file, kingdomId, { top: topFile });
} else if (stage === 'matrix' || stage === 'matrix-reduce') {
  const matrix = readJson(file) as StrategySearchMatrixArtifact;
  if (!validateStrategySearchMatrixManifest(matrix.manifest)
    || matrix.manifest.source.evidenceId !== evidenceId || matrix.manifest.source.kingdomId !== kingdomId
    || !validateStrategySearchMatrixArtifact(matrix, matrix.manifest)) throw new Error('Matrix artifact is invalid.');
} else if (stage === 'psro' || stage === 'psro-reduce') {
  const value = readJson(file), matrix = readJson(path.join(evidenceRoot, 'matrix/evidence.json')) as StrategySearchMatrixArtifact;
  const topFile = path.join(evidenceRoot, 'goldfish/top-500000.hgf');
  const reservoir = readGoldfishReservoir(path.join(evidenceRoot, 'goldfish/reservoir.hgf'), kingdomId,
    { top: topFile });
  if (!validateStrategySearchPsroArtifact(value) || value.evidenceId !== evidenceId || !value.rawLooks.length
    || !validateStrategySearchMatrixManifest(matrix.manifest) || matrix.manifest.source.kingdomId !== kingdomId
    || !validateStrategySearchMatrixArtifactIdentity(matrix, matrix.manifest) || value.matrixEvidenceHash !== matrix.evidenceHash
    || JSON.stringify(value.candidateIds) !== JSON.stringify(reservoir.records.map((entry) => entry.displayId))) {
    throw new Error('PSRO artifact is invalid.');
  }
} else throw new Error(`Artifact stage ${stage} does not use validation.`);
process.stdout.write(`${JSON.stringify({ valid: true, stage, evidenceId })}\n`);
