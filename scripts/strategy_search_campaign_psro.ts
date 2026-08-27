import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  readValidatedThresholdRacingCheckpointPair, runThresholdRacingCampaign
} from './successive_halving_double_oracle_pilot';
import type { ThresholdRacingSource } from './successive_halving_double_oracle_pilot';
import type { CalibrationSourceIdentity } from '../src/sim/responseOracleCalibration';
import type { GoldfishReservoirV3 } from '../src/sim/strategySearchCompact';
import { validateStrategySearchMatrixArtifact, validateStrategySearchMatrixManifest } from '../src/sim/strategySearchMatrix';
import type { StrategySearchMatrixArtifact } from '../src/sim/strategySearchMatrix';
import { matrixProtocol, payoffMatrixPairKey } from '../src/sim/payoffMatrix';
import type { MatrixCell, MatrixSnapshot } from '../src/sim/payoffMatrix';
import { reconstructMatrixCache } from '../src/sim/fixedReservoirConsistency';
import { GAMES_PER_SEED, emptyAggregate, mergeAggregate } from '../src/sim/pairing';
import { compareUtf16 } from '../src/sim/utf16';
import { createThresholdRacingProtocol } from '../src/sim/thresholdRacingPsro';
import type { RawPsroLookArtifact, RawPsroScoreChunk } from '../src/sim/thresholdRacingPsro';
import { createStrategySearchPsroArtifact, createStrategySearchPsroLook } from '../src/sim/strategySearchPsro';
import { createCampaignStageControlMarker } from '../src/sim/strategySearchStages';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

