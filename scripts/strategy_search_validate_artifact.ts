import fs from 'node:fs';
import path from 'node:path';
import { candidateIndexAt, createOrderedCandidateSpace, orderedGoldfishCardIds } from '../src/sim/orderedGoldfishBenchmark';
import { readGoldfishArtifactV4, readGoldfishReservoirV4 } from '../src/sim/strategySearchCompact';
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
const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
const strategyAt = (position: number) => space.candidateAt(candidateIndexAt(position, space.candidateCount));
if (stage === 'goldfish-one-reduce') {
  const value = readGoldfishArtifactV4(file, strategyAt);
  if (value.header.evidenceId !== evidenceId || value.header.kingdomId !== kingdomId
    || value.header.candidateCount !== 12_972_960 || value.header.retainedCount !== 500_000
    || value.header.reservoirCount !== 20_000 || JSON.stringify(value.header.seeds) !== JSON.stringify([4_100_000])) {
    throw new Error('Goldfish top-500000 artifact is invalid.');
  }
} else if (stage === 'goldfish-two-reduce') {
  const topFile = path.join(evidenceRoot, 'goldfish/top-500000.hgf'), top = readGoldfishArtifactV4(topFile, strategyAt);
  const stageRanks = new Map(top.records.map((record) => [record.traversalPosition, record.stageOneRank]));
  const value = readGoldfishReservoirV4(file, strategyAt,
    { expectedSourceHash: top.artifactHash, stageRanks });
  if (value.header.evidenceId !== evidenceId || value.header.kingdomId !== kingdomId
    || value.records.length !== 20_000) throw new Error('Goldfish reservoir artifact is invalid.');
} else if (stage === 'matrix') {
  const matrix = readJson(file) as StrategySearchMatrixArtifact;
  if (!validateStrategySearchMatrixManifest(matrix.manifest)
    || matrix.manifest.source.evidenceId !== evidenceId || matrix.manifest.source.kingdomId !== kingdomId
    || !validateStrategySearchMatrixArtifact(matrix, matrix.manifest)) throw new Error('Matrix artifact is invalid.');
} else if (stage === 'psro') {
  const value = readJson(file), matrix = readJson(path.join(evidenceRoot, 'matrix/evidence.json')) as StrategySearchMatrixArtifact;
  const topFile = path.join(evidenceRoot, 'goldfish/top-500000.hgf');
  const reservoir = readGoldfishReservoirV4(path.join(evidenceRoot, 'goldfish/reservoir.hgf'), strategyAt, { topFile });
  if (!validateStrategySearchPsroArtifact(value) || value.evidenceId !== evidenceId || !value.rawLooks.length
    || !validateStrategySearchMatrixManifest(matrix.manifest) || matrix.manifest.source.kingdomId !== kingdomId
    || !validateStrategySearchMatrixArtifactIdentity(matrix, matrix.manifest) || value.matrixEvidenceHash !== matrix.evidenceHash
    || JSON.stringify(value.candidateIds) !== JSON.stringify(reservoir.records.map((entry) => entry.displayId))) {
    throw new Error('PSRO artifact is invalid.');
  }
} else throw new Error(`Artifact stage ${stage} does not use validation.`);
process.stdout.write(`${JSON.stringify({ valid: true, stage, evidenceId })}\n`);
