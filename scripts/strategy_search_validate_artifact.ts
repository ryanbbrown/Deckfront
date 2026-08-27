import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { candidateIndexAt, createOrderedCandidateSpace, orderedGoldfishCardIds } from '../src/sim/orderedGoldfishBenchmark';
import type { OrderedProductProfileEvidence, OrderedProductStageOneRecord } from '../src/sim/orderedGoldfishProduct';
import { compareStageOneRecords, deriveScoreEvidence, rankingKey } from '../src/sim/orderedGoldfishProduct';
import { COMPACT_GOLDFISH_BUFFER_BYTES, GOLDFISH_ARTIFACT_HEADER_BYTES, GOLDFISH_TOP_RECORD_BYTES,
  readGoldfishArtifactRangeV4, readGoldfishArtifactV4, readGoldfishReservoirV4 } from '../src/sim/strategySearchCompact';
import { canonicalStrategy } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
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
function decodeTopRecord(bytes: Buffer, offset: number, rank: number,
  strategyAt: (position: number) => Strategy): OrderedProductStageOneRecord & { stageOneRank: number } {
  const traversalPosition = bytes.readUInt32BE(offset), profiles = ['stationary', 'chaser', 'kiter']
    .map((profile, profileIndex): OrderedProductProfileEvidence => ({ profile,
      trials: bytes.readUInt32BE(offset + 4 + profileIndex * 20),
      completions: bytes.readUInt32BE(offset + 8 + profileIndex * 20),
      penalizedTurnsTo50: bytes.readUInt32BE(offset + 12 + profileIndex * 20),
      damageArea: bytes.readUInt32BE(offset + 16 + profileIndex * 20),
      moneySpent: bytes.readUInt32BE(offset + 20 + profileIndex * 20) }));
  const strategy = strategyAt(traversalPosition), stageOne = deriveScoreEvidence(profiles);
  return { traversalPosition, displayId: strategy.id, canonicalStrategy: canonicalStrategy(strategy), strategy,
    stageOne, stageOneRankingKey: rankingKey(stageOne), stageOneRank: rank };
}
function validateGoldfishTop(file: string, strategyAt: (position: number) => Strategy,
  expected: { evidenceId: string; kingdomId: string; candidateCount: number }): void {
  const retainedCount = 500_000, framing = readGoldfishArtifactRangeV4(file, 0, 1, strategyAt);
  const header = framing.header;
  if (header.evidenceId !== expected.evidenceId || header.kingdomId !== expected.kingdomId
    || header.candidateCount !== expected.candidateCount || header.retainedCount !== retainedCount
    || header.reservoirCount !== 20_000 || JSON.stringify(header.seeds) !== JSON.stringify([4_100_000])) {
    throw new Error('Goldfish top-500000 artifact is invalid.');
  }
  const descriptor = fs.openSync(file, 'r'), hash = createHash('sha256');
  const positions = Buffer.alloc(Math.ceil(expected.candidateCount / 8)), displays = new Set<string>();
  const buffer = Buffer.allocUnsafe(COMPACT_GOLDFISH_BUFFER_BYTES); let previous: OrderedProductStageOneRecord | undefined;
  try {
    const headerBytes = Buffer.allocUnsafe(GOLDFISH_ARTIFACT_HEADER_BYTES);
    if (fs.readSync(descriptor, headerBytes, 0, headerBytes.length, 0) !== headerBytes.length) {
      throw new Error('Goldfish artifact header is truncated.');
    }
    hash.update(headerBytes);
    let recordIndex = 0;
    while (recordIndex < retainedCount) {
      const recordCount = Math.min(Math.floor(buffer.length / GOLDFISH_TOP_RECORD_BYTES), retainedCount - recordIndex);
      const byteCount = recordCount * GOLDFISH_TOP_RECORD_BYTES;
      const fileOffset = GOLDFISH_ARTIFACT_HEADER_BYTES + recordIndex * GOLDFISH_TOP_RECORD_BYTES;
      if (fs.readSync(descriptor, buffer, 0, byteCount, fileOffset) !== byteCount) {
        throw new Error('Goldfish artifact records are truncated.');
      }
      hash.update(buffer.subarray(0, byteCount));
      for (let index = 0; index < recordCount; index += 1) {
        const record = decodeTopRecord(buffer, index * GOLDFISH_TOP_RECORD_BYTES,
          recordIndex + index + 1, strategyAt);
        const byte = record.traversalPosition >>> 3, bit = 1 << (record.traversalPosition & 7);
        if (record.traversalPosition >= expected.candidateCount || positions[byte]! & bit
          || displays.has(record.displayId) || previous && compareStageOneRecords(previous, record) >= 0) {
          throw new Error('Goldfish top artifact order or identity differs.');
        }
        positions[byte] = positions[byte]! | bit; displays.add(record.displayId); previous = record;
      }
      recordIndex += recordCount;
    }
  } finally { fs.closeSync(descriptor); }
  if (hash.digest('hex') !== framing.artifactHash) throw new Error('Goldfish artifact checksum differs.');
}
const stage = option('stage'), file = path.resolve(option('file')), evidenceId = option('evidence-id'),
  kingdomId = option('kingdom'), evidenceRoot = path.resolve(option('evidence-root'));
if (!/^[0-9a-f]{64}$/.test(evidenceId)) throw new Error('Evidence ID is invalid.');
strategySearchKingdom(kingdomId);
const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
const strategyAt = (position: number) => space.candidateAt(candidateIndexAt(position, space.candidateCount));
if (stage === 'goldfish-one-reduce') {
  validateGoldfishTop(file, strategyAt, { evidenceId, kingdomId, candidateCount: 12_972_960 });
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