interface Config { evidenceId: string; kingdomId: string; runId: string; reservoirPath: string;
  matrixEvidencePath: string; outputRoot: string; controlRoot: string; workers: number;
  protocolInput: { experimentName: string; protocolVersion: string; checkpointNamespace: string;
    screenDepths: number[]; confirmationLooks: number[]; matrixSeedNamespace: string;
    screenSeedNamespace: string; confirmationSeedNamespace: string; queueRetestSeedNamespace: string } }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function option(name: string): string { const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`); return value; }
function writeAtomic(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file); }
function fileHash(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
const config = JSON.parse(fs.readFileSync(path.resolve(option('config')), 'utf8')) as Config;
const shutdownAtMs = Number(option('shutdown-at-ms'));
if (!/^[0-9a-f]{64}$/.test(config.evidenceId) || !Number.isSafeInteger(config.workers) || config.workers < 1
  || !Number.isSafeInteger(shutdownAtMs) || shutdownAtMs <= Date.now()) throw new Error('PSRO execution input is invalid.');
strategySearchKingdom(config.kingdomId);
const reservoir = JSON.parse(fs.readFileSync(config.reservoirPath, 'utf8')) as GoldfishReservoirV3;
const matrix = JSON.parse(fs.readFileSync(config.matrixEvidencePath, 'utf8')) as unknown;
if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) throw new Error('PSRO Matrix evidence is malformed.');
const manifest = (matrix as StrategySearchMatrixArtifact).manifest;
if (reservoir.schemaVersion !== 3 || reservoir.evidenceId !== config.evidenceId
  || !validateStrategySearchMatrixManifest(manifest) || manifest.source.evidenceId !== config.evidenceId
  || !validateStrategySearchMatrixArtifact(matrix, manifest)) throw new Error('PSRO scientific source is invalid.');
function initialMatrix(artifact: StrategySearchMatrixArtifact): MatrixSnapshot {
  const protocol = matrixProtocol(config.kingdomId, manifest.seeds.slice(0, 75), 30, 200, false);
  const cells: MatrixCell[] = artifact.cells.filter((cell) => cell.rowIndex !== cell.columnIndex).map((cell) => {
    const records = cell.seedRecords.slice(0, 75), row = manifest.strategies[cell.rowIndex]!,
      column = manifest.strategies[cell.columnIndex]!, original = records.map((record) => record.payoffScore!);
    const [first, second, scores] = row.id < column.id ? [row, column, original]
      : [column, row, original.map((score) => 1 - score)];
    const telemetry = emptyAggregate(); records.forEach((record) => mergeAggregate(telemetry, record.telemetry));
    return { rowId: first.id, columnId: second.id, key: payoffMatrixPairKey(protocol, first, second),
      blocks: scores.map((score, index) => ({ seed: protocol.seeds[index]!, score, played: GAMES_PER_SEED, aborted: 0 })),
      complete: true, centeredPayoff: 2 * scores.reduce((sum, score) => sum + score, 0) / 75 - 1,
      matches: 75 * GAMES_PER_SEED, telemetry };
  }).sort((left, right) => compareUtf16(left.rowId, right.rowId) || compareUtf16(left.columnId, right.columnId));
  const snapshot: MatrixSnapshot = { protocol, strategies: manifest.strategies, cells, complete: true,
    centeredPayoffs: artifact.centeredPayoffs };
  reconstructMatrixCache(snapshot); return snapshot;
}
const sourceIdentity: CalibrationSourceIdentity = { kingdomId: config.kingdomId,
  rankedPath: config.reservoirPath, reservoirPath: config.reservoirPath,
  p75ManifestPath: config.matrixEvidencePath, p75ReportPath: config.matrixEvidencePath,
  rankedSha256: reservoir.sourceArtifactHash, reservoirSha256: fileHash(config.reservoirPath),
  p75ManifestSha256: fileHash(config.matrixEvidencePath), p75ReportSha256: fileHash(config.matrixEvidencePath),
  p75ManifestHash: manifest.evidenceHash, reservoirRunId: config.evidenceId,
  reservoirVersion: 'strategy-search-goldfish-v3', rulesFingerprint: manifest.rulesFingerprint };
const protocol = createThresholdRacingProtocol({ ...config.protocolInput, runId: config.runId,
  kingdomId: config.kingdomId, reservoirCount: reservoir.entries.length, sourceIdentityHash: hash(sourceIdentity) });
const source: ThresholdRacingSource = { entry: { kingdomId: config.kingdomId, ranked: config.reservoirPath,
  reservoir: config.reservoirPath, p75Root: path.dirname(config.matrixEvidencePath) }, source: sourceIdentity,
  reservoir: reservoir as never, initialMatrix: initialMatrix(matrix), kingdomId: config.kingdomId,
  experimentName: protocol.experimentName, protocolVersion: protocol.protocolVersion, rawProtocol: protocol,
  deadlineMs: shutdownAtMs, terminalOnUnresolved: true,
  onRawCheckpoint(event) { process.stdout.write(`${JSON.stringify(event)}\n`); } };
const checkpoint = await runThresholdRacingCampaign(config.outputRoot, source, config.workers, config.runId, 'local');
const saved = readValidatedThresholdRacingCheckpointPair(config.outputRoot, source, config.runId);
if (!saved || JSON.stringify(saved.checkpoint) !== JSON.stringify(checkpoint) || checkpoint.status !== 'complete') {
  throw new Error('PSRO ended terminal-incomplete or without a validated checkpoint.');
}
const rawRoot = path.join(config.outputRoot, `run-${config.runId}`, 'raw');
const lookRoot = path.join(rawRoot, 'looks');
if (!fs.existsSync(lookRoot)) throw new Error('PSRO complete checkpoint has no raw looks.');
const rawLooks = fs.readdirSync(lookRoot).filter((file) => file.endsWith('.json')).map((file) => {
  const look = JSON.parse(fs.readFileSync(path.join(lookRoot, file), 'utf8')) as RawPsroLookArtifact;
  const chunks = look.chunks.map((reference) => JSON.parse(fs.readFileSync(path.join(rawRoot, 'chunks', look.lookId,
    `${reference.candidateStart}-${reference.candidateEnd}.json`), 'utf8')) as RawPsroScoreChunk);
  return createStrategySearchPsroLook({ look, chunks, protocol });
});
if (!rawLooks.length) throw new Error('PSRO complete checkpoint has an empty raw-look set.');
const artifact = createStrategySearchPsroArtifact({ evidenceId: config.evidenceId,
  matrixEvidenceHash: matrix.evidenceHash, candidateIds: reservoir.entries.map((entry) => entry.displayId),
  rawLooks, checkpoint, finalStatus: 'complete' });
const artifactFile = path.join(config.outputRoot, 'evidence.json'); writeAtomic(artifactFile, artifact);
const marker = createCampaignStageControlMarker({ stage: 'psro', evidenceId: config.evidenceId,
  status: 'complete', artifactHashes: { 'output/evidence.json': fileHash(artifactFile) } });
writeAtomic(path.join(config.controlRoot, 'complete.json'), marker);
process.stdout.write(`${JSON.stringify({ type: 'strategy-search-stage-stop', stage: 'psro', status: 'complete',
  markerHash: marker.markerHash, evidenceHash: artifact.evidenceHash })}\n`);
